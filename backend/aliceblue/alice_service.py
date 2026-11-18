"""Read-only Alice Blue REST service. Never imports or implements order APIs."""
import asyncio, base64, hashlib, json, logging, math, os, re, secrets, sqlite3, time
from collections import deque
from contextlib import closing
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import urlencode, urlsplit
import httpx
from cryptography.fernet import Fernet, InvalidToken
from fastapi import FastAPI, Request, HTTPException
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse, RedirectResponse
from snapshot_store import iso_to_broker_expiry, normalize_expiry_iso

BASE = 'https://a3.aliceblueonline.com'
EXCHANGES = {'nse_fo', 'bse_fo', 'mcx_fo'}
ROUTES = {'underlyings': 'getUnderlying', 'expiries': 'getUnderlyingExp', 'option-chain': 'getOptionChain'}
COOKIE = 'iwsm_alice'
PREFIX = '/api/aliceblue'
SENSITIVE_KEY_RE = re.compile(r'(token|secret|auth|cookie|key|checksum|grant|session|password)', re.IGNORECASE)
PUBLIC_GET_PATHS = {
    PREFIX + '/health',
    PREFIX + '/market-status',
    PREFIX + '/auth/status',
    PREFIX + '/instruments',
    PREFIX + '/expiries',
    PREFIX + '/replay',
    PREFIX + '/snapshot',
    PREFIX + '/snapshots/coverage',
    PREFIX + '/snapshots/replay',
    PREFIX + '/recorder/status',
    PREFIX + '/underlying-candles',
}

logger = logging.getLogger('iwsm.aliceblue')
if not logger.handlers:
    handler = logging.StreamHandler()
    handler.setFormatter(logging.Formatter('%(message)s'))
    logger.addHandler(handler)
    logger.setLevel(logging.INFO)


def log_event(level: str, event: str, **fields):
    safe = {'ts': datetime.now(timezone.utc).isoformat(), 'event': event}
    for k, v in fields.items():
        safe[k] = '[REDACTED]' if SENSITIVE_KEY_RE.search(str(k)) else v
    getattr(logger, level, logger.info)(json.dumps(safe, default=str))


def validate_config(config: dict):
    if not isinstance(config, dict):
        raise ValueError('Configuration must be a dictionary')
    key = config.get('ALICEBLUE_SESSION_ENCRYPTION_KEY', '')
    if not key:
        raise ValueError('Missing ALICEBLUE_SESSION_ENCRYPTION_KEY')
    try:
        Fernet(key.encode() if isinstance(key, str) else key)
    except Exception as exc:
        raise ValueError('Invalid ALICEBLUE_SESSION_ENCRYPTION_KEY') from exc
    redirect = str(config.get('ALICEBLUE_REDIRECT_URL', ''))
    parsed = urlsplit(redirect)
    if (
        parsed.path != PREFIX + '/auth/callback'
        or parsed.query
        or parsed.fragment
        or (parsed.scheme != 'https' and not (parsed.scheme == 'http' and parsed.hostname in ('127.0.0.1', 'localhost')))
    ):
        raise ValueError('Use an HTTPS callback or local loopback callback')
    try:
        refresh = int(config.get('ALICEBLUE_REFRESH_SECONDS', '5'))
        if refresh < 1 or refresh > 3600:
            raise ValueError()
    except ValueError:
        raise ValueError('ALICEBLUE_REFRESH_SECONDS must be between 1 and 3600') from None


def session_seconds(token, now=None):
    """Use provider expiry only as a cache upper bound, never as an auth claim."""
    now = time.time() if now is None else now
    try:
        part = token.split('.')[1]
        exp = json.loads(base64.urlsafe_b64decode(part + '=' * (-len(part) % 4))).get('exp')
        if isinstance(exp, bool) or not isinstance(exp, (float, int)) or not math.isfinite(exp):
            raise ValueError()
        return max(0, min(90 * 86400, int(exp - now) - 30))
    except (ValueError, TypeError, IndexError, UnicodeError):
        return 3600


def settings(file):
    values = {}
    files = file if isinstance(file, (list, tuple)) else [file]
    for f in files:
        try:
            lines = Path(f).read_text(encoding='utf-8-sig').splitlines()
        except OSError:
            continue
        for line in lines:
            if '=' in line and not line.lstrip().startswith('#'):
                k, v = line.split('=', 1)
                val = v.strip().strip('"\'')
                if val or k.strip() not in values:
                    values[k.strip()] = val
    for env_k in (
        'ALICEBLUE_APP_CODE',
        'ALICEBLUE_API_SECRET',
        'ALICEBLUE_API_KEY',
        'ALICEBLUE_SESSION_TOKEN',
        'ALICEBLUE_USER_ID',
        'ALICEBLUE_REDIRECT_URL',
        'ALICEBLUE_CLIENT_ID',
        'ALICEBLUE_SESSION_ENCRYPTION_KEY',
        'ALICEBLUE_BASE_URL',
        'ALICEBLUE_DEFAULT_EXCHANGE',
        'ALICEBLUE_REFRESH_SECONDS',
        'ALICEBLUE_SNAPSHOT_DB_PATH',
        'IWSM_MARKET_DATA_PROVIDER',
    ):
        if os.getenv(env_k):
            values[env_k] = os.environ[env_k]
    for k in list(values):
        if os.getenv(k):
            values[k] = os.environ[k]
    return values


def persist_local_env(env_path, updates: dict):
    """Persist verified non-empty configuration updates to the private local env file."""
    if not env_path or not updates:
        return
    p = Path(env_path)
    try:
        lines = p.read_text(encoding='utf-8-sig').splitlines() if p.is_file() else []
    except OSError:
        lines = []
    clean = {k: str(v).strip() for k, v in updates.items() if v is not None and str(v).strip()}
    if not clean:
        return
    written = set()
    out = []
    for line in lines:
        if '=' in line and not line.lstrip().startswith('#'):
            k, _ = line.split('=', 1)
            key = k.strip()
            if key in clean:
                out.append(f'{key}={clean[key]}')
                written.add(key)
                continue
        out.append(line)
    for key, val in clean.items():
        if key not in written:
            out.append(f'{key}={val}')
    try:
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_text('\n'.join(out) + '\n', encoding='utf-8')
    except OSError:
        pass


def checksum(user, code, secret):
    return hashlib.sha256((user + code + secret).encode()).hexdigest()


def number(value):
    try:
        n = float(value)
        return n if math.isfinite(n) else None
    except (ValueError, TypeError):
        return None


def normalize(payload, underlying, expiry, exchange='nse_fo'):
    rows = {}
    issues = []
    for group in payload.get('result', []):
        for pair in group.get('data', []):
            matched = []
            for side in ('CE', 'PE'):
                leg = pair.get(side)
                if not leg:
                    continue
                symbol = str(leg.get('tradingsymbol', ''))
                m = re.fullmatch(re.escape(underlying + expiry) + ('C' if side == 'CE' else 'P') + r'(\d+(?:\.\d+)?)', symbol)
                if not m and exchange == 'bse_fo':
                    try:
                        dt = datetime.strptime(expiry, '%d%b%y')
                        monthcode = '123456789OND'[dt.month - 1]
                        weekly = underlying + dt.strftime('%y') + monthcode + dt.strftime('%d')
                        monthly = underlying + dt.strftime('%y%b').upper()
                        m = re.fullmatch('(?:' + re.escape(weekly) + '|' + re.escape(monthly) + r')(\d+(?:\.\d+)?)' + side, symbol)
                    except ValueError:
                        pass
                strike = number(m[1]) if m else None
                if strike is None:
                    issues.append('Unrecognized contract format; leg omitted')
                    continue
                oi, pdoi = number(leg.get('oi')), number(leg.get('pdoi'))
                bid = number(leg.get('bp1') if 'bp1' in leg else leg.get('bid'))
                ask = number(leg.get('sp1') if 'sp1' in leg else leg.get('ask'))
                vol = number(leg.get('volume') if 'volume' in leg else leg.get('v'))
                item = dict(
                    instrument=leg.get('forInsName'),
                    symbol=symbol,
                    token=str(leg.get('token', '')),
                    ltp=number(leg.get('ltp')),
                    bid=bid,
                    ask=ask,
                    volume=vol,
                    oi=oi,
                    previousOi=pdoi,
                    previousClose=number(leg.get('pdc')),
                    oiChange=oi - pdoi if oi is not None and pdoi is not None else None,
                    calculatedValue=number(leg.get('gval')),
                )
                matched.append((strike, side, item))
            if len(matched) == 2 and matched[0][0] != matched[1][0]:
                issues.append('Call/put strike mismatch; pair omitted')
                continue
            for strike, side, item in matched:
                if side in rows.setdefault(strike, {'strike': strike}):
                    issues.append('Duplicate contract omitted')
                    continue
                rows[strike][side] = item
    return {'rows': [rows[k] for k in sorted(rows)], 'issues': sorted(set(issues)), 'underlyingPrice': None, 'atmStrike': None}


class Store:
    def __init__(self, path, key):
        self.path = path
        self.cipher = Fernet(key.encode())
        Path(path).parent.mkdir(parents=True, exist_ok=True)
        with closing(sqlite3.connect(path)) as c:
            c.execute('CREATE TABLE IF NOT EXISTS sessions(id TEXT PRIMARY KEY,expires REAL,data BLOB)')
            c.commit()

    def put(self, sid, data, seconds):
        with closing(sqlite3.connect(self.path)) as c:
            c.execute('DELETE FROM sessions WHERE expires<?', (time.time(),))
            c.execute(
                'INSERT OR REPLACE INTO sessions VALUES(?,?,?)',
                (hashlib.sha256(sid.encode()).hexdigest(), time.time() + seconds, self.cipher.encrypt(json.dumps(data).encode())),
            )
            c.commit()

    def get(self, sid):
        if not sid:
            return None
        with closing(sqlite3.connect(self.path)) as c:
            r = c.execute('SELECT expires,data FROM sessions WHERE id=?', (hashlib.sha256(sid.encode()).hexdigest(),)).fetchone()
        if not r or r[0] <= time.time():
            return None
        try:
            return json.loads(self.cipher.decrypt(r[1]))
        except InvalidToken:
            return None

    def latest_token(self):
        now = time.time()
        with closing(sqlite3.connect(self.path)) as c:
            rows = c.execute('SELECT expires,data FROM sessions WHERE expires>? ORDER BY expires DESC', (now,)).fetchall()
        for _, blob in rows:
            try:
                payload = json.loads(self.cipher.decrypt(blob))
                tok = payload.get('token') or payload.get('ownerRecoveryToken')
                if isinstance(tok, str) and tok and session_seconds(tok, now) > 0:
                    return tok
            except InvalidToken:
                continue
        return None

    def delete(self, sid):
        with closing(sqlite3.connect(self.path)) as c:
            c.execute('DELETE FROM sessions WHERE id=?', (hashlib.sha256(sid.encode()).hexdigest(),))
            c.commit()


class Broker:
    def __init__(self, transport=None, base_url=BASE):
        self._has_mock_transport = transport is not None
        self.http = httpx.AsyncClient(
            base_url=base_url or BASE,
            timeout=httpx.Timeout(18),
            follow_redirects=False,
            transport=transport,
            limits=httpx.Limits(max_connections=32, max_keepalive_connections=20),
        )
        self.calls = deque()
        self.lock = asyncio.Lock()
        self.pause = 0

    async def post(self, path, body, token=None, allow_not_ok: bool = False):
        is_history = '/chart/history' in path
        min_gap = 0.0 if is_history else 0.18
        per_min_limit = 1800 if is_history else 650
        async with self.lock:
            now = time.monotonic()
            while self.calls and now - self.calls[0] > 3600:
                self.calls.popleft()
            if now < self.pause or len(self.calls) >= 12000 or sum(now - x < 60 for x in self.calls) >= per_min_limit:
                raise HTTPException(429, 'Market-data request limit reached; wait before refreshing')
            if min_gap > 0 and self.calls and now - self.calls[-1] < min_gap:
                await asyncio.sleep(min_gap - (now - self.calls[-1]))
            self.calls.append(time.monotonic())

        r = None
        for attempt in range(2):
            try:
                r = await self.http.post(path, json=body, headers={'Authorization': 'Bearer ' + token} if token else {})
                break
            except httpx.TransportError:
                if attempt == 0:
                    await asyncio.sleep(0.35)
                    continue
                raise HTTPException(503, 'Broker connection unavailable') from None
            except httpx.HTTPError:
                raise HTTPException(503, 'Broker connection unavailable') from None

        if r.status_code in (401, 403):
            raise HTTPException(401, 'Broker authentication required')
        if r.status_code == 429:
            try:
                wait = min(3600, max(5, int(r.headers.get('retry-after', '30'))))
            except ValueError:
                wait = 30
            self.pause = time.monotonic() + wait
            raise HTTPException(429, 'Broker rate limit; refresh paused')
        if not r.is_success:
            raise HTTPException(502, 'Broker request failed')
        try:
            data = r.json()
        except ValueError:
            raise HTTPException(502, 'Invalid broker response') from None
        if not isinstance(data, dict):
            raise HTTPException(502, 'Invalid broker response')
        if data.get('stat', data.get('status')) != 'Ok':
            emsg = str(data.get('emsg') or data.get('message') or '').strip()
            low = emsg.lower()
            if any(term in low for term in ('unauthorized', 'invalid session', 'session expired', 'invalid token', 'not logged')):
                raise HTTPException(401, 'Broker authentication required')
            if allow_not_ok:
                return data
            raise HTTPException(502, 'Broker rejected the request; check session and API permissions')
        return data


async def exchange_direct_api_key(broker: Broker, user_id: str, api_key: str) -> str:
    """Official Alice Blue Direct API Key two-step handshake (getEncKey -> getUserSID)."""
    uid = str(user_id or '').strip().upper()
    key = str(api_key or '').strip()
    if not re.fullmatch(r'[A-Za-z0-9_-]{2,40}', uid) or len(key) < 16:
        raise HTTPException(422, 'Provide a valid Alice Blue Client ID and API Key')

    enc_key = None
    for ep in ('/open-api/od/v1/kani/getEncKey', '/rest/AliceBlueAPIService/api/customer/getAPIEncpkey'):
        try:
            res = await broker.post(ep, {'userId': uid}, allow_not_ok=True)
            cand = res.get('encKey') or (res.get('result') if isinstance(res.get('result'), str) else None)
            if isinstance(cand, str) and cand.strip():
                enc_key = cand.strip()
                break
        except HTTPException as exc:
            if exc.status_code == 503:
                raise
            continue
    if not enc_key:
        raise HTTPException(401, 'Alice Blue did not issue an encryption key for this Client ID. Verify Client ID and API Key activation in ANT Web.')

    user_data = hashlib.sha256((uid + key + enc_key).encode('utf-8')).hexdigest()
    session_id = None
    for ep in ('/open-api/od/v1/kani/getUserSID', '/rest/AliceBlueAPIService/api/customer/getUserSID'):
        try:
            res = await broker.post(ep, {'userId': uid, 'userData': user_data}, allow_not_ok=True)
            cand = res.get('sessionID') or res.get('userSession')
            if isinstance(cand, str) and cand.strip() and res.get('stat', res.get('status', 'Ok')) == 'Ok':
                session_id = cand.strip()
                break
        except HTTPException as exc:
            if exc.status_code == 503:
                raise
            continue
    if not session_id:
        raise HTTPException(401, 'Alice Blue rejected the API Key checksum. Use the Customer API Key from ANT Web -> Apps -> API Key, or connect via Alice Blue SSO.')

    await broker.post('/obrest/optionChain/getUnderlying', {'exch': 'nse_fo'}, session_id)
    return session_id


def create_app(config, db, transport=None, snapshot_db=None, local_owner_mode: bool = False, env_path=None, parquet_root=None):
    validate_config(config)
    app = FastAPI(docs_url=None, redoc_url=None, openapi_url=None)
    store = Store(db, config['ALICEBLUE_SESSION_ENCRYPTION_KEY'])
    broker = Broker(transport, base_url=config.get('ALICEBLUE_BASE_URL') or BASE)
    redirect = config['ALICEBLUE_REDIRECT_URL']
    parsed = urlsplit(redirect)
    origin = parsed.scheme + '://' + parsed.netloc
    secure = parsed.scheme == 'https'
    allowed_origins = {origin}
    if parsed.hostname in ('127.0.0.1', 'localhost'):
        port_part = f':{parsed.port}' if parsed.port else ''
        allowed_origins.update({
            f'{parsed.scheme}://127.0.0.1{port_part}',
            f'{parsed.scheme}://localhost{port_part}',
            'http://127.0.0.1:4174',
            'http://localhost:4174',
            'http://127.0.0.1:4173',
            'http://localhost:4173',
            'http://127.0.0.1:5500',
            'http://localhost:5500',
            'http://127.0.0.1:3000',
            'http://localhost:3000',
            'http://127.0.0.1:8080',
            'http://localhost:8080',
            'https://dragodev-ai.github.io',
        })

    cache = {}
    locks = {}
    login_calls = deque()
    apikey_lock = asyncio.Lock()
    refresh = max(5, int(config.get('ALICEBLUE_REFRESH_SECONDS', '5')))

    from snapshot_store import SnapshotStore
    from alice_history import install_history, classify_expiries, market_status_ist
    from nse_archive_fallback import LocalNseArchive
    from parquet_1min_store import Parquet1MinStore, DEFAULT_PARQUET_ROOT

    snap_path = snapshot_db or config.get('ALICEBLUE_SNAPSHOT_DB_PATH') or str(Path(db).with_name('option-snapshots.sqlite3'))
    snapshots = SnapshotStore(snap_path)
    nse_archive = LocalNseArchive(allow_sync=local_owner_mode)
    resolved_parquet_root = (
        parquet_root
        or config.get('ALICEBLUE_PARQUET_1MIN_ROOT')
        or (DEFAULT_PARQUET_ROOT if (local_owner_mode and transport is None) else None)
    )
    parquet_store = Parquet1MinStore(resolved_parquet_root)

    # Automatically seed any server-configured .env session token so live & 1m chains load with zero UI prompts
    env_seed_token = (config.get('ALICEBLUE_SESSION_TOKEN') or '').strip()
    if local_owner_mode and env_seed_token:
        seed_ttl = session_seconds(env_seed_token)
        if seed_ttl > 0:
            store.put('owner-vault', {'ownerRecoveryToken': env_seed_token}, max(3600, seed_ttl))
            store.put('local-owner-active', {'token': env_seed_token}, seed_ttl)

    def session(req):
        sid = req.cookies.get(COOKIE)
        data = store.get(sid)
        if data and data.get('token'):
            return sid, data
        if local_owner_mode:
            env_tok = (config.get('ALICEBLUE_SESSION_TOKEN') or '').strip()
            if env_tok and session_seconds(env_tok) > 0:
                return sid or 'local-owner-active', {'token': env_tok}
            tok = store.latest_token()
            if tok:
                auto_sid = sid or 'local-owner-active'
                ttl = session_seconds(tok)
                if ttl > 0:
                    store.put(auto_sid, {'token': tok}, ttl)
                    return auto_sid, {'token': tok}
        raise HTTPException(401, 'Market data session unavailable')

    async def ensure_session_async(req):
        try:
            return session(req)
        except HTTPException:
            if not local_owner_mode:
                raise
            uid = config.get('ALICEBLUE_CLIENT_ID') or config.get('ALICEBLUE_USER_ID') or ''
            api_key = config.get('ALICEBLUE_API_KEY') or ''
            if not uid or not api_key:
                raise
            async with apikey_lock:
                tok = store.latest_token()
                if not tok:
                    tok = await exchange_direct_api_key(broker, uid, api_key)
                    ttl = session_seconds(tok)
                    store.put('owner-vault', {'ownerRecoveryToken': tok}, max(3600, ttl))
                ttl = max(60, session_seconds(tok))
                auto_sid = req.cookies.get(COOKIE) or secrets.token_urlsafe(32)
                store.put(auto_sid, {'token': tok}, ttl)
                return auto_sid, {'token': tok}

    @app.middleware('http')
    async def security(req, call_next):
        req_origin = req.headers.get('origin')
        is_public_file_probe = bool(
            local_owner_mode
            and req.method in ('GET', 'POST', 'OPTIONS')
            and req_origin == 'null'
            and (req.url.path in PUBLIC_GET_PATHS or req.url.path.startswith('/api/heatmap/'))
        )
        if req.method == 'OPTIONS' and (req_origin in allowed_origins or is_public_file_probe):
            resp = JSONResponse({}, 204)
            resp.headers['Access-Control-Allow-Origin'] = '*' if is_public_file_probe else req_origin
            resp.headers['Access-Control-Allow-Methods'] = 'GET, POST, OPTIONS'
            resp.headers['Access-Control-Allow-Headers'] = 'Content-Type'
            if not is_public_file_probe:
                resp.headers['Access-Control-Allow-Credentials'] = 'true'
            if local_owner_mode:
                resp.headers['Access-Control-Allow-Private-Network'] = 'true'
            return resp
        if req_origin not in (None, *allowed_origins) and not is_public_file_probe:
            return JSONResponse({'detail': 'Origin not allowed'}, 403)
        if req.method == 'POST' and req_origin not in allowed_origins and not ((req_origin in (None, 'null')) and req.url.path == '/api/heatmap/filters'):
            return JSONResponse({'detail': 'Same-origin request required'}, 403)
        try:
            r = await call_next(req)
        except Exception as exc:
            log_event('error', 'unhandled_backend_error', path=req.url.path, errorType=type(exc).__name__)
            return JSONResponse({'detail': 'Internal service error'}, 500)
        for k, v in {
            'Cache-Control': 'no-store',
            'Referrer-Policy': 'no-referrer',
            'X-Content-Type-Options': 'nosniff',
            'Content-Security-Policy': "default-src 'none'; frame-ancestors 'none'",
        }.items():
            r.headers[k] = v
        if is_public_file_probe:
            r.headers['Access-Control-Allow-Origin'] = '*'
        elif req_origin in allowed_origins and req_origin != origin:
            r.headers['Access-Control-Allow-Origin'] = req_origin
            r.headers['Access-Control-Allow-Credentials'] = 'true'
            r.headers['Vary'] = 'Origin'
        return r

    @app.exception_handler(RequestValidationError)
    async def validation(req, exc):
        return JSONResponse({'detail': 'Invalid request parameters'}, 422)

    @app.get(PREFIX + '/health')
    async def health():
        return {
            'service': 'iwsm-market-data',
            'ready': bool(
                config.get('ALICEBLUE_SESSION_TOKEN')
                or (config.get('ALICEBLUE_APP_CODE') and config.get('ALICEBLUE_API_SECRET'))
                or (config.get('ALICEBLUE_API_KEY') and (config.get('ALICEBLUE_CLIENT_ID') or config.get('ALICEBLUE_USER_ID')))
            ),
            'provider': config.get('IWSM_MARKET_DATA_PROVIDER') or 'hybrid',
            'websocket': 'not connected',
            'marketStatus': market_status_ist(),
        }

    @app.get(PREFIX + '/auth/status')
    async def status(req: Request):
        sid = req.cookies.get(COOKIE)
        data = store.get(sid)
        connected = bool(data and data.get('token'))
        if not connected and local_owner_mode:
            try:
                sid, data = await ensure_session_async(req)
                connected = bool(data and data.get('token'))
            except HTTPException:
                connected = False
        ttl = session_seconds(data['token']) if connected else 0
        if connected and not ttl:
            if sid:
                store.delete(sid)
            connected = False
        verified = False
        if connected:
            try:
                await broker.post('/obrest/optionChain/getUnderlying', {'exch': 'nse_fo'}, data['token'])
                verified = True
            except HTTPException as e:
                if e.status_code in (401, 403):
                    if sid:
                        store.delete(sid)
                    if local_owner_mode:
                        store.delete('local-owner-active')
                        store.delete('owner-vault')
                        config['ALICEBLUE_SESSION_TOKEN'] = ''
                    connected = False
                    if local_owner_mode and config.get('ALICEBLUE_API_KEY') and (config.get('ALICEBLUE_CLIENT_ID') or config.get('ALICEBLUE_USER_ID')):
                        try:
                            sid, data = await ensure_session_async(req)
                            ttl = session_seconds(data['token'])
                            connected = bool(ttl > 0)
                            verified = connected
                        except HTTPException:
                            connected = False
        if connected and sid:
            store.put(sid, data, ttl)
        r = JSONResponse({
            'connected': connected,
            'verified': verified,
            'refreshSeconds': refresh,
            'appConfigured': bool(config.get('ALICEBLUE_APP_CODE') and config.get('ALICEBLUE_API_SECRET')),
            'clientIdConfigured': bool(config.get('ALICEBLUE_CLIENT_ID') or config.get('ALICEBLUE_USER_ID')),
            'apiKeyConfigured': bool(config.get('ALICEBLUE_API_KEY')),
            'clientIdHint': (config.get('ALICEBLUE_CLIENT_ID') or config.get('ALICEBLUE_USER_ID') or '')[:2] + '***' if (config.get('ALICEBLUE_CLIENT_ID') or config.get('ALICEBLUE_USER_ID')) else '',
            'marketStatus': market_status_ist(),
        })
        if connected and sid:
            r.set_cookie(COOKIE, sid, max_age=ttl, httponly=True, secure=secure, samesite='lax', path=PREFIX)
        elif req.cookies.get(COOKIE):
            r.delete_cookie(COOKIE, path=PREFIX)
        return r

    @app.get(PREFIX + '/auth/restore')
    async def restore_local(req: Request):
        grant = req.query_params.get('grant', '')
        if not re.fullmatch(r'[A-Za-z0-9_-]{40,80}', grant):
            raise HTTPException(400, 'Invalid local recovery link')
        value = store.get(grant)
        if not value or not value.get('restoreToken'):
            raise HTTPException(400, 'Local recovery link expired or already used')
        store.delete(grant)
        token = value['restoreToken']
        ttl = session_seconds(token)
        if not ttl:
            raise HTTPException(401, 'Broker session expired; reconnect')
        await broker.post('/obrest/optionChain/getUnderlying', {'exch': 'nse_fo'}, token)
        sid = secrets.token_urlsafe(32)
        store.put(sid, {'token': token}, ttl)
        if local_owner_mode:
            store.put('owner-vault', {'ownerRecoveryToken': token}, ttl)
        r = RedirectResponse(origin + '/strategy-builder.html#options-simulator', 303)
        r.set_cookie(COOKIE, sid, max_age=ttl, httponly=True, secure=secure, samesite='lax', path=PREFIX)
        return r

    @app.post(PREFIX + '/auth/apikey')
    async def connect_apikey(req: Request):
        try:
            body = await req.json()
        except Exception:
            body = {}
        client_id = str(body.get('clientId') or config.get('ALICEBLUE_CLIENT_ID') or config.get('ALICEBLUE_USER_ID') or '').strip().upper()
        api_key = str(body.get('apiKey') or config.get('ALICEBLUE_API_KEY') or '').strip()
        if not client_id or not api_key:
            raise HTTPException(422, 'Enter your Alice Blue Client ID and API Key')
        token = await exchange_direct_api_key(broker, client_id, api_key)
        ttl = max(3600, session_seconds(token))
        sid = secrets.token_urlsafe(32)
        store.put(sid, {'token': token}, ttl)
        if local_owner_mode:
            store.put('owner-vault', {'ownerRecoveryToken': token}, ttl)
            config['ALICEBLUE_CLIENT_ID'] = client_id
            config['ALICEBLUE_API_KEY'] = api_key
            persist_local_env(env_path, {'ALICEBLUE_CLIENT_ID': client_id, 'ALICEBLUE_API_KEY': api_key})
        log_event('info', 'broker_apikey_session_established', ttlSeconds=ttl)
        r = JSONResponse({'connected': True, 'verified': True, 'mode': 'api_key', 'ttlSeconds': ttl})
        r.set_cookie(COOKIE, sid, max_age=ttl, httponly=True, secure=secure, samesite='lax', path=PREFIX)
        return r

    @app.post(PREFIX + '/auth/login')
    async def login(req: Request):
        now = time.monotonic()
        while login_calls and now - login_calls[0] > 60:
            login_calls.popleft()
        if len(login_calls) >= 10:
            raise HTTPException(429, 'Wait before reconnecting')
        login_calls.append(now)
        if not config.get('ALICEBLUE_APP_CODE') or not config.get('ALICEBLUE_API_SECRET'):
            raise HTTPException(503, 'Broker application is not configured')
        try:
            body = await req.json()
        except Exception:
            body = {}
        submitted_cid = str(body.get('clientId') or '').strip().upper() if isinstance(body, dict) else ''
        if submitted_cid and not re.fullmatch(r'[A-Za-z0-9_-]{2,40}', submitted_cid):
            raise HTTPException(422, 'Enter a valid alphanumeric Alice Blue Client ID')
        old = req.cookies.get(COOKIE)
        if old:
            store.delete(old)
        sid = secrets.token_urlsafe(32)
        nonce = secrets.token_urlsafe(32)
        req_origin = req.headers.get('origin')
        pending_payload = {'nonce': nonce}
        if submitted_cid:
            pending_payload['expectedUser'] = submitted_cid
        if req_origin in allowed_origins:
            pending_payload['returnOrigin'] = req_origin
        store.put(sid, pending_payload, 600)
        r = JSONResponse({
            'loginUrl': 'https://ant.aliceblueonline.com/?' + urlencode({'appcode': config['ALICEBLUE_APP_CODE'], 'state': nonce}),
            'callbackOrigin': origin,
        })
        r.set_cookie(COOKIE, sid, max_age=600, httponly=True, secure=secure, samesite='lax', path=PREFIX)
        return r

    @app.get(PREFIX + '/auth/callback')
    async def callback(req: Request):
        sid = req.cookies.get(COOKIE)
        pending = store.get(sid)
        if not pending or 'nonce' not in pending:
            raise HTTPException(400, 'Login initiation expired; start Connect Alice Blue from ' + origin)
        store.delete(sid)
        q = req.query_params
        code = q.get('authCode', '')
        user = q.get('userId', '').strip()
        state = q.get('state', '')
        if not code or len(code) > 8192 or not re.fullmatch(r'[A-Za-z0-9_-]{1,80}', user):
            raise HTTPException(400, 'Invalid broker callback')
        expected = (config.get('ALICEBLUE_CLIENT_ID') or pending.get('expectedUser') or '').strip()
        if state:
            if not secrets.compare_digest(state, pending['nonce']):
                raise HTTPException(400, 'Login state mismatch')
        elif not expected or not secrets.compare_digest(user.upper(), expected.upper()):
            raise HTTPException(400, 'Broker omitted state; enter your Alice Blue Client ID in the Connect dialog before reconnecting')
        if config.get('ALICEBLUE_CLIENT_ID') and user.upper() != config['ALICEBLUE_CLIENT_ID'].strip().upper():
            raise HTTPException(400, 'Unexpected broker account')
        result = await broker.post('/open-api/od/v1/vendor/getUserDetails', {'checkSum': checksum(user, code, config['ALICEBLUE_API_SECRET'])})
        if str(result.get('clientId', '')).upper() != user.upper() or not isinstance(result.get('userSession'), str) or not result['userSession']:
            raise HTTPException(502, 'Broker session validation failed')
        ttl = session_seconds(result['userSession'])
        if not ttl:
            raise HTTPException(401, 'Broker returned an expired session')
        fresh = secrets.token_urlsafe(32)
        store.put(fresh, {'token': result['userSession']}, ttl)
        if local_owner_mode:
            store.put('owner-vault', {'ownerRecoveryToken': result['userSession']}, ttl)
            config['ALICEBLUE_CLIENT_ID'] = user
            persist_local_env(env_path, {'ALICEBLUE_CLIENT_ID': user})
        log_event('info', 'broker_session_established', ttlSeconds=ttl)
        target_origin = pending.get('returnOrigin') if pending.get('returnOrigin') in allowed_origins else origin
        r = RedirectResponse(target_origin + '/strategy-builder.html#options-simulator', 303)
        r.set_cookie(COOKIE, fresh, max_age=ttl, httponly=True, secure=secure, samesite='lax', path=PREFIX)
        return r

    @app.post(PREFIX + '/auth/logout')
    async def logout(req: Request):
        sid = req.cookies.get(COOKIE)
        if sid:
            store.delete(sid)
        if local_owner_mode:
            store.delete('owner-vault')
            store.delete('local-owner-active')
        r = JSONResponse({'connected': False})
        r.delete_cookie(COOKIE, path=PREFIX)
        return r

    async def market(req, kind, exch, underlying='', expiry='', interval=10):
        if exch not in EXCHANGES or not re.fullmatch(r'[A-Z0-9&._ -]{0,50}', underlying) or len(expiry) > 30 or interval not in (5, 10, 15, 20, 25):
            raise HTTPException(422, 'Invalid market selection')
        sid, data = await ensure_session_async(req)
        key = (hashlib.sha256(data['token'].encode()).hexdigest(), kind, exch, underlying, expiry, interval)
        if len(locks) > 1024:
            raise HTTPException(429, 'Too many selections; reconnect later')
        async with locks.setdefault(key, asyncio.Lock()):
            old = cache.get(key)
            ttl_sec = 1800 if kind in ('underlyings', 'expiries') else refresh
            if old and time.monotonic() - old[0] < ttl_sec:
                return {**old[1], 'cached': True}
            if kind != 'underlyings':
                available = await market(req, 'underlyings', exch)
                if underlying not in available['underlyings']:
                    raise HTTPException(422, 'Select a broker-listed underlying')
            if kind == 'option-chain':
                available = await market(req, 'expiries', exch, underlying)
                if expiry not in available['expiries']:
                    raise HTTPException(422, 'Select a broker-listed expiry')
            body = {'exch': exch}
            if kind != 'underlyings':
                body['underlying'] = underlying
            if kind == 'option-chain':
                body.update(expiry=expiry, interval=interval)
            try:
                result = await broker.post('/obrest/optionChain/' + ROUTES[kind], body, data['token'])
            except HTTPException as e:
                if e.status_code == 401:
                    if sid:
                        store.delete(sid)
                    store.delete('local-owner-active')
                    store.delete('owner-vault')
                    config['ALICEBLUE_SESSION_TOKEN'] = ''
                raise
            groups = result.get('result')
            if not isinstance(groups, list):
                raise HTTPException(502, 'Invalid market-data result format')
            out = {
                'success': True,
                'receivedAt': datetime.now(timezone.utc).isoformat(),
                'marketStatus': market_status_ist(),
                'source': 'IWSM Live Exchange Snapshot',
                'refreshSeconds': refresh,
                'cached': False,
            }
            if kind == 'underlyings':
                out['underlyings'] = sorted(set(v for g in groups for v in g.get('list_underlying', []) if isinstance(v, str)))
            elif kind == 'expiries':
                exps = list(dict.fromkeys(v for g in groups if g.get('underlying') == underlying for v in g.get('underlying_expiry', []) if isinstance(v, str)))
                out['expiries'] = exps
                out['expiryDetails'] = classify_expiries(exps)
            else:
                out.update(normalize(result, underlying, expiry, exch))
            cache[key] = (time.monotonic(), out)
            return out

    @app.get(PREFIX + '/underlyings')
    async def underlyings(req: Request, exch: str = 'nse_fo'):
        return await market(req, 'underlyings', exch)

    def _sort_broker_expiries(codes, min_start_iso: str = '') -> list:
        by_iso = {}
        for raw in codes or []:
            try:
                iso = normalize_expiry_iso(raw)
                if min_start_iso and re.fullmatch(r'\d{4}-\d{2}-\d{2}', min_start_iso) and iso < min_start_iso:
                    continue
                if iso not in by_iso:
                    by_iso[iso] = raw if re.fullmatch(r'\d{2}[A-Z]{3}\d{2}', str(raw).upper()) else iso_to_broker_expiry(iso)
            except ValueError:
                continue
        return [by_iso[k] for k in sorted(by_iso)]

    @app.get(PREFIX + '/expiries')
    async def expiries(req: Request, underlying: str, exch: str = 'nse_fo', start: str = '', end: str = ''):
        from nifty_backup import NiftyBackup

        local = []
        nifty_min_exps = []
        snap_exps = []
        snap_min_exps = []
        parquet_exps = []
        nse_exps = []
        try:
            snap_exps = snapshots.expiries(underlying, exch, start, end)
            snap_min_exps = snapshots.minute_expiries(underlying, exch, start, end)
        except (ValueError, OSError, sqlite3.Error):
            snap_exps = []
            snap_min_exps = []
        if parquet_store.supports(underlying, exch) and (start or end):
            try:
                parquet_exps = await asyncio.to_thread(parquet_store.expiries, underlying, exch, start, end)
            except (ValueError, OSError):
                parquet_exps = []
        if underlying == 'NIFTY' and exch == 'nse_fo':
            try:
                nb = NiftyBackup()
                nifty_min_exps = nb.minute_expiries(start, end)
                if not parquet_exps:
                    local = nb.expiries(start, end)
            except (ValueError, OSError, sqlite3.Error):
                pass
        if not local and not parquet_exps and exch == 'nse_fo' and nse_archive.available():
            try:
                nse_exps = await asyncio.to_thread(nse_archive.expiries, underlying, start, end)
            except (ValueError, OSError, sqlite3.Error):
                nse_exps = []

        minute_exps = _sort_broker_expiries([*snap_min_exps, *parquet_exps, *nifty_min_exps], start)
        has_minute_hist = bool(minute_exps or snap_exps)
        combined_local = _sort_broker_expiries([*snap_exps, *parquet_exps, *nifty_min_exps, *local, *nse_exps], start)
        today_ist = market_status_ist()['dateIST']
        pub_exps = []
        if not start or start >= today_ist or not combined_local:
            try:
                pub_exps = await app.state.public_expiries(underlying, exch, start)
            except Exception:
                pub_exps = []
        else:
            try:
                days_ago = (datetime.strptime(today_ist, '%Y-%m-%d').date() - datetime.strptime(start, '%Y-%m-%d').date()).days
            except ValueError:
                days_ago = 999
            if 0 <= days_ago <= 6:
                try:
                    pub_exps = await app.state.public_expiries(underlying, exch, start)
                except Exception:
                    pub_exps = []

        if combined_local and start and start < today_ist and not pub_exps:
            src_label = (
                f'Verified 1-Minute Historical Options Archive ({underlying})'
                if parquet_exps
                else (
                    'Recorded 1-minute & snapshot option-chain archive'
                    if has_minute_hist
                    else ('Local NIFTY 5-year historical archive' if local else f'Local verified NSE archive ({underlying})')
                )
            )
            return {
                'expiries': combined_local,
                'minuteExpiries': minute_exps,
                'expiryDetails': classify_expiries(combined_local, start),
                'backup': True,
                'historicalOnly': not has_minute_hist,
                'parquetMinuteAvailable': has_minute_hist,
                'dataSourceStatus': 'HISTORICAL',
                'marketStatus': market_status_ist(),
                'source': src_label,
            }

        if str(config.get('IWSM_MARKET_DATA_PROVIDER') or 'hybrid').strip().lower() == 'nse' and exch == 'nse_fo' and hasattr(app.state, 'nse_live'):
            try:
                nse_live_exps = await app.state.nse_live.fetch_expiries(underlying)
                if nse_live_exps:
                    merged_nse = (
                        _sort_broker_expiries([*nse_live_exps, *combined_local], start)
                        if (start and start < today_ist and combined_local)
                        else _sort_broker_expiries(nse_live_exps, start)
                    )
                    return {
                        'expiries': merged_nse,
                        'minuteExpiries': _sort_broker_expiries([*nse_live_exps, *minute_exps], start),
                        'parquetMinuteAvailable': True,
                        'expiryDetails': classify_expiries(merged_nse, start),
                        'marketStatus': market_status_ist(),
                        'source': 'NSE Live Option Chain',
                    }
            except HTTPException:
                pass

        try:
            result = await market(req, 'expiries', exch, underlying)
            live_list = result.get('expiries', [])
            if start and start < today_ist and combined_local:
                merged = _sort_broker_expiries([*live_list, *combined_local], start)
                return {
                    **result,
                    'expiries': merged,
                    'minuteExpiries': _sort_broker_expiries([*live_list, *minute_exps], start),
                    'parquetMinuteAvailable': True,
                    'expiryDetails': classify_expiries(merged, start),
                }
            sorted_live = _sort_broker_expiries(live_list, start) if start else live_list
            if start:
                result = {
                    **result,
                    'expiries': sorted_live,
                    'minuteExpiries': _sort_broker_expiries([*sorted_live, *minute_exps], start),
                    'parquetMinuteAvailable': True,
                    'expiryDetails': classify_expiries(sorted_live, start),
                }
            return result
        except HTTPException as e:
            if e.status_code in (401, 403, 429, 502, 503, 504):
                fallback_list = _sort_broker_expiries([*pub_exps, *combined_local], start)
                if fallback_list:
                    return {
                        'expiries': fallback_list,
                        'minuteExpiries': _sort_broker_expiries([*pub_exps, *minute_exps], start),
                        'parquetMinuteAvailable': bool(pub_exps or has_minute_hist),
                        'expiryDetails': classify_expiries(fallback_list, start),
                        'backup': not bool(pub_exps),
                        'publicMaster': bool(pub_exps),
                        'marketStatus': market_status_ist(),
                        'source': (
                            'Exchange Contract Directory'
                            if pub_exps
                            else ('Recorded 1-minute & snapshot archive' if has_minute_hist else f'Local verified NSE archive ({underlying})')
                        ),
                    }
            raise

    @app.get(PREFIX + '/option-chain')
    async def chain(req: Request, underlying: str, expiry: str, interval: int = 10, exch: str = 'nse_fo'):
        return await market(req, 'option-chain', exch, underlying, expiry, interval)

    app.state.store = store
    app.state.broker = broker
    app.state.config = config
    app.state.nse_archive = nse_archive
    app.state.parquet_store = parquet_store
    app.state.local_owner_mode = local_owner_mode
    install_history(
        app,
        ensure_session_async,
        broker,
        market,
        PREFIX,
        snapshots=snapshots,
        nse_archive=nse_archive,
        parquet_store=parquet_store,
    )
    try:
        import sys as _sys
        _root_dir = str(Path(__file__).resolve().parent.parent.parent)
        if _root_dir not in _sys.path:
            _sys.path.insert(0, _root_dir)
        from backend.heatmap.heatmap_router import install_heatmap
        install_heatmap(app, db_path=str(Path(db).with_name('heatmap-store.sqlite3')), transport=transport)
    except Exception as _hm_exc:
        log_event('warning', 'heatmap_init_skipped', error=str(_hm_exc))
    log_event(
        'info',
        'market_data_service_initialized',
        appConfigured=bool(config.get('ALICEBLUE_APP_CODE') and config.get('ALICEBLUE_API_SECRET')),
        clientIdConfigured=bool(config.get('ALICEBLUE_CLIENT_ID') or config.get('ALICEBLUE_USER_ID')),
        apiKeyConfigured=bool(config.get('ALICEBLUE_API_KEY')),
        sessionTokenConfigured=bool(config.get('ALICEBLUE_SESSION_TOKEN')),
        localOwnerMode=local_owner_mode,
        redirectOrigin=origin,
        refreshSeconds=refresh,
    )
    return app


def ensure_session_key(folder, config):
    key = config.get('ALICEBLUE_SESSION_ENCRYPTION_KEY')
    if key:
        return key
    path = folder / 'aliceblue-session.key'
    path.parent.mkdir(parents=True, exist_ok=True)
    try:
        stored = path.read_text(encoding='utf-8').strip()
        if stored:
            return stored
    except OSError:
        pass
    key = Fernet.generate_key().decode()
    path.write_text(key + '\n', encoding='utf-8')
    return key


def build():
    here = Path(__file__).resolve().parent
    root = here.parent.parent
    folder = Path(os.environ['LOCALAPPDATA']) / 'IWSM'
    folder.mkdir(parents=True, exist_ok=True)
    env_file = here / '.env'
    config = settings([folder / 'aliceblue.env', root / '.env', env_file])
    config['ALICEBLUE_SESSION_ENCRYPTION_KEY'] = ensure_session_key(folder, config)
    if not config.get('ALICEBLUE_REDIRECT_URL'):
        config['ALICEBLUE_REDIRECT_URL'] = 'http://127.0.0.1:4174' + PREFIX + '/auth/callback'
    app = create_app(
        config,
        str(folder / 'aliceblue-sessions.sqlite3'),
        snapshot_db=config.get('ALICEBLUE_SNAPSHOT_DB_PATH') or str(folder / 'option-snapshots.sqlite3'),
        local_owner_mode=True,
        env_path=str(env_file),
    )
    app.state.enable_prewarm = True
    return app


if __name__ == '__main__':
    import uvicorn

    uvicorn.run(build(), host='127.0.0.1', port=4180, access_log=False, log_level='warning')

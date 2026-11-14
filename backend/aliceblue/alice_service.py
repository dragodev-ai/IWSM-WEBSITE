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

BASE = 'https://a3.aliceblueonline.com'
EXCHANGES = {'nse_fo', 'bse_fo', 'mcx_fo'}
ROUTES = {'underlyings': 'getUnderlying', 'expiries': 'getUnderlyingExp', 'option-chain': 'getOptionChain'}
COOKIE = 'iwsm_alice'
PREFIX = '/api/aliceblue'
SENSITIVE_KEY_RE = re.compile(r'(token|secret|auth|cookie|key|checksum|grant|session|password)', re.IGNORECASE)

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
    """Use provider expiry only as a cache upper bound, never as an auth claim.

    Tokens originate in a validated TLS broker response. Every market request
    is still authenticated by the broker, including revocation. Opaque tokens
    retain the conservative fallback rather than assuming unlimited validity.
    """
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
    try:
        lines = Path(file).read_text(encoding='utf-8-sig').splitlines()
    except OSError:
        lines = []
    for line in lines:
        if '=' in line and not line.lstrip().startswith('#'):
            k, v = line.split('=', 1)
            values[k.strip()] = v.strip().strip('"\'')
    for env_k in (
        'ALICEBLUE_APP_CODE',
        'ALICEBLUE_API_SECRET',
        'ALICEBLUE_REDIRECT_URL',
        'ALICEBLUE_CLIENT_ID',
        'ALICEBLUE_SESSION_ENCRYPTION_KEY',
        'ALICEBLUE_BASE_URL',
        'ALICEBLUE_DEFAULT_EXCHANGE',
        'ALICEBLUE_REFRESH_SECONDS',
        'ALICEBLUE_SNAPSHOT_DB_PATH',
    ):
        if os.getenv(env_k):
            values[env_k] = os.environ[env_k]
    for k in list(values):
        if os.getenv(k):
            values[k] = os.environ[k]
    return values


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
                # Only the documented exact underlying+expiry+C/P+strike format.
                m = re.fullmatch(re.escape(underlying + expiry) + ('C' if side == 'CE' else 'P') + r'(\d+(?:\.\d+)?)', symbol)
                if not m and exchange == 'bse_fo':
                    # Verified BSE weekly/monthly symbols; bind prefix to selected expiry.
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
                tok = payload.get('token')
                if isinstance(tok, str) and tok:
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
        self.http = httpx.AsyncClient(base_url=base_url or BASE, timeout=httpx.Timeout(12), follow_redirects=False, transport=transport)
        self.calls = deque()
        self.lock = asyncio.Lock()
        self.pause = 0

    async def post(self, path, body, token=None):
        async with self.lock:
            now = time.monotonic()
            while self.calls and now - self.calls[0] > 3600:
                self.calls.popleft()
            if now < self.pause or len(self.calls) >= 2400 or sum(now - x < 60 for x in self.calls) >= 240:
                raise HTTPException(429, 'Market-data request limit reached; wait before refreshing')
            if self.calls and now - self.calls[-1] < 0.26:
                await asyncio.sleep(0.26 - (now - self.calls[-1]))
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
            raise HTTPException(502, 'Broker rejected the request; check session and API permissions')
        return data


def create_app(config, db, transport=None, snapshot_db=None):
    validate_config(config)
    app = FastAPI(docs_url=None, redoc_url=None, openapi_url=None)
    store = Store(db, config['ALICEBLUE_SESSION_ENCRYPTION_KEY'])
    broker = Broker(transport, base_url=config.get('ALICEBLUE_BASE_URL') or BASE)
    redirect = config['ALICEBLUE_REDIRECT_URL']
    parsed = urlsplit(redirect)
    origin = parsed.scheme + '://' + parsed.netloc
    secure = parsed.scheme == 'https'
    cache = {}
    locks = {}
    login_calls = deque()
    refresh = max(5, int(config.get('ALICEBLUE_REFRESH_SECONDS', '5')))

    from snapshot_store import SnapshotStore
    from alice_history import install_history, classify_expiries, market_status_ist

    snap_path = snapshot_db or config.get('ALICEBLUE_SNAPSHOT_DB_PATH') or str(Path(db).with_name('option-snapshots.sqlite3'))
    snapshots = SnapshotStore(snap_path)

    def session(req):
        sid = req.cookies.get(COOKIE)
        data = store.get(sid)
        if not data or not data.get('token'):
            raise HTTPException(401, 'Connect your Alice Blue account')
        return sid, data

    @app.middleware('http')
    async def security(req, call_next):
        if req.headers.get('origin') not in (None, origin):
            return JSONResponse({'detail': 'Origin not allowed'}, 403)
        if req.method == 'POST' and req.headers.get('origin') != origin:
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
        return r

    @app.exception_handler(RequestValidationError)
    async def validation(req, exc):
        return JSONResponse({'detail': 'Invalid request parameters'}, 422)

    @app.get(PREFIX + '/health')
    async def health():
        return {
            'service': 'aliceblue-read-only',
            'ready': bool(config.get('ALICEBLUE_APP_CODE') and config.get('ALICEBLUE_API_SECRET')),
            'websocket': 'not connected',
            'marketStatus': market_status_ist(),
        }

    @app.get(PREFIX + '/auth/status')
    async def status(req: Request):
        sid = req.cookies.get(COOKIE)
        data = store.get(sid)
        connected = bool(data and data.get('token'))
        ttl = session_seconds(data['token']) if connected else 0
        if connected and not ttl:
            store.delete(sid)
            connected = False
        verified = False
        if connected:
            try:
                await broker.post('/obrest/optionChain/getUnderlying', {'exch': 'nse_fo'}, data['token'])
                verified = True
            except HTTPException as e:
                if e.status_code in (401, 403):
                    store.delete(sid)
                    connected = False
        if connected:
            store.put(sid, data, ttl)
        r = JSONResponse({
            'connected': connected,
            'verified': verified,
            'refreshSeconds': refresh,
            'marketStatus': market_status_ist(),
        })
        if connected:
            r.set_cookie(COOKIE, sid, max_age=ttl, httponly=True, secure=secure, samesite='lax', path=PREFIX)
        elif sid:
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
        r = RedirectResponse(origin + '/strategy-builder.html#options-simulator', 303)
        r.set_cookie(COOKIE, sid, max_age=ttl, httponly=True, secure=secure, samesite='lax', path=PREFIX)
        return r

    @app.post(PREFIX + '/auth/login')
    async def login(req: Request):
        now = time.monotonic()
        while login_calls and now - login_calls[0] > 60:
            login_calls.popleft()
        if len(login_calls) >= 6:
            raise HTTPException(429, 'Wait before reconnecting')
        login_calls.append(now)
        if not config.get('ALICEBLUE_APP_CODE') or not config.get('ALICEBLUE_API_SECRET'):
            raise HTTPException(503, 'Broker application is not configured')
        old = req.cookies.get(COOKIE)
        if old:
            store.delete(old)
        sid = secrets.token_urlsafe(32)
        nonce = secrets.token_urlsafe(32)
        store.put(sid, {'nonce': nonce}, 300)
        r = JSONResponse({'loginUrl': 'https://ant.aliceblueonline.com/?' + urlencode({'appcode': config['ALICEBLUE_APP_CODE'], 'state': nonce})})
        r.set_cookie(COOKIE, sid, max_age=300, httponly=True, secure=secure, samesite='lax', path=PREFIX)
        return r

    @app.get(PREFIX + '/auth/callback')
    async def callback(req: Request):
        sid = req.cookies.get(COOKIE)
        pending = store.get(sid)
        if not pending or 'nonce' not in pending:
            raise HTTPException(400, 'Login initiation expired; reconnect from the website')
        store.delete(sid)  # consume before any exchange, including failure
        q = req.query_params
        code = q.get('authCode', '')
        user = q.get('userId', '')
        state = q.get('state', '')
        if not code or len(code) > 8192 or not re.fullmatch(r'[A-Za-z0-9_-]{1,80}', user):
            raise HTTPException(400, 'Invalid broker callback')
        expected = config.get('ALICEBLUE_CLIENT_ID', '')
        if state:
            if not secrets.compare_digest(state, pending['nonce']):
                raise HTTPException(400, 'Login state mismatch')
        elif not expected or not secrets.compare_digest(user, expected):
            raise HTTPException(400, 'Broker omitted state; configure your expected ALICEBLUE_CLIENT_ID before reconnecting')
        if expected and user != expected:
            raise HTTPException(400, 'Unexpected broker account')
        result = await broker.post('/open-api/od/v1/vendor/getUserDetails', {'checkSum': checksum(user, code, config['ALICEBLUE_API_SECRET'])})
        if str(result.get('clientId', '')) != user or not isinstance(result.get('userSession'), str) or not result['userSession']:
            raise HTTPException(502, 'Broker session validation failed')
        ttl = session_seconds(result['userSession'])
        if not ttl:
            raise HTTPException(401, 'Broker returned an expired session')
        fresh = secrets.token_urlsafe(32)
        store.put(fresh, {'token': result['userSession']}, ttl)
        log_event('info', 'broker_session_established', ttlSeconds=ttl)
        r = RedirectResponse(origin + '/strategy-builder.html#options-simulator', 303)
        r.set_cookie(COOKIE, fresh, max_age=ttl, httponly=True, secure=secure, samesite='lax', path=PREFIX)
        return r

    @app.post(PREFIX + '/auth/logout')
    async def logout(req: Request):
        sid = req.cookies.get(COOKIE)
        if sid:
            store.delete(sid)
        r = JSONResponse({'connected': False})
        r.delete_cookie(COOKIE, path=PREFIX)
        return r

    async def market(req, kind, exch, underlying='', expiry='', interval=10):
        if exch not in EXCHANGES or not re.fullmatch(r'[A-Z0-9&._ -]{0,50}', underlying) or len(expiry) > 30 or interval not in (5, 10, 15, 20, 25):
            raise HTTPException(422, 'Invalid market selection')
        sid, data = session(req)
        key = (hashlib.sha256(data['token'].encode()).hexdigest(), kind, exch, underlying, expiry, interval)
        if len(locks) > 1024:
            raise HTTPException(429, 'Too many selections; reconnect later')
        async with locks.setdefault(key, asyncio.Lock()):
            old = cache.get(key)
            if old and time.monotonic() - old[0] < refresh:
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
                    store.delete(sid)
                raise
            groups = result.get('result')
            if not isinstance(groups, list):
                raise HTTPException(502, 'Invalid broker result format')
            out = {
                'success': True,
                'receivedAt': datetime.now(timezone.utc).isoformat(),
                'marketStatus': market_status_ist(),
                'source': 'Alice Blue REST snapshot',
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

    @app.get(PREFIX + '/expiries')
    async def expiries(req: Request, underlying: str, exch: str = 'nse_fo', start: str = '', end: str = ''):
        from nifty_backup import NiftyBackup

        local = []
        snap_exps = []
        try:
            snap_exps = snapshots.expiries(underlying, exch, start, end)
        except (ValueError, OSError, sqlite3.Error):
            snap_exps = []
        if underlying == 'NIFTY' and exch == 'nse_fo':
            try:
                local = NiftyBackup().expiries(start, end)
            except (ValueError, OSError, sqlite3.Error):
                pass
        combined_local = list(dict.fromkeys([*snap_exps, *local]))
        today_ist = market_status_ist()['dateIST']
        if combined_local and start and start < today_ist:
            return {
                'expiries': combined_local,
                'expiryDetails': classify_expiries(combined_local, start),
                'backup': True,
                'marketStatus': market_status_ist(),
                'source': 'Recorded snapshots & local NIFTY backup expiry list' if snap_exps else 'Local NIFTY daily backup expiry list',
            }
        try:
            result = await market(req, 'expiries', exch, underlying)
            if start:
                result = {**result, 'expiryDetails': classify_expiries(result.get('expiries', []), start)}
            return result
        except HTTPException as e:
            if combined_local and e.status_code in (401, 403, 429, 502, 503, 504):
                return {
                    'expiries': combined_local,
                    'expiryDetails': classify_expiries(combined_local, start),
                    'backup': True,
                    'marketStatus': market_status_ist(),
                    'source': 'Recorded snapshots & local NIFTY backup expiry list' if snap_exps else 'Local NIFTY daily backup expiry list',
                }
            raise

    @app.get(PREFIX + '/option-chain')
    async def chain(req: Request, underlying: str, expiry: str, interval: int = 10, exch: str = 'nse_fo'):
        return await market(req, 'option-chain', exch, underlying, expiry, interval)

    app.state.store = store
    app.state.broker = broker
    install_history(app, session, broker, market, PREFIX, snapshots=snapshots)
    log_event(
        'info',
        'aliceblue_service_initialized',
        appConfigured=bool(config.get('ALICEBLUE_APP_CODE') and config.get('ALICEBLUE_API_SECRET')),
        clientIdConfigured=bool(config.get('ALICEBLUE_CLIENT_ID')),
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
    folder = Path(os.environ['LOCALAPPDATA']) / 'IWSM'
    folder.mkdir(parents=True, exist_ok=True)
    config = settings(folder / 'aliceblue.env')
    config['ALICEBLUE_SESSION_ENCRYPTION_KEY'] = ensure_session_key(folder, config)
    if not config.get('ALICEBLUE_REDIRECT_URL'):
        config['ALICEBLUE_REDIRECT_URL'] = 'http://127.0.0.1:4174' + PREFIX + '/auth/callback'
    return create_app(
        config,
        str(folder / 'aliceblue-sessions.sqlite3'),
        snapshot_db=config.get('ALICEBLUE_SNAPSHOT_DB_PATH') or str(folder / 'option-snapshots.sqlite3'),
    )


if __name__ == '__main__':
    import uvicorn

    uvicorn.run(build(), host='127.0.0.1', port=4180, access_log=False, log_level='warning')

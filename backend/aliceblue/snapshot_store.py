"""SQLite historical option-chain snapshot recorder & deterministic replay store.

Implements Instruction 6.D:
- Captures genuine timestamped option-chain snapshots (CE/PE LTP, bid, ask, OI,
  prevOI, oiChange, volume, IV, analytical Greeks) alongside underlying spot,
  futures price, and India VIX.
- Never fabricates historical option prices or substitutes live quotes for past dates.
- Exposes earliest available historical data date and explicit coverage warnings.
"""
import gzip, json, math, re, sqlite3, time
from contextlib import closing
from datetime import datetime, timedelta, timezone
from pathlib import Path

IST = timezone(timedelta(hours=5, minutes=30))
RISK_FREE_RATE = 0.065  # Documented assumption: 6.50% annualized INR risk-free rate, ACT/365


def _norm_cdf(x: float) -> float:
    return 0.5 * (1.0 + math.erf(x / math.sqrt(2.0)))


def _norm_pdf(x: float) -> float:
    return math.exp(-0.5 * x * x) / math.sqrt(2.0 * math.pi)


def _bsm_price_and_greeks(forward_or_spot: float, strike: float, t_years: float, sigma: float, option_type: str, r: float = RISK_FREE_RATE, is_futures_basis: bool = True):
    """Black-76 (when futures/forward reference used) or BSM (when cash spot used, q=0)."""
    if forward_or_spot <= 0 or strike <= 0 or t_years <= 0 or sigma <= 0:
        intrinsic = max(0.0, forward_or_spot - strike) if option_type == 'CE' else max(0.0, strike - forward_or_spot)
        delta = (1.0 if forward_or_spot > strike else 0.0) if option_type == 'CE' else (-1.0 if forward_or_spot < strike else 0.0)
        return intrinsic, delta, 0.0, 0.0, 0.0, 0.0

    sqrt_t = math.sqrt(t_years)
    df = math.exp(-r * t_years)
    fwd = forward_or_spot if is_futures_basis else forward_or_spot * math.exp(r * t_years)
    d1 = (math.log(fwd / strike) + 0.5 * sigma * sigma * t_years) / (sigma * sqrt_t)
    d2 = d1 - sigma * sqrt_t
    nd1 = _norm_pdf(d1)

    if option_type == 'CE':
        price = df * (fwd * _norm_cdf(d1) - strike * _norm_cdf(d2))
        delta = (df * _norm_cdf(d1)) if is_futures_basis else _norm_cdf(d1)
        theta_annual = (
            -df * (fwd * nd1 * sigma) / (2.0 * sqrt_t)
            + (r * price if is_futures_basis else -r * strike * df * _norm_cdf(d2))
        )
        rho = (-t_years * price / 100.0) if is_futures_basis else (strike * t_years * df * _norm_cdf(d2) / 100.0)
    else:
        price = df * (strike * _norm_cdf(-d2) - fwd * _norm_cdf(-d1))
        delta = (-df * _norm_cdf(-d1)) if is_futures_basis else (_norm_cdf(d1) - 1.0)
        theta_annual = (
            -df * (fwd * nd1 * sigma) / (2.0 * sqrt_t)
            + (r * price if is_futures_basis else r * strike * df * _norm_cdf(-d2))
        )
        rho = (-t_years * price / 100.0) if is_futures_basis else (-strike * t_years * df * _norm_cdf(-d2) / 100.0)

    spot_equiv = forward_or_spot
    gamma = (df * nd1 / (fwd * sigma * sqrt_t)) if is_futures_basis else (nd1 / (spot_equiv * sigma * sqrt_t))
    vega = df * fwd * nd1 * sqrt_t / 100.0  # per 1% IV change
    theta_daily = theta_annual / 365.0
    return price, delta, gamma, theta_daily, vega, rho


def solve_iv_and_greeks(market_price, underlying_price, strike, t_years, option_type, is_futures_basis=True):
    """Safeguarded bisection + Newton-Raphson IV solver on [0.01%, 500%]."""
    if market_price is None or underlying_price is None or market_price <= 0 or underlying_price <= 0 or strike <= 0 or t_years <= 1e-6:
        return None
    df = math.exp(-RISK_FREE_RATE * t_years)
    fwd = underlying_price if is_futures_basis else underlying_price * math.exp(RISK_FREE_RATE * t_years)
    intrinsic = df * max(0.0, (fwd - strike) if option_type == 'CE' else (strike - fwd))
    if market_price <= intrinsic + 1e-6:
        return None

    lo, hi = 0.001, 5.0
    p_lo = _bsm_price_and_greeks(underlying_price, strike, t_years, lo, option_type, RISK_FREE_RATE, is_futures_basis)[0]
    p_hi = _bsm_price_and_greeks(underlying_price, strike, t_years, hi, option_type, RISK_FREE_RATE, is_futures_basis)[0]
    if market_price < p_lo or market_price > p_hi:
        return None

    sigma = 0.20
    for _ in range(40):
        price, delta, gamma, theta, vega, rho = _bsm_price_and_greeks(
            underlying_price, strike, t_years, sigma, option_type, RISK_FREE_RATE, is_futures_basis
        )
        diff = price - market_price
        if abs(diff) < 1e-4:
            return round(sigma * 100.0, 2), round(delta, 4), round(gamma, 6), round(theta, 4), round(vega, 4), round(rho, 4)
        if diff > 0:
            hi = sigma
        else:
            lo = sigma
        vega_raw = vega * 100.0
        if vega_raw > 1e-6:
            cand = sigma - diff / vega_raw
            sigma = cand if lo < cand < hi else 0.5 * (lo + hi)
        else:
            sigma = 0.5 * (lo + hi)

    _, delta, gamma, theta, vega, rho = _bsm_price_and_greeks(
        underlying_price, strike, t_years, sigma, option_type, RISK_FREE_RATE, is_futures_basis
    )
    return round(sigma * 100.0, 2), round(delta, 4), round(gamma, 6), round(theta, 4), round(vega, 4), round(rho, 4)


def normalize_expiry_iso(expiry: str) -> str:
    s = str(expiry or '').strip().upper()
    if re.fullmatch(r'\d{4}-\d{2}-\d{2}', s):
        return s
    for fmt in ('%d%b%y', '%d%b%Y', '%d-%b-%Y'):
        try:
            return datetime.strptime(s, fmt).strftime('%Y-%m-%d')
        except ValueError:
            continue
    raise ValueError(f'Invalid expiry format: {expiry}')


def iso_to_broker_expiry(iso_date: str) -> str:
    return datetime.strptime(iso_date, '%Y-%m-%d').strftime('%d%b%y').upper()


def _finite(val):
    try:
        f = float(val)
        return f if math.isfinite(f) else None
    except (TypeError, ValueError):
        return None


class SnapshotStore:
    def __init__(self, path=None):
        if path is None:
            import os
            base = Path(os.environ.get('LOCALAPPDATA', str(Path.home()))) / 'IWSM'
            path = base / 'option-snapshots.sqlite3'
        self.path = Path(path)
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self._init_db()

    def _connect(self):
        conn = sqlite3.connect(str(self.path), timeout=15.0)
        conn.row_factory = sqlite3.Row
        conn.execute('PRAGMA journal_mode=WAL')
        conn.execute('PRAGMA foreign_keys=ON')
        conn.execute('PRAGMA synchronous=NORMAL')
        return conn

    def _init_db(self):
        with closing(self._connect()) as conn:
            conn.executescript(
                """
                CREATE TABLE IF NOT EXISTS snapshot_frames (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    symbol TEXT NOT NULL,
                    exchange TEXT NOT NULL,
                    expiry TEXT NOT NULL,
                    expiry_code TEXT NOT NULL DEFAULT '',
                    timestamp TEXT NOT NULL,
                    captured_at TEXT NOT NULL,
                    spot REAL,
                    futures_price REAL,
                    futures_expiry TEXT,
                    india_vix REAL,
                    lot_size INTEGER NOT NULL CHECK(lot_size > 0),
                    source TEXT NOT NULL,
                    UNIQUE(symbol, exchange, expiry, timestamp)
                );

                CREATE TABLE IF NOT EXISTS snapshot_contracts (
                    frame_id INTEGER NOT NULL REFERENCES snapshot_frames(id) ON DELETE CASCADE,
                    strike REAL NOT NULL CHECK(strike >= 0),
                    option_type TEXT NOT NULL CHECK(option_type IN ('CE', 'PE')),
                    trading_symbol TEXT NOT NULL DEFAULT '',
                    token TEXT NOT NULL DEFAULT '',
                    ltp REAL CHECK(ltp IS NULL OR ltp >= 0),
                    bid REAL CHECK(bid IS NULL OR bid >= 0),
                    ask REAL CHECK(ask IS NULL OR ask >= 0),
                    oi REAL,
                    prev_oi REAL,
                    oi_change REAL,
                    volume REAL,
                    iv REAL,
                    delta REAL,
                    gamma REAL,
                    theta REAL,
                    vega REAL,
                    rho REAL,
                    PRIMARY KEY(frame_id, strike, option_type)
                );

                CREATE INDEX IF NOT EXISTS idx_snapshot_frames_lookup
                    ON snapshot_frames(symbol, exchange, expiry, timestamp);
                CREATE INDEX IF NOT EXISTS idx_snapshot_frames_symbol_time
                    ON snapshot_frames(symbol, exchange, timestamp);

                CREATE TABLE IF NOT EXISTS minute_captures (
                    symbol TEXT NOT NULL,
                    exchange TEXT NOT NULL,
                    expiry TEXT NOT NULL,
                    start_date TEXT NOT NULL,
                    end_date TEXT NOT NULL,
                    saved_at REAL NOT NULL,
                    payload BLOB NOT NULL,
                    PRIMARY KEY(symbol, exchange, expiry, start_date, end_date)
                );
                """
            )
            conn.commit()

    def record_chain_snapshot(
        self,
        symbol: str,
        exchange: str,
        expiry: str,
        timestamp_ist: str,
        rows: list,
        *,
        expiry_code: str = '',
        captured_at: str = '',
        spot=None,
        futures_price=None,
        futures_expiry: str = '',
        india_vix=None,
        lot_size: int = 1,
        source: str = 'IWSM Live Exchange Snapshot',
    ):
        symbol = str(symbol or '').strip().upper()
        exchange = str(exchange or 'nse_fo').strip().lower()
        if not re.fullmatch(r'[A-Z0-9&._ -]{1,50}', symbol):
            raise ValueError('Invalid underlying symbol')
        if exchange not in ('nse_fo', 'bse_fo', 'mcx_fo'):
            raise ValueError('Invalid exchange')
        expiry_iso = normalize_expiry_iso(expiry)
        code = (expiry_code or iso_to_broker_expiry(expiry_iso)).upper()
        if not re.fullmatch(r'\d{4}-\d{2}-\d{2}T\d{2}:\d{2}', str(timestamp_ist or '')):
            raise ValueError('Timestamp must be IST YYYY-MM-DDTHH:MM')

        lot = max(1, int(lot_size or 1))
        spot_val = _finite(spot)
        fut_val = _finite(futures_price)
        vix_val = _finite(india_vix)
        captured = captured_at or datetime.now(IST).isoformat()

        # Compute time to expiry in ACT/365 years from IST snapshot timestamp to 15:30 IST on expiry day
        snap_dt = datetime.strptime(timestamp_ist, '%Y-%m-%dT%H:%M').replace(tzinfo=IST)
        exp_dt = datetime.strptime(expiry_iso + 'T15:30', '%Y-%m-%dT%H:%M').replace(tzinfo=IST)
        t_years = max(0.0, (exp_dt - snap_dt).total_seconds() / (365.0 * 86400.0))
        ref_price = fut_val if (fut_val and fut_val > 0) else (spot_val if (spot_val and spot_val > 0) else None)
        is_fut_basis = bool(fut_val and fut_val > 0)

        contract_tuples = []
        for row in rows or []:
            strike = _finite(row.get('strike'))
            if strike is None or strike < 0:
                continue
            for side in ('CE', 'PE'):
                leg = row.get(side)
                if not isinstance(leg, dict):
                    continue
                ltp = _finite(leg.get('ltp') if 'ltp' in leg else leg.get('close'))
                bid = _finite(leg.get('bid'))
                ask = _finite(leg.get('ask'))
                oi = _finite(leg.get('oi'))
                prev_oi = _finite(leg.get('previousOi') if 'previousOi' in leg else leg.get('prev_oi'))
                oi_change = _finite(leg.get('oiChange') if 'oiChange' in leg else leg.get('oi_change'))
                if oi_change is None and oi is not None and prev_oi is not None:
                    oi_change = oi - prev_oi
                volume = _finite(leg.get('volume'))
                if ltp is None and oi is None and bid is None and ask is None:
                    continue

                iv = _finite(leg.get('iv'))
                delta = _finite(leg.get('delta'))
                gamma = _finite(leg.get('gamma'))
                theta = _finite(leg.get('theta'))
                vega = _finite(leg.get('vega'))
                rho = _finite(leg.get('rho'))

                if iv is None and ltp is not None and ltp > 0 and ref_price and t_years > 1e-6:
                    solved = solve_iv_and_greeks(ltp, ref_price, strike, t_years, side, is_futures_basis=is_fut_basis)
                    if solved is not None:
                        iv, delta, gamma, theta, vega, rho = solved

                contract_tuples.append((
                    strike,
                    side,
                    str(leg.get('symbol') or leg.get('trading_symbol') or ''),
                    str(leg.get('token') or ''),
                    ltp,
                    bid,
                    ask,
                    oi,
                    prev_oi,
                    oi_change,
                    volume,
                    iv,
                    delta,
                    gamma,
                    theta,
                    vega,
                    rho,
                ))

        if not contract_tuples:
            raise ValueError('Snapshot contains no valid option contracts')

        with closing(self._connect()) as conn:
            conn.execute(
                """
                INSERT INTO snapshot_frames (
                    symbol, exchange, expiry, expiry_code, timestamp, captured_at,
                    spot, futures_price, futures_expiry, india_vix, lot_size, source
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT(symbol, exchange, expiry, timestamp) DO UPDATE SET
                    captured_at = excluded.captured_at,
                    spot = COALESCE(excluded.spot, snapshot_frames.spot),
                    futures_price = COALESCE(excluded.futures_price, snapshot_frames.futures_price),
                    futures_expiry = CASE WHEN excluded.futures_expiry != '' THEN excluded.futures_expiry ELSE snapshot_frames.futures_expiry END,
                    india_vix = COALESCE(excluded.india_vix, snapshot_frames.india_vix),
                    lot_size = excluded.lot_size,
                    source = excluded.source
                """,
                (
                    symbol, exchange, expiry_iso, code, timestamp_ist, captured,
                    spot_val, fut_val, str(futures_expiry or ''), vix_val, lot, source
                ),
            )
            frame_id = conn.execute(
                'SELECT id FROM snapshot_frames WHERE symbol=? AND exchange=? AND expiry=? AND timestamp=?',
                (symbol, exchange, expiry_iso, timestamp_ist),
            ).fetchone()['id']
            conn.execute('DELETE FROM snapshot_contracts WHERE frame_id=?', (frame_id,))
            conn.executemany(
                """
                INSERT INTO snapshot_contracts (
                    frame_id, strike, option_type, trading_symbol, token,
                    ltp, bid, ask, oi, prev_oi, oi_change, volume,
                    iv, delta, gamma, theta, vega, rho
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                [(frame_id, *t) for t in contract_tuples],
            )
            conn.commit()
        return {
            'recorded': True,
            'frameId': frame_id,
            'symbol': symbol,
            'exchange': exchange,
            'expiry': expiry_iso,
            'expiryCode': code,
            'timestamp': timestamp_ist,
            'contractCount': len(contract_tuples),
        }

    def minute_expiries(self, symbol: str, exchange: str = 'nse_fo', start: str = '', end: str = '') -> list:
        symbol = str(symbol or '').strip().upper()
        exchange = str(exchange or 'nse_fo').strip().lower()
        params = [symbol, exchange]
        clauses = ['symbol = ?', 'exchange = ?']
        if start:
            clauses.append('end_date >= ?')
            clauses.append('expiry >= ?')
            params.extend([start, start])
        if end:
            clauses.append('start_date <= ?')
            params.append(end)
        sql = f"SELECT DISTINCT expiry FROM minute_captures WHERE {' AND '.join(clauses)} ORDER BY expiry ASC"
        with closing(self._connect()) as conn:
            rows = conn.execute(sql, params).fetchall()
        return [iso_to_broker_expiry(r['expiry']) for r in rows]

    def expiries(self, symbol: str, exchange: str = 'nse_fo', start: str = '', end: str = '') -> list:
        symbol = str(symbol or '').strip().upper()
        exchange = str(exchange or 'nse_fo').strip().lower()
        params = [symbol, exchange]
        clauses = ['symbol = ?', 'exchange = ?']
        if start:
            clauses.append('substr(timestamp, 1, 10) >= ?')
            clauses.append('expiry >= ?')
            params.extend([start, start])
        if end:
            clauses.append('substr(timestamp, 1, 10) <= ?')
            params.append(end)
        sql = f"SELECT DISTINCT expiry, expiry_code FROM snapshot_frames WHERE {' AND '.join(clauses)} ORDER BY expiry ASC"
        min_params = [symbol, exchange]
        min_clauses = ['symbol = ?', 'exchange = ?']
        if start:
            min_clauses.append('end_date >= ?')
            min_clauses.append('expiry >= ?')
            min_params.extend([start, start])
        if end:
            min_clauses.append('start_date <= ?')
            min_params.append(end)
        min_sql = f"SELECT DISTINCT expiry FROM minute_captures WHERE {' AND '.join(min_clauses)} ORDER BY expiry ASC"
        with closing(self._connect()) as conn:
            rows = conn.execute(sql, params).fetchall()
            min_rows = conn.execute(min_sql, min_params).fetchall()
        by_iso = {}
        for r in rows:
            by_iso[r['expiry']] = r['expiry_code'] or iso_to_broker_expiry(r['expiry'])
        for r in min_rows:
            if r['expiry'] not in by_iso:
                by_iso[r['expiry']] = iso_to_broker_expiry(r['expiry'])
        return [by_iso[k] for k in sorted(by_iso)]

    def coverage(self, symbol: str = '', exchange: str = '', expiry: str = '') -> dict:
        clauses = []
        params = []
        if symbol:
            clauses.append('symbol = ?')
            params.append(symbol.strip().upper())
        if exchange:
            clauses.append('exchange = ?')
            params.append(exchange.strip().lower())
        if expiry:
            clauses.append('expiry = ?')
            params.append(normalize_expiry_iso(expiry))
        where = ('WHERE ' + ' AND '.join(clauses)) if clauses else ''

        with closing(self._connect()) as conn:
            agg = conn.execute(
                f"""
                SELECT
                    COUNT(*) AS frame_count,
                    MIN(timestamp) AS earliest_ts,
                    MAX(timestamp) AS latest_ts
                FROM snapshot_frames
                {where}
                """,
                params,
            ).fetchone()
            contract_count = conn.execute(
                f"""
                SELECT COUNT(*) AS cnt
                FROM snapshot_contracts c
                JOIN snapshot_frames f ON f.id = c.frame_id
                {where}
                """,
                params,
            ).fetchone()['cnt']
            sym_rows = conn.execute(
                f"""
                SELECT
                    symbol,
                    exchange,
                    COUNT(*) AS frame_count,
                    MIN(timestamp) AS earliest_ts,
                    MAX(timestamp) AS latest_ts,
                    GROUP_CONCAT(DISTINCT expiry) AS expiries_csv,
                    GROUP_CONCAT(DISTINCT substr(timestamp, 1, 10)) AS dates_csv
                FROM snapshot_frames
                {where}
                GROUP BY symbol, exchange
                ORDER BY symbol ASC, exchange ASC
                """,
                params,
            ).fetchall()

        earliest_ts = agg['earliest_ts']
        latest_ts = agg['latest_ts']
        symbols = []
        for r in sym_rows:
            exps = sorted(filter(None, (r['expiries_csv'] or '').split(',')))
            dates = sorted(filter(None, (r['dates_csv'] or '').split(',')))
            symbols.append({
                'symbol': r['symbol'],
                'exchange': r['exchange'],
                'frameCount': r['frame_count'],
                'earliestTimestamp': r['earliest_ts'],
                'latestTimestamp': r['latest_ts'],
                'expiries': exps,
                'tradingDates': dates,
            })

        return {
            'hasSnapshots': bool(agg['frame_count'] > 0),
            'frameCount': int(agg['frame_count'] or 0),
            'contractRowCount': int(contract_count or 0),
            'earliestTimestamp': earliest_ts,
            'earliestDate': earliest_ts[:10] if earliest_ts else None,
            'latestTimestamp': latest_ts,
            'latestDate': latest_ts[:10] if latest_ts else None,
            'symbols': symbols,
        }

    def load_replay(self, symbol: str, exchange: str, expiry: str, start: str, end: str) -> dict:
        symbol = str(symbol or '').strip().upper()
        exchange = str(exchange or 'nse_fo').strip().lower()
        expiry_iso = normalize_expiry_iso(expiry)
        if not re.fullmatch(r'\d{4}-\d{2}-\d{2}', start) or not re.fullmatch(r'\d{4}-\d{2}-\d{2}', end) or start > end:
            raise ValueError('Invalid start/end date range')

        cov = self.coverage(symbol=symbol, exchange=exchange)
        with closing(self._connect()) as conn:
            frames = conn.execute(
                """
                SELECT * FROM snapshot_frames
                WHERE symbol = ? AND exchange = ? AND expiry = ?
                  AND substr(timestamp, 1, 10) >= ?
                  AND substr(timestamp, 1, 10) <= ?
                ORDER BY timestamp ASC
                """,
                (symbol, exchange, expiry_iso, start, end),
            ).fetchall()
            if not frames:
                earliest_msg = (
                    f"Earliest recorded snapshot for {symbol} is {cov['earliestTimestamp']} IST."
                    if cov['earliestTimestamp']
                    else f'No historical option-chain snapshots have been recorded yet for {symbol}.'
                )
                raise LookupError(f'No recorded option-chain snapshots in [{start}, {end}] for {symbol} {expiry_iso}. {earliest_msg}')

            frame_ids = [f['id'] for f in frames]
            placeholders = ','.join('?' for _ in frame_ids)
            c_rows = conn.execute(
                f"""
                SELECT * FROM snapshot_contracts
                WHERE frame_id IN ({placeholders})
                ORDER BY frame_id ASC, strike ASC, option_type ASC
                """,
                frame_ids,
            ).fetchall()

        by_frame = {}
        for c in c_rows:
            by_frame.setdefault(c['frame_id'], []).append(c)

        contracts = []
        underlying = []
        vix_latest = None
        recorded_dates = set()
        for f in frames:
            ts = f['timestamp']
            recorded_dates.add(ts[:10])
            lot = int(f['lot_size'] or 1)
            if f['india_vix'] is not None:
                vix_latest = float(f['india_vix'])
            if f['spot'] is not None and f['spot'] > 0:
                u_item = {'timestamp': ts, 'symbol': symbol, 'close': float(f['spot'])}
                if f['india_vix'] is not None:
                    u_item['indiaVix'] = float(f['india_vix'])
                underlying.append(u_item)
            if f['futures_price'] is not None and f['futures_price'] > 0:
                contracts.append({
                    'timestamp': ts,
                    'symbol': symbol,
                    'expiry': f['futures_expiry'] or expiry_iso,
                    'type': 'FUT',
                    'strike': 0,
                    'close': float(f['futures_price']),
                    'lotSize': lot,
                    'oi': None,
                    'volume': None,
                })
            for c in by_frame.get(f['id'], []):
                if c['ltp'] is None:
                    continue
                contracts.append({
                    'timestamp': ts,
                    'symbol': symbol,
                    'expiry': expiry_iso,
                    'type': c['option_type'],
                    'strike': float(c['strike']),
                    'close': float(c['ltp']),
                    'bid': c['bid'],
                    'ask': c['ask'],
                    'lotSize': lot,
                    'oi': c['oi'],
                    'previousOi': c['prev_oi'],
                    'oiChange': c['oi_change'],
                    'volume': c['volume'],
                    'iv': c['iv'],
                    'delta': c['delta'],
                    'gamma': c['gamma'],
                    'theta': c['theta'],
                    'vega': c['vega'],
                    'rho': c['rho'],
                    'greeksSource': 'calculated_bsm',
                })

        warnings = []
        coverage_status = 'complete'
        if cov['earliestDate'] and start < cov['earliestDate']:
            coverage_status = 'partial'
            warnings.append(
                f"Requested start date ({start}) precedes earliest recorded snapshot date ({cov['earliestDate']})."
            )
        start_dt = datetime.strptime(start, '%Y-%m-%d').date()
        end_dt = datetime.strptime(end, '%Y-%m-%d').date()
        expected_weekdays = []
        cur = start_dt
        while cur <= end_dt:
            if cur.weekday() < 5:
                expected_weekdays.append(cur.isoformat())
            cur += timedelta(days=1)
        missing_weekdays = [d for d in expected_weekdays if d not in recorded_dates]
        if missing_weekdays:
            coverage_status = 'partial'
            warnings.append(
                f"Recorded snapshot coverage is partial; missing weekday snapshots for: {', '.join(missing_weekdays[:5])}."
            )

        return {
            'dataset': {
                'source': 'IWSM recorded option-chain snapshots',
                'contracts': contracts,
                'underlying': underlying,
                'metadata': {
                    'modelled': False,
                    'exchange': exchange,
                    'resolution': 'Recorded snapshot timestamps (IST)',
                    'quoteTiming': 'Exact IST timestamp when live option chain was recorded',
                    'coverageStatus': coverage_status,
                    'earliestRecordedTimestamp': cov['earliestTimestamp'],
                    'earliestRecordedDate': cov['earliestDate'],
                    'latestRecordedTimestamp': cov['latestTimestamp'],
                    'frameCount': len(frames),
                    'tradingDates': sorted(recorded_dates),
                    'indiaVix': vix_latest,
                    'greeksSource': 'Calculated (Black-76 / BSM, r=6.50%, ACT/365)',
                    'warnings': warnings,
                },
            },
            'coverage': cov,
        }

    def remember_minute_replay(self, dataset: dict):
        contracts = (dataset or {}).get('contracts') or []
        if not contracts:
            return
        symbol = str(contracts[0].get('symbol') or '').strip().upper()
        exch = str((dataset.get('metadata') or {}).get('exchange') or 'nse_fo').strip().lower()
        stamps = [str(r.get('timestamp', ''))[:10] for r in contracts if r.get('timestamp')]
        if not symbol or not stamps:
            return
        start_d, end_d = min(stamps), max(stamps)
        opt_exps = sorted({str(r['expiry']) for r in contracts if r.get('type') != 'FUT' and r.get('expiry')})
        if not opt_exps:
            return
        with closing(self._connect()) as conn:
            for exp in opt_exps:
                sub = [r for r in contracts if r.get('expiry') == exp or r.get('type') == 'FUT']
                blob = gzip.compress(json.dumps({**dataset, 'contracts': sub}, separators=(',', ':')).encode('utf-8'))
                conn.execute(
                    """
                    INSERT OR REPLACE INTO minute_captures(symbol, exchange, expiry, start_date, end_date, saved_at, payload)
                    VALUES (?, ?, ?, ?, ?, ?, ?)
                    """,
                    (symbol, exch, exp, start_d, end_d, time.time(), blob),
                )
            conn.commit()

    def load_minute_replay(self, symbol: str, exchange: str, expiry: str, start: str, end: str) -> dict:
        symbol = str(symbol or '').strip().upper()
        exchange = str(exchange or 'nse_fo').strip().lower()
        exp_iso = normalize_expiry_iso(expiry)
        eff_end = min(end, exp_iso) if (end and exp_iso < end and (not start or start <= exp_iso)) else end
        with closing(self._connect()) as conn:
            rows = conn.execute(
                """
                SELECT payload FROM minute_captures
                WHERE symbol = ? AND exchange = ? AND expiry = ?
                  AND start_date <= ? AND end_date >= ?
                ORDER BY saved_at ASC
                """,
                (symbol, exchange, exp_iso, eff_end, start),
            ).fetchall()
        if not rows:
            raise LookupError('No cached minute replay for selection')

        merged_contracts = {}
        merged_underlying = {}
        base_meta = {}
        source_label = 'IWSM 1-Minute Intraday Option History'
        for row in rows:
            raw = json.loads(gzip.decompress(row['payload']).decode('utf-8'))
            if raw.get('source'):
                source_label = raw['source']
            if isinstance(raw.get('metadata'), dict):
                base_meta.update(raw['metadata'])
            for r in raw.get('contracts', []):
                ts = str(r.get('timestamp', ''))
                if len(ts) >= 10 and start <= ts[:10] <= eff_end:
                    k = (ts, r.get('expiry'), r.get('type'), 0 if r.get('type') == 'FUT' else float(r.get('strike', 0)))
                    merged_contracts[k] = r
            for u in raw.get('underlying', []):
                ts = str(u.get('timestamp', ''))
                if len(ts) >= 10 and start <= ts[:10] <= eff_end:
                    merged_underlying[ts] = u

        contracts_list = [merged_contracts[k] for k in sorted(merged_contracts)]
        if not any(r.get('type') != 'FUT' for r in contracts_list):
            raise LookupError('No option contracts in cached minute window')
        underlying_list = [merged_underlying[ts] for ts in sorted(merged_underlying)]
        active_stamps = sorted({str(r.get('timestamp', '')) for r in contracts_list if r.get('type') != 'FUT' and r.get('timestamp')})
        out_raw = {
            'source': source_label,
            'contracts': contracts_list,
            'underlying': underlying_list,
            'metadata': {
                **base_meta,
                'backup': True,
                'backupResolution': 'minute',
                'frameCount': len(active_stamps),
            },
        }
        return {'dataset': out_raw, 'backup': True, 'resolution': 'minute', 'asOf': active_stamps[-1]}


"""Indexed counterpart of the 5-year NIFTY Excel export; no token or authentication storage."""
import gzip, json, sqlite3, re, time
from contextlib import contextmanager
from pathlib import Path
from datetime import date, datetime

DEFAULT_ROOT = Path(__file__).resolve().parents[2] / 'market-data/nifty-backup'


def _historical_nifty_lot_size(expiry_iso: str) -> int:
    if expiry_iso <= '2021-07-29':
        return 75
    if expiry_iso <= '2024-04-25':
        return 50
    if expiry_iso <= '2024-11-20':
        return 25
    if expiry_iso <= '2025-12-30':
        return 75
    return 65


class NiftyBackup:
    def __init__(self, root=DEFAULT_ROOT):
        self.root = Path(root)

    @contextmanager
    def connect(self):
        if not (self.root / 'nifty.sqlite3').is_file():
            raise ValueError('NIFTY backup is not available')
        c = sqlite3.connect(self.root / 'nifty.sqlite3', timeout=10)
        c.row_factory = sqlite3.Row
        try:
            with c:
                yield c
        finally:
            c.close()

    def expiry_iso(self, value):
        s = str(value or '').strip().upper()
        for fmt in ('%d%b%y', '%d%b%Y', '%d-%b-%Y'):
            try:
                return datetime.strptime(s, fmt).date().isoformat()
            except ValueError:
                continue
        return date.fromisoformat(s).isoformat()

    def minute_expiries(self, start='', end=''):
        try:
            with self.connect() as c:
                found = set()
                if start and end:
                    date.fromisoformat(start)
                    date.fromisoformat(end)
                    rows = c.execute(
                        "SELECT DISTINCT expiry FROM captures WHERE kind='minute' AND start<=? AND end>=? AND expiry>=? ORDER BY expiry",
                        (end, start, start),
                    ).fetchall()
                else:
                    rows = c.execute("SELECT DISTINCT expiry FROM captures WHERE kind='minute' ORDER BY expiry").fetchall()
                for r in rows:
                    found.add(r[0])
                return [datetime.strptime(exp, '%Y-%m-%d').strftime('%d%b%y').upper() for exp in sorted(found)]
        except (ValueError, OSError, sqlite3.Error):
            return []

    def expiries(self, start='', end=''):
        with self.connect() as c:
            found = set()
            if start and end:
                date.fromisoformat(start)
                date.fromisoformat(end)
                rows = c.execute(
                    "SELECT DISTINCT expiry FROM quotes WHERE date>=? AND date<=? AND expiry>=? AND type!='FUT' ORDER BY expiry",
                    (start, end, start),
                )
                for r in rows:
                    found.add(r[0])
                try:
                    cap_rows = c.execute(
                        "SELECT DISTINCT expiry FROM captures WHERE start<=? AND end>=? AND expiry>=? ORDER BY expiry",
                        (end, start, start),
                    )
                    for r in cap_rows:
                        found.add(r[0])
                except sqlite3.OperationalError:
                    pass
            else:
                last = c.execute('select max(date) from sources').fetchone()[0]
                if last:
                    for r in c.execute("SELECT DISTINCT expiry FROM quotes WHERE date=? AND type!='FUT' ORDER BY expiry", (last,)):
                        found.add(r[0])
                try:
                    for r in c.execute('SELECT DISTINCT expiry FROM captures ORDER BY expiry'):
                        found.add(r[0])
                except sqlite3.OperationalError:
                    pass
            return [datetime.strptime(exp, '%Y-%m-%d').strftime('%d%b%y').upper() for exp in sorted(found)]

    def remember(self, dataset, kind):
        if not dataset.get('contracts') or any(r.get('symbol') != 'NIFTY' for r in dataset['contracts']):
            return
        self.root.mkdir(parents=True, exist_ok=True)
        rows = dataset['contracts']
        start = min(r.get('timestamp', r.get('date', ''))[:10] for r in rows)
        end = max(r.get('timestamp', r.get('date', ''))[:10] for r in rows)
        with self.connect() as c:
            c.execute('CREATE TABLE IF NOT EXISTS captures(kind TEXT,start TEXT,end TEXT,expiry TEXT,saved REAL,payload BLOB,PRIMARY KEY(kind,start,end,expiry))')
            for expiry in {r['expiry'] for r in rows if r.get('type') != 'FUT'}:
                copy = {**dataset, 'contracts': [r for r in rows if r['expiry'] == expiry or r.get('type') == 'FUT']}
                c.execute(
                    'INSERT OR REPLACE INTO captures VALUES(?,?,?,?,?,?)',
                    (kind, start, end, expiry, time.time(), gzip.compress(json.dumps(copy, separators=(',', ':')).encode())),
                )

    def cached(self, expiry, start, end, kind):
        try:
            with self.connect() as c:
                if kind == 'minute':
                    rows = c.execute(
                        'SELECT payload FROM captures WHERE kind=? AND expiry=? AND start<=? AND end>=? ORDER BY saved ASC',
                        (kind, expiry, end, start),
                    ).fetchall()
                else:
                    rows = c.execute(
                        'SELECT payload FROM captures WHERE kind=? AND expiry=? ORDER BY saved DESC LIMIT 1',
                        (kind, expiry),
                    ).fetchall()
            if not rows:
                return None
            if kind != 'minute':
                raw = json.loads(gzip.decompress(rows[0][0]))
                if raw.get('contracts'):
                    return raw
                return None

            merged_contracts = {}
            merged_underlying = {}
            base_meta = {}
            source_label = 'IWSM 1-Minute Intraday Option History'
            for row in rows:
                raw = json.loads(gzip.decompress(row[0]))
                if raw.get('source'):
                    source_label = raw['source']
                if isinstance(raw.get('metadata'), dict):
                    base_meta.update(raw['metadata'])
                for r in raw.get('contracts', []):
                    ts = str(r.get('timestamp', ''))
                    if len(ts) >= 10 and start <= ts[:10] <= end:
                        k = (ts, r.get('expiry'), r.get('type'), 0 if r.get('type') == 'FUT' else float(r.get('strike', 0)))
                        merged_contracts[k] = r
                for u in raw.get('underlying', []):
                    ts = str(u.get('timestamp', ''))
                    if len(ts) >= 10 and start <= ts[:10] <= end:
                        merged_underlying[ts] = u

            contracts_list = [merged_contracts[k] for k in sorted(merged_contracts)]
            if not any(r.get('type') != 'FUT' for r in contracts_list):
                return None
            underlying_list = [merged_underlying[ts] for ts in sorted(merged_underlying)]
            active_stamps = sorted({c['timestamp'] for c in contracts_list if c.get('type') != 'FUT' and c.get('timestamp')})
            return {
                'source': source_label,
                'contracts': contracts_list,
                'underlying': underlying_list,
                'metadata': {
                    **base_meta,
                    'frameCount': len(active_stamps),
                },
            }
        except sqlite3.OperationalError:
            return None

    def load(self, expiry, start='', end='', kind='minute'):
        exp = self.expiry_iso(expiry)
        eff_end = min(end, exp) if (end and exp < end and (not start or start <= exp)) else end
        if kind == 'minute':
            a, b = date.fromisoformat(start), date.fromisoformat(eff_end)
            if not 0 <= (b - a).days <= 30:
                raise ValueError('Select up to 31 calendar days')
        raw = self.cached(exp, start, eff_end, kind)
        if raw:
            raw['metadata'] = {**raw.get('metadata', {}), 'backup': True, 'backupResolution': 'minute' if kind == 'minute' else 'snapshot'}
            return {
                'dataset': raw,
                'backup': True,
                'resolution': 'minute' if kind == 'minute' else 'snapshot',
                'asOf': max(r.get('timestamp', r.get('date', '')) for r in raw['contracts']),
            }
        with self.connect() as c:
            if kind == 'snapshot':
                start = eff_end = c.execute('select max(date) from quotes where expiry=?', (exp,)).fetchone()[0]
            if not start:
                raise ValueError('No backup records for this expiry')
            rows = c.execute(
                'select * from quotes where expiry=? and date>=? and date<=? order by date,strike,type',
                (exp, start, eff_end),
            ).fetchall()
            if not rows:
                raise ValueError('No backup records for this expiry/date window')
            refs = []
            try:
                ohlc_rows = c.execute(
                    'select date, open, high, low, close from underlying_ohlc where date>=? and date<=? order by date',
                    (start, eff_end),
                ).fetchall()
                if ohlc_rows:
                    refs = [
                        {
                            'date': r['date'],
                            'symbol': 'NIFTY',
                            'open': r['open'],
                            'high': r['high'],
                            'low': r['low'],
                            'close': r['close'],
                        }
                        for r in ohlc_rows
                    ]
            except sqlite3.OperationalError:
                pass
            if not refs:
                try:
                    refs = [
                        {'date': r[0], 'symbol': 'NIFTY', 'close': r[1]}
                        for r in c.execute('select date,close from underlying where date>=? and date<=? order by date', (start, eff_end))
                    ]
                except sqlite3.OperationalError:
                    pass
        row_keys = set(rows[0].keys()) if rows else set()
        contracts = [
            {
                'date': r['date'],
                'symbol': 'NIFTY',
                'expiry': r['expiry'],
                'type': r['type'],
                'strike': r['strike'],
                'open': r['open'] if 'open' in row_keys else None,
                'high': r['high'] if 'high' in row_keys else None,
                'low': r['low'] if 'low' in row_keys else None,
                'close': r['close'],
                'lotSize': r['lot_size'],
                'oi': r['oi'],
                'oiChange': r['oi_change'] if 'oi_change' in row_keys else None,
                'volume': r['volume'],
            }
            for r in rows
        ]
        raw = {
            'source': 'Local NIFTY backup · verified NSE daily closes',
            'contracts': contracts,
            'underlying': refs,
            'metadata': {
                'exchange': 'nse_fo',
                'backup': True,
                'backupResolution': 'daily',
                'modelled': False,
                'quoteTiming': 'End-of-day close, not live or minute data',
                'warning': 'End-of-day NSE archive loaded for this historical window. Missing source values remain unavailable.',
            },
        }
        return {'dataset': raw, 'backup': True, 'resolution': 'daily', 'asOf': max(r['date'] for r in contracts)}

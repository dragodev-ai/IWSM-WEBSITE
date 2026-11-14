"""Read-only local NSE bhavcopy/UDiFF archive fallback for all NSE F&O indices and stocks.

Reads genuine official NSE daily derivative archives stored in
`market-data/nse-derivatives/archive.sqlite3` (+ raw zip files) without ever
fabricating intraday bars or missing fields.
"""
import csv, io, json, math, re, sqlite3, sys, zipfile
from collections import OrderedDict
from datetime import date, datetime
from pathlib import Path

DEFAULT_ARCHIVE_ROOT = Path(__file__).resolve().parents[2] / 'market-data/nse-derivatives'
TOOLS_DIR = Path(__file__).resolve().parents[2] / 'tools'

_ENTRY_CACHE = {'mtime': 0.0, 'entries': []}
_SYMBOL_DAY_CACHE = OrderedDict()
_MAX_DAY_CACHE = 96


def _numeric(v):
    try:
        n = float(v)
        return n if math.isfinite(n) else None
    except (TypeError, ValueError):
        return None


def _parsed_legacy_date(v):
    try:
        return datetime.strptime(str(v or '').strip(), '%d-%b-%Y').date().isoformat()
    except ValueError:
        return None


def _expiry_iso(value: str) -> str:
    s = str(value or '').strip().upper()
    if not s:
        return ''
    if re.fullmatch(r'\d{4}-\d{2}-\d{2}', s):
        return s
    for fmt in ('%d%b%y', '%d%b%Y', '%d-%b-%Y'):
        try:
            return datetime.strptime(s, fmt).date().isoformat()
        except ValueError:
            continue
    raise ValueError(f'Invalid expiry format: {value}')


def _iso_to_code(iso_str: str) -> str:
    return datetime.strptime(iso_str, '%Y-%m-%d').strftime('%d%b%y').upper()


class LocalNseArchive:
    def __init__(self, root: Path = DEFAULT_ARCHIVE_ROOT, allow_sync: bool = False):
        self.root = Path(root)
        self.allow_sync = allow_sync

    def available(self) -> bool:
        return (self.root / 'archive.sqlite3').is_file()

    def _entries(self) -> list:
        db_file = self.root / 'archive.sqlite3'
        if not db_file.is_file():
            raise ValueError('Local NSE derivatives archive is not available')
        mtime = db_file.stat().st_mtime
        if _ENTRY_CACHE['mtime'] == mtime and _ENTRY_CACHE['entries']:
            return _ENTRY_CACHE['entries']
        uri = 'file:' + str(db_file).replace('\\', '/') + '?mode=ro'
        conn = sqlite3.connect(uri, uri=True, timeout=10.0)
        try:
            rows = [
                json.loads(r[0])
                for r in conn.execute("SELECT details FROM archive WHERE status='downloaded' ORDER BY date")
            ]
        finally:
            conn.close()
        _ENTRY_CACHE['mtime'] = mtime
        _ENTRY_CACHE['entries'] = rows
        return rows

    def _sync_if_enabled(self, start: str, end: str):
        if not self.allow_sync or not self.available():
            return None
        try:
            if str(TOOLS_DIR) not in sys.path:
                sys.path.insert(0, str(TOOLS_DIR))
            from nse_window_sync import sync_window
            res = sync_window(self.root, start, end)
            if res.get('downloaded'):
                _ENTRY_CACHE['mtime'] = 0.0
            return res
        except Exception:
            return None

    def _read_symbol_day(self, entry: dict, symbol: str) -> tuple:
        key = (str(self.root), entry['date'], symbol)
        if key in _SYMBOL_DAY_CACHE:
            _SYMBOL_DAY_CACHE.move_to_end(key)
            return _SYMBOL_DAY_CACHE[key]

        file_path = (self.root / entry['path']).resolve()
        if not file_path.is_relative_to(self.root.resolve()) or not file_path.is_file():
            raise ValueError('Stored archive file is unavailable')

        contracts = []
        refs = set()
        missing_lots = 0
        with zipfile.ZipFile(file_path) as zf:
            csv_name = next((n for n in zf.namelist() if n.lower().endswith('.csv')), None)
            if not csv_name:
                raise ValueError('Missing CSV inside archive zip')
            reader = csv.DictReader(io.TextIOWrapper(zf.open(csv_name), encoding='utf-8-sig'))
            for row in reader:
                modern = 'TradDt' in row
                row_sym = row.get('TckrSymb') if modern else row.get('SYMBOL')
                if row_sym != symbol:
                    continue
                inst = row.get('FinInstrmTp') if modern else row.get('INSTRUMENT')
                if inst not in ('IDO', 'STO', 'IDF', 'STF', 'OPTIDX', 'OPTSTK', 'FUTIDX', 'FUTSTK'):
                    continue
                typ = (row.get('OptnTp') if modern else row.get('OPTION_TYP')) or ''
                if inst in ('IDF', 'STF', 'FUTIDX', 'FUTSTK'):
                    typ = 'FUT'
                exp = (row.get('FininstrmActlXpryDt') or row.get('XpryDt')) if modern else _parsed_legacy_date(row.get('EXPIRY_DT', ''))
                close = _numeric(row.get('ClsPric') if modern else row.get('CLOSE'))
                strike = 0.0 if typ == 'FUT' else _numeric(row.get('StrkPric') if modern else row.get('STRIKE_PR'))
                if typ not in ('CE', 'PE', 'FUT') or not exp or exp < entry['date'] or close is None or close < 0 or strike is None:
                    continue
                lot = _numeric(row.get('NewBrdLotQty')) if modern else None
                if lot is None:
                    missing_lots += 1
                oi = _numeric(row.get('OpnIntrst') if modern else row.get('OPEN_INT'))
                vol = _numeric(row.get('TtlTradgVol') if modern else row.get('CONTRACTS'))
                contracts.append({
                    'date': entry['date'],
                    'symbol': symbol,
                    'expiry': exp,
                    'type': typ,
                    'strike': strike,
                    'close': close,
                    'lotSize': int(lot) if lot and float(lot).is_integer() else None,
                    'oi': oi,
                    'volume': vol,
                })
                ref = _numeric(row.get('UndrlygPric')) if modern else None
                if ref and ref > 0:
                    refs.add(ref)

        spot = next(iter(refs)) if len(refs) == 1 else None
        result = (contracts, spot, missing_lots)
        _SYMBOL_DAY_CACHE[key] = result
        while len(_SYMBOL_DAY_CACHE) > _MAX_DAY_CACHE:
            _SYMBOL_DAY_CACHE.popitem(last=False)
        return result

    def expiries(self, symbol: str, start: str = '', end: str = '') -> list:
        symbol = str(symbol or '').strip().upper()
        if not re.fullmatch(r'[A-Z0-9&._-]{1,40}', symbol):
            raise ValueError('Invalid NSE symbol')
        entries = self._entries()
        sym_entries = [r for r in entries if symbol in r.get('symbols', {})]
        if not sym_entries:
            if start and end:
                self._sync_if_enabled(start, end)
                entries = self._entries()
                sym_entries = [r for r in entries if symbol in r.get('symbols', {})]
            if not sym_entries:
                return []

        if start and end:
            date.fromisoformat(start)
            date.fromisoformat(end)
            chosen = [r for r in sym_entries if start <= r['date'] <= end]
            if not chosen and self.allow_sync and (date.fromisoformat(end) - date.fromisoformat(start)).days <= 30:
                self._sync_if_enabled(start, end)
                entries = self._entries()
                sym_entries = [r for r in entries if symbol in r.get('symbols', {})]
                chosen = [r for r in sym_entries if start <= r['date'] <= end]
            # If the exact single day was a weekend/holiday, inspect the closest preceding trading day within 7 days for listed expiries
            if not chosen:
                prior = [r for r in sym_entries if r['date'] <= end and (date.fromisoformat(end) - date.fromisoformat(r['date'])).days <= 7]
                if prior:
                    chosen = [prior[-1]]
        else:
            chosen = [sym_entries[-1]]

        exp_isos = set()
        for entry in chosen[-5:]:
            contracts, _, _ = self._read_symbol_day(entry, symbol)
            for c in contracts:
                if c['type'] != 'FUT' and (not start or c['expiry'] >= start):
                    exp_isos.add(c['expiry'])
        return [_iso_to_code(x) for x in sorted(exp_isos)]

    def load(self, symbol: str, expiry: str = '', start: str = '', end: str = '', resolve_non_trading: bool = False) -> dict:
        symbol = str(symbol or '').strip().upper()
        if not re.fullmatch(r'[A-Z0-9&._-]{1,40}', symbol):
            raise ValueError('Invalid NSE symbol')
        exp_iso = _expiry_iso(expiry) if expiry else ''

        entries = self._entries()
        sym_entries = [r for r in entries if symbol in r.get('symbols', {})]
        if not sym_entries:
            raise ValueError(f'No local NSE archive entries for {symbol}')

        if not start or not end:
            if exp_iso:
                # Find latest date on or before exp_iso
                cand = [r for r in sym_entries if r['date'] <= exp_iso]
                if not cand:
                    raise ValueError('No archive records for this expiry')
                start = end = cand[-1]['date']
            else:
                start = end = sym_entries[-1]['date']
        else:
            a, b = date.fromisoformat(start), date.fromisoformat(end)
            if not 0 <= (b - a).days <= 31:
                raise ValueError('Select up to 31 calendar days')

        selected = [r for r in sym_entries if start <= r['date'] <= end]
        if not selected and self.allow_sync:
            self._sync_if_enabled(start, end)
            entries = self._entries()
            sym_entries = [r for r in entries if symbol in r.get('symbols', {})]
            selected = [r for r in sym_entries if start <= r['date'] <= end]

        shifted_note = ''
        if not selected and resolve_non_trading:
            # Resolve weekend/holiday to nearest prior trading day within 7 days
            prior = [r for r in sym_entries if r['date'] <= end and (date.fromisoformat(end) - date.fromisoformat(r['date'])).days <= 7]
            if prior:
                selected = [prior[-1]]
                shifted_note = f"Requested date {start} had no NSE session; loaded nearest trading session ({selected[0]['date']})."

        if not selected:
            raise ValueError(f'No NSE archive records for {symbol} between {start} and {end}')

        contracts = []
        underlying = []
        missing_lots = 0
        for entry in selected:
            day_contracts, spot, day_missing = self._read_symbol_day(entry, symbol)
            filtered = [
                c for c in day_contracts
                if not exp_iso or c['expiry'] == exp_iso or (c['type'] == 'FUT' and c['expiry'][:7] == exp_iso[:7])
            ]
            if not any(c['type'] != 'FUT' for c in filtered):
                continue
            contracts.extend(filtered)
            missing_lots += day_missing
            if spot is not None and spot > 0:
                underlying.append({'date': entry['date'], 'symbol': symbol, 'close': spot})

        if not any(c['type'] != 'FUT' for c in contracts):
            raise ValueError(f'No archive option records for {symbol}' + (f' ({exp_iso})' if exp_iso else ''))

        warnings = ['Recorded daily NSE closing observations (UDiFF / bhavcopy), not intraday quotes.']
        if shifted_note:
            warnings.insert(0, shifted_note)
        if missing_lots:
            warnings.append('Legacy archive dates omit contract lot size; enter verified lot size before monetary execution.')

        as_of = max(c['date'] for c in contracts)
        return {
            'dataset': {
                'source': f'Local NSE verified derivatives archive ({symbol})',
                'contracts': contracts,
                'underlying': underlying,
                'metadata': {
                    'exchange': 'nse_fo',
                    'backup': True,
                    'backupResolution': 'daily',
                    'modelled': False,
                    'quoteTiming': 'End-of-day official NSE close',
                    'warnings': warnings,
                },
            },
            'backup': True,
            'resolution': 'daily',
            'asOf': as_of,
        }

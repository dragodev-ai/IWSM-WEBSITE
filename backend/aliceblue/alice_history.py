"""Bounded, authenticated observed-minute replay & snapshot recorder endpoints. No interpolation or order endpoints."""
import asyncio, hashlib, re, sqlite3, time
from collections import Counter
from datetime import datetime, timedelta, timezone
import httpx
from fastapi import HTTPException, Request
from snapshot_store import SnapshotStore, solve_iv_and_greeks, normalize_expiry_iso, iso_to_broker_expiry

IST = timezone(timedelta(hours=5, minutes=30))
MASTER = 'https://v2api.aliceblueonline.com/restpy/static/contract_master/V2/'
INDEX_NAMES = {
    'NIFTY': 'NIFTY 50',
    'BANKNIFTY': 'NIFTY BANK',
    'FINNIFTY': 'NIFTY FIN SERVICE',
    'MIDCPNIFTY': 'NIFTY MIDCAP SELECT',
    'NIFTYNXT50': 'NIFTY NEXT 50',
    'SENSEX': 'SENSEX',
    'BANKEX': 'BANKEX',
}
INDIA_VIX_TOKEN = '26017'


def market_status_ist(now=None) -> dict:
    cur = now.astimezone(IST) if now is not None else datetime.now(IST)
    hhmm = cur.strftime('%H:%M')
    if cur.weekday() >= 5:
        status, reason = 'closed', 'Weekend (Exchange Closed)'
    elif '09:15' <= hhmm <= '15:30':
        status, reason = 'open', 'Regular F&O Session (09:15–15:30 IST)'
    elif hhmm < '09:15':
        status, reason = 'closed', 'Pre-Open / Before 09:15 IST'
    else:
        status, reason = 'closed', 'Market Closed / After 15:30 IST'
    return {
        'status': status,
        'isOpen': status == 'open',
        'reason': reason,
        'timezone': 'Asia/Kolkata',
        'dateIST': cur.strftime('%Y-%m-%d'),
        'timeIST': hhmm,
        'serverTimeIST': cur.isoformat(),
    }


def classify_expiries(expiries_list, as_of_iso: str = '') -> list:
    ref_date = None
    if as_of_iso and re.fullmatch(r'\d{4}-\d{2}-\d{2}', as_of_iso):
        try:
            ref_date = datetime.strptime(as_of_iso, '%Y-%m-%d').date()
        except ValueError:
            ref_date = None
    if ref_date is None:
        ref_date = datetime.now(IST).date()

    parsed = []
    month_max = {}
    for raw in expiries_list or []:
        try:
            iso = normalize_expiry_iso(raw)
            code = raw if re.fullmatch(r'\d{2}[A-Z]{3}\d{2}', str(raw).upper()) else iso_to_broker_expiry(iso)
            dt = datetime.strptime(iso, '%Y-%m-%d').date()
            ym = (dt.year, dt.month)
            if ym not in month_max or dt > month_max[ym]:
                month_max[ym] = dt
            parsed.append((str(raw), code, iso, dt, ym))
        except ValueError:
            continue

    parsed.sort(key=lambda item: item[2])
    details = []
    for raw, code, iso, dt, ym in parsed:
        dte = (dt - ref_date).days
        cycle = 'monthly' if month_max.get(ym) == dt else 'weekly'
        details.append({
            'expiry': raw,
            'code': code,
            'iso': iso,
            'cycle': cycle,
            'dte': dte,
            'expired': dte < 0,
        })
    return details


def front_future(records, underlying, as_of, target_expiry_iso=''):
    candidates = []
    for row in records:
        if row.get('symbol') != underlying or not (
            str(row.get('instrument_type', '')).startswith('FUT') or row.get('instrument_type') in ('IF', 'SF')
        ):
            continue
        try:
            expiry = datetime.fromtimestamp(float(row.get('expiry_date', 0)) / 1000, timezone.utc).strftime('%Y-%m-%d')
            if expiry >= as_of and int(row.get('lot_size') or 0) > 0:
                candidates.append({**row, 'expiryISO': expiry})
        except (ValueError, TypeError, OverflowError, OSError):
            continue
    if not candidates:
        return None
    if target_expiry_iso and len(target_expiry_iso) >= 7:
        same_month = [c for c in candidates if c['expiryISO'][:7] == target_expiry_iso[:7]]
        if same_month:
            return min(same_month, key=lambda r: r['expiryISO'])
    return min(candidates, key=lambda r: r['expiryISO'])


def master_rows(payload):
    if isinstance(payload, list):
        return payload
    if isinstance(payload, dict):
        return next((v for v in payload.values() if isinstance(v, list)), [])
    return []


def instrument_catalog(directories):
    found = {}
    strikes_by_key = {}
    expiries_by_key = {}
    lot_by_key = {}
    for exchange, rows in directories.items():
        for row in master_rows(rows):
            kind = str(row.get('instrument_type', ''))
            symbol = row.get('symbol')
            if (
                not (kind.startswith('OPT') or kind in ('IO', 'SO'))
                or not isinstance(symbol, str)
                or not re.fullmatch(r'[A-Z0-9&._ -]{1,50}', symbol)
            ):
                continue
            key = exchange + '|' + symbol
            if key not in found:
                found[key] = {
                    'symbol': symbol,
                    'exchange': exchange,
                    'kind': 'index' if 'IDX' in kind or kind == 'IO' else 'stock',
                    'underlying': INDEX_NAMES.get(symbol, symbol),
                    'instrumentType': kind,
                }
            try:
                lot = int(float(row.get('lot_size') or 0))
                if lot > 0 and (key not in lot_by_key or lot < lot_by_key[key]):
                    lot_by_key[key] = lot
            except (TypeError, ValueError):
                pass
            try:
                sp = float(row.get('strike_price') or 0)
                if sp > 0:
                    strikes_by_key.setdefault(key, set()).add(round(sp, 2))
            except (TypeError, ValueError):
                pass
            exp_raw = row.get('expiry_date')
            if exp_raw is not None:
                expiries_by_key.setdefault(key, set()).add(str(exp_raw))

    result = []
    for key, item in found.items():
        enriched = dict(item)
        if key in lot_by_key:
            enriched['lotSize'] = lot_by_key[key]
        strikes = sorted(strikes_by_key.get(key, ()))
        if len(strikes) >= 2:
            diffs = [round(b - a, 2) for a, b in zip(strikes, strikes[1:]) if b - a > 0]
            if diffs:
                enriched['strikeInterval'] = Counter(diffs).most_common(1)[0][0]
        if key in expiries_by_key:
            enriched['expiryCount'] = len(expiries_by_key[key])
        result.append(enriched)

    return sorted(result, key=lambda r: (r['exchange'], r['kind'] != 'index', r['symbol']))


def observations(result, start, end):
    out = {}
    for r in result:
        try:
            t = datetime.strptime(r['time'], '%Y-%m-%d %H:%M:%S')
            if not start <= t.strftime('%Y-%m-%d') <= end or not '09:15' <= t.strftime('%H:%M') <= '15:30':
                continue
            stamp = t.strftime('%Y-%m-%dT%H:%M')
            close = float(r['close'])
            vol = float(r['volume'])
            if not 0 <= close < 1e7 or not 0 <= vol < 1e15:
                continue
            row = {'timestamp': stamp, 'close': close, 'volume': vol}
            if stamp in out and out[stamp] != row:
                raise HTTPException(502, 'Conflicting broker minute observations')
            out[stamp] = row
        except (ValueError, KeyError, TypeError):
            continue
    return [out[k] for k in sorted(out)]


def install_history(app, session, broker, market, prefix, snapshots: SnapshotStore = None):
    from nifty_backup import NiftyBackup

    backup = NiftyBackup()
    snap_store = snapshots or SnapshotStore()
    app.state.snapshots = snap_store

    def remember(result, kind):
        try:
            backup.remember(result['dataset'], kind)
        except (OSError, ValueError, sqlite3.Error):
            pass
        return result

    def fallback(error, underlying, exch, expiry, start='', end='', kind='minute'):
        # 1. Check genuinely recorded SnapshotStore frames first (for ANY symbol/exchange!)
        if start and end:
            try:
                snap_res = snap_store.load_replay(underlying, exch, expiry, start, end)
                snap_res['notice'] = (
                    f"Broker live history unavailable ({error.detail}). "
                    f"Showing genuinely recorded IWSM option-chain snapshots ({snap_res['dataset']['metadata']['frameCount']} timestamps)."
                )
                return snap_res
            except (LookupError, ValueError, OSError, sqlite3.Error):
                pass
        # 2. Check local 5-year NIFTY SQLite backup
        if underlying == 'NIFTY' and exch == 'nse_fo' and error.status_code in (401, 403, 404, 422, 429, 500, 502, 503, 504):
            try:
                result = backup.load(expiry, start, end, kind)
                result['notice'] = 'Broker data unavailable. Showing local ' + result['resolution'] + ' backup as of ' + result['asOf'] + '.'
                return result
            except (ValueError, OSError, sqlite3.Error):
                pass
        # 3. Surface clear coverage diagnostics without fabricating data
        try:
            cov = snap_store.coverage(symbol=underlying, exchange=exch)
            if cov.get('earliestDate'):
                raise HTTPException(
                    error.status_code,
                    f"{error.detail} Earliest recorded local snapshot for {underlying}: {cov['earliestTimestamp']} IST.",
                )
        except (ValueError, OSError, sqlite3.Error):
            pass
        raise error

    masters = {}
    locks = {}
    cache = {}
    gate = asyncio.Lock()

    async def master(name):
        async with gate:
            if name not in masters or time.monotonic() - masters[name][0] > 3600:
                try:
                    async with httpx.AsyncClient(timeout=40, follow_redirects=False) as client:
                        r = await client.get(MASTER + name)
                        r.raise_for_status()
                        j = r.json()
                    masters[name] = (time.monotonic(), j)
                except Exception:
                    raise HTTPException(502, 'Contract directory unavailable; retry shortly')
            return masters[name][1]

    async def reference(underlying, exch):
        exchange = 'NSE' if exch == 'nse_fo' else 'BSE'
        indices = await master('INDICES')
        name = INDEX_NAMES.get(underlying, underlying)
        ref = next((r for r in indices.get(exchange, []) if r.get('symbol') == name), None)
        if ref:
            return ref, exchange, exchange + '::index'
        rows = master_rows(await master(exchange))
        ref = next(
            (r for r in rows if r.get('symbol') == underlying and (r.get('group_name') == 'EQ' or r.get('instrument_type') in ('EQ', 'EQUITY'))),
            None,
        )
        return ref, exchange, exchange

    @app.get(prefix + '/market-status')
    async def get_market_status(underlying: str = '', exch: str = ''):
        cov = snap_store.coverage(symbol=underlying, exchange=exch)
        return {
            'marketStatus': market_status_ist(),
            'snapshotCoverage': cov,
        }

    @app.get(prefix + '/instruments')
    async def instruments(req: Request):
        directories = {}
        unavailable = []
        for exch, name in [('nse_fo', 'NFO'), ('bse_fo', 'BFO')]:
            try:
                directories[exch] = await master(name)
            except HTTPException:
                unavailable.append(exch)
        if not directories:
            raise HTTPException(503, 'Alice Blue instrument directory unavailable; retry shortly')
        rows = instrument_catalog(directories)
        try:
            session(req)
            connected = True
        except HTTPException:
            connected = False
        if connected:
            for exch in directories:
                try:
                    available = set((await market(req, 'underlyings', exch))['underlyings'])
                    for row in rows:
                        if row['exchange'] == exch:
                            row['chainAvailable'] = row['symbol'] in available
                except HTTPException:
                    pass
        return {
            'instruments': rows,
            'brokerConnected': connected,
            'unavailableExchanges': unavailable,
            'marketStatus': market_status_ist(),
            'source': 'Alice Blue contract master',
            'scope': 'All currently listed NSE/BSE option underlyings; chain availability checked against broker API when connected',
        }

    async def capture_snapshot_with_token(token: str, underlying: str, expiry: str, exch: str = 'nse_fo', chain_payload=None):
        if exch not in ('nse_fo', 'bse_fo'):
            raise HTTPException(422, 'Select an NSE or BSE option underlying')
        if chain_payload is None:
            raw = await broker.post(
                '/obrest/optionChain/getOptionChain',
                {'exch': exch, 'underlying': underlying, 'expiry': expiry, 'interval': 25},
                token,
            )
            from alice_service import normalize
            chain_payload = normalize(raw, underlying, expiry, exch)

        records = master_rows(await master('NFO' if exch == 'nse_fo' else 'BFO'))
        by_symbol = {r.get('trading_symbol'): r for r in records}
        now = datetime.now(IST)
        stamp = now.strftime('%Y-%m-%dT%H:%M')
        iso = normalize_expiry_iso(expiry)
        if iso < now.strftime('%Y-%m-%d') or (iso == now.strftime('%Y-%m-%d') and now.strftime('%H:%M') > '15:30'):
            raise HTTPException(422, 'Contract has expired; select a later expiry')

        spots = []
        warnings = []
        india_vix = None
        spot_price = None
        try:
            ref, exchange, _ = await reference(underlying, exch)
            batch = [{'exchange': 'NSE', 'token': INDIA_VIX_TOKEN}]
            if ref:
                batch.insert(0, {'exchange': exchange, 'token': str(ref['token'])})
            quote = await broker.post('/open-api/od/ChartAPIService/chart/get/multi/ohlc', batch, token)
            for q in quote.get('result', []):
                tk = str(q.get('tk', ''))
                try:
                    ltp_q = float(q.get('ltp') or 0)
                except (TypeError, ValueError):
                    ltp_q = 0.0
                if ltp_q <= 0:
                    continue
                if ref and tk == str(ref['token']):
                    spot_price = ltp_q
                if tk == INDIA_VIX_TOKEN:
                    india_vix = ltp_q
            if spot_price is not None:
                s_item = {'timestamp': stamp, 'symbol': underlying, 'close': spot_price}
                if india_vix is not None:
                    s_item['indiaVix'] = india_vix
                spots = [s_item]
        except HTTPException as e:
            if e.status_code == 401:
                raise
            warnings.append('Underlying quote unavailable from broker')

        future = front_future(records, underlying, now.strftime('%Y-%m-%d'), target_expiry_iso=iso)
        futures_price = None
        futures_expiry = ''
        if future:
            try:
                result = await broker.post(
                    '/open-api/od/ChartAPIService/chart/get/multi/ohlc',
                    [{'exchange': 'NFO' if exch == 'nse_fo' else 'BFO', 'token': str(future['token'])}],
                    token,
                )
                for q in result.get('result', []):
                    try:
                        price = float(q.get('ltp'))
                    except (ValueError, TypeError):
                        continue
                    if str(q.get('tk')) == str(future['token']) and 0 < price < 1e7:
                        futures_price = price
                        futures_expiry = future['expiryISO']
            except HTTPException as e:
                if e.status_code == 401:
                    raise
                warnings.append('Futures quote unavailable from broker')

        exp_dt = datetime.strptime(iso + 'T15:30', '%Y-%m-%dT%H:%M').replace(tzinfo=IST)
        t_years = max(0.0, (exp_dt - now).total_seconds() / (365.0 * 86400.0))
        ref_price = futures_price if (futures_price and futures_price > 0) else spot_price
        is_fut_basis = bool(futures_price and futures_price > 0)

        contracts = []
        resolved_lot = 0
        for row in chain_payload['rows']:
            for side in ('CE', 'PE'):
                leg = row.get(side)
                meta = by_symbol.get(leg['symbol']) if leg else None
                if not meta or leg.get('ltp') is None:
                    continue
                lot = int(meta.get('lot_size') or 0)
                if lot <= 0:
                    continue
                resolved_lot = resolved_lot or lot
                iv = delta = gamma = theta = vega = rho = None
                if ref_price and leg['ltp'] > 0 and t_years > 1e-6:
                    solved = solve_iv_and_greeks(leg['ltp'], ref_price, row['strike'], t_years, side, is_futures_basis=is_fut_basis)
                    if solved is not None:
                        iv, delta, gamma, theta, vega, rho = solved
                contracts.append({
                    'timestamp': stamp,
                    'symbol': underlying,
                    'expiry': iso,
                    'type': side,
                    'strike': row['strike'],
                    'close': leg['ltp'],
                    'bid': leg.get('bid'),
                    'ask': leg.get('ask'),
                    'lotSize': lot,
                    'oi': leg.get('oi'),
                    'previousOi': leg.get('previousOi'),
                    'oiChange': leg.get('oiChange'),
                    'previousClose': leg.get('previousClose'),
                    'volume': leg.get('volume'),
                    'iv': iv,
                    'delta': delta,
                    'gamma': gamma,
                    'theta': theta,
                    'vega': vega,
                    'rho': rho,
                    'greeksSource': 'calculated_bsm' if iv is not None else None,
                })

        if futures_price and future:
            contracts.append({
                'timestamp': stamp,
                'symbol': underlying,
                'expiry': futures_expiry,
                'type': 'FUT',
                'strike': 0,
                'close': futures_price,
                'lotSize': int(future['lot_size']),
                'oi': None,
                'volume': None,
            })

        if not any(c['type'] in ('CE', 'PE') for c in contracts):
            raise HTTPException(404, 'No available option prices for this selection')
        if not spots:
            warnings.append('Matching underlying quote unavailable; spot analytics and short-position margin require a recorded underlying price')
        if future and not futures_price:
            warnings.append('Matching futures quote unavailable')
        warnings = list(dict.fromkeys(warnings))

        recorded_info = None
        if resolved_lot > 0:
            try:
                recorded_info = snap_store.record_chain_snapshot(
                    underlying,
                    exch,
                    iso,
                    stamp,
                    chain_payload['rows'],
                    expiry_code=expiry,
                    captured_at=now.isoformat(),
                    spot=spot_price,
                    futures_price=futures_price,
                    futures_expiry=futures_expiry,
                    india_vix=india_vix,
                    lot_size=resolved_lot,
                    source='Alice Blue latest option-chain snapshot',
                )
            except (ValueError, OSError, sqlite3.Error):
                recorded_info = None

        cov = snap_store.coverage(symbol=underlying, exchange=exch)
        return {
            'dataset': {
                'source': 'Alice Blue latest option-chain snapshot',
                'contracts': contracts,
                'underlying': spots,
                'metadata': {
                    'modelled': False,
                    'exchange': exch,
                    'capturedAt': now.isoformat(),
                    'marketStatus': market_status_ist(now),
                    'indiaVix': india_vix,
                    'snapshotRecorded': bool(recorded_info and recorded_info.get('recorded')),
                    'earliestRecordedTimestamp': cov.get('earliestTimestamp'),
                    'earliestRecordedDate': cov.get('earliestDate'),
                    'greeksSource': 'Calculated (Black-76 / BSM, r=6.50%, ACT/365)',
                    'warnings': warnings,
                    'quoteTiming': 'Snapshot capture time (IST); persisted to local historical snapshot store.',
                },
            }
        }

    async def live_snapshot(req: Request, underlying: str, expiry: str, exch: str = 'nse_fo'):
        _, auth = session(req)
        if exch not in ('nse_fo', 'bse_fo'):
            raise HTTPException(422, 'Select an NSE or BSE option underlying')
        chain = await market(req, 'option-chain', exch, underlying, expiry, 25)
        return await capture_snapshot_with_token(auth['token'], underlying, expiry, exch, chain_payload=chain)

    async def live_replay(req: Request, underlying: str, expiry: str, start: str, end: str, exch: str = 'nse_fo', interval: int = 15):
        _, auth = session(req)
        if exch not in ('nse_fo', 'bse_fo') or interval not in (5, 10, 15, 20, 25):
            raise HTTPException(422, 'Select a supported option exchange and strike interval')
        contract_exchange = 'NFO' if exch == 'nse_fo' else 'BFO'
        try:
            lo = datetime.strptime(start, '%Y-%m-%d').replace(tzinfo=IST)
            hi = datetime.strptime(end, '%Y-%m-%d').replace(tzinfo=IST)
            if not 0 <= (hi - lo).days <= 6 or hi.date() > datetime.now(IST).date():
                raise ValueError()
        except ValueError:
            raise HTTPException(422, 'Select up to seven historical calendar days on or before today (IST)')

        key = (hashlib.sha256(auth['token'].encode()).hexdigest(), exch, underlying, expiry, start, end, interval)
        if len(locks) > 128:
            raise HTTPException(429, 'Too many history selections; retry after service restart')
        async with locks.setdefault(key, asyncio.Lock()):
            if key in cache:
                return {'dataset': cache[key], 'cached': True}
            chain = await market(req, 'option-chain', exch, underlying, expiry, interval)
            directory = await master(contract_exchange)
            records = master_rows(directory)
            by_symbol = {r.get('trading_symbol'): r for r in records}
            contracts = []
            spots = []

            async def history(token, exchange):
                body = {
                    'token': str(token),
                    'resolution': '1',
                    'from': str(int((lo + timedelta(hours=9, minutes=15)).timestamp() * 1000)),
                    'to': str(int((hi + timedelta(hours=15, minutes=30)).timestamp() * 1000)),
                    'exchange': exchange,
                }
                j = await broker.post('/open-api/od/ChartAPIService/api/chart/history', body, auth['token'])
                if not isinstance(j.get('result'), list):
                    raise HTTPException(502, 'Broker did not return minute history')
                return observations(j['result'], start, end)

            iso = normalize_expiry_iso(expiry)
            for row in chain['rows']:
                for side in ('CE', 'PE'):
                    leg = row.get(side)
                    meta = by_symbol.get(leg['symbol']) if leg else None
                    if not meta:
                        continue
                    lot = int(meta.get('lot_size') or 0)
                    if lot < 1:
                        continue
                    for bar in await history(meta['token'], contract_exchange):
                        contracts.append({
                            **bar,
                            'symbol': underlying,
                            'expiry': iso,
                            'type': side,
                            'strike': row['strike'],
                            'lotSize': lot,
                            'oi': None,
                        })

            future = front_future(records, underlying, end, target_expiry_iso=iso)
            if future and int(future.get('lot_size') or 0) > 0:
                for bar in await history(future['token'], contract_exchange):
                    contracts.append({
                        **bar,
                        'symbol': underlying,
                        'expiry': future['expiryISO'],
                        'type': 'FUT',
                        'strike': 0,
                        'lotSize': int(future['lot_size']),
                        'oi': None,
                    })

            if not any(r['type'] != 'FUT' for r in contracts):
                raise HTTPException(
                    404,
                    'No minute option observations for this date and current-expiry strike window. Expired-contract minute history is not supplied by this broker.',
                )

            vix_by_ts = {}
            if exch == 'nse_fo':
                try:
                    nse_indices = (await master('INDICES')).get('NSE', [])
                    vix_ref = next((r for r in nse_indices if r.get('symbol') == 'INDIA VIX'), None)
                    if vix_ref:
                        for bar in await history(vix_ref['token'], 'NSE::index'):
                            if bar['close'] > 0:
                                vix_by_ts[bar['timestamp']] = bar['close']
                except HTTPException:
                    pass

            ref, _, exchange = await reference(underlying, exch)
            if ref:
                for bar in await history(ref['token'], exchange):
                    if bar['close'] > 0:
                        u_row = {**bar, 'symbol': underlying}
                        if bar['timestamp'] in vix_by_ts:
                            u_row['indiaVix'] = vix_by_ts[bar['timestamp']]
                        spots.append(u_row)

            cov = snap_store.coverage(symbol=underlying, exchange=exch)
            dataset = {
                'source': 'Alice Blue recorded minute closes',
                'contracts': contracts,
                'underlying': spots,
                'metadata': {
                    'exchange': exch,
                    'resolution': '1 minute',
                    'quoteTiming': 'Completed minute close; bar labelled by its minute in IST',
                    'modelled': False,
                    'marketStatus': market_status_ist(),
                    'earliestRecordedSnapshotDate': cov.get('earliestDate'),
                    'historyScope': f'Current-expiry contracts only; ±{interval} strikes around latest market reference (historical OI/bid-ask require recorded snapshots)',
                },
            }
            if len(cache) >= 12:
                cache.pop(next(iter(cache)))
            cache[key] = dataset
            return {'dataset': dataset, 'cached': False}

    @app.get(prefix + '/snapshot')
    async def snapshot(req: Request, underlying: str, expiry: str, exch: str = 'nse_fo'):
        try:
            return remember(await live_snapshot(req, underlying, expiry, exch), 'snapshot')
        except HTTPException as e:
            return fallback(e, underlying, exch, expiry, kind='snapshot')

    @app.get(prefix + '/replay')
    async def replay(
        req: Request,
        underlying: str,
        expiry: str,
        start: str,
        end: str,
        exch: str = 'nse_fo',
        interval: int = 15,
        source: str = 'auto',
    ):
        if source == 'snapshots':
            try:
                return snap_store.load_replay(underlying, exch, expiry, start, end)
            except LookupError as exc:
                raise HTTPException(404, str(exc)) from None
            except ValueError as exc:
                raise HTTPException(422, str(exc)) from None
        try:
            return remember(await live_replay(req, underlying, expiry, start, end, exch, interval=interval), 'minute')
        except HTTPException as e:
            return fallback(e, underlying, exch, expiry, start, end)

    @app.get(prefix + '/snapshots/coverage')
    async def snapshots_coverage(underlying: str = '', exch: str = '', expiry: str = ''):
        try:
            return snap_store.coverage(symbol=underlying, exchange=exch, expiry=expiry)
        except ValueError as exc:
            raise HTTPException(422, str(exc)) from None

    @app.get(prefix + '/snapshots/replay')
    async def snapshots_replay(underlying: str, expiry: str, start: str, end: str, exch: str = 'nse_fo'):
        try:
            return snap_store.load_replay(underlying, exch, expiry, start, end)
        except LookupError as exc:
            raise HTTPException(404, str(exc)) from None
        except ValueError as exc:
            raise HTTPException(422, str(exc)) from None

    @app.post(prefix + '/snapshots/record')
    async def snapshots_record(req: Request):
        try:
            body = await req.json()
        except Exception:
            body = {}
        underlying = str(body.get('underlying') or req.query_params.get('underlying') or '').strip().upper()
        expiry = str(body.get('expiry') or req.query_params.get('expiry') or '').strip().upper()
        exch = str(body.get('exch') or req.query_params.get('exch') or 'nse_fo').strip().lower()
        if not underlying or not expiry:
            raise HTTPException(422, 'Specify underlying and expiry to record a snapshot')
        res = await live_snapshot(req, underlying, expiry, exch)
        remember(res, 'snapshot')
        return {
            'recorded': True,
            'dataset': res['dataset'],
            'coverage': snap_store.coverage(symbol=underlying, exchange=exch),
        }

    recorder_state = {
        'enabled': False,
        'intervalSeconds': 60,
        'targets': [],
        'lastRunAt': None,
        'lastStatus': 'idle',
        'capturedFrames': 0,
        'task': None,
    }
    app.state.recorder = recorder_state

    async def recorder_loop():
        while recorder_state['enabled']:
            m_status = market_status_ist()
            token = app.state.store.latest_token() if hasattr(app.state, 'store') else None
            if not m_status['isOpen']:
                recorder_state['lastStatus'] = f"Paused ({m_status['reason']})"
            elif not token:
                recorder_state['lastStatus'] = 'Waiting for active Alice Blue session'
            else:
                for target in list(recorder_state['targets']):
                    try:
                        await capture_snapshot_with_token(
                            token,
                            target['underlying'],
                            target['expiry'],
                            target.get('exch', 'nse_fo'),
                        )
                        recorder_state['capturedFrames'] += 1
                        recorder_state['lastRunAt'] = datetime.now(IST).isoformat()
                        recorder_state['lastStatus'] = 'Active (recording IST snapshots)'
                    except Exception as exc:
                        recorder_state['lastStatus'] = f'Warning on {target.get("underlying")}: {getattr(exc, "detail", "capture skipped")}'
            await asyncio.sleep(max(30, int(recorder_state['intervalSeconds'])))

    @app.get(prefix + '/recorder/status')
    async def get_recorder_status():
        return {
            'enabled': recorder_state['enabled'],
            'intervalSeconds': recorder_state['intervalSeconds'],
            'targets': recorder_state['targets'],
            'lastRunAt': recorder_state['lastRunAt'],
            'lastStatus': recorder_state['lastStatus'],
            'capturedFrames': recorder_state['capturedFrames'],
            'marketStatus': market_status_ist(),
            'coverage': snap_store.coverage(),
        }

    @app.post(prefix + '/recorder/configure')
    async def configure_recorder(req: Request):
        session(req)  # Require authenticated broker session to configure background recorder
        try:
            body = await req.json()
        except Exception:
            raise HTTPException(422, 'Invalid JSON configuration')
        enabled = bool(body.get('enabled', True))
        interval_sec = max(30, min(900, int(body.get('intervalSeconds', 60))))
        raw_targets = body.get('targets') or []
        targets = []
        for t in raw_targets[:10]:
            u = str(t.get('underlying', '')).strip().upper()
            e = str(t.get('expiry', '')).strip().upper()
            x = str(t.get('exch', 'nse_fo')).strip().lower()
            if re.fullmatch(r'[A-Z0-9&._ -]{1,50}', u) and e and x in ('nse_fo', 'bse_fo'):
                targets.append({'underlying': u, 'expiry': e, 'exch': x})
        if enabled and not targets:
            raise HTTPException(422, 'Provide at least one underlying/expiry target to enable background recording')
        recorder_state['intervalSeconds'] = interval_sec
        recorder_state['targets'] = targets
        recorder_state['enabled'] = enabled
        old_task = recorder_state.get('task')
        if old_task and not old_task.done():
            old_task.cancel()
        if enabled:
            recorder_state['lastStatus'] = 'Scheduled'
            recorder_state['task'] = asyncio.create_task(recorder_loop())
        else:
            recorder_state['lastStatus'] = 'Stopped'
            recorder_state['task'] = None
        return await get_recorder_status()

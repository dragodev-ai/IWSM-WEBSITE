"""High-speed read-only NSE India Option-Chain v3 + 1-Minute Intraday Chart client with automatic cookie warmup and TTL caching."""
from __future__ import annotations

import asyncio
import time
import urllib.parse
from datetime import datetime, timedelta, timezone
import httpx
from snapshot_store import normalize_expiry_iso, iso_to_broker_expiry, solve_iv_and_greeks

IST = timezone(timedelta(hours=5, minutes=30))
NSE_INDEX_SYMBOLS = {"NIFTY", "BANKNIFTY", "FINNIFTY", "MIDCPNIFTY", "NIFTYNXT50"}
NSE_INDEX_CHART_NAMES = {
    "NIFTY": "NIFTY 50",
    "BANKNIFTY": "NIFTY BANK",
    "FINNIFTY": "NIFTY FIN SERVICE",
    "MIDCPNIFTY": "NIFTY MID SELECT",
    "NIFTYNXT50": "NIFTY NEXT 50",
}

DEFAULT_LOT_SIZES = {
    "NIFTY": 75,
    "BANKNIFTY": 30,
    "FINNIFTY": 65,
    "MIDCPNIFTY": 120,
    "NIFTYNXT50": 25,
    "RELIANCE": 500,
    "HDFCBANK": 550,
    "ICICIBANK": 700,
    "SBIN": 750,
    "TCS": 175,
    "INFY": 400,
    "IDEA": 36125,
}


def _iso_to_nse_expiry(expiry: str) -> str:
    iso = normalize_expiry_iso(expiry)
    dt = datetime.strptime(iso, "%Y-%m-%d")
    return dt.strftime("%d-%b-%Y")


def _nse_to_iso(exp_str: str) -> str:
    try:
        return datetime.strptime(exp_str.strip(), "%d-%b-%Y").strftime("%Y-%m-%d")
    except ValueError:
        return normalize_expiry_iso(exp_str)


def _bucket_nse_ist_minutes(pts: list, start_date: str = "", end_date: str = "", skip_preopen: bool = False) -> dict[str, float]:
    """Convert NSE epoch-ms (IST wall-clock encoded as UTC ms) points into YYYY-MM-DDTHH:MM minute closes."""
    out: dict[str, float] = {}
    for row in pts or []:
        if not isinstance(row, (list, tuple)) or len(row) < 2:
            continue
        if skip_preopen and len(row) >= 3 and row[2] == "PO":
            continue
        try:
            ms = float(row[0])
            price = float(row[1])
        except (TypeError, ValueError):
            continue
        if not (0.0 < price < 1e7):
            continue
        try:
            dt = datetime.fromtimestamp(ms / 1000.0, timezone.utc)
        except (OSError, OverflowError, ValueError):
            continue
        date_s = dt.strftime("%Y-%m-%d")
        hhmm = dt.strftime("%H:%M")
        if not ("09:15" <= hhmm <= "15:30"):
            continue
        if start_date and date_s < start_date:
            continue
        if end_date and date_s > end_date:
            continue
        out[f"{date_s}T{hhmm}"] = round(price, 2)
    return out


class NseLiveOptionChain:
    def __init__(self, transport=None, ttl_seconds: float = 5.0):
        self.ttl_seconds = ttl_seconds
        self._warmed_at = 0.0
        self._lock = asyncio.Lock()
        self._cache: dict[tuple[str, str], tuple[float, dict]] = {}
        self._intraday_cache: dict[tuple, tuple[float, dict]] = {}
        self._exp_cache: dict[str, tuple[float, list[str]]] = {}
        self.http = httpx.AsyncClient(
            timeout=httpx.Timeout(14.0),
            follow_redirects=True,
            transport=transport,
            limits=httpx.Limits(max_connections=24, max_keepalive_connections=16),
            headers={
                "User-Agent": (
                    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
                    "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36"
                ),
                "Accept": "application/json, text/plain, */*",
                "Accept-Language": "en-US,en;q=0.9",
                "Referer": "https://www.nseindia.com/option-chain",
            },
        )

    async def aclose(self):
        await self.http.aclose()

    async def _ensure_cookies(self, force: bool = False):
        now = time.monotonic()
        if not force and self._warmed_at and (now - self._warmed_at) < 240.0:
            return
        async with self._lock:
            now = time.monotonic()
            if not force and self._warmed_at and (now - self._warmed_at) < 240.0:
                return
            await self.http.get(
                "https://www.nseindia.com/option-chain",
                headers={"Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8"},
            )
            self._warmed_at = time.monotonic()

    async def _get_json(self, url: str) -> dict:
        await self._ensure_cookies(force=False)
        resp = await self.http.get(url)
        if resp.status_code in (401, 403):
            await self._ensure_cookies(force=True)
            resp = await self.http.get(url)
        resp.raise_for_status()
        data = resp.json()
        return data if isinstance(data, dict) else {}

    async def expiries(self, symbol: str) -> list[str]:
        sym = symbol.strip().upper()
        now = time.monotonic()
        hit = self._exp_cache.get(sym)
        if hit and (now - hit[0]) < 60.0:
            return list(hit[1])
        qsym = urllib.parse.quote(sym, safe="")
        data = await self._get_json(f"https://www.nseindia.com/api/option-chain-contract-info?symbol={qsym}")
        raw_exps = data.get("expiryDates") or []
        iso_list = []
        for raw in raw_exps:
            try:
                iso_list.append(_nse_to_iso(str(raw)))
            except Exception:
                continue
        if iso_list:
            self._exp_cache[sym] = (now, iso_list)
        return iso_list

    async def fetch_expiries(self, symbol: str) -> list[str]:
        iso_list = await self.expiries(symbol)
        today_iso = datetime.now(IST).strftime("%Y-%m-%d")
        return [iso_to_broker_expiry(x) for x in sorted(iso_list) if x >= today_iso]

    async def snapshot_dataset(self, symbol: str, expiry: str, lot_size: int | None = None) -> dict:
        sym = symbol.strip().upper()
        iso_exp = normalize_expiry_iso(expiry)
        nse_exp = _iso_to_nse_expiry(iso_exp)
        unit_lot = int(lot_size) if (lot_size and int(lot_size) > 0) else int(DEFAULT_LOT_SIZES.get(sym, 1))
        ckey = (sym, iso_exp, unit_lot)
        now_m = time.monotonic()
        hit = self._cache.get(ckey)
        if hit and (now_m - hit[0]) < self.ttl_seconds:
            return hit[1]

        opt_type = "Indices" if sym in NSE_INDEX_SYMBOLS else "Equity"
        qsym = urllib.parse.quote(sym, safe="")
        qexp = urllib.parse.quote(nse_exp, safe="")
        url = f"https://www.nseindia.com/api/option-chain-v3?type={opt_type}&symbol={qsym}&expiry={qexp}"
        payload = await self._get_json(url)
        records = payload.get("records") or {}
        rows = records.get("data") or []
        if not rows:
            raise ValueError(f"No live NSE option-chain rows returned for {sym} {iso_exp}")

        spot = records.get("underlyingValue")
        spot_f = float(spot) if isinstance(spot, (int, float)) and spot > 0 else None
        stamp = datetime.now(IST).strftime("%Y-%m-%dT%H:%M")
        dte = max((datetime.strptime(iso_exp, "%Y-%m-%d") - datetime.now(IST).replace(tzinfo=None)).total_seconds() / 86400.0, 1.0 / 1440.0)
        T = dte / 365.0

        contracts = []
        for row in rows:
            strike = row.get("strikePrice")
            if not isinstance(strike, (int, float)) or strike <= 0:
                continue
            for side in ("CE", "PE"):
                leg = row.get(side)
                if not isinstance(leg, dict):
                    continue
                ltp = leg.get("lastPrice")
                if not isinstance(ltp, (int, float)) or ltp <= 0:
                    continue
                bid = leg.get("buyPrice1") if isinstance(leg.get("buyPrice1"), (int, float)) and leg.get("buyPrice1") > 0 else None
                ask = leg.get("sellPrice1") if isinstance(leg.get("sellPrice1"), (int, float)) and leg.get("sellPrice1") > 0 else None
                oi_lots = leg.get("openInterest")
                chg_oi_lots = leg.get("changeinOpenInterest")
                vol = leg.get("totalTradedVolume")
                nse_iv = leg.get("impliedVolatility")
                solved = (
                    solve_iv_and_greeks(float(ltp), spot_f or float(strike), float(strike), T, side)
                    if (spot_f or strike) and ltp > 0 and T > 1e-6
                    else None
                )
                iv_val, delta, gamma, theta, vega, rho = solved if solved is not None else (None, None, None, None, None, None)
                contracts.append({
                    "timestamp": stamp,
                    "symbol": sym,
                    "expiry": iso_exp,
                    "type": side,
                    "strike": float(strike),
                    "open": float(ltp),
                    "high": float(ltp),
                    "low": float(ltp),
                    "close": float(ltp),
                    "ltp": float(ltp),
                    "bid": float(bid) if bid is not None else None,
                    "ask": float(ask) if ask is not None else None,
                    "volume": int(vol) if isinstance(vol, (int, float)) else None,
                    "oi": int(oi_lots * unit_lot) if isinstance(oi_lots, (int, float)) else None,
                    "oiChange": int(chg_oi_lots * unit_lot) if isinstance(chg_oi_lots, (int, float)) else None,
                    "iv": round(float(nse_iv), 2) if isinstance(nse_iv, (int, float)) and nse_iv > 0 else iv_val,
                    "delta": delta,
                    "gamma": gamma,
                    "theta": theta,
                    "vega": vega,
                    "rho": rho,
                    "greeksSource": "exchange_nse" if isinstance(nse_iv, (int, float)) and nse_iv > 0 else ("calculated_bsm" if iv_val is not None else None),
                    "lotSize": unit_lot,
                    "spot": spot_f,
                })

        if not contracts:
            raise ValueError(f"No traded contracts in NSE option chain for {sym} {iso_exp}")

        result = {
            "source": "IWSM Live Exchange Snapshot",
            "kind": "intraday",
            "contracts": contracts,
            "underlying": [{"symbol": sym, "timestamp": stamp, "open": spot_f, "high": spot_f, "low": spot_f, "close": spot_f}] if spot_f else [],
            "metadata": {
                "synthetic": False,
                "modelled": False,
                "exchange": "nse_fo",
                "baseIntervalMinutes": 1,
                "singleSnapshot": True,
                "capturedAt": datetime.now(IST).isoformat(),
                "spotPrice": spot_f,
                "quoteTiming": "Snapshot capture time (IST); persisted to local historical snapshot store.",
                "warnings": [],
            },
        }
        if len(self._cache) >= 64:
            self._cache.pop(next(iter(self._cache)))
        self._cache[ckey] = (now_m, result)
        return result

    async def intraday_minute_dataset(
        self,
        symbol: str,
        expiry: str,
        start: str = "",
        end: str = "",
        lot_size: int | None = None,
        futures_expiry_iso: str = "",
        futures_lot_size: int | None = None,
        strike_window: int = 12,
    ) -> dict:
        """Fetch genuine 1-minute intraday option-chain + futures + spot + India VIX bars from NSE official feeds."""
        sym = symbol.strip().upper()
        iso_exp = normalize_expiry_iso(expiry)
        nse_exp = _iso_to_nse_expiry(iso_exp)
        unit_lot = int(lot_size) if (lot_size and int(lot_size) > 0) else int(DEFAULT_LOT_SIZES.get(sym, 1))
        fut_iso = normalize_expiry_iso(futures_expiry_iso) if futures_expiry_iso else iso_exp
        fut_lot = int(futures_lot_size) if (futures_lot_size and int(futures_lot_size) > 0) else unit_lot

        ckey = (sym, iso_exp, start, end, unit_lot, fut_iso, strike_window)
        now_m = time.monotonic()
        hit = self._intraday_cache.get(ckey)
        if hit and (now_m - hit[0]) < 30.0:
            return hit[1]

        opt_type = "Indices" if sym in NSE_INDEX_SYMBOLS else "Equity"
        qsym = urllib.parse.quote(sym, safe="")
        qexp = urllib.parse.quote(nse_exp, safe="")
        payload = await self._get_json(
            f"https://www.nseindia.com/api/option-chain-v3?type={opt_type}&symbol={qsym}&expiry={qexp}"
        )
        records = payload.get("records") or {}
        rows = records.get("data") or []
        if not rows:
            raise LookupError(f"No live NSE option-chain rows returned for {sym} {iso_exp}")

        spot_live_raw = records.get("underlyingValue")
        spot_live = float(spot_live_raw) if isinstance(spot_live_raw, (int, float)) and spot_live_raw > 0 else None

        all_strikes = sorted(
            {
                float(r["strikePrice"])
                for r in rows
                if isinstance(r.get("strikePrice"), (int, float)) and r["strikePrice"] > 0
            }
        )
        if not all_strikes:
            raise LookupError(f"No valid option strikes for {sym} {iso_exp}")

        center = spot_live if (spot_live and spot_live > 0) else all_strikes[len(all_strikes) // 2]
        atm_idx = min(range(len(all_strikes)), key=lambda idx: abs(all_strikes[idx] - center))
        chosen_strikes = set(all_strikes[max(0, atm_idx - strike_window) : atm_idx + strike_window + 1])

        leg_specs: list[tuple[float, str, str, dict]] = []
        for row in rows:
            st_raw = row.get("strikePrice")
            if not isinstance(st_raw, (int, float)):
                continue
            st = float(st_raw)
            if st not in chosen_strikes:
                continue
            for side in ("CE", "PE"):
                leg = row.get(side)
                if isinstance(leg, dict) and leg.get("identifier"):
                    leg_specs.append((st, side, str(leg["identifier"]), leg))

        if not leg_specs:
            raise LookupError(f"No option contract identifiers available for {sym} {iso_exp}")

        sem = asyncio.Semaphore(14)

        async def _fetch_contract_chart(ident: str) -> dict[str, float]:
            async with sem:
                try:
                    q_ident = urllib.parse.quote(ident, safe="")
                    ch = await self._get_json(f"https://www.nseindia.com/api/chart-databyindex?index={q_ident}")
                    return _bucket_nse_ist_minutes(ch.get("grapthData") or [], start, end, skip_preopen=False)
                except Exception:
                    return {}

        async def _fetch_spot_chart() -> dict[str, float]:
            async with sem:
                try:
                    if sym in NSE_INDEX_CHART_NAMES:
                        q = urllib.parse.urlencode(
                            {"functionName": "getIndexChart", "index": NSE_INDEX_CHART_NAMES[sym], "flag": "1D"}
                        )
                        d = await self._get_json(f"https://www.nseindia.com/api/NextApi/apiClient/indexTrackerApi?{q}")
                        pts = (d.get("data") or {}).get("grapthData") if isinstance(d.get("data"), dict) else []
                        return _bucket_nse_ist_minutes(pts or [], start, end, skip_preopen=True)
                    for suffix in ("EQN", "BE"):
                        q = urllib.parse.urlencode(
                            {"functionName": "getSymbolgraphData", "identifier": f"{sym}{suffix}", "flag": "1D"}
                        )
                        d = await self._get_json(f"https://www.nseindia.com/api/NextApi/apiClient/marketWatchApi?{q}")
                        pts = d.get("grapthData") or []
                        mapped = _bucket_nse_ist_minutes(pts, start, end, skip_preopen=True)
                        if mapped:
                            return mapped
                except Exception:
                    pass
                return {}

        async def _fetch_vix_chart() -> dict[str, float]:
            async with sem:
                try:
                    q = urllib.parse.urlencode({"functionName": "getIndexChart", "index": "INDIA VIX", "flag": "1D"})
                    d = await self._get_json(f"https://www.nseindia.com/api/NextApi/apiClient/indexTrackerApi?{q}")
                    pts = (d.get("data") or {}).get("grapthData") if isinstance(d.get("data"), dict) else []
                    return _bucket_nse_ist_minutes(pts or [], start, end, skip_preopen=True)
                except Exception:
                    return {}

        fut_ddmmyyyy = datetime.strptime(fut_iso, "%Y-%m-%d").strftime("%d-%m-%Y")
        fut_prefix = "FUTIDX" if sym in NSE_INDEX_SYMBOLS else "FUTSTK"
        fut_ident = f"{fut_prefix}{sym}{fut_ddmmyyyy}XX0.00"

        tasks = [_fetch_contract_chart(ident) for _, _, ident, _ in leg_specs]
        tasks.append(_fetch_contract_chart(fut_ident))
        tasks.append(_fetch_spot_chart())
        tasks.append(_fetch_vix_chart())

        gathered = await asyncio.gather(*tasks)
        leg_maps: list[dict[str, float]] = list(gathered[: len(leg_specs)])
        fut_map: dict[str, float] = gathered[len(leg_specs)]
        spot_map: dict[str, float] = gathered[len(leg_specs) + 1]
        vix_map: dict[str, float] = gathered[len(leg_specs) + 2]

        exp_cutoff = f"{iso_exp}T15:30"
        opt_stamps = sorted({ts for mp in leg_maps for ts in mp if ts <= exp_cutoff})
        if not opt_stamps:
            raise LookupError(f"No live-session 1-minute option bars in window {start}..{end} for {sym} {iso_exp}")

        session_dates = sorted({ts[:10] for ts in opt_stamps})
        # Include spot/futures timestamps on the same active session date(s) so the minute timeline is contiguous
        all_stamps = sorted(
            {
                *opt_stamps,
                *(ts for ts in spot_map if ts[:10] in session_dates and ts <= exp_cutoff),
                *(ts for ts in fut_map if ts[:10] in session_dates and ts <= exp_cutoff),
            }
        )

        contracts: list[dict] = []
        for s_date in session_dates:
            day_stamps = [ts for ts in all_stamps if ts[:10] == s_date]
            if not day_stamps:
                continue
            last_stamp = day_stamps[-1]

            # Option contracts: carry latest traded price forward across the session's 1-minute grid once traded
            for (st, side, _, leg_meta), mp in zip(leg_specs, leg_maps):
                day_leg_pts = {ts: pr for ts, pr in mp.items() if ts[:10] == s_date}
                oi_lots = leg_meta.get("openInterest")
                oi_units = int(oi_lots * unit_lot) if isinstance(oi_lots, (int, float)) and oi_lots >= 0 else None
                chg_oi_lots = leg_meta.get("changeinOpenInterest")
                oi_chg = int(chg_oi_lots * unit_lot) if isinstance(chg_oi_lots, (int, float)) else None
                bid_live = (
                    float(leg_meta["buyPrice1"])
                    if isinstance(leg_meta.get("buyPrice1"), (int, float)) and leg_meta["buyPrice1"] > 0
                    else None
                )
                ask_live = (
                    float(leg_meta["sellPrice1"])
                    if isinstance(leg_meta.get("sellPrice1"), (int, float)) and leg_meta["sellPrice1"] > 0
                    else None
                )

                if not day_leg_pts:
                    ltp_fallback = leg_meta.get("lastPrice")
                    if isinstance(ltp_fallback, (int, float)) and ltp_fallback > 0:
                        contracts.append({
                            "timestamp": last_stamp,
                            "symbol": sym,
                            "expiry": iso_exp,
                            "type": side,
                            "strike": st,
                            "close": round(float(ltp_fallback), 2),
                            "lotSize": unit_lot,
                            "oi": oi_units,
                            "oiChange": oi_chg,
                            "volume": None,
                            "bid": bid_live,
                            "ask": ask_live,
                        })
                    continue

                # Seed initial price from first observed print so early 09:15+ frames also have full strike chain
                first_ts = min(day_leg_pts)
                cur_price = day_leg_pts[first_ts]
                for ts in day_stamps:
                    if ts in day_leg_pts:
                        cur_price = day_leg_pts[ts]
                    row_out = {
                        "timestamp": ts,
                        "symbol": sym,
                        "expiry": iso_exp,
                        "type": side,
                        "strike": st,
                        "close": cur_price,
                        "lotSize": unit_lot,
                        "oi": oi_units,
                        "oiChange": oi_chg,
                        "volume": None,
                    }
                    if ts == last_stamp:
                        if bid_live is not None:
                            row_out["bid"] = bid_live
                        if ask_live is not None:
                            row_out["ask"] = ask_live
                    contracts.append(row_out)

            # Futures contract 1-minute bars
            day_fut_pts = {ts: pr for ts, pr in fut_map.items() if ts[:10] == s_date and ts <= f"{fut_iso}T15:30"}
            if day_fut_pts:
                cur_fut = day_fut_pts[min(day_fut_pts)]
                for ts in day_stamps:
                    if ts > f"{fut_iso}T15:30":
                        continue
                    if ts in day_fut_pts:
                        cur_fut = day_fut_pts[ts]
                    if cur_fut > 0:
                        contracts.append({
                            "timestamp": ts,
                            "symbol": sym,
                            "expiry": fut_iso,
                            "type": "FUT",
                            "strike": 0,
                            "close": cur_fut,
                            "lotSize": fut_lot,
                            "oi": None,
                            "volume": None,
                        })

        # Underlying 1-minute spot + India VIX series aligned across all_stamps
        underlying_rows: list[dict] = []
        for s_date in session_dates:
            day_stamps = [ts for ts in all_stamps if ts[:10] == s_date]
            day_spots = {ts: pr for ts, pr in spot_map.items() if ts[:10] == s_date}
            day_vix = {ts: pr for ts, pr in vix_map.items() if ts[:10] == s_date}
            cur_spot = day_spots[min(day_spots)] if day_spots else spot_live
            cur_vix = day_vix[min(day_vix)] if day_vix else None
            for ts in day_stamps:
                if ts in day_spots:
                    cur_spot = day_spots[ts]
                if ts in day_vix:
                    cur_vix = day_vix[ts]
                if cur_spot and cur_spot > 0:
                    u_item: dict = {"timestamp": ts, "symbol": sym, "close": cur_spot}
                    if cur_vix and cur_vix > 0:
                        u_item["indiaVix"] = cur_vix
                    underlying_rows.append(u_item)

        dataset = {
            "source": "IWSM 1-Minute Intraday Option History",
            "contracts": contracts,
            "underlying": underlying_rows,
            "metadata": {
                "exchange": "nse_fo",
                "resolution": "1 minute",
                "quoteTiming": "Completed minute close; bar labelled by its minute in IST",
                "modelled": False,
                "synthetic": False,
                "frameCount": len(all_stamps),
                "historyScope": f"Active {iso_exp} contracts (±{strike_window} strikes around ATM) · 1-minute IST timeline",
            },
        }
        if len(self._intraday_cache) >= 48:
            self._intraday_cache.pop(next(iter(self._intraday_cache)))
        self._intraday_cache[ckey] = (now_m, dataset)
        return dataset

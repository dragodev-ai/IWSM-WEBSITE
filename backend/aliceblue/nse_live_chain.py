"""High-speed read-only NSE India Option-Chain v3 client with automatic cookie warmup and TTL caching."""
from __future__ import annotations

import asyncio
import time
from datetime import datetime, timedelta, timezone
import httpx
from snapshot_store import normalize_expiry_iso, iso_to_broker_expiry, solve_iv_and_greeks

IST = timezone(timedelta(hours=5, minutes=30))
NSE_INDEX_SYMBOLS = {"NIFTY", "BANKNIFTY", "FINNIFTY", "MIDCPNIFTY", "NIFTYNXT50"}

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


class NseLiveOptionChain:
    def __init__(self, transport=None, ttl_seconds: float = 5.0):
        self.ttl_seconds = ttl_seconds
        self._warmed_at = 0.0
        self._lock = asyncio.Lock()
        self._cache: dict[tuple[str, str], tuple[float, dict]] = {}
        self._exp_cache: dict[str, tuple[float, list[str]]] = {}
        self.http = httpx.AsyncClient(
            timeout=httpx.Timeout(12.0),
            follow_redirects=True,
            transport=transport,
            limits=httpx.Limits(max_connections=12, max_keepalive_connections=8),
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
        data = await self._get_json(f"https://www.nseindia.com/api/option-chain-contract-info?symbol={sym}")
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
        ckey = (sym, iso_exp)
        now_m = time.monotonic()
        hit = self._cache.get(ckey)
        if hit and (now_m - hit[0]) < self.ttl_seconds:
            return hit[1]

        opt_type = "Indices" if sym in NSE_INDEX_SYMBOLS else "Equity"
        url = f"https://www.nseindia.com/api/option-chain-v3?type={opt_type}&symbol={sym}&expiry={nse_exp}"
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
        unit_lot = int(lot_size or DEFAULT_LOT_SIZES.get(sym, 1))

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

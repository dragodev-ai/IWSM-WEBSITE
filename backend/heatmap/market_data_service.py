"""Authorized NSE Market-Data & Historical UDiFF Bhavcopy Adapter Service.

Provides:
- Connection-pooled live NSE index constituent snapshots (`NIFTY TOTAL MKT` covers 752+ equities in 1 call).
- Official UDiFF Cash Market Bhavcopy baseline sync (`1W`, `1M`, `3M`, `6M`, `YTD`, `1Y` returns,
  `1W`/`1M` cumulative volume & turnover, `20D` average volume, realized volatility, `FinInstrmId`, `ISIN`).
- Live 1D intraday price series & rolling `5M / 15M / 1H` anchor seeding (`getSymbolgraphData`).
"""
from __future__ import annotations

import asyncio
import csv
import io
import logging
import math
import statistics
import time
import zipfile
from datetime import date, datetime, timedelta, timezone
from typing import Any

import httpx

from .heatmap_cache_service import HeatmapCacheService
from .quote_normalization_service import (
    IST,
    NSE_EQUITY_HOLIDAYS,
    QuoteNormalizationService,
    finite_float,
)
from .sector_classification_service import SectorClassificationService
from .stock_universe_service import UNIVERSE_BY_ID, StockUniverseService

logger = logging.getLogger("iwsm.heatmap.market_data")

NSE_HOME_URL = "https://www.nseindia.com/market-data/live-equity-market"
NSE_MARKET_WATCH_API = "https://www.nseindia.com/api/NextApi/apiClient/marketWatchApi"
NSE_GET_QUOTE_API = "https://www.nseindia.com/api/NextApi/apiClient/GetQuoteApi"
NSE_CM_BHAV_URL = "https://nsearchives.nseindia.com/content/cm/BhavCopy_NSE_CM_0_0_0_{ymd}_F_0000.csv.zip"


def _parse_exchange_ts_epoch(ts_str: str | None) -> float:
    if not ts_str:
        return time.time()
    s = ts_str.strip()
    for fmt in ("%Y-%m-%d %H:%M:%S", "%d-%b-%Y %H:%M:%S", "%d-%b-%Y %H:%M"):
        try:
            dt = datetime.strptime(s, fmt).replace(tzinfo=IST)
            return dt.timestamp()
        except ValueError:
            continue
    return time.time()


def _recent_business_days(ref: date, count: int) -> list[date]:
    out: list[date] = []
    cur = ref
    steps = 0
    while len(out) < count and steps < count * 3:
        cur = cur - timedelta(days=1)
        steps += 1
        if cur.weekday() < 5 and cur.isoformat() not in NSE_EQUITY_HOLIDAYS:
            out.append(cur)
    return out


def _anchor_window_candidates(target: date) -> list[date]:
    cands: list[date] = []
    cur = target
    for _ in range(10):
        if cur.weekday() < 5 and cur.isoformat() not in NSE_EQUITY_HOLIDAYS:
            cands.append(cur)
            if len(cands) >= 3:
                break
        cur = cur - timedelta(days=1)
    return cands


class MarketDataService:
    def __init__(
        self,
        cache: HeatmapCacheService,
        universe_service: StockUniverseService,
        normalizer: QuoteNormalizationService,
        classifier: SectorClassificationService,
        transport: httpx.AsyncBaseTransport | None = None,
    ) -> None:
        self.cache = cache
        self.universes = universe_service
        self.normalizer = normalizer
        self.classifier = classifier
        self._has_mock_transport = transport is not None
        self._warmed_at: float = 0.0
        self._cookie_lock = asyncio.Lock()
        self._refresh_lock = asyncio.Lock()
        self._bhav_lock = asyncio.Lock()
        self._persist_counter: int = 0
        self.http = httpx.AsyncClient(
            timeout=httpx.Timeout(14.0),
            follow_redirects=True,
            transport=transport,
            limits=httpx.Limits(max_connections=24, max_keepalive_connections=12),
            headers={
                "User-Agent": (
                    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
                    "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36"
                ),
                "Accept": "application/json, text/plain, */*",
                "Accept-Language": "en-US,en;q=0.9",
                "Referer": NSE_HOME_URL,
            },
        )

    async def aclose(self) -> None:
        await self.http.aclose()

    async def _ensure_cookies(self, force: bool = False) -> None:
        if self._has_mock_transport:
            return
        now = time.monotonic()
        if not force and self._warmed_at and (now - self._warmed_at) < 240.0:
            return
        async with self._cookie_lock:
            now = time.monotonic()
            if not force and self._warmed_at and (now - self._warmed_at) < 240.0:
                return
            await self.http.get(
                NSE_HOME_URL,
                headers={"Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8"},
            )
            self._warmed_at = time.monotonic()

    async def _get_nse_json(self, url: str, params: dict[str, str]) -> dict[str, Any]:
        await self._ensure_cookies(force=False)
        resp = await self.http.get(url, params=params)
        if resp.status_code in (401, 403):
            await self._ensure_cookies(force=True)
            resp = await self.http.get(url, params=params)
        if resp.status_code == 429:
            raise RuntimeError("API rate limit exceeded on upstream exchange feed")
        if resp.status_code != 200:
            raise RuntimeError(f"Exchange feed HTTP {resp.status_code}")
        return resp.json()

    async def refresh_live_quotes(
        self,
        universe_id: str = "NSE All Stocks",
        force_persist: bool = False,
    ) -> dict[str, dict[str, Any]]:
        uid = self.universes.resolve_universe_id(universe_id) or "NIFTY 50"
        u_def = UNIVERSE_BY_ID[uid]
        nse_symbol = u_def["nseIndex"]

        async with self._refresh_lock:
            try:
                payload = await self._get_nse_json(
                    NSE_MARKET_WATCH_API,
                    {"functionName": "getIndicesData", "symbol": nse_symbol},
                )
            except Exception as exc:
                self.cache.last_provider_error = str(exc)
                logger.warning("Live quote refresh failed (%s): %s", nse_symbol, exc)
                raise

            raw_block = payload.get("data") or {}
            rows = raw_block.get("data", []) if isinstance(raw_block, dict) else []
            exch_ts = raw_block.get("timestamp") if isinstance(raw_block, dict) else None
            if not isinstance(rows, list) or not rows:
                return {}

            self.universes.register_live_constituents(uid, rows)

            normalized_batch: dict[str, dict[str, Any]] = {}
            for r in rows:
                if not isinstance(r, dict) or r.get("priority") == 1:
                    continue
                sym = str(r.get("symbol") or "").strip().upper()
                if not sym or sym == nse_symbol:
                    continue
                lp = finite_float(r.get("lastPrice"))
                upd_epoch = _parse_exchange_ts_epoch(r.get("lastUpdateTime") or exch_ts)
                if lp and lp > 0:
                    self.cache.record_intraday_price(sym, upd_epoch, lp)

                anchors = {
                    "5m": self.cache.lookup_intraday_anchor(sym, upd_epoch, 300.0, tolerance_sec=180.0),
                    "15m": self.cache.lookup_intraday_anchor(sym, upd_epoch, 900.0, tolerance_sec=240.0),
                    "1h": self.cache.lookup_intraday_anchor(sym, upd_epoch, 3600.0, tolerance_sec=420.0),
                }
                master = self.cache.security_master.get(sym)
                baseline = self.cache.baselines.get(sym)
                norm = self.normalizer.normalize_stock(r, master, baseline, anchors)
                if norm is not None:
                    normalized_batch[sym] = norm

            self._persist_counter += 1
            should_persist = force_persist or (self._persist_counter % 6 == 1)
            return self.cache.update_quotes(
                normalized_batch,
                exchange_timestamp=exch_ts,
                persist_sqlite=should_persist,
            )

    async def sync_bhavcopy_baselines(self) -> int:
        if self._has_mock_transport:
            return 0
        async with self._bhav_lock:
            today = datetime.now(IST).date()
            recent_22 = _recent_business_days(today, 22)
            anchor_targets = [
                today - timedelta(days=91),
                today - timedelta(days=182),
                date(today.year, 1, 2),
                date(today.year - 1, 12, 31),
                today - timedelta(days=365),
            ]
            wanted_dates: list[date] = list(recent_22)
            for tgt in anchor_targets:
                for cand in _anchor_window_candidates(tgt):
                    if cand not in wanted_dates:
                        wanted_dates.append(cand)

            already_synced = self.cache.get_synced_bhav_dates()
            missing = [d for d in wanted_dates if d.isoformat() not in already_synced]

            if missing:
                sem = asyncio.Semaphore(6)

                async def fetch_bhav(d: date) -> None:
                    ymd = d.strftime("%Y%m%d")
                    iso = d.isoformat()
                    url = NSE_CM_BHAV_URL.format(ymd=ymd)
                    async with sem:
                        try:
                            resp = await self.http.get(url, headers={"Accept": "*/*"})
                            if resp.status_code != 200 or len(resp.content) < 500:
                                return
                            zf = zipfile.ZipFile(io.BytesIO(resp.content))
                            csv_bytes = zf.read(zf.namelist()[0]).decode("utf-8", errors="replace")
                            reader = csv.DictReader(io.StringIO(csv_bytes))
                            parsed_rows: list[tuple] = []
                            for row in reader:
                                if (row.get("SctySrs") or "").strip() != "EQ":
                                    continue
                                sym = (row.get("TckrSymb") or "").strip().upper()
                                if not sym:
                                    continue
                                cls_p = finite_float(row.get("ClsPric"))
                                if not cls_p or cls_p <= 0:
                                    continue
                                parsed_rows.append(
                                    (
                                        iso,
                                        sym,
                                        (row.get("ISIN") or "").strip(),
                                        (row.get("FinInstrmId") or "").strip(),
                                        finite_float(row.get("OpnPric")),
                                        finite_float(row.get("HghPric")),
                                        finite_float(row.get("LwPric")),
                                        cls_p,
                                        finite_float(row.get("PrvsClsgPric")),
                                        finite_float(row.get("TtlTradgVol")) or 0.0,
                                        finite_float(row.get("TtlTrfVal")) or 0.0,
                                    )
                                )
                            if parsed_rows:
                                await asyncio.to_thread(self.cache.store_bhav_day, iso, parsed_rows)
                        except Exception:
                            return

                await asyncio.gather(*[fetch_bhav(d) for d in missing])

            return await asyncio.to_thread(self._recompute_baselines_sync, today)

    def _recompute_baselines_sync(self, today: date) -> int:
        dates, by_sym = self.cache.load_all_bhav_bars()
        if not dates or not by_sym:
            return 0

        as_of = dates[-1]
        d_1w = (today - timedelta(days=7)).isoformat()
        d_1m = (today - timedelta(days=30)).isoformat()
        d_3m = (today - timedelta(days=91)).isoformat()
        d_6m = (today - timedelta(days=182)).isoformat()
        d_ytd = f"{today.year}-01-05"
        d_prev_yr = f"{today.year - 1}-12-31"
        d_1y = (today - timedelta(days=365)).isoformat()

        def close_on_or_before(bars: list[dict[str, Any]], cutoff_iso: str, max_gap_days: int = 18) -> float | None:
            best = None
            for b in bars:
                if b["date"] <= cutoff_iso:
                    best = b
                else:
                    break
            if not best:
                return None
            try:
                gap = abs((date.fromisoformat(cutoff_iso) - date.fromisoformat(best["date"])).days)
                if gap > max_gap_days:
                    return None
            except ValueError:
                pass
            return best["close"]

        computed: dict[str, dict[str, Any]] = {}
        for sym, bars in by_sym.items():
            hist_bars = [b for b in bars if b["date"] < today.isoformat()]
            if not hist_bars:
                continue
            recent20 = hist_bars[-20:]
            recent4 = hist_bars[-4:]
            latest_bar = hist_bars[-1]

            vols_20 = [b["volume"] for b in recent20 if b["volume"] and b["volume"] > 0]
            avg_vol_20 = sum(vols_20) / len(vols_20) if vols_20 else None

            log_rets: list[float] = []
            for a, b in zip(recent20, recent20[1:]):
                if a["close"] and b["close"] and a["close"] > 0 and b["close"] > 0:
                    log_rets.append(math.log(b["close"] / a["close"]))
            realized_vol = (
                round(statistics.stdev(log_rets) * math.sqrt(252.0) * 100.0, 2)
                if len(log_rets) >= 5
                else None
            )

            ytd_close = close_on_or_before(hist_bars, d_prev_yr, 15) or close_on_or_before(hist_bars, d_ytd, 15)

            computed[sym] = {
                "isin": latest_bar.get("isin") or "",
                "instrumentId": latest_bar.get("instrumentId") or f"NSE:{sym}",
                "prevDayVolume": latest_bar.get("volume"),
                "avgVolume20D": round(avg_vol_20, 2) if avg_vol_20 else None,
                "volPrev4D": round(sum(b["volume"] or 0.0 for b in recent4), 0),
                "volPrev20D": round(sum(b["volume"] or 0.0 for b in recent20), 0),
                "turnoverPrev4D": round(sum(b["turnover"] or 0.0 for b in recent4), 2),
                "turnoverPrev20D": round(sum(b["turnover"] or 0.0 for b in recent20), 2),
                "realizedVol20D": realized_vol,
                "close1W": close_on_or_before(hist_bars, d_1w, 12),
                "close1M": close_on_or_before(hist_bars, d_1m, 15),
                "close3M": close_on_or_before(hist_bars, d_3m, 20),
                "close6M": close_on_or_before(hist_bars, d_6m, 20),
                "closeYTD": ytd_close,
                "close1Y": close_on_or_before(hist_bars, d_1y, 20),
            }

        if computed:
            self.cache.save_baselines_batch(computed, as_of)
            with self.cache._lock:
                for sym, q in list(self.cache.latest_quotes.items()):
                    b = computed.get(sym)
                    if not b:
                        continue
                    p = q.get("price")
                    v1d = q.get("volume1d") or 0
                    t1d = q.get("turnover1d") or 0.0
                    if p and p > 0:
                        if b.get("close1W"):
                            q["perf1w"] = round(((p - b["close1W"]) / b["close1W"]) * 100.0, 2)
                        if b.get("close3M"):
                            q["perf3m"] = round(((p - b["close3M"]) / b["close3M"]) * 100.0, 2)
                        if b.get("close6M"):
                            q["perf6m"] = round(((p - b["close6M"]) / b["close6M"]) * 100.0, 2)
                        if b.get("closeYTD"):
                            q["perfYtd"] = round(((p - b["closeYTD"]) / b["closeYTD"]) * 100.0, 2)
                    q["volume1w"] = int(v1d + (b.get("volPrev4D") or 0))
                    q["volume1m"] = int(v1d + (b.get("volPrev20D") or 0))
                    q["turnover1w"] = round(t1d + (b.get("turnoverPrev4D") or 0.0), 2)
                    q["turnover1m"] = round(t1d + (b.get("turnoverPrev20D") or 0.0), 2)
                    if b.get("avgVolume20D") and v1d:
                        q["relativeVolume"] = round(v1d / b["avgVolume20D"], 2)
                    if b.get("prevDayVolume") and b["prevDayVolume"] > 0 and v1d:
                        q["volumeChangePct"] = round(((v1d - b["prevDayVolume"]) / b["prevDayVolume"]) * 100.0, 2)
                    if b.get("realizedVol20D") is not None:
                        q["volatility"] = b["realizedVol20D"]
                    if b.get("instrumentId"):
                        q["instrumentId"] = str(b["instrumentId"])
                    if b.get("isin") and not q.get("isin"):
                        q["isin"] = b["isin"]
        return len(computed)

    async def seed_intraday_anchors(self, symbols: list[str], concurrency: int = 5) -> int:
        if self._has_mock_transport or not symbols:
            return 0
        sem = asyncio.Semaphore(concurrency)

        async def seed_one(sym: str) -> bool:
            q = self.cache.latest_quotes.get(sym)
            ident = (q or {}).get("identifier") or f"{sym}EQN"
            async with sem:
                try:
                    data = await self._get_nse_json(
                        NSE_MARKET_WATCH_API,
                        {"functionName": "getSymbolgraphData", "identifier": ident, "flag": "1D"},
                    )
                    pts_raw = data.get("grapthData") or []
                    series: list[tuple[float, float]] = []
                    for row in pts_raw:
                        if isinstance(row, list) and len(row) >= 3 and row[2] == "NM":
                            ts_sec = (float(row[0]) - 19800000.0) / 1000.0
                            pr = finite_float(row[1])
                            if pr and pr > 0:
                                series.append((ts_sec, pr))
                    if series:
                        self.cache.seed_intraday_series(sym, series)
                        now_ep = series[-1][0]
                        cur_q = self.cache.latest_quotes.get(sym)
                        if cur_q and cur_q.get("price"):
                            lp = cur_q["price"]
                            for key, sec, tol in [
                                ("change5m", 300.0, 180.0),
                                ("change15m", 900.0, 240.0),
                                ("change1h", 3600.0, 420.0),
                            ]:
                                anc = self.cache.lookup_intraday_anchor(sym, now_ep, sec, tolerance_sec=tol)
                                if anc and anc > 0:
                                    cur_q[key] = round(((lp - anc) / anc) * 100.0, 2)
                        return True
                except Exception:
                    pass
                return False

        flags = await asyncio.gather(*[seed_one(s) for s in symbols])
        return sum(1 for ok in flags if ok)

    async def fetch_stock_intraday_detail(self, symbol: str) -> dict[str, Any]:
        sym = symbol.strip().upper()
        cached_chart = self.cache.get_cached_intraday_chart(sym, ttl_sec=30.0)
        q = self.cache.latest_quotes.get(sym)
        ident = (q or {}).get("identifier") or f"{sym}EQN"

        extra_meta: dict[str, Any] = {}
        if not self._has_mock_transport:
            try:
                quote_detail = await self._get_nse_json(
                    NSE_GET_QUOTE_API,
                    {"functionName": "getSymbolData", "marketType": "N", "series": "EQ", "symbol": sym},
                )
                eq_resp = (quote_detail.get("equityResponse") or [{}])[0]
                sec_info = eq_resp.get("secInfo") or {}
                trade_info = eq_resp.get("tradeInfo") or {}
                price_info = eq_resp.get("priceInfo") or {}
                basic_ind = (sec_info.get("basicIndustry") or "").strip()
                if basic_ind:
                    self.classifier.register_dynamic(sym, None, basic_ind)
                    if q:
                        q["industry"] = basic_ind
                extra_meta = {
                    "basicIndustry": basic_ind or (q or {}).get("industry"),
                    "peRatio": finite_float(sec_info.get("pdSymbolPe")),
                    "sectorPe": finite_float(sec_info.get("pdSectorPe")),
                    "deliveryPct": finite_float(sec_info.get("deliveryTotradedQuantity")),
                    "annualVolatility": finite_float(price_info.get("cmAnnualVolatility")),
                    "dailyVolatility": finite_float(price_info.get("cmDailyVolatility")),
                    "priceBand": price_info.get("priceBand"),
                    "totalMarketCapLakhs": finite_float(trade_info.get("totalMarketCap")),
                }
            except Exception:
                pass

        if cached_chart is None and not self._has_mock_transport:
            try:
                data = await self._get_nse_json(
                    NSE_MARKET_WATCH_API,
                    {"functionName": "getSymbolgraphData", "identifier": ident, "flag": "1D"},
                )
                pts_raw = data.get("grapthData") or []
                chart_pts: list[dict[str, Any]] = []
                ring_pts: list[tuple[float, float]] = []
                for row in pts_raw:
                    if isinstance(row, list) and len(row) >= 3 and row[2] == "NM":
                        raw_ms = float(row[0])
                        pr = finite_float(row[1])
                        if pr and pr > 0:
                            ist_str = datetime.fromtimestamp(raw_ms / 1000.0, tz=timezone.utc).strftime("%H:%M")
                            chart_pts.append({"time": ist_str, "price": round(pr, 2)})
                            ring_pts.append(((raw_ms - 19800000.0) / 1000.0, pr))
                if chart_pts:
                    self.cache.cache_intraday_chart(sym, chart_pts)
                    self.cache.seed_intraday_series(sym, ring_pts)
                    cached_chart = chart_pts
            except Exception:
                cached_chart = []

        return {
            "quote": self.cache.latest_quotes.get(sym),
            "master": self.cache.security_master.get(sym),
            "extra": extra_meta,
            "intradayChart": cached_chart or [],
        }

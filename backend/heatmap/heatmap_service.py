"""Heatmap Orchestration, Screener Filtering, Sector Aggregation & Metrics Service."""
from __future__ import annotations

import re
import time
from datetime import datetime
from typing import Any

from .heatmap_cache_service import HeatmapCacheService
from .market_data_service import MarketDataService
from .quote_normalization_service import IST, equity_market_status_ist, finite_float
from .stock_universe_service import StockUniverseService

SYMBOL_RE = re.compile(r"^[A-Z0-9&._-]{1,30}$")

SIZE_METRICS: list[dict[str, str]] = [
    {"id": "marketCap", "label": "Market Capitalization", "unit": "INR"},
    {"id": "volume1d", "label": "Trading Volume - 1D", "unit": "shares"},
    {"id": "volume1w", "label": "Trading Volume - 1W", "unit": "shares"},
    {"id": "volume1m", "label": "Trading Volume - 1M", "unit": "shares"},
    {"id": "turnover1d", "label": "Turnover - 1D", "unit": "INR"},
    {"id": "turnover1w", "label": "Turnover - 1W", "unit": "INR"},
    {"id": "turnover1m", "label": "Turnover - 1M", "unit": "INR"},
    {"id": "equal", "label": "Equal Size (Mono Size)", "unit": "equal"},
]

COLOR_METRICS: list[dict[str, str]] = [
    {"id": "changePct", "label": "Change 1D %", "group": "Price Change", "scale": "diverging"},
    {"id": "change1h", "label": "Change 1H %", "group": "Price Change", "scale": "diverging"},
    {"id": "change15m", "label": "Change 15M %", "group": "Price Change", "scale": "diverging"},
    {"id": "change5m", "label": "Change 5M %", "group": "Price Change", "scale": "diverging"},
    {"id": "perf1w", "label": "Performance 1W %", "group": "Performance", "scale": "diverging"},
    {"id": "perf1m", "label": "Performance 1M %", "group": "Performance", "scale": "diverging"},
    {"id": "perf3m", "label": "Performance 3M %", "group": "Performance", "scale": "diverging"},
    {"id": "perf6m", "label": "Performance 6M %", "group": "Performance", "scale": "diverging"},
    {"id": "perfYtd", "label": "Performance YTD %", "group": "Performance", "scale": "diverging"},
    {"id": "perf1y", "label": "Performance 1Y %", "group": "Performance", "scale": "diverging"},
    {"id": "relativeVolume", "label": "Relative Volume", "group": "Market Activity", "scale": "activity_rvol"},
    {"id": "volumeChangePct", "label": "Volume Change %", "group": "Market Activity", "scale": "diverging_wide"},
    {"id": "volatility", "label": "Volatility", "group": "Market Activity", "scale": "activity_vol"},
    {"id": "gapPct", "label": "Gap %", "group": "Market Activity", "scale": "diverging"},
]


class HeatmapService:
    def __init__(
        self,
        cache: HeatmapCacheService,
        universes: StockUniverseService,
        market_data: MarketDataService,
    ) -> None:
        self.cache = cache
        self.universes = universes
        self.market_data = market_data

    def get_status(self) -> dict[str, Any]:
        mkt = equity_market_status_ist()
        now = time.time()
        age_sec = round(now - self.cache.last_quote_sync_epoch, 1) if self.cache.last_quote_sync_epoch else None
        has_quotes = len(self.cache.latest_quotes) > 0
        is_stale = bool(mkt["isOpen"] and (age_sec is None or age_sec > 90.0))

        if not has_quotes:
            feed_state = "DISCONNECTED"
        elif self.cache.last_provider_error and is_stale:
            feed_state = "STALE"
        elif mkt["isOpen"]:
            feed_state = "LIVE"
        else:
            feed_state = "MARKET_CLOSED"

        last_iso = (
            datetime.fromtimestamp(self.cache.last_quote_sync_epoch, tz=IST).strftime("%Y-%m-%d %H:%M:%S IST")
            if self.cache.last_quote_sync_epoch
            else None
        )

        return {
            "feedState": feed_state,
            "market": mkt,
            "provider": "NSE Official Cash Market & Indices Feed",
            "delayLabel": "Near real-time (~5–15s exchange snapshot)" if mkt["isOpen"] else "Official closing session snapshot",
            "lastSyncAt": last_iso,
            "exchangeTimestamp": self.cache.last_exchange_timestamp,
            "quoteAgeSeconds": age_sec,
            "isStale": is_stale,
            "lastError": self.cache.last_provider_error,
            "securityCount": len(self.cache.security_master),
            "quotedCount": len(self.cache.latest_quotes),
            "baselineCount": len(self.cache.baselines),
        }

    async def ensure_universe_quotes(self, universe_id: str) -> tuple[str, list[dict[str, Any]]]:
        resolved = self.universes.resolve_universe_id(universe_id)
        if not resolved:
            raise ValueError(f"Unknown stock universe: {universe_id}")

        await self.universes.ensure_synced()
        members = self.cache.universe_members.get(resolved, [])

        # Refresh live quotes if empty, stale (>8s during market hours, >300s off-hours), or missing universe symbols
        mkt = equity_market_status_ist()
        max_age = 8.0 if mkt["isOpen"] else 300.0
        age = (time.time() - self.cache.last_quote_sync_epoch) if self.cache.last_quote_sync_epoch else 999999.0
        missing_any = any(sym not in self.cache.latest_quotes for sym in members[:10]) if members else True

        if age > max_age or missing_any:
            try:
                # Refreshing NSE All Stocks (NIFTY TOTAL MKT) updates 752 equities in one call;
                # if a specific index has symbols outside Total Market, refresh that index directly too.
                await self.market_data.refresh_live_quotes("NSE All Stocks")
                members = self.cache.universe_members.get(resolved, [])
                if resolved != "NSE All Stocks" and any(sym not in self.cache.latest_quotes for sym in members):
                    await self.market_data.refresh_live_quotes(resolved)
            except Exception:
                # Preserve last known valid quotes on transient upstream errors (Instruction 16)
                if not self.cache.latest_quotes:
                    raise

        members = self.cache.universe_members.get(resolved, [])
        records: list[dict[str, Any]] = []
        for sym in members:
            q = self.cache.latest_quotes.get(sym)
            if q:
                records.append(q)
        return resolved, records

    def filter_securities(
        self,
        securities: list[dict[str, Any]],
        filters: dict[str, Any] | None = None,
    ) -> list[dict[str, Any]]:
        if not filters:
            return list(securities)

        f = filters
        sym_q = str(f.get("symbol") or "").strip().upper()
        name_q = str(f.get("companyName") or "").strip().lower()
        search_q = str(f.get("search") or "").strip().lower()
        sectors = {str(x).strip() for x in (f.get("sectors") or []) if str(x).strip()}
        if f.get("sector") and str(f["sector"]).strip() and str(f["sector"]).strip().lower() != "all":
            sectors.add(str(f["sector"]).strip())

        industries = {str(x).strip() for x in (f.get("industries") or []) if str(x).strip()}
        if f.get("industry") and str(f["industry"]).strip() and str(f["industry"]).strip().lower() != "all":
            industries.add(str(f["industry"]).strip())

        exchange_q = str(f.get("exchange") or "").strip().upper()
        if exchange_q == "ALL":
            exchange_q = ""

        min_price = finite_float(f.get("minPrice"))
        max_price = finite_float(f.get("maxPrice"))
        min_chg = finite_float(f.get("minChangePct"))
        max_chg = finite_float(f.get("maxChangePct"))
        direction = str(f.get("direction") or "").strip().lower()  # 'gainers' | 'losers' | ''

        min_mcap_cr = finite_float(f.get("minMarketCapCr"))
        max_mcap_cr = finite_float(f.get("maxMarketCapCr"))
        min_vol = finite_float(f.get("minVolume"))
        min_turn_cr = finite_float(f.get("minTurnoverCr"))
        min_rvol = finite_float(f.get("minRelativeVolume"))

        min_perf_1d = finite_float(f.get("minPerf1d"))
        max_perf_1d = finite_float(f.get("maxPerf1d"))
        min_perf_1w = finite_float(f.get("minPerf1w"))
        max_perf_1w = finite_float(f.get("maxPerf1w"))
        min_perf_1m = finite_float(f.get("minPerf1m"))
        max_perf_1m = finite_float(f.get("maxPerf1m"))

        preset = str(f.get("preset") or "").strip().lower()

        out: list[dict[str, Any]] = []
        for s in securities:
            if sym_q and sym_q not in s["symbol"]:
                continue
            if name_q and name_q not in (s.get("companyName") or "").lower():
                continue
            if search_q:
                if (
                    search_q not in s["symbol"].lower()
                    and search_q not in (s.get("companyName") or "").lower()
                    and search_q not in (s.get("sector") or "").lower()
                    and search_q not in (s.get("industry") or "").lower()
                ):
                    continue
            if sectors and s.get("sector") not in sectors:
                continue
            if industries and s.get("industry") not in industries:
                continue
            if exchange_q and (s.get("exchange") or "NSE").upper() != exchange_q:
                continue

            pr = s.get("price")
            if min_price is not None and (pr is None or pr < min_price):
                continue
            if max_price is not None and (pr is None or pr > max_price):
                continue

            chg = s.get("changePct")
            if min_chg is not None and (chg is None or chg < min_chg):
                continue
            if max_chg is not None and (chg is None or chg > max_chg):
                continue
            if direction == "gainers" and (chg is None or chg <= 0):
                continue
            if direction == "losers" and (chg is None or chg >= 0):
                continue

            mcap_cr = s.get("marketCapCr")
            if min_mcap_cr is not None and (mcap_cr is None or mcap_cr < min_mcap_cr):
                continue
            if max_mcap_cr is not None and (mcap_cr is None or mcap_cr > max_mcap_cr):
                continue

            vol = s.get("volume1d")
            if min_vol is not None and (vol is None or vol < min_vol):
                continue

            turn_cr = (s.get("turnover1d") / 1e7) if s.get("turnover1d") is not None else None
            if min_turn_cr is not None and (turn_cr is None or turn_cr < min_turn_cr):
                continue

            rvol = s.get("relativeVolume")
            if min_rvol is not None and (rvol is None or rvol < min_rvol):
                continue

            if min_perf_1d is not None and (chg is None or chg < min_perf_1d):
                continue
            if max_perf_1d is not None and (chg is None or chg > max_perf_1d):
                continue

            p1w = s.get("perf1w")
            if min_perf_1w is not None and (p1w is None or p1w < min_perf_1w):
                continue
            if max_perf_1w is not None and (p1w is None or p1w > max_perf_1w):
                continue

            p1m = s.get("perf1m")
            if min_perf_1m is not None and (p1m is None or p1m < min_perf_1m):
                continue
            if max_perf_1m is not None and (p1m is None or p1m > max_perf_1m):
                continue

            out.append(s)

        # Apply optional ranking preset (Top Gainers / Top Losers / High Volume / High Volatility)
        if preset == "top_gainers":
            out = [x for x in out if (x.get("changePct") or 0) > 0]
            out.sort(key=lambda x: x.get("changePct") or -999.0, reverse=True)
            out = out[:25]
        elif preset == "top_losers":
            out = [x for x in out if (x.get("changePct") or 0) < 0]
            out.sort(key=lambda x: x.get("changePct") or 999.0)
            out = out[:25]
        elif preset == "high_volume":
            out.sort(key=lambda x: (x.get("relativeVolume") or 0.0, x.get("volume1d") or 0), reverse=True)
            out = out[:30]
        elif preset == "high_volatility":
            out.sort(key=lambda x: x.get("volatility") or x.get("intradayRangePct") or 0.0, reverse=True)
            out = out[:30]

        return out

    def aggregate_sectors(self, securities: list[dict[str, Any]], group_field: str = "sector") -> list[dict[str, Any]]:
        field = "industry" if group_field == "industry" else "sector"
        buckets: dict[str, list[dict[str, Any]]] = {}
        for s in securities:
            g = s.get(field) or "Unclassified"
            buckets.setdefault(g, []).append(s)

        summary: list[dict[str, Any]] = []
        for name, items in buckets.items():
            total_mcap = sum(x.get("marketCap") or 0.0 for x in items)
            total_turn = sum(x.get("turnover1d") or 0.0 for x in items)
            if total_mcap > 0:
                weighted_chg = sum((x.get("changePct") or 0.0) * (x.get("marketCap") or 0.0) for x in items) / total_mcap
            else:
                weighted_chg = sum(x.get("changePct") or 0.0 for x in items) / max(1, len(items))
            adv = sum(1 for x in items if (x.get("changePct") or 0.0) > 0)
            dec = sum(1 for x in items if (x.get("changePct") or 0.0) < 0)
            summary.append(
                {
                    "name": name,
                    "count": len(items),
                    "marketCap": round(total_mcap, 2),
                    "marketCapCr": round(total_mcap / 1e7, 2),
                    "turnover1d": round(total_turn, 2),
                    "weightedChangePct": round(weighted_chg, 2),
                    "advances": adv,
                    "declines": dec,
                    "unchanged": len(items) - adv - dec,
                }
            )
        summary.sort(key=lambda r: r["marketCap"], reverse=True)
        return summary

    def get_supported_metrics(self, universe_id: str = "NIFTY 50") -> dict[str, Any]:
        uid = self.universes.resolve_universe_id(universe_id) or "NIFTY 50"
        members = self.cache.universe_members.get(uid, [])
        sample = [self.cache.latest_quotes[s] for s in members if s in self.cache.latest_quotes]
        if not sample:
            sample = list(self.cache.latest_quotes.values())[:100]

        def coverage(field: str) -> tuple[bool, int]:
            if field == "equal":
                return True, len(sample)
            cnt = sum(1 for r in sample if r.get(field) is not None)
            return cnt > 0, cnt

        size_out = []
        for m in SIZE_METRICS:
            avail, cnt = coverage(m["id"])
            size_out.append({**m, "available": avail, "coverageCount": cnt, "totalCount": len(sample)})

        color_out = []
        for m in COLOR_METRICS:
            avail, cnt = coverage(m["id"])
            reason = None if avail else "Accumulating intraday ticks or awaiting historical session sync"
            color_out.append({**m, "available": avail, "coverageCount": cnt, "totalCount": len(sample), "unavailableReason": reason})

        return {
            "universe": uid,
            "sizeBy": size_out,
            "colorBy": color_out,
            "groupBy": [
                {"id": "sector", "label": "Sector"},
                {"id": "industry", "label": "Industry"},
                {"id": "none", "label": "No Group"},
            ],
        }

    async def get_stock_detail(self, symbol: str) -> dict[str, Any]:
        sym = (symbol or "").strip().upper()
        if not SYMBOL_RE.match(sym):
            raise ValueError("Invalid stock symbol")
        if sym not in self.cache.latest_quotes:
            await self.ensure_universe_quotes("NSE All Stocks")
        detail = await self.market_data.fetch_stock_intraday_detail(sym)
        if not detail.get("quote") and not detail.get("master"):
            raise LookupError(f"Security '{sym}' not found in NSE equity master")
        return detail

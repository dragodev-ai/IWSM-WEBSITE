"""Stock Universe & Security Master Service.

Maintains all 16 requested Indian Equity Universes using official NSE Indices
constituent CSVs (`nsearchives.nseindia.com/content/indices/*.csv`), keeping
index membership independent from live quote streams.
"""
from __future__ import annotations

import asyncio
import csv
import io
import logging
import time
from typing import Any

import httpx

from .heatmap_cache_service import HeatmapCacheService
from .sector_classification_service import SectorClassificationService

logger = logging.getLogger("iwsm.heatmap.universe")

# Ordered specification of all 16 required Market / Stock Universes
UNIVERSE_DEFINITIONS: list[dict[str, str]] = [
    {"id": "NIFTY 50", "label": "NIFTY 50", "nseIndex": "NIFTY 50", "csv": "ind_nifty50list.csv", "category": "Benchmark"},
    {"id": "NIFTY 100", "label": "NIFTY 100", "nseIndex": "NIFTY 100", "csv": "ind_nifty100list.csv", "category": "Broad Market"},
    {"id": "NIFTY 200", "label": "NIFTY 200", "nseIndex": "NIFTY 200", "csv": "ind_nifty200list.csv", "category": "Broad Market"},
    {"id": "NIFTY 500", "label": "NIFTY 500", "nseIndex": "NIFTY 500", "csv": "ind_nifty500list.csv", "category": "Broad Market"},
    {"id": "NIFTY MIDCAP 50", "label": "NIFTY MIDCAP 50", "nseIndex": "NIFTY MIDCAP 50", "csv": "ind_niftymidcap50list.csv", "category": "Mid & Smallcap"},
    {"id": "NIFTY MIDCAP 100", "label": "NIFTY MIDCAP 100", "nseIndex": "NIFTY MIDCAP 100", "csv": "ind_niftymidcap100list.csv", "category": "Mid & Smallcap"},
    {"id": "NIFTY SMALLCAP 100", "label": "NIFTY SMALLCAP 100", "nseIndex": "NIFTY SMLCAP 100", "csv": "ind_niftysmallcap100list.csv", "category": "Mid & Smallcap"},
    {"id": "NIFTY BANK", "label": "NIFTY BANK", "nseIndex": "NIFTY BANK", "csv": "ind_niftybanklist.csv", "category": "Sectoral"},
    {"id": "NIFTY FINANCIAL SERVICES", "label": "NIFTY FINANCIAL SERVICES", "nseIndex": "NIFTY FIN SERVICE", "csv": "ind_niftyfinancelist.csv", "category": "Sectoral"},
    {"id": "NIFTY IT", "label": "NIFTY IT", "nseIndex": "NIFTY IT", "csv": "ind_niftyitlist.csv", "category": "Sectoral"},
    {"id": "NIFTY AUTO", "label": "NIFTY AUTO", "nseIndex": "NIFTY AUTO", "csv": "ind_niftyautolist.csv", "category": "Sectoral"},
    {"id": "NIFTY PHARMA", "label": "NIFTY PHARMA", "nseIndex": "NIFTY PHARMA", "csv": "ind_niftypharmalist.csv", "category": "Sectoral"},
    {"id": "NIFTY FMCG", "label": "NIFTY FMCG", "nseIndex": "NIFTY FMCG", "csv": "ind_niftyfmcglist.csv", "category": "Sectoral"},
    {"id": "NIFTY METAL", "label": "NIFTY METAL", "nseIndex": "NIFTY METAL", "csv": "ind_niftymetallist.csv", "category": "Sectoral"},
    {"id": "NIFTY ENERGY", "label": "NIFTY ENERGY", "nseIndex": "NIFTY ENERGY", "csv": "ind_niftyenergylist.csv", "category": "Sectoral"},
    {"id": "NSE All Stocks", "label": "NSE All Stocks", "nseIndex": "NIFTY TOTAL MKT", "csv": "ind_niftytotalmarket_list.csv", "category": "Total Market"},
]

UNIVERSE_BY_ID: dict[str, dict[str, str]] = {u["id"]: u for u in UNIVERSE_DEFINITIONS}

# Accept common aliases (e.g., NIFTY50 -> NIFTY 50)
UNIVERSE_ALIASES: dict[str, str] = {
    u["id"].upper(): u["id"] for u in UNIVERSE_DEFINITIONS
}
UNIVERSE_ALIASES.update(
    {
        "NIFTY50": "NIFTY 50",
        "NIFTY100": "NIFTY 100",
        "NIFTY200": "NIFTY 200",
        "NIFTY500": "NIFTY 500",
        "NIFTYMIDCAP50": "NIFTY MIDCAP 50",
        "NIFTYMIDCAP100": "NIFTY MIDCAP 100",
        "NIFTYSMALLCAP100": "NIFTY SMALLCAP 100",
        "NIFTYBANK": "NIFTY BANK",
        "BANKNIFTY": "NIFTY BANK",
        "FINNIFTY": "NIFTY FINANCIAL SERVICES",
        "NIFTY FIN SERVICE": "NIFTY FINANCIAL SERVICES",
        "NIFTYIT": "NIFTY IT",
        "NIFTYAUTO": "NIFTY AUTO",
        "NIFTYPHARMA": "NIFTY PHARMA",
        "NIFTYFMCG": "NIFTY FMCG",
        "NIFTYMETAL": "NIFTY METAL",
        "NIFTYENERGY": "NIFTY ENERGY",
        "ALL": "NSE All Stocks",
        "NSE ALL STOCKS": "NSE All Stocks",
        "NIFTY TOTAL MARKET": "NSE All Stocks",
        "NIFTY TOTAL MKT": "NSE All Stocks",
    }
)

ARCHIVE_CSV_BASE = "https://nsearchives.nseindia.com/content/indices/"


class StockUniverseService:
    def __init__(
        self,
        cache: HeatmapCacheService,
        classifier: SectorClassificationService,
        http_client: httpx.AsyncClient | None = None,
    ) -> None:
        self.cache = cache
        self.classifier = classifier
        self._external_http = http_client is not None
        self.http = http_client or httpx.AsyncClient(
            timeout=httpx.Timeout(15.0),
            follow_redirects=True,
            headers={
                "User-Agent": (
                    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
                    "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36"
                ),
                "Accept": "text/csv,text/plain,*/*",
            },
        )
        self._last_sync_mono: float = 0.0
        self._sync_lock = asyncio.Lock()

    async def aclose(self) -> None:
        if not self._external_http:
            await self.http.aclose()

    def resolve_universe_id(self, raw_universe: str | None) -> str | None:
        if not raw_universe:
            return "NIFTY 50"
        cleaned = raw_universe.strip()
        if cleaned in UNIVERSE_BY_ID:
            return cleaned
        upper = cleaned.upper()
        if upper in UNIVERSE_ALIASES:
            return UNIVERSE_ALIASES[upper]
        compact = upper.replace(" ", "").replace("_", "").replace("-", "")
        return UNIVERSE_ALIASES.get(compact)

    def list_universes(self) -> list[dict[str, Any]]:
        out = []
        for u in UNIVERSE_DEFINITIONS:
            uid = u["id"]
            members = self.cache.universe_members.get(uid, [])
            out.append(
                {
                    "id": uid,
                    "label": u["label"],
                    "category": u["category"],
                    "nseIndex": u["nseIndex"],
                    "count": len(members),
                    "available": len(members) > 0,
                }
            )
        return out

    async def ensure_synced(self, max_age_sec: float = 21600.0) -> None:
        has_all = all(bool(self.cache.universe_members.get(u["id"])) for u in UNIVERSE_DEFINITIONS)
        if has_all and self._last_sync_mono and (time.monotonic() - self._last_sync_mono) < max_age_sec:
            return
        if has_all and not self._last_sync_mono:
            self._last_sync_mono = time.monotonic()
            return
        await self.refresh_security_master()

    async def refresh_security_master(self) -> dict[str, int]:
        async with self._sync_lock:
            sem = asyncio.Semaphore(6)

            async def fetch_one(u: dict[str, str]) -> tuple[str, list[dict[str, str]]]:
                url = ARCHIVE_CSV_BASE + u["csv"]
                async with sem:
                    try:
                        resp = await self.http.get(url)
                        if resp.status_code != 200 or not resp.text:
                            return u["id"], []
                        reader = csv.DictReader(io.StringIO(resp.text))
                        parsed = []
                        for row in reader:
                            sym = (row.get("Symbol") or "").strip().upper()
                            series = (row.get("Series") or "EQ").strip().upper()
                            if not sym or sym.startswith("DUMMY") or series not in ("EQ", "BE", "BZ", ""):
                                continue
                            parsed.append(
                                {
                                    "symbol": sym,
                                    "companyName": (row.get("Company Name") or sym).strip(),
                                    "nseIndustry": (row.get("Industry") or "").strip(),
                                    "isin": (row.get("ISIN Code") or "").strip(),
                                    "series": series or "EQ",
                                }
                            )
                        return u["id"], parsed
                    except Exception as exc:
                        logger.warning("Failed to fetch constituent CSV %s: %s", u["csv"], exc)
                        return u["id"], []

            results = await asyncio.gather(*[fetch_one(u) for u in UNIVERSE_DEFINITIONS])

            memberships_by_sym: dict[str, list[str]] = {}
            sec_master: dict[str, dict[str, Any]] = dict(self.cache.security_master)
            universes_out: dict[str, list[str]] = {}

            for uid, rows in results:
                if not rows:
                    if uid in self.cache.universe_members:
                        universes_out[uid] = self.cache.universe_members[uid]
                    continue
                syms_ordered: list[str] = []
                seen_s: set[str] = set()
                for r in rows:
                    sym = r["symbol"]
                    if sym in seen_s:
                        continue
                    seen_s.add(sym)
                    syms_ordered.append(sym)
                    memberships_by_sym.setdefault(sym, []).append(uid)
                    sector, industry = self.classifier.classify(sym, r["nseIndustry"])
                    existing = sec_master.get(sym, {})
                    sec_master[sym] = {
                        "symbol": sym,
                        "companyName": r["companyName"] or existing.get("companyName") or sym,
                        "exchange": "NSE",
                        "series": r["series"],
                        "isin": r["isin"] or existing.get("isin") or "",
                        "instrumentId": existing.get("instrumentId") or f"NSE:{sym}",
                        "sector": sector,
                        "industry": industry,
                        "nseMacroIndustry": r["nseIndustry"] or existing.get("nseMacroIndustry") or "",
                        "marketCap": existing.get("marketCap"),
                        "indexMemberships": memberships_by_sym[sym],
                    }
                universes_out[uid] = syms_ordered

            for sym, idxs in memberships_by_sym.items():
                if sym in sec_master:
                    sec_master[sym]["indexMemberships"] = list(dict.fromkeys(idxs))

            if sec_master and universes_out:
                self.cache.save_security_master_batch(sec_master, universes_out)
                self._last_sync_mono = time.monotonic()

            return {uid: len(syms) for uid, syms in universes_out.items()}

    def register_live_constituents(self, universe_id: str, live_rows: list[dict[str, Any]]) -> None:
        """Supplements security master if NSE live index feed includes newly rebalanced symbols."""
        if not live_rows:
            return
        updated_sec: dict[str, dict[str, Any]] = {}
        live_syms: list[str] = []
        seen: set[str] = set()
        for r in live_rows:
            sym = str(r.get("symbol") or "").strip().upper()
            if not sym or sym in seen or r.get("priority") == 1:
                continue
            seen.add(sym)
            live_syms.append(sym)
            existing = self.cache.security_master.get(sym)
            if not existing:
                sector, industry = self.classifier.classify(sym, None)
                updated_sec[sym] = {
                    "symbol": sym,
                    "companyName": str(r.get("companyName") or sym).strip(),
                    "exchange": "NSE",
                    "series": str(r.get("series") or "EQ"),
                    "isin": "",
                    "instrumentId": str(r.get("identifier") or f"NSE:{sym}"),
                    "sector": sector,
                    "industry": industry,
                    "nseMacroIndustry": "",
                    "marketCap": r.get("ffmc"),
                    "indexMemberships": [universe_id],
                }
            else:
                mems = list(dict.fromkeys([*(existing.get("indexMemberships") or []), universe_id]))
                if mems != existing.get("indexMemberships") or (r.get("ffmc") and not existing.get("marketCap")):
                    copy_m = dict(existing)
                    copy_m["indexMemberships"] = mems
                    if r.get("ffmc"):
                        copy_m["marketCap"] = float(r["ffmc"])
                    updated_sec[sym] = copy_m

        # Only overwrite universe_members from live feed if CSV sync had failed for that universe
        univ_patch = {universe_id: live_syms} if not self.cache.universe_members.get(universe_id) else {}
        if updated_sec or univ_patch:
            self.cache.save_security_master_batch(updated_sec, univ_patch)

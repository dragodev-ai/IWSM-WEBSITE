"""FastAPI Router & Startup Wiring for `/api/heatmap/*` REST + WebSocket Endpoints."""
from __future__ import annotations

import asyncio
import gzip
import json
import logging
from typing import Any

from fastapi import FastAPI, HTTPException, Query, Request, WebSocket
from fastapi.responses import Response

from .heatmap_cache_service import HeatmapCacheService
from .heatmap_service import HeatmapService
from .market_data_service import MarketDataService
from .quote_normalization_service import QuoteNormalizationService
from .sector_classification_service import SectorClassificationService
from .stock_universe_service import StockUniverseService
from .websocket_service import HeatmapWebSocketService

logger = logging.getLogger("iwsm.heatmap.router")

HEATMAP_PREFIX = "/api/heatmap"


def _gzip_or_json(req: Request, payload: dict[str, Any]) -> Response:
    raw = json.dumps(payload, separators=(",", ":")).encode("utf-8")
    if "gzip" in (req.headers.get("accept-encoding") or "") and len(raw) > 2048:
        return Response(
            content=gzip.compress(raw, compresslevel=1),
            media_type="application/json",
            headers={"Content-Encoding": "gzip"},
        )
    return Response(content=raw, media_type="application/json")


def install_heatmap(
    app: FastAPI,
    db_path: str | None = None,
    transport=None,
) -> HeatmapService:
    cache = HeatmapCacheService(db_path=db_path)
    classifier = SectorClassificationService()
    normalizer = QuoteNormalizationService()
    universes = StockUniverseService(cache=cache, classifier=classifier, http_client=None)
    market_data = MarketDataService(
        cache=cache,
        universe_service=universes,
        normalizer=normalizer,
        classifier=classifier,
        transport=transport,
    )
    if transport is not None:
        universes._external_http = True
        universes.http = market_data.http
    service = HeatmapService(cache=cache, universes=universes, market_data=market_data)
    ws_service = HeatmapWebSocketService(heatmap_service=service, refresh_interval_sec=6.0)

    app.state.heatmap_cache = cache
    app.state.heatmap_service = service
    app.state.heatmap_ws = ws_service

    @app.get(HEATMAP_PREFIX + "/status")
    async def heatmap_status() -> dict[str, Any]:
        return service.get_status()

    @app.get(HEATMAP_PREFIX + "/universes")
    async def heatmap_universes() -> dict[str, Any]:
        await universes.ensure_synced()
        return {
            "universes": universes.list_universes(),
            "status": service.get_status(),
        }

    @app.get(HEATMAP_PREFIX + "/metrics")
    async def heatmap_metrics(universe: str = Query("NIFTY 50")) -> dict[str, Any]:
        resolved = universes.resolve_universe_id(universe)
        if not resolved:
            raise HTTPException(422, f"Unsupported stock universe '{universe}'")
        await service.ensure_universe_quotes(resolved)
        return service.get_supported_metrics(resolved)

    @app.get(HEATMAP_PREFIX + "/securities")
    async def heatmap_securities(
        req: Request,
        universe: str = Query("NIFTY 50"),
        sector: str = Query(""),
        industry: str = Query(""),
        search: str = Query(""),
        preset: str = Query(""),
    ) -> Response:
        try:
            resolved, all_secs = await service.ensure_universe_quotes(universe)
        except ValueError as exc:
            raise HTTPException(422, str(exc)) from None
        except Exception as exc:
            raise HTTPException(503, f"Market-data provider unavailable: {exc}") from None

        filtered = service.filter_securities(
            all_secs,
            {"sector": sector, "industry": industry, "search": search, "preset": preset},
        )
        return _gzip_or_json(
            req,
            {
                "universe": resolved,
                "totalUniverseCount": len(all_secs),
                "matchedCount": len(filtered),
                "securities": filtered,
                "sectors": service.aggregate_sectors(filtered, "sector"),
                "industries": service.aggregate_sectors(filtered, "industry"),
                "status": service.get_status(),
                "metrics": service.get_supported_metrics(resolved),
            },
        )

    @app.get(HEATMAP_PREFIX + "/quotes")
    async def heatmap_quotes(
        req: Request,
        universe: str = Query("NIFTY 50"),
        force: bool = Query(False),
    ) -> Response:
        resolved = universes.resolve_universe_id(universe)
        if not resolved:
            raise HTTPException(422, f"Unsupported stock universe '{universe}'")
        if force:
            try:
                await market_data.refresh_live_quotes("NSE All Stocks", force_persist=True)
            except Exception as exc:
                if not cache.latest_quotes:
                    raise HTTPException(503, f"Market-data provider unavailable: {exc}") from None
        _, all_secs = await service.ensure_universe_quotes(resolved)
        return _gzip_or_json(
            req,
            {
                "universe": resolved,
                "count": len(all_secs),
                "quotes": all_secs,
                "status": service.get_status(),
            },
        )

    @app.get(HEATMAP_PREFIX + "/sectors")
    async def heatmap_sectors(
        universe: str = Query("NIFTY 50"),
        group_by: str = Query("sector"),
    ) -> dict[str, Any]:
        try:
            resolved, all_secs = await service.ensure_universe_quotes(universe)
        except ValueError as exc:
            raise HTTPException(422, str(exc)) from None
        grp = "industry" if group_by.strip().lower() == "industry" else "sector"
        return {
            "universe": resolved,
            "groupBy": grp,
            "groups": service.aggregate_sectors(all_secs, grp),
            "status": service.get_status(),
        }

    @app.post(HEATMAP_PREFIX + "/filters")
    async def heatmap_apply_filters(req: Request) -> Response:
        try:
            body = await req.json()
        except Exception:
            raise HTTPException(422, "Invalid JSON filter payload") from None
        if not isinstance(body, dict):
            raise HTTPException(422, "Filter body must be a JSON object")

        raw_u = str(body.get("universe") or "NIFTY 50")
        try:
            resolved, all_secs = await service.ensure_universe_quotes(raw_u)
        except ValueError as exc:
            raise HTTPException(422, str(exc)) from None
        except Exception as exc:
            raise HTTPException(503, f"Market-data provider unavailable: {exc}") from None

        filters = body.get("filters") if isinstance(body.get("filters"), dict) else body
        matched = service.filter_securities(all_secs, filters)
        return _gzip_or_json(
            req,
            {
                "universe": resolved,
                "totalUniverseCount": len(all_secs),
                "matchedCount": len(matched),
                "securities": matched,
                "sectors": service.aggregate_sectors(matched, "sector"),
                "industries": service.aggregate_sectors(matched, "industry"),
                "status": service.get_status(),
            },
        )

    @app.get(HEATMAP_PREFIX + "/stock/{symbol}")
    async def heatmap_stock_detail(symbol: str) -> dict[str, Any]:
        try:
            detail = await service.get_stock_detail(symbol)
            return {**detail, "status": service.get_status()}
        except ValueError as exc:
            raise HTTPException(422, str(exc)) from None
        except LookupError as exc:
            raise HTTPException(404, str(exc)) from None
        except Exception as exc:
            raise HTTPException(503, f"Stock detail unavailable: {exc}") from None

    @app.websocket(HEATMAP_PREFIX + "/ws")
    async def heatmap_websocket(ws: WebSocket, universe: str = "NIFTY 50") -> None:
        await ws_service.handle_client(ws, initial_universe=universe)

    async def _heatmap_startup_prewarm() -> None:
        if not getattr(app.state, "enable_prewarm", False):
            return
        try:
            await universes.ensure_synced()
            await market_data.refresh_live_quotes("NSE All Stocks", force_persist=True)
            ws_service.start_background_broadcaster()
            # Sync historical UDiFF Bhavcopy baselines (1W/1M/3M/6M/YTD/1Y + 20D volume/volatility) in background
            await market_data.sync_bhavcopy_baselines()
            # Seed 1D intraday anchors (5M/15M/1H %) for NIFTY 50 constituents
            nifty50 = cache.universe_members.get("NIFTY 50", [])
            if nifty50:
                await market_data.seed_intraday_anchors(nifty50, concurrency=5)
        except Exception as exc:
            logger.warning("Heatmap background prewarm warning: %s", exc)

    @app.on_event("startup")
    async def _on_heatmap_startup() -> None:
        if getattr(app.state, "enable_prewarm", False):
            app.state.heatmap_prewarm_task = asyncio.create_task(_heatmap_startup_prewarm())

    @app.on_event("shutdown")
    async def _on_heatmap_shutdown() -> None:
        await ws_service.stop_background_broadcaster()
        await market_data.aclose()
        await universes.aclose()

    return service

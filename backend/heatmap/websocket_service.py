"""WebSocket Subscription & Incremental Delta Broadcasting Service for Heatmap."""
from __future__ import annotations

import asyncio
import json
import logging
import os
import re
import time
from collections import deque
from dataclasses import dataclass, field
from typing import Any
from urllib.parse import urlsplit

from fastapi import WebSocket, WebSocketDisconnect

from .heatmap_service import HeatmapService
from .quote_normalization_service import equity_market_status_ist

logger = logging.getLogger("iwsm.heatmap.ws")

MAX_WS_FRAME_BYTES = 4096
WS_RATE_WINDOW_SEC = 10.0
WS_MAX_MSGS_PER_WINDOW = 15
_LOOPBACK_ORIGIN_RE = re.compile(r"^http://(127\.0\.0\.1|localhost)(:\d+)?$", re.IGNORECASE)


def _is_allowed_ws_origin(origin: str | None, fetch_site: str | None) -> bool:
    if (fetch_site or "").strip().lower() == "cross-site":
        return False
    if origin is None or origin == "":
        return True
    cleaned = origin.strip()
    if cleaned.lower() == "null":
        return False
    if _LOOPBACK_ORIGIN_RE.match(cleaned):
        return True
    extras = os.getenv("IWSM_ALLOWED_ORIGINS", "")
    for raw in extras.split(","):
        cand = raw.strip()
        if not cand:
            continue
        p = urlsplit(cand)
        if p.scheme in ("http", "https") and p.netloc and f"{p.scheme}://{p.netloc}".lower() == cleaned.lower():
            return True
    return False


@dataclass
class ClientSubscription:
    ws: WebSocket
    universe: str = "NIFTY 50"
    filters: dict[str, Any] = field(default_factory=dict)


class HeatmapWebSocketService:
    def __init__(self, heatmap_service: HeatmapService, refresh_interval_sec: float = 6.0) -> None:
        self.heatmap = heatmap_service
        self.refresh_interval_sec = max(3.0, refresh_interval_sec)
        self._clients: dict[int, ClientSubscription] = {}
        self._loop_task: asyncio.Task | None = None
        self._running = False

    def start_background_broadcaster(self) -> None:
        if self._loop_task and not self._loop_task.done():
            return
        self._running = True
        self._loop_task = asyncio.create_task(self._broadcast_loop())

    async def stop_background_broadcaster(self) -> None:
        self._running = False
        if self._loop_task and not self._loop_task.done():
            self._loop_task.cancel()
            try:
                await self._loop_task
            except asyncio.CancelledError:
                pass

    async def _safe_send(self, sub: ClientSubscription, event: str, data: dict[str, Any]) -> bool:
        try:
            await sub.ws.send_text(json.dumps({"event": event, "data": data}, separators=(",", ":")))
            return True
        except Exception:
            return False

    async def send_initial_snapshot(self, sub: ClientSubscription) -> None:
        try:
            uid, all_secs = await self.heatmap.ensure_universe_quotes(sub.universe)
            sub.universe = uid
            filtered = self.heatmap.filter_securities(all_secs, sub.filters)
            sectors = self.heatmap.aggregate_sectors(filtered, "sector")
            status = self.heatmap.get_status()
            metrics = self.heatmap.get_supported_metrics(uid)
            await self._safe_send(
                sub,
                "heatmap:initial",
                {
                    "universe": uid,
                    "totalUniverseCount": len(all_secs),
                    "matchedCount": len(filtered),
                    "securities": filtered,
                    "sectors": sectors,
                    "status": status,
                    "metrics": metrics,
                },
            )
            await self._safe_send(sub, "heatmap:connection_status", status)
        except Exception as exc:
            logger.warning("Heatmap WS initial snapshot error: %s", type(exc).__name__)
            await self._safe_send(sub, "heatmap:error", {"message": "Unable to load market heatmap snapshot"})

    async def handle_client(self, ws: WebSocket, initial_universe: str = "NIFTY 50") -> None:
        if not _is_allowed_ws_origin(ws.headers.get("origin"), ws.headers.get("sec-fetch-site")):
            await ws.close(code=1008)
            return
        await ws.accept()
        cid = id(ws)
        resolved = self.heatmap.universes.resolve_universe_id(initial_universe) or "NIFTY 50"
        sub = ClientSubscription(ws=ws, universe=resolved)
        self._clients[cid] = sub
        self.start_background_broadcaster()
        msg_times: deque[float] = deque()

        await self.send_initial_snapshot(sub)

        try:
            while True:
                raw_msg = await ws.receive_text()
                if len(raw_msg.encode("utf-8")) > MAX_WS_FRAME_BYTES:
                    await self._safe_send(sub, "heatmap:error", {"message": "WebSocket payload too large"})
                    continue
                now_mono = time.monotonic()
                while msg_times and now_mono - msg_times[0] > WS_RATE_WINDOW_SEC:
                    msg_times.popleft()
                if len(msg_times) >= WS_MAX_MSGS_PER_WINDOW:
                    await self._safe_send(sub, "heatmap:error", {"message": "Rate limit exceeded; slow down requests"})
                    continue
                msg_times.append(now_mono)
                try:
                    msg = json.loads(raw_msg)
                except ValueError:
                    await self._safe_send(sub, "heatmap:error", {"message": "Invalid WebSocket JSON payload"})
                    continue
                if not isinstance(msg, dict):
                    await self._safe_send(sub, "heatmap:error", {"message": "Invalid WebSocket JSON payload"})
                    continue

                action = str(msg.get("type") or msg.get("action") or "").strip().lower()
                if action in ("subscribe", "update_filters"):
                    req_u = msg.get("universe")
                    if req_u:
                        u_norm = self.heatmap.universes.resolve_universe_id(str(req_u))
                        if not u_norm:
                            await self._safe_send(sub, "heatmap:error", {"message": f"Unknown universe '{req_u}'"})
                            continue
                        sub.universe = u_norm
                    if isinstance(msg.get("filters"), dict):
                        sub.filters = msg["filters"]
                    await self.send_initial_snapshot(sub)
                elif action == "ping":
                    await self._safe_send(sub, "heatmap:connection_status", self.heatmap.get_status())
        except WebSocketDisconnect:
            pass
        except Exception:
            pass
        finally:
            self._clients.pop(cid, None)

    async def _broadcast_loop(self) -> None:
        while self._running:
            try:
                if not self._clients:
                    await asyncio.sleep(3.0)
                    continue

                mkt = equity_market_status_ist()
                wait_sec = self.refresh_interval_sec if mkt["isOpen"] else 30.0
                await asyncio.sleep(wait_sec)

                if not self._clients:
                    continue

                if mkt["isOpen"]:
                    try:
                        changed_map = await self.heatmap.market_data.refresh_live_quotes("NSE All Stocks")
                    except Exception as exc:
                        err_status = self.heatmap.get_status()
                        for cid, sub in list(self._clients.items()):
                            ok = await self._safe_send(sub, "heatmap:connection_status", err_status)
                            if not ok:
                                self._clients.pop(cid, None)
                        logger.debug("WS quote poll error: %s", exc)
                        continue
                else:
                    changed_map = {}

                status = self.heatmap.get_status()
                for cid, sub in list(self._clients.items()):
                    if changed_map:
                        members = set(self.heatmap.cache.universe_members.get(sub.universe, []))
                        relevant_changed = [q for sym, q in changed_map.items() if sym in members]
                        filtered_deltas = self.heatmap.filter_securities(relevant_changed, sub.filters)
                        if filtered_deltas:
                            ok1 = await self._safe_send(
                                sub,
                                "heatmap:quote_update",
                                {
                                    "universe": sub.universe,
                                    "updates": filtered_deltas,
                                    "exchangeTimestamp": status.get("exchangeTimestamp"),
                                    "lastSyncAt": status.get("lastSyncAt"),
                                },
                            )
                            all_u = [
                                self.heatmap.cache.latest_quotes[s]
                                for s in self.heatmap.cache.universe_members.get(sub.universe, [])
                                if s in self.heatmap.cache.latest_quotes
                            ]
                            filtered_all = self.heatmap.filter_securities(all_u, sub.filters)
                            sectors = self.heatmap.aggregate_sectors(filtered_all, "sector")
                            ok2 = await self._safe_send(
                                sub,
                                "heatmap:sector_update",
                                {"universe": sub.universe, "sectors": sectors, "matchedCount": len(filtered_all)},
                            )
                            if not (ok1 and ok2):
                                self._clients.pop(cid, None)
                                continue
                    ok_st = await self._safe_send(sub, "heatmap:connection_status", status)
                    if not ok_st:
                        self._clients.pop(cid, None)
            except asyncio.CancelledError:
                break
            except Exception as exc:
                logger.warning("Unexpected error in heatmap WS loop: %s", exc)
                await asyncio.sleep(5.0)

"""Thread-safe RAM + SQLite cache store for Heatmap Security Master, Bhavcopy baselines,
latest live quotes, and rolling intraday price ring buffers.
"""
from __future__ import annotations

import json
import os
import sqlite3
import threading
import time
from collections import deque
from contextlib import closing
from pathlib import Path
from typing import Any


def default_heatmap_db_path() -> str:
    base = Path(os.environ.get("LOCALAPPDATA") or (Path.home() / ".iwsm"))
    folder = base / "IWSM"
    folder.mkdir(parents=True, exist_ok=True)
    return str(folder / "heatmap-store.sqlite3")


class HeatmapCacheService:
    def __init__(self, db_path: str | None = None) -> None:
        self.db_path = db_path or default_heatmap_db_path()
        self._lock = threading.RLock()
        self.security_master: dict[str, dict[str, Any]] = {}
        self.universe_members: dict[str, list[str]] = {}
        self.baselines: dict[str, dict[str, Any]] = {}
        self.latest_quotes: dict[str, dict[str, Any]] = {}
        self.intraday_ring: dict[str, deque[tuple[float, float]]] = {}
        self.intraday_charts: dict[str, tuple[float, list[dict[str, Any]]]] = {}
        self.last_quote_sync_epoch: float = 0.0
        self.last_exchange_timestamp: str | None = None
        self.last_provider_error: str | None = None
        self._init_db()
        self._load_persisted_state()

    def _connect(self) -> sqlite3.Connection:
        conn = sqlite3.connect(self.db_path, timeout=15.0)
        conn.execute("PRAGMA journal_mode=WAL")
        conn.execute("PRAGMA synchronous=NORMAL")
        return conn

    def _init_db(self) -> None:
        with closing(self._connect()) as conn, conn:
            conn.executescript(
                """
                CREATE TABLE IF NOT EXISTS security_master (
                    symbol TEXT PRIMARY KEY,
                    payload TEXT NOT NULL,
                    updated_at REAL NOT NULL
                );
                CREATE TABLE IF NOT EXISTS universe_constituents (
                    universe_id TEXT PRIMARY KEY,
                    symbols_json TEXT NOT NULL,
                    updated_at REAL NOT NULL
                );
                CREATE TABLE IF NOT EXISTS stock_baselines (
                    symbol TEXT PRIMARY KEY,
                    payload TEXT NOT NULL,
                    as_of_date TEXT NOT NULL,
                    updated_at REAL NOT NULL
                );
                CREATE TABLE IF NOT EXISTS latest_quotes (
                    symbol TEXT PRIMARY KEY,
                    payload TEXT NOT NULL,
                    exchange_ts TEXT,
                    updated_at REAL NOT NULL
                );
                CREATE TABLE IF NOT EXISTS bhav_dates_synced (
                    trade_date TEXT PRIMARY KEY,
                    row_count INTEGER NOT NULL,
                    synced_at REAL NOT NULL
                );
                CREATE TABLE IF NOT EXISTS bhav_daily_bars (
                    trade_date TEXT NOT NULL,
                    symbol TEXT NOT NULL,
                    isin TEXT,
                    instrument_id TEXT,
                    open_price REAL,
                    high_price REAL,
                    low_price REAL,
                    close_price REAL,
                    prev_close REAL,
                    volume REAL,
                    turnover REAL,
                    PRIMARY KEY (trade_date, symbol)
                );
                CREATE INDEX IF NOT EXISTS idx_bhav_symbol_date ON bhav_daily_bars(symbol, trade_date);
                """
            )

    def _load_persisted_state(self) -> None:
        with self._lock, closing(self._connect()) as conn:
            for sym, raw in conn.execute("SELECT symbol, payload FROM security_master").fetchall():
                try:
                    self.security_master[sym] = json.loads(raw)
                except Exception:
                    pass
            for uid, raw in conn.execute("SELECT universe_id, symbols_json FROM universe_constituents").fetchall():
                try:
                    self.universe_members[uid] = json.loads(raw)
                except Exception:
                    pass
            for sym, raw in conn.execute("SELECT symbol, payload FROM stock_baselines").fetchall():
                try:
                    self.baselines[sym] = json.loads(raw)
                except Exception:
                    pass
            max_updated = 0.0
            max_exch_ts = None
            for sym, raw, exch_ts, upd in conn.execute(
                "SELECT symbol, payload, exchange_ts, updated_at FROM latest_quotes"
            ).fetchall():
                try:
                    self.latest_quotes[sym] = json.loads(raw)
                    if upd and upd > max_updated:
                        max_updated = float(upd)
                        max_exch_ts = exch_ts
                except Exception:
                    pass
            if max_updated > 0:
                self.last_quote_sync_epoch = max_updated
                self.last_exchange_timestamp = max_exch_ts

    def save_security_master_batch(
        self,
        securities: dict[str, dict[str, Any]],
        universes: dict[str, list[str]],
    ) -> None:
        now = time.time()
        with self._lock:
            self.security_master.update(securities)
            self.universe_members.update(universes)
        with closing(self._connect()) as conn, conn:
            conn.executemany(
                "INSERT OR REPLACE INTO security_master(symbol, payload, updated_at) VALUES (?, ?, ?)",
                [(sym, json.dumps(meta, separators=(",", ":")), now) for sym, meta in securities.items()],
            )
            conn.executemany(
                "INSERT OR REPLACE INTO universe_constituents(universe_id, symbols_json, updated_at) VALUES (?, ?, ?)",
                [(uid, json.dumps(syms, separators=(",", ":")), now) for uid, syms in universes.items()],
            )

    def save_baselines_batch(self, baselines: dict[str, dict[str, Any]], as_of_date: str) -> None:
        now = time.time()
        with self._lock:
            self.baselines.update(baselines)
        with closing(self._connect()) as conn, conn:
            conn.executemany(
                "INSERT OR REPLACE INTO stock_baselines(symbol, payload, as_of_date, updated_at) VALUES (?, ?, ?, ?)",
                [(sym, json.dumps(b, separators=(",", ":")), as_of_date, now) for sym, b in baselines.items()],
            )

    def get_synced_bhav_dates(self) -> set[str]:
        with closing(self._connect()) as conn:
            return {r[0] for r in conn.execute("SELECT trade_date FROM bhav_dates_synced").fetchall()}

    def store_bhav_day(self, trade_date: str, rows: list[tuple]) -> None:
        now = time.time()
        with closing(self._connect()) as conn, conn:
            conn.executemany(
                """
                INSERT OR REPLACE INTO bhav_daily_bars(
                    trade_date, symbol, isin, instrument_id,
                    open_price, high_price, low_price, close_price, prev_close, volume, turnover
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                rows,
            )
            conn.execute(
                "INSERT OR REPLACE INTO bhav_dates_synced(trade_date, row_count, synced_at) VALUES (?, ?, ?)",
                (trade_date, len(rows), now),
            )

    def load_all_bhav_bars(self) -> tuple[list[str], dict[str, list[dict[str, Any]]]]:
        with closing(self._connect()) as conn:
            dates = [r[0] for r in conn.execute("SELECT DISTINCT trade_date FROM bhav_daily_bars ORDER BY trade_date ASC").fetchall()]
            by_sym: dict[str, list[dict[str, Any]]] = {}
            cur = conn.execute(
                """
                SELECT trade_date, symbol, isin, instrument_id, close_price, volume, turnover
                FROM bhav_daily_bars
                ORDER BY trade_date ASC
                """
            )
            for td, sym, isin, inst_id, cls_p, vol, turn in cur:
                by_sym.setdefault(sym, []).append(
                    {
                        "date": td,
                        "isin": isin,
                        "instrumentId": inst_id,
                        "close": cls_p,
                        "volume": vol,
                        "turnover": turn,
                    }
                )
            return dates, by_sym

    def record_intraday_price(self, symbol: str, epoch_sec: float, price: float) -> None:
        if price <= 0:
            return
        with self._lock:
            dq = self.intraday_ring.get(symbol)
            if dq is None:
                dq = deque(maxlen=900)
                self.intraday_ring[symbol] = dq
            if not dq or epoch_sec >= dq[-1][0] + 4.0:
                dq.append((epoch_sec, price))

    def seed_intraday_series(self, symbol: str, points: list[tuple[float, float]]) -> None:
        if not points:
            return
        with self._lock:
            dq = deque(maxlen=900)
            for ts_sec, pr in sorted(points, key=lambda x: x[0]):
                if pr > 0:
                    dq.append((ts_sec, pr))
            if dq:
                self.intraday_ring[symbol] = dq

    def lookup_intraday_anchor(self, symbol: str, now_epoch: float, lookback_sec: float, tolerance_sec: float = 210.0) -> float | None:
        target = now_epoch - lookback_sec
        with self._lock:
            dq = self.intraday_ring.get(symbol)
            if not dq:
                return None
            best_price = None
            best_diff = float("inf")
            for ts_sec, pr in dq:
                diff = abs(ts_sec - target)
                if diff < best_diff:
                    best_diff = diff
                    best_price = pr
            if best_diff <= tolerance_sec:
                return best_price
            return None

    def update_quotes(
        self,
        normalized_quotes: dict[str, dict[str, Any]],
        exchange_timestamp: str | None = None,
        persist_sqlite: bool = False,
    ) -> dict[str, dict[str, Any]]:
        """Updates in-memory quote store and returns ONLY changed security quotes for WS delta broadcast."""
        now = time.time()
        changed: dict[str, dict[str, Any]] = {}
        with self._lock:
            for sym, q in normalized_quotes.items():
                prev = self.latest_quotes.get(sym)
                if (
                    prev is None
                    or prev.get("price") != q.get("price")
                    or prev.get("changePct") != q.get("changePct")
                    or prev.get("volume1d") != q.get("volume1d")
                ):
                    changed[sym] = q
                self.latest_quotes[sym] = q
            self.last_quote_sync_epoch = now
            if exchange_timestamp:
                self.last_exchange_timestamp = exchange_timestamp
            self.last_provider_error = None

        if persist_sqlite and normalized_quotes:
            try:
                with closing(self._connect()) as conn, conn:
                    conn.executemany(
                        "INSERT OR REPLACE INTO latest_quotes(symbol, payload, exchange_ts, updated_at) VALUES (?, ?, ?, ?)",
                        [
                            (sym, json.dumps(q, separators=(",", ":")), exchange_timestamp, now)
                            for sym, q in normalized_quotes.items()
                        ],
                    )
            except sqlite3.Error:
                pass
        return changed

    def cache_intraday_chart(self, symbol: str, points: list[dict[str, Any]]) -> None:
        with self._lock:
            self.intraday_charts[symbol] = (time.monotonic(), points)

    def get_cached_intraday_chart(self, symbol: str, ttl_sec: float = 30.0) -> list[dict[str, Any]] | None:
        with self._lock:
            hit = self.intraday_charts.get(symbol)
            if hit and (time.monotonic() - hit[0]) <= ttl_sec:
                return hit[1]
            return None

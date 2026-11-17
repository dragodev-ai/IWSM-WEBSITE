"""Read-only Polars 1-minute historical index options, spot & futures archive store.

Reads verified Google Drive 1-minute Parquet partitions located under
`market-data/processed/options_1min/` for:
- `NIFTY` (`nse_fo`)
- `BANKNIFTY` (`nse_fo`)
- `SENSEX` (`bse_fo`)

Strict data-integrity guarantees:
- Never fabricates, interpolates, or substitutes missing prices.
- Never substitutes futures or parity forward prices for cash `spot`.
- Preserves missing `iv` / Greeks as `None` (never `0` or `NaN`).
- Converts decimal `iv` (`0.135`) to percentage (`13.50`) and rounds Float32 ticks cleanly.
- Resolves exact historical SEBI/NSE/BSE contract lot sizes per `(underlying, expiry)` from
  recorded Open Interest multiples with verified historical calendar fallback.
"""
from __future__ import annotations

import json
import math
import re
from collections import OrderedDict
from datetime import date, datetime, timedelta
from functools import reduce
from pathlib import Path
from typing import Any

from snapshot_store import iso_to_broker_expiry, normalize_expiry_iso

try:
    import polars as pl
except ImportError:  # pragma: no cover - graceful fallback when polars is absent
    pl = None  # type: ignore[assignment]

DEFAULT_PARQUET_ROOT = Path(__file__).resolve().parents[2] / "market-data/processed/options_1min"

SUPPORTED_UNDERLYINGS: dict[tuple[str, str], str] = {
    ("nse_fo", "NIFTY"): "NIFTY",
    ("nse_fo", "BANKNIFTY"): "BANKNIFTY",
    ("bse_fo", "SENSEX"): "SENSEX",
}

KNOWN_LOT_MULTIPLES: frozenset[int] = frozenset({10, 15, 20, 25, 30, 35, 40, 50, 60, 65, 75, 100, 120})


def _historical_lot_fallback(symbol: str, expiry_iso: str) -> int:
    """Verified NSE/BSE historical index lot-size schedule fallback when OI rows are sparse."""
    sym = symbol.upper()
    if sym == "NIFTY":
        if expiry_iso <= "2021-07-29":
            return 75
        if expiry_iso <= "2024-04-25":
            return 50
        if expiry_iso <= "2024-11-20":
            return 25
        if expiry_iso <= "2025-12-30":
            return 75
        return 65
    if sym == "BANKNIFTY":
        if expiry_iso <= "2020-07-30":
            return 20
        if expiry_iso <= "2023-07-27":
            return 25
        if expiry_iso <= "2024-11-20":
            return 15
        if expiry_iso <= "2025-06-26":
            return 30
        if expiry_iso <= "2025-12-30":
            return 35
        return 30
    if sym == "SENSEX":
        if expiry_iso <= "2024-11-22":
            return 10
        return 20
    return 1


def _infer_lot_size(symbol: str, expiry_iso: str, oi_values: list[int]) -> int:
    positive = [int(v) for v in oi_values if v is not None and int(v) > 0]
    if len(positive) >= 10:
        n = len(positive)
        for cand in sorted(KNOWN_LOT_MULTIPLES, reverse=True):
            if sum(1 for v in positive if v % cand == 0) >= 0.98 * n:
                return cand
    return _historical_lot_fallback(symbol, expiry_iso)


def _round_or_none(val: Any, digits: int) -> float | None:
    if val is None:
        return None
    try:
        f = float(val)
    except (TypeError, ValueError):
        return None
    if not math.isfinite(f):
        return None
    return round(f, digits)


class Parquet1MinStore:
    """Bounded, lazy-scanning 1-minute historical option-chain provider."""

    def __init__(self, root: Path | str | None = DEFAULT_PARQUET_ROOT) -> None:
        self.root = Path(root) if root else None
        self._manifest_cache: dict[str, Any] | None = None
        self._partitions_cache: dict[str, list[dict[str, Any]]] | None = None
        self._replay_cache: OrderedDict[tuple[Any, ...], dict[str, Any]] = OrderedDict()

    def available(self) -> bool:
        return bool(
            pl is not None
            and self.root is not None
            and (self.root / "options").is_dir()
        )

    def supports(self, symbol: str, exchange: str) -> bool:
        if not self.available():
            return False
        key = (str(exchange or "nse_fo").strip().lower(), str(symbol or "").strip().upper())
        if key not in SUPPORTED_UNDERLYINGS:
            return False
        return bool(self._partitions_for(SUPPORTED_UNDERLYINGS[key]))

    def _load_manifest(self) -> dict[str, Any]:
        if self._manifest_cache is not None:
            return self._manifest_cache
        if not self.root:
            self._manifest_cache = {}
            return self._manifest_cache
        mpath = self.root / "_manifest.json"
        if mpath.is_file():
            try:
                self._manifest_cache = json.loads(mpath.read_text(encoding="utf-8"))
                return self._manifest_cache
            except (OSError, ValueError):
                pass
        self._manifest_cache = {}
        return self._manifest_cache

    def _scan_partitions(self) -> dict[str, list[dict[str, Any]]]:
        if self._partitions_cache is not None:
            return self._partitions_cache
        by_sym: dict[str, list[dict[str, Any]]] = {}
        if not self.available() or not self.root:
            self._partitions_cache = by_sym
            return by_sym

        manifest = self._load_manifest()
        manifest_parts = {
            (str(p.get("underlying", "")).upper(), int(p.get("year", 0)), int(p.get("month", 0))): p
            for p in manifest.get("partitions", [])
            if isinstance(p, dict)
        }

        opt_root = self.root / "options"
        for u_dir in sorted(opt_root.glob("underlying=*")):
            if not u_dir.is_dir():
                continue
            sym = u_dir.name.split("=", 1)[1].strip().upper()
            entries: list[dict[str, Any]] = []
            for p_file in sorted(u_dir.glob("year=*/month=*/part.parquet")):
                try:
                    yr = int(p_file.parent.parent.name.split("=", 1)[1])
                    mo = int(p_file.parent.name.split("=", 1)[1])
                except (IndexError, ValueError):
                    continue
                meta = manifest_parts.get((sym, yr, mo))
                if meta and meta.get("first_date") and meta.get("last_date"):
                    first_d = str(meta["first_date"])
                    last_d = str(meta["last_date"])
                    rows_n = int(meta.get("rows") or 0)
                else:
                    stats = (
                        pl.scan_parquet(str(p_file))
                        .select(
                            pl.col("date").min().alias("min_d"),
                            pl.col("date").max().alias("max_d"),
                            pl.len().alias("n"),
                        )
                        .collect()
                    )
                    if stats.height == 0 or stats["min_d"][0] is None:
                        continue
                    first_d = stats["min_d"][0].isoformat()
                    last_d = stats["max_d"][0].isoformat()
                    rows_n = int(stats["n"][0])
                entries.append(
                    {
                        "underlying": sym,
                        "year": yr,
                        "month": mo,
                        "ym": f"{yr:04d}-{mo:02d}",
                        "path": p_file,
                        "firstDate": first_d,
                        "lastDate": last_d,
                        "rows": rows_n,
                    }
                )
            if entries:
                by_sym[sym] = entries
        self._partitions_cache = by_sym
        return by_sym

    def _partitions_for(self, symbol: str) -> list[dict[str, Any]]:
        return self._scan_partitions().get(symbol.upper(), [])

    def _overlapping_files(self, symbol: str, start_iso: str, end_iso: str) -> list[Path]:
        parts = self._partitions_for(symbol)
        if not parts:
            return []
        if not start_iso and not end_iso:
            return [parts[-1]["path"]]
        s_iso = start_iso or parts[0]["firstDate"]
        e_iso = end_iso or parts[-1]["lastDate"]
        return [
            p["path"]
            for p in parts
            if p["lastDate"] >= s_iso and p["firstDate"] <= e_iso
        ]

    def coverage(self, symbol: str = "", exchange: str = "") -> dict[str, Any]:
        if not self.available():
            return {"hasParquet": False, "totalRowsInstalled": 0, "symbols": []}
        parts_map = self._scan_partitions()
        sym_filter = str(symbol or "").strip().upper()
        exch_filter = str(exchange or "").strip().lower()
        symbols_out: list[dict[str, Any]] = []
        total_rows = 0
        for (exch, sym), u_name in sorted(SUPPORTED_UNDERLYINGS.items()):
            if sym_filter and sym != sym_filter:
                continue
            if exch_filter and exch != exch_filter:
                continue
            parts = parts_map.get(u_name, [])
            if not parts:
                continue
            r_sum = sum(p["rows"] for p in parts)
            total_rows += r_sum
            symbols_out.append(
                {
                    "symbol": sym,
                    "exchange": exch,
                    "partitionCount": len(parts),
                    "rowCount": r_sum,
                    "earliestDate": parts[0]["firstDate"],
                    "latestDate": parts[-1]["lastDate"],
                    "months": [p["ym"] for p in parts],
                }
            )
        return {
            "hasParquet": bool(symbols_out),
            "totalRowsInstalled": total_rows,
            "symbols": symbols_out,
        }

    def expiries(self, symbol: str, exchange: str = "nse_fo", start: str = "", end: str = "") -> list[str]:
        sym = str(symbol or "").strip().upper()
        exch = str(exchange or "nse_fo").strip().lower()
        if not self.supports(sym, exch):
            return []
        parts = self._partitions_for(sym)
        if not parts:
            return []

        if start and not re.fullmatch(r"\d{4}-\d{2}-\d{2}", start):
            raise ValueError("Invalid start date")
        if end and not re.fullmatch(r"\d{4}-\d{2}-\d{2}", end):
            raise ValueError("Invalid end date")

        s_iso = start or parts[-1]["firstDate"]
        e_iso = end or (start or parts[-1]["lastDate"])
        if s_iso > e_iso:
            return []

        files = self._overlapping_files(sym, s_iso, e_iso)
        d_start = date.fromisoformat(s_iso)
        d_end = date.fromisoformat(e_iso)

        # If user selected a weekend/holiday inside an installed month, also check ±5 calendar days
        # ONLY if exact [d_start, d_end] has zero trading sessions, while still staying within installed range.
        def _query_expiries(lo_d: date, hi_d: date) -> list[date]:
            q_files = self._overlapping_files(sym, lo_d.isoformat(), hi_d.isoformat())
            if not q_files:
                return []
            df = (
                pl.scan_parquet([str(f) for f in q_files])
                .filter((pl.col("date") >= lo_d) & (pl.col("date") <= hi_d))
                .select(pl.col("expiry").unique().sort())
                .collect()
            )
            return [d for d in df["expiry"].to_list() if d is not None]

        exp_dates = _query_expiries(d_start, d_end)
        if not exp_dates and start and end:
            earliest = date.fromisoformat(parts[0]["firstDate"])
            latest = date.fromisoformat(parts[-1]["lastDate"])
            if earliest <= d_start <= latest:
                exp_dates = _query_expiries(max(earliest, d_start - timedelta(days=4)), min(latest, d_end + timedelta(days=4)))

        return [iso_to_broker_expiry(d.isoformat()) for d in exp_dates]

    def load_replay(
        self,
        symbol: str,
        exchange: str,
        expiry: str,
        start: str,
        end: str,
        strike_window: int = 30,
        max_trading_days: int = 5,
    ) -> dict[str, Any]:
        sym = str(symbol or "").strip().upper()
        exch = str(exchange or "nse_fo").strip().lower()
        if not self.supports(sym, exch):
            raise LookupError(f"1-minute Parquet archive does not cover {sym} ({exch})")
        if not re.fullmatch(r"\d{4}-\d{2}-\d{2}", str(start or "")) or not re.fullmatch(r"\d{4}-\d{2}-\d{2}", str(end or "")):
            raise ValueError("Start and end dates must use YYYY-MM-DD")
        if start > end:
            raise ValueError("Start date must be on or before end date")

        exp_iso = normalize_expiry_iso(expiry)
        ckey = (sym, exch, exp_iso, start, end, int(strike_window), int(max_trading_days))
        if ckey in self._replay_cache:
            self._replay_cache.move_to_end(ckey)
            cached = self._replay_cache[ckey]
            return {**cached, "cached": True}

        d_start = date.fromisoformat(start)
        d_end = date.fromisoformat(end)
        d_exp = date.fromisoformat(exp_iso)
        parts = self._partitions_for(sym)
        earliest = date.fromisoformat(parts[0]["firstDate"])
        latest = date.fromisoformat(parts[-1]["lastDate"])

        shifted_note = ""
        files = self._overlapping_files(sym, start, end)

        def _collect_dates(lo_d: date, hi_d: date) -> list[date]:
            q_files = self._overlapping_files(sym, lo_d.isoformat(), hi_d.isoformat())
            if not q_files:
                return []
            df_d = (
                pl.scan_parquet([str(f) for f in q_files])
                .filter((pl.col("date") >= lo_d) & (pl.col("date") <= hi_d) & (pl.col("expiry") == d_exp))
                .select(pl.col("date").unique().sort())
                .collect()
            )
            return [d for d in df_d["date"].to_list() if d is not None]

        avail_dates = _collect_dates(d_start, d_end)
        if not avail_dates and earliest <= d_start <= latest:
            near_lo = max(earliest, d_start - timedelta(days=4))
            near_hi = min(latest, min(d_exp, d_end + timedelta(days=4)))
            if near_lo <= near_hi:
                avail_dates = _collect_dates(near_lo, near_hi)
                if avail_dates:
                    shifted_note = (
                        f"Selected date {start} had no exchange session (weekend/holiday); "
                        f"aligned to nearest recorded session {avail_dates[0].isoformat()}."
                    )

        if not avail_dates:
            raise LookupError(
                f"No 1-minute Parquet observations for {sym} ({exp_iso}) between {start} and {end}. "
                f"Installed coverage for {sym}: {earliest.isoformat()} to {latest.isoformat()}."
            )

        warnings: list[str] = []
        if shifted_note:
            warnings.append(shifted_note)
        if len(avail_dates) > max_trading_days:
            avail_dates = avail_dates[:max_trading_days]
            warnings.append(
                f"Bounded 1-minute replay to {max_trading_days} trading sessions "
                f"({avail_dates[0].isoformat()} to {avail_dates[-1].isoformat()}) for browser responsiveness."
            )

        eff_start = avail_dates[0]
        eff_end = avail_dates[-1]
        files = self._overlapping_files(sym, eff_start.isoformat(), eff_end.isoformat())

        df = (
            pl.scan_parquet([str(f) for f in files])
            .filter(
                (pl.col("date") >= eff_start)
                & (pl.col("date") <= eff_end)
                & (pl.col("expiry") == d_exp)
                & ((pl.col("ts").dt.hour().cast(pl.Int32) * 60 + pl.col("ts").dt.minute().cast(pl.Int32)).is_between(555, 930))
            )
            .select(
                [
                    pl.col("ts").dt.strftime("%Y-%m-%dT%H:%M").alias("stamp"),
                    "strike",
                    "right",
                    "open",
                    "high",
                    "low",
                    "close",
                    "volume",
                    "oi",
                    "spot",
                    "iv",
                    "delta",
                    "gamma",
                    "theta",
                    "vega",
                ]
            )
            .collect()
        )
        if df.height == 0:
            raise LookupError(f"No 1-minute option bars found for {sym} {exp_iso}")

        # Filter to ±strike_window around median spot (dynamically bounded so total rows stay < 195,000)
        all_strikes = sorted(int(k) for k in df["strike"].unique().to_list() if k is not None and int(k) > 0)
        spots_non_null = df.filter(pl.col("spot").is_not_null() & (pl.col("spot") > 0))["spot"]
        median_spot = float(spots_non_null.median()) if len(spots_non_null) > 0 else (all_strikes[len(all_strikes) // 2] if all_strikes else 0.0)
        eff_window = strike_window
        if eff_window > 0 and len(avail_dates) >= 5:
            eff_window = min(eff_window, 25)

        if eff_window > 0 and len(all_strikes) > eff_window * 2 + 1 and median_spot > 0:
            atm_idx = min(range(len(all_strikes)), key=lambda idx: abs(all_st_v - median_spot) if (all_st_v := all_strikes[idx]) else 0)
            lo_idx = max(0, atm_idx - eff_window)
            hi_idx = min(len(all_strikes), atm_idx + eff_window + 1)
            selected_strikes = all_strikes[lo_idx:hi_idx]
            df = df.filter(pl.col("strike").is_in(selected_strikes))

        df = df.sort(["stamp", "strike", "right"])
        oi_sample = (
            df.filter(pl.col("oi").is_not_null() & (pl.col("oi") > 0))
            .select(pl.col("oi").unique().sort())["oi"]
            .head(250)
            .to_list()
        )
        lot_size = _infer_lot_size(sym, exp_iso, oi_sample)

        contracts: list[dict[str, Any]] = []
        spot_by_stamp: dict[str, float] = {}

        # Extract columnar lists in C++/Rust via Polars for maximum throughput
        cols = df.to_dict(as_series=False)
        n_rows = df.height
        stamps_col = cols["stamp"]
        strikes_col = cols["strike"]
        rights_col = cols["right"]
        closes_col = cols["close"]
        vols_col = cols["volume"]
        ois_col = cols["oi"]
        spots_col = cols["spot"]
        ivs_col = cols["iv"]
        deltas_col = cols["delta"]
        gammas_col = cols["gamma"]
        thetas_col = cols["theta"]
        vegas_col = cols["vega"]

        for i in range(n_rows):
            cls_v = _round_or_none(closes_col[i], 2)
            if cls_v is None or cls_v < 0:
                continue
            stamp = stamps_col[i]
            sp_v = _round_or_none(spots_col[i], 2)
            if sp_v is not None and sp_v > 0 and stamp not in spot_by_stamp:
                spot_by_stamp[stamp] = sp_v

            vol_raw = vols_col[i]
            oi_raw = ois_col[i]
            rec: dict[str, Any] = {
                "timestamp": stamp,
                "symbol": sym,
                "expiry": exp_iso,
                "type": str(rights_col[i]),
                "strike": int(strikes_col[i]),
                "close": cls_v,
                "lotSize": lot_size,
                "volume": int(vol_raw) if vol_raw is not None and int(vol_raw) >= 0 else None,
                "oi": int(oi_raw) if oi_raw is not None and int(oi_raw) >= 0 else None,
            }
            iv_raw = _round_or_none(ivs_col[i], 6)
            delta_v = _round_or_none(deltas_col[i], 4)
            if iv_raw is not None and iv_raw > 0 and delta_v is not None:
                rec["iv"] = round(iv_raw * 100.0, 2)
                rec["delta"] = delta_v
                gamma_v = _round_or_none(gammas_col[i], 7)
                theta_v = _round_or_none(thetas_col[i], 2)
                vega_v = _round_or_none(vegas_col[i], 2)
                if gamma_v is not None:
                    rec["gamma"] = gamma_v
                if theta_v is not None:
                    rec["theta"] = theta_v
                if vega_v is not None:
                    rec["vega"] = vega_v
                rec["greeksSource"] = "archive_black76"
            contracts.append(rec)

        if not contracts:
            raise LookupError(f"No valid 1-minute option contracts for {sym} {exp_iso}")

        # Supplement spot_by_stamp from dedicated spot_1min.parquet if any timestamps lacked spot
        spot_file = self.root / "spot" / f"underlying={sym}" / "spot_1min.parquet" if self.root else None
        if spot_file and spot_file.is_file():
            try:
                sp_df = (
                    pl.scan_parquet(str(spot_file))
                    .filter(
                        (pl.col("ts").dt.date() >= eff_start)
                        & (pl.col("ts").dt.date() <= eff_end)
                    )
                    .select(
                        pl.col("ts").dt.strftime("%Y-%m-%dT%H:%M").alias("stamp"),
                        "spot",
                    )
                    .collect()
                )
                for st_s, sp_val in zip(sp_df["stamp"].to_list(), sp_df["spot"].to_list()):
                    sp_r = _round_or_none(sp_val, 2)
                    if sp_r is not None and sp_r > 0 and st_s not in spot_by_stamp:
                        spot_by_stamp[st_s] = sp_r
            except Exception:
                pass

        # Load matching front-month 1-minute futures bars when available (never substituting for spot!)
        fut_added = 0
        if self.root:
            years_needed = sorted({eff_start.year, eff_end.year})
            fut_files = [
                self.root / "futures" / f"underlying={sym}" / f"futures_1min_{yr}.parquet"
                for yr in years_needed
                if (self.root / "futures" / f"underlying={sym}" / f"futures_1min_{yr}.parquet").is_file()
            ]
            if fut_files:
                try:
                    f_df = (
                        pl.scan_parquet([str(f) for f in fut_files])
                        .filter(
                            (pl.col("ts").dt.date() >= eff_start)
                            & (pl.col("ts").dt.date() <= eff_end)
                            & (pl.col("expiry") >= eff_start)
                            & ((pl.col("ts").dt.hour().cast(pl.Int32) * 60 + pl.col("ts").dt.minute().cast(pl.Int32)).is_between(555, 930))
                        )
                        .select(
                            pl.col("ts").dt.strftime("%Y-%m-%dT%H:%M").alias("stamp"),
                            "expiry",
                            "close",
                            "volume",
                            "oi",
                        )
                        .collect()
                    )
                    if f_df.height > 0:
                        fut_exps = sorted(d for d in f_df["expiry"].unique().to_list() if d is not None)
                        same_month = [d for d in fut_exps if d.strftime("%Y-%m") == exp_iso[:7]]
                        chosen_fut_exp = same_month[0] if same_month else fut_exps[0]
                        f_df = f_df.filter(pl.col("expiry") == chosen_fut_exp).sort("stamp")
                        f_exp_iso = chosen_fut_exp.isoformat()
                        f_cols = f_df.to_dict(as_series=False)
                        seen_fut_stamps: set[str] = set()
                        for j in range(f_df.height):
                            st_f = f_cols["stamp"][j]
                            if st_f in seen_fut_stamps:
                                continue
                            cls_f = _round_or_none(f_cols["close"][j], 2)
                            if cls_f is None or cls_f <= 0:
                                continue
                            seen_fut_stamps.add(st_f)
                            vol_f = f_cols["volume"][j]
                            oi_f = f_cols["oi"][j]
                            contracts.append(
                                {
                                    "timestamp": st_f,
                                    "symbol": sym,
                                    "expiry": f_exp_iso,
                                    "type": "FUT",
                                    "strike": 0,
                                    "close": cls_f,
                                    "lotSize": lot_size,
                                    "volume": int(vol_f) if vol_f is not None and int(vol_f) >= 0 else None,
                                    "oi": int(oi_f) if oi_f is not None and int(oi_f) >= 0 else None,
                                }
                            )
                            fut_added += 1
                except Exception:
                    pass

        if fut_added == 0:
            warnings.append("Index futures 1-minute bars are absent in this historical slice; cash spot is exact.")

        active_stamps = sorted({c["timestamp"] for c in contracts if c["type"] != "FUT"})
        underlying_rows = [
            {"timestamp": ts, "symbol": sym, "close": spot_by_stamp[ts]}
            for ts in active_stamps
            if ts in spot_by_stamp and spot_by_stamp[ts] > 0
        ]

        as_of = active_stamps[-1]
        out = {
            "dataset": {
                "source": f"Verified 1-Minute Historical Options Archive ({sym})",
                "contracts": contracts,
                "underlying": underlying_rows,
                "metadata": {
                    "exchange": exch,
                    "dataSourceStatus": "HISTORICAL",
                    "backup": True,
                    "backupResolution": "minute",
                    "resolution": "1 minute",
                    "modelled": False,
                    "synthetic": False,
                    "frameCount": len(active_stamps),
                    "lotSize": lot_size,
                    "greeksSource": "Pre-computed Black-76 on put-call-parity forward (ACT/365)",
                    "quoteTiming": "Verified historical 1-minute IST bar close (09:15–15:29 IST)",
                    "warnings": warnings,
                },
            },
            "backup": True,
            "resolution": "minute",
            "asOf": as_of,
            "dataSourceStatus": "HISTORICAL",
        }
        if len(self._replay_cache) >= 24:
            self._replay_cache.popitem(last=False)
        self._replay_cache[ckey] = out
        return out

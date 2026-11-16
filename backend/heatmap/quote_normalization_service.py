"""Quote Normalization & Indian Equity Session Awareness Service.

Normalizes live NSE index constituent payloads + historical Bhavcopy baselines +
intraday rolling ring-buffer anchors into a strictly validated, non-fabricated
quote structure. Includes Asia/Kolkata market session & holiday detection.
"""
from __future__ import annotations

import math
from datetime import datetime, timedelta, timezone
from typing import Any

IST = timezone(timedelta(hours=5, minutes=30))

# Official NSE Cash Market Trading Holidays (2025–2026)
NSE_EQUITY_HOLIDAYS: set[str] = {
    "2026-01-26",
    "2026-02-17",
    "2026-03-03",
    "2026-03-20",
    "2026-03-31",
    "2026-04-03",
    "2026-04-14",
    "2026-05-01",
    "2026-05-27",
    "2026-06-26",
    "2026-09-14",
    "2026-10-02",
    "2026-10-20",
    "2026-11-09",
    "2026-11-10",
    "2026-11-24",
    "2026-12-25",
}


def finite_float(val: Any) -> float | None:
    if val is None or isinstance(val, bool) or val == "-" or val == "":
        return None
    try:
        f = float(val)
        return f if math.isfinite(f) else None
    except (TypeError, ValueError):
        return None


def pct_diff(current: float | None, reference: float | None) -> float | None:
    if current is None or reference is None or reference <= 0:
        return None
    return round(((current - reference) / reference) * 100.0, 2)


def equity_market_status_ist(now: datetime | None = None) -> dict[str, Any]:
    cur = now.astimezone(IST) if now is not None else datetime.now(IST)
    date_iso = cur.strftime("%Y-%m-%d")
    hhmm = cur.strftime("%H:%M")
    hhmmss = cur.strftime("%H:%M:%S")

    if cur.weekday() >= 5:
        state, label, reason = "CLOSED", "MARKET CLOSED", "Weekend (NSE Closed)"
    elif date_iso in NSE_EQUITY_HOLIDAYS:
        state, label, reason = "CLOSED", "MARKET CLOSED", "NSE Exchange Holiday"
    elif "09:15" <= hhmm <= "15:30":
        state, label, reason = "LIVE", "LIVE", "Regular NSE Equity Session (09:15–15:30 IST)"
    elif "09:00" <= hhmm < "09:15":
        state, label, reason = "PRE_OPEN", "PRE-OPEN", "NSE Pre-Open Discovery Session (09:00–09:15 IST)"
    elif hhmm < "09:00":
        state, label, reason = "CLOSED", "MARKET CLOSED", "Pre-Market (Opens 09:15 IST)"
    else:
        state, label, reason = "CLOSED", "MARKET CLOSED", "Post-Close (Regular Session Ended 15:30 IST)"

    return {
        "state": state,
        "badge": label,
        "isOpen": state == "LIVE",
        "reason": reason,
        "timezone": "Asia/Kolkata",
        "dateIST": date_iso,
        "timeIST": hhmmss,
        "regularHours": "09:15–15:30 IST",
    }


class QuoteNormalizationService:
    """Converts raw provider quotes + verified historical baselines into canonical heatmap records."""

    def normalize_stock(
        self,
        raw: dict[str, Any],
        master: dict[str, Any] | None,
        baseline: dict[str, Any] | None,
        intraday_anchors: dict[str, float | None] | None = None,
    ) -> dict[str, Any] | None:
        sym = str(raw.get("symbol") or (master or {}).get("symbol") or "").strip().upper()
        if not sym or raw.get("priority") == 1:
            return None

        price = finite_float(raw.get("lastPrice"))
        prev_close = finite_float(raw.get("previousClose"))
        if price is None or price <= 0:
            return None

        open_p = finite_float(raw.get("open"))
        high_p = finite_float(raw.get("dayHigh"))
        low_p = finite_float(raw.get("dayLow"))
        change = finite_float(raw.get("change"))
        if change is None and prev_close is not None:
            change = round(price - prev_close, 2)

        change_1d = finite_float(raw.get("pChange"))
        if change_1d is None and prev_close:
            change_1d = pct_diff(price, prev_close)

        vol_1d = finite_float(raw.get("totalTradedVolume"))
        turnover_1d = finite_float(raw.get("totalTradedValue"))
        mcap_inr = finite_float(raw.get("ffmc")) or finite_float((master or {}).get("marketCap"))
        year_high = finite_float(raw.get("yearHigh"))
        year_low = finite_float(raw.get("yearLow"))

        b = baseline or {}
        anchors = intraday_anchors or {}

        # Multi-timeframe verified performance %
        perf_1w = pct_diff(price, finite_float(b.get("close1W")))
        perf_1m = finite_float(raw.get("perChange30d"))
        if perf_1m is None:
            perf_1m = pct_diff(price, finite_float(b.get("close1M")))
        perf_3m = pct_diff(price, finite_float(b.get("close3M")))
        perf_6m = pct_diff(price, finite_float(b.get("close6M")))
        perf_ytd = pct_diff(price, finite_float(b.get("closeYTD")))
        perf_1y = finite_float(raw.get("perChange365d"))
        if perf_1y is None:
            perf_1y = pct_diff(price, finite_float(b.get("close1Y")))

        # Intraday rolling changes (only populated when genuine timestamped anchor exists)
        change_5m = pct_diff(price, anchors.get("5m"))
        change_15m = pct_diff(price, anchors.get("15m"))
        change_1h = pct_diff(price, anchors.get("1h"))

        # Multi-day volume & turnover (sum of completed rolling days + today's live session)
        hist_vol_4d = finite_float(b.get("volPrev4D"))
        hist_vol_20d = finite_float(b.get("volPrev20D"))
        vol_1w = round((vol_1d or 0.0) + hist_vol_4d, 0) if hist_vol_4d is not None else None
        vol_1m = round((vol_1d or 0.0) + hist_vol_20d, 0) if hist_vol_20d is not None else None

        hist_turn_4d = finite_float(b.get("turnoverPrev4D"))
        hist_turn_20d = finite_float(b.get("turnoverPrev20D"))
        turnover_1w = round((turnover_1d or 0.0) + hist_turn_4d, 2) if hist_turn_4d is not None else None
        turnover_1m = round((turnover_1d or 0.0) + hist_turn_20d, 2) if hist_turn_20d is not None else None

        # Market Activity metrics
        avg_vol_20d = finite_float(b.get("avgVolume20D"))
        rel_vol = round(vol_1d / avg_vol_20d, 2) if (vol_1d is not None and avg_vol_20d and avg_vol_20d > 0) else None

        prev_day_vol = finite_float(b.get("prevDayVolume"))
        vol_change_pct = pct_diff(vol_1d, prev_day_vol)

        # Volatility %: prefer 20D annualized realized volatility if baseline exists, else intraday range %
        realized_vol_20d = finite_float(b.get("realizedVol20D"))
        intraday_range_pct = (
            round(((high_p - low_p) / prev_close) * 100.0, 2)
            if (high_p is not None and low_p is not None and prev_close and prev_close > 0)
            else None
        )
        volatility = realized_vol_20d if realized_vol_20d is not None else intraday_range_pct

        gap_pct = pct_diff(open_p, prev_close)

        m = master or {}
        sector = m.get("sector") or "Unclassified"
        industry = m.get("industry") or "Unclassified"
        company_name = m.get("companyName") or str(raw.get("companyName") or sym).strip()
        inst_id = b.get("instrumentId") or m.get("instrumentId") or str(raw.get("identifier") or f"NSE:{sym}")
        isin = b.get("isin") or m.get("isin") or ""
        last_upd = str(raw.get("lastUpdateTime") or "").strip() or None

        return {
            "symbol": sym,
            "companyName": company_name,
            "exchange": m.get("exchange") or "NSE",
            "instrumentId": str(inst_id),
            "identifier": str(raw.get("identifier") or f"{sym}EQN"),
            "isin": isin,
            "sector": sector,
            "industry": industry,
            "indexMemberships": m.get("indexMemberships") or [],
            "price": round(price, 2),
            "previousClose": round(prev_close, 2) if prev_close is not None else None,
            "open": round(open_p, 2) if open_p is not None else None,
            "high": round(high_p, 2) if high_p is not None else None,
            "low": round(low_p, 2) if low_p is not None else None,
            "change": round(change, 2) if change is not None else None,
            "changePct": round(change_1d, 2) if change_1d is not None else 0.0,
            "change5m": change_5m,
            "change15m": change_15m,
            "change1h": change_1h,
            "perf1w": perf_1w,
            "perf1m": round(perf_1m, 2) if perf_1m is not None else None,
            "perf3m": perf_3m,
            "perf6m": perf_6m,
            "perfYtd": perf_ytd,
            "perf1y": round(perf_1y, 2) if perf_1y is not None else None,
            "volume1d": int(vol_1d) if vol_1d is not None else None,
            "volume1w": int(vol_1w) if vol_1w is not None else None,
            "volume1m": int(vol_1m) if vol_1m is not None else None,
            "turnover1d": round(turnover_1d, 2) if turnover_1d is not None else None,
            "turnover1w": turnover_1w,
            "turnover1m": turnover_1m,
            "marketCap": round(mcap_inr, 2) if mcap_inr is not None else None,
            "marketCapCr": round(mcap_inr / 1e7, 2) if mcap_inr is not None else None,
            "relativeVolume": rel_vol,
            "volumeChangePct": vol_change_pct,
            "volatility": volatility,
            "intradayRangePct": intraday_range_pct,
            "gapPct": gap_pct,
            "yearHigh": round(year_high, 2) if year_high is not None else None,
            "yearLow": round(year_low, 2) if year_low is not None else None,
            "lastUpdateTime": last_upd,
        }

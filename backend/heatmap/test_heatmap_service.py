"""Unit & Integration Tests for IWSM Stock Market Heatmap Backend Services."""
from __future__ import annotations

import tempfile
import unittest
from datetime import datetime
from pathlib import Path

import httpx
from fastapi import FastAPI

from backend.heatmap.heatmap_cache_service import HeatmapCacheService
from backend.heatmap.heatmap_router import install_heatmap
from backend.heatmap.quote_normalization_service import (
    IST,
    QuoteNormalizationService,
    equity_market_status_ist,
)
from backend.heatmap.sector_classification_service import SectorClassificationService


class HeatmapBackendTests(unittest.IsolatedAsyncioTestCase):
    def setUp(self) -> None:
        self.tmp = tempfile.TemporaryDirectory()
        self.db_path = str(Path(self.tmp.name) / "test-heatmap.sqlite3")

    def tearDown(self) -> None:
        self.tmp.cleanup()

    def test_sector_classification_and_market_hours_ist(self) -> None:
        clf = SectorClassificationService()
        self.assertEqual(clf.classify("HDFCBANK", "Financial Services"), ("Finance", "Private Sector Bank"))
        self.assertEqual(clf.classify("SBIN", "Financial Services"), ("Finance", "Public Sector Bank"))
        self.assertEqual(clf.classify("RELIANCE", "Oil Gas & Consumable Fuels"), ("Energy Minerals", "Refineries & Integrated Energy"))
        self.assertEqual(clf.classify("NEWSTOCK", "Healthcare"), ("Health Technology", "Healthcare"))

        # Regular Monday 10:30 IST -> LIVE
        live_dt = datetime(2026, 11, 16, 10, 30, 0, tzinfo=IST)
        st_live = equity_market_status_ist(live_dt)
        self.assertTrue(st_live["isOpen"])
        self.assertEqual(st_live["state"], "LIVE")

        # Sunday -> CLOSED
        sun_dt = datetime(2026, 11, 15, 11, 0, 0, tzinfo=IST)
        st_sun = equity_market_status_ist(sun_dt)
        self.assertFalse(st_sun["isOpen"])
        self.assertEqual(st_sun["badge"], "MARKET CLOSED")

        # NSE Holiday (2026-11-10) -> CLOSED
        hol_dt = datetime(2026, 11, 10, 11, 0, 0, tzinfo=IST)
        st_hol = equity_market_status_ist(hol_dt)
        self.assertFalse(st_hol["isOpen"])
        self.assertEqual(st_hol["reason"], "NSE Exchange Holiday")

        # Post-close 16:15 IST -> CLOSED
        post_dt = datetime(2026, 11, 16, 16, 15, 0, tzinfo=IST)
        self.assertFalse(equity_market_status_ist(post_dt)["isOpen"])

    def test_quote_normalization_never_fabricates_missing_metrics(self) -> None:
        norm = QuoteNormalizationService()
        q = norm.normalize_stock(
            {
                "symbol": "TCS",
                "lastPrice": 2410.0,
                "previousClose": 2400.0,
                "open": 2405.0,
                "dayHigh": 2425.0,
                "dayLow": 2395.0,
                "totalTradedVolume": 1500000,
                "totalTradedValue": 3615000000.0,
                "ffmc": 4500000000000.0,
                "lastUpdateTime": "2026-11-16 11:00:00",
            },
            master={"symbol": "TCS", "companyName": "Tata Consultancy Services Ltd.", "sector": "Technology Services", "industry": "IT Consulting & Software"},
            baseline=None,
            intraday_anchors={},
        )
        self.assertIsNotNone(q)
        self.assertEqual(q["price"], 2410.0)
        self.assertEqual(q["change"], 10.0)
        self.assertEqual(q["changePct"], 0.42)
        # Without historical baselines or intraday anchors, these must remain None (never fabricated)
        self.assertIsNone(q["perf1w"])
        self.assertIsNone(q["change5m"])
        self.assertIsNone(q["volume1w"])

    async def test_rest_endpoints_and_combinable_screener_filters(self) -> None:
        csv_body = (
            "Company Name,Industry,Symbol,Series,ISIN Code\n"
            "HDFC Bank Ltd.,Financial Services,HDFCBANK,EQ,INE040A01034\n"
            "State Bank of India,Financial Services,SBIN,EQ,INE062A01020\n"
            "Reliance Industries Ltd.,Oil Gas & Consumable Fuels,RELIANCE,EQ,INE002A01018\n"
            "Tata Consultancy Services Ltd.,Information Technology,TCS,EQ,INE467B01029\n"
        )

        def mock_handler(req: httpx.Request) -> httpx.Response:
            if req.url.path.endswith(".csv"):
                return httpx.Response(200, text=csv_body)
            if "marketWatchApi" in req.url.path and req.url.params.get("functionName") == "getIndicesData":
                return httpx.Response(
                    200,
                    json={
                        "data": {
                            "timestamp": "16-Nov-2026 11:15:00",
                            "data": [
                                {"symbol": "HDFCBANK", "lastPrice": 820.0, "previousClose": 800.0, "pChange": 2.5, "open": 804.0, "dayHigh": 825.0, "dayLow": 801.0, "totalTradedVolume": 20000000, "totalTradedValue": 1.64e10, "ffmc": 1.2e13, "perChange30d": 5.2, "perChange365d": 12.1, "lastUpdateTime": "2026-11-16 11:15:00"},
                                {"symbol": "SBIN", "lastPrice": 845.0, "previousClose": 850.0, "pChange": -0.59, "open": 850.0, "dayHigh": 852.0, "dayLow": 840.0, "totalTradedVolume": 15000000, "totalTradedValue": 1.26e10, "ffmc": 7.5e12, "perChange30d": 3.1, "perChange365d": 18.4, "lastUpdateTime": "2026-11-16 11:15:00"},
                                {"symbol": "RELIANCE", "lastPrice": 1350.0, "previousClose": 1335.0, "pChange": 1.12, "open": 1338.0, "dayHigh": 1355.0, "dayLow": 1334.0, "totalTradedVolume": 9000000, "totalTradedValue": 1.21e10, "ffmc": 9.0e12, "perChange30d": 8.0, "perChange365d": -4.2, "lastUpdateTime": "2026-11-16 11:15:00"},
                                {"symbol": "TCS", "lastPrice": 2420.0, "previousClose": 2440.0, "pChange": -0.82, "open": 2438.0, "dayHigh": 2445.0, "dayLow": 2410.0, "totalTradedVolume": 3000000, "totalTradedValue": 7.26e9, "ffmc": 4.2e12, "perChange30d": -1.5, "perChange365d": -6.0, "lastUpdateTime": "2026-11-16 11:15:00"},
                            ],
                        }
                    },
                )
            return httpx.Response(200, json={})

        app = FastAPI()
        install_heatmap(app, db_path=self.db_path, transport=httpx.MockTransport(mock_handler))

        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://127.0.0.1:4180") as cl:
            u_res = await cl.get("/api/heatmap/universes")
            self.assertEqual(u_res.status_code, 200)
            self.assertEqual(len(u_res.json()["universes"]), 16)

            s_res = await cl.get("/api/heatmap/securities", params={"universe": "NIFTY 50"})
            self.assertEqual(s_res.status_code, 200)
            self.assertEqual(s_res.json()["matchedCount"], 4)

            # Combinable filter: Finance + minChangePct > 1.0 -> only HDFCBANK (+2.5%)
            f_res = await cl.post(
                "/api/heatmap/filters",
                json={"universe": "NIFTY 50", "filters": {"sector": "Finance", "minChangePct": 1.0}},
            )
            self.assertEqual(f_res.status_code, 200)
            matched = f_res.json()["securities"]
            self.assertEqual(len(matched), 1)
            self.assertEqual(matched[0]["symbol"], "HDFCBANK")

            # Stock detail + validation
            d_res = await cl.get("/api/heatmap/stock/RELIANCE")
            self.assertEqual(d_res.status_code, 200)
            self.assertEqual(d_res.json()["quote"]["symbol"], "RELIANCE")

            bad_res = await cl.get("/api/heatmap/stock/INVALID$$$")
            self.assertEqual(bad_res.status_code, 422)

            miss_res = await cl.get("/api/heatmap/stock/DOESNOTEXIST99")
            self.assertEqual(miss_res.status_code, 404)

        await app.state.heatmap_service.market_data.aclose()


if __name__ == "__main__":
    unittest.main()

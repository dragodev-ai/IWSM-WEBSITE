"""Unit, integration & failure-simulation tests for Parquet1MinStore, strike completeness & intelligent fallback."""
from __future__ import annotations

import hashlib
import json
import tempfile
import unittest
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

import httpx
import polars as pl
from cryptography.fernet import Fernet

from alice_service import PREFIX, create_app
from nse_live_chain import DEFAULT_LOT_SIZES, NseLiveOptionChain
from parquet_1min_store import DEFAULT_PARQUET_ROOT, Parquet1MinStore, _infer_lot_size

IST_ZONE = timezone(timedelta(hours=5, minutes=30))


def _write_fixture_parquet(root: Path) -> None:
    opt_dir = root / "options" / "underlying=NIFTY" / "year=2026" / "month=02"
    opt_dir.mkdir(parents=True, exist_ok=True)
    rows = []
    # Regular session bars (09:15, 09:16) + 1 post-close 15:35 tick that must be filtered out
    for minute, is_post in [(15, False), (16, False), (35, True)]:
        hr = 15 if is_post else 9
        ts = datetime(2026, 2, 2, hr, minute, tzinfo=IST_ZONE)
        for idx, strike in enumerate([24800, 24850, 24900]):
            for right in ("CE", "PE"):
                rows.append(
                    {
                        "date": date(2026, 2, 2),
                        "ts": ts,
                        "symbol": f"NIFTY26203{strike}{right}",
                        "expiry": date(2026, 2, 3),
                        "strike": strike,
                        "right": right,
                        "open": float(120.0 + idx * 5),
                        "high": float(125.0 + idx * 5),
                        "low": float(118.0 + idx * 5),
                        "close": float(121.3499984741211 + idx * 5),  # Float32 rounding test -> 121.35
                        "volume": 650 if minute == 15 else 0,
                        "oi": 65 * (10 + idx * 3 + (1 if right == "PE" else 0)),
                        "spot": 24852.400390625,
                        "forward": 24855.0,
                        "tte": 0.003,
                        "dte": 1,
                        "iv": None if (strike == 24900 and right == "PE") else 0.142,
                        "delta": None if (strike == 24900 and right == "PE") else (0.52 if right == "CE" else -0.48),
                        "gamma": 0.0012,
                        "vega": 4.25,
                        "theta": -38.50,
                        "fut_price": None,
                    }
                )
    df = pl.DataFrame(rows).with_columns(
        pl.col("ts").dt.convert_time_zone("Asia/Kolkata"),
        pl.col("strike").cast(pl.Int32),
        pl.col("volume").cast(pl.Int32),
        pl.col("oi").cast(pl.Int32),
    )
    df.write_parquet(opt_dir / "part.parquet")


class ParquetStoreAndFallbackTests(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.root = Path(self.tmp.name)
        _write_fixture_parquet(self.root)

    def tearDown(self):
        self.tmp.cleanup()

    def test_lot_size_inference_and_default_nfo_lots(self):
        self.assertEqual(DEFAULT_LOT_SIZES["NIFTY"], 65)
        self.assertEqual(DEFAULT_LOT_SIZES["BANKNIFTY"], 30)
        self.assertEqual(DEFAULT_LOT_SIZES["FINNIFTY"], 60)
        self.assertEqual(DEFAULT_LOT_SIZES["MIDCPNIFTY"], 120)
        self.assertEqual(_infer_lot_size("NIFTY", "2026-02-03", [65 * i for i in range(1, 25)]), 65)
        self.assertEqual(_infer_lot_size("NIFTY", "2025-06-05", [75 * i for i in range(1, 25)]), 75)
        self.assertEqual(_infer_lot_size("NIFTY", "2024-06-06", [25 * i for i in range(1, 25)]), 25)
        self.assertEqual(_infer_lot_size("BANKNIFTY", "2025-07-31", [35 * i for i in range(1, 25)]), 35)
        self.assertEqual(_infer_lot_size("SENSEX", "2026-10-01", [20 * i for i in range(1, 25)]), 20)

    def test_fixture_parquet_normalization_null_safety_and_session_bounds(self):
        store = Parquet1MinStore(self.root)
        self.assertTrue(store.supports("NIFTY", "nse_fo"))
        self.assertFalse(store.supports("NIFTY", "bse_fo"))
        self.assertFalse(store.supports("SENSEX", "nse_fo"))

        exps = store.expiries("NIFTY", "nse_fo", "2026-02-02", "2026-02-02")
        self.assertEqual(exps, ["03FEB26"])

        # Weekend alignment inside installed range (2026-02-01 was Sunday -> aligns to 2026-02-02)
        res = store.load_replay("NIFTY", "nse_fo", "03FEB26", "2026-02-01", "2026-02-02")
        ds = res["dataset"]
        self.assertEqual(ds["metadata"]["dataSourceStatus"], "HISTORICAL")
        self.assertEqual(ds["metadata"]["lotSize"], 65)
        self.assertEqual(ds["metadata"]["frameCount"], 2)  # 09:15 and 09:16 only; 15:35 filtered out!
        stamps = {c["timestamp"] for c in ds["contracts"]}
        self.assertEqual(stamps, {"2026-02-02T09:15", "2026-02-02T09:16"})

        # Float32 rounding & decimal-to-percentage IV conversion
        ce_24800 = next(c for c in ds["contracts"] if c["timestamp"] == "2026-02-02T09:15" and c["strike"] == 24800 and c["type"] == "CE")
        self.assertEqual(ce_24800["close"], 121.35)
        self.assertEqual(ce_24800["iv"], 14.2)
        self.assertEqual(ce_24800["delta"], 0.52)

        # Unsolved IV stays absent/None, never fabricated 0
        pe_24900 = next(c for c in ds["contracts"] if c["timestamp"] == "2026-02-02T09:15" and c["strike"] == 24900 and c["type"] == "PE")
        self.assertNotIn("iv", pe_24900)

        # Out-of-range dates fail cleanly without fabricating bars
        with self.assertRaises(LookupError):
            store.load_replay("NIFTY", "nse_fo", "03FEB26", "2018-01-01", "2018-01-02")

    async def test_nse_intraday_strike_window_covers_25850_to_26050(self):
        strikes = [24500 + 50 * i for i in range(40)]  # 24,500 .. 26,450 (includes 25,850..26,050)

        def nse_mock(req: httpx.Request):
            u = str(req.url)
            if "option-chain-v3" in u:
                data = []
                for k in strikes:
                    data.append(
                        {
                            "strikePrice": k,
                            "CE": {
                                "identifier": f"OPTIDXNIFTY17-11-2026CE{k:.2f}",
                                "lastPrice": max(0.5, round(25400 - k + 45.0, 2)),
                                "openInterest": 1000,
                                "changeinOpenInterest": 50,
                                "totalTradedVolume": 300,
                                "buyPrice1": 1.0,
                                "sellPrice1": 1.1,
                            },
                            "PE": {
                                "identifier": f"OPTIDXNIFTY17-11-2026PE{k:.2f}",
                                "lastPrice": max(0.5, round(k - 25400 + 45.0, 2)),
                                "openInterest": 900,
                                "changeinOpenInterest": -20,
                                "totalTradedVolume": 250,
                                "buyPrice1": 1.0,
                                "sellPrice1": 1.1,
                            },
                        }
                    )
                return httpx.Response(200, json={"records": {"underlyingValue": 25350.0, "data": data}})
            if "chart-databyindex" in u or "indexTrackerApi" in u:
                # 2026-11-17 09:15 and 09:16 IST encoded as UTC epoch ms (NSE convention)
                pts = [[1794906900000, 12.5], [1794906960000, 13.0]]
                if "indexTrackerApi" in u:
                    return httpx.Response(200, json={"data": {"grapthData": [[1794906900000, 25350.0], [1794906960000, 25355.0]]}})
                return httpx.Response(200, json={"grapthData": pts})
            return httpx.Response(200, text="ok")

        client = NseLiveOptionChain(transport=httpx.MockTransport(nse_mock))
        ds = await client.intraday_minute_dataset("NIFTY", "2026-11-17", start="2026-11-17", end="2026-11-17")
        await client.aclose()
        present_strikes = {int(c["strike"]) for c in ds["contracts"] if c["type"] != "FUT"}
        for target_k in (25350, 25800, 25850, 25900, 25950, 26000, 26050):
            self.assertIn(target_k, present_strikes, f"Strike {target_k} must be populated in intraday chain")
        sample = next(c for c in ds["contracts"] if c["strike"] == 25850 and c["type"] == "CE")
        self.assertEqual(sample["lotSize"], 65)
        self.assertEqual(sample["oi"], 65000)

    async def test_api_fallback_to_parquet_and_expired_token_auto_renewal(self):
        def broker_handler(req: httpx.Request):
            p = req.url.path
            auth = req.headers.get("Authorization", "")
            if auth == "Bearer EXPIRED-DAILY-JWT":
                return httpx.Response(401, json={"stat": "Not_Ok", "emsg": "Session Expired"})
            if p.endswith("getEncKey"):
                return httpx.Response(200, json={"stat": "Ok", "encKey": "ENC999"})
            if p.endswith("getUserSID"):
                body = json.loads(req.content)
                expected = hashlib.sha256(b"USER1" + b"K" * 32 + b"ENC999").hexdigest()
                if body.get("userData") == expected:
                    return httpx.Response(200, json={"stat": "Ok", "sessionID": "RENEWED-TOKEN"})
                return httpx.Response(401, json={"stat": "Not_Ok"})
            if auth == "Bearer RENEWED-TOKEN":
                if p.endswith("getUnderlying"):
                    return httpx.Response(200, json={"stat": "Ok", "result": [{"list_underlying": ["NIFTY"]}]})
                if p.endswith("getUnderlyingExp"):
                    return httpx.Response(200, json={"stat": "Ok", "result": [{"underlying": "NIFTY", "underlying_expiry": ["24NOV26"]}]})
            return httpx.Response(503, json={"stat": "Not_Ok"})

        app = create_app(
            {
                "ALICEBLUE_APP_CODE": "APP",
                "ALICEBLUE_API_SECRET": "SEC",
                "ALICEBLUE_CLIENT_ID": "USER1",
                "ALICEBLUE_API_KEY": "K" * 32,
                "ALICEBLUE_SESSION_TOKEN": "EXPIRED-DAILY-JWT",
                "ALICEBLUE_REDIRECT_URL": "http://127.0.0.1:4174" + PREFIX + "/auth/callback",
                "ALICEBLUE_SESSION_ENCRYPTION_KEY": Fernet.generate_key().decode(),
            },
            str(self.root / "sessions.db"),
            httpx.MockTransport(broker_handler),
            local_owner_mode=True,
            parquet_root=self.root,
        )
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://127.0.0.1:4174") as cl:
            # 1. Expired daily JWT is cleared on 401 and renewed automatically via ALICEBLUE_API_KEY
            st = await cl.get(PREFIX + "/auth/status")
            self.assertEqual(st.status_code, 200)
            self.assertTrue(st.json()["connected"])
            self.assertTrue(st.json()["verified"])
            self.assertEqual(app.state.config["ALICEBLUE_SESSION_TOKEN"], "")

            # 2. Historical /expiries for 2026-02-02 returns Parquet 1-minute expiries with parquetMinuteAvailable=True
            exp_r = await cl.get(PREFIX + "/expiries", params={"underlying": "NIFTY", "exch": "nse_fo", "start": "2026-02-02", "end": "2026-02-02"})
            self.assertEqual(exp_r.status_code, 200)
            exp_j = exp_r.json()
            self.assertEqual(exp_j["expiries"], ["03FEB26"])
            self.assertTrue(exp_j["parquetMinuteAvailable"])
            self.assertFalse(exp_j["historicalOnly"])

            # 3. Historical /replay for 03FEB26 falls back cleanly to Parquet1MinStore with HISTORICAL badge
            rep_r = await cl.get(
                PREFIX + "/replay",
                params={"underlying": "NIFTY", "exch": "nse_fo", "expiry": "03FEB26", "start": "2026-02-02", "end": "2026-02-02"},
            )
            self.assertEqual(rep_r.status_code, 200, rep_r.text)
            rep_j = rep_r.json()
            self.assertEqual(rep_j["dataset"]["metadata"]["dataSourceStatus"], "HISTORICAL")
            self.assertEqual(rep_j["resolution"], "minute")
        await app.state.broker.http.aclose()

    def test_real_google_drive_parquet_partitions_if_present(self):
        if not (DEFAULT_PARQUET_ROOT / "options").is_dir():
            self.skipTest("Real Google Drive Parquet directory not present")
        real_store = Parquet1MinStore(DEFAULT_PARQUET_ROOT)
        cov = real_store.coverage()
        self.assertTrue(cov["hasParquet"])
        self.assertGreater(cov["totalRowsInstalled"], 100_000_000)
        for sym, exch, st, en, expected_lot in [
            ("NIFTY", "nse_fo", "2026-02-02", "2026-02-02", 65),
            ("BANKNIFTY", "nse_fo", "2025-06-25", "2025-06-26", 30),
            ("SENSEX", "bse_fo", "2026-10-01", "2026-10-01", 20),
        ]:
            exps = real_store.expiries(sym, exch, st, en)
            self.assertTrue(len(exps) >= 1)
            out = real_store.load_replay(sym, exch, exps[0], st, en)
            self.assertEqual(out["dataset"]["metadata"]["lotSize"], expected_lot)
            self.assertLess(len(out["dataset"]["contracts"]), 200_000)


if __name__ == "__main__":
    unittest.main()

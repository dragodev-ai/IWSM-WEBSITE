"""Unit and integration tests for SnapshotStore, expiry classification, VIX, and snapshot replay routes."""
import json, tempfile, unittest
from datetime import datetime
from pathlib import Path
from unittest.mock import patch
import httpx
from cryptography.fernet import Fernet

from alice_history import classify_expiries, instrument_catalog, market_status_ist, IST
from alice_service import create_app, log_event, logger, PREFIX, validate_config
from snapshot_store import SnapshotStore, solve_iv_and_greeks


class SnapshotStoreUnitTests(unittest.TestCase):
    def test_bsm_iv_and_greeks_roundtrip(self):
        # ATM call with F=24000, K=24000, T=30/365, market price ~445 => IV ~16%
        solved = solve_iv_and_greeks(445.0, 24000.0, 24000.0, 30.0 / 365.0, 'CE', is_futures_basis=True)
        self.assertIsNotNone(solved)
        iv, delta, gamma, theta, vega, rho = solved
        self.assertGreater(iv, 10.0)
        self.assertLess(iv, 25.0)
        self.assertAlmostEqual(delta, 0.50, delta=0.05)
        self.assertGreater(gamma, 0.0)
        self.assertLess(theta, 0.0)
        self.assertGreater(vega, 0.0)

    def test_record_deduplicate_coverage_and_replay(self):
        with tempfile.TemporaryDirectory() as tmp:
            store = SnapshotStore(Path(tmp) / 'snapshots.sqlite3')
            self.assertFalse(store.coverage()['hasSnapshots'])

            rows_t1 = [
                {
                    'strike': 24000,
                    'CE': {'symbol': 'NIFTY26NOV26C24000', 'token': '40001', 'ltp': 310.5, 'bid': 310.0, 'ask': 311.0, 'oi': 1250000, 'previousOi': 1100000, 'volume': 450000},
                    'PE': {'symbol': 'NIFTY26NOV26P24000', 'token': '40002', 'ltp': 245.0, 'bid': 244.5, 'ask': 245.5, 'oi': 1420000, 'previousOi': 1300000, 'volume': 510000},
                },
                {
                    'strike': 24100,
                    'CE': {'symbol': 'NIFTY26NOV26C24100', 'token': '40003', 'ltp': 252.0, 'oi': 980000, 'previousOi': 900000},
                    'PE': {'symbol': 'NIFTY26NOV26P24100', 'token': '40004', 'ltp': 290.0, 'oi': 820000, 'previousOi': 800000},
                },
            ]
            r1 = store.record_chain_snapshot(
                'NIFTY', 'nse_fo', '26NOV26', '2026-11-12T09:20', rows_t1,
                spot=24015.25, futures_price=24068.50, futures_expiry='2026-11-26', india_vix=14.35, lot_size=65
            )
            self.assertTrue(r1['recorded'])
            self.assertEqual(r1['contractCount'], 4)

            # Upsert on same timestamp updates cleanly without creating duplicate frames
            rows_t1[0]['CE']['ltp'] = 315.0
            store.record_chain_snapshot(
                'NIFTY', 'nse_fo', '26NOV26', '2026-11-12T09:20', rows_t1,
                spot=24022.00, futures_price=24075.00, futures_expiry='2026-11-26', india_vix=14.40, lot_size=65
            )
            store.record_chain_snapshot(
                'NIFTY', 'nse_fo', '26NOV26', '2026-11-12T09:25', rows_t1,
                spot=24040.00, futures_price=24090.00, futures_expiry='2026-11-26', india_vix=14.20, lot_size=65
            )

            cov = store.coverage(symbol='NIFTY', exchange='nse_fo')
            self.assertTrue(cov['hasSnapshots'])
            self.assertEqual(cov['frameCount'], 2)
            self.assertEqual(cov['earliestTimestamp'], '2026-11-12T09:20')
            self.assertEqual(cov['latestTimestamp'], '2026-11-12T09:25')
            self.assertEqual(store.expiries('NIFTY', 'nse_fo', '2026-11-10', '2026-11-13'), ['26NOV26'])

            # Replay with start date prior to earliest snapshot flags partial coverage honestly
            replay = store.load_replay('NIFTY', 'nse_fo', '26NOV26', '2026-11-10', '2026-11-12')
            ds = replay['dataset']
            self.assertEqual(ds['metadata']['coverageStatus'], 'partial')
            self.assertEqual(ds['metadata']['earliestRecordedDate'], '2026-11-12')
            self.assertTrue(any('precedes earliest recorded snapshot' in w for w in ds['metadata']['warnings']))
            ce_24000_first = next(
                c for c in ds['contracts']
                if c['timestamp'] == '2026-11-12T09:20' and c['type'] == 'CE' and c['strike'] == 24000
            )
            self.assertEqual(ce_24000_first['close'], 315.0)
            self.assertEqual(ce_24000_first['oiChange'], 150000.0)
            self.assertIsNotNone(ce_24000_first['iv'])
            self.assertIsNotNone(ce_24000_first['delta'])

            # Missing date range raises LookupError naming earliest available snapshot
            with self.assertRaises(LookupError) as ctx:
                store.load_replay('NIFTY', 'nse_fo', '26NOV26', '2026-10-01', '2026-10-05')
            self.assertIn('2026-11-12T09:20', str(ctx.exception))

    def test_classify_expiries_and_enriched_catalog(self):
        details = classify_expiries(['05NOV26', '12NOV26', '19NOV26', '26NOV26', '31DEC26'], '2026-11-10')
        by_code = {d['code']: d for d in details}
        self.assertEqual(by_code['05NOV26']['cycle'], 'weekly')
        self.assertTrue(by_code['05NOV26']['expired'])
        self.assertEqual(by_code['19NOV26']['cycle'], 'weekly')
        self.assertEqual(by_code['26NOV26']['cycle'], 'monthly')
        self.assertEqual(by_code['26NOV26']['dte'], 16)
        self.assertEqual(by_code['31DEC26']['cycle'], 'monthly')

        rows = instrument_catalog({
            'nse_fo': [
                {'symbol': 'RELIANCE', 'instrument_type': 'OPTSTK', 'lot_size': 500, 'strike_price': 1280, 'expiry_date': 1795651200000},
                {'symbol': 'RELIANCE', 'instrument_type': 'OPTSTK', 'lot_size': 500, 'strike_price': 1300, 'expiry_date': 1795651200000},
                {'symbol': 'RELIANCE', 'instrument_type': 'OPTSTK', 'lot_size': 500, 'strike_price': 1320, 'expiry_date': 1798329600000},
            ]
        })
        self.assertEqual(len(rows), 1)
        self.assertEqual(rows[0]['lotSize'], 500)
        self.assertEqual(rows[0]['strikeInterval'], 20.0)
        self.assertEqual(rows[0]['expiryCount'], 2)

    def test_market_status_and_redacted_logging(self):
        sat = datetime(2026, 11, 14, 12, 0, tzinfo=IST)
        self.assertEqual(market_status_ist(sat)['status'], 'closed')
        mon_open = datetime(2026, 11, 16, 10, 15, tzinfo=IST)
        self.assertTrue(market_status_ist(mon_open)['isOpen'])

        captured = []
        with patch.object(logger, 'info', side_effect=captured.append):
            log_event('info', 'test_redaction', userSession='SECRET-JWT', apiSecret='SECRET-KEY', symbol='NIFTY')
        logged = json.loads(captured[0])
        self.assertEqual(logged['userSession'], '[REDACTED]')
        self.assertEqual(logged['apiSecret'], '[REDACTED]')
        self.assertEqual(logged['symbol'], 'NIFTY')

        with self.assertRaises(ValueError):
            validate_config({'ALICEBLUE_SESSION_ENCRYPTION_KEY': 'bad', 'ALICEBLUE_REDIRECT_URL': 'http://127.0.0.1:4174/api/aliceblue/auth/callback'})


class SnapshotEndpointsIntegrationTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        def broker_mock(req):
            return httpx.Response(401, json={'stat': 'Not_Ok'})

        self.app = create_app(
            {
                'ALICEBLUE_APP_CODE': 'TESTAPP',
                'ALICEBLUE_API_SECRET': 'TESTSECRET',
                'ALICEBLUE_REDIRECT_URL': 'http://127.0.0.1:4174' + PREFIX + '/auth/callback',
                'ALICEBLUE_SESSION_ENCRYPTION_KEY': Fernet.generate_key().decode(),
            },
            str(Path(self.tmp.name) / 'sessions.db'),
            httpx.MockTransport(broker_mock),
        )
        self.client = httpx.AsyncClient(transport=httpx.ASGITransport(app=self.app), base_url='http://127.0.0.1:4174')

    async def asyncTearDown(self):
        await self.client.aclose()
        await self.app.state.broker.http.aclose()
        self.tmp.cleanup()

    async def test_snapshot_routes_and_stock_fallback_replay(self):
        r_status = await self.client.get(PREFIX + '/market-status')
        self.assertEqual(r_status.status_code, 200)
        self.assertEqual(r_status.json()['marketStatus']['timezone'], 'Asia/Kolkata')

        # Seed genuine recorded stock F&O snapshots (RELIANCE) into app.state.snapshots
        self.app.state.snapshots.record_chain_snapshot(
            'RELIANCE', 'nse_fo', '26NOV26', '2026-11-13T09:20',
            [{
                'strike': 1300,
                'CE': {'symbol': 'RELIANCE26NOV26C1300', 'ltp': 28.5, 'oi': 2100000, 'previousOi': 2000000},
                'PE': {'symbol': 'RELIANCE26NOV26P1300', 'ltp': 22.0, 'oi': 1850000, 'previousOi': 1800000},
            }],
            spot=1304.50, futures_price=1308.25, futures_expiry='2026-11-26', india_vix=13.9, lot_size=500,
        )

        r_cov = await self.client.get(PREFIX + '/snapshots/coverage', params={'underlying': 'RELIANCE', 'exch': 'nse_fo'})
        self.assertEqual(r_cov.status_code, 200)
        self.assertTrue(r_cov.json()['hasSnapshots'])
        self.assertEqual(r_cov.json()['earliestDate'], '2026-11-13')

        # Even when broker is disconnected (401), /replay automatically serves genuinely recorded RELIANCE snapshots!
        r_rep = await self.client.get(
            PREFIX + '/replay',
            params={'underlying': 'RELIANCE', 'expiry': '26NOV26', 'start': '2026-11-13', 'end': '2026-11-13', 'exch': 'nse_fo'},
        )
        self.assertEqual(r_rep.status_code, 200)
        body = r_rep.json()
        self.assertEqual(body['dataset']['source'], 'IWSM recorded option-chain snapshots')
        self.assertTrue(any(c['symbol'] == 'RELIANCE' and c['lotSize'] == 500 for c in body['dataset']['contracts']))


if __name__ == '__main__':
    unittest.main()

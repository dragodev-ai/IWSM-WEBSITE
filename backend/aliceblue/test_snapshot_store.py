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

    async def test_minute_replay_ignores_untraded_strikes_without_502(self):
        import json as _json
        from unittest.mock import patch
        from alice_service import COOKIE

        def broker_mixed(req):
            body = _json.loads(req.content) if req.content else {}
            p = req.url.path
            if p.endswith('getUnderlying'):
                return httpx.Response(200, json={'stat': 'Ok', 'result': [{'list_underlying': ['RELIANCE']}]})
            if p.endswith('getUnderlyingExp'):
                return httpx.Response(200, json={'stat': 'Ok', 'result': [{'underlying': 'RELIANCE', 'underlying_expiry': ['26NOV26']}]})
            if p.endswith('getOptionChain'):
                return httpx.Response(200, json={
                    'stat': 'Ok',
                    'result': [{
                        'data': [
                            {
                                'CE': {'tradingsymbol': 'RELIANCE26NOV26C1300', 'ltp': 28.5},
                                'PE': {'tradingsymbol': 'RELIANCE26NOV26P1300', 'ltp': 21.0},
                            },
                            {
                                'CE': {'tradingsymbol': 'RELIANCE26NOV26C1450', 'ltp': 1.2},
                                'PE': {'tradingsymbol': 'RELIANCE26NOV26P1450', 'ltp': 152.0},
                            },
                        ]
                    }],
                })
            if p.endswith('/history'):
                tk = str(body.get('token'))
                # Token 201/202 simulate illiquid strikes returning Not_Ok ("No Data Available")
                if tk in ('201', '202'):
                    return httpx.Response(200, json={'stat': 'Not_Ok', 'emsg': 'No Data Available', 'result': None})
                price = 1304.0 if tk == '9999' else 25.0
                return httpx.Response(200, json={
                    'stat': 'Ok',
                    'result': [
                        {'time': '2026-11-13 09:15:59', 'close': price, 'volume': 500},
                        {'time': '2026-11-13 09:16:59', 'close': price + 1.5, 'volume': 500},
                    ],
                })
            return httpx.Response(404, json={'stat': 'Not_Ok'})

        class DirectoryMock:
            def __init__(self, *a, **kw): pass
            async def __aenter__(self): return self
            async def __aexit__(self, *a): pass
            async def get(self, url):
                name = url.rsplit('/', 1)[-1]
                if name == 'NFO':
                    data = [
                        {'symbol': 'RELIANCE', 'trading_symbol': 'RELIANCE26NOV26C1300', 'token': '101', 'lot_size': 500, 'instrument_type': 'OPTSTK'},
                        {'symbol': 'RELIANCE', 'trading_symbol': 'RELIANCE26NOV26P1300', 'token': '102', 'lot_size': 500, 'instrument_type': 'OPTSTK'},
                        {'symbol': 'RELIANCE', 'trading_symbol': 'RELIANCE26NOV26C1450', 'token': '201', 'lot_size': 500, 'instrument_type': 'OPTSTK'},
                        {'symbol': 'RELIANCE', 'trading_symbol': 'RELIANCE26NOV26P1450', 'token': '202', 'lot_size': 500, 'instrument_type': 'OPTSTK'},
                    ]
                elif name == 'INDICES':
                    data = {'NSE': []}
                else:
                    data = [{'symbol': 'RELIANCE', 'token': '9999', 'group_name': 'EQ', 'instrument_type': 'EQ'}]
                return httpx.Response(200, json=data, request=httpx.Request('GET', url))

        app = create_app(
            {
                'ALICEBLUE_APP_CODE': 'TESTAPP',
                'ALICEBLUE_API_SECRET': 'TESTSECRET',
                'ALICEBLUE_REDIRECT_URL': 'http://127.0.0.1:4174' + PREFIX + '/auth/callback',
                'ALICEBLUE_SESSION_ENCRYPTION_KEY': Fernet.generate_key().decode(),
            },
            str(Path(self.tmp.name) / 'mixed.db'),
            httpx.MockTransport(broker_mixed),
        )
        app.state.store.put('sid-mixed', {'token': 'VALID-TOKEN'}, 3600)
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url='http://127.0.0.1:4174', cookies={COOKIE: 'sid-mixed'}) as cl:
            with patch('alice_history.httpx.AsyncClient', DirectoryMock):
                r = await cl.get(PREFIX + '/replay', params={'underlying': 'RELIANCE', 'expiry': '26NOV26', 'start': '2026-11-13', 'end': '2026-11-13'})
        await app.state.broker.http.aclose()
        self.assertEqual(r.status_code, 200, r.text)
        contracts = r.json()['dataset']['contracts']
        self.assertEqual(len(contracts), 4)
        self.assertEqual({c['strike'] for c in contracts}, {1300.0})

    async def test_direct_apikey_and_clientid_sso_auth(self):
        import hashlib as _hashlib, json as _json

        def broker_auth(req):
            body = _json.loads(req.content) if req.content else {}
            p = req.url.path
            if p.endswith('getEncKey'):
                return httpx.Response(200, json={'stat': 'Ok', 'encKey': 'ENC12345'})
            if p.endswith('getUserSID'):
                expected = _hashlib.sha256(b'AB999' + b'A' * 32 + b'ENC12345').hexdigest()
                if body.get('userData') == expected:
                    return httpx.Response(200, json={'stat': 'Ok', 'sessionID': 'APIKEY-SESSION-TOKEN'})
                return httpx.Response(200, json={'stat': 'Not_Ok', 'emsg': 'Invalid checksum'})
            if p.endswith('getUserDetails'):
                return httpx.Response(200, json={'stat': 'Ok', 'clientId': 'AB999', 'userSession': 'SSO-SESSION-TOKEN'})
            if p.endswith('getUnderlying'):
                return httpx.Response(200, json={'stat': 'Ok', 'result': [{'list_underlying': ['NIFTY', 'RELIANCE']}]})
            return httpx.Response(404, json={'stat': 'Not_Ok'})

        env_file = Path(self.tmp.name) / 'test.env'
        app = create_app(
            {
                'ALICEBLUE_APP_CODE': 'TESTAPP',
                'ALICEBLUE_API_SECRET': 'TESTSECRET',
                'ALICEBLUE_REDIRECT_URL': 'http://127.0.0.1:4174' + PREFIX + '/auth/callback',
                'ALICEBLUE_SESSION_ENCRYPTION_KEY': Fernet.generate_key().decode(),
            },
            str(Path(self.tmp.name) / 'apikey.db'),
            httpx.MockTransport(broker_auth),
            local_owner_mode=True,
            env_path=str(env_file),
        )
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url='http://127.0.0.1:4174') as cl:
            # 1. Direct API key login
            r_key = await cl.post(
                PREFIX + '/auth/apikey',
                json={'clientId': 'ab999', 'apiKey': 'A' * 32},
                headers={'origin': 'http://127.0.0.1:4174'},
            )
            self.assertEqual(r_key.status_code, 200, r_key.text)
            self.assertTrue(r_key.json()['connected'])

            # 2. SSO login where callback omits state, using submitted clientId
            r_login = await cl.post(
                PREFIX + '/auth/login',
                json={'clientId': 'AB999'},
                headers={'origin': 'http://localhost:4174'},
            )
            self.assertEqual(r_login.status_code, 200)
            r_cb = await cl.get(PREFIX + '/auth/callback', params={'userId': 'AB999', 'authCode': 'CODE123'})
            self.assertEqual(r_cb.status_code, 303)
            self.assertIn('http://localhost:4174/strategy-builder.html', r_cb.headers['location'])
        await app.state.broker.http.aclose()

    async def test_env_session_token_autoseed_and_nse_live_chain(self):
        from cryptography.fernet import Fernet
        from nse_live_chain import NseLiveOptionChain

        def nse_mock(req: httpx.Request):
            u = str(req.url)
            if 'option-chain-contract-info' in u:
                return httpx.Response(200, json={'expiryDates': ['24-Nov-2099', '30-Dec-2099']})
            if 'option-chain-v3' in u:
                return httpx.Response(
                    200,
                    json={
                        'records': {
                            'underlyingValue': 1425.5,
                            'data': [
                                {
                                    'strikePrice': 1420,
                                    'CE': {'lastPrice': 28.5, 'buyPrice1': 28.4, 'sellPrice1': 28.6, 'openInterest': 1200, 'changeinOpenInterest': 80, 'totalTradedVolume': 450, 'impliedVolatility': 18.4},
                                    'PE': {'lastPrice': 22.1, 'buyPrice1': 22.0, 'sellPrice1': 22.2, 'openInterest': 980, 'changeinOpenInterest': -30, 'totalTradedVolume': 390, 'impliedVolatility': 19.1},
                                }
                            ],
                        }
                    },
                )
            return httpx.Response(200, text='<html>ok</html>')

        nse_client = NseLiveOptionChain(transport=httpx.MockTransport(nse_mock))
        exps = await nse_client.fetch_expiries('RELIANCE')
        self.assertEqual(exps, ['24NOV99', '30DEC99'])
        ds = await nse_client.snapshot_dataset('RELIANCE', '24NOV99')
        self.assertEqual(ds['source'], 'IWSM Live Exchange Snapshot')
        self.assertEqual(len(ds['contracts']), 2)
        self.assertEqual(ds['contracts'][0]['lotSize'], 500)
        self.assertNotIn('Alice Blue', ds['source'])
        await nse_client.aclose()

        def broker_ok(req: httpx.Request):
            if req.url.path.endswith('/getUnderlying'):
                return httpx.Response(200, json={'stat': 'Ok', 'result': [{'list_underlying': ['NIFTY', 'RELIANCE']}]})
            return httpx.Response(200, json={'stat': 'Ok'})

        app = create_app(
            {
                'ALICEBLUE_SESSION_TOKEN': 'A' * 36,
                'ALICEBLUE_REDIRECT_URL': 'http://127.0.0.1:4174' + PREFIX + '/auth/callback',
                'ALICEBLUE_SESSION_ENCRYPTION_KEY': Fernet.generate_key().decode(),
            },
            str(Path(self.tmp.name) / 'autoseed.db'),
            httpx.MockTransport(broker_ok),
            local_owner_mode=True,
        )
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url='http://127.0.0.1:4174') as cl:
            st = await cl.get(PREFIX + '/auth/status')
            self.assertEqual(st.status_code, 200)
            self.assertTrue(st.json()['connected'])
            self.assertTrue(st.json()['verified'])
        await app.state.broker.http.aclose()


if __name__ == '__main__':
    unittest.main()

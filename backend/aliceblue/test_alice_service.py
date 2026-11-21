"""Test-only fixtures; never imported by the live service."""
import asyncio, base64, hashlib, json, tempfile, time, unittest
from pathlib import Path
import httpx
from cryptography.fernet import Fernet
from alice_service import create_app,checksum,normalize,Store,PREFIX,COOKIE,session_seconds

def fixture():
    return {'status':'Ok','result':[{'data':[{'CE':{'tradingsymbol':'NIFTY25AUG26C23600','ltp':'517.8','oi':'256295.0','pdoi':'239980'},'PE':{'tradingsymbol':'NIFTY25AUG26P23600','ltp':'11.25','oi':'4420520','pdoi':'3432130'}}]}]}

class Parsing(unittest.TestCase):
    def test_provider_expiry_bounds_local_cache(self):
        def token(payload):return 'header.'+base64.urlsafe_b64encode(json.dumps(payload).encode()).decode().rstrip('=')+'.signature'
        self.assertEqual(session_seconds(token({'exp':10000}),1000),8970)
        self.assertEqual(session_seconds(token({'exp':900}),1000),0)
        self.assertEqual(session_seconds(token({'exp':True}),1000),3600)
        self.assertEqual(session_seconds('opaque-token',1000),3600)
        self.assertEqual(session_seconds(token({'exp':10**12}),1000),24*3600)
    def test_bse_verified_formats(self):
        for expiry,symbol in [('05NOV26','SENSEX26N0576900CE'),('26NOV26','SENSEX26NOV76900CE')]:
            p={'result':[{'data':[{'CE':{'tradingsymbol':symbol,'ltp':10}}]}]}
            self.assertEqual(normalize(p,'SENSEX',expiry,'bse_fo')['rows'][0]['strike'],76900)
            self.assertFalse(normalize(p,'BANKEX',expiry,'bse_fo')['rows'])
            self.assertFalse(normalize(p,'SENSEX',expiry,'nse_fo')['rows'])
    def test_checksum(self):self.assertEqual(checksum('USER','CODE','SECRET'),hashlib.sha256(b'USERCODESECRET').hexdigest())
    def test_normalize(self):
        x=normalize(fixture(),'NIFTY','25AUG26');self.assertEqual(x['rows'][0]['strike'],23600);self.assertEqual(x['rows'][0]['CE']['oiChange'],16315);self.assertIsNone(x['rows'][0]['CE']['previousClose']);self.assertIsNone(x['atmStrike'])
    def test_reject_mismatch_and_unknown(self):
        x=fixture();x['result'][0]['data'][0]['PE']['tradingsymbol']='NIFTY25AUG26P23700';self.assertFalse(normalize(x,'NIFTY','25AUG26')['rows']);x['result'][0]['data'][0]['CE']['tradingsymbol']='UNKNOWN';self.assertTrue(normalize(x,'NIFTY','25AUG26')['issues'])
    def test_storage(self):
        with tempfile.TemporaryDirectory() as tmp:
            p=str(Path(tmp)/'s.db');s=Store(p,Fernet.generate_key().decode());s.put('browser',{'token':'TEST-ONLY-TOKEN'},60);self.assertEqual(s.get('browser')['token'],'TEST-ONLY-TOKEN');self.assertNotIn(b'TEST-ONLY-TOKEN',Path(p).read_bytes());s.put('old',{'token':'old'},-1);self.assertIsNone(s.get('old'));s.delete('browser');self.assertIsNone(s.get('browser'))

class Routes(unittest.IsolatedAsyncioTestCase):
    async def test_status_detects_broker_revocation(self):
        await self.login();self.fail=401
        r=await self.client.get(PREFIX+'/auth/status')
        self.assertEqual(r.status_code,200);self.assertFalse(r.json()['connected'])
        self.assertIn('Max-Age=0',r.headers.get('set-cookie',''))

    async def test_local_recovery_is_single_use_and_validated(self):
        grant='G'*43
        self.assertEqual((await self.client.get(PREFIX+'/auth/restore',params={'grant':grant})).status_code,400)
        self.app.state.store.put(grant,{'restoreToken':'TEST-ONLY-TOKEN'},120)
        r=await self.client.get(PREFIX+'/auth/restore',params={'grant':grant});self.assertEqual(r.status_code,303);self.assertNotIn('TEST-ONLY-TOKEN',r.text);self.assertIn('HttpOnly',r.headers['set-cookie'])
        self.assertEqual((await self.client.get(PREFIX+'/auth/restore',params={'grant':grant})).status_code,400)
        self.assertTrue((await self.client.get(PREFIX+'/auth/status')).json()['connected'])
    async def test_revoked_token_cannot_restore(self):
        grant='R'*43;self.app.state.store.put(grant,{'restoreToken':'TEST-ONLY-TOKEN'},120);self.fail=401
        r=await self.client.get(PREFIX+'/auth/restore',params={'grant':grant});self.assertEqual(r.status_code,401);self.assertIsNone(self.app.state.store.get(grant))
        self.assertFalse((await self.client.get(PREFIX+'/auth/status')).json()['connected'])
    async def test_status_remembers_provider_expiry(self):
        token='header.'+base64.urlsafe_b64encode(json.dumps({'exp':int(time.time())+86400}).encode()).decode().rstrip('=')+'.signature'
        self.app.state.store.put('remembered-browser',{'token':token},3600);self.client.cookies.set(COOKIE,'remembered-browser')
        from unittest.mock import patch,AsyncMock
        with patch.object(self.app.state.broker,'post',new=AsyncMock(return_value={'stat':'Ok'})) as verify:
            r=await self.client.get(PREFIX+'/auth/status')
            verify.assert_awaited_once()
        self.assertTrue(r.json()['connected']);self.assertTrue(r.json()['verified']);self.assertIn('Max-Age=863',r.headers['set-cookie']);self.assertNotIn(token,r.text)
    async def test_temporary_broker_outage_does_not_clear_session(self):
        await self.login();self.fail=503
        r=await self.client.get(PREFIX+'/auth/status')
        self.assertTrue(r.json()['connected']);self.assertFalse(r.json()['verified'])
    async def test_public_catalogue_and_authenticated_availability(self):
        from unittest.mock import patch
        class DirectoryClient:
            def __init__(self,*a,**kw):pass
            async def __aenter__(self):return self
            async def __aexit__(self,*a):pass
            async def get(self,url):
                rows=[{'symbol':'SENSEX','instrument_type':'IO'},{'symbol':'RELIANCE','instrument_type':'SO'}] if url.endswith('BFO') else [{'symbol':'NIFTY','instrument_type':'OPTIDX'}]
                return httpx.Response(200,json={'contracts':rows},request=httpx.Request('GET',url))
        with patch('alice_history.httpx.AsyncClient',DirectoryClient):
            r=await self.client.get(PREFIX+'/instruments');self.assertEqual(r.status_code,200);self.assertFalse(r.json()['brokerConnected']);self.assertEqual(len(r.json()['instruments']),3)
            await self.login()
            r=await self.client.get(PREFIX+'/instruments');self.assertTrue(r.json()['brokerConnected']);rows=r.json()['instruments'];self.assertTrue(next(x for x in rows if x['symbol']=='NIFTY')['chainAvailable']);self.assertFalse(next(x for x in rows if x['symbol']=='RELIANCE')['chainAvailable'])
    async def asyncSetUp(self):
        self.tmp=tempfile.TemporaryDirectory();self.calls=[];self.fail=None
        def broker(req):
            self.calls.append(req);path=req.url.path
            if self.fail:return httpx.Response(self.fail,json={'private':'NEVER RETURN THIS'})
            if path.endswith('getUserDetails'):return httpx.Response(200,json={'stat':'Ok','clientId':'TESTUSER','userSession':'TEST-ONLY-TOKEN'})
            self.assertEqual(req.headers['Authorization'],'Bearer TEST-ONLY-TOKEN')
            if path.endswith('getUnderlying'):data={'status':'Ok','result':[{'list_underlying':['NIFTY']}]}
            elif path.endswith('getUnderlyingExp'):data={'status':'Ok','result':[{'underlying':'NIFTY','underlying_expiry':['25AUG26']}]}
            else:data=fixture()
            return httpx.Response(200,json=data)
        self.app=create_app({'ALICEBLUE_APP_CODE':'TESTAPP','ALICEBLUE_API_SECRET':'TESTSECRET','ALICEBLUE_REDIRECT_URL':'http://127.0.0.1:4174'+PREFIX+'/auth/callback','ALICEBLUE_SESSION_ENCRYPTION_KEY':Fernet.generate_key().decode()},str(Path(self.tmp.name)/'sessions.db'),httpx.MockTransport(broker))
        self.client=httpx.AsyncClient(transport=httpx.ASGITransport(app=self.app),base_url='http://127.0.0.1:4174')
    async def asyncTearDown(self):await self.client.aclose();await self.app.state.broker.http.aclose();self.tmp.cleanup()
    async def login(self):
        from urllib.parse import urlsplit,parse_qs
        r=await self.client.post(PREFIX+'/auth/login',headers={'origin':'http://127.0.0.1:4174'});self.assertEqual(r.status_code,200);self.assertIn('HttpOnly',r.headers['set-cookie']);state=parse_qs(urlsplit(r.json()['loginUrl']).query)['state'][0]
        return await self.client.get(PREFIX+'/auth/callback',params={'userId':'TESTUSER','authCode':'TESTCODE','state':state})
    async def test_auth_and_chain_cache(self):
        r=await self.login();self.assertEqual(r.status_code,303);self.assertNotIn('TEST-ONLY-TOKEN',r.text)
        result=await self.client.get(PREFIX+'/option-chain',params={'underlying':'NIFTY','expiry':'25AUG26'});self.assertEqual(result.status_code,200,result.text);self.assertEqual(result.json()['rows'][0]['CE']['ltp'],517.8);n=len(self.calls)
        both=await asyncio.gather(*[self.client.get(PREFIX+'/option-chain',params={'underlying':'NIFTY','expiry':'25AUG26'}) for _ in range(2)]);self.assertEqual(len(self.calls),n);self.assertTrue(all(x.json()['cached'] for x in both));self.assertNotIn('TEST-ONLY-TOKEN',result.text)
    async def test_unauthorized_and_csrf(self):
        self.assertEqual((await self.client.get(PREFIX+'/underlyings')).status_code,401)
        self.assertEqual((await self.client.post(PREFIX+'/auth/login')).status_code,403)
        self.assertEqual((await self.client.get(PREFIX+'/auth/status',headers={'origin':'https://evil.invalid'})).status_code,403)
    async def test_callback_replay(self):
        self.assertEqual((await self.login()).status_code,303);r=await self.client.get(PREFIX+'/auth/callback',params={'userId':'TESTUSER','authCode':'TESTCODE','state':'wrong'});self.assertEqual(r.status_code,400)
    async def test_missing_state_fails_closed(self):
        await self.client.post(PREFIX+'/auth/login',headers={'origin':'http://127.0.0.1:4174'});r=await self.client.get(PREFIX+'/auth/callback',params={'userId':'TESTUSER','authCode':'TESTCODE'});self.assertEqual(r.status_code,400);self.assertEqual(len(self.calls),0)
    async def test_expired_broker_and_redaction(self):
        await self.login();self.fail=401;r=await self.client.get(PREFIX+'/underlyings');self.assertEqual(r.status_code,401);self.assertNotIn('NEVER RETURN',r.text);self.assertFalse((await self.client.get(PREFIX+'/auth/status')).json()['connected'])
    async def test_invalid_exchange_and_interval(self):
        await self.login();self.assertEqual((await self.client.get(PREFIX+'/underlyings?exch=evil')).status_code,422);self.assertEqual((await self.client.get(PREFIX+'/option-chain?underlying=NIFTY&expiry=25AUG26&interval=99')).status_code,422)
    async def test_rate_limit(self):
        await self.login();self.fail=429;r=await self.client.get(PREFIX+'/underlyings');self.assertEqual(r.status_code,429);self.assertGreater(self.app.state.broker.pause,0)

    async def test_security_hardening_guards(self):
        # 1. Path traversal blocked on underlying-candles
        r=await self.client.get(PREFIX+'/underlying-candles',params={'underlying':'../../etc/passwd'})
        self.assertEqual(r.status_code,422)
        # 2. Origin: null rejected on GET and OPTIONS
        self.assertEqual((await self.client.get(PREFIX+'/health',headers={'origin':'null'})).status_code,403)
        self.assertEqual((await self.client.options(PREFIX+'/health',headers={'origin':'null'})).status_code,403)
        # 3. Production admin guard on /auth/apikey & /snapshots/record & /recorder/configure
        self.assertEqual((await self.client.post(PREFIX+'/auth/apikey',headers={'origin':'http://127.0.0.1:4174'},json={'clientId':'TESTUSER','apiKey':'A'*32})).status_code,403)
        self.assertEqual((await self.client.post(PREFIX+'/snapshots/record',headers={'origin':'http://127.0.0.1:4174'},json={'underlying':'NIFTY','expiry':'25AUG26'})).status_code,403)
        # 4. SSRF invalid ALICEBLUE_BASE_URL rejected at startup
        with self.assertRaises(ValueError):
            create_app({'ALICEBLUE_BASE_URL':'http://169.254.169.254','ALICEBLUE_REDIRECT_URL':'http://127.0.0.1:4174'+PREFIX+'/auth/callback','ALICEBLUE_SESSION_ENCRYPTION_KEY':Fernet.generate_key().decode()},str(Path(self.tmp.name)/'bad.db'))

if __name__=='__main__':unittest.main()

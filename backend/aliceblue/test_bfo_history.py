import json,tempfile,unittest
from pathlib import Path
from unittest.mock import patch
import httpx
from cryptography.fernet import Fernet
from alice_service import create_app,PREFIX,COOKIE

class BfoReplay(unittest.IsolatedAsyncioTestCase):
 async def test_sensex_replay_routes_contracts_and_index_to_bse_segments(self):
  calls=[];master_calls=[]
  def broker(req):
   body=json.loads(req.content);calls.append((req.url.path,body))
   if req.url.path.endswith('getUnderlying'):out={'result':[{'list_underlying':['SENSEX']}]}
   elif req.url.path.endswith('getUnderlyingExp'):out={'result':[{'underlying':'SENSEX','underlying_expiry':['19NOV26']}]}
   elif req.url.path.endswith('getOptionChain'):out={'result':[{'data':[{'CE':{'tradingsymbol':'SENSEX26N1981700CE','ltp':100},'PE':{'tradingsymbol':'SENSEX26N1981700PE','ltp':200}}]}]}
   else:
    self.assertIn(body['exchange'],['BFO','BSE::index'])
    price=81700 if body['exchange']=='BSE::index' else 100
    out={'result':[{'time':'2026-11-12 09:15:59','close':price,'volume':10},{'time':'2026-11-12 09:16:59','close':price+1,'volume':10}]}
   return httpx.Response(200,json={'status':'Ok',**out})
  class Directory:
   def __init__(self,*a,**kw):pass
   async def __aenter__(self):return self
   async def __aexit__(self,*a):pass
   async def get(self,url):
    name=url.rsplit('/',1)[-1];master_calls.append(name)
    if name=='BFO':data=[{'symbol':'SENSEX','trading_symbol':'SENSEX26N1981700'+side,'token':str(i),'lot_size':20,'instrument_type':'IO'} for i,side in enumerate(['CE','PE'],1)]
    elif name=='INDICES':data={'BSE':[{'symbol':'SENSEX','token':'999'}]}
    else:raise AssertionError('Wrong contract directory '+name)
    return httpx.Response(200,json=data,request=httpx.Request('GET',url))
  with tempfile.TemporaryDirectory() as tmp:
   app=create_app({'ALICEBLUE_APP_CODE':'TEST','ALICEBLUE_API_SECRET':'TEST','ALICEBLUE_REDIRECT_URL':'http://127.0.0.1:4174'+PREFIX+'/auth/callback','ALICEBLUE_SESSION_ENCRYPTION_KEY':Fernet.generate_key().decode()},str(Path(tmp)/'s.db'),httpx.MockTransport(broker))
   app.state.store.put('test-browser',{'token':'TEST-ONLY'},3600)
   async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app),base_url='http://127.0.0.1:4174',cookies={COOKIE:'test-browser'}) as client:
    with patch('alice_history.httpx.AsyncClient',Directory):r=await client.get(PREFIX+'/replay',params={'underlying':'SENSEX','exch':'bse_fo','expiry':'19NOV26','start':'2026-11-12','end':'2026-11-12'})
   await app.state.broker.http.aclose()
   self.assertEqual(r.status_code,200,r.text);j=r.json()['dataset']
   self.assertEqual(j['metadata']['exchange'],'bse_fo');self.assertEqual(len(j['contracts']),4);self.assertEqual(len(j['underlying']),2)
   self.assertEqual(set(master_calls),{'BFO','INDICES'})
   self.assertEqual([b['exchange'] for p,b in calls if p.endswith('/history')],['BFO','BFO','BSE::index'])

if __name__=='__main__':unittest.main()

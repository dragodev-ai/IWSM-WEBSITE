import sqlite3,tempfile,unittest
from pathlib import Path
from unittest.mock import patch
from nifty_backup import NiftyBackup
from alice_service import create_app,PREFIX
from cryptography.fernet import Fernet
import httpx

class BackupTests(unittest.IsolatedAsyncioTestCase):
 async def asyncSetUp(self):
  self.tmp=tempfile.TemporaryDirectory();self.root=Path(self.tmp.name);self.backup=NiftyBackup(self.root)
  c=sqlite3.connect(self.root/'nifty.sqlite3')
  c.executescript('CREATE TABLE sources(date TEXT PRIMARY KEY);CREATE TABLE quotes(date TEXT,expiry TEXT,type TEXT,strike REAL,open REAL,high REAL,low REAL,close REAL,settle REAL,oi REAL,oi_change REAL,volume REAL,lot_size INTEGER,volume_unit TEXT);')
  c.execute('insert into sources values(?)',('2021-11-08',))
  c.execute('insert into quotes values('+','.join('?'*14)+')',('2021-11-08','2021-11-11','CE',18000,90,110,80,100,100,0,0,10,None,'contracts'));c.commit();c.close()
  def unavailable(req):return httpx.Response(503,json={'stat':'Not_Ok'})
  with patch('nifty_backup.NiftyBackup',return_value=self.backup):
   self.app=create_app({'ALICEBLUE_APP_CODE':'TEST','ALICEBLUE_API_SECRET':'TEST','ALICEBLUE_REDIRECT_URL':'http://127.0.0.1:4174'+PREFIX+'/auth/callback','ALICEBLUE_SESSION_ENCRYPTION_KEY':Fernet.generate_key().decode()},str(self.root/'auth.db'),httpx.MockTransport(unavailable))
  self.client=httpx.AsyncClient(transport=httpx.ASGITransport(app=self.app),base_url='http://127.0.0.1:4174')
 async def asyncTearDown(self):await self.client.aclose();await self.app.state.broker.http.aclose();self.tmp.cleanup()
 async def test_daily_backup_when_broker_is_disconnected(self):
  r=await self.client.get(PREFIX+'/replay',params={'underlying':'NIFTY','expiry':'11NOV21','start':'2021-11-08','end':'2021-11-08'})
  self.assertEqual(r.status_code,200,r.text);j=r.json();self.assertTrue(j['backup']);self.assertEqual(j['resolution'],'daily');self.assertEqual(j['dataset']['contracts'][0]['close'],100);self.assertEqual(j['dataset']['contracts'][0]['oi'],0);self.assertIsNone(j['dataset']['contracts'][0]['lotSize']);self.assertIn('2021-11-08',j['notice'])
 async def test_wrong_symbol_and_empty_window_do_not_fabricate(self):
  for sym,day in [('RELIANCE','2021-11-08'),('NIFTY','2020-01-01')]:
   r=await self.client.get(PREFIX+'/replay',params={'underlying':sym,'expiry':'11NOV21','start':day,'end':day});self.assertNotEqual(r.status_code,200)
 async def test_saved_minutes_take_priority_over_daily(self):
  raw={'source':'TEST ONLY minute quotes','contracts':[{'symbol':'NIFTY','timestamp':'2021-11-08T09:15','expiry':'2021-11-11','type':'CE','strike':18000,'close':90,'lotSize':50,'oi':None,'volume':1}],'underlying':[]}
  self.backup.remember(raw,'minute');j=self.backup.load('11NOV21','2021-11-08','2021-11-08');self.assertEqual(j['resolution'],'minute');self.assertEqual(j['dataset']['contracts'][0]['close'],90)
 async def test_backup_expiry_list_without_broker(self):
  with patch('nifty_backup.NiftyBackup',return_value=self.backup):
   r=await self.client.get(PREFIX+'/expiries',params={'underlying':'NIFTY','start':'2021-11-08','end':'2021-11-08'})
  self.assertEqual(r.status_code,200);self.assertEqual(r.json()['expiries'],['11NOV21']);self.assertTrue(r.json()['backup'])
if __name__=='__main__':unittest.main()

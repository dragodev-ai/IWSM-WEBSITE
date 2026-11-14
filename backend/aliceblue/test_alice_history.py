import unittest
from fastapi import HTTPException
from alice_history import observations,instrument_catalog,master_rows,front_future
class Bars(unittest.TestCase):
 def test_front_future_keeps_its_own_expiry(self):
  from datetime import datetime,timezone
  def row(day,symbol='NIFTY'):
   return {'symbol':symbol,'instrument_type':'FUTIDX','expiry_date':datetime.fromisoformat(day).replace(tzinfo=timezone.utc).timestamp()*1000,'lot_size':65,'token':'TEST'}
  chosen=front_future([row('2026-12-29'),row('2026-11-23'),row('2026-10-27'),row('2026-11-17','OTHER')],'NIFTY','2026-11-12')
  self.assertEqual(chosen['expiryISO'],'2026-11-23')
  self.assertIsNone(front_future([{'symbol':'NIFTY','instrument_type':'FUTIDX','expiry_date':'bad'}],'NIFTY','2026-11-12'))
 def test_broker_universe(self):
  index={'symbol':'NIFTY','instrument_type':'OPTIDX'};stock={'symbol':'RELIANCE','instrument_type':'OPTSTK'}
  rows=instrument_catalog({'nse_fo':{'NFO':[index,index,stock,{'symbol':'CASHONLY','instrument_type':'EQ'}]},'bse_fo':[{'symbol':'SENSEX','instrument_type':'IO'},{'symbol':'RELIANCE','instrument_type':'SO'}]})
  self.assertEqual(len(rows),4);self.assertEqual({r['symbol'] for r in rows},{'NIFTY','SENSEX','RELIANCE'})
  self.assertEqual(next(r for r in rows if r['symbol']=='SENSEX')['exchange'],'bse_fo')
  self.assertEqual(next(r for r in rows if r['symbol']=='RELIANCE')['kind'],'stock')
 def test_bad_master_rows(self):
  self.assertEqual(master_rows(None),[])
  self.assertEqual(instrument_catalog({'nse_fo':[{'symbol':'<bad>','instrument_type':'OPTIDX'}]}),[])
 def test_filter_and_deduplicate(self):
  row={'time':'2026-11-03 09:15:59','close':80,'volume':10}
  self.assertEqual(observations([row,row,dict(row,time='2026-11-04 09:15:59')],'2026-11-03','2026-11-03'),[{'timestamp':'2026-11-03T09:15','close':80.,'volume':10.}])
 def test_conflicting_bars(self):
  a={'time':'2026-11-03 09:15:59','close':80,'volume':10}
  with self.assertRaises(HTTPException):observations([a,dict(a,close=90)],'2026-11-03','2026-11-03')
 def test_invalid(self):
  self.assertEqual(observations([{'time':'bad'},{'time':'2026-11-03 08:00:00','close':80,'volume':10}],'2026-11-03','2026-11-03'),[])
if __name__=='__main__':unittest.main()

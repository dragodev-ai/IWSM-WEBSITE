"""Indexed counterpart of the Excel export; no token or authentication storage."""
import gzip,json,sqlite3,re,time
from contextlib import contextmanager
from pathlib import Path
from datetime import date,datetime
DEFAULT_ROOT=Path(__file__).resolve().parents[2]/'market-data/nifty-backup'
class NiftyBackup:
 def __init__(self,root=DEFAULT_ROOT):self.root=Path(root)
 @contextmanager
 def connect(self):
  if not (self.root/'nifty.sqlite3').is_file():raise ValueError('NIFTY backup is not available')
  c=sqlite3.connect(self.root/'nifty.sqlite3',timeout=10);c.row_factory=sqlite3.Row
  try:
   with c:yield c
  finally:c.close()
 def expiry_iso(self,value):
  try:return datetime.strptime(value,'%d%b%y').date().isoformat()
  except ValueError:return date.fromisoformat(value).isoformat()
 def expiries(self,start='',end=''):
  with self.connect() as c:
   if start and end:
    date.fromisoformat(start);date.fromisoformat(end)
    rows=c.execute("SELECT DISTINCT expiry FROM quotes WHERE date>=? AND date<=? AND type!='FUT' ORDER BY expiry",(start,end))
   else:
    last=c.execute('select max(date) from sources').fetchone()[0];rows=c.execute("SELECT DISTINCT expiry FROM quotes WHERE date=? AND type!='FUT' ORDER BY expiry",(last,))
   return [datetime.strptime(r[0],'%Y-%m-%d').strftime('%d%b%y').upper() for r in rows]
 def remember(self,dataset,kind):
  if not dataset.get('contracts') or any(r.get('symbol')!='NIFTY' for r in dataset['contracts']):return
  self.root.mkdir(parents=True,exist_ok=True)
  rows=dataset['contracts'];start=min(r.get('timestamp',r.get('date',''))[:10] for r in rows);end=max(r.get('timestamp',r.get('date',''))[:10] for r in rows)
  with self.connect() as c:
   c.execute('CREATE TABLE IF NOT EXISTS captures(kind TEXT,start TEXT,end TEXT,expiry TEXT,saved REAL,payload BLOB,PRIMARY KEY(kind,start,end,expiry))')
   for expiry in {r['expiry'] for r in rows}:
    copy={**dataset,'contracts':[r for r in rows if r['expiry']==expiry]}
    c.execute('INSERT OR REPLACE INTO captures VALUES(?,?,?,?,?,?)',(kind,start,end,expiry,time.time(),gzip.compress(json.dumps(copy,separators=(',',':')).encode())))
 def cached(self,expiry,start,end,kind):
  try:
   with self.connect() as c:
    if kind=='minute':row=c.execute('select payload from captures where kind=? and expiry=? and start<=? and end>=? order by saved desc limit 1',(kind,expiry,start,end)).fetchone()
    else:row=c.execute('select payload from captures where kind=? and expiry=? order by saved desc limit 1',(kind,expiry)).fetchone()
   if not row:return None
   raw=json.loads(gzip.decompress(row[0]));raw['contracts']=[r for r in raw['contracts'] if kind!='minute' or start<=r['timestamp'][:10]<=end];raw['underlying']=[r for r in raw.get('underlying',[]) if kind!='minute' or start<=r['timestamp'][:10]<=end]
   return raw if raw['contracts'] else None
  except sqlite3.OperationalError:return None
 def load(self,expiry,start='',end='',kind='minute'):
  exp=self.expiry_iso(expiry)
  if kind=='minute':
   a,b=date.fromisoformat(start),date.fromisoformat(end)
   if not 0<=(b-a).days<=30:raise ValueError('Select up to 31 calendar days')
  raw=self.cached(exp,start,end,kind)
  if raw:
   raw['metadata']={**raw.get('metadata',{}),'backup':True,'backupResolution':'minute' if kind=='minute' else 'snapshot'}
   return {'dataset':raw,'backup':True,'resolution':'minute' if kind=='minute' else 'snapshot','asOf':max(r.get('timestamp',r.get('date','')) for r in raw['contracts'])}
  with self.connect() as c:
   if kind=='snapshot':start=end=c.execute('select max(date) from quotes where expiry=?',(exp,)).fetchone()[0]
   if not start:raise ValueError('No backup records for this expiry')
   rows=c.execute('select * from quotes where expiry=? and date>=? and date<=? order by date,strike,type',(exp,start,end)).fetchall()
   if not rows:raise ValueError('No backup records for this expiry/date window')
   refs=[]
   try:refs=[{'date':r[0],'symbol':'NIFTY','close':r[1]} for r in c.execute('select date,close from underlying where date>=? and date<=?',(start,end))]
   except sqlite3.OperationalError:pass
  contracts=[{'date':r['date'],'symbol':'NIFTY','expiry':r['expiry'],'type':r['type'],'strike':r['strike'],'close':r['close'],'lotSize':r['lot_size'],'oi':r['oi'],'volume':r['volume']} for r in rows]
  raw={'source':'Local NIFTY backup · verified NSE daily closes','contracts':contracts,'underlying':refs,'metadata':{'exchange':'nse_fo','backup':True,'backupResolution':'daily','modelled':False,'quoteTiming':'End-of-day close, not live or minute data','warning':'Some legacy reports omit lot size and underlying price. Missing source values remain unavailable.'}}
  return {'dataset':raw,'backup':True,'resolution':'daily','asOf':max(r['date'] for r in contracts)}

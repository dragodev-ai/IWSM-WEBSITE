(function(root,factory){const api=factory(typeof module==='object'&&module.exports?require('./strategy-research-engine.js'):root.IWSMResearch);if(typeof module==='object'&&module.exports)module.exports=api;else root.IWSMAdvanced=api;})(typeof globalThis!=='undefined'?globalThis:this,function(R){
 'use strict';
 const finite=n=>typeof n==='number'&&Number.isFinite(n);
 function analyze(data,symbol,date,rate=6,dividend=0){
  if(!finite(rate)||rate< -10||rate>100||!finite(dividend)||dividend<0||dividend>100)throw Error('Check rate and dividend assumptions.');
  const records=data.contracts.filter(r=>r.symbol===symbol&&r.date===date),expiries=[...new Set(records.map(r=>r.expiry))].sort();
  const surface=[],buildup=[];
  for(const expiry of expiries){
   const s=R.summarize(data,{symbol,date,expiry,rate,dividend});
   const prior=new Map(data.contracts.filter(r=>r.symbol===symbol&&r.date===s.previousDate&&r.expiry===expiry).map(r=>[r.type+'|'+r.strike,r]));
   for(const row of s.rows)for(const [type,side] of [['CE','call'],['PE','put']]){
    const r=row[side];if(!r)continue;
    surface.push({date,expiry,strike:row.strike,type,close:r.close,iv:row[side+'IV'],oi:r.oi,volume:r.volume});
    const p=prior.get(type+'|'+row.strike),priceChange=p&&finite(p.close)&&p.close>0?(r.close/p.close-1)*100:null;
    const oiChange=p&&finite(p.oi)&&finite(r.oi)?r.oi-p.oi:null;
    const label=priceChange==null||oiChange==null?'Insufficient history':priceChange===0||oiChange===0?'Unchanged':oiChange>0?(priceChange>0?'Long buildup':'Short buildup'):(priceChange>0?'Short covering':'Long unwinding');
    buildup.push({date,previousDate:s.previousDate,expiry,strike:row.strike,type,close:r.close,priceChange,oiChange,classification:label});
   }
  }
  const underlying=data.underlying.filter(r=>r.symbol===symbol&&r.date<=date&&finite(r.close)&&r.close>0).sort((a,b)=>a.date.localeCompare(b.date));
  if(new Set(underlying.map(r=>r.date)).size!==underlying.length)throw Error('Resolve duplicate underlying dates before calculating averages.');
  const moving=underlying.map((r,i)=>{const out={date:r.date,close:r.close};for(const period of [5,10,20,50])out['sma'+period]=i+1<period?null:underlying.slice(i+1-period,i+1).reduce((sum,p)=>sum+p.close,0)/period;return out;});
  return {surface,buildup,moving};
 }
 return {analyze};
});

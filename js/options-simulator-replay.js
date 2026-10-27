(function(root,factory){
  if(typeof module==='object'&&module.exports)module.exports=factory(require('./options-simulator-engine.js'),require('./strategy-engine.js'),require('./strategy-history-engine.js'));
  else root.IWSMReplay=factory(root.IWSMSimulator,root.IWSMStrategy,root.IWSMHistory);
})(typeof globalThis!=='undefined'?globalThis:this,function(M,E,H){
  'use strict';
  const finite=Number.isFinite,DAY=86400000;
  function selectTime(d,s,date,time){
    const stamp=M.timestamp(date+'T'+time);
    const list=M.frames(d,s).filter(t=>t.slice(0,10)===stamp.slice(0,10));
    if(!list.length)throw Error('No recorded snapshots for this date. Choose a date listed in the replay.');
    if(d.kind==='daily')return M.advance(d,s,list.at(-1));
    if(!list.includes(stamp))throw Error('No recorded quote at '+time+' IST. Select an available snapshot; missing prices are not interpolated.');
    return M.advance(d,s,stamp);
  }
  function jump(d,s,direction,amount){
    // Reuse the engine's session/calendar handling, including sparse observations.
    if(d.kind==='daily'&&amount!=='day')throw Error('Daily archives cannot provide minute replay. Import timestamped data.');
    if(amount!==120)return M.advance(d,s,M.step(d,s,direction,amount).cursor);
    if(d.kind!=='intraday')throw Error('Minute steps require timestamped intraday data.');
    if(![1,-1].includes(direction))throw Error('Invalid replay direction.');
    const list=M.frames(d,s),target=M.instant(s.cursor)+direction*120*60000;
    const candidates=list.filter(t=>direction===1?t>s.cursor&&M.instant(t)>=target:t<s.cursor&&M.instant(t)<=target);
    return M.advance(d,s,(direction===1?candidates[0]:candidates.at(-1))||(direction===1?list.at(-1):list[0]));
  }
  function profile(d,s,options={}){
    const val=M.valuation(d,s),expiry=options.expiry||M.chain(d,s)[0]?.expiry;
    const ref=M.reference(d,s,expiry,options.basis||'spot').price;
    if(ref===null)return null;
    const analysis=M.analytics(d,s),open=val.positions.filter(p=>!p.closed);
    const horizon=open.length?Math.min(...open.map(p=>Math.max(0,(Date.parse(p.expiry+'T15:30:00+05:30')-M.instant(s.cursor))/DAY))):0;
    const rate=s.rate/100,dividend=options.basis&&options.basis!=='spot'?rate:s.dividend/100;
    const legs=open.map(p=>{
      const days=Math.max(0,(Date.parse(p.expiry+'T15:30:00+05:30')-M.instant(s.cursor))/DAY);
      const mark=p.mark;
      const iv=p.type==='FUT'?null:mark===null?null:infer(p.type,ref,p.strike,days,mark,rate,dividend);
      return {...p,days,iv};
    });
    const expDate=open.map(p=>p.expiry).sort()[0]||expiry;
    const mixed=new Set(open.map(p=>p.expiry)).size>1;
    const range=[.04,.08,.15,.25].includes(options.range)?options.range:.08;
    const strikes=open.filter(p=>p.type!=='FUT').map(p=>p.strike);
    const lo=Math.max(.01,Math.min(ref*(1-range),...strikes.map(x=>x-ref*.015))),hi=Math.max(ref*(1+range),...strikes.map(x=>x+ref*.015));
    function point(x){
      if(!finite(x)||x<0)throw Error('Use a non-negative underlying price.');
      let current=val.realized-val.costs,expiryValue=current,currentOK=true,expiryOK=true;
      for(const p of legs){
        if(p.mark===null){currentOK=false;expiryOK=false;continue;}
        const qty=p.side*p.units;
        if(p.type==='FUT'){
          // Hold each futures basis fixed; at the reference, current equals recorded P&L.
          current+=qty*(p.mark+(x-ref)-p.entry);
          expiryValue+=qty*(p.mark+(x-ref)-p.entry);
          continue;
        }
        if(p.iv===null)currentOK=false;
        else current+=qty*(p.mark+E.price(p.type,x,p.strike,p.days,p.iv,rate,dividend)-E.price(p.type,ref,p.strike,p.days,p.iv,rate,dividend)-p.entry);
        const remaining=Math.max(0,p.days-horizon);
        if(remaining>1e-9&&p.iv===null)expiryOK=false;
        else expiryValue+=qty*(E.price(p.type,x,p.strike,remaining,p.iv??.001,rate,dividend)-p.entry);
      }
      return {underlying:x,fromSpot:(x/ref-1)*100,current:currentOK?current:null,expiry:expiryOK?expiryValue:null};
    }
    const points=Array.from({length:241},(_,i)=>point(lo+(hi-lo)*i/240));
    return {spot:ref,lo,hi,points,point,expiry:expDate,mixed,start:s.start,cursor:s.cursor,hasPositions:val.positions.length>0,recordedNet:val.net,metrics:analysis.metrics};
  }
  function infer(type,spot,strike,days,price,rate,dividend){
    if(days<=0)return Math.abs(price-E.price(type,spot,strike,0,.001,rate,dividend))<.05?.001:null;
    const low=E.price(type,spot,strike,days,.00001,rate,dividend),high=E.price(type,spot,strike,days,5,rate,dividend);
    if(price<low-.05||price>high+.05)return null;
    let a=.00001,b=5;
    for(let i=0;i<70;i++){const v=(a+b)/2;if(E.price(type,spot,strike,days,v,rate,dividend)>price)b=v;else a=v;}
    return (a+b)/2;
  }
  function readCSV(text,source='Imported intraday CSV'){
    const rows=H.parseCSV(text),contracts=[],underlying=[];
    for(const raw of rows){
      const row=Object.fromEntries(Object.entries(raw).map(([k,v])=>[k.trim().toLowerCase(),v]));
      const timestamp=row.timestamp||row.datetime||(row.date&&row.time?row.date+'T'+row.time:null);
      if(!timestamp)throw Error('Intraday CSV requires timestamp, or separate date and time columns.');
      const type=(row.type||row.option_type||row.instrument_type||'').toUpperCase();
      const sym=row.symbol||row.symbol_name,close=row.close??row.ltp;
      if(type==='SPOT'||type==='INDEX'){underlying.push({timestamp,symbol:sym,close});continue;}
      contracts.push({timestamp,symbol:sym,type:type==='FUTURES'?'FUT':type,expiry:row.expiry||row.expiry_date,strike:row.strike||row.strike_price,close,lotSize:row.lotsize||row.lot_size||null,volume:row.volume||null,oi:row.oi||null,spot:row.spot||null});
    }
    return {source,contracts,underlying};
  }
  function readJSON(raw){
    if(!raw||typeof raw!=='object')throw Error('Import a recorded dataset or simulation backup.');
    if(Array.isArray(raw.snapshots)){
      const contracts=[],underlying=[];
      for(const snap of raw.snapshots){
        if(!Array.isArray(snap.contracts))throw Error('Each snapshot needs a contracts array.');
        if(snap.spot!==undefined)underlying.push({timestamp:snap.timestamp,symbol:snap.symbol,close:snap.spot});
        for(const row of snap.contracts)contracts.push({...row,timestamp:snap.timestamp,symbol:row.symbol||snap.symbol});
      }
      return {source:raw.source||'Imported timestamped snapshots',contracts,underlying,metadata:raw.metadata||{}};
    }
    return raw.data||raw;
  }
  function practice(){
    // Explicit synthetic teaching fixture. Never labelled historical market data.
    const contracts=[],underlying=[],dates=['2026-10-14','2026-10-15'],expiries=['2026-10-19','2026-10-27'];
    dates.forEach((date,day)=>{
      for(let minute=555;minute<=930;minute+=5){
        const t=(minute-555)/5,spot=Math.round((22680+day*80+t*1.8+70*Math.sin(t/8))*100)/100;
        const timestamp=date+'T'+String(Math.floor(minute/60)).padStart(2,'0')+':'+String(minute%60).padStart(2,'0');
        underlying.push({timestamp,symbol:'NIFTY',close:spot});
        for(const expiry of expiries){
          const days=(Date.parse(expiry+'T15:30+05:30')-M.instant(timestamp))/DAY;
          for(let strike=22100;strike<=23300;strike+=50)for(const type of ['CE','PE']){
            const vol=.18+.012*Math.sin(t/10)+(strike-22700)**2/1e8;
            contracts.push({timestamp,symbol:'NIFTY',expiry,type,strike,close:Math.round(E.price(type,spot,strike,days,vol)*100)/100,lotSize:65,volume:100+t,oi:10000+Math.abs(strike-22700)*20,spot});
          }
          contracts.push({timestamp,symbol:'NIFTY',expiry,type:'FUT',strike:0,close:Math.round((spot+days*4)*100)/100,lotSize:65,volume:500+t,oi:250000,spot});
        }
      }
    });
    return {source:'Synthetic intraday practice — not historical market prices',metadata:{synthetic:true,description:'Deterministic teaching prices and illustrative contract sizes; import timestamped observations for actual history.'},contracts,underlying};
  }
  return {selectTime,jump,profile,readCSV,readJSON,practice};
});

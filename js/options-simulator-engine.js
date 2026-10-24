(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./strategy-engine.js'), require('./strategy-research-engine.js'), require('./strategy-history-engine.js'));
  else root.IWSMSimulator = factory(root.IWSMStrategy, root.IWSMResearch, root.IWSMHistory);
})(typeof globalThis !== 'undefined' ? globalThis : this, function (Strategy, Research, History) {
  'use strict';
  const DAY=86400000, MINUTE=60000, IST=330*MINUTE, MAX_ROWS=200000;
  const finite=n=>typeof n==='number'&&Number.isFinite(n);
  const number=n=>{if(n===null||n===undefined||n==='')return null;if(finite(n))return n;if(typeof n!=='string'||!/^[+-]?(?:\d+(?:\.\d*)?|\d{1,3}(?:,\d{2,3})+(?:\.\d*)?|\.\d+)$/.test(n.trim()))return NaN;return Number(n.trim().replace(/,/g,''));};
  const date=d=>typeof d==='string'&&History.parseDate(d)===d;
  const symbol=s=>History.canonicalSymbol(s);
  const key=r=>[r.expiry,r.type,r.type==='FUT'?0:r.strike].join('|');
  const copy=s=>({...s,events:s.events.map(e=>({...e}))});
  const uid=()=> 'sim-'+Date.now().toString(36)+'-'+Math.random().toString(36).slice(2,11);
  function timestamp(value) {
    if(typeof value!=='string')throw Error('Use a valid minute timestamp, such as 2025-01-06T09:15+05:30.');
    const m=/^(\d{4}-\d{2}-\d{2})[T ](\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,3}))?)?(Z|[+-]\d{2}:\d{2})?$/.exec(value.trim());
    if(!m||!date(m[1])||Number(m[2])>23||Number(m[3])>59||Number(m[4]||0)!==0||Number(m[5]||0)!==0)throw Error('Timestamp must identify an actual minute, without seconds or invalid dates.');
    const zone=m[6]||'+05:30';
    if(zone!=='Z'&&(Number(zone.slice(1,3))>14||Number(zone.slice(4))>59))throw Error('Invalid timestamp offset.');
    const ms=Date.parse(m[1]+'T'+m[2]+':'+m[3]+':00'+zone);
    if(!finite(ms))throw Error('Invalid timestamp.');
    return new Date(ms+IST).toISOString().slice(0,16);
  }
  const instant=stamp=>Date.parse(stamp+':00+05:30');
  const expiryTime=expiry=>Date.parse(expiry+'T15:30:00+05:30');
  function observation(row) {
    const ts=row.timestamp??row.datetime;
    if(ts!==undefined&&ts!==null&&ts!=='')return {stamp:timestamp(ts),kind:'intraday'};
    if(!date(row.date))throw Error('Invalid observation date; use YYYY-MM-DD.');
    return {stamp:row.date+'T15:30',kind:'daily'};
  }
  function fingerprint(rows) {
    let a=2166136261,b=2654435769;
    for(const row of rows){const str=JSON.stringify(row);for(let i=0;i<str.length;i++){a=Math.imul(a^str.charCodeAt(i),16777619);b=Math.imul(b+str.charCodeAt(i),2246822519);}}
    return (a>>>0).toString(16).padStart(8,'0')+(b>>>0).toString(16).padStart(8,'0');
  }
  function prepareDataset(raw) {
    if(!raw||typeof raw!=='object'||!Array.isArray(raw.contracts)||!raw.contracts.length)throw Error('Load contract observations before starting a simulation.');
    if(raw.contracts.length>MAX_ROWS||(raw.underlying||[]).length>MAX_ROWS)throw Error('Import up to 200,000 rows at a time.');
    if(raw.underlying&&!Array.isArray(raw.underlying))throw Error('Underlying observations must be an array.');
    const records=new Map(),kinds=new Set(),spots=new Map(),derived=new Map(),warnings=[];
    for(const input of raw.contracts){
      if(!input||typeof input!=='object'||Array.isArray(input))throw Error('Invalid contract observation.');
      const at=observation(input),sym=symbol(input.symbol),type=String(input.type||'').toUpperCase(),expiry=input.expiry;
      const strike=type==='FUT'?0:number(input.strike),close=number(input.close),lotSize=number(input.lotSize),volume=number(input.volume),oi=number(input.oi);
      if(!sym||sym.length>100||/[\u0000-\u001f]/.test(sym)||!['CE','PE','FUT'].includes(type)||!date(expiry)||instant(at.stamp)>expiryTime(expiry)||!finite(strike)||(type!=='FUT'&&strike<=0)||strike>1e7||!finite(close)||close<0||close>1e7||(type==='FUT'&&close===0))throw Error('Invalid symbol, expiry, strike or recorded price.');
      if(lotSize!==null&&(!Number.isInteger(lotSize)||lotSize<1||lotSize>1e6))throw Error('Recorded lot size must be a positive whole number.');
      if((volume!==null&&(!finite(volume)||volume<0))||(oi!==null&&(!finite(oi)||oi<0)))throw Error('Invalid volume or open interest.');
      kinds.add(at.kind);
      const row={date:at.stamp.slice(0,10),...(at.kind==='intraday'?{timestamp:at.stamp}:{}),stamp:at.stamp,symbol:sym,expiry,type,strike,close,lotSize,volume,oi};
      const id=sym+'|'+at.stamp+'|'+key(row),existing=records.get(id);
      if(existing&&JSON.stringify(existing)!==JSON.stringify(row))throw Error('Conflicting duplicate contract observations.');
      records.set(id,row);
      const reference=number(input.spot),refKey=sym+'|'+at.stamp;
      if(reference!==null&&reference>0){if(!derived.has(refKey))derived.set(refKey,new Set());derived.get(refKey).add(reference);}
    }
    if(kinds.size!==1)throw Error('Do not mix daily and intraday contract observations in one dataset.');
    const kind=[...kinds][0],underlying=[];
    for(const input of raw.underlying||[]){
      if(!input||typeof input!=='object'||Array.isArray(input))throw Error('Invalid underlying observation.');
      const at=observation(input),sym=symbol(input.symbol),close=number(input.close);
      if(!sym||!finite(close)||close<=0||close>1e7)throw Error('Invalid underlying price.');
      if(kind==='intraday'&&at.kind==='daily'){warnings.push('Daily underlying closes are excluded from intraday marks.');continue;}
      if(kind==='daily'&&at.kind!=='daily')throw Error('Do not mix intraday underlying marks with a daily replay.');
      const id=sym+'|'+at.stamp;
      if(spots.has(id)&&spots.get(id)!==close)throw Error('Conflicting duplicate underlying observations.');
      spots.set(id,close);
    }
    for(const [id,values]of derived){if(values.size===1&&!spots.has(id))spots.set(id,[...values][0]);else if(values.size>1)warnings.push('Conflicting per-contract underlying references were excluded.');}
    const contracts=[...records.values()].sort((a,b)=>a.symbol.localeCompare(b.symbol)||a.stamp.localeCompare(b.stamp)||key(a).localeCompare(key(b)));
    const bySymbol=new Map(),byFrame=new Map();
    for(const r of contracts){if(!bySymbol.has(r.symbol))bySymbol.set(r.symbol,new Set());bySymbol.get(r.symbol).add(r.stamp);const id=r.symbol+'|'+r.stamp;if(!byFrame.has(id))byFrame.set(id,[]);byFrame.get(id).push(r);}
    for(const [id,close]of [...spots].sort((a,b)=>a[0].localeCompare(b[0]))){const split=id.indexOf('|'),sym=id.slice(0,split),stamp=id.slice(split+1);underlying.push({symbol:sym,date:stamp.slice(0,10),...(kind==='intraday'?{timestamp:stamp}:{}),close});}
    const symbols=[...bySymbol.keys()].sort(),signature=fingerprint([kind,...contracts,...underlying]);
    return {kind,contracts,underlying,symbols,signature,source:String(raw.source||'Imported observations').slice(0,300),metadata:raw.metadata||{},warnings:[...new Set(warnings)],byFrame,records,spots,bySymbol};
  }
  function exportDataset(d){return {source:d.source,metadata:d.metadata,contracts:d.contracts.map(({stamp,...row})=>row),underlying:d.underlying};}
  function setting(value,fallback,min,max,integer=false){const n=value===undefined?fallback:value;if(!finite(n)||n<min||n>max||(integer&&!Number.isInteger(n)))throw Error('Use valid non-negative fees/slippage, rates and whole-number quantities.');return n;}
  function createSession(d,options={}) {
    const sym=symbol(options.symbol||d.symbols[0]),available=[...(d.bySymbol.get(sym)||[])].sort();
    if(!available.length)throw Error('No recorded data for this symbol.');
    const start=options.start||available[0].slice(0,10),end=options.end||available.at(-1).slice(0,10);
    if(!date(start)||!date(end)||start>end)throw Error('Select a valid start and end date.');
    const frames=available.filter(stamp=>stamp.slice(0,10)>=start&&stamp.slice(0,10)<=end);
    if(!frames.length)throw Error('No recorded snapshots in this date range.');
    const units=options.unitsPerLot===undefined||options.unitsPerLot===null||options.unitsPerLot===''?null:setting(options.unitsPerLot,null,1,1e6,true);
    return {version:1,id:uid(),name:String(options.name||sym+' simulation').slice(0,80),symbol:sym,start,end,cursor:frames[0],dataSignature:d.signature,feesPerOrder:setting(options.feesPerOrder,0,0,1e6),slippage:setting(options.slippage,0,0,1e5),rate:setting(options.rate,6,-10,100),dividend:setting(options.dividend,0,0,100),unitsPerLot:units,events:[]};
  }
  function frames(d,s){return [...(d.bySymbol.get(s.symbol)||[])].filter(t=>t.slice(0,10)>=s.start&&t.slice(0,10)<=s.end).sort();}
  function seek(d,s,stamp){if(!frames(d,s).includes(stamp))throw Error('Choose a recorded snapshot.');return {...s,cursor:stamp};}
  function step(d,s,direction,amount=1){
    if(![1,-1].includes(direction))throw Error('Invalid playback direction.');
    const list=frames(d,s),index=list.indexOf(s.cursor);let next=index;
    if(index<0)throw Error('Current snapshot is unavailable.');
    if(d.kind==='daily'){if(![1,5,'day'].includes(amount))throw Error('Daily archives support recorded sessions, not minute timeframes.');next=index+direction*(amount===5?5:1);}
    else if(amount==='day'){
      const dates=[...new Set(list.map(t=>t.slice(0,10)))],dayIndex=dates.indexOf(s.cursor.slice(0,10)),targetDate=dates[dayIndex+direction];
      if(targetDate){const sameDay=list.filter(t=>t.startsWith(targetDate));next=list.indexOf(sameDay.find(t=>t.slice(11)>=s.cursor.slice(11))||sameDay.at(-1));}
      else next=direction===1?list.length-1:0;
    }else{
      if(![1,5,15,30,60].includes(amount))throw Error('Use a supported minute timeframe.');
      const target=instant(s.cursor)+direction*amount*MINUTE;
      if(direction===1){const found=list.findIndex((t,i)=>i>index&&instant(t)>=target);next=found<0?list.length-1:found;}
      else{for(let i=index-1;i>=0;i--)if(instant(list[i])<=target){next=i;break;}if(next===index)next=0;}
    }
    return {...s,cursor:list[Math.max(0,Math.min(list.length-1,next))]};
  }
  function chain(d,s,expiry){return (d.byFrame.get(s.symbol+'|'+s.cursor)||[]).filter(r=>!expiry||r.expiry===expiry);}
  function spot(d,s){return d.spots.get(s.symbol+'|'+s.cursor)??null;}
  function hasFuture(s){return s.events.some(e=>e.at>s.cursor);}
  function editable(s){if(hasFuture(s))throw Error('This simulation has later trades. Move forward or branch here before adding or closing a position.');if(s.events.length>=1000)throw Error('This simulation has reached 1,000 trade events. Start a new simulation.');}
  function quote(d,s,contract){return d.records.get(s.symbol+'|'+s.cursor+'|'+key(contract))||null;}
  function fill(d,s,contract){const row=quote(d,s,contract);if(!row)throw Error('No recorded quote for this exact contract at the selected snapshot.');if(row.volume===0)throw Error('No recorded trades (zero volume) at this snapshot. Choose a liquid contract or another time.');return row;}
  function cost(s,units){return s.feesPerOrder+s.slippage*units;}
  function open(d,s,options){
    editable(s);
    if(!options||![1,-1].includes(options.side)||!Number.isInteger(options.lots)||options.lots<1||options.lots>100)throw Error('Use Buy/Sell and a whole-number lot quantity from 1 to 100.');
    const row=fill(d,s,options),unitsPerLot=row.lotSize||s.unitsPerLot;
    if(!Number.isInteger(unitsPerLot)||unitsPerLot<1||unitsPerLot>1e6)throw Error('This report has no lot size. Enter verified historical units per lot before trading.');
    if(valuation(d,s).positions.filter(p=>!p.closed).length>=24)throw Error('Use up to 24 open positions.');
    const event={id:s.id+'-'+(s.events.length+1),kind:'open',at:s.cursor,expiry:row.expiry,type:row.type,strike:row.strike,side:options.side,lots:options.lots,unitsPerLot,price:row.close,cost:cost(s,options.lots*unitsPerLot)};
    return {...s,events:s.events.concat(event)};
  }
  function close(d,s,positionId){
    editable(s);const position=valuation(d,s).positions.find(p=>p.id===positionId);
    if(!position||position.closed)throw Error('Choose an open position to close.');
    const row=fill(d,s,position);
    return {...s,events:s.events.concat({id:s.id+'-'+(s.events.length+1),kind:'close',at:s.cursor,positionId,price:row.close,cost:cost(s,position.units)})};
  }
  function closeAll(d,s){let next=s;for(const p of valuation(d,s).positions.filter(p=>!p.closed))next=close(d,next,p.id);return next;}
  function valuation(d,s){
    const positions=new Map();let costs=0;
    for(const event of s.events){if(event.at>s.cursor)continue;costs+=event.cost;
      if(event.kind==='open')positions.set(event.id,{...event,entry:event.price,units:event.lots*event.unitsPerLot,closed:false,closeAt:null});
      else{const p=positions.get(event.positionId);if(p){p.closed=true;p.exit=event.price;p.closeAt=event.at;}}
    }
    let realized=0,unrealized=0,missing=0;
    for(const p of positions.values()){
      const mark=p.closed?p.exit:quote(d,s,p)?.close??null;
      p.mark=mark;p.illiquid=!p.closed&&quote(d,s,p)?.volume===0;p.pnl=mark===null?null:p.side*p.units*(mark-p.entry);
      if(p.closed)realized+=p.pnl;else if(p.pnl===null)missing++;else unrealized+=p.pnl;
    }
    return {positions:[...positions.values()],realized,unrealized:missing?null:unrealized,gross:missing?null:realized+unrealized,costs,net:missing?null:realized+unrealized-costs,missing};
  }
  function addPreset(d,s,{templateIndex,expiry,atm,lots=1}){
    const template=Strategy.templates[templateIndex];if(!template)throw Error('Select a strategy.');
    const rows=chain(d,s),selected=rows.filter(r=>r.expiry===expiry),strikes=[...new Set(selected.filter(r=>r.type!=='FUT').map(r=>r.strike))].sort((a,b)=>a-b);
    const reference=finite(atm)?atm:spot(d,s),base=strikes.length&&finite(reference)?strikes.reduce((a,b)=>Math.abs(b-reference)<Math.abs(a-reference)?b:a):null;
    const differences=strikes.slice(1).map((x,i)=>x-strikes[i]),strikeStep=Math.min(...differences),later=[...new Set(rows.map(r=>r.expiry))].sort().find(e=>e>expiry);
    if(template.legs.some(l=>l[1]!=='FUT')&&(!finite(base)||(!finite(strikeStep)&&template.legs.some(l=>l[2]!==0))))throw Error('Choose an ATM strike from the recorded chain. This structure needs its exact listed strikes.');
    let next=s;
    for(const [side,type,offset,multiple=1,extra=0]of template.legs){const e=extra?later:expiry;if(!e)throw Error('This calendar needs a later listed expiry at the current snapshot.');next=open(d,next,{expiry:e,type,strike:type==='FUT'?0:base+offset*(finite(strikeStep)?strikeStep:0),side,lots:lots*multiple});}
    return next;
  }
  function fork(d,s){const events=s.events.filter(e=>e.at<=s.cursor).map(e=>({...e}));return {...copy(s),id:uid(),name:(s.name+' branch').slice(0,80),events,riskRules:(s.riskRules||[]).filter(r=>r.at<=s.cursor&&events.some(e=>e.id===r.positionId)).map(r=>({...r}))};}
  function restore(d,input){
    if(!input||input.version!==1||input.dataSignature!==d.signature||typeof input.id!=='string'||input.id.length>100||!Array.isArray(input.events)||input.events.length>1000)throw Error('Simulation data is missing, changed or invalid. Import its original backup.');
    let s=createSession(d,input);s.id=input.id;const ids=new Set();let last='';
    for(const event of input.events){
      if(!event||typeof event.id!=='string'||event.id.length>150||ids.has(event.id)||typeof event.at!=='string'||event.at<last)throw Error('Invalid simulation trade records.');
      ids.add(event.id);last=event.at;s=seek(d,s,event.at);
      const next=event.kind==='open'?open(d,s,event):event.kind==='close'?close(d,s,event.positionId):null;
      if(!next)throw Error('Invalid simulation event type.');const calculated=next.events.at(-1);
      if(event.price!==calculated.price||event.cost!==calculated.cost||(event.kind==='open'&&event.unitsPerLot!==calculated.unitsPerLot))throw Error('Saved trade price or quantity differs from its recorded observation.');
      calculated.id=event.id;s=next;
    }
    if(input.riskRules!==undefined){
      if(!Array.isArray(input.riskRules)||input.riskRules.length>1000)throw Error('Invalid saved exit rules.');
      s.riskRules=[];
      for(const r of input.riskRules){
        if(!r||!frames(d,s).includes(r.at))throw Error('Invalid saved exit rule timestamp.');
        const at=seek(d,{...s,events:s.events.filter(e=>e.at<=r.at&&!(e.kind==='close'&&e.positionId===r.positionId&&e.at===r.at))},r.at);
        const next=setRisk(d,at,r.positionId,r);s.riskRules=next.riskRules;
      }
    }
    for(let i=0;i<s.events.length;i++)if(['stop','target'].includes(input.events[i].trigger))s.events[i].trigger=input.events[i].trigger;
    return seek(d,s,input.cursor);
  }
  function analytics(d,s){
    const v=valuation(d,s),reference=spot(d,s),openPositions=v.positions.filter(p=>!p.closed),totals={delta:0,gamma:0,theta:0,vega:0,rho:0},legs=[];
    let complete=reference!==null;
    for(const p of openPositions){
      const days=Math.max(0,(expiryTime(p.expiry)-instant(s.cursor))/DAY),iv=p.type==='FUT'?null:reference!==null&&p.mark!==null?Research.impliedVolatility(p.type,reference,p.strike,days,p.mark,s.rate/100,s.dividend/100):null;
      p.iv=iv===null?null:iv*100;p.days=days;
      p.greeks=reference!==null&&(p.type==='FUT'||iv!==null)?Strategy.greeks(p.type,reference,p.strike,days,iv||.001,s.rate/100,s.dividend/100):null;
      if(!p.greeks)complete=false;else for(const name of Object.keys(totals))totals[name]+=p.greeks[name]*p.side*p.units;
      legs.push({type:p.type,strike:p.strike,side:p.side,lots:p.units,premium:p.entry,days,iv:p.iv??15,enabled:true});
    }
    const state={spot:reference,lotSize:1,rate:s.rate,dividend:s.dividend,iv:15,days:1,step:1,legs};
    const metrics=reference!==null&&legs.length?Strategy.metrics(state):null;
    const horizon=legs.length?Math.min(...legs.map(l=>l.days)):0;
    return {positions:openPositions,spot:reference,greeks:complete?totals:null,metrics,state,horizon,offset:v.realized-v.costs,curveAvailable:reference!==null&&legs.length>0&&(!metrics?.mixed||complete)};
  }
  function sessionEdge(d,s,edge){
    if(!['start','end'].includes(edge))throw Error('Choose start or end of session.');
    const same=frames(d,s).filter(t=>t.slice(0,10)===s.cursor.slice(0,10));
    return seek(d,s,edge==='start'?same[0]:same.at(-1));
  }
  function reference(d,s,expiry,basis='spot'){
    const rows=chain(d,s,expiry),strikes=[...new Set(rows.filter(r=>r.type!=='FUT').map(r=>r.strike))].sort((a,b)=>a-b);
    let price=spot(d,s);
    if(basis==='future')price=rows.find(r=>r.type==='FUT')?.close??null;
    else if(basis==='synthetic'){
      const pairs=strikes.map(k=>({strike:k,call:rows.find(r=>r.type==='CE'&&r.strike===k),put:rows.find(r=>r.type==='PE'&&r.strike===k)})).filter(p=>p.call&&p.put);
      const selected=pairs.sort((a,b)=>Math.abs(a.strike-(price??a.strike))-Math.abs(b.strike-(price??b.strike)))[0];
      price=selected?selected.strike+selected.call.close-selected.put.close:null;
    }else if(basis!=='spot')throw Error('Choose a supported reference.');
    if(!finite(price)||price<=0)price=null;
    return {price,basis,atm:price===null||!strikes.length?null:strikes.reduce((a,b)=>Math.abs(b-price)<Math.abs(a-price)?b:a)};
  }
  function setRisk(d,s,positionId,rule={}){
    editable(s);
    const p=valuation(d,s).positions.find(p=>p.id===positionId&&!p.closed);
    if(!p||p.mark===null)throw Error('Choose an open position with a recorded quote.');
    const stopLoss=rule.stopLoss??null,target=rule.target??null;
    for(const n of [stopLoss,target])if(n!==null&&(!finite(n)||n<0||n>1e7))throw Error('Use non-negative premium thresholds.');
    if(stopLoss!==null&&(p.side===1?stopLoss>=p.mark:stopLoss<=p.mark))throw Error('Stop must be below the current premium for buys and above it for sells.');
    if(target!==null&&(p.side===1?target<=p.mark:target>=p.mark))throw Error('Target must be above the current premium for buys and below it for sells.');
    const riskRules=(s.riskRules||[]).filter(r=>r.positionId!==positionId||r.at!==s.cursor);
    if(riskRules.length>=1000)throw Error('Rule history is full. Start a new simulation.');
    return {...s,riskRules:riskRules.concat({positionId,at:s.cursor,stopLoss,target})};
  }
  function advance(d,s,stamp){
    const goal=seek(d,s,stamp);
    if(stamp<=s.cursor||hasFuture(s)||!s.riskRules?.length)return goal;
    let next=s;
    for(const t of frames(d,s).filter(t=>t>s.cursor&&t<=stamp)){
      next=seek(d,next,t);
      for(const p of valuation(d,next).positions.filter(p=>!p.closed&&p.mark!==null&&!p.illiquid)){
        const r=(next.riskRules||[]).filter(r=>r.positionId===p.id&&r.at<t).sort((a,b)=>a.at.localeCompare(b.at)).at(-1);if(!r)continue;
        const stop=r.stopLoss!==null&&(p.side===1?p.mark<=r.stopLoss:p.mark>=r.stopLoss),target=r.target!==null&&(p.side===1?p.mark>=r.target:p.mark<=r.target);
        if(stop||target){next=close(d,next,p.id);next.events.at(-1).trigger=stop?'stop':'target';}
      }
    }
    return goal.cursor===next.cursor?next:seek(d,next,stamp);
  }
  function history(d,s){
    let peak=0;
    return frames(d,s).filter(t=>t<=s.cursor).map(at=>{const state={...s,cursor:at},v=valuation(d,state);if(v.net!==null)peak=Math.max(peak,v.net);return {at,spot:spot(d,state),net:v.net,realized:v.realized,costs:v.costs,drawdown:v.net===null?null:peak-v.net};});
  }
  return {prepareDataset,exportDataset,createSession,frames,seek,step,chain,spot,hasFuture,open,close,closeAll,valuation,addPreset,fork,restore,analytics,timestamp,instant,sessionEdge,reference,setRisk,advance,history};
});

(function(root,factory){
  if(typeof module==='object'&&module.exports)module.exports=factory(require('./options-simulator-engine.js'));
  else root.IWSMPaperExecution=factory(root.IWSMSimulator);
})(typeof globalThis!=='undefined'?globalThis:this,function(M){
  'use strict';
  const MAX_EVENTS=2000,MAX_LOTS=1000;
  const finite=Number.isFinite;
  function freeze(x){if(x&&typeof x==='object'&&!Object.isFrozen(x)){Object.values(x).forEach(freeze);Object.freeze(x);}return x;}
  function number(x,fallback,min,max){x=x===undefined?fallback:x;if(!finite(x)||x<min||x>max)throw Error('Invalid paper account setting.');return x;}
  function settings(o={}){return {initialBalance:number(o.initialBalance,1000000,1,1e12),feePerOrder:number(o.feePerOrder,20,0,1e6),feeBps:number(o.feeBps,0,0,10000),slippage:number(o.slippage,0,0,1e6),marginRate:number(o.marginRate,.2,0,1),rate:number(o.rate,6,-10,100),dividend:number(o.dividend,0,0,100)};}
  const uid=()=> 'paper-'+Date.now().toString(36)+'-'+Math.random().toString(36).slice(2,9);
  function check(d,s){if(!s||s.version!==1||s.dataSignature!==d.signature)throw Error('Paper study dataset is missing or changed.');}
  function frames(d,s){return M.frames(d,s);}
  function create(d,o={}){const base=M.createSession(d,o),cfg=settings(o);return freeze({version:1,id:uid(),symbol:base.symbol,start:base.start,end:base.end,cursor:base.cursor,frontier:base.cursor,dataSignature:d.signature,settings:cfg,events:[],fills:[]});}
  function exact(d,s,at,p){return d.records.get([s.symbol,at,p.expiry,p.type,p.type==='FUT'?0:p.strike].join('|'))||null;}
  function quote(d,s,at,p){const q=exact(d,s,at,p);return q&&q.volume!==0?q:null;}
  function fee(cfg,price,units){return cfg.feePerOrder+cfg.feeBps/10000*price*units+cfg.slippage*units;}
  function contract(o){
    if(!o||!['CE','PE','FUT'].includes(o.type)||![1,-1].includes(o.side)||!Number.isInteger(o.lots)||o.lots<1||o.lots>MAX_LOTS||typeof o.expiry!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(o.expiry)||!['market','limit'].includes(o.orderType||'market'))throw Error('Choose a contract, side, whole lots (1–1000), and market or limit order.');
    const strike=o.type==='FUT'?0:o.strike;
    if(!finite(strike)||strike<0||(o.type!=='FUT'&&strike===0))throw Error('Invalid strike.');
    if(o.orderType==='limit'&&(!finite(o.limitPrice)||o.limitPrice<0||o.limitPrice>1e7))throw Error('Invalid limit price.');
    let customPrice;
    if(o.entryPrice!==undefined&&o.entryPrice!==null&&o.entryPrice!==''){
      customPrice=Number(o.entryPrice);
      if(!finite(customPrice)||customPrice<0||customPrice>1e7)throw Error('Invalid custom entry premium.');
    }
    return {
      type:o.type,
      expiry:o.expiry,
      strike,
      side:o.side,
      lots:o.lots,
      orderType:o.orderType||'market',
      ...(o.orderType==='limit'?{limitPrice:o.limitPrice}:{}),
      ...(customPrice!==undefined?{entryPrice:customPrice}:{}),
      note:String(o.note||'').slice(0,500)
    };
  }
  function modifySpec(o){
    if(!o||typeof o!=='object')throw Error('Provide leg parameters to modify.');
    const out={};
    if(o.type!==undefined){if(!['CE','PE','FUT'].includes(o.type))throw Error('Invalid contract type.');out.type=o.type;}
    if(o.expiry!==undefined){if(typeof o.expiry!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(o.expiry))throw Error('Invalid expiry date.');out.expiry=o.expiry;}
    if(o.strike!==undefined){const st=Number(o.strike);if(!finite(st)||st<0)throw Error('Invalid strike.');out.strike=st;}
    if(o.side!==undefined){if(![1,-1].includes(Number(o.side)))throw Error('Invalid Buy/Sell side.');out.side=Number(o.side);}
    if(o.lots!==undefined){const l=Number(o.lots);if(!Number.isInteger(l)||l<1||l>MAX_LOTS)throw Error('Lots must be a whole number (1–1000).');out.lots=l;}
    if(o.entryPrice!==undefined&&o.entryPrice!==null&&o.entryPrice!==''){const ep=Number(o.entryPrice);if(!finite(ep)||ep<0||ep>1e7)throw Error('Invalid entry premium.');out.entryPrice=ep;}
    return out;
  }
  function riskSpec(o){const out={};for(const k of ['stopLoss','target','trailing']){const n=o[k]??null;if(n!==null&&(!finite(n)||n<0||n>1e7||(k==='trailing'&&n===0)))throw Error('Risk levels must be non-negative prices; trailing distance must be positive.');out[k]=n;}return out;}
  function value(d,s,at,b){
    let realized=0,costs=0,unrealized=0,margin=0,debit=0,missing=0;
    const positions=b.positions.map(p=>{
      const active=p.enabled!==false;
      const q=exact(d,s,at,p),remaining=p.remainingLots*p.unitsPerLot,mark=p.closed?p.exit:q?.close??null;
      const pnl=mark===null?null:p.side*remaining*(mark-p.entry);
      if(active||p.closed){realized+=p.realized;costs+=p.costs;}
      if(!p.closed&&active){
        if(pnl===null)missing++;else unrealized+=pnl;
        if(p.type!=='FUT'&&p.side===1){if(mark===null)missing++;else debit+=mark*remaining;}
        else{const spot=d.spots.get(s.symbol+'|'+at);if(!finite(spot))missing++;else margin+=spot*remaining*s.settings.marginRate;}
      }
      return {
        ...p,
        enabled:active,
        units:p.lots*p.unitsPerLot,
        remainingUnits:remaining,
        mark,
        pnl:p.closed?p.realized:pnl,
        net:mark===null?null:p.realized+(p.closed?0:pnl)-p.costs,
        unrealized:p.closed?0:pnl,
        illiquid:!p.closed&&q?.volume===0
      };
    });
    const net=missing?null:realized+unrealized-costs,equity=net===null?null:s.settings.initialBalance+net;
    return {positions,orders:b.orders.map(o=>({...o})),realized,unrealized:missing?null:unrealized,costs,net,equity,available:equity===null?null:equity-debit-margin,margin:missing?null:margin,initialBalance:s.settings.initialBalance,missing,marginLabel:'Configurable paper estimate; not exchange SPAN or broker margin'};
  }
  function run(d,s,through=s.cursor,capture=false){
    const b={positions:[],orders:[],fills:[],history:[]},eventsByTime=new Map();
    for(const e of s.events){if(!eventsByTime.has(e.at))eventsByTime.set(e.at,[]);eventsByTime.get(e.at).push(e);}
    function close(p,lots,at,cfg,fillId,reason,customExitPrice){
      const q=quote(d,s,at,p);
      const execPrice=customExitPrice!==undefined&&finite(customExitPrice)?customExitPrice:q?.close;
      if(!finite(execPrice))return false;
      const units=lots*p.unitsPerLot,cost=fee(cfg,execPrice,units),gross=p.side*units*(execPrice-p.entry),entryCost=p.entryCost*lots/p.lots;
      const f={id:fillId,positionId:p.id,orderId:null,kind:'exit',at,price:execPrice,lots,units,cost,entryCost,gross,net:gross-entryCost-cost,reason};
      b.fills.push(f);p.remainingLots-=lots;p.realized+=gross;p.costs+=cost;p.closed=p.remainingLots===0;p.closeAt=p.closed?at:null;p.exit=execPrice;return true;
    }
    function fillOrder(o,at){
      const q=quote(d,s,at,o);
      if(!q){if(o.orderType==='market'){o.status='rejected';o.reason='Exact quote unavailable or zero recorded volume.';}return;}
      if(at.slice(0,10)>o.expiry){o.status='rejected';o.reason='Contract expired.';return;}
      const execPrice=o.entryPrice!==undefined?o.entryPrice:q.close;
      if(o.orderType==='limit'&&o.entryPrice===undefined&&(o.side===1?q.close>o.limitPrice:q.close<o.limitPrice))return;
      if(!Number.isInteger(q.lotSize)||q.lotSize<1){o.status='rejected';o.reason='Verified contract lot size unavailable.';return;}
      const units=o.lots*q.lotSize,cost=fee(o.settings,execPrice,units),v=value(d,s,at,b),spot=d.spots.get(s.symbol+'|'+at),need=o.type!=='FUT'&&o.side===1?execPrice*units:finite(spot)?spot*units*o.settings.marginRate:null;
      if(need===null||v.available===null||v.available<need+cost){o.status='rejected';o.reason=need===null?'Matching underlying quote unavailable for margin.':'Insufficient available paper capital.';return;}
      o.status='completed';o.fillAt=at;o.fillPrice=execPrice;
      const p={id:o.id,orderId:o.id,type:o.type,expiry:o.expiry,strike:o.strike,side:o.side,lots:o.lots,remainingLots:o.lots,unitsPerLot:q.lotSize,entry:execPrice,...(o.entryPrice!==undefined?{customEntry:true}:{}),openAt:at,entryCost:cost,costs:cost,realized:0,closed:false,closeAt:null,risk:{stopLoss:null,target:null,trailing:null},highWater:q.close,lowWater:q.close};
      b.positions.push(p);
      b.fills.push({id:o.id+'-fill',positionId:p.id,orderId:o.id,kind:'entry',at,price:execPrice,lots:o.lots,units,cost});
    }
    for(const at of frames(d,s)){if(at>through)break;
      // Only observed option/futures closes are executable. No forward fill or intrabar guesses.
      for(const o of b.orders)if(o.status==='pending'&&o.at<at)fillOrder(o,at);
      for(const p of b.positions){if(p.closed||p.enabled===false||p.openAt>=at)continue;const q=exact(d,s,at,p);if(!q)continue;const r=p.risk;p.highWater=Math.max(p.highWater,q.close);p.lowWater=Math.min(p.lowWater,q.close);const trail=r.trailing===null?null:p.side===1?p.highWater-r.trailing:p.lowWater+r.trailing;const stop=(r.stopLoss!==null&&(p.side===1?q.close<=r.stopLoss:q.close>=r.stopLoss))||(trail!==null&&(p.side===1?q.close<=trail:q.close>=trail));const target=r.target!==null&&(p.side===1?q.close>=r.target:q.close<=r.target);if(stop||target)close(p,p.remainingLots,at,p.riskSettings||s.settings,p.id+'-auto-'+at,stop?'stop':'target');}
      for(const e of eventsByTime.get(at)||[]){
        if(e.kind==='order'){const o={...e.spec,id:e.id,at,status:'pending',settings:e.settings};b.orders.push(o);if(o.orderType==='market')fillOrder(o,at);}
        else if(e.kind==='cancel'){const o=b.orders.find(o=>o.id===e.orderId);if(!o||o.status!=='pending')throw Error('Choose a pending order to cancel.');o.status='cancelled';o.cancelAt=at;}
        else if(e.kind==='remove'){
          const idx=b.positions.findIndex(x=>x.id===e.positionId);
          if(idx<0)throw Error('Choose a position to remove.');
          b.positions.splice(idx,1);
        }
        else if(e.kind==='toggle'){
          const p=b.positions.find(x=>x.id===e.positionId);
          if(!p||p.closed)throw Error('Choose an open position to toggle.');
          p.enabled=Boolean(e.enabled);
        }
        else if(e.kind==='modify'){
          const p=b.positions.find(x=>x.id===e.positionId);
          if(!p||p.closed)throw Error('Choose an open position to edit.');
          const nextType=e.spec.type??p.type,nextExpiry=e.spec.expiry??p.expiry,nextStrike=nextType==='FUT'?0:(e.spec.strike??p.strike);
          const q=exact(d,s,at,{type:nextType,expiry:nextExpiry,strike:nextStrike});
          const lotSize=q?.lotSize||p.unitsPerLot;
          if(!Number.isInteger(lotSize)||lotSize<1)throw Error('Verified contract lot size unavailable for edited leg.');
          const nextLots=e.spec.lots??p.remainingLots;
          const nextEntry=e.spec.entryPrice!==undefined?e.spec.entryPrice:((nextType!==p.type||nextExpiry!==p.expiry||nextStrike!==p.strike)?(q?.close??null):p.entry);
          if(!finite(nextEntry))throw Error('Quote unavailable for edited contract; specify an entry premium or pick a quoted strike.');
          const nextSide=e.spec.side??p.side;
          const units=nextLots*lotSize,cost=fee(e.settings,nextEntry,units);
          p.type=nextType;p.expiry=nextExpiry;p.strike=nextStrike;p.side=nextSide;
          p.lots=nextLots;p.remainingLots=nextLots;p.unitsPerLot=lotSize;
          p.entry=nextEntry;p.customEntry=e.spec.entryPrice!==undefined||Boolean(p.customEntry);
          p.entryCost=cost;p.costs=cost;p.realized=0;
          p.highWater=q?.close??nextEntry;p.lowWater=p.highWater;
        }
        else{
          const p=b.positions.find(p=>p.id===e.positionId);if(!p||p.closed)throw Error('Choose an open position.');
          if(e.kind==='exit'){
            const lots=e.lots??p.remainingLots;
            if(!Number.isInteger(lots)||lots<1||lots>p.remainingLots)throw Error('Exit lots exceed the remaining position.');
            if(!close(p,lots,at,e.settings,e.id+'-fill','manual',e.exitPrice))throw Error('Exact executable quote unavailable for exit.');
          }
          else if(e.kind==='risk'){p.risk={...e.spec};p.riskSettings=e.settings;const q=exact(d,s,at,p);p.highWater=q?.close??p.entry;p.lowWater=p.highWater;}
          else throw Error('Invalid paper event.');
        }
      }
      if(capture){const v=value(d,s,at,b);b.history.push({at,equity:v.equity,net:v.net,realized:v.realized,costs:v.costs});}
    }
    return b;
  }
  function editable(d,s){check(d,s);if(s.cursor<s.frontier)throw Error('This paper study has later observations. Move forward or branch here before editing.');if(s.events.length>=MAX_EVENTS)throw Error('Paper study event limit reached (2000).');}
  function materialize(d,s){const b=run(d,s,s.frontier);return freeze({...s,fills:b.fills});}
  function append(d,s,event){editable(d,s);const e={id:s.id+'-'+(s.events.length+1),at:s.cursor,...event,settings:settings(s.settings)};return materialize(d,{...s,events:s.events.concat(e)});}
  function order(d,s,o){return append(d,s,{kind:'order',spec:contract(o)});}
  function cancel(d,s,orderId){return append(d,s,{kind:'cancel',orderId});}
  function exit(d,s,positionId,lots,exitPrice){
    const extra={};
    if(lots!==undefined)extra.lots=lots;
    if(exitPrice!==undefined&&exitPrice!==null&&exitPrice!==''){const ep=Number(exitPrice);if(!finite(ep)||ep<0||ep>1e7)throw Error('Invalid custom exit price.');extra.exitPrice=ep;}
    return append(d,s,{kind:'exit',positionId,...extra});
  }
  function toggle(d,s,positionId,enabled){return append(d,s,{kind:'toggle',positionId,enabled:Boolean(enabled)});}
  function modify(d,s,positionId,patch){return append(d,s,{kind:'modify',positionId,spec:modifySpec(patch)});}
  function remove(d,s,positionId){return append(d,s,{kind:'remove',positionId});}
  function risk(d,s,positionId,o){return append(d,s,{kind:'risk',positionId,spec:riskSpec(o)});}
  function advance(d,s,target){check(d,s);target=M.timestamp(target);if(!frames(d,s).includes(target))throw Error('Choose an observed close in the study date range.');return materialize(d,{...s,cursor:target,frontier:target>s.frontier?target:s.frontier});}
  function branch(d,s){check(d,s);return materialize(d,{...s,id:uid(),frontier:s.cursor,events:s.events.filter(e=>e.at<=s.cursor)});}
  function valuation(d,s){check(d,s);return value(d,s,s.cursor,run(d,s));}
  function journal(d,s){const b=run(d,s),v=value(d,s,s.cursor,b),rows=b.fills.filter(f=>f.kind==='exit').map(f=>{const p=b.positions.find(p=>p.id===f.positionId);return p?{...f,type:p.type,expiry:p.expiry,strike:p.strike,side:p.side,entry:p.entry,openAt:p.openAt,closeAt:f.at,status:'closed'}:{...f,status:'closed'};});for(const p of v.positions)if(!p.closed)rows.push({...p,status:'open',gross:p.unrealized,net:p.unrealized===null?null:p.unrealized-p.entryCost*p.remainingLots/p.lots});return rows;}
  function analytics(d,s){const rows=journal(d,s),closed=rows.filter(r=>r.status==='closed'),wins=closed.filter(r=>r.net>1e-8),losses=closed.filter(r=>r.net<-1e-8),sum=rs=>rs.reduce((a,r)=>a+r.net,0),grossProfit=sum(wins),grossLoss=-sum(losses);let peak=s.settings.initialBalance,maxDrawdown=0;const equityCurve=run(d,s,s.cursor,true).history.map(v=>{const at=v.at;if(v.equity!==null){peak=Math.max(peak,v.equity);maxDrawdown=Math.max(maxDrawdown,peak-v.equity);}return {at,equity:v.equity,net:v.net,realized:v.realized,costs:v.costs,drawdown:v.equity===null?null:peak-v.equity};});const metrics={totalTrades:closed.length,winTrades:wins.length,lossTrades:losses.length,breakevenTrades:closed.length-wins.length-losses.length,winRate:closed.length?wins.length/closed.length*100:0,grossProfit,grossLoss,net:valuation(d,s).net,closedNet:sum(closed),averageProfit:wins.length?grossProfit/wins.length:0,averageLoss:losses.length?-grossLoss/losses.length:0,maxDrawdown,profitFactor:grossLoss?grossProfit/grossLoss:null,riskReward:losses.length&&wins.length?(grossProfit/wins.length)/(grossLoss/losses.length):null};return {metrics,equityCurve,journal:rows,...metrics};}
  function restore(d,input){
    if(typeof input==='string')input=JSON.parse(input);
    if(!input||input.version!==1||input.dataSignature!==d.signature||typeof input.id!=='string'||input.id.length>100||!Array.isArray(input.events)||input.events.length>MAX_EVENTS||(!Array.isArray(input.fills)||input.fills.length>MAX_EVENTS*2))throw Error('Invalid paper backup or changed dataset signature.');
    let s=create(d,{symbol:input.symbol,start:input.start,end:input.end,...input.settings});s={...s,id:input.id};
    let last=s.cursor;const ids=new Set();
    for(const e of input.events){
      if(!e||typeof e.id!=='string'||e.id.length>150||ids.has(e.id)||e.at<last||!frames(d,s).includes(e.at))throw Error('Invalid paper event chronology.');
      ids.add(e.id);last=e.at;
      const clean={id:e.id,at:e.at,kind:e.kind,settings:settings(e.settings)};
      if(e.kind==='order')clean.spec=contract(e.spec);
      else if(e.kind==='risk'){clean.positionId=e.positionId;clean.spec=riskSpec(e.spec);}
      else if(e.kind==='exit'){clean.positionId=e.positionId;if(e.lots!==undefined)clean.lots=e.lots;if(e.exitPrice!==undefined)clean.exitPrice=Number(e.exitPrice);}
      else if(e.kind==='cancel')clean.orderId=e.orderId;
      else if(e.kind==='toggle'){clean.positionId=e.positionId;clean.enabled=Boolean(e.enabled);}
      else if(e.kind==='modify'){clean.positionId=e.positionId;clean.spec=modifySpec(e.spec);}
      else if(e.kind==='remove')clean.positionId=e.positionId;
      else throw Error('Invalid paper event type.');
      s={...s,events:s.events.concat(clean)};
    }
    if(!frames(d,s).includes(input.frontier)||!frames(d,s).includes(input.cursor)||input.frontier<last||input.cursor>input.frontier)throw Error('Invalid paper backup cursor.');
    s={...s,cursor:input.cursor,frontier:input.frontier};
    const rebuilt=materialize(d,s);
    if(JSON.stringify(rebuilt.fills)!==JSON.stringify(input.fills))throw Error('Stored fills differ from replayed observed prices, fees or quantities.');
    return rebuilt;
  }
  return {create,order,cancel,exit,toggle,modify,remove,risk,advance,seek:advance,branch,valuation,analytics,journal,restore,frames};
});

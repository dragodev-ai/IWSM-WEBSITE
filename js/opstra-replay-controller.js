/* Reference-style UI adapter. All fills and marks come from the validated observation ledger. */
(function(root){
'use strict';
root.IWSMOpstraReplay={install(host){
  if(host.dataset.replayMounted)return;
  host.dataset.replayMounted='true';
  const M=root.IWSMSimulator,P=root.IWSMPaperExecution,C=root.IWSMCandleModel,A=root.IWSMPaperAnalysis,E=root.IWSMStrategy,Q=root.IWSMResearch,Store=root.IWSMStudyStore;
  const el=id=>host.querySelector('#opstra-'+id);
  const esc=x=>String(x??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const num=x=>Number.isFinite(x)?x.toLocaleString('en-IN',{maximumFractionDigits:2}):'Unavailable';
  const money=x=>x===Infinity?'Unlimited':Number.isFinite(x)?'₹ '+num(x):'Unavailable';
  const options=(values,current)=>values.map(x=>'<option value="'+esc(x)+'" '+(x===current?'selected':'')+'>'+esc(x)+'</option>').join('');
  const table=(headers,rows)=>'<div class="opstra-table-container"><table class="opstra-chain-table"><thead><tr>'+headers.map(x=>'<th scope="col">'+esc(x)+'</th>').join('')+'</tr></thead><tbody>'+rows.map(row=>'<tr>'+row.map(x=>'<td>'+x+'</td>').join('')+'</tr>').join('')+'</tbody></table></div>';
  let d=null,s=null,bundle=null,db=null,saveQueue=Promise.resolve(),generation=0,timer=null,viewExpiry='',payoffDate='',activeTab='payoff',basis='spot',recording=false,modal=null,chainRows=[],symbols=['NIFTY'],archiveDates=[],symbolDates={},loading=false;
  const settings={initialBalance:1000000,feePerOrder:20,feeBps:0,slippage:0,marginRate:.2,rate:6,dividend:0};
  const status=document.createElement('p');status.className='opstra-status';status.id='opstra-status';status.setAttribute('role','status');status.setAttribute('aria-live','polite');el('simulator-root').querySelector('header').after(status);
  const source=document.createElement('p');source.className='opstra-source-note';source.id='opstra-source-note';status.after(source);source.hidden=true;
  const playbackHelp=document.createElement('div');playbackHelp.className='opstra-playback-help';playbackHelp.innerHTML='<p id="opstra-playback-explanation" role="status"></p><button type="button" id="opstra-load-replay">Load minute history</button>';host.querySelector('.opstra-clock-row').after(playbackHelp);
  const browse=document.createElement('div');browse.className='opstra-data-actions';browse.innerHTML='<label>Archive year<select id="opstra-archive-year" aria-label="Archive year"></select></label><label>Month<select id="opstra-archive-month" aria-label="Archive month"></select></label><button id="opstra-browse-expiries">Browse historical expiries</button><button id="opstra-minute-source">Load minute data</button><small id="opstra-resolution-note"></small>';browse.hidden=true;host.querySelector('.opstra-expiry-row').after(browse);
  const clockTools=host.querySelector('.opstra-clock-row').firstElementChild;
  clockTools.innerHTML='<label>Replay date <input id="opstra-replay-date" type="date"></label><label>Time (IST) <select id="opstra-observed-time" aria-label="Observed time IST"></select></label>';
  const tools=document.createElement('details');tools.className='opstra-history-tools';tools.innerHTML='<summary>Account, orders & journal</summary><div id="opstra-account"></div><div class="opstra-data-actions"><button id="opstra-branch">Branch here</button><button id="opstra-export">Export study</button><button id="opstra-save-candles" hidden>Save candles to local library</button><label>Restore study<input type="file" id="opstra-restore" accept=".json"></label><button id="opstra-journal-export">Export journal CSV</button></div><div id="opstra-orders"></div><div id="opstra-journal"></div>';tools.hidden=true;el('simulator-root').append(tools);
  for(const name of ['start-date','payoff-date']){el(name).type='date';el(name).removeAttribute('readonly');el(name).setAttribute('aria-label',name==='start-date'?'Select Start Date':'Select Pay-off Date');}
  el('basis-toggle').setAttribute('aria-label','Use futures reference');
  function msg(text){status.textContent=text;}
  function pause(){clearInterval(timer);timer=null;el('btn-play').textContent=d&&s&&P.frames(d,s).length>1&&s.cursor===P.frames(d,s).at(-1)?'↻ REPLAY':'▶ PLAY';el('btn-play').setAttribute('aria-pressed','false');}
  function guard(fn){return async(...args)=>{try{await fn(...args);}catch(e){pause();msg(e.message);}};}
  function serial(){return {format:'iwsm-paper-v1',name:s.symbol+' · '+s.cursor,dataset:M.exportDataset(d),bundle,session:s,savedAt:Date.now()};}
  function persist(){if(!s||!db)return Promise.resolve();const raw=serial();saveQueue=saveQueue.catch(()=>{}).then(()=>db.save(raw));saveQueue.catch(e=>msg(e.message));return saveQueue;}
  function download(name,text,type='application/json'){const a=document.createElement('a');a.href=URL.createObjectURL(new Blob([text],{type}));a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(a.href),1000);}
  function close(){if(modal){modal.close();modal.remove();modal=null;}}
  function dialog(title,content){pause();close();modal=document.createElement('dialog');modal.className='opstra-dialog';modal.innerHTML='<header><h2>'+esc(title)+'</h2><button type="button" aria-label="Close '+esc(title)+'">×</button></header><div class="opstra-dialog-body">'+content+'</div>';el('modal-container').append(modal);modal.querySelector('header button').onclick=close;modal.addEventListener('cancel',()=>{const old=modal;modal=null;old.remove();});modal.showModal();return modal;}
  function adopt(raw,b=null,session=null){const next=M.prepareDataset(raw),state=session?P.restore(next,session):P.create(next,settings);pause();generation++;if(s)persist();d=next;s=state;bundle=b;viewExpiry='';payoffDate='';basis='spot';el('basis-toggle').checked=false;
    if(!session&&d.kind!=='daily'){
      const at=P.frames(d,s).find(t=>Number.isFinite(d.spots.get(s.symbol+'|'+t))&&(d.byFrame.get(s.symbol+'|'+t)||[]).some(q=>q.type!=='FUT'&&q.volume!==0&&q.lotSize>0));
      if(at&&at!==s.cursor)s=P.advance(d,s,at);
    }
    render();persist();}
  function restore(raw){const v=Store.validate(raw);adopt(v.dataset,v.bundle,v.session);msg('Saved simulation restored at '+s.cursor.replace('T',' ')+' IST.');}
  function change(next){generation++;s=next;render();persist();}
  function resolution(){if(bundle)return bundle.intervalMinutes;const frames=P.frames(d,s);let min=Infinity;for(let i=1;i<frames.length;i++)if(frames[i].slice(0,10)===frames[i-1].slice(0,10))min=Math.min(min,(M.instant(frames[i])-M.instant(frames[i-1]))/60000);return Number.isFinite(min)?min:1;}
  function frameStep(minutes){
    if(!s)return;const dir=Math.sign(minutes),amount=Math.abs(minutes),base=resolution();
    if(amount!==1440&&(d.kind==='daily'||amount<base||amount%base!==0))throw Error('This source has '+(d.kind==='daily'?'daily':base+'-minute')+' observations. Import actual minute candles for finer replay.');
    const frames=P.frames(d,s);const target=amount!==1440&&![1,5,15,30,60,120].includes(amount)?frames[Math.max(0,Math.min(frames.length-1,frames.indexOf(s.cursor)+dir))]:M.step(d,s,dir,amount===1440?'day':amount).cursor;
    if(target===s.cursor){pause();msg('Reached the last available observation in this direction.');return;}
    change(P.advance(d,s,target));
    if(s.cursor===frames.at(-1))pause();
    msg('Replay '+s.cursor.replace('T',' ')+' IST'+(recording?' · Recorded to this browser.':''));
  }
  async function jsonResponse(r){if(!(r.headers.get('content-type')||'').includes('application/json'))throw Error('The recorded library requires the local preview backend. Import candles or restore a study on static hosting.');const j=await r.json();if(!r.ok||j.success===false)throw Error(j.error||'Data could not be loaded.');return j;}
  async function loadRecorded(symbol,start,end){
    pause();const request=++generation;msg('Loading '+symbol.toUpperCase()+' data; downloading missing daily reports if available…');const q=new URLSearchParams({mode:'load',symbol:symbol.toUpperCase(),start,end});
    const j=await jsonResponse(await fetch('/api/nse-library?'+q));if(request!==generation)return;
    adopt(j.dataset||j.data||j);close();msg('Recorded daily closes loaded. Minute controls require intraday observations.');
  }
  function greeks(q,spot){if(!q||!Number.isFinite(spot))return {iv:null,g:null};const days=Math.max(0,(Date.parse(q.expiry+'T15:30:00+05:30')-M.instant(s.cursor))/86400000),rate=(d.metadata.rate??s.settings.rate)/100,div=(d.metadata.dividend??s.settings.dividend)/100;const iv=d.metadata.modelled?d.metadata.iv/100:Q.impliedVolatility(q.type,spot,q.strike,days,q.close,rate,div);return {iv,g:iv===null?null:E.greeks(q.type,spot,q.strike,days,iv,rate,div)};}
  function analysis(){const open=P.valuation(d,s).positions.filter(p=>!p.closed),first=open.map(p=>p.expiry).sort()[0];if(first&&(!payoffDate||payoffDate<s.cursor.slice(0,10)||payoffDate>first))payoffDate=first;return A.analyze(d,s,{basis,expiry:viewExpiry,...(first&&payoffDate?{payoffDate}:{})});}
  function renderChart(a){
    const box=el('chart-container'),v=P.valuation(d,s);host.querySelectorAll('.opstra-tab-btn').forEach(b=>{b.classList.toggle('active',b.dataset.tab===activeTab);b.setAttribute('aria-pressed',String(b.dataset.tab===activeTab));});
    if(activeTab==='payoff'){root.IWSMPaperChart.render(box,a,{cursor:s.cursor,symbol:s.symbol,startDate:s.start});return;}
    if(activeTab==='greeks'){box.innerHTML=a.empty?'<p class="opstra-empty">'+esc(a.reason)+'</p>':table(['Position','IV %','Delta','Theta / day','Gamma','Vega'],a.rows.map(r=>[esc(r.type+' '+r.strike+' / '+r.expiry),num(r.iv),...['delta','theta','gamma','vega'].map(k=>r.greeks?num(r.greeks[k]*r.units*r.side):'Unavailable')]))+'<p>Position sensitivities include direction and remaining units. Vega is per percentage point.</p>';return;}
    box.innerHTML=table(['Position','Entry','Current','Exit','Net P&L'],v.positions.map(p=>[esc(p.type+' '+p.strike+' / '+p.expiry),money(p.entry),p.closed?'—':money(p.mark),p.closed?money(p.exit):'—',money(p.net)]))+'<p>Total '+money(v.net)+' · Costs '+money(v.costs)+'</p>';
  }
  function render(){
    if(!s)return;host.querySelector('.opstra-middle-section').hidden=!s.events.some(e=>e.kind==='order'||e.type==='order')&&!P.valuation(d,s).positions.length;const all=d.byFrame.get(s.symbol+'|'+s.cursor)||[],expiries=[...new Set(d.contracts.filter(q=>q.symbol===s.symbol&&q.type!=='FUT').map(q=>q.expiry))].sort();if(!expiries.includes(viewExpiry))viewExpiry=expiries[0]||'';chainRows=all.filter(q=>q.expiry===viewExpiry);
    const spot=d.spots.get(s.symbol+'|'+s.cursor),future=currentFuture(),v=P.valuation(d,s),a=analysis(),frames=P.frames(d,s),base=resolution();
    const playback=root.IWSMSimulatorPlayback.describe({kind:d.kind,frames,cursor:s.cursor,exchange:d.metadata.exchange,base});
    el('playback-explanation').textContent=playback.notice;el('load-replay').textContent=playback.action;
    el('load-replay').hidden=!playback.single&&d.kind!=='daily';
    el('resolution-note').textContent=d.kind==='daily'?'Daily source: 1m/5m prices are unavailable. Load minute observations to enable them.':'Minute replay uses the loaded observations.';
    el('symbol-select').innerHTML=instrumentOptions(s.symbol,d.metadata.exchange||'nse_fo');el('symbol-select').disabled=loading;el('expiry-select').innerHTML='<option value="__browse__">Browse previous expiries…</option>'+options(expiries,viewExpiry);
    el('val-spot').textContent=num(spot);el('val-future').textContent=el('chain-fut-price').textContent=num(future?.close);el('chain-fut-price').title=future?'Futures expiry '+future.expiry:'';el('val-lot').textContent=num(chainRows[0]?.lotSize);el('val-iv').textContent=num(d.metadata.modelled?d.metadata.iv:null);
    el('btn-iv-chart').textContent=s.symbol+' IV Chart';el('chart-title').textContent=s.symbol;el('start-date').value=s.start;el('payoff-date').value=payoffDate||viewExpiry;el('payoff-date').min=s.cursor.slice(0,10);el('payoff-date').max=a.expiry||viewExpiry;
    el('chain-title').textContent=viewExpiry+' · Option Chain';el('sim-clock').textContent=s.cursor.replace('T',' ')+' IST';el('replay-date').value=s.cursor.slice(0,10);el('replay-date').min=s.start;el('replay-date').max=s.end;
    el('observed-time').innerHTML=options(frames.filter(t=>t.startsWith(s.cursor.slice(0,10))).map(t=>t.slice(11)),s.cursor.slice(11));
    const supported=playback.supported,old=+el('timeframe').value;el('timeframe').innerHTML=playback.single?'<option value="">Single snapshot</option>':[1,5,15,30,60,120,1440].map(n=>'<option value="'+n+'" '+(!supported.includes(n)?'disabled':'')+'>'+ (n===1440?'1 Day':n+' Min')+'</option>').join('');if(!playback.single)el('timeframe').value=String(supported.includes(old)?old:supported[0]);el('timeframe').disabled=el('speed').disabled=playback.single;
    host.querySelectorAll('[data-mins]').forEach(b=>{const n=+b.dataset.mins,amount=Math.abs(n);b.disabled=(n<0?s.cursor===frames[0]:s.cursor===frames.at(-1))||(amount!==1440&&(d.kind==='daily'||amount<base||amount%base!==0));b.title=playback.single?playback.notice:amount!==1440&&d.kind==='daily'?'Daily closes only. Import actual intraday candles for minute replay.':'';b.setAttribute('aria-label',(n<0?'Back ':'Forward ')+(amount===1440?'1 day':amount+' minutes'));});
    el('btn-play').disabled=!playback.canPlay;el('btn-play').title=playback.notice;if(!timer)el('btn-play').textContent=playback.restart?'↻ REPLAY':'▶ PLAY';el('btn-fut-buy').disabled=el('btn-fut-sell').disabled=!future;
    source.textContent=(d.metadata.modelled?'MODEL PREMIUMS · ':'RECORDED OPTION QUOTES · ')+((bundle?.synthetic||d.metadata.synthetic)?'SYNTHETIC TEACHING DATA · ':'')+d.source.replace(/\bNSE\b/gi,'recorded')+' · '+(d.kind==='daily'?'Daily closes':base+'-minute observations')+' · Fees '+money(s.settings.feePerOrder)+'/fill'+(s.cursor<s.frontier?' · Review mode: Branch here before editing.':'');
    source.hidden=!d.metadata.backup;
    if(d.metadata.backup)source.textContent='LOCAL NIFTY BACKUP · '+(d.kind==='daily'?'Recorded daily close · minute replay unavailable':'Saved '+(d.metadata.backupResolution||'recorded')+' prices')+' · '+s.cursor.replace('T',' ')+' IST';
    el('positions-list').innerHTML=v.positions.map((p,i)=>'<div class="opstra-position-row"><div><strong class="opstra-pos-name">'+esc((p.side===1?'+':'−')+p.remainingLots+'x '+p.expiry+' '+(p.type==='FUT'?'FUT':p.strike+p.type))+'</strong><small>Entry '+money(p.entry)+' · '+(p.closed?'Closed':('Current '+money(p.mark)))+' · '+money(p.net)+'</small></div>'+(p.closed?'':'<div class="opstra-pos-actions"><button data-position="'+i+'" data-act="risk">Risk / Exit</button><button data-position="'+i+'" data-act="reverse">Reverse</button></div>')+'</div>').join('')||'<p class="opstra-empty">Choose BUY/SELL in the option chain to add a paper position.</p>';
    const risk=a.risk;el('metric-maxprofit').textContent=money(risk?.maxProfit);el('metric-maxloss').textContent=money(risk?.maxLoss);el('metric-breakevens').textContent=risk?.breaks?.map(num).join(', ')||'Unavailable';el('metric-totalpnl').textContent=el('strip-pnl').textContent=money(v.net);
    for(const k of ['delta','theta','gamma','vega'])el('pos-'+k).textContent=num(a.total?.[k]);
    const strikes=[...new Set(chainRows.filter(q=>q.type!=='FUT').map(q=>q.strike))].sort((a,b)=>a-b);
    function cells(q,type){if(!q)return ['—','—','—','—','—'];const g=greeks(q,spot),idx=chainRows.indexOf(q);return ['<button class="opstra-btn-chain '+(type==='CE'?'opstra-btn-chain-call':'opstra-btn-chain-put')+'" data-quote="'+idx+'" '+(q.volume===0?'disabled':'')+' aria-label="Buy or sell '+q.strike+' '+q.type+'">BUY/SELL</button>',num(q.oi),num(q.close),g.iv===null?'—':num(g.iv*100),g.g?num(g.g.delta):'—'];}
    el('chain-body').innerHTML=strikes.map(k=>{const c=cells(chainRows.find(q=>q.type==='CE'&&q.strike===k),'CE'),p=cells(chainRows.find(q=>q.type==='PE'&&q.strike===k),'PE');return '<tr>'+[...c,'<strong>'+num(k)+'</strong>',p[4],p[3],p[2],p[1],p[0]].map((x,i)=>'<td'+(i===5?' class="opstra-td-strike"':'')+'>'+x+'</td>').join('')+'</tr>';}).join('');
    el('save-candles').hidden=!bundle||bundle.synthetic===true;renderChart(a);renderTools(v);
  }
  function renderTools(v){
    el('account').innerHTML=table(['Equity','Available','Realized gross','Unrealized gross','Costs','Net','Est. margin'],[[v.equity,v.available,v.realized,v.unrealized,v.costs,v.net,v.margin].map(money)]);
    el('orders').innerHTML='<h3>Orders</h3>'+table(['Submitted IST','Contract','Order','Status','Details'],v.orders.map((o,i)=>[esc(o.at),esc(o.type+' '+o.strike),esc(o.orderType),esc(o.status),o.status==='pending'?'<button data-cancel="'+i+'">Cancel</button>':esc(o.reason||o.fillAt||o.cancelAt)]));
    el('journal').innerHTML='<h3>Journal</h3>'+table(['Opened IST','Closed IST','Contract','Entry','Exit / mark','Net','Status'],P.journal(d,s).map(p=>[esc(p.openAt),esc(p.closeAt||'—'),esc(p.type+' '+p.strike),money(p.entry),money(p.price??p.mark),money(p.net),esc(p.status)]));
  }
  function ticket(q,side=1){
    if(!q)throw Error('Exact quote unavailable.');const dom=dialog('Add Position','<p>'+esc(s.symbol+' '+q.expiry+' '+q.strike+q.type)+'</p><form class="opstra-simple-ticket"><label>Entry Price<input name="premium" type="number" value="'+q.close+'" readonly></label><div class="opstra-ticket-row"><button type="button" data-side="1">BUY</button><button type="button" data-side="-1">SELL</button><button type="button" data-lots="-1" aria-label="Decrease ticket lots">−</button><input name="lots" type="number" min="1" max="1000" aria-label="Position lots" value="'+esc(el('chain-lots').value)+'" required><button type="button" data-lots="1" aria-label="Increase ticket lots">+</button></div><button type="submit">ADD POSITION</button></form>');
    const f=dom.querySelector('form');function choose(n){side=n;f.querySelectorAll('[data-side]').forEach(b=>{b.classList.toggle('selected',+b.dataset.side===side);b.setAttribute('aria-pressed',String(+b.dataset.side===side));});}choose(side);
    f.onclick=e=>{if(e.target.dataset.side)choose(+e.target.dataset.side);if(e.target.dataset.lots)f.elements.lots.value=Math.max(1,Math.min(1000,+f.elements.lots.value + +e.target.dataset.lots));};
    f.onsubmit=guard(e=>{e.preventDefault();if(s.cursor<s.frontier){s=P.branch(d,s);}
      const next=P.order(d,s,{type:q.type,expiry:q.expiry,strike:q.strike,side,lots:+f.elements.lots.value,orderType:'market'}),last=P.valuation(d,next).orders.at(-1);if(last.status==='rejected'){change(next);throw Error(last.reason);}change(next);close();msg('Position added at '+s.cursor.replace('T',' ')+' IST.');});
  }
  function editAtCursor(){if(s.cursor<s.frontier)s=P.branch(d,s);}
  function riskDialog(p){
    const dom=dialog('Manage Position','<p>'+esc(p.expiry+' '+p.strike+p.type)+' · Entry '+money(p.entry)+' · Current '+money(p.mark)+'</p><form><div class="opstra-fields"><label>Stop premium<input name="stopLoss" type="number" min="0" step="any" value="'+(p.risk.stopLoss??'')+'"></label><label>Target premium<input name="target" type="number" min="0" step="any" value="'+(p.risk.target??'')+'"></label><label>Trailing distance<input name="trailing" type="number" min=".01" step="any" value="'+(p.risk.trailing??'')+'"></label><label>Exit lots<input name="lots" type="number" min="1" max="'+p.remainingLots+'" value="'+p.remainingLots+'"></label></div><p>Risk rules execute at later observed closes. Intrabar crossings are not inferred.</p><button name="risk" type="submit">Apply risk rules</button><button name="exit" type="submit">Exit lots now</button></form>');
    const f=dom.querySelector('form');f.onsubmit=guard(e=>{e.preventDefault();editAtCursor();change(e.submitter.name==='exit'?P.exit(d,s,p.id,+f.elements.lots.value):P.risk(d,s,p.id,Object.fromEntries(['stopLoss','target','trailing'].map(k=>[k,f.elements[k].value===''?null:+f.elements[k].value]))));close();msg('Position updated at the replay close.');});
  }
  function model(b,values){
    const step=+values.strikeStep;if(!(step>0))throw Error('Strike interval must be positive.');const anchor=Math.round(b.candles[0].close/step)*step;
    const raw=C.buildDataset(b,{symbol:b.candles[0].symbol,expiries:values.expiries.split(',').map(x=>x.trim()).filter(Boolean),strikes:Array.from({length:21},(_,i)=>anchor+(i-10)*step).filter(x=>x>0),lotSize:+values.lotSize,iv:+values.iv,rate:settings.rate,dividend:settings.dividend,includeFutures:true});adopt(raw,b);close();msg('Underlying candles loaded; option premiums are model estimates.');
  }
  const catalogue=root.IWSMSimulatorCatalogue;
  let browserStorage=null;try{browserStorage=root.localStorage;}catch{}
  let brokerInstruments=catalogue?.read(browserStorage)||[],catalogueTask=null,catalogueAt=0;
  function instrumentChoice(value){const [exchange,symbol]=value.includes('|')?value.split('|'):['nse_fo',value];return {exchange,symbol};}
  function instrumentOptions(symbol,exchange='nse_fo'){
    const selected=exchange+'|'+symbol;let html='';const seen=new Set();
    for(const [code,title,kind] of [['nse_fo','NSE Indices','index'],['nse_fo','NSE Stocks','stock'],['bse_fo','BSE Indices','index'],['bse_fo','BSE Stocks','stock']]){
      const rows=brokerInstruments.filter(x=>x.exchange===code&&x.kind===kind);if(!rows.length)continue;
      html+='<optgroup label="'+title+'">'+rows.map(x=>{const key=x.exchange+'|'+x.symbol;seen.add(key);return '<option value="'+esc(key)+'" '+(key===selected?'selected':'')+(x.chainAvailable===false?' disabled':'')+'>'+esc(x.symbol+(x.chainAvailable===false?' · chain unavailable':''))+'</option>';}).join('')+'</optgroup>';
    }
    const archive=[...new Set([...symbols,...(d?.symbols||[])])].filter(x=>!seen.has('nse_fo|'+x));
    if(archive.length)html+='<optgroup label="Historical archive only">'+archive.sort().map(x=>'<option value="nse_fo|'+esc(x)+'" '+('nse_fo|'+x===selected?'selected':'')+'>'+esc(x)+'</option>').join('')+'</optgroup>';
    return html||'<option value="nse_fo|NIFTY">Loading Alice Blue instruments…</option>';
  }
  async function refreshInstruments(){
    if(catalogueTask&&Date.now()-catalogueAt>300000)catalogueTask=null;
    if(!catalogueTask){catalogueAt=Date.now();catalogueTask=brokerApi('instruments').then(j=>{
      if(!Array.isArray(j.instruments)||!j.instruments.length)throw Error('Broker instrument catalogue is empty');
      brokerInstruments=j.instruments;catalogue?.save(browserStorage,brokerInstruments);return j;
    }).catch(e=>{catalogueTask=null;throw e;});}
    return catalogueTask;
  }
  async function brokerApi(path){const r=await fetch('/api/aliceblue/'+path,{credentials:'same-origin',signal:AbortSignal.timeout(120000)});if(!(r.headers.get('content-type')||'').includes('application/json'))throw Error('Live broker data requires the connected data backend.');const j=await r.json();if(!r.ok)throw Error(j.detail||'Broker data unavailable');return j;}
  function newSimulation(preferred){
    generation++;pause();const selected=instrumentChoice(preferred||((d?.metadata.exchange||'nse_fo')+'|'+(s?.symbol||'NIFTY'))),now=new Date(Date.now()+19800000).toISOString().slice(0,10),prior=new Date(now+'T00:00Z');prior.setUTCDate(prior.getUTCDate()-1);const day=prior.toISOString().slice(0,10);
    const dom=dialog('New Simulation','<form><div class="opstra-fields"><label>Index / Stock<select name="symbol" required>'+instrumentOptions(selected.symbol,selected.exchange)+'</select></label><label>Data<select name="data"><option value="minute">Recorded minute prices</option><option value="snapshot">Latest option-chain snapshot</option><option value="daily">Historical daily archive</option></select></label><label class="history-date">Start Date<input name="start" type="date" value="'+day+'" required></label><label class="history-date">End Date<input name="end" type="date" value="'+now+'" required></label><label class="broker-expiry">Expiry<select name="expiry"></select></label></div><p class="opstra-dialog-status" role="status"></p><button type="button" class="connect-broker" hidden>Connect Alice Blue</button><button type="submit">Start Simulation</button></form>');
    const f=dom.querySelector('form'),note=dom.querySelector('[role=status]'),connect=dom.querySelector('.connect-broker');let request=0;
    connect.onclick=guard(async()=>{const r=await fetch('/api/aliceblue/auth/login',{method:'POST',credentials:'same-origin'}),j=await r.json();if(!r.ok)throw Error(j.detail||'Connection unavailable');location.assign(j.loginUrl);});
    async function expiries(){const n=++request,choice=instrumentChoice(f.elements.symbol.value),mode=f.elements.data.value;f.querySelector('.broker-expiry').hidden=mode==='daily';f.querySelectorAll('.history-date').forEach(x=>x.hidden=mode==='snapshot');connect.hidden=true;f.elements.expiry.innerHTML='';f.querySelector('[type=submit]').disabled=true;
      if(mode==='daily'){note.textContent=choice.exchange==='bse_fo'?'BSE daily archives are not connected. Choose the latest broker snapshot.':'Older expiry records contain daily closes. Minute steps require minute observations.';f.querySelector('[type=submit]').disabled=choice.exchange==='bse_fo';return;}
      note.textContent='Loading '+choice.symbol+' expiries…';try{const j=await brokerApi('expiries?'+new URLSearchParams({underlying:choice.symbol,exch:choice.exchange,...(mode!=='snapshot'?{start:f.elements.start.value,end:f.elements.end.value}:{})}));if(n!==request||!f.isConnected)return;f.elements.expiry.innerHTML=options(j.expiries,j.expiries[0]);note.textContent=j.backup?'Local NIFTY daily backup available. Fallback loads are labelled with their recorded date.':mode==='snapshot'?'Alice Blue connected · Latest broker prices; snapshots have no historical minute replay.':'Alice Blue connected · Completed minute closes · up to 7 calendar days · current-expiry contracts.';f.querySelector('[type=submit]').disabled=!j.expiries.length;}catch(e){if(n!==request)return;note.textContent=e.message;connect.hidden=!/connect|account|session|authentication/i.test(e.message);}}
    f.elements.symbol.onchange=expiries;f.elements.data.onchange=expiries;f.elements.start.onchange=expiries;f.elements.end.onchange=expiries;if(brokerInstruments.length&&!brokerInstruments.some(x=>x.symbol===selected.symbol&&x.exchange===selected.exchange))f.elements.data.value='daily';
    expiries();refreshInstruments().then(()=>{if(!f.isConnected)return;const current=instrumentChoice(f.elements.symbol.value);f.elements.symbol.innerHTML=instrumentOptions(current.symbol,current.exchange);}).catch(e=>{if(f.isConnected&&!brokerInstruments.length)note.textContent=e.message+' · Retry New Simulation to reload the catalogue.';});
    f.onsubmit=guard(async e=>{e.preventDefault();const values=Object.fromEntries(new FormData(f)),choice=instrumentChoice(values.symbol);if(values.data==='daily'){await loadRecorded(choice.symbol,values.start,values.end);return;}const n=++generation;f.querySelector('[type=submit]').disabled=true;note.textContent='Loading Alice Blue prices…';try{const j=await brokerApi((values.data==='snapshot'?'snapshot?':'replay?')+new URLSearchParams({underlying:choice.symbol,expiry:values.expiry,start:values.start,end:values.end,exch:choice.exchange}));if(n!==generation)return;adopt(j.dataset);close();msg((j.backup?j.notice:values.data==='snapshot'?'Latest option-chain snapshot loaded · no minute history in this snapshot.':'Recorded minute prices loaded · '+s.cursor.replace('T',' ')+' IST.')+(j.dataset.metadata?.warnings?.length?' '+j.dataset.metadata.warnings.join('. ')+'.':''));}catch(e){note.textContent=e.message;msg(e.message);}finally{if(f.isConnected)f.querySelector('[type=submit]').disabled=false;}});
  }
  el('btn-new').onclick=()=>newSimulation();
  el('btn-simulations').onclick=guard(async()=>{generation++;pause();await saveQueue.catch(()=>{});if(!db)throw Error('Browser study storage unavailable. Restore a JSON backup instead.');const rows=await db.list(),dom=dialog('Simulations',rows.map((x,i)=>'<button data-study="'+i+'">'+esc(x.name)+'</button>').join('')||'<p>No saved simulations yet.</p>');dom.onclick=guard(e=>{if(e.target.dataset.study!==undefined){restore(rows[+e.target.dataset.study]);close();}});});
  el('btn-liquidity').onclick=()=>dialog('Liquidity Guidelines','<p>Orders fill only at exact recorded or modeled closes. Zero recorded volume blocks execution; missing quotes remain unavailable.</p><p>Minute replay requires intraday observations. Limits, targets and stops use later observed closes, with no inferred intrabar fills.</p><p>Fees, slippage and configurable paper margin apply. Margin is an estimate, not exchange SPAN. Model premiums and synthetic candles are labelled.</p>');
  el('btn-record').onclick=guard(async()=>{recording=!recording;await persist();el('btn-record').textContent=recording?'■ STOP RECORDING':'● RECORD SIMULATION';el('btn-record').setAttribute('aria-pressed',String(recording));msg(recording?'Simulation is recorded locally as you replay. Open Simulations to restore it.':'Recording stopped. Your study remains saved in this browser.');});
  el('btn-reset').onclick=guard(()=>{pause();persist();change(P.create(d,{symbol:s.symbol,start:s.start,end:s.end,...s.settings}));msg('New empty simulation. The previous study remains saved.');});
  el('btn-strategies').onclick=()=>{const dom=dialog('Strategies','<div class="opstra-data-actions" id="opstra-categories"><button data-outlook="Bullish">Bullish</button><button data-outlook="Bearish">Bearish</button><button data-outlook="Neutral">Non-directional</button></div><form><div class="opstra-fields"><label>Strategy<select name="template">'+E.templates.map((t,i)=>'<option value="'+i+'">'+esc(t.name)+'</option>').join('')+'</select></label><label>Lots<input name="lots" type="number" min="1" value="1"></label></div><p>All legs use the selected expiry '+esc(viewExpiry)+' and exact available strikes. Missing legs reject the whole strategy.</p><button type="submit">Add strategy</button></form>');const f=dom.querySelector('form');el('categories').onclick=e=>{if(e.target.dataset.outlook)f.elements.template.innerHTML=E.templates.map((t,i)=>({t,i})).filter(x=>x.t.outlook===e.target.dataset.outlook).map(({t,i})=>'<option value="'+i+'">'+esc(t.name)+'</option>').join('');};f.onsubmit=guard(e=>{e.preventDefault();editAtCursor();change(root.IWSMPaperTemplates.apply(d,s,{index:+f.elements.template.value,lots:+f.elements.lots.value,expiry:viewExpiry}));close();msg('Strategy added at the replay close.');});};

  el('btn-iv-chart').onclick=()=>{const spot=d.spots.get(s.symbol+'|'+s.cursor),opts=chainRows.filter(q=>q.type==='CE'),q=opts.sort((a,b)=>Math.abs(a.strike-spot)-Math.abs(b.strike-spot))[0];if(!q){msg('Select an available option expiry first.');return;}const rows=P.frames(d,s).filter(t=>t<=s.cursor).map(t=>{const row=d.records.get([s.symbol,t,q.expiry,q.type,q.strike].join('|')),sp=d.spots.get(s.symbol+'|'+t),days=Math.max(0,(Date.parse(q.expiry+'T15:30:00+05:30')-M.instant(t))/86400000),iv=d.metadata.modelled?d.metadata.iv:row&&Number.isFinite(sp)?((x)=>x===null?null:x*100)(Q.impliedVolatility(q.type,sp,q.strike,days,row.close,s.settings.rate/100,s.settings.dividend/100)):null;return [esc(t),num(sp),num(iv)];});dialog(s.symbol+' IV History','<p>'+esc(q.expiry+' '+q.strike+q.type)+' · '+(d.metadata.modelled?'Fixed model IV assumption.':'IV inferred from recorded closes; missing values stay unavailable.')+'</p>'+table(['Observed IST','Underlying','IV %'],rows));};
  el('btn-get-chain').onclick=()=>{const x=el('chain-section');x.hidden=!x.hidden;el('btn-get-chain').setAttribute('aria-expanded',String(!x.hidden));};
  el('chain-body').onclick=guard(e=>{const b=e.target.closest('[data-quote]');if(b)ticket(chainRows[+b.dataset.quote]);});
  el('positions-list').onclick=guard(e=>{const b=e.target.closest('[data-position]');if(!b)return;const p=P.valuation(d,s).positions[+b.dataset.position];if(b.dataset.act==='risk'){if(p.expiry<s.cursor.slice(0,10)){const at=P.frames(d,s).filter(t=>t.slice(0,10)<=p.expiry&&d.records.has([s.symbol,t,p.expiry,p.type,p.type==='FUT'?0:p.strike].join('|'))).at(-1);if(!at)throw Error('Load the original expiry window from Simulations to manage this position.');change(P.advance(d,s,at));msg('Returned to the last recorded quote before expiry. Branch here before editing this earlier history.');}else riskDialog(p);}else{editAtCursor();let next=P.exit(d,s,p.id);next=P.order(d,next,{type:p.type,expiry:p.expiry,strike:p.strike,side:-p.side,lots:p.remainingLots});const order=P.valuation(d,next).orders.at(-1);if(order.status==='rejected')throw Error(order.reason);change(next);}});
  function currentFuture(){return (d?.byFrame.get(s.symbol+'|'+s.cursor)||[]).filter(q=>q.type==='FUT'&&q.expiry>=s.cursor.slice(0,10)).sort((a,b)=>a.expiry.localeCompare(b.expiry))[0];}
  for(const [id,side]of [['btn-fut-buy',1],['btn-fut-sell',-1]])el(id).onclick=guard(()=>ticket(currentFuture(),side));
  for(const [id,dir]of [['lot-minus',-1],['lot-plus',1]])el(id).onclick=()=>el('chain-lots').value=Math.max(1,Math.min(1000,(+el('chain-lots').value||1)+dir));
  host.querySelectorAll('[data-mins]').forEach(b=>b.onclick=guard(()=>{pause();frameStep(+b.dataset.mins);}));
  el('load-replay').onclick=()=>newSimulation((d.metadata.exchange||'nse_fo')+'|'+s.symbol);
  el('btn-play').onclick=()=>{if(timer){pause();return;}const frames=P.frames(d,s);if(frames.length<2){msg('Load a recorded minute window before starting replay.');return;}if(s.cursor===frames.at(-1))change(P.advance(d,s,frames[0]));el('btn-play').textContent='Ⅱ PAUSE';el('btn-play').setAttribute('aria-pressed','true');timer=setInterval(guard(()=>frameStep(+el('timeframe').value)),+el('speed').value);};
  el('timeframe').onchange=pause;el('speed').onchange=()=>{const was=timer;pause();if(was)el('btn-play').click();};
  host.querySelectorAll('.opstra-tab-btn').forEach(b=>b.onclick=()=>{activeTab=b.dataset.tab;renderChart(analysis());});
  el('basis-toggle').onchange=()=>{basis=el('basis-toggle').checked?'future':'spot';render();};el('btn-refresh').onclick=()=>render();
  el('expiry-select').onchange=guard(()=>{pause();if(el('expiry-select').value==='__browse__'){render();expiryBrowser();return;}viewExpiry=el('expiry-select').value;const frames=P.frames(d,s),current=d.byFrame.get(s.symbol+'|'+s.cursor)||[];if(!current.some(q=>q.expiry===viewExpiry)){const at=frames.find(t=>(d.byFrame.get(s.symbol+'|'+t)||[]).some(q=>q.expiry===viewExpiry));if(!at)throw Error('No observations for this expiry in the loaded window.');change(P.advance(d,s,at));msg('Moved to the first recorded close for expiry '+viewExpiry+'.');}else render();});
  function expiryBrowser(){const dates=symbolDates[s.symbol]||archiveDates,yearNow=+new Date().toLocaleDateString('en-CA',{timeZone:'Asia/Kolkata'}).slice(0,4),years=Array.from({length:yearNow-1999},(_,i)=>String(yearNow-i));const dom=dialog('Browse previous expiries','<p>Select a year and month for '+esc(s.symbol)+'. Available daily reports are downloaded automatically; this opens a new simulation with their actual listed expiries.</p><form><div class="opstra-fields"><label>Year<select name="year">'+options(years,s.start.slice(0,4))+'</select></label><label>Month<select name="month"></select></label></div><button type="submit">Load historical expiries</button></form>');const f=dom.querySelector('form');function months(){const ms=Array.from({length:12},(_,i)=>String(i+1).padStart(2,'0'));f.elements.month.innerHTML=options(ms,ms.includes(s.start.slice(5,7))?s.start.slice(5,7):ms.at(-1));}f.elements.year.onchange=months;months();f.onsubmit=guard(async e=>{e.preventDefault();const prefix=f.elements.year.value+'-'+f.elements.month.value,ds=dates.filter(t=>t.startsWith(prefix)),first=prefix+'-01',last=new Date(Date.UTC(+f.elements.year.value,+f.elements.month.value,0)).toISOString().slice(0,10);await loadRecorded(s.symbol,first,last);msg('Historical '+s.symbol+' expiries loaded for '+prefix+'.');});}
  function archiveMonths(){const year=el('archive-year').value,months=[...new Set(archiveDates.filter(t=>t.startsWith(year+'-')).map(t=>t.slice(5,7)))].sort();el('archive-month').innerHTML=options(months,s?.start.slice(5,7)||months.at(-1));}
  el('archive-year').onchange=archiveMonths;
  el('browse-expiries').onclick=guard(async()=>{const prefix=el('archive-year').value+'-'+el('archive-month').value,dates=archiveDates.filter(t=>t.startsWith(prefix));if(!dates.length)throw Error('No downloaded observations for this month.');await loadRecorded(s.symbol,dates[0],dates.at(-1));msg('Historical window loaded. Select an expiry from the full window; unavailable years are not invented.');});
  el('minute-source').onclick=()=>newSimulation();
  el('replay-date').onchange=guard(()=>{pause();const day=el('replay-date').value,rows=P.frames(d,s).filter(t=>t.startsWith(day));if(!rows.length){render();throw Error('No observations on this date. Use New Simulation to load another recorded window.');}change(P.advance(d,s,rows.find(t=>t.slice(11)>=s.cursor.slice(11))||rows.at(-1)));});
  el('observed-time').onchange=guard(()=>{pause();change(P.advance(d,s,s.cursor.slice(0,11)+el('observed-time').value));});
  el('start-date').onchange=guard(()=>{const day=el('start-date').value,at=P.frames(d,s).find(t=>t.startsWith(day));if(at){change(P.advance(d,s,at));}else{newSimulation();modal.querySelector('[name=start]').value=day;modal.querySelector('[name=end]').value=day;}});
  el('payoff-date').onchange=guard(()=>{const next=el('payoff-date').value;try{A.analyze(d,s,{basis,expiry:viewExpiry,payoffDate:next});payoffDate=next;render();}catch(e){render();throw e;}});
  el('symbol-select').onchange=guard(async()=>{
    if(loading)return;const value=el('symbol-select').value,choice=instrumentChoice(value),cursor=s.cursor,start=s.start,end=s.end;
    if(choice.exchange==='bse_fo'&&d.kind==='daily'){render();newSimulation(value);return;}
    const mode=d.kind==='daily'?'daily':d.metadata.quoteTiming?.startsWith('Snapshot')?'snapshot':'minute';
    loading=true;el('symbol-select').disabled=true;pause();msg('Loading '+choice.symbol+' '+(mode==='daily'?'daily records':mode==='snapshot'?'option chain':'minute prices')+'…');
    let request=null;
    try{
      if(mode==='daily'){await loadRecorded(choice.symbol,start,end);return;}
      request=++generation;const exp=await brokerApi('expiries?'+new URLSearchParams({underlying:choice.symbol,exch:choice.exchange,...(mode==='minute'?{start,end}:{})}));
      if(request!==generation)return;
      const selected=exp.expiries.find(x=>{const match=/^(\d{2})([A-Z]{3})(\d{2})$/.exec(x);return match&&viewExpiry===('20'+match[3]+'-'+String(['JAN','FEB','MAR','APR','MAY','JUN','JUL','AUG','SEP','OCT','NOV','DEC'].indexOf(match[2])+1).padStart(2,'0')+'-'+match[1]);})||exp.expiries[0];
      if(!selected)throw Error('No available expiry for this selection');
      const j=await brokerApi((mode==='snapshot'?'snapshot?':'replay?')+new URLSearchParams({underlying:choice.symbol,exch:choice.exchange,expiry:selected,start,end}));
      if(request!==generation)return;adopt(j.dataset);
      const at=P.frames(d,s).find(t=>t>=cursor&&Number.isFinite(d.spots.get(s.symbol+'|'+t)));
      if(at&&at!==s.cursor)change(P.advance(d,s,at));
      msg(j.backup?j.notice:choice.symbol+' '+(mode==='snapshot'?'option chain':'minute replay')+' loaded · '+s.cursor.replace('T',' ')+' IST.');
    }catch(e){if(request!==null&&request!==generation)return;render();newSimulation(value);const note=modal.querySelector('[role=status]');note.textContent=choice.symbol+': '+e.message;}
    finally{loading=false;el('symbol-select').disabled=false;}
  });
  el('branch').onclick=guard(()=>{persist();change(P.branch(d,s));msg('New branch at this close. The original study remains saved.');});
  el('save-candles').onclick=guard(async()=>{if(!bundle||bundle.synthetic)throw Error('Only actual imported candles can be saved to the recorded library.');const r=await fetch('/api/candle-library?mode=import',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({...bundle,symbol:s.symbol,candles:bundle.candles.map(c=>({...c,timestamp:c.timestamp+':00+05:30'}))})});await jsonResponse(r);msg('Candles saved in the local indexed library.');});
  el('export').onclick=()=>download('iwsm-paper-study.json',JSON.stringify(serial()));
  el('restore').onchange=guard(async e=>{const file=e.target.files[0];if(!file)return;generation++;restore(JSON.parse(await file.text()));});
  el('journal-export').onclick=()=>{const rows=P.journal(d,s),keys=['openAt','closeAt','type','expiry','strike','side','lots','entry','price','net','status'];download('iwsm-journal.csv',[keys.join(','),...rows.map(r=>keys.map(k=>'"'+String(r[k]??'').replace(/"/g,'""')+'"').join(','))].join('\n'),'text/csv');};
  el('orders').onclick=guard(e=>{if(e.target.dataset.cancel!==undefined)change(P.cancel(d,s,P.valuation(d,s).orders[+e.target.dataset.cancel].id));});
  document.addEventListener('visibilitychange',()=>{if(document.hidden)pause();});root.addEventListener('hashchange',pause);
  msg('Opening your saved simulation…');host.querySelectorAll('[data-mins]').forEach(b=>b.disabled=true);
  root.IWSMSimulatorStartup.initialize({
    seed(){const raw=root.IWSMHistoryLab?.dataset()||root.IWSMNSEHistory;if(raw?.metadata?.synthetic||raw?.metadata?.modelled)throw Error('Load recorded data or explicitly choose a teaching example.');adopt(raw);msg('Recorded daily window ready. Use New Simulation to load other dates or import minute candles.');},
    open:async()=>{db=await Store.open();},latest:()=>db.latest(),restore,save:persist,revision:()=>generation,
    onError:e=>msg(e.message+' · Included recorded data remains available.')
  }).catch(e=>msg(e.message));
  fetch('/api/nse-library?mode=catalog').then(jsonResponse).then(j=>{symbols=(j.symbols||[]).map(x=>typeof x==='string'?x:x.symbol);archiveDates=j.dates||[];symbolDates=j.symbolDates||{};const years=[...new Set(archiveDates.map(t=>t.slice(0,4)))].sort();el('archive-year').innerHTML=options(years,s?.start.slice(0,4)||years.at(-1));archiveMonths();if(s)render();}).catch(()=>{el('browse-expiries').disabled=true;el('resolution-note').textContent='Archive browsing requires the local data backend.';});
  refreshInstruments().then(()=>{if(s)render();}).catch(e=>{msg(e.message+' · Saved simulations remain available.');});
  return {pause};
}};
})(window);

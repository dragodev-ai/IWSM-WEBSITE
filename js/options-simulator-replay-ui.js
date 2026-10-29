(function(root){
 'use strict';
 root.IWSMReplayUI={install(api){
  const R=root.IWSMReplay,M=root.IWSMSimulator,h=api.host,$=id=>document.getElementById('sm-'+id);
  const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const num=v=>v===null||v===undefined?'—':new Intl.NumberFormat('en-IN',{maximumFractionDigits:2}).format(v);
  const money=v=>v===null||v===undefined?'Unavailable':'₹ '+num(v);
  const options=(el,items,selected)=>{el.replaceChildren(...items.map(x=>new Option(x.label??x,x.value??x)));if([...el.options].some(o=>o.value===selected))el.value=selected;};
  let range=.08,chainMode='options',chart=null,inspectIndex=120;
  const main=h.firstElementChild;
  main.classList.add('sm-session-panel');
  const source=document.createElement('div');source.id='sm-data-badge';source.className='sm-data-badge';source.setAttribute('role','status');main.querySelector('h2').after(source);
  const data=document.createElement('details');data.className='sm-data-settings';
  data.innerHTML='<summary>Data source & import</summary><div class="sm-data-actions"><button type="button" id="sm-original-data">Use daily archive</button><button type="button" id="sm-practice">Try 5-minute practice</button><label class="file-button">Import intraday CSV / JSON<input id="sm-intraday-import" type="file" accept=".csv,.json"></label><button type="button" id="sm-template">Download CSV format</button></div><p class="fine">Import timestamped option and futures quotes to replay actual intraday history. The practice dataset uses synthetic teaching prices. Daily closing prices cannot establish five-minute P&L.</p><p id="sm-import-result" role="status"></p>';
  $('form').before(data);data.append($('form'));
  $('form').querySelector('button').textContent='Load data';
  const serverLoad=$('form').onsubmit;
  $('form').onsubmit=async e=>{
    e.preventDefault();
    const d=api.dataset(),symbol=$('symbol').value,start=$('start').value,end=$('end').value;
    try{
      const available=[...(d.bySymbol.get(symbol)||[])].sort();
      if(available.length&&start>=available[0].slice(0,10)&&end<=available.at(-1).slice(0,10)){
        api.loadWindow({symbol,start,end,feesPerOrder:api.session().feesPerOrder,slippage:api.session().slippage,rate:api.session().rate,dividend:api.session().dividend,unitsPerLot:api.session().unitsPerLot});
        api.message('Loaded the selected date window from the active dataset.');return;
      }
      if(location.hostname.endsWith('github.io'))throw Error('These dates are not in the loaded dataset. Import recorded CSV / JSON for that range. Automatic archive downloads require the connected local preview or a server deployment.');
      const button=$('form').querySelector('button');button.disabled=true;try{await serverLoad(e);}finally{button.disabled=false;}
    }catch(error){api.message(error.message+' The previous replay is preserved.');}
  };
  const toolbar=document.createElement('div');toolbar.className='sm-replay-toolbar';
  toolbar.innerHTML='<div class="sm-clock-fields"><label>Replay date<input id="sm-replay-date" type="date"></label><label>Time · IST<select id="sm-replay-clock"></select></label><div id="sm-replay-expiry"></div><button type="button" id="sm-ticket-toggle" aria-expanded="false">+ Add position</button></div><div id="sm-replay-shortcuts" class="sm-replay-shortcuts"></div><p id="sm-move-note" class="fine" role="status"></p>';
  data.after(toolbar);$('replay-expiry').append($('expiry').parentElement);
  $('expiry').parentElement.firstChild.textContent='Chain expiry';
  const jumps=h.querySelector('.sm-jumps');$('replay-shortcuts').append(jumps);
  for(const [dir,label]of [[-1,'−2h'],[1,'+2h']]){const b=document.createElement('button');b.type='button';b.dataset.jump='120';b.dataset.dir=String(dir);b.textContent=label;jumps.children[dir===-1?0:1].append(b);}
  for(const b of jumps.querySelectorAll('[data-jump]')){
    const val=b.dataset.jump,dir=Number(b.dataset.dir);
    b.textContent=(dir<0?'−':'+')+(val==='day'?'1d':Number(val)>=60?Number(val)/60+'h':val+'m');
    b.onclick=()=>{
      const d=api.dataset(),s=api.session(),before=s.cursor;
      api.act(()=>R.jump(d,s,dir,val==='day'?'day':Number(val)));
      const after=api.session().cursor,delta=Math.abs(M.instant(after)-M.instant(before))/60000;
      $('move-note').textContent=before===after?'Reached the end of the available replay.':val!=='day'&&delta!==Number(val)?'Moved to '+after.replace('T',' ')+' IST ('+num(delta)+' elapsed minutes). Intervening snapshots are unavailable.':'';
    };
  }
  jumps.querySelectorAll('[data-session-edge]').forEach(b=>b.textContent=b.dataset.sessionEdge==='start'?'SOD':'EOD');
  for(const [group,order]of [[jumps.children[0],['day','start','120','60','30','15','5','1']],[jumps.children[1],['1','5','15','30','60','120','end','day']]])for(const key of order){const button=[...group.children].find(b=>b.dataset.jump===key||b.dataset.sessionEdge===key);if(button)group.append(button);}
  const transport=$('play').parentElement;transport.classList.add('sm-transport');
  $('play').setAttribute('aria-label','Play or pause recorded replay');
  const snapshotDetails=document.createElement('details');snapshotDetails.className='sm-all-snapshots';snapshotDetails.innerHTML='<summary>All recorded snapshots</summary>';
  $('time').parentElement.before(snapshotDetails);snapshotDetails.append($('time').parentElement);
  $('replay-date').onchange=()=>{const d=api.dataset(),s=api.session(),day=$('replay-date').value,list=M.frames(d,s).filter(t=>t.startsWith(day));if(!list.length){api.message('No recorded snapshots on this date. The current replay is preserved.');render();return;}const at=list.find(t=>t.slice(11)===s.cursor.slice(11))||list[0];api.act(()=>M.advance(d,s,at));};
  $('replay-clock').onchange=()=>api.act(()=>R.selectTime(api.dataset(),api.session(),$('replay-date').value,$('replay-clock').value));
  const ticket=document.createElement('form');ticket.id='sm-ticket';ticket.className='sm-ticket';ticket.hidden=true;
  ticket.innerHTML='<h3>Add paper position</h3><div class="sm-ticket-fields"><label>Buy / Sell<select id="sm-ticket-side"><option value="1">Buy</option><option value="-1">Sell</option></select></label><label>Contract expiry<select id="sm-ticket-expiry"></select></label><label>Contract<select id="sm-ticket-contract"></select></label><label>Lots<input id="sm-ticket-lots" type="number" value="1" min="1" max="100" step="1" required></label><button type="submit">Add at recorded LTP</button><button id="sm-ticket-cancel" type="button">Cancel</button></div><p id="sm-ticket-price" class="fine"></p>';
  toolbar.after(ticket);
  function ticketContracts(){const d=api.dataset(),s=api.session(),rows=M.chain(d,s,$('ticket-expiry').value),value=$('ticket-contract').value;options($('ticket-contract'),rows.map(r=>({value:r.type+'|'+r.strike,label:(r.type==='FUT'?'Futures':num(r.strike)+' '+r.type)+' · ₹ '+num(r.close)})),value);ticketPrice();}
  function ticketPrice(){const s=api.session(),[type,strike]=$('ticket-contract').value.split('|'),row=M.chain(api.dataset(),s,$('ticket-expiry').value).find(r=>r.type===type&&r.strike===Number(strike));$('ticket-price').textContent=row?'Entry '+s.cursor.replace('T',' ')+' IST · Recorded LTP '+money(row.close)+' · '+num(row.lotSize||s.unitsPerLot)+' units / lot'+(row.volume===0?' · No traded volume: entry unavailable.':''):'No quote for the selected contract.';}
  $('ticket-expiry').onchange=ticketContracts;$('ticket-contract').onchange=ticketPrice;
  $('ticket-toggle').onclick=()=>{ticket.hidden=!ticket.hidden;$('ticket-toggle').setAttribute('aria-expanded',String(!ticket.hidden));if(!ticket.hidden){ticketContracts();$('ticket-side').focus();}};
  $('ticket-cancel').onclick=()=>{ticket.hidden=true;$('ticket-toggle').setAttribute('aria-expanded','false');};
  ticket.onsubmit=e=>{e.preventDefault();const [type,strike]=$('ticket-contract').value.split('|');api.act(()=>M.open(api.dataset(),api.session(),{type,strike:Number(strike),expiry:$('ticket-expiry').value,side:Number($('ticket-side').value),lots:Number($('ticket-lots').value)}));};
  const switcher=document.createElement('div');switcher.className='button-row sm-instrument-tabs';switcher.setAttribute('aria-label','Contract type');switcher.innerHTML='<button type="button" data-sm-instrument="options" aria-pressed="true">Options</button><button type="button" data-sm-instrument="futures" aria-pressed="false">Futures</button><span id="sm-instrument-note" class="fine"></span>';
  $('chain').closest('.table-scroll').before(switcher);
  switcher.querySelectorAll('button').forEach(b=>b.onclick=()=>{chainMode=b.dataset.smInstrument;renderChain();});
  // Strike windows match the reference workflow; these are counts, never fabricated strikes.
  const windows=document.createElement('div');windows.className='button-row';windows.innerHTML='<label>Strikes above ATM<select id="sm-above"></select></label><label>Strikes below ATM<select id="sm-below"></select></label>';
  const chainSettings=h.querySelector('.sm-chain-panel .sm-settings');chainSettings.append(windows);
  for(const id of ['above','below']){options($(id),[{value:'7',label:'7'},'5','10','20','30','40',{value:'all',label:'All'}],'7');$(id).onchange=()=>{api.refresh();renderChain();};}
  const toggleAll=$('all-strikes');toggleAll.addEventListener('click',()=>{const all=toggleAll.getAttribute('aria-pressed')==='true';$('above').value=all?'all':'7';$('below').value=all?'all':'7';api.refresh();});
  const viewPositions=document.createElement('button');viewPositions.type='button';viewPositions.dataset.smTab='positions';viewPositions.textContent='Positions';api.tabbar.append(viewPositions);viewPositions.onclick=()=>api.setTab('positions');
  const historyButton=api.tabbar.querySelector('[data-sm-tab="history"]');if(historyButton)historyButton.textContent='Recorded P&L';
  const importInput=$('intraday-import');
  importInput.onchange=async()=>{try{const file=importInput.files[0];if(!file)return;if(file.size>40*1024*1024)throw Error('Choose a file up to 40 MB.');const text=await file.text(),json=/\.csv$/i.test(file.name)?null:JSON.parse(text),raw=json?R.readJSON(json):R.readCSV(text,file.name);M.prepareDataset(raw);api.adopt(raw,json?.session);$('import-result').textContent='Loaded '+file.name+'.';api.message('Timestamped data imported. Select a date and time, then add a position.');}catch(e){$('import-result').textContent=e.message+' The previous simulation is preserved.';}finally{importInput.value='';}};
  $('practice').onclick=()=>{try{api.adopt(R.practice());api.message('Synthetic intraday practice loaded. These are illustrative prices, not historical market results.');}catch(e){api.message(e.message);}};
  $('original-data').onclick=()=>{try{api.adopt(root.IWSMHistoryLab.dataset());api.message('Recorded daily archive loaded.');}catch(e){api.message(e.message);}};
  $('template').onclick=()=>{
    const text='timestamp,symbol,expiry,type,strike,close,lotSize,spot,volume,oi\n2026-10-14T09:15+05:30,NIFTY,2026-10-19,CE,22700,120,65,22680,100,10000\n2026-10-14T09:20+05:30,NIFTY,2026-10-19,CE,22700,125,65,22690,120,10100\n';
    const url=URL.createObjectURL(new Blob([text],{type:'text/csv'})),a=document.createElement('a');a.href=url;a.download='iwsm-intraday-format-example-not-market-data.csv';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
  };

  // Keep the daily replay workflow visible; disclose secondary tools on demand.
  h.classList.add('sm-minimal');
  const head=document.createElement('div');head.className='sm-workspace-head';
  const title=document.createElement('div');title.append(main.querySelector('h2'),source);
  const headActions=document.createElement('div');headActions.className='button-row';
  headActions.append($('new'),$('simulations'));
  head.append(title,headActions);main.prepend(head);
  const symbolLabel=$('symbol').parentElement;
  toolbar.querySelector('.sm-clock-fields').prepend(symbolLabel);
  $('symbol').onchange=async()=>{await $('form').onsubmit({preventDefault(){}});if($('symbol').value!==api.session().symbol)$('symbol').value=api.session().symbol;};
  $('symbol-search').setAttribute('placeholder','Find a stock or index');
  data.prepend($('symbol-search'));
  data.querySelector('summary').textContent='Data & settings';
  const calculation=$('apply-calculation').closest('details');data.append(calculation);
  data.append($('units').parentElement,$('basis').parentElement);
  const help=document.createElement('details');help.className='sm-help';
  help.innerHTML='<summary>Replay guide</summary><p>Choose recorded data or import timestamped quotes. Add paper positions, then move backward or forward in time. Entries retain their original price. Later trades lock earlier snapshots until you choose Branch here.</p><p>Minute controls need intraday observations. Future scenarios use pricing models and do not predict future market prices.</p>';
  const guide=$('guide');guide.hidden=false;help.append(guide);
  data.append(help,$('record'),$('iv-chart'),$('iv-view'));
  // Retire duplicated action buttons while preserving their event bindings.
  for(const id of ['liquidity','get-chain','strategies','all-strikes'])$(id).hidden=true;
  const strategyRow=$('preset').closest('.button-row');
  const prebuilt=document.createElement('details');prebuilt.className='sm-prebuilt';
  prebuilt.innerHTML='<summary>Prebuilt strategies</summary>';
  main.append(prebuilt);prebuilt.append(h.querySelector('.sm-categories'),strategyRow);
  switcher.append($('lots').parentElement,$('ticket-toggle'));
  $('lots').setAttribute('aria-label','Order lots');
  headActions.append(prebuilt,data);
  const resetRow=$('reset').parentElement;resetRow.classList.add('sm-retired-actions');
  const positionPanel=$('positions').closest('.panel');
  positionPanel.append($('reset'));
  for(const node of [...main.children])if(node.tagName==='P'&&node!==$('status')&&node!==$('context'))help.append(node);
  $('quotes').classList.add('sm-market-strip');
  head.after($('quotes'));toolbar.after(transport);
  transport.append($('slider'));
  snapshotDetails.hidden=true; // The visible date, clock and slider cover the same snapshots.
  $('prev').textContent='← Step';$('next').textContent='Step →';
  const pnl=document.createElement('div');pnl.className='sm-pnl-strip';pnl.id='sm-pnl-strip';
  api.tabbar.after(pnl);$('total').hidden=true;
  $('risk').classList.add('sm-model-metrics');
  pnl.after($('risk'));
  viewPositions.remove(); // Positions are always available below the selected chart.
  const secondary=document.createElement('select');secondary.id='sm-more-view';secondary.setAttribute('aria-label','More analysis views');
  secondary.add(new Option('More charts…',''));
  for(const b of [...api.tabbar.querySelectorAll('[data-sm-tab]')]){
    if(['payoff','greeks','history'].includes(b.dataset.smTab))continue;
    secondary.add(new Option(b.textContent,b.dataset.smTab));b.hidden=true;
  }
  secondary.onchange=()=>{if(secondary.value)api.setTab(secondary.value);};
  api.tabbar.append(secondary);
  const scenarioButton=document.createElement('button');scenarioButton.type='button';scenarioButton.dataset.smTab='scenario';scenarioButton.textContent='Future scenario';
  scenarioButton.onclick=()=>api.setTab('scenario');secondary.before(scenarioButton);
  let scenarioAt='',scenarioSpot=0,scenarioIV=0;
  function futureHTML(){
    const d=api.dataset(),s=api.session(),v=M.valuation(d,s),open=v.positions.filter(p=>!p.closed),expiry=open.map(p=>p.expiry).sort()[0];
    if(!open.length)return '<div class="sm-chart-empty"><h3>Add a position first</h3><p>Future scenarios show the effect of time, underlying price and volatility on your open positions.</p></div>';
    const max=expiry+'T15:30';
    if(!scenarioAt||scenarioAt<s.cursor||scenarioAt>max)scenarioAt=s.cursor;
    const p=R.scenario(d,s,{at:scenarioAt,spotChange:scenarioSpot,ivChange:scenarioIV,basis:$('basis').value,expiry:$('expiry').value,range});
    return '<div class="sm-scenario-label">MODELLED SCENARIO · recorded positions stay unchanged</div><form id="sm-scenario-form" class="sm-scenario-fields"><label>Scenario date & time · IST<input id="sm-scenario-at" type="datetime-local" min="'+s.cursor+'" max="'+max+'" value="'+scenarioAt+'" required></label><label>Underlying change (%)<input id="sm-scenario-spot" type="number" min="-90" max="100" step="any" value="'+scenarioSpot+'" required></label><label>IV change (percentage points)<input id="sm-scenario-iv" type="number" min="-100" max="100" step="any" value="'+scenarioIV+'" required></label><button>Calculate scenario</button><button id="sm-scenario-reset" type="button">Reset</button></form><p id="sm-scenario-error" role="status"></p><div class="sm-scenario-result"><span>Model net P&L at ₹ '+num(p?.selected.underlying)+'</span><strong>'+money(p?.selected.current)+'</strong><span>'+scenarioAt.replace('T',' ')+' IST · Includes executed costs</span></div>'+(p?chartHTML(p):'<p>Matching underlying prices are required.</p>')+'<p class="fine">Constant IV shift and constant futures basis assumptions. No new fills, future fees or automatic settlement are simulated. Projection stops at the first expiry; later legs retain modelled time value.</p>';
  }

  function renderChain(){
    const d=api.dataset(),s=api.session();if(!s)return;
    for(const button of $('chain').querySelectorAll('[data-contract-chart]')){button.title=button.getAttribute('aria-label');button.textContent='↗';}
    const spot=M.reference(d,s,$('expiry').value,$('atm-reference').value).price,rows=M.chain(d,s,$('expiry').value),strikes=[...new Set(rows.filter(r=>r.type!=='FUT').map(r=>r.strike))].sort((a,b)=>a-b),atm=spot===null?null:strikes.reduce((a,b)=>Math.abs(b-spot)<Math.abs(a-spot)?b:a,strikes[0]),anchor=strikes.indexOf(atm);
    // The adapter requests the complete recorded chain, then filters its view only.
    const above=$('above').value==='all'?Infinity:Number($('above').value),below=$('below').value==='all'?Infinity:Number($('below').value);
    let shown=0;
    for(const tr of $('chain').children){const b=tr.querySelector('[data-type]');if(!b)continue;const future=b.dataset.type==='FUT',index=strikes.indexOf(Number(b.dataset.strike));tr.hidden=chainMode==='futures'?!future:future||(anchor>=0&&(index<anchor-below||index>anchor+above));if(!tr.hidden)shown++;}
    switcher.querySelectorAll('button').forEach(b=>b.setAttribute('aria-pressed',String(chainMode===b.dataset.smInstrument)));
    $('chain').closest('table').querySelector('thead').hidden=chainMode==='futures';
    $('instrument-note').textContent=shown?'':chainMode==='futures'?'No recorded futures contracts at this snapshot. Import futures quotes to trade them.':'No matching recorded options.';
    $('chain-note').hidden=true;
    chainSettings.title='Model Greeks are per unit. OI in lots requires the recorded contract size.';
  }
  function render(){
    const d=api.dataset(),s=api.session();if(!s)return;
    const frames=M.frames(d,s),days=[...new Set(frames.map(t=>t.slice(0,10)))],times=frames.filter(t=>t.startsWith(s.cursor.slice(0,10))).map(t=>t.slice(11));
    source.textContent=d.metadata?.synthetic?'Synthetic practice · 5-minute snapshots':d.kind==='intraday'?'Recorded intraday':'Recorded daily closes';source.title=d.source;
    source.dataset.kind=d.metadata?.synthetic?'practice':d.kind;
    if(d.metadata?.synthetic)$('context').textContent=s.symbol+' · '+s.cursor.replace('T',' ')+' IST · Synthetic practice prices · Not historical market data';
    $('replay-date').min=days[0];$('replay-date').max=days.at(-1);$('replay-date').value=s.cursor.slice(0,10);
    options($('replay-clock'),times,s.cursor.slice(11));$('replay-clock').disabled=d.kind==='daily';
    for(const b of jumps.querySelectorAll('[data-jump]')){b.disabled=d.kind==='daily'&&b.dataset.jump!=='day';b.title=b.disabled?'Import timestamped data for minute replay.':'';}
    if(d.kind==='intraday'&&![...$('step').options].some(o=>o.value==='120'))$('step').add(new Option('2 hours','120'));
    const index=frames.indexOf(s.cursor);$('play').disabled=index===frames.length-1;$('ticket-toggle').disabled=M.hasFuture(s);
    options($('ticket-expiry'),[...new Set(M.chain(d,s).map(r=>r.expiry))].sort(),$('ticket-expiry').value||$('expiry').value);ticketContracts();
    viewPositions.textContent='Positions ('+M.valuation(d,s).positions.filter(p=>!p.closed).length+')';
    $('time').parentElement.style.minWidth='0';
    const v=M.valuation(d,s);
    if($('risk').children.length===4)$('risk').lastElementChild.remove();
    pnl.innerHTML=[['Running gross',v.unrealized],['Realized gross',v.realized],['Executed costs',v.costs],['Net P&L',v.net]].map(([label,value])=>'<div><span>'+label+'</span><strong class="'+(label==='Net P&L'?(value>=0?'gain':'loss'):'')+'">'+money(value)+'</strong></div>').join('');
    for(const b of jumps.querySelectorAll('[data-jump]')){const next=Number(b.dataset.dir)>0?frames.at(-1):frames[0];b.disabled=b.disabled||s.cursor===next;}
    const today=frames.filter(t=>t.startsWith(s.cursor.slice(0,10)));
    for(const b of jumps.querySelectorAll('[data-session-edge]'))b.disabled=s.cursor===(b.dataset.sessionEdge==='start'?today[0]:today.at(-1));
    for(const b of jumps.querySelectorAll('[data-jump="1"]'))b.hidden=true;
    secondary.value=[...secondary.options].some(o=>o.value&&api.tabbar.querySelector('[data-sm-tab="'+o.value+'"]')?.getAttribute('aria-pressed')==='true')?[...secondary.options].find(o=>o.value&&api.tabbar.querySelector('[data-sm-tab="'+o.value+'"]')?.getAttribute('aria-pressed')==='true').value:'';
    renderChain();
    if(d.kind==='daily')$('move-note').textContent='Daily archive: minute steps are unavailable. Import timestamped quotes or choose the labelled 5-minute practice dataset.';
  }
  function chartHTML(profile){
    const W=960,H=800,L=90,T=32,RIGHT=25,B=55,iw=W-L-RIGHT,ih=H-T-B;
    const vals=profile.points.flatMap(p=>[p.expiry,p.current]).filter(Number.isFinite),min=Math.min(0,...vals),max=Math.max(1,...vals),pad=Math.max(10,(max-min)*.09),rawStep=(max-min+2*pad)/6,power=10**Math.floor(Math.log10(rawStep)),step=[1,2,2.5,5,10].map(v=>v*power).find(v=>v>=rawStep),lo=Math.floor((min-pad)/step)*step,hi=Math.ceil((max+pad)/step)*step;
    const x=v=>L+(v-profile.lo)/(profile.hi-profile.lo)*iw,y=v=>T+(hi-v)/(hi-lo)*ih;
    chart={profile,x,y,L,T,W,H,iw,ih};
    let svg='<svg id="sm-payoff-svg" viewBox="0 0 '+W+' '+H+'" role="img" aria-label="Expiry and replay-time model payoff by underlying price"><defs><clipPath id="sm-green-area"><rect x="'+L+'" y="'+T+'" width="'+iw+'" height="'+(y(0)-T)+'"/></clipPath><clipPath id="sm-red-area"><rect x="'+L+'" y="'+y(0)+'" width="'+iw+'" height="'+(T+ih-y(0))+'"/></clipPath></defs>';
    for(let v=lo;v<=hi+step/2;v+=step){const yy=y(v);svg+='<line class="sm-grid" x1="'+L+'" x2="'+(W-RIGHT)+'" y1="'+yy+'" y2="'+yy+'"/><text x="'+(L-10)+'" y="'+(yy+4)+'" text-anchor="end">₹'+(Math.abs(v)>=100000?num(v/100000)+'L':Math.abs(v)>=1000?num(v/1000)+'K':num(v))+'</text>';}
    for(let i=0;i<=6;i++){const v=profile.lo+(profile.hi-profile.lo)*i/6,xx=x(v);svg+='<line class="sm-grid" x1="'+xx+'" x2="'+xx+'" y1="'+T+'" y2="'+(T+ih)+'"/><text x="'+xx+'" y="'+(H-28)+'" text-anchor="middle">'+num(v)+'</text>';}
    const points=profile.points;
    if(points.every(p=>p.expiry!==null)){
      const coords=points.map(p=>x(p.underlying)+','+y(p.expiry)).join(' '),poly=x(points[0].underlying)+','+y(0)+' '+coords+' '+x(points.at(-1).underlying)+','+y(0);
      svg+='<polygon points="'+poly+'" class="sm-profit-area" clip-path="url(#sm-green-area)"/><polygon points="'+poly+'" class="sm-loss-area" clip-path="url(#sm-red-area)"/><polyline points="'+coords+'" class="sm-expiry-line"/>';
    }
    if(points.every(p=>p.current!==null))svg+='<polyline points="'+points.map(p=>x(p.underlying)+','+y(p.current)).join(' ')+'" class="sm-current-line"/>';
    const sx=x(profile.spot);
    svg+='<line x1="'+L+'" x2="'+(W-RIGHT)+'" y1="'+y(0)+'" y2="'+y(0)+'" class="sm-zero-line"/><line x1="'+sx+'" x2="'+sx+'" y1="'+T+'" y2="'+(T+ih)+'" class="sm-spot-line"/><text x="'+sx+'" y="20" text-anchor="middle">Spot '+num(profile.spot)+'</text><text x="'+(L+iw/2)+'" y="'+(H-5)+'" text-anchor="middle">Underlying price · ₹</text><g id="sm-crosshair" visibility="hidden"><line id="sm-cross-line" y1="'+T+'" y2="'+(T+ih)+'"/><circle id="sm-cross-expiry" r="4"/><circle id="sm-cross-current" r="4"/></g><rect id="sm-hover-area" x="'+L+'" y="'+T+'" width="'+iw+'" height="'+ih+'" fill="transparent"/></svg>';
    return '<div class="sm-chart-controls"><div class="sm-chart-legend"><span><i></i>Expiry · '+esc(profile.expiry)+'</span><span><i></i>'+(profile.modelled?'Scenario · '+esc(profile.at.replace('T',' ')):'Replay · '+esc(profile.cursor.replace('T',' ')))+' IST</span></div><label>Price range<select id="sm-chart-range">'+[.04,.08,.15,.25].map(v=>'<option value="'+v+'" '+(range===v?'selected':'')+'>±'+v*100+'%</option>').join('')+'</select></label></div><div id="sm-payoff-wrap" class="sm-payoff-wrap">'+svg+'<div id="sm-payoff-tooltip" class="sm-payoff-tooltip" hidden></div></div><label class="sm-chart-inspector">Inspect underlying price<input id="sm-chart-inspector" type="range" min="0" max="240" step="1" value="'+inspectIndex+'" aria-label="Inspect chart underlying price"></label><div id="sm-inspect-values" class="sm-inspect-values" aria-live="polite"></div><p class="fine">Hover, tap, or use the inspector arrow keys. Curves are models; positions use recorded LTP. Costs include executed orders only.'+(profile.mixed?' Later-expiry legs are modelled at the first expiry.':'')+'</p>';
  }
  function inspect(index,tooltip=false){
    if(!chart)return;inspectIndex=Math.max(0,Math.min(240,index));const c=chart,p=c.profile.points[inspectIndex],xx=c.x(p.underlying),wrap=$('payoff-wrap'),tip=$('payoff-tooltip');
    $('chart-inspector').value=inspectIndex;$('chart-inspector').setAttribute('aria-valuetext','Underlying '+num(p.underlying)+', expiry '+money(p.expiry)+', replay '+money(p.current));
    $('crosshair').setAttribute('visibility','visible');$('cross-line').setAttribute('x1',xx);$('cross-line').setAttribute('x2',xx);
    for(const [id,value]of [['cross-expiry',p.expiry],['cross-current',p.current]]){const circle=$(id);circle.setAttribute('cx',xx);circle.setAttribute('cy',value===null?c.T:c.y(value));circle.setAttribute('visibility',value===null?'hidden':'visible');}
    const values='<div><span>Underlying</span><strong>₹ '+num(p.underlying)+'</strong></div><div><span>From spot</span><strong>'+num(p.fromSpot)+'%</strong></div><div><span>Expiry ('+esc(c.profile.expiry)+')</span><strong class="'+(p.expiry>=0?'gain':'loss')+'">'+money(p.expiry)+'</strong></div><div><span>'+(c.profile.modelled?'Scenario ('+esc(c.profile.at.replace('T',' '))+')':'Replay ('+esc(c.profile.cursor.replace('T',' '))+')')+'</span><strong class="'+(p.current>=0?'gain':'loss')+'">'+money(p.current)+'</strong></div><div><span>Start date</span><strong>'+esc(c.profile.start)+'</strong></div>';
    $('inspect-values').innerHTML=values;
    if(tooltip){tip.innerHTML=values;tip.hidden=false;const width=wrap.clientWidth,left=xx/c.W*width;tip.style.left=Math.max(8,Math.min(width-260,left+14))+'px';tip.style.top='70px';}else tip.hidden=true;
  }
  function analysis(tab){
    secondary.value=[...secondary.options].some(o=>o.value===tab)?tab:'';
    chart=null;
    if(tab==='positions'){
      const s=api.session(),v=M.valuation(api.dataset(),s);
      $('analysis').innerHTML='<h3>Positions at '+esc(s.cursor.replace('T',' '))+' IST</h3><p>'+v.positions.filter(p=>!p.closed).length+' open · '+v.positions.filter(p=>p.closed).length+' closed</p><p>Running '+money(v.unrealized)+' · Realized '+money(v.realized)+' · Net '+money(v.net)+'</p><p class="fine">Manage lots and entries with Revise, close a position at its recorded LTP, or use Reverse and SL / Target in the position table below.</p>';return true;
    }
    if(tab!=='payoff'&&tab!=='scenario')return false;
    const scenarioMode=tab==='scenario';
    const d=api.dataset(),s=api.session(),p=R.profile(d,s,{basis:$('basis').value,expiry:$('expiry').value,range});
    if(!p||!p.hasPositions){$('analysis').innerHTML='<div class="sm-chart-empty"><h3>Build a position to explore its payoff</h3><p>Choose Buy or Sell in the option chain, or use + Add position. Step through recorded times to see LTP and P&L change.</p></div>';return true;}
    $('analysis').innerHTML=scenarioMode?futureHTML():chartHTML(p);
    if(scenarioMode){const form=$('scenario-form');if(!form)return true;form.onsubmit=e=>{e.preventDefault();try{const at=$('scenario-at').value,spot=Number($('scenario-spot').value),iv=Number($('scenario-iv').value);R.scenario(d,s,{at,spotChange:spot,ivChange:iv});scenarioAt=at;scenarioSpot=spot;scenarioIV=iv;api.setTab('scenario');}catch(error){$('scenario-error').textContent=error.message;}};$('scenario-reset').onclick=()=>{scenarioAt=s.cursor;scenarioSpot=0;scenarioIV=0;api.setTab('scenario');};if(!$('payoff-svg'))return true;}
    $('chart-range').onchange=()=>{range=Number($('chart-range').value);api.setTab(scenarioMode?'scenario':'payoff');};
    $('chart-inspector').oninput=()=>inspect(Number($('chart-inspector').value));
    const svg=$('payoff-svg');
    svg.onpointermove=e=>{if(e.pointerType==='touch'&&e.buttons===0)return;const box=svg.getBoundingClientRect(),px=(e.clientX-box.left)/box.width*chart.W;inspect(Math.round((px-chart.L)/chart.iw*240),true);};
    svg.onpointerdown=e=>{const box=svg.getBoundingClientRect(),px=(e.clientX-box.left)/box.width*chart.W;inspect(Math.round((px-chart.L)/chart.iw*240),true);};
    svg.onpointerleave=()=>{$('payoff-tooltip').hidden=true;};
    inspect(inspectIndex);return true;
  }
  const terminal=root.IWSMTerminal.install({...api,main,data,prebuilt,source,toolbar,transport,chainSettings});
  return {render(){render();terminal.render();},analysis,chain:renderChain,reset(){chart=null;scenarioAt='';scenarioSpot=0;scenarioIV=0;if(api.dataset().kind==='intraday')$('step').value='5';ticket.hidden=true;$('ticket-toggle').setAttribute('aria-expanded','false');$('move-note').textContent='';}};
 }};
})(window);

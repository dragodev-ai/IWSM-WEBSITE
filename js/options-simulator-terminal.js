(function(root,factory){
 if(typeof module==='object'&&module.exports)module.exports=factory(require('./options-simulator-engine.js'),require('./strategy-engine.js'),require('./strategy-research-engine.js'));
 else root.IWSMTerminal=factory(root.IWSMSimulator,root.IWSMStrategy,root.IWSMResearch);
})(typeof window==='undefined'?globalThis:window,function(M,E,Q){
 'use strict';
 function referenceAnalytics(d,s,options={}){
  const basis=options.basis||'spot',ref=M.reference(d,s,options.expiry||M.chain(d,s)[0]?.expiry,basis).price;
  if(ref==null)return null;
  if(basis==='spot')return M.analytics(d,s);
  const spots=new Map(d.spots);spots.set(s.symbol+'|'+s.cursor,ref);
  return M.analytics({...d,spots},{...s,dividend:s.rate});
 }
 function contractModel(row,reference,basis,s){
  if(!row||reference==null)return {iv:null,greeks:null};
  const days=Math.max(0,(Date.parse(row.expiry+'T15:30:00+05:30')-M.instant(s.cursor||row.timestamp))/86400000),q=basis==='spot'?s.dividend/100:s.rate/100;
  const iv=Q.impliedVolatility(row.type,reference,row.strike,days,row.close,s.rate/100,q);
  return {iv:iv==null?null:iv*100,greeks:iv==null?null:E.greeks(row.type,reference,row.strike,days,iv,s.rate/100,q)};
 }
 return {referenceAnalytics,contractModel,install(api){
  const h=api.host,$=id=>document.getElementById('sm-'+id);
  const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const number=(v,digits=2)=>v==null?'—':new Intl.NumberFormat('en-IN',{maximumFractionDigits:digits}).format(v);
  const money=v=>v==null?'Unavailable':'₹'+number(v);
  const compact=v=>v==null?'—':Math.abs(v)>=1e7?number(v/1e7)+' Cr':Math.abs(v)>=1e5?number(v/1e5)+' L':Math.abs(v)>=1e3?number(v/1e3)+' K':number(v);
  const button=(label,fn,attrs={})=>{const b=document.createElement('button');b.type='button';b.textContent=label;b.onclick=fn;for(const [k,v]of Object.entries(attrs))b.setAttribute(k,v);return b;};
  document.body.classList.add('iwsm-reference-lab');h.classList.add('sm-terminal');
  const main=h.querySelector('.sm-session-panel'),bench=h.querySelector('.sm-workbench'),left=h.querySelector('.sm-chain-panel'),right=h.querySelector('.sm-results');
  const analysis=$('analysis').closest('.panel'),positions=$('positions').closest('.panel');
  const savedSessionsButton=$('simulations'),resetSessionButton=$('new');
  analysis.classList.add('nt-chart-panel');positions.classList.add('nt-trades-panel');
  let leftView='chain',rightView='payoff',tradeView='trades',auxView=null,lastFocus=null;
  const parking=document.createElement('div');parking.hidden=true;h.append(parking);
  const dialog=document.createElement('dialog');dialog.className='nt-dialog';dialog.setAttribute('aria-labelledby','sm-dialog-title');
  dialog.innerHTML='<div class="nt-dialog-head"><h2 id="sm-dialog-title"></h2><button type="button" id="sm-dialog-close" aria-label="Close dialog">×</button></div><div id="sm-dialog-content"></div>';
  h.append(dialog);
  function closeDialog(){if(dialog.open)dialog.close();}
  function openDialog(title,node){lastFocus=document.activeElement;for(const child of [...$('dialog-content').children])parking.append(child);$('dialog-title').textContent=title;$('dialog-content').append(node);node.hidden=false;if(node.tagName==='DETAILS')node.open=true;if(!dialog.open)dialog.showModal();$('dialog-close').focus();}
  $('dialog-close').onclick=closeDialog;dialog.addEventListener('close',()=>{auxView=null;lastFocus?.focus?.();});
  dialog.addEventListener('click',e=>{if(e.target===dialog){const r=dialog.getBoundingClientRect();if(e.clientX<r.left||e.clientX>r.right||e.clientY<r.top||e.clientY>r.bottom)closeDialog();}});
  addEventListener('hashchange',closeDialog);
  const settings=document.createElement('div');settings.className='nt-settings-content';
  settings.append(api.data,api.chainSettings,$('step').parentElement,$('speed').parentElement);
  api.data.open=true;api.chainSettings.open=true;parking.append(settings,api.prebuilt,h.querySelector('.sm-saved-panel'));
  $('above').value='all';$('below').value='all';
  const saved=h.querySelector('.sm-saved-panel');saved.open=true;
  const title=main.querySelector('h2');title.textContent='Options Simulator';
  const top=document.createElement('div');top.className='nt-top';
  const heading=document.createElement('div');heading.className='nt-heading';heading.append(title,$('quotes'),api.source);
  const actions=document.createElement('div');actions.className='nt-actions';
  top.append(heading,actions);main.querySelector('.sm-workspace-head').replaceWith(top);
  actions.append(button('⚙ Settings',()=>openDialog('Simulator settings',settings)),button('▥ OI Chart',()=>showAux('oi')),savedSessionsButton,button('▦ Prebuilt strategies',()=>openDialog('Prebuilt strategies',api.prebuilt)),button('▥ Historical Chart',()=>showAux('history')),resetSessionButton,button('?',()=>openDialog('How replay works',h.querySelector('.sm-help')),{'aria-label':'Replay guide'}));
  $('simulations').textContent='▣ Saved';$('simulations').onclick=()=>openDialog('Saved simulations & backups',saved);
  $('new').textContent='Reset session';
  const timebar=api.toolbar;timebar.classList.add('nt-timebar');
  timebar.append($('play'));$('play').textContent='▶ Autoplay';
  const dates=$('replay-date').parentElement;dates.childNodes[0].textContent='Date';
  $('expiry').parentElement.childNodes[0].textContent='Expiry';
  const rail=document.createElement('div');rail.className='nt-rail';rail.innerHTML='<span id="sm-rail-start"></span><span id="sm-rail-end"></span>';
  rail.firstElementChild.after($('slider'));timebar.after(rail);
  $('status').classList.add('nt-status');rail.after($('status'));
  api.transport.hidden=true;$('context').hidden=true;
  const leftTabs=document.createElement('div');leftTabs.className='nt-tabs';leftTabs.id='sm-left-tabs';leftTabs.setAttribute('role','tablist');leftTabs.setAttribute('aria-label','Market panel');
  const chainTab=button('Option chain',()=>{leftView='chain';showPanels();},{role:'tab',id:'sm-left-chain-tab','aria-controls':'sm-left-chain-view'});
  const leftPositionTab=button('Positions (0)',()=>{leftView='positions';render();},{role:'tab',id:'sm-left-positions-tab','aria-controls':'sm-left-positions-view'});
  const expand=button('⤢',()=>{bench.classList.toggle('nt-chain-expanded');expand.setAttribute('aria-pressed',String(bench.classList.contains('nt-chain-expanded')));},{'aria-label':'Expand option chain','aria-pressed':'false'});
  leftTabs.append(chainTab,leftPositionTab,expand);
  const chainContent=document.createElement('div');chainContent.id='sm-left-chain-view';chainContent.setAttribute('role','tabpanel');chainContent.setAttribute('aria-labelledby','sm-left-chain-tab');
  for(const child of [...left.children])chainContent.append(child);left.append(leftTabs,chainContent);
  left.querySelector('.sm-section-head').hidden=true;
  const chainSettingsButton=button('☷',()=>openDialog('Option chain settings',api.chainSettings),{'aria-label':'Choose option-chain columns'});
  const switcher=h.querySelector('.sm-instrument-tabs');switcher.append(chainSettingsButton);
  const leftPositions=document.createElement('div');leftPositions.id='sm-left-positions-view';leftPositions.className='nt-left-positions';leftPositions.setAttribute('role','tabpanel');leftPositions.setAttribute('aria-labelledby','sm-left-positions-tab');left.append(leftPositions);
  leftPositions.onclick=e=>{const b=e.target.closest('[data-terminal-close]');if(b)api.act(()=>M.close(api.dataset(),api.session(),b.dataset.terminalClose));};
  const rightTabs=document.createElement('div');rightTabs.className='nt-tabs';rightTabs.id='sm-right-tabs';rightTabs.setAttribute('role','tablist');rightTabs.setAttribute('aria-label','Strategy panel');
  const payoffTab=button('Payoff',()=>selectRight('payoff'),{role:'tab',id:'sm-right-payoff-tab','aria-controls':'sm-right-payoff-view'});
  const rightPositionsTab=button('Positions (0)',()=>selectRight('positions'),{role:'tab',id:'sm-right-positions-tab','aria-controls':'sm-right-positions-view'});
  const sessionTab=button('Session',()=>selectRight('session'),{role:'tab',id:'sm-right-session-tab','aria-controls':'sm-right-session-view'});
  rightTabs.append(payoffTab,rightPositionsTab,sessionTab);right.prepend(rightTabs);
  analysis.id='sm-right-payoff-view';analysis.setAttribute('role','tabpanel');analysis.setAttribute('aria-labelledby','sm-right-payoff-tab');
  positions.id='sm-right-positions-view';positions.setAttribute('role','tabpanel');positions.setAttribute('aria-labelledby','sm-right-positions-tab');
  const session=document.createElement('section');session.id='sm-right-session-view';session.className='nt-session';session.setAttribute('role','tabpanel');session.setAttribute('aria-labelledby','sm-right-session-tab');right.append(session);
  function selectRight(view){rightView=view;if(view==='payoff'){chartModes.value='payoff';api.setTab('payoff');}render();}
  const originalTabs=api.tabbar;originalTabs.classList.add('nt-legacy-tabs');originalTabs.hidden=true;
  const riskbar=document.createElement('div');riskbar.className='nt-riskbar';riskbar.append($('pnl-strip'),$('risk'));analysis.prepend(riskbar);
  const pop=document.createElement('div');pop.id='sm-model-pop';pop.className='nt-pop';riskbar.append(pop);
  const chartModes=document.createElement('select');chartModes.id='sm-chart-view';chartModes.setAttribute('aria-label','Analysis view');
  for(const [value,label]of [['payoff','Payoff'],['scenario','Future scenario'],['history','Recorded P&L'],['contract','Contract history'],['underlying','Underlying chart'],['strategy','Strategy chart'],['combined','Strategy + underlying'],['trades','Trade log']])chartModes.add(new Option(label,value));
  chartModes.onchange=()=>{rightView='payoff';showPanels();api.setTab(chartModes.value);};rightTabs.append(chartModes);
  const tradebar=document.createElement('div');tradebar.className='nt-tradebar';
  positions.prepend(tradebar);
  const tradeTabs=document.createElement('div');tradeTabs.className='nt-tabs';tradeTabs.setAttribute('role','tablist');tradeTabs.setAttribute('aria-label','Position details');
  const tradesTab=button('Trades',()=>{tradeView='trades';render();},{role:'tab',id:'sm-trades-tab','aria-controls':'sm-trades-content'});
  const greeksTab=button('Greeks',()=>{tradeView='greeks';render();},{role:'tab',id:'sm-trade-greeks-tab','aria-controls':'sm-trade-greeks'});
  const clock=document.createElement('span');clock.id='sm-trade-clock';tradeTabs.append(tradesTab,greeksTab,clock);
  const tradeActions=document.createElement('div');tradeActions.className='nt-trade-actions';
  tradebar.append(tradeTabs,tradeActions);
  const ticket=$('ticket'),originalToggle=$('ticket-toggle').onclick;
  function addPosition(){if(ticket.hidden)originalToggle();openDialog('Add paper position',ticket);}
  $('ticket-toggle').onclick=addPosition;$('ticket-toggle').textContent='+ Add';
  tradeActions.append(button('▣ Save',()=>$('save').click()),$('ticket-toggle'),button('▦ Prebuilt',()=>openDialog('Prebuilt strategies',api.prebuilt)),$('close'),chainSettingsButton.cloneNode(true));
  tradeActions.lastElementChild.onclick=()=>openDialog('Position display settings',positionSettings);
  tradeActions.lastElementChild.textContent='✎ Columns';tradeActions.lastElementChild.setAttribute('aria-label','Position columns');
  $('close').textContent='Close all';tradebar.append(tradeTabs,tradeActions);
  positions.querySelector('h2').hidden=true;positions.prepend(tradebar);
  const tradeContent=document.createElement('div');tradeContent.id='sm-trades-content';tradeContent.setAttribute('role','tabpanel');tradeContent.setAttribute('aria-labelledby','sm-trades-tab');
  for(const node of [...positions.children])if(node!==tradebar)tradeContent.append(node);positions.append(tradeContent);
  const greekContent=document.createElement('div');greekContent.id='sm-trade-greeks';greekContent.setAttribute('role','tabpanel');greekContent.setAttribute('aria-labelledby','sm-trade-greeks-tab');positions.append(greekContent);
  const footer=document.createElement('div');footer.className='nt-order-footer';footer.append(document.createTextNode('ORDER LOTS'),$('lots').parentElement,button('+ Add position',addPosition));tradeContent.append(footer);
  $('reset').textContent='Clear into new session';$('ticket-cancel').addEventListener('click',closeDialog);
  const positionSettings=document.createElement('div');positionSettings.className='nt-position-settings';
  positionSettings.innerHTML='<p>Choose the columns shown in the trade table.</p>';
  const positionColumns=['Position','Units','Entry','Mark / exit','P&L','Actions'];
  positionColumns.forEach((name,index)=>{const label=document.createElement('label'),check=document.createElement('input');check.type='checkbox';check.checked=true;check.dataset.positionColumn=index;check.onchange=()=>{for(const row of $('positions').closest('table').rows)if(row.cells[index])row.cells[index].hidden=!check.checked;};label.append(check,document.createTextNode(name));positionSettings.append(label);});
  parking.append(positionSettings);
  const oiPanel=document.createElement('div');oiPanel.className='nt-aux';parking.append(oiPanel);
  function showAux(kind){auxView=kind;drawAux();openDialog(kind==='oi'?'Open interest by strike':'Underlying history',oiPanel);auxView=kind;}
  function drawAux(){
    const d=api.dataset(),s=api.session();if(!s)return;
    if(auxView==='oi'){
      const rows=M.chain(d,s,$('expiry').value).filter(r=>r.type!=='FUT'),strikes=[...new Set(rows.map(r=>r.strike))].sort((a,b)=>a-b),max=Math.max(1,...rows.map(r=>r.oi||0));
      oiPanel.innerHTML='<p>'+esc(s.symbol+' · '+s.cursor.replace('T',' ')+' IST · '+$('expiry').value)+'</p><p class="fine">'+(d.metadata?.synthetic?'Synthetic practice OI':'Recorded OI')+' · Missing observations remain unavailable.</p><div class="nt-oi-legend">Calls <i></i> Puts <i></i></div><div class="nt-oi-bars">'+strikes.map(k=>{const c=rows.find(r=>r.strike===k&&r.type==='CE'),p=rows.find(r=>r.strike===k&&r.type==='PE');return '<div><span>'+number(k)+'</span><div><i style="width:'+((c?.oi||0)/max*100)+'%"></i></div><b>'+compact(c?.oi)+'</b><div><i style="width:'+((p?.oi||0)/max*100)+'%"></i></div><b>'+compact(p?.oi)+'</b></div>';}).join('')+'</div>';
    }else{
      const points=M.frames(d,s).filter(at=>at<=s.cursor).map(at=>({at,price:M.spot(d,{...s,cursor:at})})),valid=points.filter(p=>p.price!==null),lo=Math.min(...valid.map(p=>p.price)),hi=Math.max(...valid.map(p=>p.price));
      oiPanel.innerHTML='<p>'+esc(s.symbol)+' · Through '+esc(s.cursor.replace('T',' '))+' IST</p><p class="fine">'+(d.metadata?.synthetic?'Synthetic practice reference prices':'Recorded underlying prices')+' · No future observations are included.</p>'+(valid.length?'<svg viewBox="0 0 800 300" role="img" aria-label="Recorded underlying price history"><polyline fill="none" stroke="var(--chart)" stroke-width="2" points="'+valid.map((p,i)=>(40+i/Math.max(1,valid.length-1)*720)+','+(260-(p.price-lo)/Math.max(1,hi-lo)*220)).join(' ')+'"/><text x="40" y="20">'+number(hi)+'</text><text x="40" y="290">'+number(lo)+'</text></svg>':'<p>No matching recorded underlying observations.</p>')+'<div class="table-scroll"><table><thead><tr><th>Snapshot · IST</th><th>Underlying</th></tr></thead><tbody>'+points.map(p=>'<tr><td>'+esc(p.at.replace('T',' '))+'</td><td>'+number(p.price)+'</td></tr>').join('')+'</tbody></table></div>';
    }
  }
  function showPanels(){
    chainContent.hidden=leftView!=='chain';leftPositions.hidden=leftView!=='positions';
    for(const [el,on]of [[chainTab,leftView==='chain'],[leftPositionTab,leftView==='positions'],[payoffTab,rightView==='payoff'],[rightPositionsTab,rightView==='positions'],[sessionTab,rightView==='session'],[tradesTab,tradeView==='trades'],[greeksTab,tradeView==='greeks']]){el.setAttribute('aria-selected',String(on));el.tabIndex=on?0:-1;}
    analysis.hidden=rightView!=='payoff';positions.hidden=rightView==='session';session.hidden=rightView!=='session';tradeContent.hidden=tradeView!=='trades';greekContent.hidden=tradeView!=='greeks';
  }
  // Arrow keys move through tabs using the same actions as pointer clicks.
  for(const list of [leftTabs,rightTabs,tradeTabs])list.addEventListener('keydown',e=>{if(!['ArrowLeft','ArrowRight','Home','End'].includes(e.key)||e.target.getAttribute('role')!=='tab')return;const tabs=[...list.querySelectorAll('[role=tab]')],i=tabs.indexOf(e.target),next=e.key==='Home'?0:e.key==='End'?tabs.length-1:(i+(e.key==='ArrowRight'?1:-1)+tabs.length)%tabs.length;e.preventDefault();tabs[next].click();tabs[next].focus();});
  for(const b of switcher.querySelectorAll('[data-sm-instrument]'))b.addEventListener('click',()=>api.refresh());
  api.chainSettings.addEventListener('change',()=>api.refresh());
  $('basis').addEventListener('change',()=>api.refresh());
  $('chain').addEventListener('click',e=>{if(e.target.closest('[data-contract-chart]')){rightView='payoff';chartModes.value='contract';showPanels();}});
  function chain(){
    const d=api.dataset(),s=api.session();if(!s)return;
    const expiry=$('expiry').value,rows=M.chain(d,s,expiry),ref=M.reference(d,s,expiry,$('atm-reference').value),futures=switcher.querySelector('[data-sm-instrument="futures"]').getAttribute('aria-pressed')==='true';
    const fields=[...$('columns').querySelectorAll('input[data-column]:checked')].map(el=>el.dataset.column).filter(k=>['oi','volume','iv','delta','theta','vega','gamma'].includes(k));
    const oiLots=$('columns').querySelector('[data-column="oiLots"]').checked;
    const columnName=k=>({oi:oiLots?'OI lots':'OI',volume:'Vol',iv:'IV %',delta:'Δ',theta:'Θ',vega:'Vega',gamma:'Γ'}[k]);
    const cols=fields.map(columnName),table=$('chain').closest('table');
    const actions=r=>r?'<span class="nt-bs"><button class="sm-buy" data-type="'+r.type+'" data-strike="'+r.strike+'" data-side="1" aria-label="Buy '+r.strike+' '+r.type+' at '+r.close+'" '+(r.volume===0||M.hasFuture(s)?'disabled':'')+'>B</button><button class="sm-sell" data-type="'+r.type+'" data-strike="'+r.strike+'" data-side="-1" aria-label="Sell '+r.strike+' '+r.type+' at '+r.close+'" '+(r.volume===0||M.hasFuture(s)?'disabled':'')+'>S</button></span>':'—';
    function dataCells(r,keys){
      const model=keys.some(k=>!['oi','volume'].includes(k))?contractModel(r,ref.price,$('atm-reference').value,s):{iv:null,greeks:null};
      return keys.map(k=>{const v=k==='oi'?(oiLots?(r?.lotSize&&r.oi!=null?r.oi/r.lotSize:null):r?.oi):k==='volume'?r?.volume:k==='iv'?model.iv:model.greeks?.[k];return '<td class="nt-field">'+(k==='oi'||k==='volume'?compact(v):number(v,k==='gamma'?6:2))+'</td>';}).join('');
    }
    table.querySelector('thead').hidden=false;
    if(futures){table.querySelector('thead').innerHTML='<tr><th>Expiry</th><th>LTP</th><th>OI</th><th>Volume</th><th>Trade</th></tr>';$('chain').innerHTML=rows.filter(r=>r.type==='FUT').map(r=>'<tr><th>'+esc(r.expiry)+'</th><td>'+number(r.close)+'</td><td>'+compact(r.oi)+'</td><td>'+compact(r.volume)+'</td><td>'+actions(r)+'</td></tr>').join('')||'<tr><td colspan="5">No recorded futures quotes at this snapshot.</td></tr>';return;}
    table.querySelector('thead').innerHTML='<tr><th>Call LTP</th>'+cols.map(k=>'<th>'+k+'</th>').join('')+'<th>Trade</th><th>Strike</th><th>Trade</th>'+cols.slice().reverse().map(k=>'<th>'+k+'</th>').join('')+'<th>Put LTP</th></tr>';
    const strikes=[...new Set(rows.filter(r=>r.type!=='FUT').map(r=>r.strike))].sort((a,b)=>a-b),atm=ref.atm??strikes[Math.floor(strikes.length/2)],index=strikes.indexOf(atm),above=$('above').value==='all'?Infinity:Number($('above').value),below=$('below').value==='all'?Infinity:Number($('below').value);
    const premium=r=>r?'<button class="nt-premium" data-contract-chart="'+r.type+'" data-contract-strike="'+r.strike+'" aria-label="Chart '+r.type+' '+r.strike+'" title="Open contract history">'+number(r.close)+'</button>':'—';
    $('chain').innerHTML=strikes.filter((k,i)=>i>=index-below&&i<=index+above).map(k=>{const c=rows.find(r=>r.type==='CE'&&r.strike===k),p=rows.find(r=>r.type==='PE'&&r.strike===k);return '<tr class="'+(k===atm?'sm-atm':'')+'"><td>'+premium(c)+'</td>'+dataCells(c,fields)+'<td>'+actions(c)+'</td><th>'+number(k)+'</th><td>'+actions(p)+'</td>'+dataCells(p,fields.slice().reverse())+'<td>'+premium(p)+'</td></tr>';}).join('')||'<tr><td colspan="'+(fields.length*2+5)+'">No matching recorded option quotes.</td></tr>';
  }
  function render(){
    const d=api.dataset(),s=api.session();if(!s)return;
    const v=M.valuation(d,s),count=v.positions.filter(p=>!p.closed).length,frames=M.frames(d,s),day=frames.filter(at=>at.startsWith(s.cursor.slice(0,10)));
    leftPositionTab.textContent=rightPositionsTab.textContent='Positions ('+count+')';
    $('rail-start').textContent=day[0]?.slice(11)||'';$('rail-end').textContent=day.at(-1)?.slice(11)||'';$('trade-clock').textContent=s.cursor.slice(11)+' IST';
    $('play').textContent=$('play').textContent==='Pause'?'Ⅱ Pause':'▶ Autoplay';
    leftPositions.innerHTML='<div class="table-scroll"><table><thead><tr><th>Position</th><th>Entry</th><th>LTP / exit</th><th>P&L</th><th></th></tr></thead><tbody>'+v.positions.map(p=>'<tr><td><b class="'+(p.side>0?'gain':'loss')+'">'+(p.side>0?'B':'S')+'</b> '+number(p.strike)+' '+p.type+'<small>'+esc(p.expiry)+' · '+p.lots+' lot'+(p.lots===1?'':'s')+'</small></td><td>'+number(p.entry)+'</td><td>'+number(p.mark)+'</td><td class="'+(p.pnl>=0?'gain':'loss')+'">'+number(p.pnl)+'</td><td>'+(p.closed?'Closed':'<button data-terminal-close="'+esc(p.id)+'">Exit</button>')+'</td></tr>').join('')+'</tbody></table></div>'+(v.positions.length?'':'<p class="nt-empty">Add positions from the option chain to begin.</p>');
    const a=referenceAnalytics(d,s,{basis:$('basis').value,expiry:$('expiry').value})||{positions:[],greeks:null,metrics:null};$('model-pop').innerHTML='<span>Model POP</span><strong>'+(a.metrics?.pop==null?'—':number(a.metrics.pop*100)+'%')+'</strong>';
    $('risk').innerHTML=[['Max profit (gross model)',a.metrics?.maxProfit===Infinity?'Unlimited':money(a.metrics?.maxProfit)],['Max loss (gross model)',a.metrics?.maxLoss===Infinity?'Unlimited':money(a.metrics?.maxLoss)],['Breakevens (gross model)',a.metrics?.breaks?.map(v=>number(v)).join(', ')||'—']].map(([label,value])=>'<dl><dt>'+label+'</dt><dd>'+value+'</dd></dl>').join('');
    greekContent.innerHTML='<p class="fine">Per-unit model sensitivities; signed position totals below. Gamma shown to six decimal places.</p><div class="table-scroll"><table><thead><tr><th>Position</th><th>Signed units</th><th>IV %</th><th>Δ</th><th>Θ / day</th><th>Γ</th><th>Vega / pp</th></tr></thead><tbody>'+a.positions.map(p=>'<tr><td>'+number(p.strike)+' '+p.type+'</td><td>'+p.side*p.units+'</td><td>'+number(p.iv)+'</td>'+['delta','theta','gamma','vega'].map(k=>'<td>'+number(p.greeks?.[k],k==='gamma'?6:2)+'</td>').join('')+'</tr>').join('')+'</tbody></table></div>'+(a.greeks?'<p class="fine">Signed totals: '+Object.entries(a.greeks).map(([k,value])=>esc(k)+' '+number(value,k==='gamma'?6:2)).join(' · ')+'</p>':'<p class="nt-empty">Add positions with matching underlying quotes to calculate Greeks.</p>');
    session.innerHTML='<h3>Replay session</h3><dl><dt>Symbol</dt><dd>'+esc(s.symbol)+'</dd><dt>Replay time</dt><dd>'+esc(s.cursor.replace('T',' '))+' IST</dd><dt>Data</dt><dd>'+esc(d.source)+'</dd><dt>Net P&L</dt><dd>'+money(v.net)+'</dd><dt>Executed costs</dt><dd>'+money(v.costs)+'</dd></dl><p class="fine">'+(d.metadata?.synthetic?'Synthetic teaching prices.':'Recorded quotes.')+' Past entries retain their original prices. Future scenarios never change recorded fills.</p><div id="sm-session-actions" class="button-row"></div><h3>Trade log</h3><div class="table-scroll"><table><thead><tr><th>Time · IST</th><th>Action</th><th>Contract / position</th><th>Fill</th><th>Costs</th></tr></thead><tbody>'+s.events.filter(e=>e.at<=s.cursor).map(e=>'<tr><td>'+esc(e.at.replace('T',' '))+'</td><td>'+esc(e.kind==='open'?(e.side>0?'Buy':'Sell'):'Close')+'</td><td>'+esc(e.kind==='open'?e.expiry+' '+e.strike+' '+e.type:e.positionId)+'</td><td>'+number(e.price)+'</td><td>'+number(e.cost)+'</td></tr>').join('')+'</tbody></table></div>';
    $('session-actions').append(button('Future scenario',()=>{rightView='payoff';showPanels();chartModes.value='scenario';api.setTab('scenario');}),button('Recorded P&L',()=>{rightView='payoff';showPanels();chartModes.value='history';api.setTab('history');}),button('Save session',()=>$('save').click()),button('Export backup',()=>$('export').click()));
    for(const check of positionSettings.querySelectorAll('input'))for(const row of $('positions').closest('table').rows)if(row.cells[check.dataset.positionColumn])row.cells[check.dataset.positionColumn].hidden=!check.checked;
    chain();showPanels();if(dialog.open&&auxView)drawAux();
  }
  return {render};
 }};
});

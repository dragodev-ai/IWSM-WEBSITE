(function () {
  'use strict';
  const $ = id => document.getElementById(id), host = $('options-research');
  if (!host) return;
  const R = window.IWSMResearch;
  if (!R) { $('research-dataset').textContent = 'The research calculator did not load. Reload this page to retry.'; return; }
  const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const valid = n => typeof n === 'number' && Number.isFinite(n);
  const num = (n, digits = 2) => valid(n) ? n.toLocaleString('en-IN', {maximumFractionDigits:digits}) : '—';
  const compact = n => valid(n) ? new Intl.NumberFormat('en-IN', {notation:'compact',maximumFractionDigits:1}).format(n) : '—';
  const unique = rows => [...new Set(rows)].sort();
  const optionRecords = () => dataset.contracts.filter(r=>r.type==='CE'||r.type==='PE');
  const sign = n => !valid(n) ? '' : n >= 0 ? 'gain' : 'loss';
  let dataset = {contracts:[],underlying:[]}, summary = null, dates = [], tab = 'oi', contractRows = [], timelineRows = [], lastRate=6, lastDividend=0;
  const views=['oi','iv','contract','history'];
  function options(id, values, previous, fallback) {
    const node = $(id); node.replaceChildren(...values.map(value => new Option(value, value)));
    node.value = values.includes(previous) ? previous : (fallback ?? values[0] ?? '');
    node.disabled = !values.length;
  }
  function currentSymbol() { return $('research-symbol').value; }
  function refreshData() {
    try { dataset = window.IWSMHistoryLab?.dataset() || structuredClone(window.IWSMNSEHistory || {contracts:[],underlying:[]}); }
    catch { dataset = {contracts:[],underlying:[]}; }
    dataset.contracts = Array.isArray(dataset.contracts) ? dataset.contracts : [];
    dataset.underlying = Array.isArray(dataset.underlying) ? dataset.underlying : [];
    const records=optionRecords();
    options('research-symbol', unique(records.map(r => r.symbol)), currentSymbol());
    const allDates = unique(records.map(r => r.date));
    $('research-dataset').textContent = `${dataset.source || 'Imported records · source not independently verified'} · ${num(records.length,0)} option observations · ${allDates.length} recorded date${allDates.length===1?'':'s'}${allDates.length ? ' · '+allDates[0]+' to '+allDates.at(-1) : ''}. This workspace shares the dataset loaded in the historical lab.`;
    const sourceItems = dataset.sources || dataset.metadata?.sources || [];
    const sourceCount = Array.isArray(sourceItems) ? sourceItems.length : 0;
    $('research-sources').textContent = `${sourceCount ? sourceCount+' source archive'+(sourceCount===1?'':'s')+' recorded. ' : ''}Source fields and archive links are available in the historical lab’s “Import formats, data sources & coverage” section. Open interest and volume keep the source’s units; they are not converted into lots.`;
    refreshDates();
  }
  function refreshDates() {
    dates = unique(optionRecords().filter(r => r.symbol === currentSymbol()).map(r => r.date));
    options('research-date', dates, $('research-date').value, dates.at(-1));
    refreshExpiries();
  }
  function refreshExpiries() {
    const date = $('research-date').value;
    const expiries = unique(optionRecords().filter(r => r.symbol === currentSymbol() && r.date === date).map(r => r.expiry));
    options('research-expiry', expiries, $('research-expiry').value, expiries.find(e=>e>=date) || expiries[0]);
    render();
  }
  function assumptionsValid() {
    let ok = true;
    for (const id of ['research-rate','research-dividend']) {
      const input = $(id), passed = input.checkValidity();
      if (passed) input.removeAttribute('aria-invalid'); else { input.setAttribute('aria-invalid','true'); ok = false; }
    }
    return ok;
  }
  function render() {
    const date = $('research-date').value, expiry = $('research-expiry').value;
    $('research-prev').disabled = dates.indexOf(date) <= 0;
    $('research-next').disabled = dates.indexOf(date) < 0 || dates.indexOf(date) >= dates.length-1;
    const hasData = Boolean(currentSymbol() && date && expiry);
    $('research-empty').hidden = hasData;
    $('research-export-snapshot').disabled = !hasData;
    for (const panel of views) $('research-panel-'+panel).hidden = !hasData || panel !== tab;
    if (!hasData) { summary = null; $('research-context').textContent = 'No contract observations in the current dataset. Import more data below.'; $('research-warnings').textContent = ''; return; }
    const assumptionsOK=assumptionsValid();
    if(assumptionsOK){lastRate=Number($('research-rate').value);lastDividend=Number($('research-dividend').value);}
    $('research-export-snapshot').disabled=!assumptionsOK;
    // OI and recorded premiums remain usable while IV assumptions are being edited.
    // Invalid fields never retain a prior date's research under new selectors.
    try { summary = R.summarize(dataset, {symbol:currentSymbol(),date,expiry,rate:lastRate,dividend:lastDividend}); }
    catch (error) { summary = null; $('research-context').textContent = 'Research calculation could not be completed: '+error.message; $('research-export-snapshot').disabled=true; $('research-export-contract').disabled=true; for(const name of views)$('research-panel-'+name).hidden=true; return; }
    $('research-context').textContent = `${summary.symbol} · ${date} close · expiry ${expiry} · reference ${valid(summary.spot)?'₹'+num(summary.spot):'unavailable'} · ${summary.rows.length} loaded strikes. ${summary.previousDate?'OI changes compare with '+summary.previousDate+'.':'No earlier recorded date for an OI comparison.'}${assumptionsOK?'':' Model IV is unavailable until rate and dividend inputs are valid.'}`;
    const warnings = [...new Set([...(summary.warnings || []), ...(dataset.warnings || []).slice(0,2)])];
    $('research-warnings').textContent = warnings.slice(0,5).join(' ') || 'This is recorded end-of-day research. It does not imply intraday availability, complete exchange coverage or executable fills.';
    renderOI(); renderIV(); refreshContracts(); refreshHistoryStrikes();
  }
  function metric(label, value, note, small = false) { return `<dl><dt>${esc(label)}</dt><dd${small?' class="research-value-small"':''}>${esc(value)}</dd>${note?'<small>'+esc(note)+'</small>':''}</dl>`; }
  function coverage(kind) {
    const c = summary.totals[kind+'Coverage'];
    if (c?.call && c?.put) return `${c.call.available}/${c.call.total} call and ${c.put.available}/${c.put.total} put records`;
    const rows = summary.rows;
    return `${rows.filter(r=>valid(r.call?.[kind])).length}/${rows.length} call and ${rows.filter(r=>valid(r.put?.[kind])).length}/${rows.length} put records`;
  }
  function renderOI() {
    if (!summary) return;
    const t = summary.totals;
    $('research-oi-summary').innerHTML = metric('Call open interest',compact(t.callOI),'Raw source units')+metric('Put open interest',compact(t.putOI),'Raw source units')+metric('Put / call OI ratio',num(t.pcr),'Loaded strikes only')+metric('Call traded volume',compact(t.callVolume),'Daily source quantity')+metric('Put traded volume',compact(t.putVolume),'Daily source quantity')+metric('Loaded-strike max pain',summary.maxPain ? '₹'+num(summary.maxPain.strike,0) : 'Unavailable','Partial chain estimate',!summary.maxPain);
    $('research-oi-coverage').textContent = `OI coverage: ${coverage('oi')}. Volume coverage: ${coverage('volume')}. A dash means missing; zero is a recorded zero.`;
    const rows = summary.rows, all = $('research-strike-range').value === 'all', count = 15;
    let shown = rows;
    if (!all && rows.length > count) {
      const index = rows.findIndex(r=>r.strike===summary.atm?.strike), center = index>=0 ? index : Math.floor(rows.length/2);
      const from = Math.max(0,Math.min(rows.length-count,center-Math.floor(count/2))); shown = rows.slice(from,from+count);
    }
    const maximum = shown.reduce((maximum,r)=>Math.max(maximum,valid(r.call?.oi)?r.call.oi:0,valid(r.put?.oi)?r.put.oi:0),1);
    const bar = (value, put) => `<div class="research-bar-track${put?' research-put':''}" title="${put?'Put':'Call'} OI: ${valid(value)?num(value,0):'unavailable'}"><i class="research-bar-fill" style="width:${valid(value)?Math.max(0,value)/maximum*100:0}%"></i><span>${compact(value)}</span></div>`;
    $('research-oi-bars').innerHTML = shown.map(r=>`<div class="research-bar-row${r.strike===summary.atm?.strike?' research-atm':''}">${bar(r.call?.oi,false)}<strong>${num(r.strike,0)}</strong>${bar(r.put?.oi,true)}</div>`).join('') || '<p class="research-chart-empty">No strike records for this selection.</p>';
    $('research-max-pain-note').textContent = summary.maxPain ? `Loaded-strike max pain is ₹${num(summary.maxPain.strike,0)}: the candidate strike with the lowest combined intrinsic payout across this loaded expiry. It excludes absent strikes and is not the full market’s max pain or a price forecast. Raw payout: ${num(summary.maxPain.payout,0)} price × source-OI units.` : 'Max pain is unavailable unless open interest is recorded on both sides of every loaded strike. Even a complete loaded subset is not necessarily the full exchange chain.';
    $('research-change-note').textContent = summary.previousDate ? `Change = current OI minus ${summary.previousDate} OI for the same symbol, expiry, strike and type. Missing earlier observations remain unavailable. Source units are unchanged.` : 'OI change needs an earlier recorded date for the same exact contracts. No earlier comparison is available for this selection.';
    $('research-oi-rows').innerHTML = rows.map(r=>`<tr${r.strike===summary.atm?.strike?' class="research-atm"':''}><th scope="row">${num(r.strike,0)}</th><td>${num(r.call?.oi,0)}</td><td class="${sign(r.callOIdelta)}">${num(r.callOIdelta,0)}</td><td>${num(r.call?.volume,0)}</td><td>${num(r.put?.oi,0)}</td><td class="${sign(r.putOIdelta)}">${num(r.putOIdelta,0)}</td><td>${num(r.put?.volume,0)}</td></tr>`).join('');
  }
  function chart(containerId, points, specs, config = {}) {
    const node = $(containerId), mobile = node.clientWidth < 600, W = mobile ? 460 : 1000, H = 280, L = mobile ? 60 : 78, right = 22, top = 22, bottom = 47;
    const values = points.flatMap(p=>specs.map(s=>p[s.key]).filter(valid));
    if (!values.length) { node.innerHTML = '<p class="research-chart-empty">'+esc(config.empty || 'No valid values for this selection. Missing records remain unavailable.')+'</p>'; return; }
    const {minX,maxX} = points.reduce((range,p)=>({minX:Math.min(range.minX,p.x),maxX:Math.max(range.maxX,p.x)}),{minX:Infinity,maxX:-Infinity});
    const {rawMin,rawMax} = values.reduce((range,n)=>({rawMin:Math.min(range.rawMin,n),rawMax:Math.max(range.rawMax,n)}),{rawMin:Infinity,rawMax:-Infinity});
    const spread = rawMax-rawMin, pad = Math.max(Math.abs(rawMax)*.06,spread*.12,.5), lo = Math.max(config.nonNegative===false ? -Infinity : 0,rawMin-pad), hi = rawMax+pad;
    const x = v => L+(W-L-right)*(maxX===minX?.5:(v-minX)/(maxX-minX)), y = v => top+(hi-v)/(hi-lo)*(H-top-bottom);
    let svg = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(config.label||'Recorded data chart. Exact values are available in the table.')}" focusable="false">`;
    for (let i=0;i<=4;i++) { const v = lo+(hi-lo)*i/4; svg += `<line class="research-grid" x1="${L}" x2="${W-right}" y1="${y(v)}" y2="${y(v)}"/><text x="${L-9}" y="${y(v)+4}" text-anchor="end">${esc(config.percent?num(v,1)+'%':compact(v))}</text>`; }
    const stride = Math.max(1,Math.ceil(points.length/(mobile?4:6)));
    points.forEach((p,i)=> { if (i%stride===0 || i===points.length-1) { if (i!==points.length-1 && points.length-1-i<stride*.6) return; svg += `<text x="${x(p.x)}" y="${H-17}" text-anchor="${i===0?'start':i===points.length-1?'end':'middle'}">${esc(p.label)}</text>`; } });
    if (valid(config.reference) && config.reference>=minX && config.reference<=maxX) svg += `<line class="research-ref" x1="${x(config.reference)}" x2="${x(config.reference)}" y1="${top}" y2="${H-bottom}"/>`;
    for (const spec of specs) {
      let segment = [];
      const flush = () => { if (segment.length>1) svg += `<polyline fill="none" stroke="${spec.color}" stroke-width="2.5"${spec.dash?' stroke-dasharray="6 4"':''} points="${segment.join(' ')}"/>`; segment = []; };
      for (const p of points) { const value = p[spec.key]; if (!valid(value)) { flush(); continue; } segment.push(x(p.x)+','+y(value)); svg += `<circle cx="${x(p.x)}" cy="${y(value)}" r="${points.length>30?1.7:3.2}" fill="${spec.color}"><title>${esc(spec.label+': '+p.label+' · '+num(value)+(config.percent?'%':''))}</title></circle>`; }
      flush();
    }
    svg += '</svg>'; node.innerHTML = svg;
  }
  function renderIV() {
    if (!summary) return;
    const atm = summary.atm, assumptionsOK=assumptionsValid();
    $('research-iv-summary').innerHTML = metric('Nearest reference strike',atm?'₹'+num(atm.strike,0):'Unavailable','Loaded strikes only')+metric('Call + put closing premium',atm&&valid(atm.straddle)?'₹'+num(atm.straddle):'Unavailable','At the same nearest strike')+metric('Mean close-implied IV',assumptionsOK&&atm&&valid(atm.iv)?num(atm.iv)+'%':'Unavailable','Requires identified call & put IV');
    if(!assumptionsOK){$('research-iv-chart').innerHTML='<p class="research-chart-empty">Enter a valid rate (−10 to 100%) and dividend yield (0 to 100%) to calculate model IV.</p>';$('research-iv-rows').replaceChildren();return;}
    chart('research-iv-chart',summary.rows.map(r=>({x:r.strike,label:num(r.strike,0),call:r.callIV,put:r.putIV})),[{key:'call',label:'Call model IV',color:'var(--chart)'},{key:'put',label:'Put model IV',color:'var(--scenario)',dash:true}],{percent:true,reference:summary.spot,label:'Model implied volatility by strike. Calls are solid and puts dashed; missing estimates are gaps. Exact values are in the table.'});
    $('research-iv-rows').innerHTML = summary.rows.map(r=>`<tr${r.strike===atm?.strike?' class="research-atm"':''}><th scope="row">${num(r.strike,0)}</th><td>${num(r.call?.close)}</td><td>${num(r.callIV)}</td><td>${num(r.put?.close)}</td><td>${num(r.putIV)}</td></tr>`).join('');
  }
  function refreshContracts() {
    const prior = $('research-contract').value;
    const records = optionRecords().filter(r=>r.symbol===summary.symbol && r.expiry===summary.expiry);
    const contracts = [...new Map(records.map(r=>[r.strike+'|'+r.type,{value:r.strike+'|'+r.type,strike:r.strike,type:r.type}])).values()].sort((a,b)=>a.strike-b.strike||a.type.localeCompare(b.type));
    $('research-contract').replaceChildren(...contracts.map(r=>new Option(`${num(r.strike,0)} · ${r.type==='CE'?'Call (CE)':'Put (PE)'}`,r.value)));
    const preferred = (summary.atm?.strike || contracts[0]?.strike)+'|CE';
    $('research-contract').value = contracts.some(r=>r.value===prior)?prior:contracts.some(r=>r.value===preferred)?preferred:contracts[0]?.value || '';
    renderContract();
  }
  function renderContract() {
    if (!summary) return;
    const value = $('research-contract').value, [strike,type] = value.split('|');
    const exact = value ? R.series(dataset,{symbol:summary.symbol,expiry:summary.expiry,strike:Number(strike),type}) : [];
    const byDate = new Map(exact.map(r=>[r.date,r]));
    contractRows = dates.map(date=>byDate.get(date)||{date,close:null,oi:null,volume:null,spot:dataset.underlying.find(r=>r.symbol===summary.symbol&&r.date===date)?.close??null,missing:true});
    $('research-export-contract').disabled = !exact.length;
    $('research-contract-caption').textContent = `${summary.symbol} · ${num(Number(strike),0)} ${type || ''} · expiry ${summary.expiry} · ${exact.length} recorded observations across ${dates.length} loaded dates. A gap means no record for this exact contract; records with zero traded volume may carry stale closes.`;
    const points = contractRows.map((r,i)=>({x:i,label:r.date.slice(5),close:r.close,oi:r.oi}));
    chart('research-contract-price',points,[{key:'close',label:'Recorded close',color:'var(--chart)'}],{label:'Historical close for the selected option contract in rupees. Missing observations are gaps. Exact values are in the table.'});
    chart('research-contract-oi',points,[{key:'oi',label:'Open interest',color:'var(--scenario)'}],{label:'Historical open interest for the selected option contract in raw source units. Missing observations are gaps. Exact values are in the table.'});
    $('research-contract-rows').innerHTML = contractRows.map(r=>`<tr${r.date===summary.date?' class="research-current"':''}><th scope="row">${esc(r.date)}</th><td>${num(r.close)}</td><td>${num(r.oi,0)}</td><td>${num(r.volume,0)}</td><td>${num(r.spot)}</td><td>${r.missing?'Missing record':r.volume===0?'Zero traded volume':'Recorded EOD'}</td></tr>`).join('');
  }
  function refreshHistoryStrikes(){
    const previous=$('research-history-strike').value;
    const strikes=[...new Set(optionRecords().filter(r=>r.symbol===summary.symbol&&r.expiry===summary.expiry).map(r=>r.strike))].sort((a,b)=>a-b);
    $('research-history-strike').replaceChildren(...strikes.map(strike=>new Option(num(strike,0),String(strike))));
    $('research-history-strike').value=strikes.some(strike=>String(strike)===previous)?previous:String(summary.atm?.strike??strikes[0]??'');
    timelineRows=[];if(tab==='history')renderHistory();
  }
  function renderHistory(){
    if(!summary)return;
    if(typeof R.timeline!=='function'){$('research-history-caption').textContent='The historical research calculator did not load. Reload the page to retry.';$('research-export-history').disabled=true;return;}
    const strike=Number($('research-history-strike').value);
    try{timelineRows=R.timeline(dataset,{symbol:summary.symbol,expiry:summary.expiry,rate:lastRate,dividend:lastDividend,strike});}
    catch(error){timelineRows=[];$('research-history-caption').textContent='Historical research could not be completed: '+error.message;$('research-export-history').disabled=true;for(const id of ['research-history-pcr','research-history-oi','research-history-straddle','research-history-rows'])$(id).replaceChildren();return;}
    $('research-export-history').disabled=!timelineRows.length;
    $('research-history-caption').textContent=`${summary.symbol} · expiry ${summary.expiry} · ${timelineRows.length} loaded recorded dates${timelineRows.length?' · '+timelineRows[0].date+' to '+timelineRows.at(-1).date:''} · fixed straddle strike ₹${num(strike,0)}. Missing call/put observations remain gaps. These are end-of-day series, not intraday histories.`;
    const points=timelineRows.map((r,i)=>({x:i,label:r.date.slice(5),pcr:r.pcr,callOI:r.callOI,putOI:r.putOI,straddle:r.fixedStraddle})),reference=timelineRows.findIndex(r=>r.date===summary.date);
    chart('research-history-pcr',points,[{key:'pcr',label:'Put / call OI ratio',color:'var(--chart)'}],{reference,label:'Historical put to call open interest ratio over loaded dates for one expiry. Exact values are in the table.'});
    chart('research-history-oi',points,[{key:'callOI',label:'Total call OI',color:'var(--chart)'},{key:'putOI',label:'Total put OI',color:'var(--scenario)',dash:true}],{reference,label:'Historical call and put total open interest over loaded dates, in unchanged source units. Exact values are in the table.'});
    chart('research-history-straddle',points,[{key:'straddle',label:'Fixed-strike straddle premium',color:'var(--chart)'}],{reference,label:`Historical call plus put closing premium for fixed strike ${strike} and expiry ${summary.expiry}, in rupees. Missing observations remain gaps.`});
    $('research-history-rows').innerHTML=timelineRows.map(r=>`<tr${r.date===summary.date?' class="research-current"':''}><th scope="row">${esc(r.date)}</th><td>${num(r.spot)}</td><td>${num(r.callOI,0)}</td><td>${num(r.putOI,0)}</td><td>${num(r.pcr)}</td><td>${num(r.maxPain,0)}</td><td>${num(r.atmStrike,0)}</td><td>${num(r.atmStraddle)}</td><td>${num(r.fixedStraddle)}</td></tr>`).join('');
  }
  function activate(next, focus) {
    tab = next;
    for (const button of host.querySelectorAll('[data-research-tab]')) { const selected = button.dataset.researchTab===tab; button.setAttribute('aria-selected',String(selected)); button.tabIndex = selected?0:-1; if (selected && focus) button.focus(); }
    for (const name of views) $('research-panel-'+name).hidden = !summary || name!==tab;
    if (tab==='iv') renderIV(); else if (tab==='contract') renderContract(); else if(tab==='history')renderHistory();
  }
  host.querySelector('.research-tabs').addEventListener('click',e=> { const b=e.target.closest('[data-research-tab]'); if (b) activate(b.dataset.researchTab,false); });
  host.querySelector('.research-tabs').addEventListener('keydown',e=> {
    const items = views, index = items.indexOf(tab); let next;
    if (e.key==='ArrowRight') next=items[(index+1)%items.length]; else if (e.key==='ArrowLeft') next=items[(index+items.length-1)%items.length]; else if(e.key==='Home') next=items[0]; else if(e.key==='End') next=items.at(-1); else return;
    e.preventDefault(); activate(next,true);
  });
  function exportCSV(records, name) {
    if (!records.length) return;
    const headers = Object.keys(records[0]), cell = value => { let s=value==null?'':String(value); if(typeof value!=='number' && /^[\t\r\n ]*[=+\-@]/.test(s)) s="'"+s; return '"'+s.replaceAll('"','""')+'"'; };
    const csv = '\uFEFF'+[headers.map(cell).join(','),...records.map(r=>headers.map(k=>cell(r[k])).join(','))].join('\r\n');
    const url = URL.createObjectURL(new Blob([csv],{type:'text/csv;charset=utf-8'})), a=document.createElement('a'); a.href=url; a.download=name.replace(/[^a-z0-9_.-]/gi,'-'); document.body.append(a); a.click(); a.remove(); setTimeout(()=>URL.revokeObjectURL(url),1000);
  }
  $('research-export-snapshot').onclick = () => {
    if (!summary) return;
    const s=summary; exportCSV(s.rows.map(r=>({symbol:s.symbol,date:s.date,expiry:s.expiry,underlying_value:s.spot,strike:r.strike,call_close:r.call?.close,call_oi:r.call?.oi,call_oi_change:r.callOIdelta,call_volume:r.call?.volume,put_close:r.put?.close,put_oi:r.put?.oi,put_oi_change:r.putOIdelta,put_volume:r.put?.volume,call_model_iv_pct:r.callIV,put_model_iv_pct:r.putIV,model_rate_pct:Number($('research-rate').value),model_dividend_pct:Number($('research-dividend').value),oi_comparison_date:s.previousDate,source:dataset.source||'Imported records',coverage_note:'Loaded strikes only; raw source OI/volume units; IV is model-implied from EOD closes'})),`iwsm-${s.symbol}-${s.date}-${s.expiry}-research.csv`);
  };
  $('research-export-contract').onclick = () => { if (!summary) return; const [strike,type]=$('research-contract').value.split('|'); exportCSV(contractRows.map(r=>({symbol:summary.symbol,expiry:summary.expiry,strike:Number(strike),type,date:r.date,close:r.close,oi:r.oi,volume:r.volume,underlying_value:r.spot,observation:r.missing?'Missing record':r.volume===0?'Zero traded volume':'Recorded EOD',source:dataset.source||'Imported records'})),`iwsm-${summary.symbol}-${summary.expiry}-${strike}-${type}-history.csv`); };
  $('research-export-history').onclick=()=>{if(!summary||!timelineRows.length)return;const strike=Number($('research-history-strike').value);exportCSV(timelineRows.map(r=>({symbol:summary.symbol,expiry:summary.expiry,date:r.date,underlying_value:r.spot,call_oi:r.callOI,put_oi:r.putOI,pcr_loaded_strikes:r.pcr,max_pain_loaded_strikes:r.maxPain,rolling_atm_strike:r.atmStrike,rolling_atm_straddle_close:r.atmStraddle,fixed_straddle_strike:strike,fixed_straddle_close:r.fixedStraddle,source:dataset.source||'Imported records',coverage_note:'EOD loaded strikes only; raw source OI units; changing rolling ATM strikes do not represent held-position P&L'})),`iwsm-${summary.symbol}-${summary.expiry}-${strike}-oi-straddle-history.csv`);};
  $('research-symbol').onchange = refreshDates;
  $('research-date').onchange = refreshExpiries;
  $('research-expiry').onchange = render;
  $('research-strike-range').onchange = renderOI;
  $('research-contract').onchange = renderContract;
  $('research-history-strike').onchange=renderHistory;
  $('research-prev').onclick = () => { const i=dates.indexOf($('research-date').value); if(i>0){$('research-date').value=dates[i-1];refreshExpiries();} };
  $('research-next').onclick = () => { const i=dates.indexOf($('research-date').value); if(i>=0 && i<dates.length-1){$('research-date').value=dates[i+1];refreshExpiries();} };
  for (const id of ['research-rate','research-dividend']) $(id).oninput = render;
  window.addEventListener('iwsm:history-data-changed',refreshData);
  let resizeTimer;
  window.addEventListener('resize',()=>{clearTimeout(resizeTimer);resizeTimer=setTimeout(()=>{if(tab==='iv')renderIV();else if(tab==='contract')renderContract();else if(tab==='history')renderHistory();},100);});
  refreshData();
})();

(function () {
  'use strict';
  const H = window.IWSMHistory, E = window.IWSMStrategy, $ = id => document.getElementById(id);
  if (!H || !E || !$('historical-lab')) return;
  const esc = value => String(value).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const num = (value, digits = 2) => value == null ? '—' : Number(value).toLocaleString('en-IN', {maximumFractionDigits:digits});
  const money = value => value == null ? 'Not available' : !Number.isFinite(value) ? 'Unlimited' : new Intl.NumberFormat('en-IN', {style:'currency',currency:'INR',maximumFractionDigits:0}).format(value);
  const signClass = value => value == null ? '' : value >= 0 ? 'gain' : 'loss';
  const dayDiff = (a, b) => Math.round((Date.parse(b+'T00:00:00Z')-Date.parse(a+'T00:00:00Z'))/86400000);
  let dataset = window.IWSMNSEHistory || {underlying:[],contracts:[],warnings:[],source:''};
  let positions = [], result = null, timer = null, cursor = 0, comparisons = [], dataRevision=0;
  const snapshot = () => window.IWSMLab.snapshot();
  const optionRows = () => dataset.contracts.filter(r => r.symbol === $('history-symbol').value && r.date === $('history-start').value);
  function message(text) { $('history-status').textContent = text; }
  function pause() { if (timer) clearInterval(timer); timer = null; $('history-play').textContent = 'Play replay'; }
  function invalidate(text = 'Inputs changed. Run historical replay to update the results.') { pause(); result = null; $('history-results').hidden = true; message(text); }
  function selectOptions(id, values, previous) {
    const node = $(id); node.replaceChildren(...values.map(value => new Option(value, value)));
    if (previous && values.includes(previous)) node.value = previous;
  }
  function sourceDescription() {
    const dates = [...new Set([...dataset.contracts,...dataset.underlying].map(r=>r.date))].sort();
    const source = dataset.source || 'Imported files · source not independently verified';
    $('history-data-status').textContent = `${source}\n${num(dataset.contracts.length,0)} contract observations · ${num(dataset.underlying.length,0)} underlying observations · ${dates[0]||'no dates'} to ${dates.at(-1)||'no dates'}${dataset.metadata?.missedDates?.length?'\n'+dataset.metadata.missedDates.length+' requested calendar dates have no verified archive. See coverage and sources below.':''}`;
    document.querySelector('#historical-lab .history-source-badge').textContent=/^NSE /.test(source)?'NSE · end of day':'Imported · end of day';
    const provenance = $('history-provenance'); provenance.replaceChildren();
    if (dataset === window.IWSMNSEHistory || Array.isArray(dataset.metadata?.sources)) {
      const p = document.createElement('p'); p.textContent = 'Official source archives for the included data:'; provenance.append(p);
      const links = document.createElement('div'); links.className = 'history-provenance-links';
      const sources=dataset.metadata?.sources||dates.map(date=>({date,url:archiveURL(date)}));
      for (const item of sources) { if(!/^https:\/\/nsearchives\.nseindia\.com\/content\/fo\//.test(item.url||''))continue;const a = document.createElement('a'); a.href = item.url; a.textContent = item.date+' ↗'; a.target='_blank'; a.rel='noopener'; a.className='history-link'; links.append(a); }
      provenance.append(links);
    }
    const warnings = dataset.warnings || [];
    if (warnings.length) { const p = document.createElement('p'); p.textContent = warnings.slice(0,8).join(' ')+(warnings.length>8 ? ` ${warnings.length-8} more import warnings are included in the Excel export.` : ''); provenance.append(p); }
  }
  function refreshSymbols() {
    const records = $('history-mode').value === 'model' ? dataset.underlying : dataset.contracts;
    const symbols = [...new Set(records.map(r=>r.symbol))].sort();
    selectOptions('history-symbol', symbols, $('history-symbol').value);
    refreshDates();
  }
  function refreshDates() {
    const symbol = $('history-symbol').value, records = $('history-mode').value === 'model' ? dataset.underlying : dataset.contracts;
    const dates = [...new Set(records.filter(r=>r.symbol===symbol).map(r=>r.date))].sort();
    const oldStart = $('history-start').value, oldEnd = $('history-end').value;
    selectOptions('history-start', dates, oldStart); selectOptions('history-end', dates, oldEnd || dates.at(-1));
    if (!oldEnd && dates.length) $('history-end').value = dates.at(-1);
    clearPositions(); refreshExpiry();
  }
  function refreshExpiry() {
    const expiries = [...new Set(optionRows().map(r=>r.expiry))].sort();
    selectOptions('history-expiry',expiries,$('history-expiry').value); refreshATM(); renderChain();
    updateModelDescription();
  }
  function refreshATM(){const rows=optionRows().filter(r=>r.expiry===$('history-expiry').value&&r.type!=='FUT'),strikes=[...new Set(rows.map(r=>r.strike))].sort((a,b)=>a-b),ref=entryReference();selectOptions('history-atm',strikes.map(String));if(Number.isFinite(ref)&&strikes.length)$('history-atm').value=String(strikes.reduce((a,b)=>Math.abs(b-ref)<Math.abs(a-ref)?b:a));else $('history-atm').insertBefore(new Option('Select strike','',true,true),$('history-atm').firstChild);}
  function entryReference() { return dataset.underlying.find(r=>r.symbol===$('history-symbol').value && r.date===$('history-start').value)?.close; }
  function renderChain() {
    const contracts = optionRows().filter(r=>r.expiry===$('history-expiry').value), rows=contracts.filter(r=>r.type!=='FUT'), strikes = [...new Set(rows.map(r=>r.strike))].sort((a,b)=>a-b);
    const reference = entryReference(), nearest = reference == null ? null : strikes.reduce((best,k)=>Math.abs(k-reference)<Math.abs(best-reference)?k:best,strikes[0]);
    const mark = r => r ? `<span class="history-contract-price ${r.type==='CE'?'call-price':'put-price'}">${num(r.close)}</span><button type="button" data-type="${r.type}" data-strike="${r.strike}" data-side="1" aria-label="Buy historical ${r.strike} ${r.type}">B</button><button type="button" data-type="${r.type}" data-strike="${r.strike}" data-side="-1" aria-label="Sell historical ${r.strike} ${r.type}">S</button>${r.volume===0?'<small title="No recorded trades on this date"> · no trades</small>':''}` : '—';
    $('history-chain').innerHTML = contracts.filter(r=>r.type==='FUT').map(r=>`<tr><td>${mark(r)}</td><td>${num(r.oi,0)}</td><th scope="row">Future</th><td colspan="2">Recorded futures close</td></tr>`).join('')+strikes.map(k=>{const ce=rows.find(r=>r.strike===k&&r.type==='CE'),pe=rows.find(r=>r.strike===k&&r.type==='PE');return `<tr ${k===nearest?'class="atm-row"':''}><td>${mark(ce)}</td><td>${num(ce?.oi,0)}</td><th scope="row">${num(k,0)}</th><td>${mark(pe)}</td><td>${num(pe?.oi,0)}</td></tr>`;}).join('');
  }
  function renderPositions() {
    $('history-legs').innerHTML = positions.map((p,i)=>`<tr><td class="${p.side===1?'gain':'loss'}">${p.side===1?'Buy':'Sell'}</td><td>${num(p.strike,0)} ${p.type}</td><td>${esc(p.expiry)}</td><td>${num(p.premium)}</td><td><input type="number" min="1" max="100" step="1" value="${p.lots}" data-hleg="${i}" data-hfield="lots" aria-label="Historical leg ${i+1} lots"></td><td><input type="number" min="1" max="1000000" step="1" value="${p.lotSize}" data-hleg="${i}" data-hfield="lotSize" aria-label="Historical leg ${i+1} units per lot"></td><td><button type="button" data-hremove="${i}" aria-label="Remove historical leg ${i+1}">×</button></td></tr>`).join('');
    $('history-position-note').textContent = positions.length ? `${positions.length} historical legs. Entries use the exact selected date’s closing prices; recorded lot sizes are used where provided. Quantities remain editable.` : 'Choose a structure or add contracts from the recorded option chain.';
  }
  function clearPositions() { positions = []; renderPositions(); invalidate('Select a structure or add historical contracts, then run replay.'); }
  function legFromRecord(row, side, lots) {
    const fallback = row.lotSize || Number($('history-units').value);
    if (!Number.isInteger(lots) || lots<1 || lots>100 || !Number.isInteger(fallback) || fallback<1 || fallback>1000000) throw Error('Use whole-number lots (1–100) and units per lot (1–1,000,000).');
    return {type:row.type,strike:row.strike,expiry:row.expiry,side,lots,lotSize:row.lotSize || fallback,premium:row.close};
  }
  $('history-chain').onclick = e => {
    const b=e.target.closest('[data-type]'); if(!b) return;
    try { if (positions.length>=24) throw Error('A replay can contain up to 24 legs.');
      const row=optionRows().find(r=>r.expiry===$('history-expiry').value&&r.strike===Number(b.dataset.strike)&&r.type===b.dataset.type);
      if (!row) throw Error('This contract has no entry-date price.');
      positions.push(legFromRecord(row,Number(b.dataset.side),Number($('history-lots').value))); renderPositions(); invalidate('Historical contract added. Run replay to calculate the recorded path.');
    } catch(error) { message(error.message); }
  };
  $('history-legs').onclick = e => { const b=e.target.closest('[data-hremove]'); if(b){positions.splice(Number(b.dataset.hremove),1);renderPositions();invalidate();} };
  $('history-legs').oninput = e => { const f=e.target.dataset.hfield,i=Number(e.target.dataset.hleg); if(!f||!positions[i])return; invalidate(); if(!e.target.checkValidity()){e.target.setAttribute('aria-invalid','true');message('Correct the highlighted historical quantity before replaying.');return;}e.target.removeAttribute('aria-invalid');positions[i][f]=Number(e.target.value); };
  $('history-clear').onclick = clearPositions;
  $('history-load-preset').onclick = () => {
    try {
      const template=E.templates[Number($('history-preset').value)], rows=optionRows(), expiry=$('history-expiry').value, reference=Number($('history-atm').value)||entryReference();
      if (!template || !expiry) throw Error('Load contract data and choose an entry date and expiry first.');
      if (template.legs.every(l=>l[1]==='FUT')) {
        const row=rows.find(r=>r.expiry===expiry&&r.type==='FUT');
        if(!row)throw Error('No futures contract is recorded for this expiry. Choose a monthly expiry with a Future row in the recorded chain.');
        positions=template.legs.map(([side])=>legFromRecord(row,side,Number($('history-lots').value)));renderPositions();invalidate('Futures positions loaded from recorded entry closes. Run replay to calculate.');return;
      }
      if (!Number.isFinite(reference)) throw Error('Choose an ATM strike from the recorded chain first.');
      const strikes=[...new Set(rows.filter(r=>r.expiry===expiry&&r.type!=='FUT').map(r=>r.strike))].sort((a,b)=>a-b);
      const steps=strikes.slice(1).map((k,i)=>k-strikes[i]).filter(x=>x>0),step=Math.min(...steps);
      if (!Number.isFinite(step)) throw Error('The preset needs at least two listed strikes. Add contracts individually instead.');
      const atm=strikes.reduce((best,k)=>Math.abs(k-reference)<Math.abs(best-reference)?k:best,strikes[0]);
      const expiries=[...new Set(rows.map(r=>r.expiry))].sort(), later=expiries.find(x=>x>expiry), baseLot=Number($('history-lots').value);
      const next=template.legs.map(([side,type,offset,lots=1,extra=0])=>{
        const legExpiry=extra?later:expiry, strike=atm+offset*step;
        if (!legExpiry) throw Error('This calendar structure needs a later expiry in the entry-date file.');
        const row=rows.find(r=>r.expiry===legExpiry&&r.strike===strike&&r.type===type);
        if (!row) throw Error(`No recorded ${strike} ${type} close for ${legExpiry}. Choose another structure or add contracts from the chain.`);
        return legFromRecord(row,side,lots*baseLot);
      });
      positions=next;renderPositions();invalidate(`${template.name} loaded from recorded entry closes. ATM ${num(atm,0)}, strike step ${num(step,0)}. ${template.legs.some(l=>l[4])?'Long legs use the next available listed expiry. ':''}Run replay to see results.`);
    }catch(error){clearPositions();message(error.message+' No structure was loaded.');}
  };
  function updateModelDescription() {
    const state=snapshot(), active=state.legs.filter(l=>l.enabled!==false);
    $('history-model-description').textContent=`${active.length} enabled legs · ${state.symbol} structure · ${state.lotSize} units per lot · IV ${num(state.iv)}% · rate ${num(state.rate)}% · dividend ${num(state.dividend)}%. Historical reference: ${$('history-symbol').value||'none selected'}. This study uses the selected historical series even if its symbol differs from the main builder.`;
  }
  $('history-mode').onchange=()=>{const model=$('history-mode').value==='model';$('history-model').hidden=!model;$('history-observed').hidden=model;refreshSymbols();invalidate(model?'The main builder’s enabled legs will be re-priced on the selected historical underlying.':'Choose historical contracts, then run replay.');};
  $('history-symbol').onchange=refreshDates;
  $('history-start').onchange=()=>{clearPositions();refreshExpiry();};
  $('history-expiry').onchange=()=>{refreshATM();renderChain();invalidate();};
  $('history-atm').onchange=()=>invalidate('ATM changed. Load the structure again to replace its positions.');
  $('history-end').onchange=()=>invalidate();
  for(const id of ['history-fees','history-slippage'])$(id).oninput=()=>invalidate();
  let lastSnapshotKey=JSON.stringify(snapshot());
  window.addEventListener('iwsm:strategy-changed',()=>{updateModelDescription();const key=JSON.stringify(snapshot());if(key!==lastSnapshotKey&&$('history-mode').value==='model')invalidate('Builder positions changed. Run the model replay again.');lastSnapshotKey=key;});
  $('history-run').onclick=()=>{
    try{
      for(const id of ['history-fees','history-slippage'])if(!$(id).checkValidity())throw Error('Fees and slippage must be valid, non-negative numbers.');
      if($('history-legs').querySelector('[aria-invalid="true"]'))throw Error('Correct the highlighted quantity before running replay.');
      const cfg={symbol:$('history-symbol').value,start:$('history-start').value,end:$('history-end').value,feesPerOrder:Number($('history-fees').value),slippage:Number($('history-slippage').value),legs:positions};
      if($('history-mode').value==='model'&&snapshot().currency!=='INR')throw Error('Historical values in this workspace are in rupees. Change the main builder currency to INR before model replay.');
      result=$('history-mode').value==='observed'?H.replayObserved(dataset,cfg):H.replayModel(snapshot(),dataset,cfg);
      result.symbol=cfg.symbol;result.source=dataset.source || 'Imported files · source not independently verified';result.costAssumptions={feesPerOrder:cfg.feesPerOrder,slippage:cfg.slippage};
      result.provenance=dataset.metadata||{};
      for(const row of result.rows)if(row.spot==null)row.spot=dataset.underlying.find(r=>r.symbol===cfg.symbol&&r.date===row.date)?.close??null;
      const illiquid=result.mode==='observed'?dataset.contracts.filter(r=>r.symbol===cfg.symbol&&r.date>=result.entryDate&&r.date<=result.effectiveEnd&&r.volume===0&&positions.some(p=>p.type===r.type&&p.expiry===r.expiry&&p.strike===r.strike)).length:0;
      if(illiquid)result.warnings.push(`${illiquid} selected contract observations have zero recorded traded quantity. Their published closes may be stale and are not executable fills.`);
      if(result.effectiveEnd!==cfg.end)result.warnings.push('Replay was cut off at the earliest leg expiry; later-expiry legs are not rolled or settled automatically.');
      pause();cursor=0;renderResult();message(result.complete?'Replay calculated. Read the data coverage and cost assumptions with the results.':'Replay has incomplete final prices. Final P&L is unavailable; gaps are shown.');
    }catch(error){invalidate(error.message);}
  };
  $('history-save-replay').onclick=()=>{if(!result||result.mode!=='observed'||!result.complete){message('Run a complete recorded-price replay before saving.');return;}window.dispatchEvent(new CustomEvent('iwsm:save-replay',{detail:{symbol:result.symbol,start:result.entryDate,end:result.effectiveEnd,net:result.summary.net,gross:result.summary.gross,costs:result.summary.costs,legs:structuredClone(result.legs),source:result.source}}));};
  function renderResult(){
    $('history-results').hidden=false;
    $('history-result-caption').textContent=`${result.symbol} · ${result.label} · ${result.entryDate} → ${result.effectiveEnd} · ${result.source}`;
    const s=result.summary, cards=[['Final gross P&L',money(s.gross),signClass(s.gross)],['Round-trip costs',money(s.costs),''],['Final net P&L',money(s.net),signClass(s.net)],['Max drawdown',money(s.maxDrawdown),'loss'],['Complete observations',String(s.completeDays),''],['Missing observations',String(s.missingDays),s.missingDays?'loss':'']];
    $('history-summary').innerHTML=cards.map(([label,value,cls])=>`<dl><dt>${esc(label)}</dt><dd class="${cls}">${esc(value)}</dd></dl>`).join('');
    $('history-warnings').textContent=result.warnings.join('\n');
    $('history-rows').innerHTML=result.rows.map((r,i)=>`<tr data-replay-row="${i}"><th scope="row">${esc(r.date)}</th><td>${num(r.spot)}</td><td class="${signClass(r.gross)}">${num(r.gross)}</td><td>${num(r.costs)}</td><td class="${signClass(r.net)}">${num(r.net)}</td><td class="${r.missing.length?'history-gap':''}">${r.missing.length?esc('Missing: '+r.missing.join(', ')):'Complete'}</td></tr>`).join('');
    $('history-cursor').max=result.rows.length-1;$('history-cursor').value=0;renderCursor();
  }
  function renderCursor(){
    if(!result)return;cursor=Math.min(result.rows.length-1,Math.max(0,cursor));$('history-cursor').value=cursor;
    const selected=result.rows[cursor];$('history-cursor-label').textContent=`${selected.date} · net ${money(selected.net)}`;
    $('history-rows').querySelectorAll('tr').forEach((row,i)=>row.classList.toggle('history-row-selected',i===cursor));
    $('history-prev').disabled=cursor===0;$('history-next').disabled=cursor===result.rows.length-1;
    const values=result.rows.flatMap(r=>r.net==null?[]:[r.net,r.gross]),min=Math.min(0,...values),max=Math.max(0,...values),pad=Math.max(1,(max-min)*.15),lo=min-pad,hi=max+pad;
    const mobile=$('history-chart').clientWidth<600,W=mobile?420:1000,Ht=mobile?290:270,L=mobile?62:85,R=mobile?16:24,T=16,B=42,x=i=>L+(W-L-R)*i/Math.max(1,result.rows.length-1),y=n=>T+(hi-n)/(hi-lo)*(Ht-T-B);
    let svg=`<svg viewBox="0 0 ${W} ${Ht}" role="img" aria-label="Historical gross and net profit and loss. Complete values and missing records are in the daily table.">`;
    for(let i=0;i<=4;i++){const v=lo+(hi-lo)*i/4,label=mobile?new Intl.NumberFormat('en-IN',{notation:'compact',maximumFractionDigits:1}).format(v):num(v,0);svg+=`<line class="grid" x1="${L}" x2="${W-R}" y1="${y(v)}" y2="${y(v)}"/><text x="${L-10}" y="${y(v)+4}" text-anchor="end">${label}</text>`;}
    svg+=`<line x1="${L}" x2="${W-R}" y1="${y(0)}" y2="${y(0)}" stroke="var(--muted)"/>`;
    for(const [key,color,dash]of[['gross','var(--scenario)','5 4'],['net','var(--chart)','']]){let points=[];const flush=()=>{if(points.length)svg+=`<polyline fill="none" stroke="${color}" stroke-width="2.5" stroke-dasharray="${dash}" points="${points.join(' ')}"/>`;points=[];};result.rows.forEach((r,i)=>{if(r[key]==null){flush();return;}points.push(x(i)+','+y(r[key]));svg+=`<circle cx="${x(i)}" cy="${y(r[key])}" r="2.8" fill="${color}"/>`;});flush();}
    const stride=Math.max(1,Math.ceil(result.rows.length/(mobile?4:6)));result.rows.forEach((r,i)=>{if(i%stride===0||i===result.rows.length-1)svg+=`<text x="${x(i)}" y="${Ht-14}" text-anchor="${i===0?'start':i===result.rows.length-1?'end':'middle'}">${esc(mobile?r.date.slice(5):r.date)}</text>`;});
    svg+=`<line x1="${x(cursor)}" x2="${x(cursor)}" y1="${T}" y2="${Ht-B}" stroke="var(--chart)" stroke-dasharray="3 3"/>`;
    if(selected.net!=null)svg+=`<circle cx="${x(cursor)}" cy="${y(selected.net)}" r="5" fill="var(--chart)"/>`;
    svg+=`<text x="${W-(mobile?140:200)}" y="${T+8}">Gross · dashed</text><text x="${W-(mobile?140:200)}" y="${T+25}">Net · solid</text></svg>`;$('history-chart').innerHTML=svg;
  }
  $('history-cursor').oninput=()=>{pause();cursor=Number($('history-cursor').value);renderCursor();};
  $('history-prev').onclick=()=>{pause();cursor--;renderCursor();};$('history-next').onclick=()=>{pause();cursor++;renderCursor();};
  $('history-play').onclick=()=>{if(timer){pause();return;}if(!result)return;if(cursor===result.rows.length-1)cursor=0;renderCursor();$('history-play').textContent='Pause replay';timer=setInterval(()=>{cursor++;renderCursor();if(cursor===result.rows.length-1)pause();},900);};
  document.addEventListener('visibilitychange',()=>{if(document.hidden)pause();});
  let resizeTimer;window.addEventListener('resize',()=>{clearTimeout(resizeTimer);resizeTimer=setTimeout(()=>{if(result)renderCursor();},120);});
  function archiveURL(date){return 'https://nsearchives.nseindia.com/content/fo/BhavCopy_NSE_FO_0_0_0_'+date.replaceAll('-','')+'_F_0000.csv.zip';}
  $('history-archive-date').value='2026-10-15';
  $('history-archive-date').onchange=()=>{const date=H.parseDate($('history-archive-date').value);if(date){$('history-archive-link').href=archiveURL(date);$('history-archive-link').removeAttribute('aria-disabled');}else{$('history-archive-link').removeAttribute('href');$('history-archive-link').setAttribute('aria-disabled','true');}};$('history-archive-date').onchange();
  function loadDataset(next){dataset=next;dataRevision++;sourceDescription();$('history-start').replaceChildren();$('history-end').replaceChildren();refreshSymbols();invalidate('Data loaded locally. Choose a structure or import more dates, then run replay.');window.dispatchEvent(new CustomEvent('iwsm:history-data-changed'));}
  $('history-reset-data').onclick=()=>loadDataset(window.IWSMNSEHistory);
  if($('nse-download-form')){
    $('nse-local-preview').hidden=location.protocol!=='file:';
    const today=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Kolkata',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
    for(const id of ['nse-download-start','nse-download-end'])$(id).max=today;
    $('nse-download-form').onsubmit=async e=>{
      e.preventDefault();const output=$('nse-download-status');
      if(location.protocol==='file:'){output.textContent='Automatic downloads need the connected local preview. CSV/Excel imports and the included NSE data work in this local file.';$('nse-local-preview').hidden=false;return;}
      const start=$('nse-download-start').value,end=$('nse-download-end').value,symbol=$('nse-download-symbol').value;
      if(!H.parseDate(start)||!H.parseDate(end)||dayDiff(start,end)<0||dayDiff(start,end)>30){output.textContent='Choose a date range of up to 31 calendar days, with From before To.';return;}
      const revision=++dataRevision,button=$('nse-download-button'),controller=new AbortController(),timeout=setTimeout(()=>controller.abort(),105000);button.disabled=true;
      output.textContent='Downloading official NSE archives and checking contract prices… This can take up to two minutes.';
      try{
        const params=new URLSearchParams({symbol,start,end}),response=await fetch('/.netlify/functions/nse-history?'+params,{signal:controller.signal});
        const data=await response.json();if(!response.ok||!data.success)throw Error(data.error||'NSE archive request failed.');
        if(!Array.isArray(data.contracts)||!data.contracts.length||data.contracts.length>20000)throw Error('No valid contract observations were returned for these dates.');
        if(revision!==dataRevision)throw Error('Another dataset was selected while this download was running; the older request was discarded.');
        loadDataset(data);output.textContent=`Loaded ${num(data.contracts.length,0)} contract observations from official NSE archives (${start} → ${end})${data.cached?' (cached)':''}. Review the coverage warnings before replaying.`;
        $('history-mode').value='observed';$('history-observed').hidden=false;$('history-model').hidden=true;refreshSymbols();
        $('history-load-preset').click();if(positions.length)$('history-run').click();
      }catch(error){output.textContent=(error.name==='AbortError'?'The NSE download timed out. Try a shorter date range.':error.message)+' The previous dataset is preserved. You can also download an official ZIP and import the extracted CSV.';}
      finally{clearTimeout(timeout);button.disabled=false;}
    };
  }
  $('history-import').onchange=async e=>{
    const files=[...e.target.files];if(!files.length)return;const revision=++dataRevision;
    message('Reading historical files on this device…');$('history-run').disabled=true;
    try{
      if(files.reduce((n,f)=>n+f.size,0)>30*1024*1024)throw Error('Choose files totalling at most 30 MB.');
      const rows=[];await new Promise(resolve=>setTimeout(resolve,20));
      for(const file of files){
        if(/\.csv$/i.test(file.name)){for(const row of H.parseCSV(await file.text()))rows.push(row);}
        else if(/\.xlsx$/i.test(file.name)){
          if(!window.XLSX)throw Error('The local Excel reader did not load. Use CSV instead.');
          const book=XLSX.read(await file.arrayBuffer(),{type:'array',cellDates:true,sheetRows:200002});
          const preferred=book.SheetNames.filter(name=>/^(options|underlying)$/i.test(name));
          const names=preferred.length?preferred:book.SheetNames.filter(name=>!/^(sources?|readme|metadata|summary|assumptions|replay)$/i.test(name));
          if(!names.length)throw Error('This workbook has no Options or Underlying data sheets.');
          for(const name of names){const sheet=book.Sheets[name];if(sheet['!fullref']&&sheet['!fullref']!==sheet['!ref'])throw Error('Excel sheet exceeds the 200,000 row limit.');const sheetRows=XLSX.utils.sheet_to_json(sheet,{defval:'',raw:true});for(const row of sheetRows){for(const key of Object.keys(row))if(row[key] instanceof Date){const date=row[key];row[key]=date.getFullYear()+'-'+String(date.getMonth()+1).padStart(2,'0')+'-'+String(date.getDate()).padStart(2,'0');}rows.push(row);}}
        }else throw Error('Use extracted CSV files or .xlsx workbooks. ZIP, XLS and macros are not imported.');
        if(rows.length>H.MAX_ROWS)throw Error('Combined import exceeds 200,000 rows.');
      }
      const normalized=H.normalizeRows(rows,{source:'Imported files · source not independently verified',file:files.map(f=>f.name).join(', ')});
      if(!normalized.contracts.length&&!normalized.underlying.length)throw Error('No valid historical rows were found. '+normalized.warnings.slice(0,2).join(' '));
      if(revision!==dataRevision)throw Error('Another dataset was selected while these files were being read; the older import was discarded.');
      loadDataset(normalized);if(normalized.warnings.length)message(`Imported with ${normalized.warnings.length} data warnings. Review “Import formats, data sources & coverage” before replay.`);
    }catch(error){message('Import failed. '+error.message+' The previous dataset is preserved.');}
    finally{$('history-run').disabled=false;e.target.value='';}
  };
  // All user-controlled text is exported as literal strings, never spreadsheet formulas.
  function exportBook(sheets,name){
    if(!window.XLSX){message('The local Excel reader did not load. Reload this page or use CSV source files.');return;}
    const book=XLSX.utils.book_new();
    for(const [title,data]of Object.entries(sheets)){const sheet=XLSX.utils.json_to_sheet(data);for(const [address,cell]of Object.entries(sheet))if(!address.startsWith('!')&&cell.t==='s'){delete cell.f;cell.t='s';}sheet['!cols']=data.length?Object.keys(data[0]).map(key=>({wch:Math.min(65,Math.max(14,key.length+2))})):[];XLSX.utils.book_append_sheet(book,sheet,title);}
    XLSX.writeFile(book,name,{compression:true});
  }
  $('history-export-data').onclick=()=>exportBook({Options:dataset.contracts,Underlying:dataset.underlying,Sources:[{source:dataset.source||'Imported files',file:dataset.file||'NSE bhavcopies',notes:'Closing marks, not executable fills; underlying uses the source field described in the dataset.',metadata:JSON.stringify(dataset.metadata||{})},...(dataset.warnings||[]).map(w=>({source:'Data warning',notes:w})),...(dataset===window.IWSMNSEHistory?[...new Set(dataset.contracts.map(r=>r.date))].sort().map(date=>({source:'Official NSE archive',file:date,notes:archiveURL(date)})):[])]},'iwsm-historical-data.xlsx');
  $('history-export-results').onclick=()=>{if(!result)return;const s=result.snapshot;exportBook({Replay:result.rows.map(r=>({date:r.date,symbol:result.symbol,underlying_value:r.spot,gross_pnl:r.gross,round_trip_costs:r.costs,net_pnl:r.net,coverage:r.missing.length?'Missing: '+r.missing.join('; '):'Complete'})),Positions:result.legs.map(l=>({symbol:result.symbol,...l})),Assumptions:[{symbol:result.symbol,currency:'INR',method:result.label,source:result.source,start:result.entryDate,end:result.effectiveEnd,fees_per_leg_side:result.costAssumptions.feesPerOrder,slippage_per_unit_side:result.costAssumptions.slippage,entry_underlying:s?.spot??result.rows[0].spot,model_iv_pct:s?.iv??'',model_rate_pct:s?.rate??'',model_dividend_pct:s?.dividend??'',gross_pnl:result.summary.gross,net_pnl:result.summary.net,max_drawdown:result.summary.maxDrawdown,notes:result.warnings.join(' ')}],Sources:[{source:result.source,metadata:JSON.stringify(result.provenance)}]},'iwsm-historical-replay.xlsx');};
  function renderComparisons(){
    $('comparison-status').textContent=comparisons.length?`${comparisons.length} of 4 snapshots. Independent model assumptions; P&L excludes transaction costs. Mixed-expiry risk is unavailable.`:'No snapshots added. Comparisons stay in memory until you close or reload this page.';
    const fmt=(v,currency)=>v==null?'Not calculated':!Number.isFinite(v)?'Unlimited':new Intl.NumberFormat('en-IN',{style:'currency',currency,maximumFractionDigits:0}).format(v);
    $('comparison-rows').innerHTML=comparisons.map((record,i)=>{const s=record.state,m=E.metrics(s),g=E.aggregateGreeks(s),enabled=s.legs.filter(l=>l.enabled!==false),h=Math.min(...enabled.map(l=>l.days));return `<tr><th scope="row">${esc(record.name)}<small>${esc(s.symbol)} · ${num(s.spot)} · ${s.currency}<br>IV ${num(s.iv)}% · first expiry ${h} days</small></th><td>${enabled.length}</td><td>${esc(fmt(m.maxProfit,s.currency))}</td><td>${esc(fmt(m.maxLoss,s.currency))}</td><td>${m.pop==null?'Not calculated':num(m.pop*100,1)+'%'}</td><td>${num(g.delta)}</td><td>${esc(fmt(E.pnl(s,s.spot*.95,h),s.currency))}</td><td>${esc(fmt(E.pnl(s,s.spot*1.05,h),s.currency))}</td><td><button type="button" data-remove-comparison="${i}" aria-label="Remove comparison ${i+1}">×</button></td></tr>`;}).join('');
  }
  $('compare-add').onclick=()=>{const s=snapshot();if(!s.legs.some(l=>l.enabled!==false)){$('comparison-status').textContent='Add an enabled builder position before taking a snapshot.';return;}if(comparisons.length>=4){$('comparison-status').textContent='Four snapshots are already displayed. Remove one to add another.';return;}comparisons.push({name:$('strategy-name').value.trim()||'Untitled strategy',state:s});renderComparisons();};
  $('comparison-rows').onclick=e=>{const b=e.target.closest('[data-remove-comparison]');if(b){comparisons.splice(Number(b.dataset.removeComparison),1);renderComparisons();}};
  $('history-preset').replaceChildren(...E.templates.map((t,i)=>new Option(t.name,String(i))));$('history-preset').value='1';
  window.IWSMHistoryLab=Object.freeze({dataset:()=>structuredClone(dataset),setDataset:next=>{if(!next||!Array.isArray(next.contracts)||next.contracts.length>200000||!Array.isArray(next.underlying))throw Error("Invalid historical dataset.");loadDataset(structuredClone(next));}});
  loadDataset(dataset);renderComparisons();
  if(dataset.contracts.length){$('history-load-preset').click();$('history-run').click();}
})();

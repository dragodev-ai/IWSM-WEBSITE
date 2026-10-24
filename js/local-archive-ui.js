(function(){
 'use strict';const $=id=>document.getElementById(id);if(!$('local-archive'))return;
 let dates=[],allDates=[],symbolDates={},loaded=null,revision=0;
 const message=t=>$('archive-status').textContent=t;
 function reset(){revision++;loaded=null;$('archive-apply-model').hidden=true;$('archive-open-replay').hidden=true;$('archive-source-notes').hidden=true;}
 async function catalog(){
  if(location.protocol==='file:'){$('archive-coverage').textContent='Open the IWSM local preview to read the archive on this computer. Existing Excel/CSV imports still work.';return;}
  try{const response=await fetch('/api/nse-library?mode=catalog'),data=await response.json();if(!response.ok||!data.success)throw Error(data.error||'Archive unavailable');
   allDates=data.dates;symbolDates=data.symbolDates||{};$('archive-symbol').replaceChildren(...data.symbols.map(s=>new Option(s==='BANKNIFTY'?'BANK NIFTY':s,s)));$('archive-symbol').value='NIFTY';dates=symbolDates.NIFTY||allDates;
   $('archive-coverage').textContent=data.downloadedArchives.toLocaleString('en-IN')+' verified daily archives · '+data.contractRows.toLocaleString('en-IN')+' derivative observations · '+data.symbols.length+' reported symbols · '+(dates[0]||'no dates')+' to '+(dates.at(-1)||'no dates')+'. Original reports include all reported stock/index futures and options.';
   for(const id of ['archive-start','archive-end']){$(id).min=dates[0]||'';$(id).max=dates.at(-1)||'';}
   if(dates.length){$('archive-start').value=dates[0];$('archive-end').value=dates[Math.min(4,dates.length-1)];$('archive-load').disabled=false;refreshDateOptions();}
  }catch(error){$('archive-coverage').textContent=error.message+' Start the IWSM local preview; your current strategies are preserved.';}
 }
 function refreshDateOptions(){dates=symbolDates[$('archive-symbol').value]||allDates;$('archive-recorded-date').replaceChildren(...dates.map(d=>new Option(d,d)));for(const id of ['archive-start','archive-end']){$(id).min=dates[0]||'';$(id).max=dates.at(-1)||'';}if(!dates.includes($('archive-start').value))chooseDate(dates.at(-1));else $('archive-recorded-date').value=$('archive-start').value;updateArrows();}
 function updateArrows(){const i=dates.indexOf($('archive-start').value);$('archive-date-prev').disabled=i<=0;$('archive-date-next').disabled=i<0||i>=dates.length-1;}
 function chooseDate(d){if(!d)return;$('archive-start').value=d;const i=dates.indexOf(d);$('archive-end').value=dates[Math.min(i+4,dates.length-1)];$('archive-recorded-date').value=d;reset();updateArrows();message('Ready. Load recorded contracts for '+$('archive-symbol').value+' from '+d+'.');}
 $('archive-recorded-date').onchange=()=>chooseDate($('archive-recorded-date').value);
 $('archive-date-prev').onclick=()=>chooseDate(dates[dates.indexOf($('archive-start').value)-1]);
 $('archive-date-next').onclick=()=>chooseDate(dates[dates.indexOf($('archive-start').value)+1]);
 $('archive-symbol').onchange=()=>{refreshDateOptions();chooseDate($('archive-start').value);};
 $('archive-start').onchange=()=>{if(dates.includes($('archive-start').value))chooseDate($('archive-start').value);else message('No downloaded report for this date and symbol. Choose an available entry date above.');};
 for(const button of document.querySelectorAll('[data-archive-symbol]'))button.onclick=()=>{$('archive-symbol').value=button.dataset.archiveSymbol;$('archive-symbol').dispatchEvent(new Event('change',{bubbles:true}));};
 $('archive-year-back').onclick=()=>{const d=new Date();d.setFullYear(d.getFullYear()-1);const target=[d.getFullYear(),String(d.getMonth()+1).padStart(2,'0'),String(d.getDate()).padStart(2,'0')].join('-');chooseDate(dates.filter(x=>x<=target).at(-1)||dates[0]);};
 $('archive-latest').onclick=()=>chooseDate(dates.at(-1));
 for(const id of ['archive-start','archive-end','archive-symbol'])$(id).addEventListener('input',()=>{reset();message('Selection changed. Load recorded contracts to update the working dataset.');});
 $('archive-window-form').onsubmit=async e=>{
  e.preventDefault();reset();const request=revision,start=$('archive-start').value,end=$('archive-end').value,symbol=$('archive-symbol').value.trim().toUpperCase();
  if(!dates.includes(start)){message('No downloaded NSE report exists for that entry date. Choose another recorded date.');return;}
  if(end<start||(Date.parse(end)-Date.parse(start))/86400000>30){message('Choose an end date within 31 calendar days of the entry date.');return;}
  $('archive-load').disabled=true;message('Reading local NSE reports for '+symbol+'…');
  try{const query=new URLSearchParams({mode:'load',symbol,start,end}),response=await fetch('/api/nse-library?'+query,{signal:AbortSignal.timeout(125000)}),data=await response.json();if(!response.ok||!data.success)throw Error(data.error||'No matching observations');if(request!==revision)return;
   if(!data.contracts.some(r=>r.date===start))throw Error('The selected symbol has no contract observation on the entry date. Choose a different entry date.');
   $('history-mode').value='observed';window.IWSMHistoryLab.setDataset(data);$('history-mode').dispatchEvent(new Event('change',{bubbles:true}));loaded=data;
   const knownUnits=data.contracts.find(r=>Number.isInteger(r.lotSize)&&r.lotSize>0)?.lotSize;
   $('history-units').value=knownUnits||'';
   $('history-start').value=start;$('history-start').dispatchEvent(new Event('change',{bubbles:true}));
   $('history-end').value=[...new Set(data.contracts.map(r=>r.date))].sort().at(-1);$('history-end').dispatchEvent(new Event('change',{bubbles:true}));
   $('archive-open-replay').hidden=false;const ref=data.underlying.find(r=>r.date===start);$('archive-apply-model').hidden=!ref;
   $('archive-source-warnings').replaceChildren(...data.warnings.map(text=>{const li=document.createElement('li');li.textContent=text;return li;}));$('archive-source-notes').hidden=false;message('Loaded '+data.contracts.length.toLocaleString('en-IN')+' recorded contracts for '+symbol+' ('+start+' to '+end+'). '+(!knownUnits?'These reports omit lot sizes. Enter verified units per lot in Historical lab before replaying.':''));
  }catch(error){if(request===revision)message(error.message+' The previous dataset is preserved.');}finally{$('archive-load').disabled=false;}
 };
 $('archive-apply-model').onclick=()=>{
  if(!loaded)return;const asOf=loaded.metadata.requestedStart,reference=loaded.underlying.find(r=>r.date===asOf);if(!reference)return;
  const rows=loaded.contracts.filter(r=>r.date===asOf),expiry=[...new Set(rows.map(r=>r.expiry).filter(d=>d>asOf))].sort()[0];if(!expiry){message('No later expiry is recorded for this date. Use exact historical replay below.');return;}
  const lot=rows.filter(r=>r.expiry===expiry).find(r=>Number.isInteger(r.lotSize)&&r.lotSize>0)?.lotSize;
  if(!lot){message('Verify the dated lot size before applying this reference. No current lot size has been backfilled.');return;}
  const strikes=[...new Set(rows.filter(r=>r.expiry===expiry&&r.type!=='FUT').map(r=>r.strike))].sort((a,b)=>a-b),steps=strikes.slice(1).map((x,i)=>x-strikes[i]).filter(x=>x>0),step=steps.length?Math.min(...steps):window.IWSMLab.snapshot().step;
  const state={...window.IWSMLab.snapshot(),step,symbol:loaded.metadata.symbol,currency:'INR',spot:reference.close,lotSize:lot,days:Math.round((Date.parse(expiry)-Date.parse(asOf))/86400000),legs:[]};
  window.IWSMLab.loadSnapshot({name:state.symbol+' model study '+asOf,asOf,state,notes:'Underlying reference from NSE bhavcopy. Model option prices are calculated, not recorded premiums. Use Historical lab for actual-price replay.'});message('Builder valuation set to '+asOf+'. Its payoff calendar now starts from this historical date. Option-price replay remains in Historical lab.');
 };
 catalog();
})();

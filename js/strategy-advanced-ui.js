(function(){
 'use strict';
 const host=document.getElementById('advanced-research');if(!host)return;
 const $=id=>document.getElementById(id),num=n=>typeof n==='number'&&Number.isFinite(n)?n.toLocaleString('en-IN',{maximumFractionDigits:2}):'—';
 let result={surface:[],buildup:[],moving:[]},tab='surface';
 const columns={surface:['date','expiry','strike','type','close','iv','oi','volume'],buildup:['date','previousDate','expiry','strike','type','close','priceChange','oiChange','classification'],moving:['date','close','sma5','sma10','sma20','sma50']};
 const labels={date:'Recorded date',expiry:'Expiry',strike:'Strike',type:'Type',close:'Close (₹)',iv:'Model IV (%)',oi:'OI · source units',volume:'Volume · source units',previousDate:'Previous observation',priceChange:'Close change (%)',oiChange:'OI change',classification:'Price / OI pattern',sma5:'5-observation SMA',sma10:'10-observation SMA',sma20:'20-observation SMA',sma50:'50-observation SMA'};
 function render(){
  const rows=result[tab],keys=columns[tab],head=$('advanced-head'),body=$('advanced-body');head.replaceChildren();body.replaceChildren();
  for(const key of keys){const th=document.createElement('th');th.scope='col';th.textContent=labels[key];head.append(th);}
  for(const row of rows){const tr=document.createElement('tr');for(const key of keys){const td=document.createElement('td');td.textContent=row[key]==null?'—':typeof row[key]==='number'?num(row[key]):row[key];if(key==='iv'&&row.iv!=null){td.className='advanced-iv-cell';td.style.backgroundColor=`rgba(38,137,121,${Math.min(.42,.08+row.iv/160)})`;}tr.append(td);}body.append(tr);}
  $('advanced-export').disabled=!rows.length;
  $('advanced-status').textContent=rows.length?rows.length+' observations · '+$('research-symbol').value+' · as of '+$('research-date').value:'No matching records. Import more NSE history below.';
  $('advanced-method').textContent=tab==='surface'?'Volatility surface table across loaded expiries and strikes. IV is inferred from recorded closing premiums using the research rate and dividend assumptions. No interpolation: unidentifiable IV stays blank.':tab==='buildup'?'Compares exact contracts against the preceding loaded date for each expiry. Price and OI patterns describe recorded changes; they do not prove trader intent or predict direction. Missing prior observations stay unavailable.':'Simple averages over the last 5, 10, 20 or 50 loaded observations, with no forward filling. Averages remain blank until enough records exist. Sparse imported dates are observations, not guaranteed consecutive trading sessions.';
 }
 function refresh(){try{if(!$('research-rate').checkValidity()||!$('research-dividend').checkValidity())throw Error('Enter valid rate and dividend assumptions in Options research.');result=window.IWSMAdvanced.analyze(window.IWSMHistoryLab.dataset(),$('research-symbol').value,$('research-date').value,Number($('research-rate').value),Number($('research-dividend').value));render();}catch(error){result={surface:[],buildup:[],moving:[]};render();$('advanced-status').textContent=error.message;}}
 function activate(button){tab=button.dataset.advanced;host.querySelectorAll('[data-advanced]').forEach(b=>{b.setAttribute('aria-pressed',String(b===button));});render();}
 host.querySelectorAll('[data-advanced]').forEach(b=>b.addEventListener('click',()=>activate(b)));
 $('options-research').addEventListener('change',refresh);$('options-research').addEventListener('input',refresh);$('options-research').addEventListener('click',()=>queueMicrotask(refresh));window.addEventListener('iwsm:history-data-changed',refresh);
 $('advanced-export').onclick=()=>{const keys=columns[tab],quote=v=>'"'+String(v??'').replaceAll('"','""')+'"',csv=[keys,...result[tab].map(r=>keys.map(k=>r[k]))].map(r=>r.map(quote).join(',')).join('\r\n');const url=URL.createObjectURL(new Blob(['\ufeff'+csv],{type:'text/csv;charset=utf-8'})),a=document.createElement('a');a.href=url;a.download='iwsm-'+tab+'-'+$('research-date').value+'.csv';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);};
 refresh();
})();

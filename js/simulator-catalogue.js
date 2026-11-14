(function(root,factory){if(typeof module==='object'&&module.exports)module.exports=factory();else root.IWSMSimulatorCatalogue=factory();})(typeof globalThis!=='undefined'?globalThis:this,function(){
 'use strict';
 const key='iwsm-public-instruments-v1',age=30*86400000;
 function clean(rows){return Array.isArray(rows)?rows.slice(0,1500).filter(r=>r&&['nse_fo','bse_fo'].includes(r.exchange)&&['index','stock'].includes(r.kind)&&typeof r.symbol==='string'&&/^[A-Z0-9&._ -]{1,50}$/.test(r.symbol)).map(({symbol,exchange,kind})=>({symbol,exchange,kind})):[];}
 function read(storage,now=Date.now()){try{const v=JSON.parse(storage.getItem(key));return v&&Number.isFinite(v.saved)&&now-v.saved>=0&&now-v.saved<=age?clean(v.rows):[];}catch{return [];}}
 function save(storage,rows,now=Date.now()){try{storage.setItem(key,JSON.stringify({saved:now,rows:clean(rows)}));}catch{}}
 return {read,save};
});

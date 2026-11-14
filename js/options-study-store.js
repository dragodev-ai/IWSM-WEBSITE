(function(root,factory){
  if(typeof module==='object'&&module.exports)module.exports=factory(require('./options-simulator-engine.js'),require('./options-paper-execution.js'),require('./options-candle-model.js'),globalThis);
  else root.IWSMStudyStore=factory(root.IWSMSimulator,root.IWSMPaperExecution,root.IWSMCandleModel,root);
})(typeof globalThis!=='undefined'?globalThis:this,function(M,P,C,root){
  'use strict';
  const DB_NAME='iwsm-paper-studies',STORE='studies';
  function failure(code,message,cause){const e=new Error(message);e.name='StudyStorageError';e.code=code;if(cause)e.cause=cause;return e;}
  function validate(input){
    try{
      const raw=typeof input==='string'?JSON.parse(input):input;
      if(!raw||raw.format!=='iwsm-paper-v1'||!raw.dataset||!raw.session)throw Error('Unsupported study backup.');
      const dataset=M.prepareDataset(raw.dataset),session=P.restore(dataset,raw.session);
      let bundle=null;
      if(raw.bundle){
        if(!Array.isArray(raw.bundle.candles))throw Error('Invalid candle bundle.');
        bundle=C.normalizeCandles(raw.bundle.candles.map(c=>raw.bundle.kind==='daily'?{...c,date:c.timestamp.slice(0,10),timestamp:undefined}:c),{source:raw.bundle.source,intervalMinutes:raw.bundle.intervalMinutes});
        bundle.synthetic=raw.bundle.synthetic===true;
        for(const c of bundle.candles){if(dataset.spots.get(c.symbol+'|'+c.timestamp)!==c.close)throw Error('Candle backup does not match the replay underlying.');}
      }
      return {format:'iwsm-paper-v1',name:String(raw.name||session.symbol+' '+session.cursor).slice(0,200),dataset:M.exportDataset(dataset),bundle,session,savedAt:Number.isFinite(raw.savedAt)&&raw.savedAt>=0?raw.savedAt:0};
    }catch(e){throw failure('INVALID_STUDY','This study could not be restored: '+e.message,e);}
  }
  function ordered(rows){
    const stamp=x=>Number.isFinite(x?.savedAt)&&x.savedAt>=0?x.savedAt:0;
    const cursor=x=>String(x?.session?.cursor||'');
    const id=x=>String(x?.session?.id||'');
    return rows.slice().sort((a,b)=>stamp(b)-stamp(a)||cursor(b).localeCompare(cursor(a))||id(b).localeCompare(id(a)));
  }
  function latestValid(rows){
    for(const row of ordered(rows)){try{return validate(row);}catch(e){if(e.code!=='INVALID_STUDY')throw e;}}
    return null;
  }
  function open(options={}){
    const factory=Object.prototype.hasOwnProperty.call(options,'indexedDB')?options.indexedDB:root.indexedDB;
    const now=typeof options.now==='function'?options.now:Date.now;
    if(!factory||typeof factory.open!=='function')return Promise.reject(failure('STORAGE_UNAVAILABLE','Browser study storage is unavailable. Export a JSON backup to keep your study.'));
    return new Promise((resolve,reject)=>{
      let request,settled=false;
      const fail=(code,message,cause)=>{if(!settled){settled=true;reject(failure(code,message,cause));}};
      try{request=factory.open(DB_NAME,1);}catch(e){fail('STORAGE_UNAVAILABLE','Browser study storage could not be opened. Use JSON backups.',e);return;}
      request.onupgradeneeded=()=>{if(!request.result.objectStoreNames.contains(STORE))request.result.createObjectStore(STORE);};
      request.onerror=()=>fail('STORAGE_UNAVAILABLE','Browser study storage could not be opened. Use JSON backups.',request.error);
      request.onblocked=()=>fail('STORAGE_BLOCKED','Another open page is blocking study storage. Close the other simulator page or export a backup.');
      request.onsuccess=()=>{
        const db=request.result;
        if(settled){db.close();return;}
        settled=true;let closed=false;
        const close=()=>{closed=true;db.close();};db.onversionchange=close;
        function transaction(mode,operation){
          if(closed)return Promise.reject(failure('STORAGE_CLOSED','Study storage is closed. Reload the page or export a backup.'));
          return new Promise((done,fail)=>{
            let tx,value,finished=false;
            const rejectTx=e=>{if(!finished){finished=true;const quota=e?.name==='QuotaExceededError';fail(failure(quota?'STORAGE_QUOTA':'STORAGE_FAILED',quota?'Browser storage is full. Export a JSON backup.':'Study storage failed. Export a JSON backup.',e));}};
            try{
              tx=db.transaction(STORE,mode);
              tx.oncomplete=()=>{if(!finished){finished=true;done(value);}};
              tx.onabort=()=>rejectTx(tx.error);tx.onerror=()=>rejectTx(tx.error);
              const req=operation(tx.objectStore(STORE));
              req.onsuccess=()=>{value=req.result;};req.onerror=()=>rejectTx(req.error);
            }catch(e){try{tx?.abort();}catch{}rejectTx(e);}
          });
        }
        const list=async()=>ordered(await transaction('readonly',store=>store.getAll()));
        resolve({
          async save(raw){const record=validate(raw),stamp=now();record.savedAt=Number.isFinite(stamp)&&stamp>=0?stamp:Date.now();await transaction('readwrite',store=>store.put(record,record.session.id));},
          list,
          async latest(){return latestValid(await list());},
          close
        });
      };
    });
  }
  return Object.freeze({open,validate,ordered,latestValid});
});

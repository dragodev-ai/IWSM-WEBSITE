(function(root,factory){
  if(typeof module==='object'&&module.exports)module.exports=factory();
  else root.IWSMSimulatorStartup=factory();
})(typeof globalThis!=='undefined'?globalThis:this,function(){
  'use strict';
  return {async initialize(o){
    o.seed();
    const revision=o.revision();
    try {
      await o.open();
      const saved=await o.latest();
      if(revision!==o.revision())return;
      if(saved)o.restore(saved);else await o.save();
    }
    catch(e){o.onError(e);}
  }};
});

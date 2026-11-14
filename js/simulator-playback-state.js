(function(root,factory){if(typeof module==='object'&&module.exports)module.exports=factory();else root.IWSMSimulatorPlayback=factory();})(typeof globalThis!=='undefined'?globalThis:this,function(){
 'use strict';
 function describe({kind,frames=[],cursor,exchange='nse_fo',base=1}){
  const single=frames.length<2,atEnd=cursor===frames.at(-1),atStart=cursor===frames[0];
  const supported=single?[]:kind==='daily'?[1440]:[1,5,15,30,60,120,1440].filter(n=>n===1440||n>=base&&n%base===0);
  const action='';
  const notice=single?'Live point-in-time option-chain snapshot active.':kind==='daily'?'Historical daily EOD closes active (1D steps).':atEnd?'End of loaded window. Replay restarts from the first recorded timestamp.':'Intraday '+base+'-minute option-chain prices active.';
  return {single,atEnd,atStart,supported,canPlay:!single,restart:!single&&atEnd,action,notice};
 }
 return {describe};
});

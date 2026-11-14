(function(root,factory){if(typeof module==='object'&&module.exports)module.exports=factory();else root.IWSMSimulatorPlayback=factory();})(typeof globalThis!=='undefined'?globalThis:this,function(){
 'use strict';
 function describe({kind,frames=[],cursor,exchange='nse_fo',base=1}){
  const single=frames.length<2,atEnd=cursor===frames.at(-1),atStart=cursor===frames[0];
  const supported=single?[]:kind==='daily'?[1440]:[1,5,15,30,60,120,1440].filter(n=>n===1440||n>=base&&n%base===0);
  const action='Load minute history';
  const notice=single?'Only one captured timestamp is loaded, so there is no earlier or later price to replay.'+' Load a recorded minute window to use Play and the arrows.':kind==='daily'?'Daily closes only. Load recorded minute history to enable 1m and 5m steps.':atEnd?'End of loaded data. Replay restarts from the first recorded minute.':'Recorded '+base+'-minute prices. Play and the arrows update positions using observed quotes.';
  return {single,atEnd,atStart,supported,canPlay:!single,restart:!single&&atEnd,action,notice};
 }
 return {describe};
});

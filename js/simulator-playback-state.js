(function(root,factory){if(typeof module==='object'&&module.exports)module.exports=factory();else root.IWSMSimulatorPlayback=factory();})(typeof globalThis!=='undefined'?globalThis:this,function(){
 'use strict';
 const ALL_TIMEFRAMES=[1,5,13,15,16,30,60,120,1440];
 function describe({kind,frames=[],cursor,exchange='nse_fo',base=1,activeTimeframe=5}){
  const single=frames.length<2,atEnd=cursor===frames.at(-1),atStart=cursor===frames[0];
  const supported=single?[]:kind==='daily'?[1440]:ALL_TIMEFRAMES.filter(n=>n===1440||(n>=base&&(n%base===0||base===1)));
  const action='';
  const tfLabel=activeTimeframe===1440?'1D':activeTimeframe+'m';
  const notice=single
   ?'Live point-in-time option-chain snapshot active. Select any minute timeframe (1m–60m) to load 1-minute intraday bars.'
   :kind==='daily'
   ?'Historical daily EOD closes active (1D steps). Select 1m, 5m, 13m, 15m, or 16m to auto-load 1-minute intraday bars when available.'
   :atEnd
   ?'End of loaded window ('+tfLabel+' chart active). Replay restarts from the first recorded timestamp.'
   :'Intraday '+base+'-minute option-chain prices active · '+tfLabel+' timeframe synchronized.';
  return {single,atEnd,atStart,supported,selectableTimeframes:[1,5,13,15,16,30,60,1440],canPlay:!single,restart:!single&&atEnd,action,notice};
 }
 return {describe,ALL_TIMEFRAMES};
});

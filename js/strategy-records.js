(function(root,factory){
  const api=factory(typeof module==='object'&&module.exports?require('./strategy-engine.js'):root.IWSMStrategy);
  if(typeof module==='object'&&module.exports)module.exports=api;else root.IWSMStrategyRecords=api;
})(typeof globalThis!=='undefined'?globalThis:this,function(Strategy){
  'use strict';
  const DAY=86400000;
  function parseDate(value){
    if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(value))return null;
    const [y,m,d]=value.split('-').map(Number),date=new Date(Date.UTC(y,m-1,d));
    return y>=1900&&y<=2199&&date.getUTCFullYear()===y&&date.getUTCMonth()===m-1&&date.getUTCDate()===d?value:null;
  }
  function addDays(value,days){
    if(!parseDate(value)||!Number.isInteger(days))throw Error('Invalid valuation date or expiry term.');
    const result=new Date(Date.parse(value+'T00:00:00Z')+days*DAY).toISOString().slice(0,10);
    if(!parseDate(result))throw Error('Expiry date is outside the supported range.');
    return result;
  }
  function indiaDate(value=new Date()){
    const date=new Date(value);
    if(!Number.isFinite(+date))return null;
    const parts=Object.fromEntries(new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Kolkata',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(date).map(p=>[p.type,p.value]));
    return parseDate(parts.year+'-'+parts.month+'-'+parts.day);
  }
  function validState(state){return Strategy&&Strategy.validate(state)&&['INR','USD','EUR','GBP'].includes(state.currency)&&typeof state.symbol==='string'&&state.symbol.length>0&&state.symbol.length<=40;}
  function create(state,options={}){
    if(!validState(state))throw Error('Invalid strategy assumptions or positions.');
    const asOf=options.asOf||indiaDate();
    if(!parseDate(asOf))throw Error('Invalid valuation date.');
    return {version:2,name:String(options.name||'Untitled strategy').trim().slice(0,70)||'Untitled strategy',notes:String(options.notes||'').slice(0,2000),savedAt:options.savedAt||new Date().toISOString(),asOf,expiries:state.legs.map(leg=>addDays(asOf,leg.days)),state:structuredClone(state)};
  }
  function load(record,currentDate=indiaDate()){
    if(!record||![1,2].includes(record.version)||!validState(record.state)||!parseDate(currentDate))throw Error('Invalid strategy file or version.');
    let asOf,legacyUndated=false;
    if(record.version===2){
      asOf=parseDate(record.asOf);
      if(!asOf)throw Error('Invalid strategy valuation date.');
      if(!Array.isArray(record.expiries)||record.expiries.length!==record.state.legs.length||record.expiries.some((expiry,i)=>!parseDate(expiry)||expiry!==addDays(asOf,record.state.legs[i].days)))throw Error('Strategy expiry dates do not match the saved valuation date and terms.');
    }else{
      asOf=typeof record.savedAt==='string'&&record.savedAt.length>0?indiaDate(record.savedAt):null;
      if(!asOf){asOf=currentDate;legacyUndated=true;}
    }
    const notice=legacyUndated?'This legacy record has no valuation date. Its relative days are anchored to '+asOf+'; the original expiry dates cannot be recovered.':(asOf!==currentDate?'Dated model snapshot as of '+asOf+'. Saved terms and expiries are preserved; this is not a current market valuation.':'Model snapshot as of '+asOf+'. Saved terms and expiries are preserved.');
    return {state:structuredClone(record.state),asOf,name:String(record.name||'Imported strategy').slice(0,70),notes:String(record.notes||'').slice(0,2000),notice,legacyUndated};
  }
  return Object.freeze({parseDate,addDays,indiaDate,create,load});
});

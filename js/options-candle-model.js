(function(root,factory){
  if(typeof module==='object'&&module.exports)module.exports=factory(require('./strategy-engine.js'),require('./options-simulator-engine.js'));
  else root.IWSMCandleModel=factory(root.IWSMStrategy,root.IWSMSimulator);
})(typeof globalThis!=='undefined'?globalThis:this,function(Strategy,Simulator){
  'use strict';
  const MAX_ROWS=200000,MINUTE=60000,DAY=86400000;
  const finite=n=>typeof n==='number'&&Number.isFinite(n);
  const numeric=value=>{if(finite(value))return value;if(typeof value!=='string'||!value.trim())return NaN;const s=value.trim();return /^[+-]?(?:\d+(?:\.\d*)?|\d{1,3}(?:,\d{3})+(?:\.\d*)?|\.\d+)$/.test(s)?Number(s.replace(/,/g,'')):NaN;};
  const symbol=value=>String(value||'').trim().toUpperCase();
  const validDate=value=>typeof value==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(value)&&Number.isFinite(Date.parse(value+'T00:00:00Z'))&&new Date(value+'T00:00:00Z').toISOString().slice(0,10)===value;
  const minute=stamp=>Number(stamp.slice(11,13))*60+Number(stamp.slice(14,16));
  function interval(value){if(!Number.isInteger(value)||value<1||value>375)throw Error('Candle interval must be a whole number from 1 to 375 minutes.');return value;}
  const gcd=(a,b)=>b?gcd(b,a%b):a;
  function normalizeCandles(rows,options={}){
    if(!Array.isArray(rows)||!rows.length||rows.length>MAX_ROWS)throw Error('Import from 1 to 200,000 underlying candles.');
    const seen=new Set(),symbols=new Set(),kinds=new Set();
    const candles=rows.map(input=>{
      if(!input||typeof input!=='object'||Array.isArray(input))throw Error('Invalid underlying candle.');
      const raw=input.timestamp??input.datetime??input.date;
      const daily=validDate(raw),timestamp=daily?raw+'T15:30':Simulator.timestamp(raw),sym=symbol(input.symbol||options.symbol);
      if(!sym||sym.length>100||/[\u0000-\u001f|]/.test(sym))throw Error('Provide a valid underlying symbol.');
      if(options.symbol&&sym!==symbol(options.symbol))throw Error('Underlying symbol does not match the selected symbol.');
      if(!daily&&(minute(timestamp)<555||minute(timestamp)>930))throw Error('Underlying candle closes must be inside the 09:15–15:30 IST session.');
      if(seen.has(timestamp))throw Error('Duplicate underlying candle timestamp.');seen.add(timestamp);symbols.add(sym);kinds.add(daily?'daily':'intraday');
      const candle={timestamp,symbol:sym};
      for(const name of ['open','high','low','close']){const n=numeric(input[name]);if(!finite(n)||n<=0||n>1e7)throw Error('OHLC prices must be finite positive numbers below 10,000,000.');candle[name]=n;}
      if(candle.low>Math.min(candle.open,candle.close)||candle.high<Math.max(candle.open,candle.close)||candle.low>candle.high)throw Error('Invalid candle OHLC range.');
      candle.volume=input.volume===undefined||input.volume===null||String(input.volume).trim()===''?null:numeric(input.volume);
      if(candle.volume!==null&&(!finite(candle.volume)||candle.volume<0))throw Error('Candle volume must be non-negative or missing.');
      return candle;
    }).sort((a,b)=>a.timestamp.localeCompare(b.timestamp));
    if(symbols.size!==1||kinds.size!==1)throw Error('Use a single symbol and do not mix daily and intraday candles.');
    const kind=[...kinds][0];let intervalMinutes=kind==='daily'?1440:options.intervalMinutes;
    if(kind==='daily'&&options.intervalMinutes!==undefined&&options.intervalMinutes!==1440)throw Error('Daily candles cannot become intraday observations.');
    if(kind==='intraday'){
      if(intervalMinutes===undefined){let step=0;for(let i=1;i<candles.length;i++)if(candles[i].timestamp.slice(0,10)===candles[i-1].timestamp.slice(0,10))step=gcd(step,(Simulator.instant(candles[i].timestamp)-Simulator.instant(candles[i-1].timestamp))/MINUTE);intervalMinutes=step||1;}
      interval(intervalMinutes);
      for(const c of candles){const offset=minute(c.timestamp)-555;if(offset%intervalMinutes!==0&&minute(c.timestamp)!==930)throw Error('Candle closes must align with their interval from 09:15 IST.');}
    }
    return {candles,source:String(options.source||'Imported underlying candles').slice(0,300),intervalMinutes,kind,synthetic:false};
  }
  // Focused RFC-style CSV reader: quoted commas/newlines, escaped quotes and CRLF.
  function csvRows(text){
    if(typeof text!=='string'||!text.trim())throw Error('Load a non-empty candle CSV.');
    const rows=[];let row=[],field='',quoted=false,ended=false;
    for(let i=0;i<text.length;i++){
      const ch=text[i];
      if(quoted){if(ch==='"'){if(text[i+1]==='"'){field+='"';i++;}else{quoted=false;ended=true;}}else field+=ch;continue;}
      if(ch==='"'){if(field||ended)throw Error('Invalid quote in candle CSV.');quoted=true;}
      else if(ch===','||ch==='\n'||ch==='\r'){row.push(field);field='';ended=false;if(ch!==','){if(row.some(v=>v.trim()))rows.push(row);row=[];if(ch==='\r'&&text[i+1]==='\n')i++;if(rows.length>MAX_ROWS+1)throw Error('Import up to 200,000 candles.');}}
      else{if(ended&&!/\s/.test(ch))throw Error('Invalid text after CSV quote.');if(!ended)field+=ch;}
    }
    if(quoted)throw Error('Unclosed quote in candle CSV.');
    row.push(field);if(row.some(v=>v.trim()))rows.push(row);return rows;
  }
  function parseCandles(text,filename='candles.csv',options={}){
    const rows=csvRows(text.replace(/^\uFEFF/,'')),headers=(rows.shift()||[]).map(x=>x.trim().toLowerCase());
    if(new Set(headers).size!==headers.length||!['open','high','low','close'].every(k=>headers.includes(k))||!headers.some(k=>['timestamp','datetime','date'].includes(k)))throw Error('CSV needs timestamp (or datetime/date), open, high, low and close columns.');
    return normalizeCandles(rows.map(values=>{if(values.length!==headers.length)throw Error('CSV row has a different number of columns.');return Object.fromEntries(headers.map((k,i)=>[k,values[i].trim()]));}),{...options,source:options.source||filename});
  }
  function checkedBundle(bundle){
    if(!bundle||!Array.isArray(bundle.candles))throw Error('Load underlying candles first.');
    const rows=bundle.kind==='daily'?bundle.candles.map(c=>({...c,date:c.timestamp.slice(0,10),timestamp:undefined})):bundle.candles;
    return {...normalizeCandles(rows,{source:bundle.source,intervalMinutes:bundle.intervalMinutes}),synthetic:bundle.synthetic===true};
  }
  function resample(bundle,minutes){
    const b=checkedBundle(bundle);
    if(b.kind==='daily'){if(minutes!==1440)throw Error('Daily observations cannot be resampled to intraday candles.');return b;}
    interval(minutes);if(minutes<b.intervalMinutes||minutes%b.intervalMinutes!==0)throw Error('Resampling requires a multiple of the source interval; finer candles cannot be invented.');
    if(minutes===b.intervalMinutes)return b;
    const groups=new Map();
    for(const c of b.candles){const offset=minute(c.timestamp)-555;if(offset<=0)continue;const end=Math.min(375,Math.ceil(offset/minutes)*minutes),id=c.timestamp.slice(0,10)+'|'+end;if(!groups.has(id))groups.set(id,{end,rows:[]});groups.get(id).rows.push(c);}
    const candles=[];
    for(const {end,rows}of groups.values()){
      const start=Math.floor((end-1)/minutes)*minutes,expected=[];
      for(let t=start+b.intervalMinutes;t<=end;t+=b.intervalMinutes)expected.push(t);
      if(expected.at(-1)!==end)expected.push(end);
      if(rows.length!==expected.length||rows.some((c,i)=>minute(c.timestamp)-555!==expected[i]))continue;
      const first=rows[0],last=rows.at(-1);candles.push({timestamp:last.timestamp,symbol:first.symbol,open:first.open,high:Math.max(...rows.map(c=>c.high)),low:Math.min(...rows.map(c=>c.low)),close:last.close,volume:rows.some(c=>c.volume===null)?null:rows.reduce((sum,c)=>sum+c.volume,0)});
    }
    return {...b,candles,intervalMinutes:minutes};
  }
  function setting(value,fallback,min,max,integer=false){const n=value===undefined?fallback:value;if(!finite(n)||n<min||n>max||(integer&&!Number.isInteger(n)))throw Error('Invalid model IV, rate, dividend or lot size.');return n;}
  function buildDataset(bundle,options={}){
    const b=checkedBundle(bundle),sym=symbol(options.symbol||b.candles[0].symbol);
    if(sym!==b.candles[0].symbol)throw Error('Model symbol must match underlying candles.');
    const iv=setting(options.iv,18,0,1000),rate=setting(options.rate,6,-100,100),dividend=setting(options.dividend,0,0,100),lotSize=setting(options.lotSize,1,1,1e6,true);
    if(!Array.isArray(options.expiries)||!options.expiries.length||options.expiries.length>MAX_ROWS||options.expiries.some(e=>!validDate(e)))throw Error('Select valid ISO expiry dates.');
    if(!Array.isArray(options.strikes)||!options.strikes.length||options.strikes.length>MAX_ROWS||options.strikes.some(k=>!finite(k)||k<=0||k>1e7))throw Error('Provide finite positive model strikes.');
    const expiries=[...new Set(options.expiries)].sort(),strikes=[...new Set(options.strikes)].sort((a,b)=>a-b),includeFutures=options.includeFutures!==false;
    const start=Simulator.instant(b.candles[0].timestamp),expiryTime=e=>Date.parse(e+'T15:30:00+05:30');
    if(expiries.some(e=>expiryTime(e)<start))throw Error('Expiry precedes the first observed candle.');
    let count=0;for(const c of b.candles){for(const expiry of expiries)if(Simulator.instant(c.timestamp)<=expiryTime(expiry))count+=strikes.length*2+(includeFutures?1:0);if(count>MAX_ROWS)break;}
    if(count>MAX_ROWS)throw Error('Model output exceeds 200,000 contract rows. Reduce candles, strikes or expiries.');
    const contracts=[],underlying=[];
    for(const c of b.candles){
      const at=b.kind==='daily'?{date:c.timestamp.slice(0,10)}:{timestamp:c.timestamp};underlying.push({...at,symbol:sym,close:c.close});
      for(const expiry of expiries){const days=(expiryTime(expiry)-Simulator.instant(c.timestamp))/DAY;if(days<0)continue;
        const add=(type,strike)=>{const close=Strategy.price(type,c.close,strike,days,iv/100,rate/100,dividend/100);if(!finite(close)||close<0||close>1e7)throw Error('Model price is outside supported bounds.');contracts.push({...at,symbol:sym,expiry,type,strike,close,spot:c.close,lotSize,volume:null,oi:null});};
        for(const strike of strikes){add('CE',strike);add('PE',strike);}if(includeFutures)add('FUT',0);
      }
    }
    return {source:'Model premiums · '+b.source,metadata:{modelled:true,pricingModel:'Black-Scholes',synthetic:b.synthetic,underlyingSource:b.source,iv,rate,dividend,lotSize,intervalMinutes:b.intervalMinutes,kind:b.kind,timeConvention:'ACT/365; expiry 15:30 IST; candle close observations',futuresModel:'Underlying close (strategy engine convention)'},contracts,underlying,candles:b.candles};
  }
  function demo(){
    const now=new Date(Date.now()+330*MINUTE),today=now.toISOString().slice(0,10),dates=[];let ms=Date.parse(today+'T00:00:00Z')-DAY;
    while(dates.length<2){const d=new Date(ms);if(d.getUTCDay()>0&&d.getUTCDay()<6)dates.unshift(d.toISOString().slice(0,10));ms-=DAY;}
    const rows=[];let previous=22000;
    for(let d=0;d<dates.length;d++)for(let i=1;i<=375;i++){const m=555+i,close=22000+d*55+i*.08+45*Math.sin(i/32)+18*Math.sin(i/9);rows.push({timestamp:dates[d]+'T'+String(Math.floor(m/60)).padStart(2,'0')+':'+String(m%60).padStart(2,'0'),symbol:'NIFTY',open:previous,high:Math.max(previous,close)+3,low:Math.min(previous,close)-3,close,volume:null});previous=close;}
    return {...normalizeCandles(rows,{source:'Synthetic teaching candles (generated; not exchange history)',intervalMinutes:1}),synthetic:true};
  }
  return {parseCandles,normalizeCandles,resample,buildDataset,demo};
});

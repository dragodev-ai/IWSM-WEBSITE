(function(){
 'use strict';const $=id=>document.getElementById(id),form=$('feed-form');if(!form)return;
 let controller=null,timer=null,lastQuote=null,appliedKey=null;
 const key=q=>(q.provider||'Indian Stock Market API')+':'+q.exchange+':'+q.symbol;
 const selection=()=>({symbol:$('feed-symbol').value.trim().toUpperCase(),exchange:$('feed-exchange').value,provider:$('feed-provider').value});
 const number=(value,digits=2)=>typeof value==='number'&&Number.isFinite(value)?value.toLocaleString('en-IN',{maximumFractionDigits:digits}):'—';
 const money=value=>typeof value==='number'&&Number.isFinite(value)?'₹'+number(value):'—';
 const time=value=>{const d=new Date(value);return value&&Number.isFinite(+d)?new Intl.DateTimeFormat('en-IN',{timeZone:'Asia/Kolkata',day:'2-digit',month:'short',year:'numeric',hour:'2-digit',minute:'2-digit',second:'2-digit',hour12:false}).format(d)+' IST':'Not supplied';};
 function element(tag,text,cls){const e=document.createElement(tag);if(text!==undefined)e.textContent=text;if(cls)e.className=cls;return e;}
 function status(text){$('feed-status').textContent=text;}
 function clearTimer(){if(timer)clearInterval(timer);timer=null;}
 function armTimer(){clearTimer();if($('feed-auto').checked&&lastQuote&&!document.hidden)timer=setInterval(()=>{if(!controller)fetchQuote(true);},60000);}
 function invalidate(){controller?.abort();controller=null;lastQuote=null;clearTimer();$('feed-result').replaceChildren();$('feed-result').hidden=true;$('feed-apply').hidden=true;$('feed-search-results').replaceChildren();status('Choose Get NSE/BSE quote to preview this instrument. Your current strategy is unchanged.');form.querySelector('button[type=submit]').disabled=false;}
 async function request(params,signal){const {provider,...query}=params,endpoint=provider==='finstack'&&query.action==='quote'?'finstack-data':'indian-stock-market';const response=await fetch('/.netlify/functions/'+endpoint+'?'+new URLSearchParams(query),{signal}),data=await response.json();if(!response.ok||!data.success)throw Error(data.error||'The market-data connection could not return a result.');return data;}
 function renderQuote(q){
  const host=$('feed-result');host.replaceChildren();host.hidden=false;
  const headline=element('div',undefined,'feed-quote-head'),name=element('div');name.append(element('h3',q.name),element('p',q.symbol+' · '+q.exchange+' · '+(q.kind==='index'?'Index':'Equity'),'fine'));
  const price=element('div',undefined,'feed-price');price.append(element('strong',money(q.price)),element('span',(typeof q.change==='number'?(q.change>=0?'+':'')+number(q.change):'—')+' ('+(typeof q.changePct==='number'?(q.changePct>=0?'+':'')+number(q.changePct):'—')+'%)',typeof q.change==='number'?(q.change>=0?'gain':'loss'):''));headline.append(name,price);host.append(headline);
  const facts=element('dl',undefined,'feed-facts');for(const [label,value] of [['Previous close',money(q.previousClose)],['Open',money(q.open)],['Day high',money(q.high)],['Day low',money(q.low)],['Volume',number(q.volume,0)]]){const item=element('div');item.append(element('dt',label),element('dd',value));facts.append(item);}host.append(facts);
  const freshness=element('p','Source quote: '+time(q.sourceAsOf)+' · Retrieved: '+time(q.retrievedAt)+(q.cached?' · Cached for up to '+(q.cacheTtlSeconds||60)+' seconds':''),'feed-asof');host.append(freshness);if(q.qualityNote)host.append(element('p',q.qualityNote,'fine feed-stale'));
  const asOf=Date.parse(q.sourceAsOf);if(!Number.isFinite(asOf)||Date.now()-asOf>20*60000)host.append(element('p',Number.isFinite(asOf)?'This is an older or last-session quote. Check the source time before applying it.':'The source did not provide a quote time; freshness cannot be verified.','fine feed-stale'));
  host.append(element('p',q.provider==='Finstack'?'Source: Finstack free feed via Yahoo Finance · delayed. Retrieval time is not the source quote time. Options premiums and Greeks remain model values.':'Source: Yahoo Finance through the local Indian Stock Market API. Exchange delay is not supplied. Options premiums and Greeks remain model values.','fine'));
  const details=element('details'),summary=element('summary','Full quote details'),list=element('dl',undefined,'feed-facts feed-full');details.append(summary);
  for(const [label,value] of [['52-week high',money(q.yearHigh)],['52-week low',money(q.yearLow)],['Market cap (INR)',money(q.marketCap)],['P/E ratio',number(q.peRatio)],['Dividend yield (%)',number(q.dividendYield)],['Book value',money(q.bookValue)],['EPS',money(q.eps)],['Sector',q.sector||'—'],['Industry',q.industry||'—']]){const item=element('div');item.append(element('dt',label),element('dd',value));list.append(item);}details.append(list);host.append(details);
  $('feed-apply').hidden=false;
 }
 async function fetchQuote(automatic=false){
  const chosen=selection();if(!chosen.symbol){status('Enter a stock symbol, or select an index.');return;}
  if(location.protocol==='file:'){status('The NSE/BSE connection needs the local website server. Use the connected preview on this computer.');$('feed-result').replaceChildren();const link=element('a','Open connected local preview');link.href='http://127.0.0.1:4174/strategy-builder.html';link.className='feed-preview-link';$('feed-result').append(link);$('feed-result').hidden=false;return;}
  if(controller)return;const active=new AbortController();controller=active;const timeout=setTimeout(()=>active.abort(),26000),button=form.querySelector('button[type=submit]');button.disabled=true;$('feed-apply').hidden=true;status('Fetching '+chosen.symbol+' on '+chosen.exchange+'…');
  try{
   const q=await request({action:'quote',...chosen},active.signal),current=selection();
   if(current.symbol!==chosen.symbol||current.exchange!==chosen.exchange||current.provider!==chosen.provider)return;
   if(!Number.isFinite(q.price)||q.price<=0||q.price>1e7||q.currency!=='INR'||q.exchange!==chosen.exchange||!q.symbol)throw Error('The source did not return a valid matching INR quote.');
   lastQuote=q;renderQuote(q);status('Quote available · '+(q.provider==='Finstack'?'Finstack free / delayed':'delay unverified')+' · '+(automatic?'automatically refreshed':'preview only'));
   if(appliedKey===key(q))window.dispatchEvent(new CustomEvent('iwsm:apply-market-quote',{detail:{quote:q,refresh:true}}));
  }catch(error){if(controller!==active)return;$('feed-result').replaceChildren();$('feed-result').hidden=true;$('feed-apply').hidden=true;status(error.name==='AbortError'?'The data connection timed out. Your current strategy is unchanged.':error.message||'The quote service is unavailable.');}
  finally{clearTimeout(timeout);if(controller===active){controller=null;button.disabled=false;armTimer();}}
 }
 form.onsubmit=e=>{e.preventDefault();fetchQuote();};
 $('feed-search').onclick=async()=>{
  const q=$('feed-symbol').value.trim();if(q.length<2){status('Enter at least two characters to search by company name or symbol.');return;}
  if(location.protocol==='file:'){status('Stock search is available from the local server preview.');return;}
  const button=$('feed-search');button.disabled=true;$('feed-search-results').replaceChildren();status('Searching Indian stocks…');
  try{const data=await request({action:'search',q},AbortSignal.timeout(24000));if($('feed-symbol').value.trim()!==q)return;
   for(const item of data.results||[]){const b=element('button',item.name+' ('+item.symbol+')');b.type='button';b.setAttribute('aria-label','Select '+item.name+' ('+item.symbol+')');b.onclick=()=>{invalidate();$('feed-symbol').value=item.symbol;if(item.exchange)$('feed-exchange').value=item.exchange;status('Selected '+item.symbol+'. Choose Get NSE/BSE quote to fetch its price.');};$('feed-search-results').append(b);}
   status(data.results?.length?'Select a result, then fetch its quote.':'No matching stocks were returned. Try an exchange symbol.');
  }catch(error){status(error.name==='TimeoutError'?'Stock search took too long. Try again later.':error.message);}finally{button.disabled=false;}
 };
 $('feed-provider').onchange=invalidate;$('feed-symbol').oninput=invalidate;$('feed-exchange').onchange=invalidate;
 document.querySelectorAll('[data-feed-symbol]').forEach(b=>b.onclick=()=>{invalidate();$('feed-symbol').value=b.dataset.feedSymbol;$('feed-exchange').value=b.dataset.feedExchange;});
 $('feed-auto').onchange=armTimer;document.addEventListener('visibilitychange',armTimer);window.addEventListener('pagehide',()=>{clearTimer();controller?.abort();});
 $('feed-apply').onclick=()=>{if(lastQuote)window.dispatchEvent(new CustomEvent('iwsm:apply-market-quote',{detail:{quote:lastQuote,refresh:false}}));};
 window.addEventListener('iwsm:quote-applied',e=>{appliedKey=e.detail.key;status(e.detail.refresh?'Strategy reference refreshed; entry prices, strikes and positions were preserved.':'Reference applied. Set the correct contract units per lot, expiry and IV before using a strategy.');});
})();

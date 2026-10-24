(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.IWSMStrategy=api;})(typeof globalThis!=='undefined'?globalThis:this,function(){
 'use strict';
 const pdf=x=>Math.exp(-x*x/2)/Math.sqrt(2*Math.PI);
 function cdf(x){if(x===Infinity)return 1;if(x===-Infinity)return 0;const t=1/(1+.2316419*Math.abs(x));const p=pdf(x)*t*(.319381530+t*(-.356563782+t*(1.781477937+t*(-1.821255978+t*1.330274429))));return x>=0?1-p:p;}
 function price(type,S,K,days,vol,r=.06,q=0){
  if(type==='FUT')return S;
  const call=type==='CE',T=Math.max(0,days)/365;
  if(!T)return Math.max(0,call?S-K:K-S);
  if(S<=0)return call?0:K*Math.exp(-r*T);
  if(vol<=0)return Math.max(0,call?S*Math.exp(-q*T)-K*Math.exp(-r*T):K*Math.exp(-r*T)-S*Math.exp(-q*T));
  const d1=(Math.log(S/K)+(r-q+vol*vol/2)*T)/(vol*Math.sqrt(T)),d2=d1-vol*Math.sqrt(T);
  return Math.max(0,call?S*Math.exp(-q*T)*cdf(d1)-K*Math.exp(-r*T)*cdf(d2):K*Math.exp(-r*T)*cdf(-d2)-S*Math.exp(-q*T)*cdf(-d1));
 }
 function greeks(type,S,K,days,vol,r=.06,q=0){
  if(type==='FUT')return {delta:1,gamma:0,theta:0,vega:0,rho:0};
  const T=days/365;
  if(T<=0||S<=0||vol<=0){const delta=type==='CE'?(S>K?1:S===K?.5:0):(S<K?-1:S===K?-.5:0);return {delta,gamma:0,theta:0,vega:0,rho:0};}
  const sq=Math.sqrt(T),d1=(Math.log(S/K)+(r-q+vol*vol/2)*T)/(vol*sq),d2=d1-vol*sq,discount=Math.exp(-r*T),div=Math.exp(-q*T),call=type==='CE';
  const theta=-S*div*pdf(d1)*vol/(2*sq)+(call?-r*K*discount*cdf(d2)+q*S*div*cdf(d1):r*K*discount*cdf(-d2)-q*S*div*cdf(-d1));
  return {delta:div*(call?cdf(d1):cdf(d1)-1),gamma:div*pdf(d1)/(S*vol*sq),theta:theta/365,vega:S*div*pdf(d1)*sq/100,rho:(call?K*T*discount*cdf(d2):-K*T*discount*cdf(-d2))/100};
 }
 const active=state=>state.legs.filter(x=>x.enabled!==false);
 function pnl(state,S=state.spot,elapsed=0,shift=0){return active(state).reduce((sum,l)=>sum+l.side*l.lots*state.lotSize*(price(l.type,S,l.strike,Math.max(0,l.days-elapsed),Math.max(.001,((l.iv??state.iv)+shift)/100),state.rate/100,state.dividend/100)-l.premium),0);}
 function expiryPnl(state,S){return active(state).reduce((sum,l)=>sum+l.side*l.lots*state.lotSize*((l.type==='FUT'?S:Math.max(0,l.type==='CE'?S-l.strike:l.strike-S))-l.premium),0);}
 function metrics(state){
  const legs=active(state),credit=legs.reduce((s,l)=>s-(l.type==='FUT'?0:l.side*l.lots*state.lotSize*l.premium),0);
  if(!legs.length)return {empty:true,credit,maxProfit:0,maxLoss:0,breaks:[],pop:null,mixed:false};
  const mixed=legs.some(l=>l.days!==legs[0].days);if(mixed)return {empty:false,credit,mixed:true,maxProfit:null,maxLoss:null,breaks:[],pop:null};
  const knots=[...new Set([0,...legs.filter(l=>l.type!=='FUT').map(l=>l.strike)])].sort((a,b)=>a-b),ys=knots.map(x=>expiryPnl(state,x));
  const slope=legs.reduce((s,l)=>s+(l.type==='PE'?0:l.side*l.lots*state.lotSize),0),breaks=[];
  const add=x=>{if(x>=0&&!breaks.some(v=>Math.abs(v-x)<1e-6))breaks.push(x);};
  knots.forEach((x,i)=>{if(Math.abs(ys[i])<1e-7)add(x);if(i&&ys[i]*ys[i-1]<0)add(knots[i-1]-ys[i-1]*(x-knots[i-1])/(ys[i]-ys[i-1]));});
  const last=knots.at(-1),end=ys.at(-1);if(Math.abs(slope)>1e-8&&last-end/slope>last)add(last-end/slope);
  const maxProfit=slope>1e-8?Infinity:Math.max(0,...ys),maxLoss=slope< -1e-8?Infinity:Math.max(0,-Math.min(...ys));
  const T=legs[0].days/365,sigma=state.iv/100,mu=Math.log(state.spot)+(state.rate/100-state.dividend/100-sigma*sigma/2)*T;
  const distribution=x=>x<=0?0:x===Infinity?1:cdf((Math.log(x)-mu)/(sigma*Math.sqrt(T)));
  let pop=0;
  if(T>0&&sigma>0){const cuts=[0,...breaks.filter(x=>x>0),Infinity];for(let i=1;i<cuts.length;i++){const a=cuts[i-1],b=cuts[i],mid=b===Infinity?Math.max(a*1.1,a+state.spot):((a+b)/2);if(expiryPnl(state,mid)>1e-7)pop+=distribution(b)-distribution(a);}}
  else pop=expiryPnl(state,state.spot*Math.exp((state.rate-state.dividend)/100*T))>0?1:0;
  return {empty:false,credit,mixed:false,maxProfit,maxLoss,breaks:breaks.sort((a,b)=>a-b),pop:Math.max(0,Math.min(1,pop))};
 }
 function aggregateGreeks(state,S=state.spot,elapsed=0,shift=0){const total={delta:0,gamma:0,theta:0,vega:0,rho:0};for(const l of active(state)){const g=greeks(l.type,S,l.strike,Math.max(0,l.days-elapsed),Math.max(.001,((l.iv??state.iv)+shift)/100),state.rate/100,state.dividend/100);for(const key of Object.keys(total))total[key]+=g[key]*l.side*l.lots*state.lotSize;}return total;}
 const templates=[
 ['Long Call','Bullish',[[1,'CE',0]]],['Bull Call Spread','Bullish',[[1,'CE',0],[-1,'CE',2]]],['Bull Put Spread','Bullish',[[1,'PE',-2],[-1,'PE',0]]],['Long Future','Bullish',[[1,'FUT',0]]],
 ['Long Put','Bearish',[[1,'PE',0]]],['Bear Put Spread','Bearish',[[-1,'PE',-2],[1,'PE',0]]],['Bear Call Spread','Bearish',[[-1,'CE',0],[1,'CE',2]]],['Short Future','Bearish',[[-1,'FUT',0]]],
 ['Long Straddle','Neutral',[[1,'CE',0],[1,'PE',0]]],['Short Straddle','Neutral',[[-1,'CE',0],[-1,'PE',0]]],['Long Strangle','Neutral',[[1,'PE',-2],[1,'CE',2]]],['Short Strangle','Neutral',[[-1,'PE',-2],[-1,'CE',2]]],
 ['Iron Condor (Credit)','Neutral',[[1,'PE',-4],[-1,'PE',-2],[-1,'CE',2],[1,'CE',4]]],['Iron Condor (Debit)','Neutral',[[-1,'PE',-4],[1,'PE',-2],[1,'CE',2],[-1,'CE',4]]],
 ['Iron Butterfly (Credit)','Neutral',[[1,'PE',-2],[-1,'PE',0],[-1,'CE',0],[1,'CE',2]]],['Iron Butterfly (Debit)','Neutral',[[-1,'PE',-2],[1,'PE',0],[1,'CE',0],[-1,'CE',2]]],
 ['Call Butterfly','Neutral',[[1,'CE',-2],[-1,'CE',0,2],[1,'CE',2]]],['Put Butterfly','Neutral',[[1,'PE',-2],[-1,'PE',0,2],[1,'PE',2]]],
 ['Call Ratio Spread','Neutral',[[1,'CE',0],[-1,'CE',2,2]]],['Put Ratio Spread','Neutral',[[1,'PE',0],[-1,'PE',-2,2]]],
 ['Jade Lizard','Neutral',[[-1,'PE',-2],[-1,'CE',2],[1,'CE',4]]],['Reverse Jade Lizard','Neutral',[[1,'PE',-4],[-1,'PE',-2],[-1,'CE',2]]],
 ['Call Calendar','Neutral',[[-1,'CE',0],[1,'CE',0,1,30]]],['Put Calendar','Neutral',[[-1,'PE',0],[1,'PE',0,1,30]]],['Diagonal Calendar','Neutral',[[-1,'CE',2],[1,'CE',0,1,30]]]
,
 ['Short Put','Bullish',[[-1,'PE',0]]],['Short Call','Bearish',[[-1,'CE',0]]],
 ['Call Ratio Back Spread','Bullish',[[-1,'CE',0],[1,'CE',2,2]]],['Put Ratio Back Spread','Bearish',[[-1,'PE',0],[1,'PE',-2,2]]],
 ['Long Synthetic','Bullish',[[1,'CE',0],[-1,'PE',0]]],['Short Synthetic','Bearish',[[-1,'CE',0],[1,'PE',0]]],
 ['Range Forward','Bullish',[[1,'CE',2],[-1,'PE',-2]]],['Risk Reversal','Bearish',[[-1,'CE',2],[1,'PE',-2]]],
 ['Bullish Butterfly','Bullish',[[1,'CE',0],[-1,'CE',2,2],[1,'CE',4]]],['Bearish Butterfly','Bearish',[[1,'PE',-4],[-1,'PE',-2,2],[1,'PE',0]]],
 ['Bullish Condor','Bullish',[[1,'CE',0],[-1,'CE',1],[-1,'CE',3],[1,'CE',4]]],['Bearish Condor','Bearish',[[1,'PE',-4],[-1,'PE',-3],[-1,'PE',-1],[1,'PE',0]]],
 ['Batman strategy','Neutral',[[1,'CE',2],[-1,'CE',4,2],[1,'PE',-2],[-1,'PE',-4,2]]],
 ['Double Fly','Neutral',[[1,'PE',-5],[-1,'PE',-3],[-1,'CE',-3],[1,'CE',-1],[1,'PE',1],[-1,'PE',3],[-1,'CE',3],[1,'CE',5]]],
 ['Double Condor','Neutral',[[1,'PE',-1],[-1,'PE',-2],[-1,'PE',-3],[1,'PE',-4],[1,'CE',1],[-1,'CE',2],[-1,'CE',3],[1,'CE',4]]]
 ].map(([name,outlook,legs])=>({name,outlook,legs}));
 function preset(index,state){const t=templates[index],atm=Math.round(state.spot/state.step)*state.step;return t.legs.map(([side,type,offset,lots=1,extra=0],i)=>{const strike=Math.max(state.step,atm+offset*state.step),days=state.days+extra;return {id:'leg-'+Date.now()+'-'+i,enabled:true,side,type,strike,lots,days,premium:Math.round(price(type,state.spot,strike,days,state.iv/100,state.rate/100,state.dividend/100)*100)/100};});}
 function validate(s){return s&&Number.isFinite(s.spot)&&s.spot>0&&s.spot<=1e7&&Number.isInteger(s.lotSize)&&s.lotSize>=1&&s.lotSize<=1000000&&Number.isFinite(s.iv)&&s.iv>=.1&&s.iv<=300&&Number.isFinite(s.rate)&&s.rate>=-10&&s.rate<=100&&Number.isFinite(s.dividend)&&s.dividend>=0&&s.dividend<=100&&Number.isInteger(s.days)&&s.days>=1&&s.days<=1095&&Number.isFinite(s.step)&&s.step>=1&&s.step<=10000&&Array.isArray(s.legs)&&s.legs.length<=24&&s.legs.every(l=>['CE','PE','FUT'].includes(l.type)&&[1,-1].includes(l.side)&&Number.isInteger(l.lots)&&l.lots>=1&&l.lots<=100&&Number.isFinite(l.premium)&&l.premium>=0&&l.premium<=1e7&&Number.isFinite(l.strike)&&l.strike>0&&l.strike<=1e7&&(l.iv===undefined||(Number.isFinite(l.iv)&&l.iv>=.1&&l.iv<=300))&&Number.isInteger(l.days)&&l.days>=1&&l.days<=1460);}
 return {cdf,pdf,price,greeks,pnl,expiryPnl,metrics,aggregateGreeks,templates,preset,validate};
});

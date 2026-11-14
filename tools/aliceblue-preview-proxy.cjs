'use strict';
const http=require('node:http');const allowed=new Set(['health','market-status','auth/status','auth/restore','auth/callback','auth/login','auth/logout','underlyings','expiries','option-chain','replay','instruments','snapshot','snapshots/coverage','snapshots/replay','snapshots/record','recorder/status','recorder/configure']);
const backend=require('./aliceblue-supervisor.cjs').createSupervisor();
module.exports=async(req,res,url)=>{
 const route=url.pathname.slice('/api/aliceblue/'.length);
 if(!allowed.has(route)||!['GET','POST'].includes(req.method)){res.writeHead(404);return res.end();}
 try{await backend.ensure();}catch{
  res.writeHead(503,{'Content-Type':'application/json','Cache-Control':'no-store'});
  return res.end(JSON.stringify({detail:'The local data backend could not start. Check the Alice Blue Python environment.'}));
 }
 const bodyLimit=4096;let received=0;
 req.on('data',b=>{received+=b.length;if(received>bodyLimit)req.destroy()});
 const upstream=http.request({hostname:'127.0.0.1',port:4180,path:url.pathname+url.search,method:req.method,headers:{...(req.headers.cookie?{cookie:req.headers.cookie}:{}),...(req.headers.origin?{origin:req.headers.origin}:{}),'content-type':'application/json'},timeout:120000},r=>{res.writeHead(r.statusCode,r.headers);r.pipe(res)});
 upstream.on('timeout',()=>upstream.destroy());upstream.on('error',()=>{if(!res.headersSent){res.writeHead(503,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(JSON.stringify({detail:'The data service stopped. Retry to reconnect automatically.'}));}else res.destroy()});req.pipe(upstream);
};

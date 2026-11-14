'use strict';
const http=require('node:http'),path=require('node:path'),fs=require('node:fs'),{spawn}=require('node:child_process');
function health(){return new Promise(resolve=>{
 const req=http.get('http://127.0.0.1:4180/api/aliceblue/health',{timeout:800},res=>{
  let text='';res.on('data',chunk=>{text+=chunk;if(text.length>4096)req.destroy();});
  res.on('end',()=>{try{resolve(res.statusCode===200&&JSON.parse(text).service==='aliceblue-read-only');}catch{resolve(false);}});
 });req.on('timeout',()=>req.destroy());req.on('error',()=>resolve(false));
});}
function launch(){
 const folder=path.resolve(__dirname,'../backend/aliceblue'),python=path.join(folder,'.venv/Scripts/python.exe');
 if(!fs.existsSync(python))throw Error('Alice Blue local Python environment is unavailable');
 const child=spawn(python,[path.join(folder,'run_local.py')],{cwd:folder,windowsHide:true,stdio:'ignore'});
 child.on('error',()=>{});child.unref();
}
function createSupervisor({health:check=health,launch:start=launch,delay=ms=>new Promise(r=>setTimeout(r,ms)),attempts=40}={}){
 let pending=null,lastLaunch=0;
 return {ensure(){
  if(pending)return pending;
  pending=(async()=>{
   if(await check())return;
   if(Date.now()-lastLaunch<10000)throw Error('Alice Blue backend unavailable; retry shortly');
   lastLaunch=Date.now();start();
   for(let i=0;i<attempts;i++){await delay(250);if(await check())return;}
   throw Error('Alice Blue backend unavailable; check the local Python environment');
  })().finally(()=>{pending=null;});
  return pending;
 }};
}
module.exports={createSupervisor};

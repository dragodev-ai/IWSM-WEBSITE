const assert=require('node:assert/strict'),path=require('node:path'),cp=require('node:child_process');
const root=process.env.IWSM_ROOT||path.resolve(__dirname,'..');
const original=cp.execFile;let calls=0;
cp.execFile=(runtime,args,options,callback)=>{calls++;setImmediate(()=>callback(null,JSON.stringify({success:true,contracts:[{symbol:args[1],date:args[2],close:100}],metadata:{symbol:args[1]}})));};
const handler=require(path.join(root,'tools/nse-library-handler.cjs'));
function request(symbol='NIFTY',start='2025-10-14',end=start){return new Promise((resolve,reject)=>{const res={writeHead(status,headers){this.status=status;},end(body){resolve({status:this.status,body:JSON.parse(body)});}};Promise.resolve(handler({method:'GET'},res,new URL('http://localhost/api/nse-library?'+new URLSearchParams({mode:'load',symbol,start,end})))).catch(reject);});}
(async()=>{
 try{
  const first=await request();assert.equal(first.status,200);
  const second=await request();assert.equal(second.body.cached,true);assert.equal(calls,1,'repeat windows must not re-read ZIP files');
  const [a,b]=await Promise.all([request('RELIANCE'),request('RELIANCE')]);assert.equal(a.status,200);assert.equal(b.status,200);assert.equal(calls,2,'identical concurrent requests should share the same read');
  const tata=await request('TCS');assert.equal(tata.body.metadata.symbol,'TCS');assert.equal(calls,3);
  const invalid=await request('NIFTY','2025-10-14','2025-12-01');assert.equal(invalid.status,400);assert.equal(calls,3);
  for(let day=1;day<=9;day++)await request('NIFTY','2025-11-'+String(day).padStart(2,'0'));
  await request();assert.equal(calls,13,'bounded cache should evict older windows');
  console.log('12 archive cache checks passed');
 }finally{cp.execFile=original;}
})().catch(e=>{console.error(e);process.exitCode=1;});

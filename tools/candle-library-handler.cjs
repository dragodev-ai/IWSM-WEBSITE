'use strict';
const path = require('node:path');
const fs = require('node:fs');
const cp = require('node:child_process');
const root = path.resolve(__dirname, '..');
const python = process.env.IWSM_PYTHON_PATH || path.join(root, 'ui-elements/finstack-mcp/.venv/Scripts/python.exe');
const script = path.join(__dirname, 'candle-library.py');
const db = process.env.IWSM_CANDLE_DB_PATH || path.join(root, 'market-data/candle-library.sqlite3');
const MAX_BODY = 10 * 1024 * 1024, MAX_CACHE = 16 * 1024 * 1024;
const windows = new Map();
let cacheBytes = 0, active = 0;
function version() { try { const s = fs.statSync(db); return `${s.mtimeMs}:${s.size}`; } catch { return 'empty'; } }
function remember(key, data) {
  const body = JSON.stringify(data), bytes = Buffer.byteLength(body);
  if (bytes > MAX_CACHE) return;
  while (windows.size && (windows.size >= 8 || cacheBytes + bytes > MAX_CACHE)) {
    const oldest = windows.keys().next().value;
    cacheBytes -= windows.get(oldest).bytes; windows.delete(oldest);
  }
  windows.set(key, {body, bytes, time: Date.now()}); cacheBytes += bytes;
}
function readBody(req) {
  return new Promise((resolve, reject) => {
    let bytes = 0, chunks = [], failed = false;
    req.on('data', chunk => {
      bytes += chunk.length;
      if (bytes > MAX_BODY) {
        if (!failed) { failed = true; chunks = []; reject(Object.assign(new Error('Import exceeds the 10 MB request limit.'), {status:413})); }
      } else if (!failed) chunks.push(chunk);
    });
    req.on('end', () => { if (failed) return; try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))); } catch { reject(Object.assign(new Error('Send a valid JSON import.'), {status:400})); } });
    req.on('error', reject);
    req.on('aborted', () => reject(Object.assign(new Error('Import request aborted.'), {status:400})));
  });
}
function run(body) {
  return new Promise((resolve,reject) => {
    const child = cp.execFile(python,[script],{cwd:root,shell:false,windowsHide:true,timeout:30000,maxBuffer:24*1024*1024,env:{...process.env,PYTHONUTF8:'1',PYTHONIOENCODING:'utf-8'}},(error,stdout) => {
      if (error) return reject(error);
      try { resolve(JSON.parse(stdout)); } catch (error) { reject(error); }
    });
    child.stdin.on('error', () => {});
    child.stdin.end(JSON.stringify(body));
  });
}
module.exports = async (req,res,url) => {
  const reply = (status,data) => { if (res.headersSent || res.destroyed) return; res.writeHead(status,{'Content-Type':'application/json','Cache-Control':'no-store'}); res.end(typeof data === 'string' ? data : JSON.stringify(data)); };
  try {
    const mode = url.searchParams.get('mode') || 'catalog';
    if (!['GET','POST'].includes(req.method)) return reply(405,{success:false,error:'Use GET to read or POST to import.'});
    if ((req.method === 'POST') !== (mode === 'import')) return reply(405,{success:false,error:'Use POST mode=import or GET mode=catalog/load.'});
    if (!['catalog','load','import'].includes(mode)) return reply(400,{success:false,error:'Unknown candle-library mode.'});
    const body = {mode};
    if (mode === 'import') {
      if ((req.headers['sec-fetch-site'] || '').toLowerCase() === 'cross-site' || req.headers.origin === 'null') {
        return reply(403,{success:false,error:'Import origin is not allowed.'});
      }
      if (req.headers.origin) {
        let origin;
        try { origin = new URL(req.headers.origin); } catch { return reply(403,{success:false,error:'Import origin is not allowed.'}); }
        if (!['http:','https:'].includes(origin.protocol) || origin.host !== req.headers.host) return reply(403,{success:false,error:'Import from this local preview origin only.'});
      }
      if (!/^application\/json(?:\s*;|$)/i.test(req.headers['content-type'] || '')) return reply(415,{success:false,error:'Send application/json.'});
      if (Number(req.headers['content-length']) > MAX_BODY) return reply(413,{success:false,error:'Import exceeds the 10 MB request limit.'});
      body.payload = await readBody(req);
    } else if (mode === 'load') {
      for (const key of ['symbol','start','end','timeframe']) body[key] = url.searchParams.get(key) || (key === 'timeframe' ? '1' : '');
    }
    const key = JSON.stringify([version(),body]);
    const hit = mode === 'load' && windows.get(key);
    if (hit && Date.now()-hit.time < 600000) { windows.delete(key); windows.set(key,hit); return reply(200,hit.body); }
    if (hit) { windows.delete(key); cacheBytes -= hit.bytes; }
    if (active >= 4) return reply(429,{success:false,error:'The local candle library is busy; retry shortly.'});
    if (!fs.existsSync(python)) return reply(503,{success:false,error:'The local Python runtime is unavailable.'});
    active++;
    let data;
    try { data = await run(body); } finally { active--; }
    const status = data.success ? 200 : data.status || 400;
    if (data.success && mode === 'import') { windows.clear(); cacheBytes = 0; }
    if (data.success && mode === 'load') remember(key,data);
    return reply(status,data);
  } catch (error) { return reply(error.status || 502,{success:false,error:error.status ? error.message : 'The local candle library could not complete this request.'}); }
};

// Public counselling endpoint. Credentials belong in server environment variables only.
const crypto = require('node:crypto');
const { TextDecoder } = require('node:util');
const MAX_BODY_BYTES = 8000;
const MAX_UPSTREAM_BYTES = 8192;
const RATE_LIMIT_WINDOW_MS = 60000;
const RATE_LIMIT_MAX_PER_IP = 10;
const ALLOWED_REDIRECT_HOSTS = new Set(['script.google.com', 'script.googleusercontent.com']);
const ipHits = new Map();
const UUID_V4 = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
const MONTH = /^20\d{2}-(?:0[1-9]|1[0-2])$/;
const HEADERS = {'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'};
const reply = (statusCode, data) => ({statusCode,headers:{...HEADERS,...(statusCode===405?{Allow:'POST'}:{})},body:JSON.stringify(data)});
const failure = status => reply(status,{success:false,error:status===429?'Too many enquiries submitted right now. Please wait a minute and try again.':status===503?'The enquiry register is unavailable. Please call admissions.':status===400?'Please check your details.':'We could not save your enquiry. Please try again.'});
const isObject = value => value!==null && typeof value==='object' && !Array.isArray(value);

function withinRateLimit(event) {
  const ip = header(event.headers, 'x-nf-client-connection-ip') || (header(event.headers, 'x-forwarded-for') || '').split(',')[0].trim() || 'unknown';
  const now = Date.now();
  const recent = (ipHits.get(ip) || []).filter(ts => now - ts < RATE_LIMIT_WINDOW_MS);
  if (recent.length >= RATE_LIMIT_MAX_PER_IP) return false;
  recent.push(now);
  ipHits.set(ip, recent);
  if (ipHits.size > 1000) {
    for (const [k, list] of ipHits) {
      if (!list.length || now - list[list.length - 1] >= RATE_LIMIT_WINDOW_MS) ipHits.delete(k);
    }
  }
  return true;
}

function signWebhookPayload(secret, data) {
  const hmac_ts = String(Math.floor(Date.now() / 1000));
  const canonical = JSON.stringify([data.submission_id, data.full_name, data.phone, data.email, data.course]);
  const hmac_sig = crypto.createHmac('sha256', secret).update(hmac_ts + '.' + canonical).digest('hex');
  return { secret, hmac_ts, hmac_sig, ...data };
}

async function fetchAllowlistedRedirects(fetchImpl, url, init, maxHops = 3) {
  let current = url;
  let opts = { ...init, redirect: 'manual' };
  for (let hop = 0; hop <= maxHops; hop++) {
    const res = await fetchImpl(current, opts);
    if (res.status >= 300 && res.status < 400) {
      const loc = res.headers && typeof res.headers.get === 'function' ? res.headers.get('location') : '';
      if (!loc) throw Error('Invalid upstream redirect');
      const next = new URL(loc, current);
      if (next.protocol !== 'https:' || !ALLOWED_REDIRECT_HOSTS.has(next.hostname.toLowerCase())) {
        throw Error('Blocked disallowed upstream redirect');
      }
      current = next.toString();
      if (res.status === 301 || res.status === 302 || res.status === 303) {
        opts = { method: 'GET', signal: init.signal, redirect: 'manual' };
      }
      continue;
    }
    return res;
  }
  throw Error('Too many upstream redirects');
}

function header(headers, key) {
  const matches=Object.keys(headers||{}).filter(name=>name.toLowerCase()===key);
  if(matches.length!==1)return matches.length?'invalid-duplicate-header':'';
  const value=headers[matches[0]];
  return typeof value==='string'?value.trim():'invalid-header';
}
function origin(value) {
  if(typeof value!=='string'||!value)return '';
  try {
    const parsed=new URL(value);
    if(!['http:','https:'].includes(parsed.protocol)||parsed.username||parsed.password||parsed.pathname!=='/'||parsed.search||parsed.hash)return '';
    return parsed.origin;
  } catch { return ''; }
}
function validConfiguration(env) {
  return typeof env.IWSM_MONTHLY_SCRIPT_URL==='string' && /^https:\/\/script\.google\.com\/macros\/s\/[A-Za-z0-9_-]+\/exec$/.test(env.IWSM_MONTHLY_SCRIPT_URL) &&
    typeof env.IWSM_MONTHLY_SCRIPT_TOKEN==='string' && env.IWSM_MONTHLY_SCRIPT_TOKEN.trim().length>0 && env.IWSM_MONTHLY_SCRIPT_TOKEN.length<=2048 &&
    (!env.IWSM_ENQUIRY_ORIGIN || !!origin(env.IWSM_ENQUIRY_ORIGIN));
}
function permittedOrigin(event, env, additionalAllowedOrigins) {
  if(header(event.headers,'sec-fetch-site')==='cross-site')return false;
  const incoming=header(event.headers,'origin');
  const fetchMode=header(event.headers,'sec-fetch-mode');
  if(incoming==='null')return false;
  if(!incoming)return !fetchMode;
  const requested=origin(incoming);
  if(!requested)return false;
  const allowed=[env.IWSM_ENQUIRY_ORIGIN,env.URL,env.DEPLOY_PRIME_URL,env.DEPLOY_URL,...additionalAllowedOrigins].map(origin).filter(Boolean);
  // Host and forwarded-host are supplied by callers and do not establish trust.
  return allowed.includes(requested);
}
function parseRequest(event) {
  if(typeof event.body!=='string'||!event.body)return {error:400};
  let bytes;
  if(event.isBase64Encoded===true) {
    if(event.body.length>4*Math.ceil(MAX_BODY_BYTES/3))return {error:413};
    if(!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(event.body))return {error:400};
    bytes=Buffer.from(event.body,'base64');
    if(bytes.toString('base64')!==event.body)return {error:400};
  } else {
    if(event.body.length>MAX_BODY_BYTES)return {error:413};
    bytes=Buffer.from(event.body,'utf8');
  }
  if(bytes.length>MAX_BODY_BYTES)return {error:413};
  let data;
  try { data=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes)); } catch { return {error:400}; }
  if(!isObject(data))return {error:400};
  const string=value=>typeof value==='string'?value.trim():'';
  const name=string(data.full_name),rawPhone=string(data.phone),course=string(data.course),email=data.email===undefined?'':string(data.email);
  const mobile=rawPhone.replace(/[\s()-]/g,'').match(/^(?:\+?91)?([6-9]\d{9})$/);
  const hasControls=value=>/[\u0000-\u001f\u007f]/.test(value);
  if(data['bot-field']||name.length<2||name.length>120||!/[\p{L}]/u.test(name)||hasControls(name)||rawPhone.length>32||!mobile||
    (data.email!==undefined&&typeof data.email!=='string')||email.length>254||hasControls(email)||(email&&!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))||
    !course||course.length>300||hasControls(course)||typeof data.submission_id!=='string'||!UUID_V4.test(data.submission_id))return {error:400};
  return {data:{full_name:name,phone:mobile[1],email,course,submission_id:data.submission_id.toLowerCase()}};
}
async function readResult(response) {
  if(!response.ok)throw Error('Storage rejected');
  // Read a bounded response: Google may return an HTML sign-in/error page.
  let text='';
  if(response.body&&typeof response.body.getReader==='function') {
    const reader=response.body.getReader();let size=0;const chunks=[];
    try {
      while(true){const part=await reader.read();if(part.done)break;size+=part.value.byteLength;if(size>MAX_UPSTREAM_BYTES){reader.cancel().catch(()=>{});throw Error('Oversized acknowledgement');}chunks.push(Buffer.from(part.value));}
      text=Buffer.concat(chunks).toString('utf8');
    } finally { reader.releaseLock(); }
  } else {
    text=await response.text();
    if(Buffer.byteLength(text,'utf8')>MAX_UPSTREAM_BYTES)throw Error('Oversized acknowledgement');
  }
  return JSON.parse(text);
}
function createHandler({env=process.env,fetchImpl,additionalAllowedOrigins=[]}={}) {
  return async function handler(event={}) {
    if(event.httpMethod!=='POST')return failure(405);
    if(!withinRateLimit(event))return failure(429);
    const type=header(event.headers,'content-type');
    if(type&&!/^application\/json(?:\s*;|$)/i.test(type))return failure(415);
    const parsed=parseRequest(event);if(parsed.error)return failure(parsed.error);
    if(!validConfiguration(env))return failure(503);
    if(!permittedOrigin(event,env,additionalAllowedOrigins))return failure(403);
    const data=parsed.data,controller=new AbortController();let timer,timedOut=false;
    try {
      const deadline=new Promise((resolve,reject)=>{timer=setTimeout(()=>{timedOut=true;controller.abort();reject(Error('Deadline exceeded'));},35000);});
      const operation=(async()=>{
        const signedPayload=signWebhookPayload(env.IWSM_MONTHLY_SCRIPT_TOKEN,data);
        const response=await fetchAllowlistedRedirects(fetchImpl||fetch,env.IWSM_MONTHLY_SCRIPT_URL,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(signedPayload),signal:controller.signal});
        return readResult(response);
      })();
      const result=await Promise.race([operation,deadline]);
      if(!isObject(result)||result.success!==true||result.status!=='saved'||typeof result.month!=='string'||!MONTH.test(result.month)||result.submission_id!==data.submission_id)throw Error('Storage unconfirmed');
      return reply(200,{success:true,status:'saved',month:result.month,submission_id:data.submission_id});
    } catch { return failure(timedOut?504:502); }
    finally { clearTimeout(timer);controller.abort(); }
  };
}
exports.handler=createHandler();
exports.createHandler=createHandler;

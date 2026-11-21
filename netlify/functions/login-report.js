// Verify the account with the authentication provider before recording any identity.
const crypto = require('node:crypto');
const ALLOWED_REDIRECT_HOSTS = new Set(['script.google.com', 'script.googleusercontent.com']);
const ipHits = new Map();

function header(headers, key) {
 const matches = Object.keys(headers || {}).filter(name => name.toLowerCase() === key);
 if (matches.length !== 1) return '';
 return typeof headers[matches[0]] === 'string' ? headers[matches[0]].trim() : '';
}

function withinRateLimit(event, limit = 15, windowMs = 60000) {
 const ip = header(event.headers, 'x-nf-client-connection-ip') || (header(event.headers, 'x-forwarded-for') || '').split(',')[0].trim() || 'unknown';
 const now = Date.now();
 const recent = (ipHits.get(ip) || []).filter(ts => now - ts < windowMs);
 if (recent.length >= limit) return false;
 recent.push(now);
 ipHits.set(ip, recent);
 return true;
}

async function fetchAllowlistedRedirects(fetchImpl, url, init, maxHops = 3) {
 let current = url;
 let opts = { ...init, redirect: 'manual' };
 for (let hop = 0; hop <= maxHops; hop++) {
  const res = await fetchImpl(current, opts);
  if (res.status >= 300 && res.status < 400) {
   const loc = res.headers && typeof res.headers.get === 'function' ? res.headers.get('location') : '';
   if (!loc) throw Error('Invalid redirect');
   const next = new URL(loc, current);
   if (next.protocol !== 'https:' || !ALLOWED_REDIRECT_HOSTS.has(next.hostname.toLowerCase())) {
    throw Error('Blocked disallowed redirect');
   }
   current = next.toString();
   if (res.status === 301 || res.status === 302 || res.status === 303) {
    opts = { method: 'GET', signal: init.signal, redirect: 'manual' };
   }
   continue;
  }
  return res;
 }
 throw Error('Too many redirects');
}

function createHandler({env=process.env,fetchImpl=globalThis.fetch}={}) { return async event => {
 const headers = {'Content-Type':'application/json','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'};
 const reply = (statusCode,data) => ({statusCode,headers,body:JSON.stringify(data)});
 if(event.httpMethod!=='POST')return reply(405,{success:false});
 if(header(event.headers,'sec-fetch-site')==='cross-site')return reply(403,{success:false});
 const reqOrigin=header(event.headers,'origin');
 const allowedOrigins=[env.IWSM_ENQUIRY_ORIGIN,env.URL,env.DEPLOY_PRIME_URL,env.DEPLOY_URL,'http://127.0.0.1:4174','http://localhost:4174'].filter(Boolean);
 if(reqOrigin&&!allowedOrigins.includes(reqOrigin))return reply(403,{success:false});
 if(!withinRateLimit(event))return reply(429,{success:false});
 const authorization=header(event.headers,'authorization');
 if(!/^Bearer \S+$/.test(authorization)||authorization.length>12000)return reply(401,{success:false});
 const provider=env.SUPABASE_URL,publicKey=env.SUPABASE_ANON_KEY;
 const endpoint=env.IWSM_MONTHLY_SCRIPT_URL,secret=env.IWSM_MONTHLY_SCRIPT_TOKEN;
 if(!/^https:\/\/[a-z0-9-]+\.supabase\.co$/.test(provider||'')||!publicKey||!/^https:\/\/script\.google\.com\/macros\/s\/[A-Za-z0-9_-]+\/exec$/.test(endpoint||'')||!secret)return reply(503,{success:false});
 try{
  const verification=await fetchImpl(provider+'/auth/v1/user',{headers:{Authorization:authorization,apikey:publicKey},signal:AbortSignal.timeout(8000),redirect:'error'});
  if(!verification.ok)return reply(401,{success:false});
  const user=await verification.json();
  if(!user.id||!user.email||!user.email_confirmed_at)return reply(401,{success:false});
  const fullName=String(user.user_metadata?.full_name||user.user_metadata?.name||'').slice(0,120);
  const providerName=String(user.app_metadata?.provider||'email').slice(0,80);
  const hmac_ts=String(Math.floor(Date.now()/1000));
  const canonical=JSON.stringify(['login',user.id,user.email,fullName,providerName]);
  const hmac_sig=crypto.createHmac('sha256',secret).update(hmac_ts+'.'+canonical).digest('hex');
  const response=await fetchAllowlistedRedirects(fetchImpl,endpoint,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({secret,hmac_ts,hmac_sig,record_type:'login',user_id:user.id,email:user.email,full_name:fullName,provider:providerName}),signal:AbortSignal.timeout(22000)});
  const result=await response.json();
  if(!response.ok||result.success!==true)throw Error('Storage rejected');
  return reply(200,{success:true,month:result.month});
 }catch{return reply(502,{success:false});}
};

}
exports.createHandler=createHandler;
exports.handler=event=>createHandler()(event);

'use strict';
const http = require('node:http');

const allowed = new Set([
  'health',
  'market-status',
  'auth/status',
  'auth/restore',
  'auth/callback',
  'auth/login',
  'auth/apikey',
  'auth/logout',
  'underlyings',
  'expiries',
  'option-chain',
  'replay',
  'instruments',
  'snapshot',
  'snapshots/coverage',
  'snapshots/replay',
  'snapshots/record',
  'recorder/status',
  'recorder/configure',
]);

const HOP_HEADERS = new Set(['connection', 'keep-alive', 'transfer-encoding', 'upgrade', 'proxy-authenticate', 'proxy-authorization', 'te', 'trailer']);
const backend = require('./aliceblue-supervisor.cjs').createSupervisor();

function loopbackCorsHeaders(req) {
  const origin = req.headers.origin || '';
  if (/^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/i.test(origin)) {
    return {
      'Access-Control-Allow-Origin': origin,
      'Access-Control-Allow-Credentials': 'true',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
      Vary: 'Origin',
    };
  }
  if (origin === 'null' && (req.method === 'GET' || req.method === 'OPTIONS')) {
    return {
      'Access-Control-Allow-Origin': 'null',
      'Access-Control-Allow-Methods': 'GET, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
      Vary: 'Origin',
    };
  }
  return {};
}

function readRequestBody(req, maxBytes = 8192) {
  return new Promise((resolve, reject) => {
    if (req.method === 'GET' || req.method === 'HEAD' || req.method === 'OPTIONS') return resolve(Buffer.alloc(0));
    const chunks = [];
    let total = 0;
    req.on('data', chunk => {
      total += chunk.length;
      if (total > maxBytes) {
        req.destroy();
        reject(Object.assign(Error('Request payload too large'), { statusCode: 413 }));
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

module.exports = async (req, res, url) => {
  const route = url.pathname.slice('/api/aliceblue/'.length);
  const cors = loopbackCorsHeaders(req);
  if (!allowed.has(route) || !['GET', 'POST', 'OPTIONS'].includes(req.method)) {
    res.writeHead(404, cors);
    return res.end();
  }
  if (req.method === 'OPTIONS') {
    res.writeHead(204, cors);
    return res.end();
  }

  let bodyBuf;
  try {
    bodyBuf = await readRequestBody(req);
  } catch (err) {
    res.writeHead(err.statusCode || 400, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...cors });
    return res.end(JSON.stringify({ detail: err.message || 'Invalid request payload' }));
  }

  try {
    await backend.ensure();
  } catch {
    res.writeHead(503, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...cors });
    return res.end(JSON.stringify({ detail: 'The local market-data backend could not start. Check the Python environment.' }));
  }

  const reqHeaders = {
    ...(req.headers.cookie ? { cookie: req.headers.cookie } : {}),
    ...(req.headers.origin ? { origin: req.headers.origin } : {}),
    ...(req.headers['accept-encoding'] ? { 'accept-encoding': req.headers['accept-encoding'] } : {}),
    'content-type': req.headers['content-type'] || 'application/json',
    ...(bodyBuf.length ? { 'content-length': String(bodyBuf.length) } : {}),
  };

  const upstream = http.request(
    {
      hostname: '127.0.0.1',
      port: 4180,
      path: url.pathname + url.search,
      method: req.method,
      headers: reqHeaders,
      timeout: 120000,
    },
    r => {
      const outHeaders = {};
      for (const [k, v] of Object.entries(r.headers)) {
        if (!HOP_HEADERS.has(k.toLowerCase()) && v !== undefined) outHeaders[k] = v;
      }
      for (const [k, v] of Object.entries(cors)) {
        if (outHeaders[k.toLowerCase()] === undefined && outHeaders[k] === undefined) outHeaders[k] = v;
      }
      res.writeHead(r.statusCode || 502, outHeaders);
      r.pipe(res);
    }
  );

  upstream.on('timeout', () => {
    backend.invalidate();
    upstream.destroy();
  });
  upstream.on('error', () => {
    backend.invalidate();
    if (!res.headersSent) {
      res.writeHead(503, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...cors });
      res.end(JSON.stringify({ detail: 'The data service stopped. Retry to reconnect automatically.' }));
    } else {
      res.destroy();
    }
  });

  if (bodyBuf.length) upstream.write(bodyBuf);
  upstream.end();
};

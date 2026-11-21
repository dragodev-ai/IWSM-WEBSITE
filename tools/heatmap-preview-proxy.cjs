'use strict';
const http = require('node:http');
const net = require('node:net');

const HOP_HEADERS = new Set(['connection', 'keep-alive', 'transfer-encoding', 'upgrade', 'proxy-authenticate', 'proxy-authorization', 'te', 'trailer']);
const backend = require('./aliceblue-supervisor.cjs').createSupervisor();

const ALLOWED_WS_UPGRADE_HEADERS = new Set([
  'upgrade',
  'connection',
  'sec-websocket-key',
  'sec-websocket-version',
  'sec-websocket-extensions',
  'sec-websocket-protocol',
  'origin',
]);

function isAllowedOrigin(origin) {
  if (!origin || origin === 'null') return false;
  if (/^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/i.test(origin)) return true;
  const extras = (process.env.IWSM_ALLOWED_ORIGINS || '').split(',').map(s => s.trim()).filter(Boolean);
  return extras.includes(origin);
}

function loopbackCorsHeaders(req) {
  const origin = req.headers.origin || '';
  if (isAllowedOrigin(origin)) {
    return {
      'Access-Control-Allow-Origin': origin,
      'Access-Control-Allow-Credentials': 'true',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
      Vary: 'Origin',
    };
  }
  return {};
}

function readRequestBody(req, maxBytes = 32768) {
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

async function httpProxy(req, res, url) {
  const cors = loopbackCorsHeaders(req);
  if (!['GET', 'POST', 'OPTIONS'].includes(req.method)) {
    res.writeHead(405, cors);
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
    return res.end(JSON.stringify({ detail: 'The local market-data backend could not start.' }));
  }

  const reqHeaders = {
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
      timeout: 60000,
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
      res.end(JSON.stringify({ detail: 'Market-data backend disconnected; retry shortly.' }));
    } else {
      res.destroy();
    }
  });

  if (bodyBuf.length) upstream.write(bodyBuf);
  upstream.end();
}

async function wsProxy(req, socket, head) {
  const url = new URL(req.url, 'http://127.0.0.1');
  if (!url.pathname.startsWith('/api/heatmap/ws')) {
    socket.destroy();
    return;
  }
  const reqOrigin = req.headers.origin || '';
  if ((req.headers['sec-fetch-site'] || '').toLowerCase() === 'cross-site' || (reqOrigin && !isAllowedOrigin(reqOrigin))) {
    socket.write('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n');
    socket.destroy();
    return;
  }
  try {
    await backend.ensure();
  } catch {
    socket.destroy();
    return;
  }
  const upstreamSocket = net.connect(4180, '127.0.0.1', () => {
    const rawHeaders = [`GET ${url.pathname + url.search} HTTP/1.1`, 'Host: 127.0.0.1:4180'];
    for (let i = 0; i < req.rawHeaders.length; i += 2) {
      const k = req.rawHeaders[i];
      const v = req.rawHeaders[i + 1];
      if (ALLOWED_WS_UPGRADE_HEADERS.has(k.toLowerCase())) rawHeaders.push(`${k}: ${v}`);
    }
    rawHeaders.push('', '');
    upstreamSocket.write(rawHeaders.join('\r\n'));
    if (head && head.length) upstreamSocket.write(head);
    upstreamSocket.pipe(socket);
    socket.pipe(upstreamSocket);
  });
  upstreamSocket.on('error', () => socket.destroy());
  socket.on('error', () => upstreamSocket.destroy());
}

module.exports = { httpProxy, wsProxy };

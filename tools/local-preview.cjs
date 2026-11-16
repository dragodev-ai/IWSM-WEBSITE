// Local-only IWSM preview. The new NSE/BSE API requires no credentials.
// Optional private configuration files may enable the older providers.
const http = require('node:http'), fs = require('node:fs'), path = require('node:path');
const root = path.resolve(__dirname, '..');
const enquiryConfigPath = process.env.IWSM_ENQUIRY_CONFIG || path.join(process.env.LOCALAPPDATA || path.join(require('node:os').homedir(), 'AppData', 'Local'), 'IWSM', 'monthly-enquiries.json');
const enquiryRoute = require('./enquiry-preview-handler.cjs').createPreviewHandler({ websiteRoot: root, configPath: enquiryConfigPath });
const loginRoute = require('./login-preview-handler.cjs')({ websiteRoot: root, configPath: enquiryConfigPath });
const nseHistory = require(root + '/netlify/functions/nse-history.js').handler;
const finstack = require(root + '/netlify/functions/finstack-data.js').handler;
const stockMarket = require(root + '/netlify/functions/indian-stock-market.js').handler;
const quote = require(root + '/netlify/functions/marketstack-quotes.js').handler;
const indianReference = require(root + '/netlify/functions/bharatstock-reference.js').handler;
const mime = { '.html': 'text/html; charset=utf-8', '.txt': 'text/plain; charset=utf-8', '.xml': 'application/xml; charset=utf-8', '.css': 'text/css', '.js': 'application/javascript', '.json': 'application/json', '.webp': 'image/webp', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.svg': 'image/svg+xml', '.ttf': 'font/ttf', '.woff2': 'font/woff2', '.mp4': 'video/mp4', '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', '.csv': 'text/csv; charset=utf-8' };

function applyLoopbackCors(req, res) {
  const origin = req.headers.origin || '';
  if (/^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/i.test(origin) || /^https:\/\/dragodev-ai\.github\.io$/i.test(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Access-Control-Allow-Credentials', 'true');
    res.setHeader('Access-Control-Allow-Private-Network', 'true');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    res.setHeader('Vary', 'Origin');
  } else if (origin === 'null' && (req.method === 'GET' || req.method === 'OPTIONS')) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  }
}

const server = http.createServer(async (req, res) => {
  try {
  const url = new URL(req.url, 'http://127.0.0.1');
  if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/.netlify/functions/')) {
    applyLoopbackCors(req, res);
    if (req.method === 'OPTIONS' && !url.pathname.startsWith('/api/aliceblue/') && !url.pathname.startsWith('/api/heatmap/')) {
      res.writeHead(204);
      return res.end();
    }
  }
  if (url.pathname === '/.netlify/functions/collect-enquiry') return enquiryRoute(req, res);
  if (url.pathname === '/.netlify/functions/login-report') return loginRoute(req, res);
  if (url.pathname.startsWith('/api/aliceblue/')) return require('./aliceblue-preview-proxy.cjs')(req, res, url);
  if (url.pathname.startsWith('/api/heatmap/')) return require('./heatmap-preview-proxy.cjs').httpProxy(req, res, url);
  if (url.pathname === '/api/bhav-analysis') return require('./bhav-analysis-handler.cjs')(req, res);
  if (url.pathname === '/api/candle-library') return require('./candle-library-handler.cjs')(req, res, url);
  if (url.pathname === '/api/nse-reference') return require('./nse-official-mcp.cjs').handler(req, res, url);
  if (url.pathname === '/api/nse-library') return require('./nse-library-handler.cjs')(req, res, url);
  if (url.pathname === '/.netlify/functions/nse-history') { const result = await nseHistory({ httpMethod: req.method, queryStringParameters: Object.fromEntries(url.searchParams) }); res.writeHead(result.statusCode, result.headers); return res.end(result.body); }
  if (url.pathname === '/.netlify/functions/finstack-data') { const result = await finstack({ httpMethod: req.method, queryStringParameters: Object.fromEntries(url.searchParams) }); res.writeHead(result.statusCode, result.headers); return res.end(result.body); }
  if (url.pathname === '/.netlify/functions/indian-stock-market') { const result = await stockMarket({ httpMethod: req.method, queryStringParameters: Object.fromEntries(url.searchParams) }); res.writeHead(result.statusCode, result.headers); return res.end(result.body); }
  if (url.pathname === '/.netlify/functions/marketstack-quotes') { const result = await quote({ httpMethod: req.method, queryStringParameters: Object.fromEntries(url.searchParams) }); res.writeHead(result.statusCode, result.headers); return res.end(result.body); }
  if (url.pathname === '/.netlify/functions/bharatstock-reference') { const result = await indianReference({ httpMethod: req.method, queryStringParameters: Object.fromEntries(url.searchParams) }); res.writeHead(result.statusCode, result.headers); return res.end(result.body); }
  let pathname; try { pathname = decodeURIComponent(url.pathname); } catch { res.writeHead(400); return res.end(); }
  if (pathname === '/') pathname = '/index.html';
  const allowed = /^\/(index\.html|reviews\.html|strategy-builder\.html|robots\.txt|sitemap\.xml|(?:css|js|assets|BANNERS)\/[^\\]*)$/i.test(pathname) && !pathname.split('/').some(part => part.startsWith('.'));
  const target = path.resolve(root, '.' + pathname);
  if (!allowed || !target.toLowerCase().startsWith(path.resolve(root).toLowerCase() + path.sep)) { res.writeHead(404); return res.end('Not found'); }
  try { const stat = fs.statSync(target); if (!stat.isFile()) throw Error(); res.writeHead(200, { 'Content-Type': mime[path.extname(target).toLowerCase()] || 'application/octet-stream', 'Cache-Control': 'no-cache', 'X-Content-Type-Options': 'nosniff' }); fs.createReadStream(target).pipe(res); } catch { res.writeHead(404); res.end('Not found'); }
  } catch (err) {
    if (!res.headersSent) { res.writeHead(500, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ detail: err?.message || 'Internal preview error' })); }
    else { try { res.end(); } catch {} }
  }
});
server.on('upgrade', (req, socket, head) => require('./heatmap-preview-proxy.cjs').wsProxy(req, socket, head));
server.listen(4174, '0.0.0.0', () => console.log('IWSM Strategy Lab: http://127.0.0.1:4174/strategy-builder.html (local network enabled)'));

'use strict';
const path = require('node:path'), fs = require('node:fs'), cp = require('node:child_process');
const root = path.resolve(__dirname, '..'), script = path.join(root, 'tools/nse-local-library.py');

function resolvePython() {
  const candidates = [
    process.env.IWSM_PYTHON_PATH,
    path.join(root, 'ui-elements/finstack-mcp/.venv/Scripts/python.exe'),
    path.join(root, 'backend/aliceblue/.venv/Scripts/python.exe'),
  ].filter(Boolean);
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) return candidate;
  }
  return 'python';
}

const python = resolvePython();
let catalog = null, activeLoads = 0;
const windows = new Map(), reads = new Map(), MAX_CACHE_BYTES = 64 * 1024 * 1024, MAX_WINDOWS = 8, TTL = 10 * 60 * 1000, MAX_CONCURRENT_LOADS = 4;
let cacheBytes = 0;

function archiveVersion() {
  try { return fs.statSync(path.join(root, 'market-data/nse-derivatives/archive.sqlite3')).mtimeMs; }
  catch { return 0; }
}

function cachedWindow(key) {
  const entry = windows.get(key);
  if (!entry) return null;
  if (Date.now() - entry.time > TTL) {
    windows.delete(key);
    cacheBytes -= entry.bytes;
    return null;
  }
  windows.delete(key);
  windows.set(key, entry);
  return entry.body;
}

function remember(key, data) {
  const body = JSON.stringify({ ...data, cached: true }), bytes = Buffer.byteLength(body);
  if (bytes > MAX_CACHE_BYTES) return;
  while (windows.size && (windows.size >= MAX_WINDOWS || cacheBytes + bytes > MAX_CACHE_BYTES)) {
    const oldest = windows.keys().next().value;
    cacheBytes -= windows.get(oldest).bytes;
    windows.delete(oldest);
  }
  windows.set(key, { body, bytes, time: Date.now() });
  cacheBytes += bytes;
}

module.exports = async (req, res, url) => {
  const reply = (status, data) => {
    res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
    res.end(JSON.stringify(data));
  };
  if (req.method !== 'GET') return reply(405, { success: false, error: 'Use GET.' });
  if (url.searchParams.get('mode') === 'workbook') {
    const workbook = path.join(root, 'market-data/nse-derivatives/NSE Derivatives 5-Year Catalog.xlsx');
    if (!fs.existsSync(workbook)) return reply(404, { success: false, error: 'The Excel catalog is not ready.' });
    res.writeHead(200, {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': 'attachment; filename="IWSM-NSE-5-Year-Catalog.xlsx"',
      'Cache-Control': 'no-store',
    });
    return fs.createReadStream(workbook).pipe(res);
  }

  const mode = url.searchParams.get('mode') || 'catalog';
  const symbol = url.searchParams.get('symbol') || '';
  const start = url.searchParams.get('start') || '';
  const end = url.searchParams.get('end') || '';
  const validDate = d => /^\d{4}-\d{2}-\d{2}$/.test(d) && !Number.isNaN(Date.parse(d)) && new Date(d + 'T00:00:00Z').toISOString().slice(0, 10) === d;

  if (!['catalog', 'load'].includes(mode) || (mode === 'load' && (!/^[A-Z0-9&._-]{1,40}$/.test(symbol) || !validDate(start) || !validDate(end) || start > end || (Date.parse(end) - Date.parse(start)) / 86400000 > 30))) {
    return reply(400, { success: false, error: 'Select a valid symbol and up to 31 calendar days.' });
  }
  if (mode === 'catalog' && catalog && Date.now() - catalog.time < 30000) return reply(200, catalog.data);

  const key = JSON.stringify([archiveVersion(), symbol, start, end]);
  if (mode === 'load') {
    const stored = cachedWindow(key);
    if (stored) {
      res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
      return res.end(stored);
    }
    if (reads.has(key)) {
      const shared = await reads.get(key);
      return reply(shared.status, shared.data);
    }
    if (activeLoads >= MAX_CONCURRENT_LOADS) {
      return reply(429, { success: false, error: 'Multiple historical windows are loading. Please retry in a moment.' });
    }
  }
  if (python !== 'python' && !fs.existsSync(python)) return reply(503, { success: false, error: 'The local Python runtime is unavailable.' });

  let finishShared;
  if (mode === 'load') {
    activeLoads++;
    reads.set(key, new Promise(resolve => { finishShared = resolve; }));
  }
  try {
    const data = await new Promise((resolve, reject) =>
      cp.execFile(
        python,
        [script, ...(mode === 'load' ? [symbol, start, end] : [])],
        { cwd: root, shell: false, windowsHide: true, timeout: 120000, maxBuffer: 75 * 1024 * 1024, env: { ...process.env, PYTHONUTF8: '1', PYTHONIOENCODING: 'utf-8' } },
        (error, stdout) => {
          if (error) return reject(error);
          try { resolve(JSON.parse(stdout)); }
          catch (e) { reject(e); }
        }
      )
    );
    if (mode === 'catalog' && data.success) catalog = { time: Date.now(), data };
    if (mode === 'load' && data.success) remember(key, data);
    const status = data.success ? 200 : 404;
    if (finishShared) finishShared({ status, data });
    reply(status, data);
  } catch {
    const data = { success: false, error: 'The local archive could not be read. Your existing dataset is unchanged.' };
    if (finishShared) finishShared({ status: 502, data });
    reply(502, data);
  } finally {
    if (mode === 'load') {
      activeLoads = Math.max(0, activeLoads - 1);
      reads.delete(key);
    }
  }
};

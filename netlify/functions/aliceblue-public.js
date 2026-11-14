'use strict';
const https = require('node:https');

const MASTER_URLS = {
  NFO: 'https://v2api.aliceblueonline.com/restpy/static/contract_master/NFO.json',
  BFO: 'https://v2api.aliceblueonline.com/restpy/static/contract_master/BFO.json',
};

const MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
let masterCache = { time: 0, instruments: null, expiriesByKey: null };

function istMarketStatus() {
  const nowIst = new Date(Date.now() + 19800000);
  const date = nowIst.toISOString().slice(0, 10);
  const time = nowIst.toISOString().slice(11, 16);
  const day = nowIst.getUTCDay();
  const isWeekend = day === 0 || day === 6;
  const mins = nowIst.getUTCHours() * 60 + nowIst.getUTCMinutes();
  const isOpen = !isWeekend && mins >= 9 * 60 + 15 && mins <= 15 * 60 + 30;
  return {
    date,
    time,
    timezone: 'Asia/Kolkata',
    isOpen,
    reason: isOpen ? 'NSE/BSE Derivatives Open' : isWeekend ? 'Weekend' : mins < 555 ? 'Pre-Open' : 'Post-Close',
  };
}

function fetchJson(url) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, { timeout: 15000 }, res => {
      if (res.statusCode !== 200) {
        res.resume();
        return reject(Error(`HTTP ${res.statusCode}`));
      }
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => {
        try {
          resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));
        } catch (err) {
          reject(err);
        }
      });
    });
    req.on('timeout', () => { req.destroy(); reject(Error('Timeout')); });
    req.on('error', reject);
  });
}

function msToIso(ms) {
  const n = Number(ms);
  if (!Number.isFinite(n) || n <= 0) return '';
  return new Date(n + 19800000).toISOString().slice(0, 10);
}

function isoToCode(iso) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso || '')) return '';
  const [y, m, d] = iso.split('-');
  return d + MONTHS[Number(m) - 1] + y.slice(2);
}

async function ensureMasters() {
  if (masterCache.instruments && Date.now() - masterCache.time < 3600000) return masterCache;
  const [nfoRaw, bfoRaw] = await Promise.all([
    fetchJson(MASTER_URLS.NFO).catch(() => null),
    fetchJson(MASTER_URLS.BFO).catch(() => null),
  ]);
  const byKey = new Map();
  const expiriesByKey = new Map();
  const today = istMarketStatus().date;

  for (const [seg, exch, payload] of [['NFO', 'nse_fo', nfoRaw], ['BFO', 'bse_fo', bfoRaw]]) {
    const rows = Array.isArray(payload?.[seg]) ? payload[seg] : [];
    for (const r of rows) {
      const inst = String(r.instrument_type || '');
      if (!/^(OPTIDX|OPTSTK|FUTIDX|FUTSTK|IO|SO|IF|SF)$/i.test(inst)) continue;
      const sym = String(r.symbol || '').trim().toUpperCase();
      if (!sym) continue;
      const kind = /IDX|IO|IF/i.test(inst) ? 'index' : 'stock';
      const key = `${exch}|${sym}`;
      let rec = byKey.get(key);
      if (!rec) {
        rec = {
          symbol: sym,
          underlying: String(r.underlying || sym),
          exchange: exch,
          kind,
          lotSize: Number(r.lot_size) || null,
          chainAvailable: true,
        };
        byKey.set(key, rec);
      } else if (!rec.lotSize && Number(r.lot_size) > 0) {
        rec.lotSize = Number(r.lot_size);
      }
      if (/OPT|IO|SO/i.test(inst)) {
        const expIso = msToIso(r.expiry_date);
        if (expIso && expIso >= today) {
          let set = expiriesByKey.get(key);
          if (!set) { set = new Set(); expiriesByKey.set(key, set); }
          set.add(expIso);
        }
      }
    }
  }

  const instruments = [...byKey.values()].sort((a, b) => (a.kind !== b.kind ? (a.kind === 'index' ? -1 : 1) : a.symbol.localeCompare(b.symbol)));
  masterCache = { time: Date.now(), instruments, expiriesByKey };
  return masterCache;
}

exports.handler = async event => {
  const headers = { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' };
  const reply = (statusCode, body) => ({ statusCode, headers, body: JSON.stringify(body) });
  const q = event.queryStringParameters || {};
  const route = String(q.route || (event.path || '').replace(/^.*\/api\/aliceblue\//, '')).replace(/^\/+|\/+$/g, '');
  const marketStatus = istMarketStatus();
  const emptyCoverage = { hasSnapshots: false, earliestDate: null, earliestTimestamp: null, latestTimestamp: null, frameCount: 0, contractRowCount: 0, symbols: [] };

  if (route === 'health') {
    return reply(200, { ok: true, service: 'iwsm-serverless-public', execution: 'disabled', marketStatus, snapshotCoverage: emptyCoverage });
  }
  if (route === 'market-status') {
    return reply(200, { marketStatus, snapshotCoverage: emptyCoverage });
  }
  if (route === 'auth/status') {
    return reply(200, { connected: false, execution: 'disabled', serverless: true, marketStatus });
  }
  if (route === 'snapshots/coverage') {
    return reply(200, emptyCoverage);
  }
  if (route === 'recorder/status') {
    return reply(200, { enabled: false, intervalSeconds: 60, targets: [], lastRunAt: null, lastStatus: 'serverless-static', marketStatus, coverage: emptyCoverage });
  }
  if (route === 'instruments') {
    try {
      const m = await ensureMasters();
      return reply(200, { instruments: m.instruments, marketStatus });
    } catch {
      return reply(200, { instruments: [], marketStatus });
    }
  }
  if (route === 'expiries') {
    const sym = String(q.underlying || 'NIFTY').trim().toUpperCase();
    const exch = String(q.exch || 'nse_fo').trim().toLowerCase();
    try {
      const m = await ensureMasters();
      const isoList = [...(m.expiriesByKey.get(`${exch}|${sym}`) || [])].sort();
      const monthMax = {};
      for (const iso of isoList) {
        const ym = iso.slice(0, 7);
        if (!monthMax[ym] || iso > monthMax[ym]) monthMax[ym] = iso;
      }
      const refMs = Date.parse(marketStatus.date + 'T00:00:00Z');
      const expiryDetails = isoList.map(iso => ({
        iso,
        expiry: isoToCode(iso),
        cycle: monthMax[iso.slice(0, 7)] === iso ? 'monthly' : 'weekly',
        dte: Math.round((Date.parse(iso + 'T00:00:00Z') - refMs) / 86400000),
      }));
      return reply(200, {
        underlying: sym,
        exchange: exch,
        expiries: expiryDetails.map(d => d.expiry),
        expiryDetails,
        publicMaster: true,
        source: 'Exchange Contract Directory',
      });
    } catch {
      return reply(502, { detail: 'Public contract master temporarily unavailable.' });
    }
  }

  return reply(503, {
    detail: 'Live intraday market feed runs through the local IWSM backend (node tools/local-preview.cjs on http://127.0.0.1:4174).',
  });
};

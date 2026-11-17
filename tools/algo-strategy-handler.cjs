'use strict';
const https = require('node:https');

const UPSTREAM_URL = 'https://1lyalgos-api.inuvest.trade/strategy/sensex-opt-buying';
const CACHE_TTL_MS = 5 * 60 * 1000;
let cachedPayload = null;
let cachedAt = 0;

function fetchUpstreamJson(url) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, { timeout: 8000, headers: { Accept: 'application/json' } }, (res) => {
      if (res.statusCode !== 200) {
        res.resume();
        return reject(new Error(`Upstream status ${res.statusCode}`));
      }
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        try {
          resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));
        } catch (err) {
          reject(err);
        }
      });
    });
    req.on('error', reject);
    req.on('timeout', () => {
      req.destroy(new Error('Upstream request timed out'));
    });
  });
}

function formatDurationDays(days) {
  const d = Math.max(0, Number(days) || 0);
  if (!d) return '';
  const years = Math.floor(d / 365);
  const remAfterYears = d % 365;
  const months = Math.floor(remAfterYears / 30);
  const remDays = remAfterYears % 30;
  const parts = [];
  if (years) parts.push(`${years} year${years === 1 ? '' : 's'}`);
  if (months) parts.push(`${months} month${months === 1 ? '' : 's'}`);
  if (remDays) parts.push(`${remDays} day${remDays === 1 ? '' : 's'}`);
  return parts.join(' ');
}

function normalizeStrategyResponse(raw) {
  const strat = (raw && raw.strategy) || {};
  const rows = Array.isArray(raw && raw.profit_loss) ? raw.profit_loss : [];
  const trades = rows
    .map((r) => {
      const entryTime = String(r.entry_time || r.exit_time || '');
      const exitTime = String(r.exit_time || r.entry_time || '');
      const date = entryTime.slice(0, 10);
      if (!date) return null;
      return {
        date,
        entryTime,
        exitTime,
        instrument: String(r.instrument || ''),
        quantity: Number(r.quantity) || 1,
        buy: Number(r.buy_price) || 0,
        sell: Number(r.sell_price) || 0,
        pnl: Number(r.pnl) || 0,
        brokerage: Number(r.brokerage) || 0,
      };
    })
    .filter(Boolean)
    .sort((a, b) => new Date(a.entryTime).getTime() - new Date(b.entryTime).getTime());

  const backtestDays = Number(strat.backtest_period) || 1050;
  return {
    retrievedAt: new Date().toISOString(),
    strategyName: 'SENSEX Option Buying',
    subtitle: (strat.rules && strat.rules.text) ? String(strat.rules.text) : 'Option buying scalping strategy',
    capital: Number(strat.min_amount) || 18000,
    reportedWinRate: Number(strat.win_rate) || 60.12,
    reportedDrawdownPercent: Number(strat.average_drawdown) || 24.2,
    backtestPeriodDays: backtestDays,
    backtestPeriodLabel: backtestDays === 1050 ? '2 years 10 months 20 days' : formatDurationDays(backtestDays),
    riskType: String(strat.risk_type || 'Medium'),
    longestWinningStreak: Number(strat.longest_winning_streak) || 12,
    longestLosingStreak: Number(strat.longest_losing_streak) || 5,
    listedBrokerageTotal: Number(raw && raw.brokerage) || 0,
    trades,
  };
}

module.exports = async function algoStrategyHandler(req, res) {
  if (req.method !== 'GET') {
    res.writeHead(405, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ detail: 'Method not allowed' }));
  }
  const now = Date.now();
  if (cachedPayload && now - cachedAt < CACHE_TTL_MS) {
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'public, max-age=120' });
    return res.end(cachedPayload);
  }
  try {
    const upstream = await fetchUpstreamJson(UPSTREAM_URL);
    const normalized = normalizeStrategyResponse(upstream);
    if (!normalized.trades.length) throw new Error('Empty trade list');
    cachedPayload = JSON.stringify(normalized);
    cachedAt = now;
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'public, max-age=120' });
    return res.end(cachedPayload);
  } catch {
    const fs = require('node:fs');
    const path = require('node:path');
    const fallbackFile = path.resolve(__dirname, '..', 'assets', 'strategy-results', 'sensex-option-buying.json');
    try {
      const disk = fs.readFileSync(fallbackFile, 'utf8');
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-cache' });
      return res.end(disk);
    } catch {
      res.writeHead(503, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ detail: 'Strategy feed temporarily unavailable' }));
    }
  }
};

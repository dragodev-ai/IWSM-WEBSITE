'use strict';
const assert = require('node:assert/strict');
const path = require('node:path');

const jsDir = path.resolve(__dirname, '../js');
const M = require(path.join(jsDir, 'options-simulator-engine.js'));
const P = require(path.join(jsDir, 'options-paper-execution.js'));
const A = require(path.join(jsDir, 'options-paper-analysis.js'));
const E = require(path.join(jsDir, 'strategy-engine.js'));
const Q = require(path.join(jsDir, 'strategy-research-engine.js'));
const Chart = require(path.join(jsDir, 'options-paper-chart.js'));
const Templates = require(path.join(jsDir, 'options-paper-templates.js'));

let checks = 0;
function eq(a, b, msg) {
  assert.deepEqual(a, b, msg);
  checks++;
}
function near(a, b, tol = 1e-4, msg = '') {
  assert.ok(Number.isFinite(a) && Number.isFinite(b) && Math.abs(a - b) <= tol, `${msg} expected ${b}, got ${a}`);
  checks++;
}
function ok(cond, msg) {
  assert.ok(cond, msg);
  checks++;
}

// Build a realistic multi-strike, multi-expiry, multi-timestamp fixture with zero fees for pure payoff math checks
function buildChainDataset({ symbol = 'NIFTY', lotSize = 65, spot0 = 24000, spot1 = 24120 } = {}) {
  const t0 = '2026-11-10T09:15';
  const t1 = '2026-11-10T09:20';
  const expNear = '2026-11-17';
  const expFar = '2026-11-24';
  const strikes = [23600, 23700, 23800, 23900, 24000, 24100, 24200, 24300, 24400];

  const callQuotes0 = { 23600: 430, 23700: 345, 23800: 240, 23900: 190, 24000: 150, 24100: 95, 24200: 60, 24300: 35, 24400: 20 };
  const putQuotes0  = { 23600: 25,  23700: 42,  23800: 70,  23900: 102, 24000: 140, 24100: 190, 24200: 255, 24300: 330, 24400: 415 };

  const contracts = [];
  for (const [ts, sp, shift] of [[t0, spot0, 0], [t1, spot1, 55]]) {
    contracts.push({
      timestamp: ts,
      symbol,
      expiry: expNear,
      type: 'FUT',
      strike: 0,
      open: sp + 35,
      high: sp + 50,
      low: sp + 20,
      close: sp + 40,
      lotSize,
      volume: 12000,
      oi: 850000,
    });
    for (const k of strikes) {
      contracts.push({
        timestamp: ts,
        symbol,
        expiry: expNear,
        type: 'CE',
        strike: k,
        open: callQuotes0[k],
        high: callQuotes0[k] + shift + 10,
        low: Math.max(1, callQuotes0[k] - 10),
        close: Math.max(1, callQuotes0[k] + shift * 0.5),
        lotSize,
        volume: k === 23600 && ts === t1 ? 0 : 5000,
        oi: 150000,
        previousOi: 140000,
        oiChange: 10000,
        bid: Math.max(0.5, callQuotes0[k] + shift * 0.5 - 0.5),
        ask: callQuotes0[k] + shift * 0.5 + 0.5,
      });
      contracts.push({
        timestamp: ts,
        symbol,
        expiry: expNear,
        type: 'PE',
        strike: k,
        open: putQuotes0[k],
        high: putQuotes0[k] + 10,
        low: Math.max(1, putQuotes0[k] - shift * 0.5 - 5),
        close: Math.max(1, putQuotes0[k] - shift * 0.4),
        lotSize,
        volume: 5000,
        oi: 165000,
        previousOi: 160000,
        oiChange: 5000,
        bid: Math.max(0.5, putQuotes0[k] - shift * 0.4 - 0.5),
        ask: putQuotes0[k] - shift * 0.4 + 0.5,
      });
    }
    // Far-expiry 24000 CE for Calendar Spread verification
    contracts.push({
      timestamp: ts,
      symbol,
      expiry: expFar,
      type: 'CE',
      strike: 24000,
      open: 230,
      high: 265,
      low: 225,
      close: 230 + shift * 0.45,
      lotSize,
      volume: 3200,
      oi: 90000,
    });
  }

  return M.prepareDataset({
    source: 'Test Verified Chain',
    metadata: { exchange: 'nse_fo', rate: 6.5, dividend: 0, indiaVix: 14.25 },
    underlying: [
      { symbol, timestamp: t0, close: spot0, indiaVix: 14.25 },
      { symbol, timestamp: t1, close: spot1, indiaVix: 13.90 },
    ],
    contracts,
  });
}

const zeroFeeSettings = { initialBalance: 5000000, feePerOrder: 0, feeBps: 0, slippage: 0, marginRate: 0.1, rate: 6.5, dividend: 0 };

// 1. Metadata & Contract Field Preservation (Bid/Ask, Chg OI, India VIX)
{
  const d = buildChainDataset();
  const ce = d.records.get('NIFTY|2026-11-10T09:15|2026-11-17|CE|24000');
  near(ce.bid, 149.5);
  near(ce.ask, 150.5);
  eq(ce.oiChange, 10000);
  near(d.vix.get('NIFTY|2026-11-10T09:15'), 14.25);
  near(d.vix.get('NIFTY|2026-11-10T09:20'), 13.90);
}

// 2. Single-Leg Payoff, Net Premium & Breakeven Verification
{
  const d = buildChainDataset();

  // Long Call: +1x 24000 CE @ 150 (lot 65)
  let s = P.create(d, zeroFeeSettings);
  s = P.order(d, s, { type: 'CE', expiry: '2026-11-17', strike: 24000, side: 1, lots: 1 });
  let a = A.analyze(d, s, { expiry: '2026-11-17' });
  eq(a.risk.maxProfit, Infinity, 'Long Call max profit is Unlimited');
  near(a.risk.maxLoss, 150 * 65, 1e-4, 'Long Call max loss');
  near(a.risk.breaks[0], 24150, 1e-4, 'Long Call breakeven');
  eq(a.netPremiumKind, 'debit');
  near(a.netPremium, -150 * 65);

  // Short Call: -1x 24000 CE @ 150 (lot 65)
  s = P.create(d, zeroFeeSettings);
  s = P.order(d, s, { type: 'CE', expiry: '2026-11-17', strike: 24000, side: -1, lots: 1 });
  a = A.analyze(d, s, { expiry: '2026-11-17' });
  near(a.risk.maxProfit, 150 * 65, 1e-4, 'Short Call max profit');
  eq(a.risk.maxLoss, Infinity, 'Short Call max loss is Unlimited');
  near(a.risk.breaks[0], 24150, 1e-4, 'Short Call breakeven');
  eq(a.netPremiumKind, 'credit');
  near(a.netPremium, 150 * 65);

  // Long Put: +1x 24000 PE @ 140 (lot 65)
  s = P.create(d, zeroFeeSettings);
  s = P.order(d, s, { type: 'PE', expiry: '2026-11-17', strike: 24000, side: 1, lots: 1 });
  a = A.analyze(d, s, { expiry: '2026-11-17' });
  near(a.risk.maxProfit, (24000 - 140) * 65, 1e-4, 'Long Put max profit at S=0');
  near(a.risk.maxLoss, 140 * 65, 1e-4, 'Long Put max loss');
  near(a.risk.breaks[0], 23860, 1e-4, 'Long Put breakeven');

  // Short Put: -1x 24000 PE @ 140 (lot 65)
  s = P.create(d, zeroFeeSettings);
  s = P.order(d, s, { type: 'PE', expiry: '2026-11-17', strike: 24000, side: -1, lots: 1 });
  a = A.analyze(d, s, { expiry: '2026-11-17' });
  near(a.risk.maxProfit, 140 * 65, 1e-4, 'Short Put max profit');
  near(a.risk.maxLoss, (24000 - 140) * 65, 1e-4, 'Short Put max loss at S=0');
  near(a.risk.breaks[0], 23860, 1e-4, 'Short Put breakeven');

  // Long Futures: +1x FUT @ 24040
  s = P.create(d, zeroFeeSettings);
  s = P.order(d, s, { type: 'FUT', expiry: '2026-11-17', strike: 0, side: 1, lots: 1 });
  a = A.analyze(d, s, { basis: 'future', expiry: '2026-11-17' });
  eq(a.risk.maxProfit, Infinity);
  near(a.risk.breaks[0], 24040, 1e-4, 'Long Futures breakeven');
}

// 3. Multi-Leg Strategy Payoff, Breakeven, Net Premium & Risk/Reward Verification
{
  const d = buildChainDataset();

  // Bull Call Spread: +24000 CE @ 150, -24200 CE @ 60 -> Net Debit 90*65=5850, Max Profit 110*65=7150, BE 24090
  let s = P.create(d, zeroFeeSettings);
  s = P.order(d, s, { type: 'CE', expiry: '2026-11-17', strike: 24000, side: 1, lots: 1 });
  s = P.order(d, s, { type: 'CE', expiry: '2026-11-17', strike: 24200, side: -1, lots: 1 });
  let a = A.analyze(d, s, { expiry: '2026-11-17' });
  near(a.risk.maxProfit, 7150);
  near(a.risk.maxLoss, 5850);
  near(a.risk.breaks[0], 24090);
  near(a.netPremium, -5850);
  near(a.riskRewardRatio, 7150 / 5850);

  // Bear Put Spread: +24200 PE @ 255, -24000 PE @ 140 -> Net Debit 115*65=7475, Max Profit 85*65=5525, BE 24085
  s = P.create(d, zeroFeeSettings);
  s = P.order(d, s, { type: 'PE', expiry: '2026-11-17', strike: 24200, side: 1, lots: 1 });
  s = P.order(d, s, { type: 'PE', expiry: '2026-11-17', strike: 24000, side: -1, lots: 1 });
  a = A.analyze(d, s, { expiry: '2026-11-17' });
  near(a.risk.maxProfit, 5525);
  near(a.risk.maxLoss, 7475);
  near(a.risk.breaks[0], 24085);

  // Bull Put Spread: -24000 PE @ 140, +23800 PE @ 70 -> Net Credit 70*65=4550, Max Loss 130*65=8450, BE 23930
  s = P.create(d, zeroFeeSettings);
  s = P.order(d, s, { type: 'PE', expiry: '2026-11-17', strike: 24000, side: -1, lots: 1 });
  s = P.order(d, s, { type: 'PE', expiry: '2026-11-17', strike: 23800, side: 1, lots: 1 });
  a = A.analyze(d, s, { expiry: '2026-11-17' });
  near(a.risk.maxProfit, 4550);
  near(a.risk.maxLoss, 8450);
  near(a.risk.breaks[0], 23930);
  eq(a.netPremiumKind, 'credit');

  // Bear Call Spread: -24000 CE @ 150, +24200 CE @ 60 -> Net Credit 90*65=5850, Max Loss 110*65=7150, BE 24090
  s = P.create(d, zeroFeeSettings);
  s = P.order(d, s, { type: 'CE', expiry: '2026-11-17', strike: 24000, side: -1, lots: 1 });
  s = P.order(d, s, { type: 'CE', expiry: '2026-11-17', strike: 24200, side: 1, lots: 1 });
  a = A.analyze(d, s, { expiry: '2026-11-17' });
  near(a.risk.maxProfit, 5850);
  near(a.risk.maxLoss, 7150);
  near(a.risk.breaks[0], 24090);

  // Short Straddle: -24000 CE @ 150, -24000 PE @ 140 -> Credit 290*65=18850, BE 23710 & 24290
  s = P.create(d, zeroFeeSettings);
  s = P.order(d, s, { type: 'CE', expiry: '2026-11-17', strike: 24000, side: -1, lots: 1 });
  s = P.order(d, s, { type: 'PE', expiry: '2026-11-17', strike: 24000, side: -1, lots: 1 });
  a = A.analyze(d, s, { expiry: '2026-11-17' });
  near(a.risk.maxProfit, 18850);
  eq(a.risk.maxLoss, Infinity);
  near(a.risk.breaks[0], 23710);
  near(a.risk.breaks[1], 24290);

  // Long Strangle: +23800 PE @ 70, +24200 CE @ 60 -> Debit 130*65=8450, BE 23670 & 24330
  s = P.create(d, zeroFeeSettings);
  s = P.order(d, s, { type: 'PE', expiry: '2026-11-17', strike: 23800, side: 1, lots: 1 });
  s = P.order(d, s, { type: 'CE', expiry: '2026-11-17', strike: 24200, side: 1, lots: 1 });
  a = A.analyze(d, s, { expiry: '2026-11-17' });
  eq(a.risk.maxProfit, Infinity);
  near(a.risk.maxLoss, 8450);
  near(a.risk.breaks[0], 23670);
  near(a.risk.breaks[1], 24330);

  // Iron Condor: +23600 PE @ 25, -23800 PE @ 70, -24200 CE @ 60, +24400 CE @ 20 -> Net Credit 85*65=5525, Max Loss 115*65=7475, BE 23715 & 24285
  s = P.create(d, zeroFeeSettings);
  s = P.order(d, s, { type: 'PE', expiry: '2026-11-17', strike: 23600, side: 1, lots: 1 });
  s = P.order(d, s, { type: 'PE', expiry: '2026-11-17', strike: 23800, side: -1, lots: 1 });
  s = P.order(d, s, { type: 'CE', expiry: '2026-11-17', strike: 24200, side: -1, lots: 1 });
  s = P.order(d, s, { type: 'CE', expiry: '2026-11-17', strike: 24400, side: 1, lots: 1 });
  a = A.analyze(d, s, { expiry: '2026-11-17' });
  near(a.risk.maxProfit, 5525);
  near(a.risk.maxLoss, 7475);
  near(a.risk.breaks[0], 23715);
  near(a.risk.breaks[1], 24285);
  eq(a.legContributions.length, 4);

  // Iron Butterfly: +23800 PE @ 70, -24000 PE @ 140, -24000 CE @ 150, +24200 CE @ 60 -> Credit 160*65=10400, Max Loss 40*65=2600, BE 23840 & 24160
  s = P.create(d, zeroFeeSettings);
  s = P.order(d, s, { type: 'PE', expiry: '2026-11-17', strike: 23800, side: 1, lots: 1 });
  s = P.order(d, s, { type: 'PE', expiry: '2026-11-17', strike: 24000, side: -1, lots: 1 });
  s = P.order(d, s, { type: 'CE', expiry: '2026-11-17', strike: 24000, side: -1, lots: 1 });
  s = P.order(d, s, { type: 'CE', expiry: '2026-11-17', strike: 24200, side: 1, lots: 1 });
  a = A.analyze(d, s, { expiry: '2026-11-17' });
  near(a.risk.maxProfit, 10400);
  near(a.risk.maxLoss, 2600);
  near(a.risk.breaks[0], 23840);
  near(a.risk.breaks[1], 24160);

  // Long Call Butterfly: +1x 23800 CE @ 240, -2x 24000 CE @ 150, +1x 24200 CE @ 60 -> Net Debit 0? Wait: 240 - 300 + 60 = 0! Let's use customEntry 245 for 23800 CE -> Debit 5*65=325, Max Profit 195*65=12675, BE 23805 & 24195
  s = P.create(d, zeroFeeSettings);
  s = P.order(d, s, { type: 'CE', expiry: '2026-11-17', strike: 23800, side: 1, lots: 1, entryPrice: 245 });
  s = P.order(d, s, { type: 'CE', expiry: '2026-11-17', strike: 24000, side: -1, lots: 2 });
  s = P.order(d, s, { type: 'CE', expiry: '2026-11-17', strike: 24200, side: 1, lots: 1 });
  a = A.analyze(d, s, { expiry: '2026-11-17' });
  near(a.risk.maxProfit, 195 * 65);
  near(a.risk.maxLoss, 5 * 65);
  near(a.risk.breaks[0], 23805);
  near(a.risk.breaks[1], 24195);

  // Calendar Spread (Mixed Expiry): -1x 2026-11-17 24000 CE @ 150, +1x 2026-11-24 24000 CE @ 230
  s = P.create(d, zeroFeeSettings);
  s = P.order(d, s, { type: 'CE', expiry: '2026-11-17', strike: 24000, side: -1, lots: 1 });
  s = P.order(d, s, { type: 'CE', expiry: '2026-11-24', strike: 24000, side: 1, lots: 1 });
  a = A.analyze(d, s, { expiry: '2026-11-17' });
  eq(a.mixed, true);
  eq(a.risk.available, false);
  ok(a.mixedExpiryEstimate && Number.isFinite(a.mixedExpiryEstimate.maxProfit) && a.mixedExpiryEstimate.maxProfit > 0, 'Calendar spread has model estimate at near expiry');
}

// 4. Lot-Size Multiplication Across NIFTY (65), BANKNIFTY (30), SENSEX (20), RELIANCE (500)
for (const [sym, lot] of [['NIFTY', 65], ['BANKNIFTY', 30], ['SENSEX', 20], ['RELIANCE', 500]]) {
  const d = buildChainDataset({ symbol: sym, lotSize: lot });
  let s = P.create(d, zeroFeeSettings);
  s = P.order(d, s, { type: 'CE', expiry: '2026-11-17', strike: 24000, side: 1, lots: 3 });
  s = P.advance(d, s, '2026-11-10T09:20'); // close moves from 150 -> 177.5 (+27.5 per unit)
  const v = P.valuation(d, s);
  near(v.positions[0].remainingUnits, 3 * lot, 1e-6, `${sym} units`);
  near(v.unrealized, 27.5 * 3 * lot, 1e-4, `${sym} unrealized P&L scaling`);
}

// 5. Paper Execution Lifecycle: Custom Entry, Toggle, Modify, Remove, Custom Exit & Restore
{
  const d = buildChainDataset();
  let s = P.create(d, zeroFeeSettings);

  // Add 2 legs, first with custom entry override
  s = P.order(d, s, { type: 'CE', expiry: '2026-11-17', strike: 24000, side: 1, lots: 2, entryPrice: 142.5 });
  s = P.order(d, s, { type: 'PE', expiry: '2026-11-17', strike: 24000, side: 1, lots: 1 });
  let v = P.valuation(d, s);
  eq(v.positions.length, 2);
  eq(v.positions[0].customEntry, true);
  near(v.positions[0].entry, 142.5);
  near(v.positions[0].pnl, (150 - 142.5) * 2 * 65);

  // Toggle exclude leg 2 (PE) -> only CE contributes to payoff & valuation
  const peId = v.positions[1].id;
  s = P.toggle(d, s, peId, false);
  let a = A.analyze(d, s, { expiry: '2026-11-17' });
  eq(a.rows.length, 1, 'Excluded leg omitted from payoff & Greeks analysis');
  near(a.risk.breaks[0], 24142.5, 1e-4, 'Breakeven reflects remaining active leg with custom entry');

  // Toggle re-include leg 2 (PE)
  s = P.toggle(d, s, peId, true);
  a = A.analyze(d, s, { expiry: '2026-11-17' });
  eq(a.rows.length, 2, 'Re-included leg restored to analysis');

  // Modify leg 1: flip to SELL, change strike to 24200, lots to 1, entryPrice to 64
  const ceId = v.positions[0].id;
  s = P.modify(d, s, ceId, { side: -1, strike: 24200, lots: 1, entryPrice: 64 });
  v = P.valuation(d, s);
  eq(v.positions[0].side, -1);
  eq(v.positions[0].strike, 24200);
  eq(v.positions[0].remainingLots, 1);
  near(v.positions[0].entry, 64);
  near(v.positions[0].pnl, (64 - 60) * 65); // Short @ 64, mark @ 60 -> +4 * 65 = +260

  // Remove leg 2 completely
  s = P.remove(d, s, peId);
  v = P.valuation(d, s);
  eq(v.positions.length, 1);

  // Exit leg 1 with custom exit price 52 -> Realized +12 * 65 = +780
  s = P.exit(d, s, ceId, 1, 52);
  v = P.valuation(d, s);
  eq(v.positions[0].closed, true);
  near(v.realized, (64 - 52) * 65);

  // Restore round-trip determinism
  const restored = P.restore(d, JSON.parse(JSON.stringify(s)));
  near(P.valuation(d, restored).realized, v.realized);
}

// 6. Standard Deviation Cone, SVG Chart Rendering, Zero-Volume Rejection & Put-Call Parity
{
  const d = buildChainDataset();
  let s = P.create(d, zeroFeeSettings);
  s = P.order(d, s, { type: 'CE', expiry: '2026-11-17', strike: 24000, side: 1, lots: 1 });
  const a = A.analyze(d, s, { expiry: '2026-11-17', atmIv: 15 });
  ok(a.stdDev && a.stdDev.move > 0 && a.stdDev.plus2 > a.stdDev.plus1, '1σ and 2σ bands computed');

  // Verify SVG chart rendering in minimal mock DOM node
  const nodes = new Map();
  const rect = { left: 0, top: 0, right: 900, bottom: 420, width: 900, height: 420 };
  const mockHost = {
    innerHTML: '',
    replaceChildren() { this.innerHTML = ''; },
    querySelector(sel) {
      if (!nodes.has(sel)) {
        nodes.set(sel, {
          style: {}, offsetWidth: 200, offsetHeight: 130, textContent: '', innerHTML: '', hidden: false, attributes: {},
          setAttribute(k, v) { this.attributes[k] = v; },
          removeAttribute(k) { delete this.attributes[k]; },
          addEventListener() {}, removeEventListener() {},
          getBoundingClientRect() { return rect; },
        });
      }
      return nodes.get(sel);
    },
  };
  Chart.render(mockHost, a, { cursor: s.cursor, symbol: 'NIFTY', startDate: s.start });
  ok(mockHost.innerHTML.includes('<svg') && mockHost.innerHTML.includes('+1σ') && mockHost.innerHTML.includes('-1σ') && mockHost.innerHTML.includes('pp-be-dot'), 'SVG payoff chart renders ±1σ markers & breakeven dot');

  // Advance to t1 where 23600 CE has volume === 0 -> market order must reject cleanly
  const sAtT1 = P.advance(d, s, '2026-11-10T09:20');
  const afterZeroVol = P.order(d, sAtT1, { type: 'CE', expiry: '2026-11-17', strike: 23600, side: 1, lots: 1 });
  eq(P.valuation(d, afterZeroVol).orders.at(-1).status, 'rejected', 'Zero-volume contract rejects market order');

  // Put-Call Parity & Greeks check
  const days = 7, r = 0.065, q = 0, iv = 0.16, S = 24000, K = 24000;
  const gCall = E.greeks('CE', S, K, days, iv, r, q);
  const gPut = E.greeks('PE', S, K, days, iv, r, q);
  near(gCall.delta - gPut.delta, 1.0, 1e-6, 'Zero-dividend European Put-Call delta parity');
  ok(gCall.gamma > 0 && gCall.vega > 0 && gCall.theta < 0, 'ATM Call has positive Gamma/Vega and negative Theta');

  // Predefined strategy template deployment check (Iron Condor)
  const icIdx = E.templates.findIndex(t => /iron condor/i.test(t.name));
  ok(icIdx >= 0, 'Iron Condor template exists');
  const sWithIc = Templates.apply(d, P.create(d, zeroFeeSettings), { index: icIdx, lots: 1, expiry: '2026-11-17' });
  eq(P.valuation(d, sWithIc).positions.length, 4, 'Iron Condor deploys 4 legs cleanly');
}

console.log(`${checks} comprehensive Opstra simulator mathematical & execution checks passed`);

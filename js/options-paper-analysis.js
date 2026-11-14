(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./strategy-engine.js'), require('./strategy-research-engine.js'), require('./options-simulator-engine.js'), require('./options-paper-execution.js'));
  else root.IWSMPaperAnalysis = factory(root.IWSMStrategy, root.IWSMResearch, root.IWSMSimulator, root.IWSMPaperExecution);
})(typeof globalThis !== 'undefined' ? globalThis : this, function (E, Q, M, P) {
  'use strict';
  const DAY = 86400000;
  const finite = Number.isFinite;

  function curveBreakevens(curve) {
    const out = [];
    for (let i = 1; i < curve.length; i++) {
      const a = curve[i - 1], b = curve[i];
      if (!finite(a.expiry) || !finite(b.expiry)) continue;
      if (a.expiry === 0) out.push(a.spot);
      else if (a.expiry * b.expiry < 0) {
        out.push(a.spot + (b.spot - a.spot) * (-a.expiry) / (b.expiry - a.expiry));
      }
    }
    return out;
  }

  function analyze(d, s, options = {}) {
    const basis = options.basis || 'spot';
    if (!['spot', 'future'].includes(basis)) throw Error('Choose a Spot or Futures analysis reference.');
    const v = P.valuation(d, s), positions = v.positions.filter(p => !p.closed && p.enabled !== false);
    const expiry = positions.map(p => p.expiry).sort()[0];
    const referenceExpiry = options.expiry || expiry || null;
    const cashSpot = d.spots.get(s.symbol + '|' + s.cursor);
    const future = basis === 'future' && referenceExpiry ? d.records.get([s.symbol, s.cursor, referenceExpiry, 'FUT', 0].join('|')) : null;
    const spot = basis === 'future' ? future?.close : cashSpot;
    const unavailable = reason => ({empty:true, reason, basis, referenceExpiry, cashSpot:finite(cashSpot) ? cashSpot : null});
    if (!positions.length) return unavailable('Add or enable an open position to inspect its payoff and Greeks.');
    if (expiry < s.cursor.slice(0, 10)) return unavailable('An open contract has expired. Its later quote or settlement is unavailable. Return to an observed expiry close to exit it; no settlement price is invented.');
    if (!finite(spot) || spot <= 0) return unavailable(basis === 'future' ? 'The exact Futures quote for ' + referenceExpiry + ' is unavailable at this replay close. Choose Spot or another available futures expiry.' : 'A matching underlying Spot quote is unavailable at this replay close.');
    const rate = (d.metadata?.rate ?? s.settings.rate) / 100;
    // A futures/forward reference already includes carry. q=r discounts its option value without adding carry again.
    const q = basis === 'future' ? rate : (d.metadata?.dividend ?? s.settings.dividend) / 100;
    const days = p => Math.max(0, (Date.parse(p.expiry + 'T15:30:00+05:30') - M.instant(s.cursor)) / DAY);
    const models = positions.map(p => ({p, iv:p.type === 'FUT' ? 0 : d.metadata?.modelled ? d.metadata.iv / 100 : Q.impliedVolatility(p.type, spot, p.strike, days(p), p.mark, rate, q)}));
    const valid = model => model.p.type === 'FUT' || finite(model.iv) && model.iv >= 0;
    const rows = models.map(model => ({id:model.p.id, type:model.p.type, strike:model.p.strike, expiry:model.p.expiry, iv:valid(model) ? model.iv * 100 : null, greeks:valid(model) ? E.greeks(model.p.type, spot, model.p.strike, days(model.p), model.iv, rate, q) : null, units:model.p.remainingUnits, side:model.p.side}));
    const total = {delta:0, gamma:0, theta:0, vega:0, rho:0};
    let missing = false;
    for (const row of rows) {
      if (!row.greeks) { missing = true; continue; }
      for (const key in total) total[key] += row.greeks[key] * row.units * row.side;
    }
    const payoffDate = Object.prototype.hasOwnProperty.call(options, 'payoffDate') ? options.payoffDate : expiry;
    if (typeof payoffDate !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(payoffDate) || !Number.isFinite(Date.parse(payoffDate + 'T00:00:00Z')) || new Date(payoffDate + 'T00:00:00Z').toISOString().slice(0, 10) !== payoffDate || payoffDate < s.cursor.slice(0, 10) || payoffDate > expiry) throw Error('Choose a valid pay-off date from the replay date through the earliest open expiry.');
    const isExpiryPayoff = payoffDate === expiry;
    const at = Date.parse(payoffDate + 'T15:30:00+05:30'), curve = [];
    for (let i = 0; i <= 100; i++) {
      const price = spot * (.85 + i * .003);
      let now = v.realized - v.costs, end = now;
      for (const model of models) {
        const p = model.p, units = p.side * p.remainingUnits;
        if (valid(model) && now !== null) now += units * (E.price(p.type, price, p.strike, days(p), model.iv, rate, q) - p.entry);
        else now = null;
        const remainingDays = Math.max(0, (Date.parse(p.expiry + 'T15:30:00+05:30') - at) / DAY);
        const premium = p.type === 'FUT' ? price : remainingDays === 0 ? Math.max(0, p.type === 'CE' ? price - p.strike : p.strike - price) : valid(model) ? E.price(p.type, price, p.strike, remainingDays, model.iv, rate, q) : null;
        if (premium === null) end = null;
        else if (end !== null) end += units * (premium - p.entry);
      }
      curve.push({spot:price, current:now, expiry:end});
    }

    // Net Premium & Cost/Credit Summary across open option legs
    let debitPaid = 0, creditReceived = 0;
    const legContributions = models.map(model => {
      const p = model.p, units = p.remainingUnits;
      if (p.type !== 'FUT') {
        if (p.side === 1) debitPaid += units * p.entry;
        else creditReceived += units * p.entry;
      }
      const intrinsicAtSpot = p.type === 'FUT' ? spot : Math.max(0, p.type === 'CE' ? spot - p.strike : p.strike - spot);
      return {
        id: p.id,
        type: p.type,
        strike: p.strike,
        expiry: p.expiry,
        side: p.side,
        lots: p.remainingLots,
        units,
        entry: p.entry,
        mark: p.mark,
        pnl: p.unrealized,
        expiryPayoffAtSpot: p.side * units * (intrinsicAtSpot - p.entry),
      };
    });
    const netPremium = creditReceived - debitPaid;
    const netPremiumKind = netPremium > 1e-8 ? 'credit' : netPremium < -1e-8 ? 'debit' : 'even';

    // Standard deviation bands (+/- 1 sigma, +/- 2 sigma) to payoffDate
    const horizonDays = Math.max(0, (at - M.instant(s.cursor)) / DAY);
    const validOptModels = models.filter(m => m.p.type !== 'FUT' && valid(m) && m.iv > 0);
    const refIv = validOptModels.length
      ? validOptModels.sort((a, b) => Math.abs(a.p.strike - spot) - Math.abs(b.p.strike - spot))[0].iv
      : (finite(options.atmIv) && options.atmIv > 0 ? options.atmIv / 100 : null);
    const sigmaMove = refIv && horizonDays > 0 ? spot * refIv * Math.sqrt(horizonDays / 365) : null;
    const stdDev = sigmaMove ? {
      ivPct: refIv * 100,
      days: horizonDays,
      move: sigmaMove,
      minus2: Math.max(0, spot - 2 * sigmaMove),
      minus1: Math.max(0, spot - sigmaMove),
      plus1: spot + sigmaMove,
      plus2: spot + 2 * sigmaMove,
    } : null;

    const mixed = positions.some(p => p.expiry !== expiry);
    let risk = {available:false, mixed, maxProfit:null, maxLoss:null, breaks:[], label:'Gross expiry risk unavailable for mixed expiries. Review the model payoff curve instead.'};
    let mixedExpiryEstimate = null;
    if (!mixed) {
      const metrics = E.metrics({spot, lotSize:1, iv:models.find(model => model.p.type !== 'FUT' && valid(model))?.iv * 100 || 18, rate:rate * 100, dividend:q * 100, legs:positions.map(p => ({enabled:true, type:p.type, side:p.side, lots:p.remainingUnits, strike:p.strike, premium:p.entry, days:days(p)}))});
      risk = {available:true, mixed:false, maxProfit:metrics.maxProfit, maxLoss:metrics.maxLoss, breaks:metrics.breaks, label:'Gross expiry risk for remaining open positions only, before costs and excluding realized trades.'};
    } else {
      const expVals = curve.map(c => c.expiry).filter(finite);
      if (expVals.length) {
        mixedExpiryEstimate = {
          maxProfit: Math.max(...expVals),
          maxLoss: Math.max(0, -Math.min(...expVals)),
          breaks: curveBreakevens(curve),
          label: 'Model estimate across ±15% range at earliest expiry (' + expiry + ')',
        };
      }
    }

    const effMaxProfit = risk.available ? risk.maxProfit : mixedExpiryEstimate?.maxProfit ?? null;
    const effMaxLoss = risk.available ? risk.maxLoss : mixedExpiryEstimate?.maxLoss ?? null;
    const riskRewardRatio = finite(effMaxProfit) && finite(effMaxLoss) && effMaxProfit > 0 && effMaxLoss > 0
      ? effMaxProfit / effMaxLoss
      : null;

    const referenceLabel = basis === 'future' ? 'Futures reference ' + referenceExpiry + '; forward convention q=r.' : 'Spot reference' + (referenceExpiry ? '; selected reference expiry ' + referenceExpiry + '.' : '.');
    return {
      empty:false,
      spot,
      cashSpot:finite(cashSpot) ? cashSpot : null,
      basis,
      referenceExpiry,
      expiry,
      payoffDate,
      isExpiryPayoff,
      curve,
      rows,
      total:missing ? null : total,
      risk,
      mixed,
      mixedExpiryEstimate,
      netPremium,
      netPremiumKind,
      debitPaid,
      creditReceived,
      riskRewardRatio,
      stdDev,
      legContributions,
      maxProfit:risk.maxProfit,
      maxLoss:risk.maxLoss,
      breaks:risk.breaks,
      label:referenceLabel + ' Model sensitivity, not a prediction. ' + (isExpiryPayoff ? 'Expiry curve uses the earliest open expiry; later expiries are valued with the same IV.' : 'Pay-off model ' + payoffDate + ' uses unchanged IV; this is a scenario, not future recorded P&L.') + ' Costs include observed fills only.'
    };
  }
  return {analyze};
});

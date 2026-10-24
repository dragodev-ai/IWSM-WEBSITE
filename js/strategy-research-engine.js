(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./strategy-engine.js'), require('./strategy-history-engine.js'));
  else root.IWSMResearch = factory(root.IWSMStrategy, root.IWSMHistory);
})(typeof globalThis !== 'undefined' ? globalThis : this, function (Strategy, History) {
  'use strict';
  const DAY = 86400000;
  const finite = value => typeof value === 'number' && Number.isFinite(value);
  const metric = value => finite(value) && value >= 0;
  const canonical = value => History.canonicalSymbol(value);
  const validDate = value => typeof value === 'string' && History.parseDate(value) === value;
  const elapsedDays = (from, to) => (Date.parse(to + 'T00:00:00Z') - Date.parse(from + 'T00:00:00Z')) / DAY;
  const key = row => [row.date, canonical(row.symbol), row.expiry, row.type, row.strike].join('|');

  function impliedVolatility(type, spot, strike, days, premium, rate = .06, dividend = 0) {
    if (!['CE', 'PE'].includes(type) || ![spot, strike, days, premium, rate, dividend].every(finite) || spot <= 0 || strike <= 0 || days <= 0 || premium <= 0) return null;
    const time = days / 365, stockPV = spot * Math.exp(-dividend * time), strikePV = strike * Math.exp(-rate * time);
    if (![stockPV, strikePV].every(finite)) return null;
    const lower = Math.max(0, type === 'CE' ? stockPV - strikePV : strikePV - stockPV), upper = type === 'CE' ? stockPV : strikePV;
    const priceTolerance = Math.max(1e-9, Math.max(spot, strike) * 1e-10);
    // Boundary prices cannot reliably identify a strictly positive finite IV.
    if (premium <= lower + priceTolerance || premium >= upper - priceTolerance) return null;
    let lo = 0, hi = 1;
    while (hi < 16 && Strategy.price(type, spot, strike, days, hi, rate, dividend) < premium) hi *= 2;
    if (Strategy.price(type, spot, strike, days, hi, rate, dividend) < premium - priceTolerance) return null;
    for (let iteration = 0; iteration < 100; iteration++) {
      const mid = (lo + hi) / 2, value = Strategy.price(type, spot, strike, days, mid, rate, dividend);
      if (!finite(value)) return null;
      if (value < premium) lo = mid; else hi = mid;
      if (hi - lo < 1e-10) break;
    }
    const iv = (lo + hi) / 2, repriced = Strategy.price(type, spot, strike, days, iv, rate, dividend);
    return Math.abs(repriced - premium) <= Math.max(priceTolerance * 4, 1e-7) ? iv : null;
  }

  function contracts(dataset) {
    const source = Array.isArray(dataset?.contracts) ? dataset.contracts : [], seen = new Set();
    return source.filter(row => {
      if (!row || !validDate(row.date) || !validDate(row.expiry) || !['CE', 'PE', 'FUT'].includes(row.type) || !finite(row.strike) || row.strike < 0 || !metric(row.close)) return false;
      if (seen.has(key(row))) throw new Error('Duplicate historical contract observations must be resolved before analysis.');
      seen.add(key(row)); return true;
    });
  }

  function reference(dataset, symbol, date) {
    const values = (dataset?.underlying || []).filter(row => canonical(row.symbol) === symbol && row.date === date && finite(row.close) && row.close > 0).map(row => row.close);
    return values.length && values.every(value => value === values[0]) ? values[0] : null;
  }

  function summarize(dataset, options = {}) {
    const symbol = canonical(options.symbol), date = options.date, expiry = options.expiry;
    if (!symbol || !validDate(date) || !validDate(expiry)) throw new Error('Select a valid symbol, observation date and expiry.');
    const rate = options.rate ?? 6, dividend = options.dividend ?? 0;
    if (![rate, dividend].every(finite)) throw new Error('Rate and dividend assumptions must be finite numbers.');
    const all = contracts(dataset).filter(row => canonical(row.symbol) === symbol && row.expiry === expiry && row.type !== 'FUT');
    const current = all.filter(row => row.date === date), previousDate = [...new Set(all.filter(row => row.date < date).map(row => row.date))].sort().at(-1) || null;
    const previous = new Map(all.filter(row => row.date === previousDate).map(row => [[row.type, row.strike].join('|'), row]));
    const spot = reference(dataset, symbol, date), days = elapsedDays(date, expiry), warnings = [];
    const map = new Map();
    for (const record of current) {
      if (!map.has(record.strike)) map.set(record.strike, {strike: record.strike, call: null, put: null, callIV: null, putIV: null, callOIdelta: null, putOIdelta: null});
      const row = map.get(record.strike), side = record.type === 'CE' ? 'call' : 'put', prior = previous.get([record.type, record.strike].join('|'));
      row[side] = {...record};
      const iv = spot == null ? null : impliedVolatility(record.type, spot, record.strike, days, record.close, rate / 100, dividend / 100);
      row[side + 'IV'] = iv == null ? null : iv * 100;
      row[side + 'OIdelta'] = metric(record.oi) && metric(prior?.oi) ? record.oi - prior.oi : null;
    }
    const rows = [...map.values()].sort((a, b) => a.strike - b.strike);
    const oiCoverage = {call: {available: 0, total: rows.length}, put: {available: 0, total: rows.length}};
    const volumeCoverage = {call: {available: 0, total: rows.length}, put: {available: 0, total: rows.length}};
    const totals = {callOI: null, putOI: null, callVolume: null, putVolume: null, oiCoverage, volumeCoverage, pcr: null};
    for (const side of ['call', 'put']) {
      for (const [field, output, coverage] of [['oi', side + 'OI', oiCoverage], ['volume', side + 'Volume', volumeCoverage]]) {
        const values = rows.map(row => row[side]?.[field]).filter(metric);
        coverage[side].available = values.length;
        totals[output] = values.length ? values.reduce((a, b) => a + b, 0) : null;
      }
    }
    const completeOI = rows.length > 0 && ['call', 'put'].every(side => oiCoverage[side].available === rows.length);
    if (completeOI && totals.callOI > 0) totals.pcr = totals.putOI / totals.callOI;
    let maxPain = null;
    if (completeOI) {
      let callOI = 0, callWeightedStrike = 0, putOI = totals.putOI;
      let putWeightedStrike = rows.reduce((sum, row) => sum + row.put.oi * row.strike, 0);
      for (const candidate of rows) {
        putOI -= candidate.put.oi;
        putWeightedStrike -= candidate.put.oi * candidate.strike;
        const payout = Math.max(0, candidate.strike * callOI - callWeightedStrike + putWeightedStrike - candidate.strike * putOI);
        if (finite(payout) && (maxPain == null || payout < maxPain.payout)) maxPain = {strike: candidate.strike, payout};
        callOI += candidate.call.oi;
        callWeightedStrike += candidate.call.oi * candidate.strike;
      }
    }
    let atm = null;
    if (spot != null && rows.length) {
      const row = rows.reduce((best, candidate) => Math.abs(candidate.strike - spot) < Math.abs(best.strike - spot) ? candidate : best);
      atm = {strike: row.strike, straddle: row.call && row.put ? row.call.close + row.put.close : null, iv: row.callIV != null && row.putIV != null ? (row.callIV + row.putIV) / 2 : null};
    }
    if (!rows.length) warnings.push('No option observations match this symbol, date and expiry.');
    if (spot == null) warnings.push('No unambiguous underlying reference exists on this date; IV and ATM are unavailable.');
    if (days <= 0) warnings.push('IV requires a positive term before expiry; expiration-day or expired observations are not assigned an inferred IV.');
    if (rows.length && !completeOI) warnings.push('OI coverage is incomplete. Totals are partial; PCR and max pain are unavailable.');
    if (rows.some(row => ['call', 'put'].some(side => row[side]?.volume === 0))) warnings.push('Some recorded closes have zero traded volume; they do not establish executable prices.');
    if (spot != null && days > 0 && rows.some(row => ['call', 'put'].some(side => row[side] && row[side + 'IV'] == null))) warnings.push('Some closes do not identify a reliable IV under the selected European pricing assumptions.');
    warnings.push('OI, volume, PCR and max pain describe only loaded strikes. Source field units are preserved; max-pain payout uses those OI units.');
    warnings.push('IV is inferred from recorded closes with the selected rate, dividend and calendar-day assumptions. It is not a recorded exchange or Opstra IV. ATM IV is the mean of identified call and put IV.');
    return {symbol, date, expiry, spot, previousDate, rows, totals, maxPain, atm, warnings};
  }

  function series(dataset, options = {}) {
    const symbol = canonical(options.symbol), expiry = options.expiry, strike = options.strike, type = options.type;
    if (!symbol || !validDate(expiry) || !finite(strike) || !['CE', 'PE', 'FUT'].includes(type)) throw new Error('Select an exact historical contract.');
    return contracts(dataset).filter(row => canonical(row.symbol) === symbol && row.expiry === expiry && row.strike === strike && row.type === type).sort((a, b) => a.date.localeCompare(b.date)).map(row => ({...row, spot: reference(dataset, symbol, row.date)}));
  }

  function timeline(dataset, options = {}) {
    const symbol = canonical(options.symbol), expiry = options.expiry, strike = options.strike ?? null;
    if (!symbol || !validDate(expiry) || (strike != null && (!finite(strike) || strike <= 0))) throw new Error('Select a historical symbol, expiry and optional positive fixed strike.');
    // Validate and index once. Each summary receives only one current and one
    // strictly prior snapshot, rather than rescanning the full imported history.
    const dates = new Map(), underlying = new Map();
    for (const row of contracts(dataset)) {
      if (canonical(row.symbol) !== symbol || row.expiry !== expiry || row.type === 'FUT') continue;
      if (!dates.has(row.date)) dates.set(row.date, []);
      dates.get(row.date).push(row);
    }
    for (const row of dataset?.underlying || []) {
      if (canonical(row.symbol) !== symbol || !dates.has(row.date)) continue;
      if (!underlying.has(row.date)) underlying.set(row.date, []);
      underlying.get(row.date).push(row);
    }
    let previous = [];
    return [...dates.keys()].sort().map(date => {
      const current = dates.get(date), slice = {contracts:previous.concat(current),underlying:underlying.get(date)||[]};
      const summary = summarize(slice,{symbol,date,expiry,rate:options.rate??6,dividend:options.dividend??0});
      const fixed = strike == null ? null : summary.rows.find(row=>row.strike===strike);
      const row = {date,spot:summary.spot,callOI:summary.totals.callOI,putOI:summary.totals.putOI,pcr:summary.totals.pcr,maxPain:summary.maxPain?.strike??null,atmStrike:summary.atm?.strike??null,atmStraddle:summary.atm?.straddle??null,fixedStraddle:fixed?.call&&fixed?.put?fixed.call.close+fixed.put.close:null};
      previous = current;
      return row;
    });
  }

  return {impliedVolatility, summarize, series, timeline};
});

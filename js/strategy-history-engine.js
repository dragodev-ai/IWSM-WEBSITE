(function (root, factory) {
  'use strict';
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./strategy-engine.js'));
  else root.IWSMHistory = factory(root.IWSMStrategy);
})(typeof globalThis !== 'undefined' ? globalThis : this, function (Strategy) {
  'use strict';
  const MAX_ROWS = 200000, DAY = 86400000;
  const finite = value => typeof value === 'number' && Number.isFinite(value);
  const own = (object, key) => Object.prototype.hasOwnProperty.call(object, key);
  const headerKey = text => String(text).trim().toLowerCase().replace(/[^a-z0-9]/g, '');
  const months = ['jan','feb','mar','apr','may','jun','jul','aug','sep','oct','nov','dec'];

  function parseDate(value) {
    if (typeof value !== 'string') return null;
    const text = value.trim(); let year, month, day, match;
    if ((match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text))) [,year,month,day] = match.map(Number);
    else if ((match = /^(\d{1,2})-([A-Za-z]{3})-(\d{4})$/.exec(text))) {
      day = Number(match[1]); month = months.indexOf(match[2].toLowerCase()) + 1; year = Number(match[3]);
    } else if ((match = /^(\d{1,2})-(\d{1,2})-(\d{4})$/.exec(text))) {
      day = Number(match[1]); month = Number(match[2]); year = Number(match[3]);
    } else return null;
    if (year < 1900 || year > 2199 || month < 1 || month > 12 || day < 1 || day > 31) return null;
    const time = new Date(Date.UTC(year, month - 1, day));
    if (time.getUTCFullYear() !== year || time.getUTCMonth() !== month - 1 || time.getUTCDate() !== day) return null;
    return time.toISOString().slice(0, 10);
  }
  const dateTime = date => Date.parse(date + 'T00:00:00Z');
  const addDays = (date, days) => new Date(dateTime(date) + days * DAY).toISOString().slice(0, 10);
  function canonicalSymbol(value) {
    const text = String(value == null ? '' : value).trim().toUpperCase();
    const compact = text.replace(/[\s_^.\-]/g, '');
    if (['NIFTY','NIFTY50','NSEI'].includes(compact)) return 'NIFTY';
    if (['BANKNIFTY','NIFTYBANK','NSEBANK'].includes(compact)) return 'BANKNIFTY';
    if (['FINNIFTY','NIFTYFINSERVICE','NIFTYFINANCIALSERVICES'].includes(compact)) return 'FINNIFTY';
    if (['MIDCPNIFTY','NIFTYMIDCAPSELECT'].includes(compact)) return 'MIDCPNIFTY';
    if (['SENSEX','BSESN','S&PBSESENSEX'].includes(compact)) return 'SENSEX';
    return text;
  }

  function parseCSV(text) {
    if (typeof text !== 'string') throw new Error('CSV must be text.');
    if (text.length > 80 * 1024 * 1024) throw new Error('CSV exceeds the 80 MB text limit.');
    text = text.replace(/^\uFEFF/, '');
    const table = []; let row = [], field = '', quoted = false, closed = false;
    function pushField() { row.push(field); field = ''; closed = false; }
    function pushRow() {
      pushField();
      if (row.some(cell => cell.trim() !== '')) table.push(row);
      row = [];
      if (table.length > MAX_ROWS + 1) throw new Error('CSV exceeds the 200,000 row limit.');
    }
    for (let i = 0; i < text.length; i++) {
      const c = text[i];
      if (quoted) {
        if (c === '"') { if (text[i + 1] === '"') { field += '"'; i++; } else { quoted = false; closed = true; } }
        else field += c;
      } else if (c === ',') pushField();
      else if (c === '\n' || c === '\r') { pushRow(); if (c === '\r' && text[i + 1] === '\n') i++; }
      else if (c === '"') { if (field.length || closed) throw new Error('Invalid CSV quote.'); quoted = true; }
      else if (closed) { if (c !== ' ' && c !== '\t') throw new Error('Unexpected text after CSV quote.'); }
      else field += c;
    }
    if (quoted) throw new Error('Unclosed CSV quote.');
    if (field.length || row.length || closed) pushRow();
    if (!table.length) return [];
    const headers = table.shift().map(value => value.trim());
    // Legacy NSE bhavcopies append an empty header and empty cell after the last comma.
    while (headers.length && headers[headers.length - 1] === '' && table.every(cells => cells.length === headers.length && cells[cells.length - 1].trim() === '')) {
      headers.pop(); table.forEach(cells => cells.pop());
    }
    const keys = headers.map(headerKey);
    if (headers.some(value => !value || ['__proto__','constructor','prototype'].includes(value.toLowerCase())) || new Set(keys).size !== keys.length) throw new Error('Invalid or duplicate CSV header.');
    return table.map((cells, index) => {
      if (cells.length !== headers.length) throw new Error('CSV column count differs on row ' + (index + 2) + '.');
      return Object.fromEntries(headers.map((header, column) => [header, cells[column].trim()]));
    });
  }

  function number(value) {
    if (finite(value)) return value;
    if (typeof value !== 'string') return null;
    const text = value.trim();
    if (!/^[+-]?(?:\d+(?:\.\d*)?|\d{1,3}(?:,\d{2,3})+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/.test(text)) return null;
    const parsed = Number(text.replace(/,/g, ''));
    return Number.isFinite(parsed) ? parsed : null;
  }
  const contractKey = row => [row.symbol, row.expiry, row.type, row.type === 'FUT' ? 0 : row.strike].join('|');
  const rowKey = row => row.date + '|' + (row.type ? contractKey(row) : row.symbol);
  function uniqueRows(rows) {
    const index = new Map();
    for (const row of rows) {
      const key = rowKey(row), previous = index.get(key);
      if (previous) {
        const keys = new Set([...Object.keys(previous),...Object.keys(row)]);
        if ([...keys].some(field => previous[field] !== row[field])) throw new Error('Conflicting duplicate record: ' + key + '.');
      }
      if (!previous) index.set(key, row);
    }
    return [...index.values()].sort((a, b) => a.date.localeCompare(b.date) || rowKey(a).localeCompare(rowKey(b)));
  }

  function normalizeRows(rows, options = {}) {
    if (!Array.isArray(rows)) throw new Error('Historical rows must be an array.');
    if (rows.length > MAX_ROWS) throw new Error('Historical import exceeds the 200,000 row limit.');
    const underlying = [], contracts = [], warnings = [], derived = new Map(), derivedConflicts = new Set(); let rejected = 0, zeroVolume = 0;
    function warn(index, reason) { rejected++; if (warnings.length < 200) warnings.push('Row ' + (index + 2) + ': ' + reason); }
    rows.forEach((raw, index) => {
      if (!raw || typeof raw !== 'object' || Array.isArray(raw)) { warn(index, 'Expected a row object.'); return; }
      const row = Object.create(null);
      for (const [name, value] of Object.entries(raw)) row[headerKey(name)] = value;
      const get = (...keys) => { for (const key of keys) if (own(row, key) && String(row[key] == null ? '' : row[key]).trim() !== '') return row[key]; return null; };
      if (!Object.values(row).some(value => value != null && String(value).trim() !== '')) return;
      const date = parseDate(get('date','timestamp','traddt','indexdate','tradingdate'));
      const symbol = canonicalSymbol(get('symbol','tckrsymb','indexname','ticker'));
      const close = number(get('close','clspric','closingindexvalue','closingprice'));
      if (!date) { warn(index, 'Invalid date; use YYYY-MM-DD, DD-Mon-YYYY or DD-MM-YYYY.'); return; }
      if (!symbol || symbol.length > 100) { warn(index, 'Missing or invalid symbol.'); return; }
      const option = String(get('type','optiontyp','optntp','optiontype') || '').trim().toUpperCase();
      const instrument = String(get('instrument','fininstrmtp') || '').trim().toUpperCase();
      const type = ['CE','PE','FUT'].includes(option) ? option : (/^FUT/.test(instrument) || ['IDF','STF'].includes(instrument) ? 'FUT' : null);
      const derivative = type || ['OPTIDX','OPTSTK','IDO','STO'].includes(instrument) || get('expirydt','xprydt','expiry','expirydate');
      if (!finite(close) || close < 0 || (!derivative && close === 0)) { warn(index, 'Missing, negative or invalid closing price.'); return; }
      if (derivative) {
        const expiry = parseDate(get('expiry','expirydt','xprydt','expirydate'));
        const strike = type === 'FUT' ? 0 : number(get('strike','strikepr','strkpric','strikeprice'));
        if (!type || !expiry || date > expiry || !finite(strike) || (type !== 'FUT' && strike <= 0)) { warn(index, 'Invalid contract type, expiry or strike.'); return; }
        const lotValue = get('lotsize','newbrdlotqty','marketlot'); const lotSize = lotValue == null ? null : number(lotValue);
        if (lotSize != null && (!Number.isInteger(lotSize) || lotSize <= 0 || lotSize > 1000000)) { warn(index, 'Invalid contract lot size.'); return; }
        if (lotValue != null && lotSize == null) { warn(index, 'Invalid contract lot size.'); return; }
        const out = {date,symbol,expiry,type,strike,close,lotSize};
        for (const [field, keys] of [['oi',['oi','openint','opnintrst']],['volume',['volume','contracts','ttltradgvol']]]) {
          const value = number(get(...keys)); if (finite(value) && value >= 0) out[field] = value;
        }
        contracts.push(out);
        if (out.volume === 0) zeroVolume++;
        const assetPrice = number(get('undrlygpric','underlyingvalue','underlyingprice'));
        if (finite(assetPrice) && assetPrice > 0) {
          const key = date + '|' + symbol, prior = derived.get(key);
          if (prior && prior.close !== assetPrice) derivedConflicts.add(key);
          else if (!prior) derived.set(key,{date,symbol,close:assetPrice});
        }
      } else {
        const out = {date,symbol,close};
        for (const [field, keys] of [['open',['open','opnpric','openindexvalue']],['high',['high','hghpric','highindexvalue']],['low',['low','lwpric','lowindexvalue']],['volume',['volume','ttltradgvol','shares traded','sharestraded']]]) {
          const value = number(get(...keys)); if (finite(value) && value >= 0) out[field] = value;
        }
        underlying.push(out);
      }
    });
    if (rejected > 200) warnings.push((rejected - 200) + ' additional invalid rows were skipped.');
    const independent = uniqueRows(underlying), independentKeys = new Map(independent.map(row => [rowKey(row),row]));
    let independentConflicts = 0, derivedAdded = 0;
    for (const [key, row] of derived) {
      if (derivedConflicts.has(key)) continue;
      const existing = independentKeys.get(key);
      if (existing) { if (existing.close !== row.close) independentConflicts++; continue; }
      independent.push(row); derivedAdded++;
    }
    if (derivedAdded) warnings.push('Underlying values use bhavcopy Underlying Asset price, not independent index close.');
    if (derivedConflicts.size) warnings.push('Conflicting Underlying Asset prices: omitted bhavcopy-derived underlying data for ' + derivedConflicts.size + ' date/symbol pair(s); independent closes and contract closes remain available.');
    if (independentConflicts) warnings.push('Bhavcopy Underlying Asset prices differ from independent closes on ' + independentConflicts + ' date/symbol pair(s); independent closes are retained.');
    if (zeroVolume) warnings.push(zeroVolume + ' imported contract row(s) have zero trading volume; closes are recorded marks, not evidence of executable prices.');
    return {underlying:uniqueRows(independent),contracts:uniqueRows(contracts),warnings,source:String(options.source || '').slice(0, 500),file:String(options.file || '').slice(0, 250)};
  }

  function range(config) {
    const start = parseDate(config.start), end = parseDate(config.end);
    if (!start || !end || end < start) throw new Error('Choose a valid start and end date range.');
    if (dateTime(end) - dateTime(start) > DAY * 366 * 50) throw new Error('Replay date range exceeds 50 years.');
    const feesPerOrder = config.feesPerOrder == null ? 0 : Number(config.feesPerOrder);
    const slippage = config.slippage == null ? 0 : Number(config.slippage);
    if (!finite(feesPerOrder) || feesPerOrder < 0 || feesPerOrder > 1e6 || !finite(slippage) || slippage < 0 || slippage > 1e6) throw new Error('Fees and slippage costs must be finite, non-negative numbers.');
    const symbol = canonicalSymbol(config.symbol);
    if (!symbol) throw new Error('Choose a historical symbol.');
    return {start,end,feesPerOrder,slippage,symbol};
  }
  function checkedLeg(leg, index) {
    const type = String(leg.type || '').toUpperCase(), expiry = parseDate(leg.expiry);
    const strike = type === 'FUT' ? 0 : Number(leg.strike), side = Number(leg.side), lots = Number(leg.lots), lotSize = Number(leg.lotSize);
    if (!['CE','PE','FUT'].includes(type) || !expiry || !finite(strike) || (type !== 'FUT' && strike <= 0)) throw new Error('Invalid contract on leg ' + (index + 1) + '.');
    if (![1,-1].includes(side) || !Number.isInteger(lots) || lots < 1 || lots > 1000 || !Number.isInteger(lotSize) || lotSize < 1 || lotSize > 1000000) throw new Error('Invalid side, lots or lot size on leg ' + (index + 1) + '.');
    return {type,expiry,strike,side,lots,lotSize};
  }
  function roundTripCosts(legs, config) {
    return legs.reduce((sum, leg) => sum + 2 * config.feesPerOrder + 2 * config.slippage * leg.lots * leg.lotSize, 0);
  }
  function summary(rows, effectiveEnd, costs, warnings) {
    const last = rows.find(row => row.date === effectiveEnd), complete = Boolean(last && last.net != null);
    let peak = 0, maxDrawdown = 0, completeDays = 0, missingDays = 0;
    for (const row of rows) {
      if (row.net == null) { missingDays++; continue; }
      completeDays++; peak = Math.max(peak, row.net); maxDrawdown = Math.max(maxDrawdown, peak - row.net);
    }
    if (missingDays) warnings.push('Missing prices are left blank; drawdown uses complete observations only and may understate loss between observations.');
    if (!complete) warnings.push('The exact end date has no complete prices; no final profit or loss is reported.');
    return {complete,summary:{gross:complete ? last.gross : null,net:complete ? last.net : null,costs,maxDrawdown,completeDays,missingDays}};
  }

  function replayObserved(records, config) {
    const cfg = range(config), warnings = [];
    if (!Array.isArray(config.legs) || !config.legs.length || config.legs.length > 24) throw new Error('Choose 1 to 24 historical contract legs.');
    const legs = config.legs.map(checkedLeg);
    const effectiveEnd = [cfg.end,...legs.map(leg => leg.expiry)].sort()[0];
    if (effectiveEnd < cfg.start) throw new Error('The entry date is after a selected contract expiry.');
    const raw = Array.isArray(records) ? records : records && records.contracts;
    if (!Array.isArray(raw) || raw.length > MAX_ROWS) throw new Error('Historical contract rows must be an array within the 200,000 row limit.');
    const selected = raw.filter(row => canonicalSymbol(row.symbol) === cfg.symbol).map(row => ({...row,symbol:cfg.symbol,strike:row.type === 'FUT' ? 0 : row.strike}));
    for (const row of selected) if (!parseDate(row.date) || !parseDate(row.expiry) || row.date > row.expiry || !['CE','PE','FUT'].includes(row.type) || !finite(row.close) || row.close < 0 || !finite(row.strike) || (row.type !== 'FUT' && row.strike <= 0)) throw new Error('Invalid historical contract record or expiry.');
    const unique = uniqueRows(selected), lookup = new Map(unique.map(row => [rowKey(row),row]));
    const datedKey = (date, leg) => date + '|' + contractKey({...leg,symbol:cfg.symbol});
    const entries = legs.map(leg => lookup.get(datedKey(cfg.start, leg)));
    if (entries.some(entry => !entry)) throw new Error('The exact entry/start date needs recorded closing prices for every selected contract.');
    const positions = legs.map((leg, index) => ({...leg,premium:entries[index].close}));
    entries.forEach((entry, index) => { if (entry.lotSize != null && entry.lotSize !== legs[index].lotSize) warnings.push('Leg ' + (index + 1) + ': selected lot size differs from the entry file; the explicit selected quantity is used.'); });
    positions.forEach((leg, index) => {
      const lots = new Set(unique.filter(row => row.date >= cfg.start && row.date <= effectiveEnd && contractKey(row) === contractKey({...leg,symbol:cfg.symbol}) && row.lotSize != null).map(row => row.lotSize));
      if (lots.size > 1) warnings.push('Leg ' + (index + 1) + ': recorded lot size changed during the replay; the selected entry quantity is held fixed. Corporate-action adjustments are not simulated.');
    });
    const dates = new Set(unique.filter(row => row.date >= cfg.start && row.date <= effectiveEnd).map(row => row.date));
    if (!Array.isArray(records) && records && Array.isArray(records.underlying)) for (const row of records.underlying) if (canonicalSymbol(row.symbol) === cfg.symbol && parseDate(row.date) && row.date >= cfg.start && row.date <= effectiveEnd) dates.add(row.date);
    dates.add(cfg.start); dates.add(effectiveEnd);
    const costs = roundTripCosts(positions, cfg);
    const rows = [...dates].sort().map(date => {
      const prices = positions.map(leg => lookup.get(datedKey(date, leg)));
      const missing = positions.flatMap((leg, index) => prices[index] ? [] : [contractKey({...leg,symbol:cfg.symbol})]);
      const gross = missing.length ? null : positions.reduce((total, leg, index) => total + leg.side * leg.lots * leg.lotSize * (prices[index].close - leg.premium), 0);
      return {date,gross,net:gross == null ? null : gross - costs,costs,missing};
    });
    warnings.push('Daily closes are indicative entry and exit marks; fees cover per-order charges only, not a complete exchange tax or margin model. Slippage is charged on both sides.');
    return {mode:'observed',label:'Recorded contract closes',rows,legs:positions,entryDate:cfg.start,effectiveEnd,...summary(rows,effectiveEnd,costs,warnings),warnings};
  }

  function replayModel(state, underlying, config) {
    const cfg = range(config), warnings = [];
    if (!Strategy || !Strategy.validate(state)) throw new Error('The current model assumptions or legs are invalid.');
    const enabled = state.legs.filter(leg => leg.enabled !== false);
    if (!enabled.length) throw new Error('Add an enabled model leg before replaying.');
    const raw = Array.isArray(underlying) ? underlying : underlying && underlying.underlying;
    if (!Array.isArray(raw) || raw.length > MAX_ROWS) throw new Error('Underlying rows must be an array within the 200,000 row limit.');
    const selected = raw.filter(row => canonicalSymbol(row.symbol) === cfg.symbol).map(row => ({...row,symbol:cfg.symbol}));
    for (const row of selected) if (!parseDate(row.date) || !finite(row.close) || row.close <= 0) throw new Error('Invalid underlying closing price record.');
    const unique = uniqueRows(selected), lookup = new Map(unique.map(row => [row.date,row]));
    const entry = lookup.get(cfg.start);
    if (!entry) throw new Error('The exact entry/start date needs an underlying closing price.');
    const effectiveEnd = [cfg.end,addDays(cfg.start,Math.min(...enabled.map(leg => leg.days)))].sort()[0];
    const snapshot = {...state,spot:entry.close,legs:enabled.map(leg => ({...leg,premium:Strategy.price(leg.type,entry.close,leg.strike,leg.days,(leg.iv ?? state.iv) / 100,state.rate / 100,state.dividend / 100)}))};
    const legs = snapshot.legs.map(leg => ({...leg,lotSize:state.lotSize})), costs = roundTripCosts(legs,cfg);
    const dates = new Set(unique.filter(row => row.date >= cfg.start && row.date <= effectiveEnd).map(row => row.date));
    dates.add(effectiveEnd);
    const rows = [...dates].sort().map(date => {
      const record = lookup.get(date), spot = record ? record.close : null;
      const elapsed = Math.round((dateTime(date) - dateTime(cfg.start)) / DAY);
      const gross = record ? Strategy.pnl(snapshot,spot,elapsed,0) : null;
      return {date,spot,gross,net:gross == null ? null : gross - costs,costs,missing:record ? [] : [cfg.symbol + ' underlying close']};
    });
    warnings.push('Only underlying closes are recorded. Option premiums and daily profit/loss are theoretical European model values using a fixed IV; this is not an options-price backtest. Futures are approximated by the underlying spot.');
    warnings.push('Calendar days determine time decay; gaps are never forward-filled. Costs include per-order fees and both-side slippage, excluding exchange taxes and margin.');
    return {mode:'model',label:'Model replay on recorded underlying closes',rows,legs,snapshot,entryDate:cfg.start,effectiveEnd,...summary(rows,effectiveEnd,costs,warnings),warnings};
  }

  return {parseCSV,parseDate,normalizeRows,replayObserved,replayModel,canonicalSymbol,MAX_ROWS};
});

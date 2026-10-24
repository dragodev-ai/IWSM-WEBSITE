(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./strategy-engine.js'), require('./strategy-history-engine.js'), require('./strategy-research-engine.js'), require('./strategy-records.js'));
  else root.IWSMWorkspace = factory(root.IWSMStrategy, root.IWSMHistory, root.IWSMResearch, root.IWSMStrategyRecords);
})(typeof globalThis !== 'undefined' ? globalThis : this, function (E, H, Research, Records) {
  'use strict';
  const finite = value => typeof value === 'number' && Number.isFinite(value);
  const daysBetween = (from, to) => (Date.parse(to + 'T00:00:00Z') - Date.parse(from + 'T00:00:00Z')) / 86400000;

  function screen(dataset, options = {}) {
    const {symbol, date, expiry} = options;
    const outlook = options.outlook ?? 'All', unitsPerLot = options.unitsPerLot ?? 65, lots = options.lots ?? 1;
    const fees = options.fees ?? 20, slippage = options.slippage ?? 0, rate = options.rate ?? 6, dividend = options.dividend ?? 0, iv = options.iv ?? 15;
    const maxLoss = options.maxLoss ?? null, requireLiquidity = options.requireLiquidity !== false;
    if (!['All','Bullish','Bearish','Neutral'].includes(outlook) || !Number.isInteger(unitsPerLot) || unitsPerLot < 1 || unitsPerLot > 10000 || !Number.isInteger(lots) || lots < 1 || lots > 100 || ![fees,slippage,rate,dividend,iv].every(finite) || fees < 0 || slippage < 0 || (maxLoss != null && (!finite(maxLoss) || maxLoss < 0))) throw new Error('Check screener quantity, costs, assumptions and maximum-loss inputs.');
    const snapshot = Research.summarize(dataset, {symbol,date,expiry,rate,dividend}), spot = snapshot.spot, days = daysBetween(date,expiry);
    const skipped = [], candidates = [], selected = E.templates.map((template,index)=>({...template,index})).filter(template=>outlook==='All'||template.outlook===outlook);
    const baseResult = {candidates,skipped,asOf:date,date,symbol:snapshot.symbol,expiry,spot};
    if (spot == null || days <= 0 || !snapshot.rows.length) {
      const reason = spot == null ? 'No exact-date underlying reference.' : days <= 0 ? 'No positive term before expiry.' : 'No matching recorded option chain.';
      selected.forEach(template=>skipped.push({name:template.name,reason})); return baseResult;
    }
    const strikes = snapshot.rows.map(row=>row.strike), gaps = strikes.slice(1).map((strike,index)=>strike-strikes[index]).filter(value=>value>0);
    const step = gaps.length ? Math.min(...gaps) : 1, atm = snapshot.atm.strike;
    const sourceRows = (dataset.contracts || []).filter(row=>H.canonicalSymbol(row.symbol)===snapshot.symbol&&row.date===date&&row.expiry===expiry);
    const lookup = new Map(sourceRows.map(row=>[[row.type,row.type==='FUT'?0:row.strike].join('|'),row]));
    for (const template of selected) {
      let reason = null; const legs = [], lotSizes = [], volumeUnknown = [];
      if (template.legs.some(leg=>(leg[4]||0)!==0)) reason = 'Calendar structure requires another recorded expiry; this screen evaluates one expiry.';
      if (!reason) for (let index=0;index<template.legs.length;index++) {
        const [side,type,offset,ratio=1] = template.legs[index], strike = type==='FUT'?0:atm+offset*step;
        const row = lookup.get([type,strike].join('|'));
        if (!row) { reason = 'Missing exact recorded '+type+' contract at '+strike+'.'; break; }
        if (!finite(row.close)||row.close<=0) { reason = 'Recorded premium is missing or nonpositive.'; break; }
        if (requireLiquidity && (!finite(row.volume)||row.volume<=0)) { reason = 'Positive recorded trading volume is required for every leg.'; break; }
        if (!finite(row.volume)||row.volume<=0) volumeUnknown.push(index);
        const lotSize = row.lotSize == null ? unitsPerLot : row.lotSize;
        if (!Number.isInteger(lotSize)||lotSize<1||lotSize>10000) { reason = 'Invalid recorded contract lot size.'; break; }
        lotSizes.push(lotSize);
        legs.push({id:'screen-'+template.index+'-'+index,enabled:true,side,type,strike:type==='FUT'?spot:strike,lots:lots*ratio,days,premium:row.close});
      }
      if (!reason && !lotSizes.every(value=>value===lotSizes[0])) reason = 'Legs have incompatible historical units per lot.';
      if (reason) { skipped.push({name:template.name,reason}); continue; }
      const state = {symbol:snapshot.symbol,currency:'INR',spot,lotSize:lotSizes[0],iv,rate,dividend,days,step,legs};
      if (!E.validate(state)) { skipped.push({name:template.name,reason:'Candidate assumptions or leg quantities exceed the supported model range.'}); continue; }
      const metrics = E.metrics(state), roundTripCosts = legs.length*fees*2 + legs.reduce((sum,leg)=>sum+leg.lots*state.lotSize*slippage*2,0);
      // Keep signed payoff extrema until after costs. Gross metrics deliberately
      // floor profit/loss at zero, which discards information for crossed marks.
      const knots = [...new Set([0,...legs.filter(leg=>leg.type!=='FUT').map(leg=>leg.strike)])];
      const terminalNet = knots.map(price=>E.expiryPnl(state,price)-roundTripCosts);
      const upperSlope = legs.reduce((sum,leg)=>sum+(leg.type==='PE'?0:leg.side*leg.lots*state.lotSize),0);
      const maxProfitNet = upperSlope>1e-8?Infinity:Math.max(...terminalNet);
      const maxLossNet = upperSlope< -1e-8?Infinity:Math.max(0,-Math.min(...terminalNet));
      if (maxLoss != null && (!finite(maxLossNet)||maxLossNet>maxLoss)) { skipped.push({name:template.name,reason:'Net maximum loss exceeds the selected limit or is unlimited.'}); continue; }
      candidates.push({templateIndex:template.index,name:template.name,outlook:template.outlook,state,metrics,roundTripCosts,maxProfitNet,maxLossNet,liquidityNote:volumeUnknown.length?'Recorded EOD closes; some leg volume is absent or zero. Execution is unverified.':'Recorded EOD closes with positive recorded volume; executable prices, spreads and fills remain unverified.'});
    }
    return baseResult;
  }

  function portfolio(records, scenario = {}) {
    if (!Array.isArray(records)) throw new Error('Select saved strategy records.');
    const spotShift = scenario.spotShift ?? 0, ivShift = scenario.ivShift ?? 0, elapsed = scenario.elapsed ?? 0;
    if (![spotShift,ivShift,elapsed].every(finite)||spotShift<=-100||!Number.isInteger(elapsed)||elapsed<0) throw new Error('Check the positive spot scenario, volatility shift and whole elapsed days.');
    const rows = [], groups = [], warnings = [], grouped = new Map();
    records.forEach((record,index)=>{
      try {
        const loaded = Records.load(record), state = loaded.state, active = state.legs.filter(leg=>leg.enabled!==false);
        if (!active.length) throw new Error('No enabled positions.');
        const earliest = Math.min(...active.map(leg=>leg.days)), appliedElapsed = Math.min(elapsed,earliest), shiftedSpot = state.spot*(1+spotShift/100);
        if (state.iv+ivShift<.1||state.iv+ivShift>300||!finite(shiftedSpot)||shiftedSpot<=0) throw new Error('Scenario price or volatility is outside the supported range.');
        if (appliedElapsed!==elapsed) warnings.push(loaded.name+': elapsed scenario capped at its earliest expiry ('+appliedElapsed+' days).');
        if (loaded.legacyUndated) warnings.push(loaded.name+': the original valuation date could not be recovered; this legacy record uses the date shown.');
        const pnl = E.pnl(state,shiftedSpot,appliedElapsed,ivShift), greeks = E.aggregateGreeks(state,shiftedSpot,appliedElapsed,ivShift);
        if (!finite(pnl)||!Object.values(greeks).every(finite)) throw new Error('Scenario calculation produced an unavailable result.');
        const row = {index,name:loaded.name,asOf:loaded.asOf,symbol:state.symbol,currency:state.currency,state,pnl,greeks,legs:active.length,notice:loaded.notice,appliedElapsed};
        rows.push(row);
        const key = JSON.stringify([H.canonicalSymbol(state.symbol),state.currency,loaded.asOf,state.spot,state.iv,state.rate,state.dividend,appliedElapsed]);
        let group = grouped.get(key);
        if (!group) {
          group = {key,symbol:state.symbol,currency:state.currency,asOf:loaded.asOf,count:0,pnl:0,greeks:{delta:0,gamma:0,theta:0,vega:0,rho:0},spot:state.spot,iv:state.iv,rate:state.rate,dividend:state.dividend,appliedElapsed};
          grouped.set(key,group); groups.push(group);
        }
        group.count++; group.pnl+=pnl;
        for (const field of Object.keys(group.greeks)) group.greeks[field]+=greeks[field];
      } catch (error) { warnings.push('Saved strategy '+(index+1)+' skipped: '+error.message); }
    });
    return {rows,groups,warnings};
  }

  return {screen,portfolio};
});

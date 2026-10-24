(function () {
  'use strict';
  const $ = id => document.getElementById(id), W = window.IWSMWorkspace, H = window.IWSMHistoryLab, L = window.IWSMLab;
  if (!W || !H || !L || !$('strategy-tools')) return;
  const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const num = (v, d = 2) => v == null ? '—' : !Number.isFinite(v) ? 'Unlimited' : Number(v).toLocaleString('en-IN', {maximumFractionDigits:d});
  const money = (v, currency = 'INR') => v == null ? '—' : !Number.isFinite(v) ? 'Unlimited' : new Intl.NumberFormat('en-IN', {style:'currency',currency,maximumFractionDigits:0}).format(v);
  let dataset = H.dataset(), screened = null, saved = [], selection = new Set();
  function options(id, values, previous) {
    $(id).replaceChildren(...values.map(v => new Option(v, v)));
    if (values.includes(previous)) $(id).value = previous;
  }
  function updateDates() {
    const symbol = $('screen-symbol').value, dates = [...new Set(dataset.contracts.filter(r => r.symbol === symbol && r.type !== 'FUT').map(r => r.date))].sort();
    options('screen-date', dates, $('screen-date').value || dates.at(-1));
    updateExpiries();
  }
  function updateExpiries() {
    const symbol = $('screen-symbol').value, date = $('screen-date').value;
    options('screen-expiry', [...new Set(dataset.contracts.filter(r => r.symbol === symbol && r.date === date && r.type !== 'FUT' && r.expiry > date).map(r => r.expiry))].sort(), $('screen-expiry').value);
    runScreen();
  }
  function refreshData() {
    dataset = H.dataset();
    options('screen-symbol', [...new Set(dataset.contracts.filter(r => r.type !== 'FUT').map(r => r.symbol))].sort(), $('screen-symbol').value);
    updateDates();
  }
  function screenOptions() {
    return {symbol:$('screen-symbol').value,date:$('screen-date').value,expiry:$('screen-expiry').value,outlook:$('screen-outlook').value,lots:Number($('screen-lots').value),unitsPerLot:Number($('screen-units').value),fees:Number($('screen-fees').value),slippage:Number($('screen-slippage').value),iv:Number($('screen-iv').value),rate:Number($('screen-rate').value),dividend:Number($('screen-dividend').value),maxLoss:$('screen-maxloss').value === '' ? null : Number($('screen-maxloss').value),requireLiquidity:$('screen-liquid').checked};
  }
  function clearScreen(text) {
    screened = null; $('screen-export').disabled = true;
    $('screener-status').textContent = text;
    $('screen-rows').innerHTML = '<tr><td colspan="9" class="tools-empty">No complete structures to show for these settings.</td></tr>';
    $('screen-skipped').replaceChildren();
  }
  function runScreen() {
    if (!$('screener-form').checkValidity()) { clearScreen('Check the highlighted screener inputs before calculating.'); return; }
    if (!$('screen-expiry').value) { clearScreen('No unexpired recorded option chain is loaded for this date. Import more data in the Historical Lab.'); return; }
    try {
      const query = screenOptions(); screened = W.screen(dataset, query);
      $('screen-export').disabled = !screened.candidates.length;
      $('screener-status').textContent = `${screened.symbol} · recorded ${query.date} · expiry ${screened.expiry} · underlying ${num(screened.spot)} · ${screened.candidates.length} complete structures · ${screened.skipped.length} skipped. Historical closes, not live quotes or executable fills.`;
      $('screen-rows').innerHTML = screened.candidates.map((c,i) => `<tr><th scope="row">${esc(c.name)}<small>${esc(query.date)} → ${esc(screened.expiry)}</small></th><td>${esc(c.outlook === 'Neutral' ? 'Non-directional' : c.outlook)}</td><td>${c.state.legs.length}</td><td>${num(c.metrics.credit)}</td><td>${num(c.roundTripCosts)}</td><td>${num(c.maxProfitNet)}</td><td>${num(c.maxLossNet)}</td><td>${c.metrics.pop == null ? '—' : num(c.metrics.pop * 100,1) + '%'}</td><td><button type="button" data-screen-load="${i}">Study in builder</button></td></tr>`).join('') || '<tr><td colspan="9" class="tools-empty">No structures meet the selected coverage, outlook and maximum-loss criteria.</td></tr>';
      $('screen-skipped').innerHTML = screened.skipped.map(item => `<li><strong>${esc(item.name)}</strong> — ${esc(item.reason)}</li>`).join('') || '<li>No coverage exclusions for the selected structures.</li>';
    } catch (e) { clearScreen('Unable to screen this selection: ' + e.message); }
  }
  $('screener-form').onsubmit = e => { e.preventDefault(); runScreen(); };
  $('screen-symbol').onchange = updateDates; $('screen-date').onchange = updateExpiries; $('screen-expiry').onchange = runScreen;
  $('screener-form').addEventListener('change', e => { if (!['screen-symbol','screen-date','screen-expiry'].includes(e.target.id)) runScreen(); });
  $('screener-form').addEventListener('input', e => { if (e.target.matches('input')) { screened = null; $('screen-export').disabled = true; $('screen-rows').replaceChildren(); $('screen-skipped').replaceChildren(); $('screener-status').textContent = 'Settings changed. Screen recorded strategies to update the results.'; } });
  $('screen-rows').onclick = e => {
    const button = e.target.closest('[data-screen-load]'); if (!button || !screened) return;
    const candidate = screened.candidates[Number(button.dataset.screenLoad)]; if (!candidate) return;
    try {
      L.loadSnapshot({name:candidate.name + ' · ' + screened.date,asOf:screened.date,state:candidate.state,notes:'Recorded NSE/imported closing premiums from ' + screened.date + ', expiry ' + screened.expiry + '. Model chart and Greeks use displayed assumptions. Screener costs are shown separately and are excluded from the builder payoff.'});
      location.hash='builder-start';$('builder-start').scrollIntoView({block:'start',behavior:'auto'});
      $('screener-status').textContent = 'Loaded ' + candidate.name + ' as a dated model study. Entry closes and the original expiry are preserved.';
    } catch (error) { $('screener-status').textContent = 'The selected structure could not be loaded: ' + error.message; }
  };
  function downloadCSV(rows, name) {
    const literal = value => { const text = String(value ?? ''); return '"' + (/^[=+\-@\t\r]/.test(text) && typeof value !== 'number' ? "'" : '') + text.replaceAll('"','""') + '"'; };
    const content = rows.map(r => r.map(literal).join(',')).join('\r\n');
    const url = URL.createObjectURL(new Blob(['\uFEFF',content],{type:'text/csv;charset=utf-8'})), a = document.createElement('a');
    a.href = url; a.download = name; document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url),1000);
  }
  $('screen-export').onclick = () => {
    if (!screened) return;
    downloadCSV([['symbol','recorded_date','expiry','structure','outlook','entry_credit_inr','round_trip_costs_inr','net_max_profit_inr','net_max_loss_inr','model_pop_pct','model_iv_pct','model_rate_pct','model_dividend_pct'],...screened.candidates.map(c => [screened.symbol,screened.date,screened.expiry,c.name,c.outlook,c.metrics.credit,c.roundTripCosts,num(c.maxProfitNet,8),num(c.maxLossNet,8),c.metrics.pop == null ? '' : c.metrics.pop*100,c.state.iv,c.state.rate,c.state.dividend])],'iwsm-recorded-strategy-screen.csv');
  };
  function refreshSaved() {
    saved = L.savedRecords(); selection = new Set(saved.map((_,i) => i));
    $('portfolio-selection').innerHTML = saved.map((r,i) => `<label class="portfolio-choice"><input type="checkbox" data-paper-record="${i}" checked><span>${esc(r.name)}<small>${esc(r.state.symbol)} · ${esc(r.asOf || r.savedAt?.slice(0,10) || 'Legacy date')} · ${esc(r.state.currency)}</small></span></label>`).join('');
    renderPortfolio();
  }
  function renderPortfolio() {
    if (!$('portfolio-form').checkValidity()) { $('portfolio-status').textContent = 'Check the paper portfolio scenario inputs.'; $('portfolio-rows').replaceChildren(); $('portfolio-groups').replaceChildren(); return; }
    try {
      const selected = saved.filter((_,i) => selection.has(i));
      const result = W.portfolio(selected,{spotShift:Number($('portfolio-spot').value),ivShift:Number($('portfolio-iv').value),elapsed:Number($('portfolio-days').value)});
      $('portfolio-status').textContent = result.rows.length ? `${result.rows.length} saved studies · ${result.groups.length} compatible groups. ` + result.warnings.join(' ') : 'No saved studies selected. Save a strategy in the builder to add it here.';
      $('portfolio-rows').innerHTML = result.rows.map(r => `<tr><th scope="row">${esc(r.name)}<small>Valuation ${esc(r.asOf)} · +${r.appliedElapsed ?? 0} days</small></th><td>${esc(r.symbol)}</td><td>${esc(r.currency)}</td><td>${r.legs}</td><td class="${r.pnl >= 0 ? 'gain' : 'loss'}">${esc(money(r.pnl,r.currency))}</td><td>${num(r.greeks.delta)}</td><td>${num(r.greeks.theta)}</td><td>${num(r.greeks.vega)}</td><td><button type="button" data-paper-load="${r.index}">Open study</button></td></tr>`).join('') || '<tr><td colspan="9" class="tools-empty">Your selected paper strategies will appear here.</td></tr>';
      $('portfolio-groups').innerHTML = result.groups.map(g => `<div class="portfolio-group"><strong>${esc(g.symbol)} · ${esc(g.currency)} · ${esc(g.asOf)}</strong><p>${g.count} compatible studies</p><b class="${g.pnl >= 0 ? 'gain' : 'loss'}">${esc(money(g.pnl,g.currency))}</b><p>Delta ${num(g.greeks.delta)} · Theta/day ${num(g.greeks.theta)} · Vega/pp ${num(g.greeks.vega)}</p></div>`).join('');
    } catch (e) { $('portfolio-status').textContent = 'Unable to calculate the portfolio: ' + e.message; $('portfolio-rows').replaceChildren(); $('portfolio-groups').replaceChildren(); }
  }
  $('portfolio-selection').onchange = e => { if (!e.target.matches('[data-paper-record]')) return; const i = Number(e.target.dataset.paperRecord); e.target.checked ? selection.add(i) : selection.delete(i); renderPortfolio(); };
  $('portfolio-form').onsubmit = e => { e.preventDefault(); renderPortfolio(); };
  $('portfolio-form').addEventListener('input', renderPortfolio);
  $('portfolio-refresh').onclick = refreshSaved;
  $('portfolio-rows').onclick = e => { const button = e.target.closest('[data-paper-load]'); if (!button) return; const selected = saved.filter((_,i) => selection.has(i)), record = selected[Number(button.dataset.paperLoad)]; if (!record) return; try { L.loadRecord(record); location.hash='builder-start';$('builder-start').scrollIntoView({block:'start',behavior:'auto'}); } catch (error) { $('portfolio-status').textContent = error.message; } };
  function selectTab(name, focus) {
    document.querySelectorAll('[data-tool]').forEach(tab => { const selected = tab.dataset.tool === name; tab.setAttribute('aria-selected',String(selected)); tab.tabIndex = selected ? 0 : -1; $('tools-' + tab.dataset.tool).hidden = !selected; if (selected && focus) tab.focus(); });
  }
  document.querySelector('.tools-tabs').onclick = e => { const tab = e.target.closest('[data-tool]'); if (tab) selectTab(tab.dataset.tool); };
  document.querySelector('.tools-tabs').onkeydown = e => { const tabs = [...document.querySelectorAll('[data-tool]')], i = tabs.indexOf(document.activeElement); if (i < 0 || !['ArrowLeft','ArrowRight','Home','End'].includes(e.key)) return; e.preventDefault(); const next = e.key === 'Home' ? 0 : e.key === 'End' ? tabs.length-1 : (i + (e.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length; selectTab(tabs[next].dataset.tool,true); };
  window.addEventListener('iwsm:history-data-changed', refreshData);
  window.addEventListener('iwsm:strategies-saved', refreshSaved);
  window.addEventListener('storage', e => { if (e.key === 'iwsm_strategy_lab_v1' || e.key === null) refreshSaved(); });
  refreshData(); refreshSaved();
})();

(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.IWSMPaperChart = factory();
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  const W = 900, H = 420, LEFT = 76, RIGHT = 22, TOP = 36, BOTTOM = 52;
  const finite = Number.isFinite;
  const clamp = (n, a, b) => Math.max(a, Math.min(b, n));
  const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;'}[c]));
  const money = value => finite(value) ? value.toLocaleString('en-IN', {minimumFractionDigits:2, maximumFractionDigits:2}) : 'Unavailable';
  const compact = value => !finite(value) ? '—' : Math.abs(value) >= 100000 ? (value / 100000).toFixed(1) + 'L' : Math.abs(value) >= 1000 ? (value / 1000).toFixed(1) + 'k' : value.toFixed(0);

  /** Pure geometry: a gap remains a gap; no missing premium is plotted as zero. */
  function geometry(analysis) {
    const curve = Array.isArray(analysis?.curve) ? analysis.curve.map(row => ({spot:row.spot, current:finite(row.current) ? row.current : null, expiry:finite(row.expiry) ? row.expiry : null})) : [];
    if (!curve.length) return null;
    if (curve.some((row, i) => !finite(row.spot) || row.spot < 0 || (i > 0 && row.spot <= curve[i - 1].spot))) throw Error('Payoff prices must be finite and strictly increasing.');
    const prices = curve.map(row => row.spot), values = curve.flatMap(row => [row.current, row.expiry]).filter(finite);
    let xMin = prices[0], xMax = prices.at(-1);
    if (xMin === xMax) { xMin = Math.max(0, xMin - 1); xMax += 1; }
    let yMin = Math.min(0, ...values), yMax = Math.max(0, ...values);
    const padding = yMax === yMin ? 1 : (yMax - yMin) * .08;
    yMin -= padding; yMax += padding;
    const width = W - LEFT - RIGHT, height = H - TOP - BOTTOM;
    const x = value => LEFT + (value - xMin) / (xMax - xMin) * width;
    const y = value => TOP + (yMax - value) / (yMax - yMin) * height;
    const nearest = value => {
      if (!finite(value)) return 0;
      let low = 0, high = curve.length - 1;
      while (low < high) { const mid = Math.floor((low + high) / 2); if (curve[mid].spot < value) low = mid + 1; else high = mid; }
      return low > 0 && Math.abs(curve[low - 1].spot - value) <= Math.abs(curve[low].spot - value) ? low - 1 : low;
    };
    function path(key) {
      let drawing = false;
      return curve.map(row => {
        if (row[key] === null) { drawing = false; return ''; }
        const part = (drawing ? 'L' : 'M') + x(row.spot) + ',' + y(row[key]); drawing = true; return part;
      }).join(' ');
    }
    // Split at each exact zero crossing, preventing a green polygon from covering a loss.
    function fills(key) {
      const out = {gain:[], loss:[]}, baseline = y(0);
      function segment(a, b) {
        if (a.value === 0 && b.value === 0) return;
        const sign = a.value !== 0 ? a.value : b.value;
        out[sign >= 0 ? 'gain' : 'loss'].push('M' + x(a.spot) + ',' + baseline + 'L' + x(a.spot) + ',' + y(a.value) + 'L' + x(b.spot) + ',' + y(b.value) + 'L' + x(b.spot) + ',' + baseline + 'Z');
      }
      for (let i = 1; i < curve.length; i++) {
        const a = curve[i - 1], b = curve[i];
        if (a[key] === null || b[key] === null) continue;
        const p = {spot:a.spot, value:a[key]}, q = {spot:b.spot, value:b[key]};
        if (p.value * q.value < 0) {
          const zero = {spot:p.spot + (q.spot - p.spot) * -p.value / (q.value - p.value), value:0};
          segment(p, zero); segment(zero, q);
        } else segment(p, q);
      }
      return {gain:out.gain.join(''), loss:out.loss.join('')};
    }
    const indexAtX = pixel => nearest(xMin + (clamp(pixel, LEFT, W - RIGHT) - LEFT) / width * (xMax - xMin));
    return {W,H,LEFT,RIGHT,TOP,BOTTOM,width,height,curve,xMin,xMax,yMin,yMax,x,y,nearest,indexAtX,path,fills};
  }

  const style = `.pp-chart{position:relative;color:var(--ink);font:12px/1.4 Arial,sans-serif}.pp-chart svg{display:block;width:100%;height:auto;max-height:none;aspect-ratio:900/420;touch-action:pan-y;background:var(--surface)}.pp-chart .pp-grid{stroke:var(--border);stroke-width:1;opacity:.5}.pp-chart .pp-zero{stroke:var(--muted);stroke-width:1}.pp-chart .pp-axis{fill:var(--muted);font:11px Arial,sans-serif}.pp-chart .pp-sigma-band{fill:var(--accent);fill-opacity:.045}.pp-chart .pp-sigma-line{stroke:var(--muted);stroke-width:1;stroke-dasharray:2 4;opacity:.55}.pp-chart .pp-sigma-text{fill:var(--muted);font:600 10px Arial,sans-serif;opacity:.85}.pp-chart .pp-be-dot{fill:var(--surface);stroke:var(--ink);stroke-width:1.8}.pp-chart .pp-expiry{fill:none;stroke:var(--accent);stroke-width:2.2}.pp-chart .pp-current{fill:none;stroke:var(--scenario,var(--chart));stroke-width:1.7;stroke-dasharray:6 4}.pp-chart .pp-gain{fill:var(--gain);fill-opacity:.14}.pp-chart .pp-loss{fill:var(--loss);fill-opacity:.15}.pp-chart .pp-spot{stroke:#16a34a;stroke-width:1.4;stroke-dasharray:3 4}.pp-chart .pp-crosshair{stroke:var(--ink);stroke-width:1;stroke-dasharray:3 3}.pp-chart .pp-point-expiry{fill:var(--accent);stroke:var(--surface);stroke-width:2}.pp-chart .pp-point-current{fill:var(--scenario,var(--chart));stroke:var(--surface);stroke-width:2}.pp-chart .pp-tooltip{position:absolute;pointer-events:none;z-index:2;background:var(--surface);color:var(--ink);border:1px solid var(--border);border-radius:6px;box-shadow:0 4px 16px #0002;padding:10px 12px;min-width:190px;max-width:260px;font:12px/1.5 Arial,sans-serif}.pp-chart .pp-tooltip>div{display:flex;justify-content:space-between;gap:16px}.pp-chart .pp-tooltip small{display:block;color:var(--muted)}.pp-chart .pp-legend{display:flex;gap:18px;flex-wrap:wrap;color:var(--muted);margin:8px 0}.pp-chart .pp-legend i{display:inline-block;width:20px;border-top:2px solid var(--accent);margin-right:5px;vertical-align:middle}.pp-chart .pp-legend i.pp-dash{border-color:var(--scenario,var(--chart));border-top-style:dashed}.pp-chart .pp-legend i.pp-sigma-key{border-color:var(--muted);border-top-style:dotted}.pp-chart .pp-inspector{display:block;margin-top:8px}.pp-chart .pp-inspector input{display:block;width:100%;accent-color:var(--accent)}.pp-chart .pp-readout{display:block;min-height:36px;font-size:12px;color:var(--muted)}.pp-chart .pp-note{font-size:11px;color:var(--muted);margin:6px 0}.pp-chart [hidden]{display:none!important}@media(max-width:600px){.pp-chart .pp-tooltip{min-width:150px;padding:7px;font-size:11px}.pp-chart .pp-axis{font-size:13px}.pp-chart svg{min-height:230px}}`;

  function render(host, analysis, options = {}) {
    if (!host || typeof host.querySelector !== 'function') throw Error('Provide a chart host element.');
    if (analysis?.empty || !analysis?.curve?.length) { host.textContent = analysis?.reason || 'Add an open position to inspect its payoff.'; return {destroy(){host.replaceChildren();}}; }
    const g = geometry(analysis), fills = g.fills('expiry');
    const targetName = analysis.isExpiryPayoff === false ? 'Pay-off' : 'Expiry', targetDate = analysis.payoffDate || analysis.expiry;
    const spot = finite(analysis.spot) ? analysis.spot : null, spotX = spot === null ? null : g.x(spot);
    const futureBasis = analysis.basis === 'future', referenceName = futureBasis ? 'Futures' : 'Spot', scenarioName = futureBasis ? 'Futures' : 'Underlying', fromLabel = futureBasis ? 'From futures' : 'From spot';
    const ticks = Array.from({length:6}, (_, i) => g.yMin + (g.yMax - g.yMin) * i / 5);
    const xticks = Array.from({length:6}, (_, i) => g.xMin + (g.xMax - g.xMin) * i / 5);

    // Optional +/-1 sigma and +/-2 sigma vertical lines & shaded 1-sigma cone
    let sigmaSvg = '';
    const sd = analysis.stdDev;
    if (sd && finite(sd.minus1) && finite(sd.plus1)) {
      const s1L = clamp(g.x(sd.minus1), LEFT, W - RIGHT), s1R = clamp(g.x(sd.plus1), LEFT, W - RIGHT);
      if (s1R > s1L) {
        sigmaSvg += '<rect class="pp-sigma-band" x="' + s1L + '" y="' + TOP + '" width="' + (s1R - s1L) + '" height="' + g.height + '"/>';
      }
      for (const [tag, price] of [['-2σ', sd.minus2], ['-1σ', sd.minus1], ['+1σ', sd.plus1], ['+2σ', sd.plus2]]) {
        if (!finite(price)) continue;
        const sx = g.x(price);
        if (sx >= LEFT + 8 && sx <= W - RIGHT - 8) {
          sigmaSvg += '<path class="pp-sigma-line" d="M' + sx + ',' + TOP + 'V' + (H - BOTTOM) + '"/><text class="pp-sigma-text" x="' + sx + '" y="' + (TOP + 12) + '" text-anchor="middle">' + tag + '</text>';
        }
      }
    }

    // Optional Breakeven markers along zero line
    const beList = Array.isArray(analysis.breaks) && analysis.breaks.length ? analysis.breaks : (analysis.mixedExpiryEstimate?.breaks || []);
    const beSvg = beList.filter(b => finite(b) && g.x(b) >= LEFT && g.x(b) <= W - RIGHT)
      .map(b => '<circle class="pp-be-dot" cx="' + g.x(b) + '" cy="' + g.y(0) + '" r="3.5"><title>Breakeven ₹' + money(b) + '</title></circle>')
      .join('');

    const sigmaLegend = sd && finite(sd.move) ? '<span><i class="pp-sigma-key"></i>±1σ (₹' + money(sd.move) + ')</span>' : '';

    host.innerHTML = '<style>' + style + '</style><div class="pp-chart"><div class="pp-legend"><span><i></i>' + targetName + ' ' + esc(targetDate) + '</span><span><i class="pp-dash"></i>Current model</span>' + sigmaLegend + '</div>' +
      '<svg viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="' + esc((options.symbol || '') + ' estimated payoff; use the price inspector for exact values') + '">' +
      sigmaSvg +
      ticks.map(v => '<path class="pp-grid" d="M' + LEFT + ',' + g.y(v) + 'H' + (W - RIGHT) + '"/><text class="pp-axis" x="' + (LEFT - 9) + '" y="' + (g.y(v) + 4) + '" text-anchor="end">₹' + compact(v) + '</text>').join('') +
      xticks.map(v => '<path class="pp-grid" d="M' + g.x(v) + ',' + TOP + 'V' + (H - BOTTOM) + '"/><text class="pp-axis" x="' + g.x(v) + '" y="' + (H - BOTTOM + 23) + '" text-anchor="middle">' + money(v) + '</text>').join('') +
      '<path class="pp-gain" d="' + fills.gain + '"/><path class="pp-loss" d="' + fills.loss + '"/><path class="pp-zero" d="M' + LEFT + ',' + g.y(0) + 'H' + (W - RIGHT) + '"/>' +
      (spotX !== null && spotX >= LEFT && spotX <= W - RIGHT ? '<path class="pp-spot" d="M' + spotX + ',' + TOP + 'V' + (H - BOTTOM) + '"/><text class="pp-axis" x="' + spotX + '" y="20" text-anchor="middle">' + referenceName + ' ' + money(spot) + '</text>' : '') +
      '<path class="pp-current" d="' + g.path('current') + '"/><path class="pp-expiry" d="' + g.path('expiry') + '"/>' + beSvg +
      '<g class="pp-focus" hidden><path class="pp-crosshair"/><circle class="pp-point-current" r="4"/><circle class="pp-point-expiry" r="4"/></g><text class="pp-axis" x="' + (LEFT + g.width / 2) + '" y="' + (H - 8) + '" text-anchor="middle">' + scenarioName + ' price</text></svg>' +
      '<div class="pp-tooltip" hidden></div><output class="pp-readout" aria-live="polite"></output><label class="pp-inspector">Inspect ' + scenarioName.toLowerCase() + ' price<input type="range" min="0" max="' + (g.curve.length - 1) + '" step="1" aria-label="Payoff ' + scenarioName.toLowerCase() + ' price inspector"></label><p class="pp-note">' + esc(analysis.label || 'Model sensitivity, not a forecast.') + '</p></div>';
    const wrapper = host.querySelector('.pp-chart'), svg = host.querySelector('svg'), focus = host.querySelector('.pp-focus'), line = host.querySelector('.pp-crosshair'), current = host.querySelector('.pp-point-current'), expiry = host.querySelector('.pp-point-expiry'), tooltip = host.querySelector('.pp-tooltip'), output = host.querySelector('.pp-readout'), range = host.querySelector('input[type="range"]');
    let index = g.nearest(spot ?? g.curve[0].spot);
    function inspect(next, showTooltip) {
      index = clamp(Math.round(Number(next) || 0), 0, g.curve.length - 1); const row = g.curve[index], px = g.x(row.spot);
      focus.hidden = false; focus.removeAttribute('hidden');
      line.setAttribute('d', 'M' + px + ',' + TOP + 'V' + (H - BOTTOM));
      for (const [node, key] of [[current, 'current'], [expiry, 'expiry']]) { if (row[key] === null) node.setAttribute('visibility', 'hidden'); else { node.removeAttribute('visibility'); node.setAttribute('cx', px); node.setAttribute('cy', g.y(row[key])); } }
      range.value = String(index);
      const change = spot > 0 ? (row.spot / spot - 1) * 100 : null;
      const replay = options.cursor ? options.cursor.replace('T', ' ') + ' IST' : 'Selected replay snapshot';
      output.textContent = scenarioName + ' ₹' + money(row.spot) + (change === null ? '' : ' (' + (change >= 0 ? '+' : '') + change.toFixed(2) + '% ' + fromLabel.toLowerCase() + ')') + ' · Current model ₹' + money(row.current) + ' · ' + targetName + ' ' + targetDate + ' ₹' + money(row.expiry) + ' · ' + replay;
      tooltip.innerHTML = '<div><strong>' + scenarioName + '</strong><strong>₹' + money(row.spot) + '</strong></div><div><span>' + fromLabel + '</span><span>' + (change === null ? 'Unavailable' : (change >= 0 ? '+' : '') + change.toFixed(2) + '%') + '</span></div><div><span>Current model</span><strong>₹' + money(row.current) + '</strong></div><div><span>' + targetName + ' ' + esc(targetDate) + '</span><strong>₹' + money(row.expiry) + '</strong></div><small>' + esc(replay) + '</small>';
      if (options.startDate) tooltip.innerHTML += '<small>Start date ' + esc(options.startDate) + '</small>';
      tooltip.hidden = !showTooltip;
      if (showTooltip) {
        const r = svg.getBoundingClientRect(), wrap = wrapper.getBoundingClientRect(), scale = Math.min(r.width / W, r.height / H), offset = (r.width - W * scale) / 2;
        const tipWidth = tooltip.offsetWidth || 210, tipHeight = tooltip.offsetHeight || 130;
        tooltip.style.left = clamp(r.left - wrap.left + offset + px * scale + 12, 0, Math.max(0, wrap.width - tipWidth)) + 'px';
        const anchorY = row.current !== null ? g.y(row.current) : row.expiry !== null ? g.y(row.expiry) : g.y(0);
        tooltip.style.top = clamp(r.top - wrap.top + (r.height - H * scale) / 2 + anchorY * scale - tipHeight - 12, r.top - wrap.top, Math.max(r.top - wrap.top, r.bottom - wrap.top - tipHeight)) + 'px';
      }
      if (typeof options.onInspect === 'function') options.onInspect({...row, index, basis:futureBasis ? 'future' : 'spot', referenceExpiry:analysis.referenceExpiry ?? null, referenceChange:change, spotChange:futureBasis ? null : change, cursor:options.cursor, expiryDate:analysis.expiry});
      return row;
    }
    function pointer(event) {
      const r = svg.getBoundingClientRect(), scale = Math.min(r.width / W, r.height / H);
      if (!(scale > 0)) return;
      const px = (event.clientX - r.left - (r.width - W * scale) / 2) / scale;
      inspect(g.indexAtX(px), true);
    }
    svg.addEventListener('pointermove', pointer); svg.addEventListener('pointerdown', pointer);
    const leave = () => { tooltip.hidden = true; };
    svg.addEventListener('pointerleave', leave);
    const input = () => inspect(range.value, true); range.addEventListener('input', input);
    const blur = () => { tooltip.hidden = true; }; range.addEventListener('blur', blur);
    inspect(index, false);
    return {inspect:next => inspect(next, true), destroy(){svg.removeEventListener('pointermove', pointer); svg.removeEventListener('pointerdown', pointer); svg.removeEventListener('pointerleave', leave); range.removeEventListener('input', input); range.removeEventListener('blur', blur); host.replaceChildren();}};
  }
  return {geometry, render};
});

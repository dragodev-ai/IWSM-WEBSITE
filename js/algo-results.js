(function () {
  'use strict';

  const host = document.getElementById('algo-results');
  if (!host) return;

  const FREE_ALGO_URL = 'https://ekyc.aliceblueonline.com/?source=WRAJ1371';
  const MONTHS_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const PAGE_SIZE = 20;

  const esc = (x) =>
    String(x).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  function formatINR(num, decimals = 2, forcePlus = false) {
    const n = Number(num) || 0;
    const sign = n < 0 ? '-' : forcePlus && n > 0 ? '+' : '';
    return (
      sign +
      '₹' +
      Math.abs(n).toLocaleString('en-IN', {
        minimumFractionDigits: decimals,
        maximumFractionDigits: decimals,
      })
    );
  }

  function formatCapitalCompact(num) {
    const n = Math.round(Number(num) || 0);
    return '₹' + n.toLocaleString('en-IN');
  }

  function formatDDMMMYYYY(ymd) {
    const parts = String(ymd || '').slice(0, 10).split('-').map(Number);
    if (parts.length !== 3 || !parts[0] || !parts[1] || !parts[2]) return String(ymd || '');
    return String(parts[2]).padStart(2, '0') + ' ' + MONTHS_SHORT[parts[1] - 1] + ' ' + parts[0];
  }

  function formatRangeButtonLabel(fromYmd, toYmd) {
    const f = String(fromYmd || '').slice(0, 10).split('-').map(Number);
    const t = String(toYmd || '').slice(0, 10).split('-').map(Number);
    if (f.length !== 3 || t.length !== 3) return fromYmd + ' - ' + toYmd;
    return `${MONTHS_SHORT[f[1] - 1]} ${f[2]} ${f[0]} - ${MONTHS_SHORT[t[1] - 1]} ${t[2]} ${t[0]}`;
  }

  function formatTimeIST(isoStr) {
    if (!isoStr) return '—';
    const m = String(isoStr).match(/T(\d{2}:\d{2}(?::\d{2})?)/);
    return m ? m[1].slice(0, 5) : '—';
  }

  function mondayOfDateStr(ymd) {
    const [y, m, d] = String(ymd).slice(0, 10).split('-').map(Number);
    const dt = new Date(Date.UTC(y, m - 1, d));
    const dow = dt.getUTCDay(); // 0=Sun, 1=Mon..6=Sat
    const diff = (dow + 6) % 7;
    dt.setUTCDate(dt.getUTCDate() - diff);
    return dt.toISOString().slice(0, 10);
  }

  function effectiveTradePnl(trade, mult, slipOn, slipPct) {
    const raw = Number(trade.pnl) || 0;
    if (!slipOn || !(slipPct > 0)) return raw * mult;
    const half = slipPct / 100 / 2;
    const buy = Number(trade.buy) || 0;
    const sell = Number(trade.sell) || 0;
    const diff = sell - buy;
    if (Math.abs(diff) > 1e-12) {
      const units = raw / diff;
      const adjBuy = Math.round(buy * (1 + half) * 100) / 100;
      const adjSell = Math.round(sell * (1 - half) * 100) / 100;
      return (adjSell - adjBuy) * units * mult;
    }
    return raw * (1 - 2 * half) * mult;
  }

  function computeMetricsAndSeries(trades, baselineYmd, capital, baseCapital, slipOn, slipPct) {
    const mult = baseCapital > 0 ? capital / baseCapital : 1;
    const equityPoints = [{ date: formatDDMMMYYYY(baselineYmd), equity: capital }];

    let runningPnl = 0;
    let wins = 0;
    let losses = 0;
    let winRun = 0;
    let lossRun = 0;
    let maxWin = 0;
    let maxLoss = 0;

    for (let i = 0; i < trades.length; i++) {
      const t = trades[i];
      const pnl = effectiveTradePnl(t, mult, slipOn, slipPct);
      runningPnl += pnl;
      equityPoints.push({
        date: formatDDMMMYYYY(t.date),
        equity: Number((capital + runningPnl).toFixed(2)),
      });
      if (pnl >= 0) {
        wins++;
        winRun++;
        lossRun = 0;
        if (winRun > maxWin) maxWin = winRun;
      } else {
        losses++;
        lossRun++;
        winRun = 0;
        if (lossRun > maxLoss) maxLoss = lossRun;
      }
    }

    let peak = capital;
    let minDD = 0;
    const ddPoints = [];
    for (let i = 0; i < equityPoints.length; i++) {
      const eq = equityPoints[i].equity;
      if (eq > peak) peak = eq;
      const dd = Number((eq - peak).toFixed(2));
      if (dd < minDD) minDD = dd;
      ddPoints.push({ date: equityPoints[i].date, drawdown: dd });
    }

    const totalCount = wins + losses;
    const winRatio = totalCount > 0 ? (wins / totalCount) * 100 : 0;
    const returnPct = capital > 0 ? (runningPnl / capital) * 100 : 0;

    return {
      mult,
      pnl: runningPnl,
      returnPct,
      minDD,
      winRatio,
      maxWin,
      maxLoss,
      totalCount,
      equityPoints,
      ddPoints,
    };
  }

  function loadInitialDataset() {
    if (window.IWSMAlgoResultsData && Array.isArray(window.IWSMAlgoResultsData.trades) && window.IWSMAlgoResultsData.trades.length) {
      return Promise.resolve(window.IWSMAlgoResultsData);
    }
    return fetch('assets/strategy-results/sensex-option-buying.json').then((r) => {
      if (!r.ok) throw new Error('Failed to load strategy dataset');
      return r.json();
    });
  }

  function mountApp(initialData) {
    let data = initialData;
    const baseCapital = Number(data.capital) || 18000;
    const firstDate = data.trades[0].date;
    let lastDate = data.trades[data.trades.length - 1].date;

    const state = {
      capital: baseCapital,
      period: 'overall',
      rangeFrom: firstDate,
      rangeTo: lastDate,
      btFrom: firstDate,
      btTo: lastDate,
      slippageOn: false,
      slippagePct: 0,
      page: 0,
    };

    const lotOptionsHtml = Array.from({ length: 20 }, (_, idx) => {
      const lots = idx + 1;
      const margin = lots * baseCapital;
      return `<option value="${margin}">${lots} Lot${lots > 1 ? 's' : ''} &nbsp;·&nbsp; REQ Margin ${formatCapitalCompact(margin)}</option>`;
    }).join('');

    const extArrowSvg = `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M7 17L17 7"/><path d="M8 7h9v9"/></svg>`;

    host.innerHTML = `
      <div class="ar-banner-shell">
        <div class="ar-banner-top">
          <div class="ar-strat-brand">
            <div class="ar-strat-icon" aria-hidden="true">
              <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round">
                <line x1="8" y1="3" x2="8" y2="21"/><rect x="5.5" y="7" width="5" height="7" rx="1.2" fill="currentColor"/>
                <line x1="16" y1="3" x2="16" y2="21"/><rect x="13.5" y="10" width="5" height="7" rx="1.2" fill="currentColor"/>
              </svg>
            </div>
            <div class="ar-strat-titles">
              <h3 id="ar-strat-title">${esc(data.strategyName || 'SENSEX Option Buying')}</h3>
              <p id="ar-strat-subtitle">${esc(data.subtitle || 'Option buying scalping strategy')}</p>
            </div>
          </div>
          <a class="ar-free-algo-btn ar-free-algo-header" href="${FREE_ALGO_URL}" target="_blank" rel="noopener noreferrer sponsored">
            <span>Get Your Free Algo</span>
            ${extArrowSvg}
          </a>
        </div>

        <div class="ar-top-strip" role="region" aria-label="Strategy capital and headline performance">
          <div class="ar-top-item">
            <span class="ar-top-label">Capital to Invest</span>
            <strong class="ar-top-value" id="ar-top-capital">${formatCapitalCompact(baseCapital)}</strong>
            <div class="ar-cap-stepper" aria-label="Adjust investment capital">
              <button type="button" class="ar-cap-btn" id="ar-cap-dec" aria-label="Decrease capital by 1 lot">−</button>
              <div class="ar-cap-input-wrap">
                <span class="ar-cap-prefix">₹</span>
                <input type="number" id="ar-cap-input" min="${baseCapital}" max="${baseCapital * 100}" step="${baseCapital}" value="${baseCapital}" aria-label="Investment capital in rupees">
              </div>
              <button type="button" class="ar-cap-btn" id="ar-cap-inc" aria-label="Increase capital by 1 lot">+</button>
              <span class="ar-cap-lots-badge" id="ar-cap-lots-badge">1 Lot</span>
            </div>
          </div>
          <div class="ar-top-item">
            <span class="ar-top-label">Win Rate</span>
            <strong class="ar-top-value" id="ar-top-winrate">60.12%</strong>
          </div>
          <div class="ar-top-item">
            <span class="ar-top-label">Net profit</span>
            <strong class="ar-top-value is-pos" id="ar-top-netprofit">+₹1,05,054.00</strong>
          </div>
          <div class="ar-top-item">
            <span class="ar-top-label">Longest win streak</span>
            <strong class="ar-top-value" id="ar-top-winstreak">12</strong>
          </div>
          <div class="ar-top-item">
            <span class="ar-top-label">Longest losing streak</span>
            <strong class="ar-top-value" id="ar-top-lossstreak">5</strong>
          </div>
        </div>
      </div>

      <div class="ar-overview-grid">
        <div class="ar-about-panel">
          <h4>About the strategy</h4>
          <p class="ar-about-lead">
            This is our <strong>Momentum Catcher Strategy for SENSEX Options</strong>, tailored for traders looking to ride quick intraday moves right from market open. The strategy is designed to detect early momentum in At-the-Money (ATM) options and capture a short, sharp move in either direction.
          </p>
          <h5>Key points for this strategy</h5>
          <ul class="ar-keypoints">
            <li><strong>Intraday momentum strategy</strong> built for <strong>SENSEX Options</strong>, focused on <strong>early market movement</strong>.</li>
            <li>Enters into the <strong>ATM Call or Put option</strong> that first moves high from its opening level.</li>
            <li>Designed for <strong>quick entries and exits</strong>, with <strong>no re-entries</strong> allowed after the first trade.</li>
            <li>Stop-loss is set at <strong>40 points below entry</strong> to limit downside risk.</li>
            <li>
              Multiple exit conditions:
              <ul>
                <li>Exit if target is achieved or</li>
                <li>Exit at <strong>12:00 PM</strong>, whichever comes first.</li>
              </ul>
            </li>
            <li>Ideal for traders who want to <strong>capitalize on quick, high-probability scalps</strong> at the start of the day.</li>
          </ul>
          <blockquote class="ar-disclaimer-quote">
            <strong>Disclaimer:</strong> This strategy is built on historical data and tested logic; however, past performance is not indicative of future results. All trading decisions are the user’s responsibility, and profits are not guaranteed. Please trade with discipline and proper risk management.
          </blockquote>
        </div>

        <div class="ar-side-col">
          <div class="ar-specs-card">
            <div class="ar-specs-grid">
              <div class="ar-spec-cell">
                <span>Min amount</span>
                <strong id="ar-spec-min">${formatCapitalCompact(baseCapital)}</strong>
              </div>
              <div class="ar-spec-cell">
                <span>Max drawdown</span>
                <strong id="ar-spec-dd">${Number(data.reportedDrawdownPercent || 24.2)}%</strong>
              </div>
              <div class="ar-spec-cell">
                <span>Backtest period</span>
                <strong id="ar-spec-period">${esc(data.backtestPeriodLabel || '2 years 10 months 20 days')}</strong>
              </div>
              <div class="ar-spec-cell">
                <span>Risk type</span>
                <strong id="ar-spec-risk">${esc(data.riskType || 'Medium')}</strong>
              </div>
            </div>
            <a class="ar-free-algo-btn ar-free-algo-primary" href="${FREE_ALGO_URL}" target="_blank" rel="noopener noreferrer sponsored">
              <span>Free Algo</span>
              ${extArrowSvg}
            </a>
            <p class="ar-specs-note">
              By activating this strategy you understand that trading involves risk and past performance is not a guarantee of future returns. Manually interfering with automated signals might affect live performance.
            </p>
          </div>

          <div class="ar-backtest-card">
            <h4>Want to backtest before subscribing?</h4>
            <div class="ar-bt-field">
              <label class="ar-bt-label" for="ar-lot-select">Lot size</label>
              <select id="ar-lot-select" class="ar-bt-select">
                ${lotOptionsHtml}
              </select>
            </div>
            <div class="ar-bt-date-row">
              <span>Date range</span>
              <button type="button" class="ar-bt-date-toggle" id="ar-bt-date-toggle" aria-expanded="false">
                <span id="ar-bt-date-label">${esc(formatRangeButtonLabel(firstDate, lastDate))}</span>
                <span aria-hidden="true">▾</span>
              </button>
            </div>
            <div class="ar-bt-dates-grid" id="ar-bt-dates-grid" hidden>
              <label>Start date<input type="date" id="ar-bt-from" class="ar-bt-input" value="${firstDate}" min="${firstDate}" max="${lastDate}"></label>
              <label>End date<input type="date" id="ar-bt-to" class="ar-bt-input" value="${lastDate}" min="${firstDate}" max="${lastDate}"></label>
            </div>
            <div class="ar-slippage-box">
              <input type="number" id="ar-slippage-input" placeholder="Slippage" min="0" max="5" step="0.05" aria-label="Slippage percentage">
              <input type="checkbox" id="ar-slippage-check" aria-label="Apply slippage deduction">
              <span class="ar-slippage-unit">%</span>
            </div>
            <div class="ar-bt-actions">
              <button type="button" class="ar-backtest-btn" id="ar-backtest-btn">Backtest now!</button>
              <button type="button" class="ar-reset-btn" id="ar-reset-btn" hidden>Reset</button>
            </div>
          </div>
        </div>
      </div>

      <div class="ar-graphs-card" id="ar-graphs-card">
        <div class="ar-graphs-head">
          <h4>Equity curve <i class="ar-info-dot" title="Cumulative capital + closed-trade P&L across the selected period">i</i></h4>
          <span class="ar-active-window" id="ar-active-window"></span>
        </div>

        <div class="ar-period-pills" role="group" aria-label="Equity curve period">
          <button type="button" data-period="overall" aria-pressed="true">Overall</button>
          <button type="button" data-period="monthly" aria-pressed="false">Monthly</button>
          <button type="button" data-period="weekly" aria-pressed="false">Weekly</button>
          <button type="button" data-period="today" aria-pressed="false">Today</button>
          <button type="button" data-period="range" aria-pressed="false">Range</button>
        </div>

        <div class="ar-range-bar" id="ar-range-bar" hidden>
          <label>Start date<input type="date" id="ar-range-from" value="${firstDate}" min="${firstDate}" max="${lastDate}"></label>
          <label>End date<input type="date" id="ar-range-to" value="${lastDate}" min="${firstDate}" max="${lastDate}"></label>
          <button type="button" class="ar-range-apply-btn" id="ar-range-apply">Apply</button>
          <span class="ar-range-msg" id="ar-range-msg" role="status"></span>
        </div>

        <div class="ar-curve-kpis" id="ar-curve-kpis">
          <div class="ar-kpi-box"><span>P&amp;L</span><strong id="ar-kpi-pnl" class="is-pos">+₹1,05,054.00</strong></div>
          <div class="ar-kpi-box"><span>Return %</span><strong id="ar-kpi-return" class="is-pos">+583.63%</strong></div>
          <div class="ar-kpi-box"><span>Drawdown</span><strong id="ar-kpi-dd">-₹7,442.00</strong></div>
          <div class="ar-kpi-box"><span>Winning Ratio</span><strong id="ar-kpi-winratio">60.12%</strong></div>
          <div class="ar-kpi-box"><span>Longest Winning Streak</span><strong id="ar-kpi-winstreak">12</strong></div>
          <div class="ar-kpi-box"><span>Longest Losing Streak</span><strong id="ar-kpi-lossstreak">5</strong></div>
        </div>

        <div class="ar-empty-state" id="ar-empty-state" hidden role="status"></div>

        <div id="ar-charts-stage">
          <div class="ar-canvas-box ar-canvas-equity">
            <canvas id="ar-equity-canvas" aria-label="Equity curve chart" role="img"></canvas>
          </div>

          <div class="ar-dd-head">
            <h4>Drawdown <i class="ar-info-dot" title="Peak-to-trough decline from the highest cumulative equity reached in the period">i</i></h4>
          </div>
          <div class="ar-canvas-box ar-canvas-dd">
            <canvas id="ar-dd-canvas" aria-label="Drawdown chart" role="img"></canvas>
          </div>
        </div>
      </div>

      <div class="ar-risk-note">
        <strong>Note:</strong> These results are indicative only and do not guarantee future performance. Trading and investment in financial markets are subject to market risks, and actual results may vary due to market conditions, volatility, liquidity, execution prices, slippages, and other factors. Users should carefully consider these risks before making any trading decisions.
      </div>

      <details class="ar-trades-details">
        <summary>
          <span>Closed Trade Log (<span id="ar-trade-count">${data.trades.length}</span> trades in period)</span>
          <a class="ar-csv-link" href="assets/strategy-results/sensex-option-buying.csv" download onclick="event.stopPropagation()">Download Full CSV ↓</a>
        </summary>
        <div class="ar-table-scroll">
          <table>
            <thead>
              <tr>
                <th>Date</th>
                <th>Entry (IST)</th>
                <th>Exit (IST)</th>
                <th>Contract</th>
                <th>Entry Price</th>
                <th>Exit Price</th>
                <th>Trade P&amp;L</th>
                <th>Brokerage</th>
              </tr>
            </thead>
            <tbody id="ar-trades-tbody"></tbody>
          </table>
        </div>
        <div class="ar-pagination">
          <span id="ar-page-info">Page 1</span>
          <div class="ar-page-btns">
            <button type="button" id="ar-prev-btn">Previous</button>
            <button type="button" id="ar-next-btn">Next</button>
          </div>
        </div>
      </details>
    `;

    const q = (id) => host.querySelector('#' + id);
    let equityChart = null;
    let ddChart = null;
    let filteredTrades = [];

    function getThemeColors() {
      const isLight = document.documentElement.dataset.theme === 'light';
      return {
        equityLine: isLight ? '#0038FF' : '#3B82F6',
        ddLine: '#EF4444',
        ddFill: isLight ? 'rgba(239, 68, 68, 0.15)' : 'rgba(239, 68, 68, 0.18)',
        grid: isLight ? 'rgba(15, 23, 42, 0.07)' : 'rgba(148, 163, 184, 0.11)',
        ticks: isLight ? '#64748B' : '#94A3B8',
        tooltipBg: isLight ? '#0F172A' : '#020617',
        tooltipBorder: isLight ? 'rgba(148, 163, 184, 0.25)' : 'rgba(104, 168, 255, 0.35)',
      };
    }

    function resolvePeriodBounds() {
      lastDate = data.trades[data.trades.length - 1].date;
      if (state.period === 'overall') {
        return { from: firstDate, to: lastDate, baseline: firstDate };
      }
      if (state.period === 'monthly') {
        const monthStart = lastDate.slice(0, 7) + '-01';
        return { from: monthStart, to: lastDate, baseline: monthStart };
      }
      if (state.period === 'weekly') {
        const mon = mondayOfDateStr(lastDate);
        return { from: mon, to: lastDate, baseline: mon };
      }
      if (state.period === 'today') {
        return { from: lastDate, to: lastDate, baseline: lastDate };
      }
      return { from: state.rangeFrom, to: state.rangeTo, baseline: state.rangeFrom };
    }

    function syncCapitalControls() {
      const cap = state.capital;
      const lots = cap / baseCapital;
      q('ar-top-capital').textContent = formatCapitalCompact(cap);
      if (document.activeElement !== q('ar-cap-input')) {
        q('ar-cap-input').value = String(cap);
      }
      q('ar-cap-dec').disabled = cap <= baseCapital;
      q('ar-cap-lots-badge').textContent = Number.isInteger(lots)
        ? `${lots} Lot${lots > 1 ? 's' : ''}`
        : `${lots.toFixed(2)}x`;

      const sel = q('ar-lot-select');
      const existingCustom = sel.querySelector('option[data-custom="1"]');
      if ([...sel.options].some((o) => !o.dataset.custom && Number(o.value) === cap)) {
        if (existingCustom) existingCustom.remove();
        sel.value = String(cap);
      } else {
        const opt = existingCustom || document.createElement('option');
        opt.dataset.custom = '1';
        opt.value = String(cap);
        opt.textContent = `Custom Capital · ${formatCapitalCompact(cap)} (${lots.toFixed(2)}x)`;
        if (!existingCustom) sel.prepend(opt);
        sel.value = String(cap);
      }

      const isModified =
        state.capital !== baseCapital ||
        state.slippageOn ||
        state.period === 'range' ||
        state.btFrom !== firstDate ||
        state.btTo !== lastDate;
      q('ar-reset-btn').hidden = !isModified;
    }

    function renderCharts(series) {
      const theme = getThemeColors();
      const labels = series.equityPoints.map((p) => p.date);
      const eqValues = series.equityPoints.map((p) => p.equity);
      const ddValues = series.ddPoints.map((p) => p.drawdown);
      const ddMinBound =
        series.minDD < 0 ? Number((series.minDD * 1.1).toFixed(2)) : -100 * Math.max(1, series.mult);

      if (typeof window.Chart !== 'function') {
        // Resilient SVG fallback if Chart.js script is unavailable
        const eqBox = host.querySelector('.ar-canvas-equity');
        const minV = Math.min(...eqValues);
        const maxV = Math.max(...eqValues);
        const span = maxV - minV || 1;
        const pts = eqValues
          .map((v, i) => `${(i / Math.max(1, eqValues.length - 1)) * 960 + 20},${200 - ((v - minV) / span) * 170}`)
          .join(' L');
        eqBox.innerHTML = `<svg viewBox="0 0 1000 220" width="100%" height="100%"><path d="M${pts}" fill="none" stroke="${theme.equityLine}" stroke-width="2.2"/></svg>`;
        return;
      }

      const equityCanvas = q('ar-equity-canvas');
      const ddCanvas = q('ar-dd-canvas');

      const eqTickCallback = (val) => {
        const n = Number(val);
        const sign = n < 0 ? '-' : '';
        const abs = Math.abs(n);
        if (abs === 0) return '₹0';
        if (abs >= 1e7) return sign + '₹' + (abs / 1e7).toFixed(2) + 'Cr';
        if (abs >= 1e5) return sign + '₹' + (abs / 1e5).toFixed(1) + 'L';
        if (abs >= 1e3) {
          return sign + '₹' + (abs % 1000 === 0 ? (abs / 1e3).toFixed(0) : (abs / 1e3).toFixed(1)) + 'k';
        }
        return sign + '₹' + abs.toFixed(0);
      };

      const ddTickCallback = (val) => {
        const n = Number(val);
        return (
          (n < 0 ? '-' : '') +
          '₹' +
          Math.abs(n).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
        );
      };

      if (!equityChart) {
        equityChart = new window.Chart(equityCanvas.getContext('2d'), {
          type: 'line',
          data: {
            labels,
            datasets: [
              {
                label: 'Equity',
                data: eqValues,
                borderColor: theme.equityLine,
                backgroundColor: 'transparent',
                borderWidth: 2,
                fill: false,
                pointRadius: eqValues.length <= 4 ? 3 : 0,
                pointHoverRadius: 4.5,
                pointHoverBackgroundColor: theme.equityLine,
                cubicInterpolationMode: 'monotone',
                tension: 0.35,
              },
            ],
          },
          options: {
            responsive: true,
            maintainAspectRatio: false,
            animation: { duration: 240 },
            interaction: { intersect: false, mode: 'index' },
            plugins: {
              legend: { display: false },
              tooltip: {
                backgroundColor: theme.tooltipBg,
                borderColor: theme.tooltipBorder,
                borderWidth: 1,
                titleColor: '#F8FAFC',
                bodyColor: '#F8FAFC',
                padding: 10,
                displayColors: false,
                callbacks: {
                  title: (items) => (items[0] ? items[0].label : ''),
                  label: (ctx) => formatINR(ctx.parsed.y, 2, false),
                },
              },
            },
            scales: {
              x: {
                grid: { display: false },
                border: { color: theme.grid },
                ticks: {
                  color: theme.ticks,
                  font: { size: 11 },
                  autoSkip: true,
                  autoSkipPadding: 16,
                  maxTicksLimit: 16,
                  maxRotation: 0,
                },
              },
              y: {
                beginAtZero: state.period === 'overall',
                grid: { color: theme.grid },
                border: { display: false },
                ticks: {
                  color: theme.ticks,
                  font: { size: 11 },
                  callback: eqTickCallback,
                },
              },
            },
          },
        });
      } else {
        equityChart.data.labels = labels;
        equityChart.data.datasets[0].data = eqValues;
        equityChart.data.datasets[0].borderColor = theme.equityLine;
        equityChart.data.datasets[0].pointHoverBackgroundColor = theme.equityLine;
        equityChart.data.datasets[0].pointRadius = eqValues.length <= 4 ? 3 : 0;
        equityChart.options.scales.y.beginAtZero = state.period === 'overall';
        equityChart.options.scales.y.grid.color = theme.grid;
        equityChart.options.scales.y.ticks.color = theme.ticks;
        equityChart.options.scales.x.border.color = theme.grid;
        equityChart.options.scales.x.ticks.color = theme.ticks;
        equityChart.options.plugins.tooltip.backgroundColor = theme.tooltipBg;
        equityChart.options.plugins.tooltip.borderColor = theme.tooltipBorder;
        equityChart.update('none');
      }

      if (!ddChart) {
        ddChart = new window.Chart(ddCanvas.getContext('2d'), {
          type: 'line',
          data: {
            labels,
            datasets: [
              {
                label: 'Drawdown',
                data: ddValues,
                borderColor: theme.ddLine,
                borderWidth: 1.85,
                fill: {
                  target: { value: 0 },
                  above: 'transparent',
                  below: theme.ddFill,
                },
                pointRadius: ddValues.length <= 4 ? 3 : 0,
                pointHoverRadius: 4.5,
                pointHoverBackgroundColor: theme.ddLine,
                cubicInterpolationMode: 'monotone',
                tension: 0.35,
              },
            ],
          },
          options: {
            responsive: true,
            maintainAspectRatio: false,
            animation: { duration: 240 },
            interaction: { intersect: false, mode: 'index' },
            plugins: {
              legend: { display: false },
              tooltip: {
                backgroundColor: theme.tooltipBg,
                borderColor: theme.tooltipBorder,
                borderWidth: 1,
                titleColor: '#F8FAFC',
                bodyColor: '#FCA5A5',
                padding: 10,
                displayColors: false,
                callbacks: {
                  title: (items) => (items[0] ? items[0].label : ''),
                  label: (ctx) => {
                    const abs = Math.abs(Number(ctx.parsed.y) || 0);
                    return abs === 0
                      ? 'At peak (no drawdown)'
                      : formatINR(abs, 2, false) + ' below peak';
                  },
                },
              },
            },
            scales: {
              x: {
                grid: { display: false },
                border: { color: theme.grid },
                ticks: {
                  color: theme.ticks,
                  font: { size: 11 },
                  autoSkip: true,
                  autoSkipPadding: 16,
                  maxTicksLimit: 16,
                  maxRotation: 0,
                },
              },
              y: {
                max: 0,
                min: ddMinBound,
                grid: { color: theme.grid },
                border: { display: false },
                ticks: {
                  color: theme.ticks,
                  font: { size: 11 },
                  maxTicksLimit: 6,
                  callback: ddTickCallback,
                },
              },
            },
          },
        });
      } else {
        ddChart.data.labels = labels;
        ddChart.data.datasets[0].data = ddValues;
        ddChart.data.datasets[0].fill.below = theme.ddFill;
        ddChart.data.datasets[0].pointRadius = ddValues.length <= 4 ? 3 : 0;
        ddChart.options.scales.y.min = ddMinBound;
        ddChart.options.scales.y.grid.color = theme.grid;
        ddChart.options.scales.y.ticks.color = theme.ticks;
        ddChart.options.scales.x.border.color = theme.grid;
        ddChart.options.scales.x.ticks.color = theme.ticks;
        ddChart.options.plugins.tooltip.backgroundColor = theme.tooltipBg;
        ddChart.options.plugins.tooltip.borderColor = theme.tooltipBorder;
        ddChart.update('none');
      }
    }

    function renderTradeTable() {
      const mult = state.capital / baseCapital;
      const reversed = filteredTrades.slice().reverse();
      const totalPages = Math.max(1, Math.ceil(reversed.length / PAGE_SIZE));
      if (state.page >= totalPages) state.page = totalPages - 1;
      if (state.page < 0) state.page = 0;

      const rows = reversed.slice(state.page * PAGE_SIZE, (state.page + 1) * PAGE_SIZE);
      q('ar-trade-count').textContent = String(filteredTrades.length);
      q('ar-trades-tbody').innerHTML = rows.length
        ? rows
            .map((t) => {
              const pnl = effectiveTradePnl(t, mult, state.slippageOn, state.slippagePct);
              const cls = pnl >= 0 ? 'ar-td-pos' : 'ar-td-neg';
              return `<tr>
                <td>${esc(formatDDMMMYYYY(t.date))}</td>
                <td>${esc(formatTimeIST(t.entryTime))}</td>
                <td>${esc(formatTimeIST(t.exitTime))}</td>
                <td>${esc(t.instrument)}</td>
                <td>${formatINR(t.buy, 2)}</td>
                <td>${formatINR(t.sell, 2)}</td>
                <td class="${cls}">${formatINR(pnl, 2, true)}</td>
                <td>${formatINR((Number(t.brokerage) || 0) * mult, 2)}</td>
              </tr>`;
            })
            .join('')
        : '<tr><td colspan="8">No closed trades in the selected date window.</td></tr>';

      q('ar-page-info').textContent = `Page ${state.page + 1} of ${totalPages} (${filteredTrades.length} trades)`;
      q('ar-prev-btn').disabled = state.page === 0;
      q('ar-next-btn').disabled = state.page + 1 >= totalPages;
    }

    function render() {
      syncCapitalControls();

      // 1. Headline Top Strip (strategy overall scaled to chosen Capital & Slippage)
      const overallSummary = computeMetricsAndSeries(
        data.trades,
        firstDate,
        state.capital,
        baseCapital,
        state.slippageOn,
        state.slippagePct
      );

      const topNp = q('ar-top-netprofit');
      topNp.textContent = formatINR(overallSummary.pnl, 2, true);
      topNp.className = 'ar-top-value ' + (overallSummary.pnl >= 0 ? 'is-pos' : 'is-neg');
      q('ar-top-winrate').textContent = overallSummary.winRatio.toFixed(2) + '%';
      q('ar-top-winstreak').textContent = String(overallSummary.maxWin);
      q('ar-top-lossstreak').textContent = String(overallSummary.maxLoss);

      // 2. Active Period Filter
      const bounds = resolvePeriodBounds();
      filteredTrades = data.trades.filter((t) => t.date >= bounds.from && t.date <= bounds.to);

      host.querySelectorAll('.ar-period-pills button').forEach((btn) => {
        btn.setAttribute('aria-pressed', String(btn.dataset.period === state.period));
      });
      q('ar-range-bar').hidden = state.period !== 'range';

      const windowText =
        bounds.from === bounds.to
          ? `${formatDDMMMYYYY(bounds.from)} · ${filteredTrades.length} trade${filteredTrades.length === 1 ? '' : 's'}`
          : `${formatDDMMMYYYY(bounds.from)} – ${formatDDMMMYYYY(bounds.to)} · ${filteredTrades.length} trades`;
      q('ar-active-window').textContent =
        windowText + (state.slippageOn && state.slippagePct > 0 ? ` · ${state.slippagePct}% slippage` : '');

      const periodSeries = computeMetricsAndSeries(
        filteredTrades,
        bounds.baseline,
        state.capital,
        baseCapital,
        state.slippageOn,
        state.slippagePct
      );

      // 3. 6-Column Curve KPIs
      const kpiPnl = q('ar-kpi-pnl');
      kpiPnl.textContent = formatINR(periodSeries.pnl, 2, true);
      kpiPnl.className = periodSeries.pnl >= 0 ? 'is-pos' : 'is-neg';

      const kpiRet = q('ar-kpi-return');
      kpiRet.textContent = (periodSeries.returnPct >= 0 ? '+' : '') + periodSeries.returnPct.toFixed(2) + '%';
      kpiRet.className = periodSeries.returnPct >= 0 ? 'is-pos' : 'is-neg';

      q('ar-kpi-dd').textContent =
        periodSeries.minDD === 0 ? '₹0.00' : formatINR(periodSeries.minDD, 2, false);
      q('ar-kpi-winratio').textContent = filteredTrades.length ? periodSeries.winRatio.toFixed(2) + '%' : '0.00%';
      q('ar-kpi-winstreak').textContent = String(periodSeries.maxWin);
      q('ar-kpi-lossstreak').textContent = String(periodSeries.maxLoss);

      // 4. Charts or Empty State
      if (!filteredTrades.length) {
        q('ar-empty-state').hidden = false;
        q('ar-empty-state').textContent = `No closed trades recorded between ${formatDDMMMYYYY(bounds.from)} and ${formatDDMMMYYYY(bounds.to)}. Choose dates within ${formatDDMMMYYYY(firstDate)} – ${formatDDMMMYYYY(lastDate)}.`;
        q('ar-charts-stage').hidden = true;
      } else {
        q('ar-empty-state').hidden = true;
        q('ar-charts-stage').hidden = false;
        renderCharts(periodSeries);
      }

      renderTradeTable();
    }

    // Event bindings — Top Capital Stepper & Input
    q('ar-cap-dec').addEventListener('click', () => {
      state.capital = Math.max(baseCapital, Math.round((state.capital - baseCapital) / baseCapital) * baseCapital);
      render();
    });

    q('ar-cap-inc').addEventListener('click', () => {
      state.capital = Math.min(baseCapital * 100, Math.round((state.capital + baseCapital) / baseCapital) * baseCapital);
      render();
    });

    q('ar-cap-input').addEventListener('change', () => {
      const raw = Number(q('ar-cap-input').value);
      state.capital = Number.isFinite(raw) ? Math.max(baseCapital, Math.min(baseCapital * 100, Math.round(raw))) : baseCapital;
      q('ar-cap-input').value = String(state.capital);
      render();
    });

    q('ar-cap-input').addEventListener('input', () => {
      const raw = Number(q('ar-cap-input').value);
      if (Number.isFinite(raw) && raw >= baseCapital && raw <= baseCapital * 100) {
        state.capital = Math.round(raw);
        render();
      }
    });

    // Right-Hand Backtest Controls
    q('ar-lot-select').addEventListener('change', () => {
      const val = Number(q('ar-lot-select').value);
      if (Number.isFinite(val) && val >= baseCapital) {
        state.capital = val;
        render();
      }
    });

    q('ar-bt-date-toggle').addEventListener('click', () => {
      const grid = q('ar-bt-dates-grid');
      const nextOpen = grid.hidden;
      grid.hidden = !nextOpen;
      q('ar-bt-date-toggle').setAttribute('aria-expanded', String(nextOpen));
    });

    ['ar-bt-from', 'ar-bt-to'].forEach((id) => {
      q(id).addEventListener('change', () => {
        const f = q('ar-bt-from').value || firstDate;
        const t = q('ar-bt-to').value || lastDate;
        state.btFrom = f <= t ? f : t;
        state.btTo = f <= t ? t : f;
        q('ar-bt-date-label').textContent = formatRangeButtonLabel(state.btFrom, state.btTo);
      });
    });

    q('ar-slippage-input').addEventListener('input', () => {
      const v = Number(q('ar-slippage-input').value);
      if (v > 0 && !q('ar-slippage-check').checked) {
        q('ar-slippage-check').checked = true;
      }
    });

    q('ar-backtest-btn').addEventListener('click', () => {
      const slipVal = Math.max(0, Math.min(5, Number(q('ar-slippage-input').value) || 0));
      state.slippagePct = slipVal;
      state.slippageOn = q('ar-slippage-check').checked && slipVal > 0;

      if (state.btFrom !== firstDate || state.btTo !== lastDate) {
        state.period = 'range';
        state.rangeFrom = state.btFrom;
        state.rangeTo = state.btTo;
        q('ar-range-from').value = state.btFrom;
        q('ar-range-to').value = state.btTo;
      }
      state.page = 0;
      render();
    });

    q('ar-reset-btn').addEventListener('click', () => {
      state.capital = baseCapital;
      state.period = 'overall';
      state.rangeFrom = firstDate;
      state.rangeTo = lastDate;
      state.btFrom = firstDate;
      state.btTo = lastDate;
      state.slippageOn = false;
      state.slippagePct = 0;
      state.page = 0;
      q('ar-slippage-input').value = '';
      q('ar-slippage-check').checked = false;
      q('ar-bt-from').value = firstDate;
      q('ar-bt-to').value = lastDate;
      q('ar-range-from').value = firstDate;
      q('ar-range-to').value = lastDate;
      q('ar-bt-date-label').textContent = formatRangeButtonLabel(firstDate, lastDate);
      q('ar-range-msg').textContent = '';
      render();
    });

    // Period Pill Buttons
    host.querySelectorAll('.ar-period-pills button').forEach((btn) => {
      btn.addEventListener('click', () => {
        const p = btn.dataset.period;
        state.period = p;
        state.page = 0;
        q('ar-range-msg').textContent = '';
        if (p === 'range') {
          q('ar-range-bar').hidden = false;
          q('ar-range-from').value = state.rangeFrom;
          q('ar-range-to').value = state.rangeTo;
        }
        render();
      });
    });

    q('ar-range-apply').addEventListener('click', () => {
      const f = q('ar-range-from').value;
      const t = q('ar-range-to').value;
      if (!f || !t || f > t) {
        q('ar-range-msg').textContent = 'Start date must be on or before End date.';
        return;
      }
      q('ar-range-msg').textContent = '';
      state.rangeFrom = f;
      state.rangeTo = t;
      state.btFrom = f;
      state.btTo = t;
      q('ar-bt-from').value = f;
      q('ar-bt-to').value = t;
      q('ar-bt-date-label').textContent = formatRangeButtonLabel(f, t);
      state.page = 0;
      render();
    });

    // Pagination
    q('ar-prev-btn').addEventListener('click', () => {
      state.page = Math.max(0, state.page - 1);
      renderTradeTable();
    });
    q('ar-next-btn').addEventListener('click', () => {
      state.page += 1;
      renderTradeTable();
    });

    // Live Theme Observer (Dark <-> Light)
    if (typeof MutationObserver === 'function') {
      const obs = new MutationObserver(() => render());
      obs.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
    }

    render();

    // Optional live sync via local backend proxy when running on local server (zero CORS issues)
    if (location.protocol.startsWith('http') && /^(127\.0\.0\.1|localhost)$/i.test(location.hostname)) {
      fetch('/api/algo-strategy')
        .then((r) => (r.ok ? r.json() : null))
        .then((fresh) => {
          if (fresh && Array.isArray(fresh.trades) && fresh.trades.length > data.trades.length) {
            data = fresh;
            lastDate = data.trades[data.trades.length - 1].date;
            if (state.rangeTo < lastDate && state.period !== 'range') state.rangeTo = lastDate;
            render();
          }
        })
        .catch(() => {});
    }
  }

  loadInitialDataset()
    .then(mountApp)
    .catch(() => {
      host.innerHTML =
        '<div class="ar-empty-state">Strategy performance feed is initializing. Please refresh the page.</div>';
    });
})();

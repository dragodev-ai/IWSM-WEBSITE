(function (root) {
  'use strict';

  const PREFS_KEY = 'iwsm_heatmap_prefs_v1';
  const WATCHLIST_KEY = 'iwsm_heatmap_watchlist_v1';

  const DEFAULT_PREFS = {
    universe: 'NIFTY 50',
    sizeBy: 'marketCap',
    colorBy: 'changePct',
    groupBy: 'sector',
    sortBy: 'default',
    showLogos: true,
    showLabels: true,
    showPct: true,
    showPrices: true,
    showCompanyName: false,
  };

  // Brand emblem colors for major Indian companies + deterministic sector fallback
  const BRAND_COLORS = {
    HDFCBANK: '#004c8f',
    ICICIBANK: '#b02a30',
    SBIN: '#280071',
    KOTAKBANK: '#ed1c24',
    AXISBANK: '#97144d',
    BAJFINANCE: '#0072bc',
    BAJAJFINSV: '#0072bc',
    RELIANCE: '#1c242b',
    TCS: '#2563eb',
    INFY: '#007cc3',
    HCLTECH: '#0066b3',
    WIPRO: '#3f1d7a',
    TECHM: '#c8102e',
    BHARTIARTL: '#e40000',
    ITC: '#004b87',
    HINDUNILVR: '#1f36c7',
    LT: '#0b4ea2',
    MARUTI: '#1d428a',
    'M&M': '#e31837',
    TATAMOTORS: '#1f5aa6',
    TATASTEEL: '#22559c',
    SUNPHARMA: '#f37021',
    TITAN: '#0e7490',
    ASIANPAINT: '#5b21b6',
    NTPC: '#0284c7',
    ONGC: '#7f1d1d',
    ADANIENT: '#4f46e5',
    ADANIPORTS: '#4f46e5',
    ETERNAL: '#e23744',
    ZOMATO: '#e23744',
    ULTRACEMCO: '#ca8a04',
    JSWSTEEL: '#1e3a8a',
  };

  const DIVERGING_BUCKETS = [
    { id: 0, label: '≤ -3%', min: -Infinity, max: -3.0, light: '#c92a2a', dark: '#b91c1c' },
    { id: 1, label: '-2%', min: -3.0, max: -1.5, light: '#e03e3e', dark: '#dc2626' },
    { id: 2, label: '-1%', min: -1.5, max: -0.35, light: '#ef7a7a', dark: '#991b1b' },
    { id: 3, label: '0%', min: -0.35, max: 0.35, light: '#c4c7cc', dark: '#273449', neutral: true },
    { id: 4, label: '+1%', min: 0.35, max: 1.5, light: '#44b77b', dark: '#15803d' },
    { id: 5, label: '+2%', min: 1.5, max: 3.0, light: '#159655', dark: '#16a34a' },
    { id: 6, label: '≥ +3%', min: 3.0, max: Infinity, light: '#0a6c3c', dark: '#065f46' },
  ];

  const WIDE_DIVERGING_BUCKETS = [
    { id: 0, label: '≤ -50%', min: -Infinity, max: -50, light: '#c92a2a', dark: '#b91c1c' },
    { id: 1, label: '-25%', min: -50, max: -20, light: '#e03e3e', dark: '#dc2626' },
    { id: 2, label: '-10%', min: -20, max: -5, light: '#ef7a7a', dark: '#991b1b' },
    { id: 3, label: '0%', min: -5, max: 5, light: '#c4c7cc', dark: '#273449', neutral: true },
    { id: 4, label: '+10%', min: 5, max: 20, light: '#44b77b', dark: '#15803d' },
    { id: 5, label: '+25%', min: 20, max: 50, light: '#159655', dark: '#16a34a' },
    { id: 6, label: '≥ +50%', min: 50, max: Infinity, light: '#0a6c3c', dark: '#065f46' },
  ];

  const RVOL_BUCKETS = [
    { id: 0, label: '< 0.4×', min: -Infinity, max: 0.4, light: '#94a3b8', dark: '#334155', neutral: true },
    { id: 1, label: '0.6×', min: 0.4, max: 0.75, light: '#64748b', dark: '#475569' },
    { id: 2, label: '1.0×', min: 0.75, max: 1.15, light: '#0284c7', dark: '#0369a1' },
    { id: 3, label: '1.5×', min: 1.15, max: 1.6, light: '#0d9488', dark: '#0f766e' },
    { id: 4, label: '2.0×', min: 1.6, max: 2.25, light: '#16a34a', dark: '#15803d' },
    { id: 5, label: '3.0×', min: 2.25, max: 3.5, light: '#15803d', dark: '#166534' },
    { id: 6, label: '≥ 3.5×', min: 3.5, max: Infinity, light: '#065f46', dark: '#064e3b' },
  ];

  const VOLATILITY_BUCKETS = [
    { id: 0, label: '< 15%', min: -Infinity, max: 15, light: '#64748b', dark: '#334155', neutral: true },
    { id: 1, label: '20%', min: 15, max: 22, light: '#0284c7', dark: '#0369a1' },
    { id: 2, label: '28%', min: 22, max: 30, light: '#0d9488', dark: '#0f766e' },
    { id: 3, label: '35%', min: 30, max: 38, light: '#d97706', dark: '#b45309' },
    { id: 4, label: '45%', min: 38, max: 48, light: '#ea580c', dark: '#c2410c' },
    { id: 5, label: '60%', min: 48, max: 62, light: '#dc2626', dark: '#b91c1c' },
    { id: 6, label: '≥ 62%', min: 62, max: Infinity, light: '#991b1b', dark: '#7f1d1d' },
  ];

  const esc = v =>
    String(v ?? '').replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));

  const fmtInr = (v, d = 2) =>
    v == null || !Number.isFinite(Number(v))
      ? '—'
      : '₹' + Number(v).toLocaleString('en-IN', { minimumFractionDigits: d, maximumFractionDigits: d });

  const fmtInt = v =>
    v == null || !Number.isFinite(Number(v)) ? '—' : Math.round(Number(v)).toLocaleString('en-IN');

  const fmtCompactCr = inr => {
    if (inr == null || !Number.isFinite(Number(inr))) return '—';
    const cr = Number(inr) / 1e7;
    if (cr >= 100000) return '₹' + (cr / 100000).toFixed(2) + 'L Cr';
    if (cr >= 1000) return '₹' + cr.toLocaleString('en-IN', { maximumFractionDigits: 0 }) + ' Cr';
    return '₹' + cr.toFixed(2) + ' Cr';
  };

  const fmtSignedPct = v => {
    if (v == null || !Number.isFinite(Number(v))) return '—';
    const n = Number(v);
    return (n > 0 ? '+' : '') + n.toFixed(2) + '%';
  };

  function avatarColor(symbol) {
    if (BRAND_COLORS[symbol]) return BRAND_COLORS[symbol];
    let h = 0;
    for (let i = 0; i < symbol.length; i++) h = (h * 31 + symbol.charCodeAt(i)) >>> 0;
    const palette = ['#1d4ed8', '#0f766e', '#7c3aed', '#b45309', '#be123c', '#0369a1', '#4338ca', '#15803d'];
    return palette[h % palette.length];
  }

  function loadPrefs() {
    try {
      const saved = JSON.parse(localStorage.getItem(PREFS_KEY) || '{}');
      return { ...DEFAULT_PREFS, ...(saved && typeof saved === 'object' ? saved : {}) };
    } catch {
      return { ...DEFAULT_PREFS };
    }
  }

  function savePrefs(prefs) {
    try {
      localStorage.setItem(PREFS_KEY, JSON.stringify(prefs));
    } catch {}
  }

  function loadWatchlist() {
    try {
      const arr = JSON.parse(localStorage.getItem(WATCHLIST_KEY) || '[]');
      return Array.isArray(arr) ? arr.filter(x => typeof x === 'string') : [];
    } catch {
      return [];
    }
  }

  function saveWatchlist(list) {
    try {
      localStorage.setItem(WATCHLIST_KEY, JSON.stringify([...new Set(list)].slice(0, 40)));
    } catch {}
  }

  function getBucketsForMetric(metricId) {
    if (metricId === 'volumeChangePct') return WIDE_DIVERGING_BUCKETS;
    if (metricId === 'relativeVolume') return RVOL_BUCKETS;
    if (metricId === 'volatility') return VOLATILITY_BUCKETS;
    return DIVERGING_BUCKETS;
  }

  function resolveBucket(metricId, val) {
    const buckets = getBucketsForMetric(metricId);
    if (val == null || !Number.isFinite(Number(val))) return buckets[3] || buckets[0];
    const n = Number(val);
    for (const b of buckets) {
      if (n >= b.min && n < b.max) return b;
    }
    return buckets[buckets.length - 1];
  }

  function formatMetricBadge(metricId, val) {
    if (val == null || !Number.isFinite(Number(val))) return 'N/A';
    const n = Number(val);
    if (metricId === 'relativeVolume') return n.toFixed(2) + '× RVol';
    if (metricId === 'volatility') return n.toFixed(1) + '% Vol';
    return (n > 0 ? '+' : '') + n.toFixed(2) + '%';
  }

  function isDarkTheme() {
    return document.documentElement.dataset.theme === 'dark';
  }

  function mountHeatmap(host) {
    if (!host) return;

    const isGithubPages = /\.github\.io$/i.test(root.location?.hostname || '');
    let prefs = loadPrefs();
    let watchlist = loadWatchlist();
    let universesList = [];
    let metricsManifest = null;
    let allUniverseSecurities = new Map(); // symbol -> quote record
    let currentStatus = null;
    let ws = null;
    let wsConnected = false;
    let reconnectTimer = null;
    let reconnectAttempt = 0;
    let pollTimer = null;
    let searchDebounce = null;
    let chart = null;
    let modalChart = null;
    let zoomedGroup = '';
    const hiddenBuckets = new Set();

    let filters = {
      search: '',
      symbol: '',
      companyName: '',
      sector: '',
      industry: '',
      exchange: '',
      minPrice: '',
      maxPrice: '',
      minChangePct: '',
      maxChangePct: '',
      direction: '',
      minMarketCapCr: '',
      maxMarketCapCr: '',
      minVolume: '',
      minTurnoverCr: '',
      minRelativeVolume: '',
      minPerf1d: '',
      minPerf1w: '',
      minPerf1m: '',
      preset: '',
    };

    host.innerHTML = `
      <div class="hm-shell" id="hm-shell">
        <div class="hm-topbar">
          <div class="hm-title-group">
            <h2 id="hm-heading">Stock Market Heatmap</h2>
            <span class="hm-feed-pill" id="hm-feed-pill" data-state="DISCONNECTED" role="status" aria-live="polite">
              <i class="hm-feed-dot"></i>
              <span id="hm-feed-text">Connecting to NSE market feed…</span>
            </span>
          </div>
          <div class="hm-meta-strip">
            <span id="hm-provider-meta">NSE Cash Market · Asia/Kolkata</span>
            <span class="hm-breadth" id="hm-breadth">
              <span>Showing <b id="hm-count-shown">0</b>/<b id="hm-count-total">0</b></span>
              <span class="adv">Adv <b id="hm-adv">0</b></span>
              <span class="dec">Dec <b id="hm-dec">0</b></span>
              <span>Unch <b id="hm-unch">0</b></span>
            </span>
          </div>
        </div>

        <div class="hm-controls-row" role="toolbar" aria-label="Heatmap configuration">
          <div class="hm-selectors">
            <label class="hm-field">
              <span>UNIVERSE</span>
              <select id="hm-universe" aria-label="Market or Stock Universe">
                <option value="NIFTY 50">NIFTY 50</option>
                <option value="NIFTY 100">NIFTY 100</option>
                <option value="NIFTY 200">NIFTY 200</option>
                <option value="NIFTY 500">NIFTY 500</option>
                <option value="NIFTY MIDCAP 50">NIFTY MIDCAP 50</option>
                <option value="NIFTY MIDCAP 100">NIFTY MIDCAP 100</option>
                <option value="NIFTY SMALLCAP 100">NIFTY SMALLCAP 100</option>
                <option value="NIFTY BANK">NIFTY BANK</option>
                <option value="NIFTY FINANCIAL SERVICES">NIFTY FINANCIAL SERVICES</option>
                <option value="NIFTY IT">NIFTY IT</option>
                <option value="NIFTY AUTO">NIFTY AUTO</option>
                <option value="NIFTY PHARMA">NIFTY PHARMA</option>
                <option value="NIFTY FMCG">NIFTY FMCG</option>
                <option value="NIFTY METAL">NIFTY METAL</option>
                <option value="NIFTY ENERGY">NIFTY ENERGY</option>
                <option value="NSE All Stocks">NSE All Stocks</option>
              </select>
            </label>

            <label class="hm-field">
              <span>SIZE BY</span>
              <select id="hm-size-by" aria-label="Size By Metric">
                <option value="marketCap">Market Capitalization</option>
                <option value="volume1d">Trading Volume - 1D</option>
                <option value="volume1w">Trading Volume - 1W</option>
                <option value="volume1m">Trading Volume - 1M</option>
                <option value="turnover1d">Turnover - 1D</option>
                <option value="turnover1w">Turnover - 1W</option>
                <option value="turnover1m">Turnover - 1M</option>
                <option value="equal">Equal Size (Mono Size)</option>
              </select>
            </label>

            <label class="hm-field">
              <span>COLOR BY</span>
              <select id="hm-color-by" aria-label="Color By Metric">
                <optgroup label="Price Change">
                  <option value="changePct">Change 1D %</option>
                  <option value="change1h">Change 1H %</option>
                  <option value="change15m">Change 15M %</option>
                  <option value="change5m">Change 5M %</option>
                </optgroup>
                <optgroup label="Performance">
                  <option value="perf1w">Performance 1W %</option>
                  <option value="perf1m">Performance 1M %</option>
                  <option value="perf3m">Performance 3M %</option>
                  <option value="perf6m">Performance 6M %</option>
                  <option value="perfYtd">Performance YTD %</option>
                  <option value="perf1y">Performance 1Y %</option>
                </optgroup>
                <optgroup label="Market Activity">
                  <option value="relativeVolume">Relative Volume</option>
                  <option value="volumeChangePct">Volume Change %</option>
                  <option value="volatility">Volatility</option>
                  <option value="gapPct">Gap %</option>
                </optgroup>
              </select>
            </label>

            <label class="hm-field">
              <span>GROUP BY</span>
              <select id="hm-group-by" aria-label="Group By">
                <option value="sector">Sector</option>
                <option value="industry">Industry</option>
                <option value="none">No Group</option>
              </select>
            </label>

            <label class="hm-field">
              <span>SORT</span>
              <select id="hm-sort-by" aria-label="Sort Securities">
                <option value="default">Treemap Weight</option>
                <option value="color_desc">Metric: High → Low</option>
                <option value="color_asc">Metric: Low → High</option>
                <option value="size_desc">Size: Largest → Smallest</option>
                <option value="symbol_asc">Symbol: A → Z</option>
              </select>
            </label>
          </div>

          <div class="hm-actions">
            <div class="hm-search-wrap">
              <input type="search" id="hm-search" placeholder="Search symbol or company…" aria-label="Search stocks in heatmap" autocomplete="off">
              <button type="button" class="hm-search-clear" id="hm-search-clear" title="Clear search" hidden>×</button>
            </div>

            <button type="button" class="hm-btn" id="hm-btn-filters" aria-expanded="false" aria-controls="hm-filter-drawer">
              <span>Screener Filters</span>
              <span class="hm-badge-count" id="hm-filter-count" hidden>0</span>
            </button>

            <button type="button" class="hm-btn" id="hm-btn-refresh" title="Refresh quotes now">↻ Refresh</button>
            <button type="button" class="hm-btn" id="hm-btn-export" title="Export Heatmap PNG">📷 PNG</button>

            <div class="hm-settings-wrap">
              <button type="button" class="hm-btn" id="hm-btn-settings" aria-expanded="false" title="Display preferences">⚙ Display</button>
              <div class="hm-settings-popover" id="hm-settings-popover" hidden>
                <label><span>Company Monogram Logos</span><input type="checkbox" id="hm-opt-logos"></label>
                <label><span>Stock Symbol Labels</span><input type="checkbox" id="hm-opt-labels"></label>
                <label><span>Last Traded Price (₹)</span><input type="checkbox" id="hm-opt-prices"></label>
                <label><span>Metric / Percentage Value</span><input type="checkbox" id="hm-opt-pct"></label>
                <label><span>Company Name on Large Tiles</span><input type="checkbox" id="hm-opt-company"></label>
              </div>
            </div>

            <button type="button" class="hm-btn" id="hm-btn-fullscreen" aria-pressed="false" title="Toggle Fullscreen Heatmap">⛶ Fullscreen</button>
          </div>
        </div>

        <div class="hm-subbar">
          <div class="hm-presets" role="group" aria-label="Quick stock screener presets">
            <button type="button" class="hm-chip" data-preset="" aria-pressed="true">All Constituents</button>
            <button type="button" class="hm-chip" data-preset="top_gainers" aria-pressed="false">Top Gainers</button>
            <button type="button" class="hm-chip" data-preset="top_losers" aria-pressed="false">Top Losers</button>
            <button type="button" class="hm-chip" data-preset="high_volume" aria-pressed="false">High Volume Stocks</button>
            <button type="button" class="hm-chip" data-preset="high_volatility" aria-pressed="false">High Volatility Stocks</button>
            <button type="button" class="hm-chip" id="hm-clear-all" hidden>Clear All Filters</button>
          </div>

          <div class="hm-breadcrumb" id="hm-breadcrumb" hidden>
            <span>Zoomed: <strong id="hm-zoom-label"></strong></span>
            <button type="button" class="hm-zoom-reset" id="hm-btn-zoom-reset">← Reset Zoom (All Market)</button>
          </div>
        </div>

        <form class="hm-filter-drawer" id="hm-filter-drawer" hidden aria-label="Stock Screener Filters">
          <div class="hm-filter-grid">
            <label>Stock Symbol<input type="text" name="symbol" placeholder="e.g. RELIANCE, SBIN"></label>
            <label>Company Name<input type="text" name="companyName" placeholder="e.g. Tata, Bajaj"></label>
            <label>Sector<select name="sector" id="hm-filter-sector"><option value="">All Sectors</option></select></label>
            <label>Industry<select name="industry" id="hm-filter-industry"><option value="">All Industries</option></select></label>
            <label>Exchange<select name="exchange"><option value="">All (NSE)</option><option value="NSE">NSE</option></select></label>
            <label>Movement Filter
              <select name="direction">
                <option value="">All Securities</option>
                <option value="gainers">Percentage Gainers (&gt; 0%)</option>
                <option value="losers">Percentage Losers (&lt; 0%)</option>
              </select>
            </label>
            <label>Minimum Price (₹)<input type="number" name="minPrice" min="0" step="any" placeholder="0"></label>
            <label>Maximum Price (₹)<input type="number" name="maxPrice" min="0" step="any" placeholder="Any"></label>
            <label>Min Daily Change (%)<input type="number" name="minChangePct" step="0.1" placeholder="-20"></label>
            <label>Max Daily Change (%)<input type="number" name="maxChangePct" step="0.1" placeholder="+20"></label>
            <label>Min Market Cap (₹ Cr)<input type="number" name="minMarketCapCr" min="0" step="any" placeholder="0"></label>
            <label>Max Market Cap (₹ Cr)<input type="number" name="maxMarketCapCr" min="0" step="any" placeholder="Any"></label>
            <label>Min Volume 1D (Shares)<input type="number" name="minVolume" min="0" step="1000" placeholder="0"></label>
            <label>Min Turnover 1D (₹ Cr)<input type="number" name="minTurnoverCr" min="0" step="any" placeholder="0"></label>
            <label>Min Relative Volume (×)<input type="number" name="minRelativeVolume" min="0" step="0.1" placeholder="e.g. 1.5"></label>
            <label>Min Weekly Perf (%)<input type="number" name="minPerf1w" step="0.1" placeholder="Any"></label>
            <label>Min Monthly Perf (%)<input type="number" name="minPerf1m" step="0.1" placeholder="Any"></label>
          </div>
          <div class="hm-filter-footer">
            <span id="hm-filter-summary" class="muted">Combine Sector, Price, Market Cap, Volume, and Performance conditions.</span>
            <div class="hm-filter-btns">
              <button type="button" id="hm-filter-reset">Reset Filters</button>
              <button type="submit" class="primary" id="hm-filter-apply">Apply Filters</button>
            </div>
          </div>
        </form>

        <div class="hm-stage" id="hm-stage">
          <div class="hm-canvas" id="hm-canvas" role="img" aria-label="Interactive proportional Indian stock market treemap"></div>
          <div class="hm-overlay-state" id="hm-overlay">
            <h3 id="hm-overlay-title">Loading Indian Stock Market Heatmap…</h3>
            <p id="hm-overlay-desc">Fetching verified NSE constituent security master and live market quotes.</p>
            <button type="button" class="primary" id="hm-overlay-retry" hidden>Retry Connection</button>
          </div>
        </div>

        <div class="hm-bottombar">
          <div class="hm-legend" id="hm-legend" role="group" aria-label="Interactive performance color scale legend"></div>
          <div class="hm-watchlist" id="hm-watchlist"></div>
        </div>

        <div class="hm-sorted-panel" id="hm-sorted-panel" hidden>
          <div class="hm-sorted-head">
            <span id="hm-sorted-title">Sorted Securities</span>
            <button type="button" class="hm-zoom-reset" id="hm-sorted-close">Hide Table</button>
          </div>
          <div class="hm-sorted-scroll">
            <table class="hm-sorted-table">
              <thead>
                <tr>
                  <th>Symbol</th>
                  <th>Company</th>
                  <th>Sector</th>
                  <th>LTP (₹)</th>
                  <th id="hm-sorted-col-color">Change %</th>
                  <th id="hm-sorted-col-size">Size Metric</th>
                </tr>
              </thead>
              <tbody id="hm-sorted-rows"></tbody>
            </table>
          </div>
        </div>

        <dialog class="hm-stock-dialog" id="hm-stock-dialog" aria-labelledby="hm-dlg-symbol">
          <div class="hm-dialog-head">
            <div class="hm-dialog-title">
              <span class="hm-logo-avatar" id="hm-dlg-avatar">R</span>
              <div>
                <h3 id="hm-dlg-symbol">RELIANCE</h3>
                <p id="hm-dlg-company">Reliance Industries Limited · NSE</p>
              </div>
            </div>
            <button type="button" class="hm-dialog-close" id="hm-dlg-close" aria-label="Close stock details">×</button>
          </div>
          <div class="hm-dialog-body">
            <div class="hm-price-hero">
              <div class="hm-price-main">
                <strong id="hm-dlg-price">₹0.00</strong>
                <span class="hm-chg-pill pos" id="hm-dlg-chg">+0.00 (+0.00%)</span>
              </div>
              <span class="muted" id="hm-dlg-updated">Updated —</span>
            </div>

            <div class="hm-kv-grid" id="hm-dlg-kpis"></div>

            <div class="hm-intraday-box">
              <div class="hm-intraday-head">
                <span id="hm-dlg-chart-title">Intraday Session Price (IST)</span>
                <span class="muted" id="hm-dlg-chart-meta">09:15–15:30 IST</span>
              </div>
              <div class="hm-intraday-chart" id="hm-dlg-chart"></div>
            </div>

            <div>
              <strong style="font-size:12px;display:block;margin-bottom:6px;">Multi-Timeframe Verified Returns</strong>
              <div class="hm-perf-strip" id="hm-dlg-perf"></div>
            </div>

            <div class="hm-dialog-actions">
              <button type="button" class="primary" id="hm-dlg-open-sim">Open in Options Simulator</button>
              <button type="button" id="hm-dlg-open-builder">Load Spot in Strategy Builder</button>
              <button type="button" id="hm-dlg-watch">☆ Add to Watchlist</button>
            </div>
          </div>
        </dialog>
      </div>
    `;

    const el = id => host.querySelector('#hm-' + id);

    // Sync initial control values from saved prefs
    el('universe').value = prefs.universe;
    el('size-by').value = prefs.sizeBy;
    el('color-by').value = prefs.colorBy;
    el('group-by').value = prefs.groupBy;
    el('sort-by').value = prefs.sortBy;
    el('opt-logos').checked = Boolean(prefs.showLogos);
    el('opt-labels').checked = Boolean(prefs.showLabels);
    el('opt-prices').checked = Boolean(prefs.showPrices);
    el('opt-pct').checked = Boolean(prefs.showPct);
    el('opt-company').checked = Boolean(prefs.showCompanyName);

    function ensureChart() {
      if (!root.echarts) return null;
      if (!chart) {
        chart = root.echarts.init(el('canvas'), null, { renderer: 'canvas' });
        chart.on('click', params => {
          if (!params || !params.data) return;
          if (params.data.isGroupNode && params.data.name) {
            zoomedGroup = zoomedGroup === params.data.name ? '' : params.data.name;
            renderHeatmap();
            return;
          }
          if (params.data.stock && params.data.stock.symbol) {
            openStockModal(params.data.stock.symbol);
          }
        });
      }
      return chart;
    }

    function activeFilterCount() {
      let n = 0;
      for (const [k, v] of Object.entries(filters)) {
        if (k === 'search') continue;
        if (v !== '' && v !== null && v !== undefined) n++;
      }
      return n;
    }

    function updateFilterBadges() {
      const cnt = activeFilterCount();
      const badge = el('filter-count');
      badge.hidden = cnt === 0;
      badge.textContent = String(cnt);
      el('clear-all').hidden = cnt === 0 && !filters.search && hiddenBuckets.size === 0;
      host.querySelectorAll('.hm-presets .hm-chip[data-preset]').forEach(btn => {
        btn.setAttribute('aria-pressed', String(btn.dataset.preset === (filters.preset || '')));
      });
    }

    function matchesClientFilters(s) {
      if (filters.search) {
        const q = filters.search.toLowerCase();
        const hit =
          s.symbol.toLowerCase().includes(q) ||
          (s.companyName || '').toLowerCase().includes(q) ||
          (s.sector || '').toLowerCase().includes(q) ||
          (s.industry || '').toLowerCase().includes(q);
        if (!hit) return false;
      }
      if (filters.symbol && !s.symbol.includes(filters.symbol.toUpperCase())) return false;
      if (filters.companyName && !(s.companyName || '').toLowerCase().includes(filters.companyName.toLowerCase())) return false;
      if (filters.sector && s.sector !== filters.sector) return false;
      if (filters.industry && s.industry !== filters.industry) return false;
      if (filters.exchange && (s.exchange || 'NSE') !== filters.exchange) return false;

      if (filters.direction === 'gainers' && !(s.changePct > 0)) return false;
      if (filters.direction === 'losers' && !(s.changePct < 0)) return false;

      const checkMin = (val, rawMin) => rawMin === '' || (val != null && Number(val) >= Number(rawMin));
      const checkMax = (val, rawMax) => rawMax === '' || (val != null && Number(val) <= Number(rawMax));

      if (!checkMin(s.price, filters.minPrice) || !checkMax(s.price, filters.maxPrice)) return false;
      if (!checkMin(s.changePct, filters.minChangePct) || !checkMax(s.changePct, filters.maxChangePct)) return false;
      if (!checkMin(s.marketCapCr, filters.minMarketCapCr) || !checkMax(s.marketCapCr, filters.maxMarketCapCr)) return false;
      if (!checkMin(s.volume1d, filters.minVolume)) return false;
      const turnCr = s.turnover1d != null ? s.turnover1d / 1e7 : null;
      if (!checkMin(turnCr, filters.minTurnoverCr)) return false;
      if (!checkMin(s.relativeVolume, filters.minRelativeVolume)) return false;
      if (!checkMin(s.changePct, filters.minPerf1d)) return false;
      if (!checkMin(s.perf1w, filters.minPerf1w)) return false;
      if (!checkMin(s.perf1m, filters.minPerf1m)) return false;

      // Legend bucket visibility filter
      if (hiddenBuckets.size > 0) {
        const b = resolveBucket(prefs.colorBy, s[prefs.colorBy]);
        if (hiddenBuckets.has(b.id)) return false;
      }

      if (zoomedGroup && prefs.groupBy !== 'none') {
        const gField = prefs.groupBy === 'industry' ? s.industry : s.sector;
        if (gField !== zoomedGroup) return false;
      }

      return true;
    }

    function getFilteredList() {
      let list = [...allUniverseSecurities.values()].filter(matchesClientFilters);
      if (filters.preset === 'top_gainers') {
        list = list.filter(x => (x.changePct || 0) > 0).sort((a, b) => (b.changePct || 0) - (a.changePct || 0)).slice(0, 25);
      } else if (filters.preset === 'top_losers') {
        list = list.filter(x => (x.changePct || 0) < 0).sort((a, b) => (a.changePct || 0) - (b.changePct || 0)).slice(0, 25);
      } else if (filters.preset === 'high_volume') {
        list = list.sort((a, b) => (b.relativeVolume || 0) - (a.relativeVolume || 0) || (b.volume1d || 0) - (a.volume1d || 0)).slice(0, 30);
      } else if (filters.preset === 'high_volatility') {
        list = list.sort((a, b) => (b.volatility || 0) - (a.volatility || 0)).slice(0, 30);
      }
      return list;
    }

    function computeSizeValue(s) {
      if (prefs.sizeBy === 'equal') return 1;
      const raw = s[prefs.sizeBy];
      if (raw != null && Number.isFinite(Number(raw)) && Number(raw) > 0) return Number(raw);
      // Graceful positive floor when an individual stock has 0 volume/mcap so it remains selectable
      return prefs.sizeBy.startsWith('marketCap') ? 1e8 : 1;
    }

    function populateSectorIndustryDropdowns() {
      const all = [...allUniverseSecurities.values()];
      const sectors = [...new Set(all.map(s => s.sector).filter(Boolean))].sort();
      const industries = [...new Set(all.map(s => s.industry).filter(Boolean))].sort();
      const secSel = el('filter-sector');
      const indSel = el('filter-industry');
      const prevSec = secSel.value;
      const prevInd = indSel.value;
      secSel.innerHTML = '<option value="">All Sectors (' + sectors.length + ')</option>' + sectors.map(s => `<option value="${esc(s)}">${esc(s)}</option>`).join('');
      indSel.innerHTML = '<option value="">All Industries (' + industries.length + ')</option>' + industries.map(s => `<option value="${esc(s)}">${esc(s)}</option>`).join('');
      if (sectors.includes(prevSec)) secSel.value = prevSec;
      if (industries.includes(prevInd)) indSel.value = prevInd;
    }

    function updateMetricAvailabilityUI() {
      if (!metricsManifest) return;
      const sizeMap = new Map((metricsManifest.sizeBy || []).map(m => [m.id, m]));
      const colorMap = new Map((metricsManifest.colorBy || []).map(m => [m.id, m]));
      for (const opt of el('size-by').options) {
        const meta = sizeMap.get(opt.value);
        if (meta) {
          opt.disabled = !meta.available;
          opt.textContent = meta.available ? meta.label : `${meta.label} (Unavailable)`;
        }
      }
      for (const opt of el('color-by').options) {
        const meta = colorMap.get(opt.value);
        if (meta) {
          opt.disabled = !meta.available;
          opt.textContent = meta.available ? meta.label : `${meta.label} (Unavailable)`;
        }
      }
      if (el('color-by').selectedOptions[0]?.disabled) {
        prefs.colorBy = 'changePct';
        el('color-by').value = 'changePct';
      }
      if (el('size-by').selectedOptions[0]?.disabled) {
        prefs.sizeBy = 'marketCap';
        el('size-by').value = 'marketCap';
      }
    }

    function renderLegend() {
      const dark = isDarkTheme();
      const buckets = getBucketsForMetric(prefs.colorBy);
      const metricLabel = el('color-by').selectedOptions[0]?.textContent || 'Change 1D %';
      el('legend').innerHTML =
        `<span class="hm-legend-caption">${esc(metricLabel)}:</span>` +
        buckets
          .map(
            b =>
              `<button type="button" class="hm-legend-bucket${b.neutral ? ' hm-neutral-bucket' : ''}" data-bucket-id="${b.id}" data-hidden-bucket="${hiddenBuckets.has(b.id)}" style="background:${dark ? b.dark : b.light}" title="Click to toggle securities in ${esc(b.label)} range">${esc(b.label)}</button>`
          )
          .join('');
    }

    function renderWatchlistBar() {
      const box = el('watchlist');
      if (!watchlist.length) {
        box.innerHTML = '<span class="muted">Watchlist: click any stock tile to pin favourites</span>';
        return;
      }
      box.innerHTML =
        '<span class="muted">Watchlist:</span>' +
        watchlist
          .map(sym => {
            const q = allUniverseSecurities.get(sym);
            const chg = q ? ` ${fmtSignedPct(q.changePct)}` : '';
            return `<button type="button" class="hm-watch-pill" data-watch-sym="${esc(sym)}">${esc(sym)}${esc(chg)}</button>`;
          })
          .join('');
    }

    function renderStatusPill() {
      const pill = el('feed-pill');
      const txt = el('feed-text');
      const meta = el('provider-meta');
      if (!currentStatus) return;

      const state = wsConnected && currentStatus.feedState === 'LIVE'
        ? 'LIVE'
        : currentStatus.isStale
          ? 'STALE'
          : currentStatus.feedState || 'MARKET_CLOSED';

      pill.dataset.state = state;
      const connLabel = isGithubPages
        ? 'Static CDN Snapshot'
        : wsConnected
          ? 'WS Live'
          : 'HTTP Poll';

      const badgeWord = isGithubPages
        ? 'MARKET SNAPSHOT'
        : state === 'LIVE'
          ? 'LIVE'
          : state === 'STALE'
            ? 'STALE QUOTES'
            : state === 'MARKET_CLOSED'
              ? 'MARKET CLOSED'
              : state;

      const ts = currentStatus.exchangeTimestamp || currentStatus.lastSyncAt || '—';
      txt.textContent = `${badgeWord} · ${connLabel} · ${ts}`;
      meta.textContent = `${currentStatus.provider || 'NSE Exchange Feed'} · ${currentStatus.delayLabel || ''}`;
    }

    function buildTooltipHtml(params) {
      if (!params || !params.data) return '';
      if (params.data.isGroupNode) {
        const g = params.data;
        return (
          `<div style="font-family:Inter,sans-serif;min-width:210px;">` +
          `<strong style="font-size:13px;">${esc(g.name)}</strong>` +
          `<div style="font-size:11.5px;margin-top:4px;opacity:0.9;">Constituents: <b>${g.stockCount}</b> · Weighted 1D: <b>${fmtSignedPct(g.weightedChange)}</b></div>` +
          `<div style="font-size:11px;margin-top:2px;opacity:0.8;">Market Cap: ${fmtCompactCr(g.totalMcap)} · Click header to zoom</div>` +
          `</div>`
        );
      }
      const s = params.data.stock;
      if (!s) return '';
      const rows = [
        ['Symbol / Exchange', `${esc(s.symbol)} · ${esc(s.exchange || 'NSE')}`],
        ['Last Traded Price', fmtInr(s.price)],
        s.previousClose != null ? ['Previous Close', fmtInr(s.previousClose)] : null,
        s.change != null ? ["Today's Change", `${s.change > 0 ? '+' : ''}${s.change.toFixed(2)} (${fmtSignedPct(s.changePct)})`] : ["Today's Change %", fmtSignedPct(s.changePct)],
        prefs.colorBy !== 'changePct' && s[prefs.colorBy] != null
          ? [el('color-by').selectedOptions[0]?.textContent || prefs.colorBy, formatMetricBadge(prefs.colorBy, s[prefs.colorBy])]
          : null,
        s.open != null ? ['Open / High / Low', `${fmtInr(s.open)} / ${fmtInr(s.high)} / ${fmtInr(s.low)}`] : null,
        s.volume1d != null ? ['Trading Volume (1D)', fmtInt(s.volume1d)] : null,
        s.marketCap != null ? ['Market Cap (FFMC)', fmtCompactCr(s.marketCap)] : null,
        s.sector ? ['Sector', esc(s.sector)] : null,
        s.industry ? ['Industry', esc(s.industry)] : null,
        s.lastUpdateTime ? ['Last Update (IST)', esc(s.lastUpdateTime)] : null,
      ].filter(Boolean);

      return (
        `<div style="font-family:Inter,sans-serif;min-width:255px;max-width:330px;line-height:1.45;">` +
        `<div style="font-weight:700;font-size:13px;margin-bottom:4px;border-bottom:1px solid rgba(148,163,184,0.3);padding-bottom:4px;">${esc(s.companyName || s.symbol)}</div>` +
        rows
          .map(
            ([k, v]) =>
              `<div style="display:flex;justify-content:space-between;gap:12px;font-size:11.5px;"><span style="opacity:0.78;">${k}</span><strong style="text-align:right;">${v}</strong></div>`
          )
          .join('') +
        `</div>`
      );
    }

    function sortLeafNodes(nodes) {
      if (prefs.sortBy === 'color_desc') {
        nodes.sort((a, b) => (b.metricVal ?? -1e9) - (a.metricVal ?? -1e9));
      } else if (prefs.sortBy === 'color_asc') {
        nodes.sort((a, b) => (a.metricVal ?? 1e9) - (b.metricVal ?? 1e9));
      } else if (prefs.sortBy === 'size_desc') {
        nodes.sort((a, b) => b.value - a.value);
      } else if (prefs.sortBy === 'symbol_asc') {
        nodes.sort((a, b) => a.name.localeCompare(b.name));
      } else {
        nodes.sort((a, b) => b.value - a.value);
      }
    }

    function renderSortedTable(filteredList) {
      const panel = el('sorted-panel');
      if (prefs.sortBy === 'default') {
        panel.hidden = true;
        return;
      }
      panel.hidden = false;
      const colorTitle = el('color-by').selectedOptions[0]?.textContent || 'Metric';
      const sizeTitle = el('size-by').selectedOptions[0]?.textContent || 'Size';
      el('sorted-col-color').textContent = colorTitle;
      el('sorted-col-size').textContent = sizeTitle;

      const sorted = [...filteredList];
      if (prefs.sortBy === 'color_desc') sorted.sort((a, b) => (b[prefs.colorBy] ?? -1e9) - (a[prefs.colorBy] ?? -1e9));
      else if (prefs.sortBy === 'color_asc') sorted.sort((a, b) => (a[prefs.colorBy] ?? 1e9) - (b[prefs.colorBy] ?? 1e9));
      else if (prefs.sortBy === 'size_desc') sorted.sort((a, b) => computeSizeValue(b) - computeSizeValue(a));
      else if (prefs.sortBy === 'symbol_asc') sorted.sort((a, b) => a.symbol.localeCompare(b.symbol));

      el('sorted-title').textContent = `Sorted View (${sorted.length} securities · click row for details)`;
      el('sorted-rows').innerHTML = sorted
        .slice(0, 150)
        .map(s => {
          const mv = s[prefs.colorBy];
          const sizeDisplay = prefs.sizeBy.startsWith('marketCap')
            ? fmtCompactCr(s.marketCap)
            : prefs.sizeBy.startsWith('turnover')
              ? fmtCompactCr(s[prefs.sizeBy])
              : prefs.sizeBy === 'equal'
                ? 'Equal (1.0)'
                : fmtInt(s[prefs.sizeBy]);
          return (
            `<tr data-row-sym="${esc(s.symbol)}">` +
            `<td><strong>${esc(s.symbol)}</strong></td>` +
            `<td>${esc(s.companyName || s.symbol)}</td>` +
            `<td>${esc(s.sector || '—')}</td>` +
            `<td>${fmtInr(s.price)}</td>` +
            `<td class="${(mv || 0) >= 0 ? 'gain' : 'loss'}"><strong>${esc(formatMetricBadge(prefs.colorBy, mv))}</strong></td>` +
            `<td>${esc(sizeDisplay)}</td>` +
            `</tr>`
          );
        })
        .join('');
    }

    function renderHeatmap() {
      updateFilterBadges();
      renderLegend();
      renderWatchlistBar();
      renderStatusPill();

      const totalCount = allUniverseSecurities.size;
      const filtered = getFilteredList();
      el('count-total').textContent = String(totalCount);
      el('count-shown').textContent = String(filtered.length);
      el('heading').textContent = `${prefs.universe} Heatmap`;

      let adv = 0, dec = 0, unch = 0;
      for (const s of filtered) {
        if ((s.changePct || 0) > 0) adv++;
        else if ((s.changePct || 0) < 0) dec++;
        else unch++;
      }
      el('adv').textContent = String(adv);
      el('dec').textContent = String(dec);
      el('unch').textContent = String(unch);

      // Zoom breadcrumb
      if (zoomedGroup && prefs.groupBy !== 'none') {
        el('breadcrumb').hidden = false;
        el('zoom-label').textContent = zoomedGroup;
      } else {
        el('breadcrumb').hidden = true;
      }

      renderSortedTable(filtered);

      const overlay = el('overlay');
      if (totalCount === 0) {
        return; // keep initial loading or error state visible
      }
      if (filtered.length === 0) {
        overlay.hidden = false;
        el('overlay-title').textContent = 'No Matching Securities';
        el('overlay-desc').textContent = 'No stocks in ' + prefs.universe + ' match the active Screener Filters or legend selection.';
        el('overlay-retry').hidden = false;
        el('overlay-retry').textContent = 'Reset All Filters';
        el('overlay-retry').onclick = () => clearAllFilters();
        return;
      }
      overlay.hidden = true;

      const c = ensureChart();
      if (!c) return;

      const dark = isDarkTheme();
      const borderCol = dark ? '#030812' : '#ffffff';
      const headerBg = dark ? '#0b1628' : '#f1f5f3';
      const headerInk = dark ? '#cbd5e1' : '#1e293b';

      const makeLeaf = s => {
        const sizeVal = computeSizeValue(s);
        const metricVal = s[prefs.colorBy];
        const bucket = resolveBucket(prefs.colorBy, metricVal);
        const tileBg = dark ? bucket.dark : bucket.light;
        const textInk = bucket.neutral ? (dark ? '#e2e8f0' : '#1f2937') : '#ffffff';
        return {
          name: s.symbol,
          id: 'stk-' + s.symbol,
          value: sizeVal,
          metricVal,
          stock: s,
          itemStyle: {
            color: tileBg,
            borderColor: borderCol,
            borderWidth: 1.5,
          },
          label: {
            color: textInk,
          },
        };
      };

      let treeData = [];
      if (prefs.groupBy === 'none') {
        treeData = filtered.map(makeLeaf);
        sortLeafNodes(treeData);
      } else {
        const gKey = prefs.groupBy === 'industry' ? 'industry' : 'sector';
        const groups = new Map();
        for (const s of filtered) {
          const gName = s[gKey] || 'Unclassified';
          if (!groups.has(gName)) groups.set(gName, []);
          groups.get(gName).push(s);
        }
        for (const [gName, items] of groups.entries()) {
          const children = items.map(makeLeaf);
          sortLeafNodes(children);
          const groupVal = children.reduce((acc, n) => acc + n.value, 0);
          const totalMcap = items.reduce((acc, x) => acc + (x.marketCap || 0), 0);
          const weightedChg = totalMcap > 0
            ? items.reduce((acc, x) => acc + (x.changePct || 0) * (x.marketCap || 0), 0) / totalMcap
            : items.reduce((acc, x) => acc + (x.changePct || 0), 0) / items.length;
          treeData.push({
            name: gName,
            id: 'grp-' + gName,
            isGroupNode: true,
            value: groupVal,
            stockCount: items.length,
            totalMcap,
            weightedChange: weightedChg,
            children,
            itemStyle: {
              borderColor: borderCol,
              borderWidth: 3,
              gapWidth: 1.5,
              color: headerBg,
            },
          });
        }
        treeData.sort((a, b) => b.value - a.value);
      }

      const totalAreaValue = treeData.reduce((acc, n) => acc + n.value, 0) || 1;
      const canvasW = el('canvas').clientWidth || 1100;
      const canvasH = el('canvas').clientHeight || 620;
      const totalPx = canvasW * canvasH;

      c.setOption(
        {
          animationDurationUpdate: 260,
          animationEasingUpdate: 'cubicOut',
          tooltip: {
            trigger: 'item',
            confine: true,
            backgroundColor: dark ? 'rgba(11, 22, 40, 0.96)' : 'rgba(255, 255, 255, 0.98)',
            borderColor: dark ? '#34506f' : '#bad6c7',
            borderWidth: 1,
            textStyle: {
              color: dark ? '#eef5ff' : '#152a22',
              fontSize: 12,
            },
            formatter: buildTooltipHtml,
          },
          series: [
            {
              type: 'treemap',
              id: 'iwsm-stock-treemap',
              width: '100%',
              height: '100%',
              roam: false,
              nodeClick: false,
              breadcrumb: { show: false },
              squareRatio: 0.5 * (1 + Math.sqrt(5)),
              sort: prefs.sortBy === 'default' ? 'desc' : null,
              upperLabel: {
                show: prefs.groupBy !== 'none',
                height: 22,
                color: headerInk,
                backgroundColor: headerBg,
                fontFamily: 'Inter, sans-serif',
                fontWeight: 650,
                fontSize: 11.5,
                padding: [2, 6],
                formatter: p => `${p.name} ›`,
              },
              label: {
                show: true,
                position: 'inside',
                align: 'center',
                verticalAlign: 'middle',
                overflow: 'truncate',
                fontFamily: 'Inter, sans-serif',
                formatter: params => {
                  const s = params.data?.stock;
                  if (!s) return '';
                  const estPx = (params.data.value / totalAreaValue) * totalPx;
                  if (estPx < 680) return '';
                  if (!prefs.showLabels && !prefs.showPct && !prefs.showPrices && !prefs.showLogos) return '';

                  const lines = [];
                  const initChar = s.symbol.slice(0, 2);

                  if (estPx >= 11500) {
                    if (prefs.showLogos) lines.push(`{logo| ${initChar} }`);
                    if (prefs.showLabels) lines.push(`{symLg|${s.symbol}}`);
                    if (prefs.showCompanyName && s.companyName) {
                      lines.push(`{comp|${s.companyName.slice(0, 20)}}`);
                    }
                    if (prefs.showPrices) lines.push(`{prcLg|${fmtInr(s.price)}}`);
                    if (prefs.showPct) lines.push(`{pctLg|${formatMetricBadge(prefs.colorBy, s[prefs.colorBy])}}`);
                  } else if (estPx >= 4200) {
                    if (prefs.showLogos && estPx >= 7800) lines.push(`{logoSm| ${s.symbol[0]} }`);
                    if (prefs.showLabels) lines.push(`{symMd|${s.symbol}}`);
                    if (prefs.showPrices && estPx >= 6800) lines.push(`{prcSm|${fmtInr(s.price)}}`);
                    if (prefs.showPct) lines.push(`{pctMd|${formatMetricBadge(prefs.colorBy, s[prefs.colorBy])}}`);
                  } else if (estPx >= 1550) {
                    if (prefs.showLabels) lines.push(`{symSm|${s.symbol}}`);
                    if (prefs.showPct) lines.push(`{pctSm|${formatMetricBadge(prefs.colorBy, s[prefs.colorBy])}}`);
                  } else {
                    if (prefs.showLabels) lines.push(`{symXs|${s.symbol.slice(0, 8)}}`);
                  }
                  return lines.join('\n');
                },
                rich: {
                  logo: {
                    backgroundColor: 'rgba(15, 23, 42, 0.34)',
                    color: '#ffffff',
                    fontSize: 11,
                    fontWeight: 800,
                    padding: [5, 6],
                    borderRadius: 99,
                    lineHeight: 24,
                    align: 'center',
                  },
                  logoSm: {
                    backgroundColor: 'rgba(15, 23, 42, 0.3)',
                    color: '#ffffff',
                    fontSize: 9.5,
                    fontWeight: 800,
                    padding: [3, 5],
                    borderRadius: 99,
                    lineHeight: 18,
                    align: 'center',
                  },
                  symLg: { fontSize: 15, fontWeight: 800, lineHeight: 20, align: 'center' },
                  comp: { fontSize: 10, fontWeight: 500, lineHeight: 14, opacity: 0.88, align: 'center' },
                  prcLg: { fontSize: 12, fontWeight: 600, lineHeight: 17, opacity: 0.95, align: 'center' },
                  pctLg: { fontSize: 13.5, fontWeight: 700, lineHeight: 19, align: 'center' },
                  symMd: { fontSize: 11, fontWeight: 750, lineHeight: 15, align: 'center' },
                  prcSm: { fontSize: 10, fontWeight: 600, lineHeight: 13.5, opacity: 0.92, align: 'center' },
                  pctMd: { fontSize: 10.5, fontWeight: 700, lineHeight: 14, align: 'center' },
                  symSm: { fontSize: 9.5, fontWeight: 700, lineHeight: 12.5, align: 'center' },
                  pctSm: { fontSize: 9.5, fontWeight: 650, lineHeight: 12, align: 'center' },
                  symXs: { fontSize: 8.5, fontWeight: 700, lineHeight: 11, align: 'center' },
                },
              },
              levels:
                prefs.groupBy === 'none'
                  ? [
                      {
                        itemStyle: { borderColor: borderCol, borderWidth: 1.5, gapWidth: 1.5 },
                      },
                    ]
                  : [
                      {
                        itemStyle: { borderColor: borderCol, borderWidth: 2, gapWidth: 3 },
                        upperLabel: { show: false },
                      },
                      {
                        itemStyle: { borderColor: borderCol, borderWidth: 2, gapWidth: 1.5 },
                        upperLabel: { show: true },
                      },
                      {
                        itemStyle: { borderColor: borderCol, borderWidth: 1.2, gapWidth: 1.2 },
                      },
                    ],
              data: treeData,
            },
          ],
        },
        { notMerge: true, lazyUpdate: true }
      );
    }

    async function fetchHeatmapJson(path, init) {
      if (isGithubPages) {
        return fetchStaticFallback(path);
      }
      const res = await fetch('/api/heatmap/' + path, init);
      if (!res.ok) {
        let msg = `HTTP ${res.status}`;
        try {
          const j = await res.json();
          msg = j.detail || msg;
        } catch {}
        throw new Error(msg);
      }
      return res.json();
    }

    async function fetchStaticFallback(path) {
      if (path.startsWith('universes')) {
        const r = await fetch('assets/heatmap-cache/universes.json');
        if (!r.ok) throw new Error('Static heatmap universes unavailable');
        return r.json();
      }
      if (path.startsWith('securities')) {
        const u = new URL(path, 'https://iwsm.local').searchParams.get('universe') || 'NIFTY 50';
        const slug = u.replace(/[^A-Za-z0-9]+/g, '_');
        const r = await fetch(`assets/heatmap-cache/universe-${slug}.json`);
        if (!r.ok) throw new Error(`Static cache for ${u} unavailable`);
        return r.json();
      }
      if (path.startsWith('stock/')) {
        const sym = decodeURIComponent(path.slice('stock/'.length)).toUpperCase();
        const q = allUniverseSecurities.get(sym);
        return { quote: q || null, master: q || null, extra: {}, intradayChart: [] };
      }
      throw new Error('Endpoint requires live backend');
    }

    function ingestInitialPayload(payload) {
      allUniverseSecurities = new Map();
      for (const s of payload.securities || []) {
        allUniverseSecurities.set(s.symbol, s);
      }
      if (payload.status) currentStatus = payload.status;
      if (payload.metrics) {
        metricsManifest = payload.metrics;
        updateMetricAvailabilityUI();
      }
      populateSectorIndustryDropdowns();
      renderHeatmap();
    }

    function applyQuoteDelta(deltaPayload) {
      if (!deltaPayload || deltaPayload.universe !== prefs.universe) return;
      let changedCount = 0;
      for (const q of deltaPayload.updates || []) {
        allUniverseSecurities.set(q.symbol, q);
        changedCount++;
      }
      if (currentStatus) {
        if (deltaPayload.exchangeTimestamp) currentStatus.exchangeTimestamp = deltaPayload.exchangeTimestamp;
        if (deltaPayload.lastSyncAt) currentStatus.lastSyncAt = deltaPayload.lastSyncAt;
        currentStatus.isStale = false;
      }
      if (changedCount > 0 && !host.hidden) {
        renderHeatmap();
      } else {
        renderStatusPill();
      }
    }

    async function loadUniverseHttp(universeId, forceRefresh = false) {
      if (allUniverseSecurities.size === 0) {
        el('overlay').hidden = false;
        el('overlay-title').textContent = `Loading ${universeId}…`;
        el('overlay-desc').textContent = 'Retrieving constituent quotes and sector classifications.';
        el('overlay-retry').hidden = true;
      }
      try {
        if (forceRefresh && !isGithubPages) {
          await fetchHeatmapJson(`quotes?universe=${encodeURIComponent(universeId)}&force=true`);
        }
        const data = await fetchHeatmapJson(`securities?universe=${encodeURIComponent(universeId)}`);
        ingestInitialPayload(data);
      } catch (err) {
        if (allUniverseSecurities.size === 0) {
          el('overlay').hidden = false;
          el('overlay-title').textContent = 'Market-Data Feed Unavailable';
          el('overlay-desc').textContent = err.message || 'Could not load NSE constituent quotes.';
          el('overlay-retry').hidden = false;
          el('overlay-retry').textContent = 'Retry Connection';
          el('overlay-retry').onclick = () => loadUniverseHttp(prefs.universe, true);
        } else if (currentStatus) {
          currentStatus.isStale = true;
          renderStatusPill();
        }
      }
    }

    function stopPolling() {
      if (pollTimer) {
        clearInterval(pollTimer);
        pollTimer = null;
      }
    }

    function startFallbackPolling() {
      stopPolling();
      if (isGithubPages) return;
      pollTimer = setInterval(() => {
        if (!host.hidden && !document.hidden && !wsConnected) {
          loadUniverseHttp(prefs.universe, false);
        }
      }, 12000);
    }

    function connectWebSocket() {
      if (isGithubPages) {
        loadUniverseHttp(prefs.universe, false);
        return;
      }
      if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) return;
      clearTimeout(reconnectTimer);

      const proto = root.location?.protocol === 'https:' ? 'wss:' : 'ws:';
      const wsUrl = `${proto}//${root.location.host}/api/heatmap/ws?universe=${encodeURIComponent(prefs.universe)}`;
      try {
        ws = new WebSocket(wsUrl);
      } catch {
        startFallbackPolling();
        return;
      }

      ws.onopen = () => {
        wsConnected = true;
        reconnectAttempt = 0;
        stopPolling();
        renderStatusPill();
      };

      ws.onmessage = ev => {
        try {
          const msg = JSON.parse(ev.data);
          if (msg.event === 'heatmap:initial') {
            ingestInitialPayload(msg.data);
          } else if (msg.event === 'heatmap:quote_update') {
            applyQuoteDelta(msg.data);
          } else if (msg.event === 'heatmap:connection_status') {
            currentStatus = msg.data;
            renderStatusPill();
          } else if (msg.event === 'heatmap:error' && allUniverseSecurities.size === 0) {
            loadUniverseHttp(prefs.universe, false);
          }
        } catch {}
      };

      ws.onclose = () => {
        wsConnected = false;
        ws = null;
        if (currentStatus && currentStatus.feedState === 'LIVE') {
          el('feed-pill').dataset.state = 'RECONNECTING';
          el('feed-text').textContent = 'RECONNECTING · Preserving last verified quotes…';
        }
        startFallbackPolling();
        if (!host.hidden && !document.hidden) {
          const backoffMs = Math.min(25000, 1500 * Math.pow(1.8, reconnectAttempt++));
          reconnectTimer = setTimeout(connectWebSocket, backoffMs);
        }
      };

      ws.onerror = () => {
        try {
          ws?.close();
        } catch {}
      };
    }

    function disconnectWebSocket() {
      clearTimeout(reconnectTimer);
      stopPolling();
      if (ws) {
        try {
          ws.onclose = null;
          ws.close();
        } catch {}
        ws = null;
      }
      wsConnected = false;
    }

    async function refreshUniversesDropdown() {
      try {
        const res = await fetchHeatmapJson('universes');
        universesList = res.universes || [];
        if (res.status) currentStatus = res.status;
        if (universesList.length) {
          el('universe').innerHTML = universesList
            .map(
              u =>
                `<option value="${esc(u.id)}" ${!u.available ? 'disabled' : ''}>${esc(u.label)}${u.count ? ' (' + u.count + ')' : !u.available ? ' — Unavailable' : ''}</option>`
            )
            .join('');
          if (universesList.some(u => u.id === prefs.universe && u.available)) {
            el('universe').value = prefs.universe;
          } else {
            prefs.universe = universesList.find(u => u.available)?.id || 'NIFTY 50';
            el('universe').value = prefs.universe;
          }
        }
      } catch {}
    }

    function clearAllFilters() {
      filters = {
        search: '',
        symbol: '',
        companyName: '',
        sector: '',
        industry: '',
        exchange: '',
        minPrice: '',
        maxPrice: '',
        minChangePct: '',
        maxChangePct: '',
        direction: '',
        minMarketCapCr: '',
        maxMarketCapCr: '',
        minVolume: '',
        minTurnoverCr: '',
        minRelativeVolume: '',
        minPerf1d: '',
        minPerf1w: '',
        minPerf1m: '',
        preset: '',
      };
      hiddenBuckets.clear();
      zoomedGroup = '';
      el('search').value = '';
      el('search-clear').hidden = true;
      el('filter-drawer').reset();
      renderHeatmap();
    }

    async function openStockModal(symbol) {
      const dlg = el('stock-dialog');
      const sLocal = allUniverseSecurities.get(symbol);
      if (!sLocal && isGithubPages) return;

      const renderModalContent = (s, extra = {}, chartPts = []) => {
        if (!s) return;
        const avatar = el('dlg-avatar');
        avatar.textContent = s.symbol.slice(0, 2);
        avatar.style.background = avatarColor(s.symbol);
        el('dlg-symbol').textContent = s.symbol;
        el('dlg-company').textContent = `${s.companyName || s.symbol} · ${s.exchange || 'NSE'}${s.isin ? ' · ' + s.isin : ''} · ${s.sector || ''} › ${extra.basicIndustry || s.industry || ''}`;
        el('dlg-price').textContent = fmtInr(s.price);

        const chgPill = el('dlg-chg');
        const isPos = (s.changePct || 0) >= 0;
        chgPill.className = 'hm-chg-pill ' + (isPos ? 'pos' : 'neg');
        const chgAmt = s.change != null ? `${s.change > 0 ? '+' : ''}${s.change.toFixed(2)} ` : '';
        chgPill.textContent = `${chgAmt}(${fmtSignedPct(s.changePct)})`;
        el('dlg-updated').textContent = s.lastUpdateTime ? `As of ${s.lastUpdateTime} IST` : 'Latest session';

        const kpis = [
          ['Market Cap', fmtCompactCr(s.marketCap)],
          ['Volume (1D)', fmtInt(s.volume1d)],
          ['Turnover (1D)', fmtCompactCr(s.turnover1d)],
          ['Open / Prev Close', `${fmtInr(s.open)} / ${fmtInr(s.previousClose)}`],
          ['Day Low – High', `${fmtInr(s.low)} – ${fmtInr(s.high)}`],
          ['52W Low – High', `${fmtInr(s.yearLow)} – ${fmtInr(s.yearHigh)}`],
          s.relativeVolume != null ? ['Relative Volume', `${s.relativeVolume.toFixed(2)}× (20D)`] : null,
          extra.peRatio != null ? ['Symbol P/E', extra.peRatio.toFixed(2)] : null,
          extra.deliveryPct != null ? ['Delivery %', `${extra.deliveryPct.toFixed(1)}%`] : null,
          s.volatility != null ? ['Annualized Vol (20D)', `${s.volatility.toFixed(1)}%`] : null,
        ].filter(Boolean);

        el('dlg-kpis').innerHTML = kpis
          .map(([label, val]) => `<div class="hm-kv-card"><small>${esc(label)}</small><strong>${esc(val)}</strong></div>`)
          .join('');

        const perfItems = [
          ['5M', s.change5m],
          ['15M', s.change15m],
          ['1H', s.change1h],
          ['1D', s.changePct],
          ['1W', s.perf1w],
          ['1M', s.perf1m],
          ['3M', s.perf3m],
          ['6M', s.perf6m],
          ['YTD', s.perfYtd],
          ['1Y', s.perf1y],
        ];
        el('dlg-perf').innerHTML = perfItems
          .map(([lbl, v]) => {
            const cls = v == null ? '' : v >= 0 ? 'pos' : 'neg';
            return `<div class="hm-perf-cell"><span>${lbl}</span><b class="${cls}">${fmtSignedPct(v)}</b></div>`;
          })
          .join('');

        const inWatch = watchlist.includes(s.symbol);
        el('dlg-watch').textContent = inWatch ? '★ In Watchlist (Remove)' : '☆ Add to Watchlist';
        el('dlg-watch').onclick = () => {
          if (watchlist.includes(s.symbol)) {
            watchlist = watchlist.filter(x => x !== s.symbol);
          } else {
            watchlist = [s.symbol, ...watchlist];
          }
          saveWatchlist(watchlist);
          el('dlg-watch').textContent = watchlist.includes(s.symbol) ? '★ In Watchlist (Remove)' : '☆ Add to Watchlist';
          renderWatchlistBar();
        };

        el('dlg-open-sim').onclick = () => {
          dlg.close();
          root.location.hash = '#options-simulator';
          setTimeout(() => {
            const simSearch = document.getElementById('opstra-symbol-search');
            if (simSearch) {
              simSearch.value = s.symbol;
              simSearch.dispatchEvent(new Event('input', { bubbles: true }));
              simSearch.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
            }
          }, 120);
        };

        el('dlg-open-builder').onclick = () => {
          dlg.close();
          root.location.hash = '#builder-start';
          const symInput = document.getElementById('symbol');
          const spotInput = document.getElementById('spot');
          const mktForm = document.getElementById('market-form');
          if (symInput) symInput.value = s.symbol;
          if (spotInput && s.price) spotInput.value = String(Math.round(s.price * 100) / 100);
          if (mktForm) mktForm.requestSubmit?.();
        };

        // Render 1D Intraday ECharts line chart
        if (root.echarts) {
          if (!modalChart) {
            modalChart = root.echarts.init(el('dlg-chart'));
          } else {
            modalChart.resize();
          }
          const dark = isDarkTheme();
          if (chartPts && chartPts.length > 1) {
            el('dlg-chart-meta').textContent = `${chartPts[0].time} – ${chartPts[chartPts.length - 1].time} IST (${chartPts.length} pts)`;
            const lineCol = isPos ? '#16a34a' : '#dc2626';
            const prices = chartPts.map(p => p.price);
            const minP = Math.min(...prices, s.previousClose || Infinity);
            const maxP = Math.max(...prices, s.previousClose || -Infinity);
            const pad = Math.max(0.5, (maxP - minP) * 0.08);
            modalChart.setOption(
              {
                grid: { left: 52, right: 16, top: 12, bottom: 24 },
                tooltip: { trigger: 'axis' },
                xAxis: {
                  type: 'category',
                  data: chartPts.map(p => p.time),
                  axisLabel: { color: dark ? '#94a3b8' : '#475569', fontSize: 10 },
                },
                yAxis: {
                  type: 'value',
                  min: +(minP - pad).toFixed(2),
                  max: +(maxP + pad).toFixed(2),
                  axisLabel: { color: dark ? '#94a3b8' : '#475569', fontSize: 10 },
                  splitLine: { lineStyle: { color: dark ? '#1e293b' : '#e2e8f0' } },
                },
                series: [
                  {
                    type: 'line',
                    data: prices,
                    showSymbol: false,
                    smooth: 0.15,
                    lineStyle: { color: lineCol, width: 2 },
                    areaStyle: {
                      color: new root.echarts.graphic.LinearGradient(0, 0, 0, 1, [
                        { offset: 0, color: isPos ? 'rgba(22,163,74,0.28)' : 'rgba(220,38,38,0.28)' },
                        { offset: 1, color: 'rgba(0,0,0,0.01)' },
                      ]),
                    },
                    markLine: s.previousClose
                      ? {
                          silent: true,
                          symbol: 'none',
                          lineStyle: { type: 'dashed', color: '#64748b' },
                          data: [{ yAxis: s.previousClose, name: 'Prev Close' }],
                        }
                      : undefined,
                  },
                ],
              },
              true
            );
          } else {
            el('dlg-chart-meta').textContent = 'Session OHLC Summary';
            const fallbackPts = [
              s.previousClose != null ? ['Prev Close', s.previousClose] : null,
              s.open != null ? ['Open', s.open] : null,
              s.low != null ? ['Day Low', s.low] : null,
              s.high != null ? ['Day High', s.high] : null,
              ['LTP', s.price],
            ].filter(Boolean);
            modalChart.setOption(
              {
                grid: { left: 52, right: 16, top: 12, bottom: 24 },
                tooltip: { trigger: 'axis' },
                xAxis: { type: 'category', data: fallbackPts.map(x => x[0]) },
                yAxis: { type: 'value', scale: true },
                series: [{ type: 'line', data: fallbackPts.map(x => x[1]), lineStyle: { width: 2 } }],
              },
              true
            );
          }
        }
      };

      renderModalContent(sLocal, {}, []);
      if (!dlg.open) dlg.showModal();
      setTimeout(() => modalChart?.resize(), 30);

      try {
        const detail = await fetchHeatmapJson(`stock/${encodeURIComponent(symbol)}`);
        if (dlg.open) {
          renderModalContent(detail.quote || sLocal, detail.extra || {}, detail.intradayChart || []);
        }
      } catch {}
    }

    // Wire UI Controls
    el('universe').onchange = () => {
      prefs.universe = el('universe').value;
      zoomedGroup = '';
      savePrefs(prefs);
      if (wsConnected && ws?.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'subscribe', universe: prefs.universe, filters: {} }));
      } else {
        loadUniverseHttp(prefs.universe, false);
      }
    };

    el('size-by').onchange = () => {
      prefs.sizeBy = el('size-by').value;
      savePrefs(prefs);
      renderHeatmap();
    };

    el('color-by').onchange = () => {
      prefs.colorBy = el('color-by').value;
      hiddenBuckets.clear();
      savePrefs(prefs);
      renderHeatmap();
    };

    el('group-by').onchange = () => {
      prefs.groupBy = el('group-by').value;
      zoomedGroup = '';
      savePrefs(prefs);
      renderHeatmap();
    };

    el('sort-by').onchange = () => {
      prefs.sortBy = el('sort-by').value;
      savePrefs(prefs);
      renderHeatmap();
    };

    el('search').oninput = () => {
      const val = el('search').value.trim();
      el('search-clear').hidden = !val;
      clearTimeout(searchDebounce);
      searchDebounce = setTimeout(() => {
        filters.search = val;
        renderHeatmap();
      }, 140);
    };

    el('search-clear').onclick = () => {
      el('search').value = '';
      el('search-clear').hidden = true;
      filters.search = '';
      renderHeatmap();
    };

    el('btn-filters').onclick = () => {
      const dr = el('filter-drawer');
      dr.hidden = !dr.hidden;
      el('btn-filters').setAttribute('aria-expanded', String(!dr.hidden));
    };

    el('filter-drawer').onsubmit = async ev => {
      ev.preventDefault();
      const fd = new FormData(el('filter-drawer'));
      for (const k of Object.keys(filters)) {
        if (k === 'search' || k === 'preset') continue;
        filters[k] = String(fd.get(k) ?? '').trim();
      }
      renderHeatmap();
    };

    el('filter-reset').onclick = () => {
      el('filter-drawer').reset();
      for (const k of Object.keys(filters)) {
        if (k === 'search') continue;
        filters[k] = '';
      }
      renderHeatmap();
    };

    el('clear-all').onclick = () => clearAllFilters();

    host.querySelector('.hm-presets').onclick = ev => {
      const chip = ev.target.closest('.hm-chip[data-preset]');
      if (!chip) return;
      filters.preset = chip.dataset.preset || '';
      renderHeatmap();
    };

    el('btn-zoom-reset').onclick = () => {
      zoomedGroup = '';
      renderHeatmap();
    };

    el('btn-refresh').onclick = () => {
      loadUniverseHttp(prefs.universe, true);
    };

    el('btn-export').onclick = () => {
      if (!chart) return;
      const url = chart.getDataURL({
        type: 'png',
        pixelRatio: 2,
        backgroundColor: isDarkTheme() ? '#030812' : '#ffffff',
      });
      const a = document.createElement('a');
      a.href = url;
      a.download = `iwsm-heatmap-${prefs.universe.toLowerCase().replace(/\s+/g, '-')}.png`;
      document.body.append(a);
      a.click();
      a.remove();
    };

    el('btn-settings').onclick = ev => {
      ev.stopPropagation();
      const pop = el('settings-popover');
      pop.hidden = !pop.hidden;
      el('btn-settings').setAttribute('aria-expanded', String(!pop.hidden));
    };

    document.addEventListener('click', ev => {
      const pop = el('settings-popover');
      if (pop && !pop.hidden && !ev.target.closest('.hm-settings-wrap')) {
        pop.hidden = true;
        el('btn-settings').setAttribute('aria-expanded', 'false');
      }
    });

    for (const [id, key] of [
      ['opt-logos', 'showLogos'],
      ['opt-labels', 'showLabels'],
      ['opt-prices', 'showPrices'],
      ['opt-pct', 'showPct'],
      ['opt-company', 'showCompanyName'],
    ]) {
      el(id).onchange = () => {
        prefs[key] = el(id).checked;
        savePrefs(prefs);
        renderHeatmap();
      };
    }

    el('btn-fullscreen').onclick = async () => {
      const shell = el('shell');
      if (document.fullscreenElement === shell) {
        await document.exitFullscreen().catch(() => {});
        shell.classList.remove('hm-fullscreen');
        el('btn-fullscreen').setAttribute('aria-pressed', 'false');
      } else if (shell.classList.contains('hm-fullscreen')) {
        shell.classList.remove('hm-fullscreen');
        el('btn-fullscreen').setAttribute('aria-pressed', 'false');
      } else {
        try {
          if (shell.requestFullscreen) {
            await shell.requestFullscreen();
          } else {
            shell.classList.add('hm-fullscreen');
          }
        } catch {
          shell.classList.add('hm-fullscreen');
        }
        el('btn-fullscreen').setAttribute('aria-pressed', 'true');
      }
      setTimeout(() => chart?.resize(), 80);
    };

    document.addEventListener('fullscreenchange', () => {
      const active = document.fullscreenElement === el('shell') || el('shell').classList.contains('hm-fullscreen');
      el('btn-fullscreen').setAttribute('aria-pressed', String(active));
      setTimeout(() => chart?.resize(), 80);
    });

    el('legend').onclick = ev => {
      const btn = ev.target.closest('[data-bucket-id]');
      if (!btn) return;
      const bid = Number(btn.dataset.bucketId);
      if (hiddenBuckets.has(bid)) hiddenBuckets.delete(bid);
      else hiddenBuckets.add(bid);
      renderHeatmap();
    };

    el('watchlist').onclick = ev => {
      const btn = ev.target.closest('[data-watch-sym]');
      if (btn) openStockModal(btn.dataset.watchSym);
    };

    el('sorted-close').onclick = () => {
      prefs.sortBy = 'default';
      el('sort-by').value = 'default';
      savePrefs(prefs);
      renderHeatmap();
    };

    el('sorted-rows').onclick = ev => {
      const tr = ev.target.closest('[data-row-sym]');
      if (tr) openStockModal(tr.dataset.rowSym);
    };

    el('dlg-close').onclick = () => el('stock-dialog').close();

    // Observe theme switches (<html data-theme="light|dark">) & resize
    const themeObs = new MutationObserver(() => {
      if (!host.hidden && allUniverseSecurities.size > 0) renderHeatmap();
    });
    themeObs.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });

    const resizeObs = new ResizeObserver(() => {
      if (!host.hidden && chart) chart.resize();
    });
    resizeObs.observe(el('stage'));

    async function activateIfVisible() {
      if (host.hidden) {
        disconnectWebSocket();
        return;
      }
      if (!universesList.length) {
        await refreshUniversesDropdown();
      }
      if (allUniverseSecurities.size === 0) {
        await loadUniverseHttp(prefs.universe, false);
      }
      connectWebSocket();
      setTimeout(() => {
        ensureChart()?.resize();
        renderHeatmap();
      }, 40);
    }

    root.addEventListener('hashchange', activateIfVisible);
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) disconnectWebSocket();
      else if (!host.hidden) connectWebSocket();
    });

    activateIfVisible();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => mountHeatmap(document.getElementById('market-heatmap')));
  } else {
    mountHeatmap(document.getElementById('market-heatmap'));
  }
})(window);

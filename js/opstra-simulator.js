/* IWSM Options Simulator shell. Market data, snapshot recording, analytics, and execution are driven by IWSMOpstraReplay. */
(function (root) {
  'use strict';

  function init() {
    const host = document.getElementById('options-simulator');
    if (!host || host.dataset.replayMounted) return;

    host.innerHTML = `
      <div id="opstra-simulator-root">
        <!-- Top Header -->
        <header class="opstra-top-header">
          <div class="opstra-title-wrap">
            <h1 class="opstra-main-title">Options Simulator</h1>
            <span class="opstra-market-pill" id="opstra-market-status" role="status">Checking IST session…</span>
          </div>
          <div class="opstra-top-actions">
            <button type="button" class="opstra-btn-navy" id="opstra-btn-new">+ NEW SIMULATION</button>
            <button type="button" class="opstra-btn-navy" id="opstra-btn-live-chain" title="Fetch live exchange option-chain snapshot">⚡ LIVE CHAIN</button>
            <button type="button" class="opstra-btn-navy" id="opstra-btn-recorder" title="Historical option-chain snapshot recorder & coverage">🗄 SNAPSHOT STORE</button>
            <button type="button" class="opstra-btn-navy" id="opstra-btn-simulations">↻ SIMULATIONS</button>
            <button type="button" class="opstra-btn-navy" id="opstra-btn-liquidity">LIQUIDITY GUIDELINES</button>
          </div>
        </header>

        <!-- Instrument Search & Market Information Panel -->
        <div class="opstra-meta-strip">
          <div class="opstra-symbol-block">
            <div class="opstra-symbol-picker-row">
              <div class="opstra-search-box">
                <input
                  type="search"
                  id="opstra-symbol-search"
                  class="opstra-symbol-search"
                  placeholder="Filter symbol (NIFTY, SENSEX, RELIANCE…)"
                  aria-label="Search Index or Stock F&O instrument"
                  autocomplete="off"
                >
              </div>
              <select id="opstra-symbol-select" class="opstra-symbol-select" aria-label="Select Index or Stock">
                <option value="nse_fo|NIFTY" selected>NIFTY</option>
              </select>
            </div>
            <div id="opstra-search-matches" class="opstra-search-matches" role="listbox" aria-label="Matching F&amp;O instruments" hidden></div>
            <span class="opstra-helper-text" id="opstra-instrument-meta">Select Index/Stock · Loading F&amp;O contract directory…</span>

            <div class="opstra-badges-row" aria-label="Underlying and volatility summary">
              <span class="opstra-badge opstra-badge-spot" title="Observed underlying cash/index price">Spot: <strong id="opstra-val-spot">—</strong></span>
              <span class="opstra-badge opstra-badge-future" title="Observed nearest/matched futures contract price">Futures: <strong id="opstra-val-future">—</strong></span>
              <span class="opstra-badge opstra-badge-lot" title="At-the-money strike">ATM: <strong id="opstra-val-atm">—</strong></span>
              <span class="opstra-badge opstra-badge-lot" title="Verified contract lot size">Lot Size: <strong id="opstra-val-lot">—</strong></span>
              <span class="opstra-badge opstra-badge-iv" title="ATM Implied Volatility (calculated via BSM/Black-76 when not exchange-supplied)">ATM IV: <strong id="opstra-val-iv">—</strong></span>
              <span class="opstra-badge opstra-badge-vix" title="India VIX volatility index">India VIX: <strong id="opstra-val-vix">—</strong></span>
              <button type="button" class="opstra-badge-btn" id="opstra-btn-iv-chart">NIFTY IV &amp; Skew Chart</button>
            </div>
          </div>

          <div class="opstra-dates-block">
            <div class="opstra-date-field">
              <span class="opstra-date-top-label">Start Date (IST)</span>
              <input type="date" class="opstra-date-input" id="opstra-start-date" aria-label="Select Start Date">
              <span class="opstra-helper-text">Historical / Simulation Start</span>
            </div>
            <div class="opstra-date-field">
              <span class="opstra-date-top-label">Pay-off Target Date</span>
              <input type="date" class="opstra-date-input" id="opstra-payoff-date" aria-label="Select Pay-off Date">
              <span class="opstra-helper-text">Scenario / Expiry Date</span>
            </div>
          </div>
        </div>

        <!-- Expiry, Live Refresh & Playback Toolbar -->
        <section class="opstra-controls-section" aria-label="Simulation and Timeframe Controls">
          <div class="opstra-expiry-row">
            <div class="opstra-expiry-left">
              <div>
                <select id="opstra-expiry-select" class="opstra-expiry-select" aria-label="Select Expiry">
                  <option value="">Loading expiries…</option>
                </select>
                <div class="opstra-helper-text" id="opstra-expiry-meta">Select Expiry (Weekly / Monthly)</div>
              </div>
              <div class="opstra-live-bar">
                <button type="button" class="opstra-btn-soft" id="opstra-btn-live-refresh" title="Refresh live option chain snapshot">↻ Refresh</button>
                <label class="opstra-inline-toggle" title="Auto-refresh live option chain">
                  <input type="checkbox" id="opstra-auto-refresh">
                  <span>Auto (10s)</span>
                </label>
                <span class="opstra-freshness-tag" id="opstra-last-updated">Updated: —</span>
              </div>
            </div>

            <div class="opstra-expiry-right">
              <span class="opstra-coverage-tag" id="opstra-snapshot-coverage" title="Earliest genuinely recorded historical option-chain snapshot">Snapshots: checking…</span>
              <button type="button" id="opstra-btn-record" class="opstra-btn-record">
                <span class="opstra-dot-red">●</span> RECORD SIMULATION
              </button>
            </div>
          </div>

          <div class="opstra-playback-bar">
            <div class="opstra-playback-group" role="group" aria-label="Step backward">
              <button type="button" class="opstra-btn-step-back" data-mins="-1440">1 DAY &lt;</button>
              <button type="button" class="opstra-btn-step-back" data-mins="-60">60 MIN &lt;-</button>
              <button type="button" class="opstra-btn-step-back" data-mins="-30">30 MIN &lt;-</button>
              <button type="button" class="opstra-btn-step-back" data-mins="-15">15 MIN &lt;-</button>
              <button type="button" class="opstra-btn-step-back" data-mins="-5">5 MIN &lt;-</button>
              <button type="button" class="opstra-btn-step-back" data-mins="-1">1 MIN &lt;-</button>
            </div>

            <div class="opstra-playback-group opstra-playback-center" role="group" aria-label="Playback speed and transport">
              <button type="button" id="opstra-btn-rewind" class="opstra-btn-step-back" title="Rewind cursor to start of loaded window">⏮ RESET</button>

              <div class="opstra-select-with-sub">
                <select id="opstra-timeframe" aria-label="Timeframe">
                  <option value="1">1 Min</option>
                  <option value="5" selected>5 Min</option>
                  <option value="15">15 Min</option>
                  <option value="30">30 Min</option>
                  <option value="60">60 Min</option>
                  <option value="1440">1 Day</option>
                </select>
                <small>Timeframe</small>
              </div>

              <div class="opstra-select-with-sub">
                <select id="opstra-speed" aria-label="Playback Speed">
                  <option value="500">0.5 sec</option>
                  <option value="1000">1 sec</option>
                  <option value="2000">2 sec</option>
                  <option value="3000" selected>3 sec</option>
                  <option value="5000">5 sec</option>
                </select>
                <small>Speed</small>
              </div>

              <button type="button" id="opstra-btn-play" class="opstra-btn-play">
                <span id="opstra-play-icon">▶</span> PLAY
              </button>
            </div>

            <div class="opstra-playback-group" role="group" aria-label="Step forward">
              <button type="button" class="opstra-btn-step-fwd opstra-step-terracotta" data-mins="1">-&gt; 1 MIN</button>
              <button type="button" class="opstra-btn-step-fwd opstra-step-terracotta" data-mins="5">-&gt; 5 MIN</button>
              <button type="button" class="opstra-btn-step-fwd opstra-step-slate" data-mins="15">-&gt; 15 MIN</button>
              <button type="button" class="opstra-btn-step-fwd opstra-step-mednavy" data-mins="30">-&gt; 30 MIN</button>
              <button type="button" class="opstra-btn-step-fwd opstra-step-mednavy" data-mins="60">-&gt; 60 MIN</button>
              <button type="button" class="opstra-btn-step-fwd opstra-step-darknavy" data-mins="1440">&gt; 1 DAY</button>
            </div>
          </div>

          <div class="opstra-clock-row">
            <div class="opstra-clock-jump"></div>
            <div class="opstra-sim-clock" id="opstra-sim-clock">Loading replay…</div>
            <div class="opstra-clock-actions">
              <button type="button" class="opstra-btn-navy" id="opstra-btn-strategies">STRATEGIES</button>
              <button type="button" class="opstra-btn-navy" id="opstra-btn-get-chain" aria-expanded="true">OPTION CHAIN</button>
            </div>
          </div>
        </section>

        <!-- Middle Section: Multi-Leg Strategy Builder, Positions & Payoff / Greeks / P&L -->
        <div class="opstra-middle-section" id="opstra-middle-section">
          <!-- Left: Strategy Builder & Positions Card -->
          <div class="opstra-positions-card">
            <div>
              <div class="opstra-card-header">
                <span class="opstra-card-title">Strategy Positions</span>
                <div class="opstra-card-header-actions">
                  <button type="button" class="opstra-btn-soft" id="opstra-btn-toggle-builder" aria-expanded="true">+ Leg Builder</button>
                  <button type="button" class="opstra-btn-reset" id="opstra-btn-reset" title="Clear all positions and start fresh">RESET</button>
                </div>
              </div>

              <!-- Flexible Multi-Leg Strategy Builder Form -->
              <form id="opstra-leg-builder" class="opstra-leg-builder" aria-label="Custom Option Leg Builder">
                <div class="opstra-builder-grid">
                  <label>Side
                    <select name="side" id="opstra-build-side" aria-label="Buy or Sell">
                      <option value="1">BUY (+)</option>
                      <option value="-1">SELL (−)</option>
                    </select>
                  </label>
                  <label>Type
                    <select name="type" id="opstra-build-type" aria-label="Option or Futures Type">
                      <option value="CE">CE (Call)</option>
                      <option value="PE">PE (Put)</option>
                      <option value="FUT">FUT</option>
                    </select>
                  </label>
                  <label>Expiry
                    <select name="expiry" id="opstra-build-expiry" aria-label="Leg Expiry"></select>
                  </label>
                  <label>Strike
                    <select name="strike" id="opstra-build-strike" aria-label="Leg Strike"></select>
                  </label>
                  <label>Lots
                    <input type="number" name="lots" id="opstra-build-lots" min="1" max="1000" value="1" aria-label="Leg Lots">
                  </label>
                  <label>Entry ₹
                    <input type="number" name="entryPrice" id="opstra-build-price" min="0" step="0.05" placeholder="Mkt" aria-label="Editable Entry Premium">
                  </label>
                </div>
                <div class="opstra-builder-foot">
                  <small id="opstra-build-quote-hint">Market quote auto-fills; edit Entry ₹ to override.</small>
                  <button type="submit" class="opstra-btn-navy">+ ADD LEG</button>
                </div>
              </form>

              <div class="opstra-positions-list" id="opstra-positions-list"></div>
            </div>

            <table class="opstra-metrics-table" aria-label="Strategy payoff summary metrics">
              <tbody>
                <tr><td>Max. Profit</td><td id="opstra-metric-maxprofit">—</td></tr>
                <tr><td>Max. Loss</td><td id="opstra-metric-maxloss">—</td></tr>
                <tr><td>Net Premium</td><td id="opstra-metric-netpremium">—</td></tr>
                <tr><td>Risk / Reward</td><td id="opstra-metric-rr">—</td></tr>
                <tr><td>Breakevens</td><td id="opstra-metric-breakevens">—</td></tr>
                <tr><td>Total PNL</td><td id="opstra-metric-totalpnl">—</td></tr>
              </tbody>
            </table>
          </div>

          <!-- Right: Interactive Payoff Chart, Greeks & P&L Card -->
          <div class="opstra-payoff-card">
            <div class="opstra-payoff-tabs-row">
              <div class="opstra-payoff-tabs" role="tablist" aria-label="Strategy analysis views">
                <button type="button" class="opstra-tab-btn active" data-tab="payoff">
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 3v18h18"/><path d="M19 9l-5 5-4-4-3 3"/></svg>
                  PAYOFF CHART
                </button>
                <button type="button" class="opstra-tab-btn" data-tab="greeks">
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><path d="M12 6v12M6 12h12"/></svg>
                  GREEKS
                </button>
                <button type="button" class="opstra-tab-btn" data-tab="pnl">
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18M9 21V9"/></svg>
                  P&amp;L
                </button>
              </div>

              <div class="opstra-payoff-tools">
                <button type="button" class="opstra-icon-btn" id="opstra-btn-refresh" title="Recalculate payoff and Greeks">↻</button>
                <div class="opstra-toggle-group">
                  <span>SPOT</span>
                  <label class="opstra-switch" title="Toggle Spot / Futures basis">
                    <input type="checkbox" id="opstra-basis-toggle">
                    <span class="opstra-slider"></span>
                  </label>
                  <span>FUTURES</span>
                </div>
              </div>
            </div>

            <div class="opstra-chart-title" id="opstra-chart-title">NIFTY</div>
            <div class="opstra-chart-container" id="opstra-chart-container"></div>

            <div class="opstra-greeks-strip">
              <span>Positional Delta: <strong id="opstra-pos-delta">—</strong></span>
              <span>Theta: <strong id="opstra-pos-theta">—</strong></span>
              <span>Gamma: <strong id="opstra-pos-gamma">—</strong></span>
              <span>Vega: <strong id="opstra-pos-vega">—</strong></span>
              <span>Rho: <strong id="opstra-pos-rho">—</strong></span>
              <span class="opstra-right-pnl">Total PNL: <strong id="opstra-strip-pnl">—</strong></span>
            </div>
          </div>
        </div>

        <!-- Option Chain Section -->
        <section class="opstra-chain-section" id="opstra-chain-section" aria-label="Option Chain">
          <div class="opstra-chain-header">
            <div class="opstra-chain-filters">
              <input
                type="search"
                id="opstra-chain-search"
                class="opstra-chain-search"
                placeholder="Filter strike (e.g. 24000)"
                aria-label="Filter option chain by strike"
              >
              <select id="opstra-chain-range" aria-label="Strike range around ATM">
                <option value="15">ATM ±15 Strikes</option>
                <option value="25" selected>ATM ±25 Strikes</option>
                <option value="0">All Strikes</option>
              </select>
              <button type="button" class="opstra-btn-soft" id="opstra-btn-center-atm" title="Scroll Option Chain to ATM strike">⌖ ATM</button>
              <label class="opstra-inline-toggle" title="Show Chg OI, Volume, and Bid/Ask columns">
                <input type="checkbox" id="opstra-chain-detail-cols">
                <span>Full Columns</span>
              </label>
              <label class="opstra-inline-toggle" title="Add legs immediately on B/S click without confirmation dialog">
                <input type="checkbox" id="opstra-quick-trade">
                <span>1-Click B/S</span>
              </label>
            </div>

            <h2 class="opstra-chain-title" id="opstra-chain-title">Option Chain</h2>

            <div class="opstra-chain-right-controls">
              <span class="opstra-chain-futures-quote">Futures: <strong id="opstra-chain-fut-price">—</strong></span>
              <div class="opstra-stepper">
                <button type="button" id="opstra-lot-minus" aria-label="Decrease lots">−</button>
                <input type="number" id="opstra-chain-lots" value="1" min="1" max="1000" aria-label="Lot quantity">
                <button type="button" id="opstra-lot-plus" aria-label="Increase lots">+</button>
              </div>
              <button type="button" id="opstra-btn-fut-sell" class="opstra-btn-fut-sell">SELL FUT</button>
              <button type="button" id="opstra-btn-fut-buy" class="opstra-btn-fut-buy">BUY FUT</button>
            </div>
          </div>

          <div class="opstra-chain-legend" id="opstra-chain-legend">
            <span><i class="opstra-swatch-itm"></i> ITM</span>
            <span><i class="opstra-swatch-atm"></i> ATM Strike</span>
            <span><i class="opstra-swatch-pos"></i> Active Strategy Strike</span>
            <span class="opstra-greeks-attribution">IV &amp; Greeks: Calculated (European BSM / Black-76, ACT/365) unless exchange-attributed</span>
          </div>

          <div class="opstra-table-container" id="opstra-chain-scroll">
            <table class="opstra-chain-table" aria-label="Option chain strike quotes and actions">
              <thead id="opstra-chain-head">
                <tr class="opstra-chain-group-row">
                  <td class="opstra-group-cell opstra-group-call opstra-group-side" colspan="5" role="presentation"><span class="opstra-side-dot call" aria-hidden="true"></span>CALL OPTIONS (CE)</td>
                  <td class="opstra-group-cell opstra-group-strike" role="presentation">STRIKE</td>
                  <td class="opstra-group-cell opstra-group-put opstra-group-side" colspan="5" role="presentation"><span class="opstra-side-dot put" aria-hidden="true"></span>PUT OPTIONS (PE)</td>
                </tr>
                <tr class="opstra-chain-cols-row">
                  <th scope="col" class="opstra-th-call opstra-th-act">Call B/S</th>
                  <th scope="col" class="opstra-th-call">Call OI</th>
                  <th scope="col" class="opstra-th-call opstra-col-detail" hidden>Call Chg OI</th>
                  <th scope="col" class="opstra-th-call opstra-col-detail" hidden>Call Vol</th>
                  <th scope="col" class="opstra-th-call opstra-col-detail" hidden>Call Bid / Ask</th>
                  <th scope="col" class="opstra-th-call opstra-th-ltp">Call LTP</th>
                  <th scope="col" class="opstra-th-call">Call IV</th>
                  <th scope="col" class="opstra-th-call opstra-th-delta">Call Delta</th>
                  <th scope="col" class="opstra-th-strike">Strike</th>
                  <th scope="col" class="opstra-th-put opstra-th-delta">Put Delta</th>
                  <th scope="col" class="opstra-th-put">Put IV</th>
                  <th scope="col" class="opstra-th-put opstra-th-ltp">Put LTP</th>
                  <th scope="col" class="opstra-th-put opstra-col-detail" hidden>Put Bid / Ask</th>
                  <th scope="col" class="opstra-th-put opstra-col-detail" hidden>Put Vol</th>
                  <th scope="col" class="opstra-th-put opstra-col-detail" hidden>Put Chg OI</th>
                  <th scope="col" class="opstra-th-put">Put OI</th>
                  <th scope="col" class="opstra-th-put opstra-th-act">Put B/S</th>
                </tr>
              </thead>
              <tbody id="opstra-chain-body"></tbody>
            </table>
          </div>
        </section>

        <!-- Modals Container -->
        <div id="opstra-modal-container"></div>
      </div>
    `;

    root.IWSMOpstraReplay.install(host);
  }

  root.OpstraSimulator = { init };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})(window);

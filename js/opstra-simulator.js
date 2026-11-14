/* IWSM reference-style simulator shell. Market data and execution are supplied by the replay controller. */
(function(root){'use strict';
function init(){const host=document.getElementById('options-simulator');if(!host||host.dataset.replayMounted)return;
    host.innerHTML = `
      <div id="opstra-simulator-root">
        <!-- Top Header -->
        <header class="opstra-top-header">
          <h1 class="opstra-main-title">Options Simulator</h1>
          <div class="opstra-top-actions">
            <button type="button" class="opstra-btn-navy" id="opstra-btn-new">+ NEW SIMULATION</button>
            <button type="button" class="opstra-btn-navy" id="opstra-btn-simulations">↻ SIMULATIONS</button>
            <button type="button" class="opstra-btn-navy" id="opstra-btn-liquidity">LIQUIDITY GUIDELINES</button>
          </div>
        </header>

        <!-- Instrument & Meta Strip -->
        <div class="opstra-meta-strip">
          <div class="opstra-symbol-block">
            <select id="opstra-symbol-select" class="opstra-symbol-select" aria-label="Select Index or Stock">
              <option value="NIFTY" selected>NIFTY</option>
              <option value="BANKNIFTY">BANKNIFTY</option>
              <option value="FINNIFTY">FINNIFTY</option>
              <option value="RELIANCE">RELIANCE</option>
            </select>
            <span class="opstra-helper-text">Select Index/Stock</span>
            <div class="opstra-badges-row">
              <span class="opstra-badge opstra-badge-spot">Spot Price: <strong id="opstra-val-spot">—</strong></span>
              <span class="opstra-badge opstra-badge-future">Futures Price: <strong id="opstra-val-future">—</strong></span>
              <span class="opstra-badge opstra-badge-lot">Lot Size: <strong id="opstra-val-lot">—</strong></span>
              <span class="opstra-badge opstra-badge-iv">IV: <strong id="opstra-val-iv">—</strong></span>
              <button type="button" class="opstra-badge-btn" id="opstra-btn-iv-chart">NIFTY IV Chart</button>
            </div>
          </div>

          <div class="opstra-dates-block">
            <div class="opstra-date-field">
              <span class="opstra-date-top-label">Date</span>
              <input type="text" class="opstra-date-input" id="opstra-start-date" value="17-10-2026" readonly>
              <span class="opstra-helper-text">Select Start Date</span>
            </div>
            <div class="opstra-date-field">
              <span class="opstra-date-top-label">Date</span>
              <input type="text" class="opstra-date-input" id="opstra-payoff-date" value="27-10-2026" readonly>
              <span class="opstra-helper-text">Select Pay-off Date</span>
            </div>
          </div>
        </div>

        <!-- Expiry & Playback Toolbar -->
        <section class="opstra-controls-section" aria-label="Simulation Controls">
          <div class="opstra-expiry-row">
            <div>
              <select id="opstra-expiry-select" class="opstra-expiry-select" aria-label="Select Expiry">
                <option value="27OCT2026" selected>27OCT2026</option>
                <option value="19OCT2026">19OCT2026</option>
                <option value="26NOV2026">26NOV2026</option>
              </select>
              <div class="opstra-helper-text">Select Expiry</div>
            </div>
            <button type="button" id="opstra-btn-record" class="opstra-btn-record">
              <span class="opstra-dot-red">●</span> RECORD SIMULATION
            </button>
          </div>

          <div class="opstra-playback-bar">
            <div class="opstra-playback-group">
              <button type="button" class="opstra-btn-step-back" data-mins="-1440">1 DAY &lt;</button>
              <button type="button" class="opstra-btn-step-back" data-mins="-30">30 MIN &lt;-</button>
              <button type="button" class="opstra-btn-step-back" data-mins="-15">15 MIN &lt;-</button>
              <button type="button" class="opstra-btn-step-back" data-mins="-5">5 MIN &lt;-</button>
              <button type="button" class="opstra-btn-step-back" data-mins="-1">1 MIN &lt;-</button>
            </div>

            <div class="opstra-playback-group">
              <div class="opstra-select-with-sub">
                <select id="opstra-timeframe" aria-label="Timeframe">
                  <option value="1">1 Min</option>
                  <option value="5" selected>5 Min</option>
                  <option value="15">15 Min</option>
                  <option value="30">30 Min</option>
                  <option value="1440">1 Day</option>
                </select>
                <small>Timeframe</small>
              </div>

              <div class="opstra-select-with-sub">
                <select id="opstra-speed" aria-label="Speed">
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

            <div class="opstra-playback-group">
              <button type="button" class="opstra-btn-step-fwd opstra-step-terracotta" data-mins="1">-&gt; 1 MIN</button>
              <button type="button" class="opstra-btn-step-fwd opstra-step-terracotta" data-mins="5">-&gt; 5 MIN</button>
              <button type="button" class="opstra-btn-step-fwd opstra-step-slate" data-mins="15">-&gt; 15 MIN</button>
              <button type="button" class="opstra-btn-step-fwd opstra-step-mednavy" data-mins="30">-&gt; 30 MIN</button>
              <button type="button" class="opstra-btn-step-fwd opstra-step-darknavy" data-mins="1440">&gt; 1 DAY</button>
            </div>
          </div>

          <div class="opstra-clock-row">
            <div></div>
            <div class="opstra-sim-clock" id="opstra-sim-clock">Loading replay…</div>
            <div class="opstra-clock-actions">
              <button type="button" class="opstra-btn-navy" id="opstra-btn-strategies">STRATEGIES</button>
              <button type="button" class="opstra-btn-navy" id="opstra-btn-get-chain">GET OPTION CHAIN</button>
            </div>
          </div>
        </section>

        <!-- Middle Section: Strategy Positions & Payoff Chart (Image 2) -->
        <div class="opstra-middle-section" id="opstra-middle-section">
          <!-- Left: Strategy Positions Card -->
          <div class="opstra-positions-card">
            <div>
              <div class="opstra-card-header">
                <span class="opstra-card-title">Strategy Positions</span>
                <button type="button" class="opstra-btn-reset" id="opstra-btn-reset">RESET</button>
              </div>
              <div class="opstra-positions-list" id="opstra-positions-list"></div>
            </div>

            <table class="opstra-metrics-table">
              <tbody>
                <tr><td>Max. Profit</td><td id="opstra-metric-maxprofit">—</td></tr>
                <tr><td>Max. Loss</td><td id="opstra-metric-maxloss">—</td></tr>
                <tr><td>Breakevens</td><td id="opstra-metric-breakevens">—</td></tr>
                <tr><td>Total PNL</td><td id="opstra-metric-totalpnl">—</td></tr>
              </tbody>
            </table>
          </div>

          <!-- Right: Interactive Payoff Chart & Greeks Card -->
          <div class="opstra-payoff-card">
            <div class="opstra-payoff-tabs-row">
              <div class="opstra-payoff-tabs">
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
                <button type="button" class="opstra-icon-btn" id="opstra-btn-refresh" title="Recalculate">↻</button>
                <div class="opstra-toggle-group">
                  <span>SPOT</span>
                  <label class="opstra-switch" title="Toggle Spot / Futures basis">
                    <input type="checkbox" id="opstra-basis-toggle" checked>
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
              <span class="opstra-right-pnl">Total PNL: <strong id="opstra-strip-pnl">—</strong></span>
            </div>
          </div>
        </div>

        <!-- Option Chain Section -->
        <section class="opstra-chain-section" id="opstra-chain-section" aria-label="Option Chain">
          <div class="opstra-chain-header">
            <h2 class="opstra-chain-title" id="opstra-chain-title">Option Chain</h2>
            <div class="opstra-chain-right-controls">
              <span class="opstra-chain-futures-quote">Futures: <strong id="opstra-chain-fut-price">—</strong></span>
              <div class="opstra-stepper">
                <button type="button" id="opstra-lot-minus" aria-label="Decrease lots">−</button>
                <input type="number" id="opstra-chain-lots" value="1" min="1" max="100" aria-label="Lot quantity">
                <button type="button" id="opstra-lot-plus" aria-label="Increase lots">+</button>
              </div>
              <button type="button" id="opstra-btn-fut-sell" class="opstra-btn-fut-sell">SELL</button>
              <button type="button" id="opstra-btn-fut-buy" class="opstra-btn-fut-buy">BUY</button>
            </div>
          </div>

          <div class="opstra-table-container">
            <table class="opstra-chain-table" aria-label="Option chain strike quotes and actions">
              <thead>
                <tr>
                  <th scope="col" style="text-align:center;">Actions</th>
                  <th scope="col">CallOI</th>
                  <th scope="col">CallLTP</th>
                  <th scope="col">CallIV</th>
                  <th scope="col">CallDelta</th>
                  <th scope="col" class="opstra-th-strike">Strikes</th>
                  <th scope="col">PutDelta</th>
                  <th scope="col">PutIV</th>
                  <th scope="col">PutLTP</th>
                  <th scope="col">PutOI</th>
                  <th scope="col" style="text-align:center;">Actions</th>
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
root.OpstraSimulator={init};
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init);else init();
})(window);

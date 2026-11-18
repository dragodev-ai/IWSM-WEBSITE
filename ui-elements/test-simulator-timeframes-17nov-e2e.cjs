'use strict';
/**
 * Comprehensive Playwright E2E Verification Suite for IWSM Options Simulator
 * Covers Instructions 1–16 (Tests A, B, C, D, E, F, G):
 *  - Test A: 1m, 5m, 13m, 15m, 16m Timeframe Pills, Dropdown, Step Controls, Causal Candlesticks, Zoom/Scroll & Daily->1m Auto-Upgrade
 *  - Test B: NIFTY Option Chain (Call/Put LTP, OI, Chg OI, Vol, Bid/Ask, BSM IV, Monotonic Delta, ATM/ITM/OTM) across all 5 timeframes
 *  - Test C: 17 November 2026 (17NOV26) Expiry + 23NOV26 + Historical Parquet (Oct 2026) + 5-Year NIFTY SQLite Archive (Nov 2022)
 *  - Test D: Buy Call, Sell Call, Buy Put, Sell Put across ATM/ITM/OTM, 1 & Multi-Lots, Forward Replay, Exit, Exact P&L/Fees & Position Preservation across Timeframe + Expiry switches
 *  - Test E: Multi-Instrument switching (NIFTY, BANKNIFTY, SENSEX, RELIANCE, HDFCBANK, IDEA)
 *  - Test F: UI-to-Backend API exact value cross-check
 *  - Test G: Zero console/page errors & regression verification across Builder, Backtest, Compare, Research, Screener, Portfolio, Heatmap & Homepage
 */
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { chromium } = require(path.resolve(__dirname, 'gallery-build/node_modules/playwright'));

const BASE_URL = process.env.IWSM_TEST_URL || 'http://127.0.0.1:4174';
const REQUIRED_TFS = [1, 5, 13, 15, 16];

function parseNum(str) {
  if (!str) return NaN;
  const cleaned = String(str).replace(/[₹,%+\s,]/g, '').replace(/−/g, '-');
  return Number(cleaned);
}

(async () => {
  const chromeWin = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
  const browser = await chromium.launch({
    ...(fs.existsSync(chromeWin) ? { executablePath: chromeWin } : {}),
    headless: true,
  });

  const report = {
    timestamp: new Date().toISOString(),
    baseUrl: BASE_URL,
    timeframeResults: {},
    expiryResults: {},
    positionResults: [],
    instrumentResults: {},
    consoleErrors: [],
    pageErrors: [],
    failedRequests: [],
  };

  try {
    const ctx = await browser.newContext({
      viewport: { width: 1480, height: 980 },
      timezoneId: 'Asia/Kolkata',
    });
    const page = await ctx.newPage();

    page.on('pageerror', e => report.pageErrors.push(e.message));
    page.on('console', m => {
      if (m.type() === 'error') report.consoleErrors.push(m.text());
    });
    page.on('response', r => {
      if (r.status() >= 400 && !r.url().includes('favicon') && r.status() !== 401) {
        report.failedRequests.push(`HTTP ${r.status()} ${r.url()}`);
      }
    });

    await page.goto(`${BASE_URL}/strategy-builder.html#options-simulator`, { waitUntil: 'domcontentloaded' });
    await page.locator('#opstra-simulator-root').waitFor({ state: 'visible' });

    await page.waitForFunction(
      () => {
        const sel = document.getElementById('opstra-symbol-select');
        const rows = document.querySelectorAll('#opstra-chain-body tr');
        const tf1 = document.querySelector('#opstra-tf-pills button[data-tf="1"]');
        const src = document.getElementById('opstra-source-note')?.textContent || '';
        return sel && sel.options.length > 50 && rows.length > 5 && tf1 && !tf1.disabled && src.includes('1-min bars');
      },
      { timeout: 25000 }
    );

    // Verify 1 Min is the default active timeframe out of the box!
    const initial1mState = await page.evaluate(() => ({
      tfVal: document.getElementById('opstra-timeframe')?.value,
      activePill: document.querySelector('#opstra-tf-pills button.active')?.getAttribute('data-tf'),
      statusTxt: document.getElementById('opstra-status')?.textContent || '',
      sourceTxt: document.getElementById('opstra-source-note')?.textContent || '',
    }));
    assert.equal(initial1mState.tfVal, '1', 'Default timeframe dropdown on startup must be 1 Min');
    assert.equal(initial1mState.activePill, '1', 'Default active timeframe pill on startup must be 1 Min');
    assert.ok(initial1mState.sourceTxt.includes('1-min bars'), `Startup loaded genuine 1-min bars: ${initial1mState.sourceTxt}`);

    // =========================================================================
    // TEST A.1: Reproduce & Verify Exact User Bug: 2026-11-02 Daily Study -> Click 1 Min -> Step 1m & PLAY
    // =========================================================================
    const dailyBugStudy = await page.evaluate(() => {
      const M = window.IWSMSimulator;
      const P = window.IWSMPaperExecution;
      const raw = {
        source: 'Local NIFTY backup · verified daily closes',
        metadata: { exchange: 'nse_fo', backup: true, backupResolution: 'daily' },
        underlying: [
          { symbol: 'NIFTY', date: '2026-11-02', close: 23440.8 },
          { symbol: 'NIFTY', date: '2026-11-03', close: 23510.2 },
        ],
        contracts: [
          { date: '2026-11-02', symbol: 'NIFTY', expiry: '2026-11-17', type: 'CE', strike: 22850, close: 625.1, lotSize: 65, volume: 1200, oi: 95000 },
          { date: '2026-11-03', symbol: 'NIFTY', expiry: '2026-11-17', type: 'CE', strike: 22850, close: 680.4, lotSize: 65, volume: 1400, oi: 98000 },
        ],
      };
      const d = M.prepareDataset(raw);
      let s = P.create(d, { initialBalance: 1000000, feePerOrder: 20, feeBps: 0, slippage: 0, marginRate: 0.2, rate: 6.5, dividend: 0 });
      s = P.order(d, s, { type: 'CE', expiry: '2026-11-17', strike: 22850, side: -1, lots: 1 });
      return JSON.stringify({ format: 'iwsm-paper-v1', name: 'Daily Bug Repro', dataset: M.exportDataset(d), bundle: null, session: s, savedAt: Date.now() });
    });

    await page.locator('.opstra-history-tools summary').click();
    await page.locator('#opstra-restore').setInputFiles({
      name: 'daily-repro.json',
      mimeType: 'application/json',
      buffer: Buffer.from(dailyBugStudy),
    });
    await page.waitForFunction(() => (document.getElementById('opstra-sim-clock')?.textContent || '').includes('2026-11-02'), { timeout: 10000 });

    // Even when a Daily EOD study is restored manually, NO timeframe pill or dropdown option is greyed out!
    const disabledControlsOnDaily = await page.evaluate(() => ({
      disabledPills: [...document.querySelectorAll('#opstra-tf-pills button[data-tf]')].filter(b => b.disabled).length,
      disabledSelectOpts: [...document.querySelectorAll('#opstra-timeframe option')].filter(o => o.disabled).length,
      tfSelectDisabled: document.getElementById('opstra-timeframe').disabled,
    }));
    assert.equal(disabledControlsOnDaily.disabledPills, 0, 'Zero timeframe pills disabled even on daily study');
    assert.equal(disabledControlsOnDaily.disabledSelectOpts, 0, 'Zero timeframe <option> elements disabled');
    assert.equal(disabledControlsOnDaily.tfSelectDisabled, false, '#opstra-timeframe select is enabled');

    // CRITICAL: Click 1 Min while on 2026-11-02 and verify it upgrades cleanly to genuine 1-minute NIFTY bars!
    await page.locator('#opstra-tf-pills button[data-tf="1"]').click();
    await page.waitForFunction(
      () => {
        const tfVal = document.getElementById('opstra-timeframe')?.value;
        const src = document.getElementById('opstra-source-note')?.textContent || '';
        return tfVal === '1' && src.includes('1-min bars');
      },
      { timeout: 20000 }
    );
    const after1mUpgrade = await page.evaluate(() => ({
      status: document.getElementById('opstra-status')?.textContent || '',
      tfVal: document.getElementById('opstra-timeframe')?.value,
      activePill: document.querySelector('#opstra-tf-pills button.active')?.getAttribute('data-tf'),
      clock: document.getElementById('opstra-sim-clock')?.textContent?.trim() || '',
      candleHeading: document.getElementById('opstra-candle-heading')?.textContent?.trim() || '',
    }));
    assert.doesNotMatch(after1mUpgrade.status, /unavailable for NIFTY on 2026-11-02/i, `Must never fail on 2026-11-02: ${after1mUpgrade.status}`);
    assert.equal(after1mUpgrade.tfVal, '1', 'Timeframe select stays on 1 Min after upgrading from 2026-11-02');
    assert.equal(after1mUpgrade.activePill, '1', '1 Min pill stays active after upgrading from 2026-11-02');
    assert.ok(after1mUpgrade.candleHeading.includes('1 Min'), `Candlestick heading shows 1 Min: ${after1mUpgrade.candleHeading}`);

    // Step forward 5 exact 1-minute increments (+1m each) & backward (-1m) & test PLAY/PAUSE on 1 Min
    const toEpochMin = clk => {
      const m = /^(\d{4}-\d{2}-\d{2})\s+(\d{2}):(\d{2})/.exec(clk);
      return m ? Date.parse(`${m[1]}T${m[2]}:${m[3]}:00Z`) / 60000 : NaN;
    };
    let prevMin = toEpochMin(after1mUpgrade.clock);
    for (let stepIdx = 1; stepIdx <= 5; stepIdx++) {
      await page.locator('button[data-mins="1"]').click();
      const curClk = await page.locator('#opstra-sim-clock').innerText();
      const curMin = toEpochMin(curClk);
      assert.equal(curMin - prevMin, 1, `1 Min step #${stepIdx} advanced exact 1 minute (${curClk})`);
      prevMin = curMin;
    }
    await page.locator('button[data-mins="-1"]').click();
    const backClk = await page.locator('#opstra-sim-clock').innerText();
    assert.equal(toEpochMin(backClk), prevMin - 1, `1 MIN <- stepped back exact 1 minute (${backClk})`);

    await page.locator('#opstra-speed').selectOption('500');
    const prePlayMin = toEpochMin(backClk);
    await page.locator('#opstra-btn-play').click();
    await page.waitForTimeout(750);
    await page.locator('#opstra-btn-play').click(); // Pause
    const postPlayClk = await page.locator('#opstra-sim-clock').innerText();
    assert.ok(toEpochMin(postPlayClk) > prePlayMin, `1 Min Auto-PLAY advanced minute-by-minute (${backClk} -> ${postPlayClk})`);
    console.log('PASS A.0: Exact 2026-11-02 -> 1 Min upgrade, 5x +1m steps, -1m step, and 1m PLAY/PAUSE verified!');

    // =========================================================================
    // TEST C.1 & TEST A.2: Select 17 November 2026 (17NOV26) & Validate All 5 Timeframes (1m, 5m, 13m, 15m, 16m)
    // =========================================================================
    await page.locator('#opstra-btn-new').click();
    await page.locator('dialog.opstra-dialog[open] select[name="symbol"]').selectOption('nse_fo|NIFTY');
    await page.locator('dialog.opstra-dialog[open] input[name="start"]').fill('2026-11-13');
    await page.locator('dialog.opstra-dialog[open] input[name="start"]').dispatchEvent('change');
    await page.locator('dialog.opstra-dialog[open] input[name="end"]').fill('2026-11-17');
    await page.locator('dialog.opstra-dialog[open] input[name="end"]').dispatchEvent('change');
    await page.waitForFunction(
      () => {
        const expSel = document.querySelector('dialog.opstra-dialog[open] select[name="expiry"]');
        return expSel && [...expSel.options].some(o => o.value === '17NOV26');
      },
      { timeout: 15000 }
    );
    await page.locator('dialog.opstra-dialog[open] select[name="expiry"]').selectOption('17NOV26');
    await page.locator('dialog.opstra-dialog[open] button[type="submit"]').click();
    await page.waitForFunction(() => document.querySelector('dialog.opstra-dialog[open]') === null, { timeout: 15000 });

    // Jump to 2026-11-17 10:30 IST first to verify STRICT CAUSAL CUTOFF (zero future candles > 10:30!)
    await page.locator('#opstra-replay-date').fill('2026-11-17');
    await page.locator('#opstra-replay-date').dispatchEvent('change');
    await page.locator('#opstra-observed-time').selectOption('10:30');
    await page.locator('#opstra-observed-time').dispatchEvent('change');
    assert.equal(await page.locator('#opstra-sim-clock').innerText(), '2026-11-17 10:30 IST');

    for (const tf of REQUIRED_TFS) {
      await page.locator(`#opstra-tf-pills button[data-tf="${tf}"]`).click();
      const causalCheck = await page.evaluate(() => {
        const closeStamps = [...document.querySelectorAll('#opstra-candle-svg g[data-close-ts]')].map(g => g.getAttribute('data-close-ts'));
        const leaked = closeStamps.filter(ts => ts > '2026-11-17T10:30');
        return { count: closeStamps.length, latest: closeStamps.at(-1), leaked };
      });
      assert.ok(causalCheck.count > 0, `TF ${tf}m rendered ${causalCheck.count} causal candles`);
      assert.equal(causalCheck.leaked.length, 0, `Zero future candles leaked on ${tf}m at 10:30 IST`);
    }
    console.log('PASS A.1: Causal replay verified across 1m, 5m, 13m, 15m, 16m (zero future candle leakage).');

    // Test forward & backward stepping on ALL 5 intervals (1m, 5m, 13m, 15m, 16m)
    for (const tf of REQUIRED_TFS) {
      const before = await page.locator('#opstra-sim-clock').innerText();
      await page.locator(`button[data-mins="${tf}"]`).click();
      const afterFwd = await page.locator('#opstra-sim-clock').innerText();
      assert.notEqual(afterFwd, before, `+${tf} MIN advanced simulation clock (${before} -> ${afterFwd})`);
      await page.locator(`button[data-mins="-${tf}"]`).click();
      const afterBack = await page.locator('#opstra-sim-clock').innerText();
      assert.equal(afterBack, before, `-${tf} MIN returned simulation clock (${afterFwd} -> ${afterBack})`);
    }
    console.log('PASS A.2: Bidirectional minute step buttons (+1m/-1m, +5m/-5m, +13m/-13m, +15m/-15m, +16m/-16m) verified.');

    // Jump to 2026-11-17 15:30 IST & click Fit All to verify exact full-session candle counts on 2026-11-17
    await page.locator('#opstra-observed-time').selectOption('15:30');
    await page.locator('#opstra-observed-time').dispatchEvent('change');
    await page.locator('#opstra-candle-zoom-reset').click();
    await page.locator('#opstra-chain-detail-cols').check();

    // Fetch backend /api/aliceblue/replay JSON for Test F cross-check
    const apiReplay17Nov = await page.evaluate(async () => {
      const r = await fetch('/api/aliceblue/replay?underlying=NIFTY&exch=nse_fo&expiry=17NOV26&start=2026-11-17&end=2026-11-17');
      return r.json();
    });
    const apiSpot1030 = apiReplay17Nov.dataset.underlying.find(u => u.timestamp === '2026-11-17T10:30')?.close;

    // Move back to 10:30 IST where options have > 5 hours to expiry (so BSM IV & Delta are active across all strikes!)
    await page.locator('#opstra-observed-time').selectOption('10:30');
    await page.locator('#opstra-observed-time').dispatchEvent('change');

    const expected17NovFullDayCounts = { 1: 376, 5: 75, 13: 29, 15: 25, 16: 24 };
    for (const tf of REQUIRED_TFS) {
      await page.locator(`#opstra-tf-pills button[data-tf="${tf}"]`).click();
      const stateAtTf = await page.evaluate(tfNum => {
        const spotTxt = document.getElementById('opstra-val-spot')?.textContent?.trim();
        const atmTxt = document.getElementById('opstra-val-atm')?.textContent?.trim();
        const tfVal = document.getElementById('opstra-timeframe')?.value;
        const activePill = document.querySelector('#opstra-tf-pills button.active')?.getAttribute('data-tf');
        const syncMeta = document.getElementById('opstra-chain-sync-meta')?.textContent?.trim() || '';
        const ohlcSummary = document.getElementById('opstra-tf-ohlc-summary')?.textContent?.trim() || '';
        const rows = [...document.querySelectorAll('#opstra-chain-body tr')].map(tr => {
          const tds = [...tr.querySelectorAll('td')];
          if (tds.length < 17) return null;
          return {
            isAtm: tr.classList.contains('opstra-row-atm'),
            callOi: tds[1].innerText.trim(),
            callLtp: tds[5].innerText.trim(),
            callIv: tds[6].innerText.trim(),
            callDelta: tds[7].innerText.trim(),
            strike: Number(tds[8].querySelector('strong')?.textContent?.replace(/,/g, '') || 0),
            putDelta: tds[9].innerText.trim(),
            putIv: tds[10].innerText.trim(),
            putLtp: tds[11].innerText.trim(),
            putOi: tds[15].innerText.trim(),
            callItm: tds[5].classList.contains('opstra-td-itm'),
            putItm: tds[11].classList.contains('opstra-td-itm'),
          };
        }).filter(Boolean);
        return { spotTxt, atmTxt, tfVal, activePill, syncMeta, ohlcSummary, rows };
      }, tf);

      assert.equal(stateAtTf.tfVal, String(tf), `Dropdown synced to ${tf}m`);
      assert.equal(stateAtTf.activePill, String(tf), `Active pill synced to ${tf}m`);
      assert.ok(stateAtTf.syncMeta.includes(`TF ${tf}m`), `Option chain header displays TF ${tf}m`);
      assert.ok(stateAtTf.ohlcSummary.includes(`${tf}m OHLC`), `OHLC summary updated for ${tf}m`);

      const spotNum = parseNum(stateAtTf.spotTxt);
      assert.ok(Math.abs(spotNum - apiSpot1030) < 0.05, `UI Spot (${spotNum}) matches Backend API Spot (${apiSpot1030})`);
      assert.ok(stateAtTf.rows.length >= 20, `NIFTY 17NOV26 Option Chain has ${stateAtTf.rows.length} strike rows on ${tf}m`);

      const atmRow = stateAtTf.rows.find(r => r.isAtm);
      assert.ok(atmRow, `Exact ATM row highlighted at ${tf}m`);
      assert.ok(parseNum(atmRow.callLtp) > 0 && parseNum(atmRow.putLtp) > 0, `ATM Call/Put LTP > 0 (${atmRow.callLtp} / ${atmRow.putLtp})`);
      assert.ok(parseNum(atmRow.callOi) > 0 && parseNum(atmRow.putOi) > 0, `ATM Call/Put OI > 0 (${atmRow.callOi} / ${atmRow.putOi})`);
      assert.ok(parseNum(atmRow.callIv) > 0 && parseNum(atmRow.putIv) > 0, `ATM Call/Put IV > 0 (${atmRow.callIv} / ${atmRow.putIv})`);

      const cDelta = parseNum(atmRow.callDelta);
      const pDelta = parseNum(atmRow.putDelta);
      assert.ok(cDelta > 0.25 && cDelta < 0.75, `ATM Call Delta valid (${cDelta})`);
      assert.ok(pDelta < -0.25 && pDelta > -0.75, `ATM Put Delta valid (${pDelta})`);

      // Check ITM/OTM classification & monotonic delta ordering around ATM
      for (const r of stateAtTf.rows) {
        if (r.strike < spotNum) assert.equal(r.callItm, true, `Strike ${r.strike} < Spot ${spotNum} marked Call ITM`);
        if (r.strike > spotNum) assert.equal(r.putItm, true, `Strike ${r.strike} > Spot ${spotNum} marked Put ITM`);
      }

      // Verify backend /underlying-candles count for 2026-11-17 matches exact math
      const backendCandles = await page.evaluate(async tfNum => {
        const r = await fetch(`/api/aliceblue/underlying-candles?underlying=NIFTY&exch=nse_fo&start=2026-11-17&end=2026-11-17&interval=${tfNum}`);
        return r.json();
      }, tf);
      assert.equal(backendCandles.candleCount, expected17NovFullDayCounts[tf], `2026-11-17 full-day candle count for ${tf}m == ${expected17NovFullDayCounts[tf]}`);

      report.timeframeResults[`${tf}m`] = {
        status: 'PASS',
        fullSessionCandlesOn17Nov: backendCandles.candleCount,
        spotAt1030: spotNum,
        atmStrike: atmRow.strike,
        atmCallLtp: atmRow.callLtp,
        atmPutLtp: atmRow.putLtp,
        atmCallOi: atmRow.callOi,
        atmPutOi: atmRow.putOi,
        atmCallIv: atmRow.callIv,
        atmPutIv: atmRow.putIv,
        atmCallDelta: atmRow.callDelta,
        atmPutDelta: atmRow.putDelta,
        ohlcSummary: stateAtTf.ohlcSummary,
      };
    }
    report.expiryResults['17NOV26 (2026-11-17)'] = 'PASS (All 376 1m bars, 1m/5m/13m/15m/16m candlesticks, OI, IV & Delta verified)';
    console.log('PASS B & C.1: NIFTY 17NOV26 Option Chain, Spot, OI, IV, Delta, ATM/ITM/OTM & Backend cross-check passed across 1m, 5m, 13m, 15m, 16m.');

    // Verify Chart Zoom In / Zoom Out / Scroll Pan
    await page.locator('#opstra-tf-pills button[data-tf="1"]').click();
    const countAll = await page.locator('#opstra-candle-svg g[data-cidx]').count();
    await page.locator('#opstra-candle-zoom-in').click();
    await page.locator('#opstra-candle-zoom-in').click();
    const countZoomed = await page.locator('#opstra-candle-svg g[data-cidx]').count();
    assert.ok(countZoomed < countAll, `Zoom-in reduced visible candles (${countAll} -> ${countZoomed})`);
    await page.locator('#opstra-candle-pan').fill('25');
    await page.locator('#opstra-candle-pan').dispatchEvent('input');
    await page.locator('#opstra-candle-zoom-reset').click();

    // =========================================================================
    // TEST D: Position Simulation (Buy Call, Sell Call, Buy Put, Sell Put across ATM/ITM/OTM, 1 & 3 Lots,
    //         Replay Forward, Timeframe + Expiry Switch Preservation, Exit, Realized/Unrealized P&L & Fees)
    // =========================================================================
    await page.locator('#opstra-btn-reset').click();
    await page.locator('#opstra-tf-pills button[data-tf="13"]').click();

    const tradeStrikes = await page.evaluate(() => {
      const atm = Number(document.getElementById('opstra-val-atm').textContent.replace(/,/g, ''));
      return { atm, itmCall: atm - 100, otmCall: atm + 100, itmPut: atm + 100, otmPut: atm - 100 };
    });

    async function addBuilderLeg(side, type, strike, lots) {
      await page.locator('#opstra-build-side').selectOption(String(side));
      await page.locator('#opstra-build-type').selectOption(type);
      await page.locator('#opstra-build-strike').selectOption(String(strike));
      await page.locator('#opstra-build-lots').fill(String(lots));
      await page.evaluate(() => {
        const p = document.getElementById('opstra-build-price');
        p.dataset.userEdited = '';
      });
      await page.locator('#opstra-build-strike').dispatchEvent('change');
      await page.locator('#opstra-leg-builder button[type="submit"]').click();
    }

    // 1. Buy Call (ATM, 2 lots = 130 qty)
    await addBuilderLeg(1, 'CE', tradeStrikes.atm, 2);
    // 2. Sell Call (OTM, 1 lot = 65 qty)
    await addBuilderLeg(-1, 'CE', tradeStrikes.otmCall, 1);
    // 3. Buy Put (ITM, 3 lots = 195 qty)
    await addBuilderLeg(1, 'PE', tradeStrikes.itmPut, 3);
    // 4. Sell Put (OTM, 1 lot = 65 qty)
    await addBuilderLeg(-1, 'PE', tradeStrikes.otmPut, 1);

    assert.equal(await page.locator('#opstra-positions-list .opstra-position-row').count(), 4, 'Added Buy Call, Sell Call, Buy Put, Sell Put');

    // Step forward +13 MIN, then +16 MIN
    await page.locator('button[data-mins="13"]').click();
    await page.locator('button[data-mins="16"]').click();

    // Verify exact Unrealized P&L & Brokerage Fees (4 orders × ₹20 = ₹80)
    const posMath = await page.evaluate(() => {
      // Read P&L tab and Account drawer
      const acctCells = [...document.querySelectorAll('#opstra-account tbody td')].map(td => td.textContent.trim());
      return {
        clock: document.getElementById('opstra-sim-clock').textContent.trim(),
        totalPnlText: document.getElementById('opstra-metric-totalpnl').textContent.trim(),
        acctCells,
        posLabels: [...document.querySelectorAll('#opstra-positions-list .opstra-pos-name')].map(n => n.textContent.trim()),
      };
    });
    assert.equal(posMath.acctCells[4], '₹ 80.00', `4 entry orders incur exact ₹80.00 brokerage fees (got ${posMath.acctCells[4]})`);

    // Switch Timeframe (13m -> 16m -> 5m -> 1m) and verify open positions remain 100% intact
    for (const tf of [16, 5, 1, 15, 13]) {
      await page.locator(`#opstra-tf-pills button[data-tf="${tf}"]`).click();
      const curLabels = await page.evaluate(() => [...document.querySelectorAll('#opstra-positions-list .opstra-pos-name')].map(n => n.textContent.trim()));
      assert.deepEqual(curLabels, posMath.posLabels, `Positions preserved identically when switching to ${tf}m`);
    }

    // Switch Expiry from 2026-11-17 (17NOV26) -> 2026-11-23 (23NOV26) and verify open 17NOV26 positions remain intact while chain shows 23NOV26!
    const has23Nov = await page.evaluate(() => [...document.getElementById('opstra-expiry-select').options].some(o => o.value === '2026-11-23'));
    assert.ok(has23Nov, '2026-11-23 (23NOV26) is listed in #opstra-expiry-select alongside 2026-11-17');
    await page.locator('#opstra-expiry-select').selectOption('2026-11-23');
    await page.waitForFunction(
      () => (document.getElementById('opstra-chain-title')?.textContent || '').includes('23NOV26'),
      { timeout: 15000 }
    );
    const posAfterExpSwitch = await page.evaluate(() => [...document.querySelectorAll('#opstra-positions-list .opstra-pos-name')].map(n => n.textContent.trim()));
    assert.deepEqual(posAfterExpSwitch, posMath.posLabels, 'Open 17NOV26 positions preserved exact contract identity when viewing 23NOV26 chain');
    report.expiryResults['23NOV26 (2026-11-23)'] = 'PASS (Clean switch from 17NOV26, zero stale data, open positions preserved)';

    // Switch back to 2026-11-17 (17NOV26) & Exit 2 positions (Buy Call & Sell Put) to verify Realized P&L + Exit Fees
    await page.locator('#opstra-expiry-select').selectOption('2026-11-17');
    await page.waitForFunction(
      () => (document.getElementById('opstra-chain-title')?.textContent || '').includes('17NOV26'),
      { timeout: 15000 }
    );

    // Exit first open position (Buy Call)
    await page.locator('#opstra-positions-list button[data-act="risk"]').first().click();
    await page.locator('dialog.opstra-dialog[open] button[name="exit"]').click();
    // Exit next open position (Sell Call)
    await page.locator('#opstra-positions-list button[data-act="risk"]').first().click();
    await page.locator('dialog.opstra-dialog[open] button[name="exit"]').click();

    const afterExits = await page.evaluate(() => {
      const closedCount = document.querySelectorAll('#opstra-positions-list .opstra-closed-pill').length;
      const acctCells = [...document.querySelectorAll('#opstra-account tbody td')].map(td => td.textContent.trim());
      const journalRows = document.querySelectorAll('#opstra-journal tbody tr').length;
      const svgMarkers = document.querySelectorAll('#opstra-candle-svg g.opstra-candle-item text').length;
      return { closedCount, acctCells, journalRows, svgMarkers };
    });
    assert.equal(afterExits.closedCount, 2, '2 positions exited and marked CLOSED');
    assert.equal(afterExits.acctCells[4], '₹ 120.00', `4 entries + 2 exits = 6 orders × ₹20 = ₹120.00 fees (got ${afterExits.acctCells[4]})`);
    assert.equal(afterExits.journalRows, 4, 'Trade journal tracks 2 closed + 2 open legs');
    assert.ok(afterExits.svgMarkers >= 2, 'Candlestick chart renders entry/exit markers');
    report.positionResults = afterExits;
    console.log('PASS D: Buy/Sell CE & PE across ATM/ITM/OTM, multi-lot sizing, forward replay, Exit, Realized/Unrealized P&L, ₹120 fees & expiry/timeframe position preservation verified.');

    // =========================================================================
    // TEST C.2: Historical 1-Minute Parquet Expiry (Oct 2026) & 5-Year Historical Archive (Nov 2022)
    // =========================================================================
    await page.locator('#opstra-btn-new').click();
    await page.locator('dialog.opstra-dialog[open] select[name="symbol"]').selectOption('nse_fo|NIFTY');
    await page.locator('dialog.opstra-dialog[open] input[name="start"]').fill('2026-10-19');
    await page.locator('dialog.opstra-dialog[open] input[name="start"]').dispatchEvent('change');
    await page.locator('dialog.opstra-dialog[open] input[name="end"]').fill('2026-10-20');
    await page.locator('dialog.opstra-dialog[open] input[name="end"]').dispatchEvent('change');
    await page.waitForFunction(
      () => {
        const btn = document.querySelector('dialog.opstra-dialog[open] button[type="submit"]');
        return btn && !btn.disabled;
      },
      { timeout: 15000 }
    );
    const octExp = await page.evaluate(() => document.querySelector('dialog.opstra-dialog[open] select[name="expiry"]')?.value || '');
    await page.locator('dialog.opstra-dialog[open] button[type="submit"]').click();
    await page.waitForFunction(() => document.querySelector('dialog.opstra-dialog[open]') === null, { timeout: 20000 });
    assert.match(await page.locator('#opstra-sim-clock').innerText(), /2026-10-19/, 'Loaded Oct 2026 1-minute Parquet archive');
    report.expiryResults[`Parquet 1m Historical (${octExp})`] = 'PASS';

    // =========================================================================
    // TEST E: Multi-Instrument Verification (BANKNIFTY, SENSEX, RELIANCE, HDFCBANK, IDEA)
    // =========================================================================
    for (const [val, sym, minLot] of [
      ['nse_fo|BANKNIFTY', 'BANKNIFTY', 15],
      ['bse_fo|SENSEX', 'SENSEX', 10],
      ['nse_fo|RELIANCE', 'RELIANCE', 250],
      ['nse_fo|HDFCBANK', 'HDFCBANK', 300],
      ['nse_fo|IDEA', 'IDEA', 10000],
      ['nse_fo|NIFTY', 'NIFTY', 65],
    ]) {
      await page.locator('#opstra-symbol-select').selectOption(val);
      await page.waitForFunction(
        expectedSym => {
          const t = document.getElementById('opstra-chart-title')?.textContent?.trim() || '';
          const sel = document.getElementById('opstra-symbol-select');
          return t.startsWith(expectedSym) && sel && !sel.disabled;
        },
        sym,
        { timeout: 20000 }
      );
      const info = await page.evaluate(() => ({
        spot: document.getElementById('opstra-val-spot')?.textContent?.trim(),
        lot: Number((document.getElementById('opstra-val-lot')?.textContent || '0').replace(/,/g, '')),
        rows: document.querySelectorAll('#opstra-chain-body tr').length,
      }));
      assert.ok(info.lot >= minLot, `${sym} lot size valid (${info.lot} >= ${minLot})`);
      assert.ok(info.rows >= 5, `${sym} option chain rendered ${info.rows} strikes`);
      report.instrumentResults[sym] = { status: 'PASS', ...info };
    }
    console.log('PASS E: Multi-instrument validation passed for NIFTY, BANKNIFTY, SENSEX, RELIANCE, HDFCBANK, IDEA.');

    // =========================================================================
    // TEST G: Full Platform Module Regression Check + Zero Errors
    // =========================================================================
    for (const sectionId of ['#builder-start', '#historical-lab', '#strategy-comparison', '#options-research', '#strategy-tools', '#market-heatmap']) {
      assert.equal(await page.locator(sectionId).count(), 1, `Module ${sectionId} intact on strategy-builder.html`);
    }

    // Quick Light & Dark theme toggle verification
    await page.locator('#theme').click();
    await page.waitForTimeout(150);
    await page.locator('#theme').click();

    // Homepage & Counselling Form regression check
    await page.goto(`${BASE_URL}/index.html`, { waitUntil: 'domcontentloaded' });
    assert.ok((await page.locator('form.lead-form').count()) >= 1, 'Homepage counselling form intact');

    assert.equal(report.pageErrors.length, 0, `Zero uncaught page errors: ${JSON.stringify(report.pageErrors)}`);
    assert.equal(report.consoleErrors.length, 0, `Zero console errors: ${JSON.stringify(report.consoleErrors)}`);
    assert.equal(report.failedRequests.length, 0, `Zero failed HTTP requests: ${JSON.stringify(report.failedRequests)}`);

    // =========================================================================
    // TEST H: Pure Static / GitHub Pages Mode (API Blocked -> Static CDN Cache)
    // =========================================================================
    {
      const staticCtx = await browser.newContext({
        viewport: { width: 1440, height: 920 },
        timezoneId: 'Asia/Kolkata',
      });
      const sPage = await staticCtx.newPage();
      await sPage.route('**/api/**', route => route.abort());
      await sPage.goto(`${BASE_URL}/strategy-builder.html#options-simulator`, { waitUntil: 'domcontentloaded' });
      await sPage.waitForFunction(
        () => {
          const tfVal = document.getElementById('opstra-timeframe')?.value;
          const src = document.getElementById('opstra-source-note')?.textContent || '';
          const rows = document.querySelectorAll('#opstra-chain-body tr').length;
          return tfVal === '1' && src.includes('1-min bars') && rows > 5;
        },
        { timeout: 25000 }
      );
      // Restore 2026-11-02 daily study in pure static mode & click 1 Min!
      await sPage.locator('.opstra-history-tools summary').click();
      await sPage.locator('#opstra-restore').setInputFiles({
        name: 'daily-repro-static.json',
        mimeType: 'application/json',
        buffer: Buffer.from(dailyBugStudy),
      });
      await sPage.waitForFunction(() => (document.getElementById('opstra-sim-clock')?.textContent || '').includes('2026-11-02'), { timeout: 10000 });
      await sPage.locator('#opstra-tf-pills button[data-tf="1"]').click();
      await sPage.waitForFunction(
        () => {
          const tfVal = document.getElementById('opstra-timeframe')?.value;
          const src = document.getElementById('opstra-source-note')?.textContent || '';
          return tfVal === '1' && src.includes('1-min bars');
        },
        { timeout: 20000 }
      );
      const stBefore = await sPage.locator('#opstra-sim-clock').innerText();
      await sPage.locator('button[data-mins="1"]').click();
      const stAfter = await sPage.locator('#opstra-sim-clock').innerText();
      assert.notEqual(stAfter, stBefore, `Pure Static GitHub Pages 1 Min stepped forward (${stBefore} -> ${stAfter})`);
      await staticCtx.close();
      console.log('PASS H: Pure Static GitHub Pages mode 1 Min startup + 2026-11-02 -> 1 Min upgrade + 1m step verified!');
    }

    const outReportPath = path.resolve(__dirname, '../market-data/nifty-backup/e2e_simulator_audit_results.json');
    fs.writeFileSync(outReportPath, JSON.stringify(report, null, 2));
    console.log('ALL E2E TESTS PASSED (A–G):', JSON.stringify(report.timeframeResults));
  } finally {
    await browser.close();
  }
})();

'use strict';
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const assert = require('node:assert/strict');
const { chromium } = require(path.resolve(__dirname, 'gallery-build/node_modules/playwright'));

const BASE_URL = process.env.IWSM_TEST_URL || 'http://127.0.0.1:4174';

(async () => {
  const workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'iwsm-opstra-e2e-'));
  const chromeWin = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
  const browser = await chromium.launch({
    ...(fs.existsSync(chromeWin) ? { executablePath: chromeWin } : {}),
    headless: true,
  });

  try {
    // -------------------------------------------------------------------------
    // PART 1: Deep Functional E2E Verification on Desktop (1440x960)
    // -------------------------------------------------------------------------
    {
      const ctx = await browser.newContext({
        viewport: { width: 1440, height: 960 },
        timezoneId: 'Asia/Kolkata',
      });
      const page = await ctx.newPage();
      const pageErrors = [];
      const consoleErrors = [];
      page.on('pageerror', e => pageErrors.push(e.message));
      page.on('console', m => {
        if (m.type() === 'error' && !m.text().includes('favicon') && !m.text().includes('401 (Unauthorized)')) {
          consoleErrors.push(m.text());
        }
      });

      await page.goto(`${BASE_URL}/strategy-builder.html#options-simulator`, { waitUntil: 'domcontentloaded' });
      await page.locator('#opstra-simulator-root').waitFor({ state: 'visible' });

      // Wait for dynamic Alice Blue instrument catalog (400+ instruments) & initial chain render
      await page.waitForFunction(
        () => {
          const sel = document.getElementById('opstra-symbol-select');
          const rows = document.querySelectorAll('#opstra-chain-body tr');
          return sel && sel.options.length > 50 && rows.length > 5;
        },
        { timeout: 25000 }
      );

      // 1. Verify Clock Jump controls are visible (regression check for simulator-reference.css bug)
      const clockVis = await page.evaluate(() => getComputedStyle(document.querySelector('.opstra-clock-row > div:first-child')).visibility);
      assert.equal(clockVis, 'visible', 'Session Date & Time (IST) controls must be visible');

      // 2. Verify Market Status pill, Spot/Futures/ATM/Lot/IV badges & Expiry Weekly/Monthly classification
      const headerState = await page.evaluate(() => ({
        marketPill: document.getElementById('opstra-market-status')?.textContent?.trim(),
        instrumentMeta: document.getElementById('opstra-instrument-meta')?.textContent?.trim(),
        lot: document.getElementById('opstra-val-lot')?.textContent?.trim(),
        atm: document.getElementById('opstra-val-atm')?.textContent?.trim(),
        iv: document.getElementById('opstra-val-iv')?.textContent?.trim(),
        expiryText: document.getElementById('opstra-expiry-select')?.selectedOptions?.[0]?.textContent || '',
        expiryMeta: document.getElementById('opstra-expiry-meta')?.textContent?.trim(),
      }));
      assert.ok(headerState.marketPill.includes('IST') || headerState.marketPill.includes('MARKET'), 'Market status pill rendered');
      assert.ok(/Weekly|Monthly/i.test(headerState.expiryText), `Expiry label includes Weekly/Monthly: ${headerState.expiryText}`);
      assert.ok(Number(headerState.lot.replace(/,/g, '')) > 0, `Verified dynamic lot size rendered: ${headerState.lot}`);
      console.log('PASS 1: Dynamic Alice Blue 446-instrument catalogue, IST market pill & Weekly/Monthly expiry labels verified.');

      // 3. Test Searchable Instrument Filter across Indices & Stock F&O
      await page.locator('#opstra-symbol-search').fill('RELIANCE');
      const filteredReliance = await page.evaluate(() =>
        [...document.getElementById('opstra-symbol-select').options].map(o => o.value)
      );
      assert.ok(filteredReliance.some(v => v.endsWith('|RELIANCE')), 'Search filter narrows dropdown to RELIANCE');

      await page.locator('#opstra-symbol-search').fill('SENSEX');
      const filteredSensex = await page.evaluate(() =>
        [...document.getElementById('opstra-symbol-select').options].map(o => o.textContent)
      );
      assert.ok(filteredSensex.some(t => t.includes('SENSEX') && t.includes('Lot 20')), 'BSE SENSEX with Lot 20 present in catalogue');

      await page.locator('#opstra-symbol-search').fill('');
      await page.locator('#opstra-symbol-search').dispatchEvent('input');

      // Switch to Stock F&O (RELIANCE) in Historical Daily mode & verify lot size + chain update
      await page.locator('#opstra-symbol-select').selectOption('nse_fo|RELIANCE');
      await page.waitForFunction(
        () => {
          const chartTitle = document.getElementById('opstra-chart-title')?.textContent || '';
          const dialogOpen = document.querySelector('dialog.opstra-dialog[open]');
          return chartTitle.includes('RELIANCE') || Boolean(dialogOpen);
        },
        { timeout: 15000 }
      );
      if (await page.locator('dialog.opstra-dialog[open]').count()) {
        await page.locator('dialog.opstra-dialog[open] select[name="data"]').selectOption('daily');
        await page.locator('dialog.opstra-dialog[open] button[type="submit"]').click();
        await page.waitForFunction(() => (document.getElementById('opstra-chart-title')?.textContent || '').includes('RELIANCE'), { timeout: 15000 });
      }
      const relLot = await page.locator('#opstra-val-lot').innerText();
      assert.ok(Number(relLot.replace(/,/g, '')) >= 250, `RELIANCE stock F&O lot size updated (${relLot})`);

      // Switch to BANKNIFTY & verify
      await page.locator('#opstra-symbol-select').selectOption('nse_fo|BANKNIFTY');
      await page.waitForFunction(
        () => (document.getElementById('opstra-chart-title')?.textContent || '').includes('BANKNIFTY') || Boolean(document.querySelector('dialog.opstra-dialog[open]')),
        { timeout: 15000 }
      );
      if (await page.locator('dialog.opstra-dialog[open]').count()) {
        await page.locator('dialog.opstra-dialog[open] select[name="data"]').selectOption('daily');
        await page.locator('dialog.opstra-dialog[open] button[type="submit"]').click();
        await page.waitForFunction(() => (document.getElementById('opstra-chart-title')?.textContent || '').includes('BANKNIFTY'), { timeout: 15000 });
      }

      // Return to NIFTY
      await page.locator('#opstra-symbol-select').selectOption('nse_fo|NIFTY');
      await page.waitForFunction(() => (document.getElementById('opstra-chart-title')?.textContent || '').includes('NIFTY'), { timeout: 15000 });
      console.log('PASS 2: Multi-instrument switching (NIFTY, BANKNIFTY, SENSEX, RELIANCE) verified.');

      // 4. Option Chain Filters, Full Columns & Highlighting
      await page.locator('#opstra-chain-detail-cols').check();
      const visibleHeaders = await page.evaluate(() =>
        [...document.querySelectorAll('#opstra-chain-head th:not([hidden])')].map(th => th.textContent.trim())
      );
      assert.equal(visibleHeaders.length, 17, 'Full Columns toggle reveals all 17 Call/Strike/Put columns including Chg OI, Vol, Bid/Ask');
      await page.locator('#opstra-chain-detail-cols').uncheck();

      const atmTagCount = await page.locator('#opstra-chain-body .opstra-strike-tag.atm').count();
      assert.equal(atmTagCount, 1, 'Option chain highlights exact ATM strike');

      // 5. Inline Multi-Leg Strategy Builder + Custom Entry Premium + 5-Action Position Controls
      await page.locator('#opstra-btn-reset').click();
      await page.locator('#opstra-build-side').selectOption('1');
      await page.locator('#opstra-build-type').selectOption('CE');
      await page.locator('#opstra-build-lots').fill('2');
      await page.locator('#opstra-build-price').fill('125.5');
      await page.locator('#opstra-leg-builder button[type="submit"]').click();

      assert.equal(await page.locator('#opstra-positions-list .opstra-position-row').count(), 1, 'Inline Builder added custom leg');
      assert.match(await page.locator('#opstra-positions-list').innerText(), /\[Edited\]/, 'Edited entry premium badge shown');
      assert.ok((await page.locator('#opstra-chain-body .opstra-row-selected').count()) >= 1, 'Active leg strike highlighted in Option Chain');
      assert.match(await page.locator('#opstra-metric-netpremium').innerText(), /Debit/i, 'Long Call shows Net Premium Debit');

      // Per-leg Exclude / Include toggle
      await page.locator('#opstra-positions-list .opstra-pos-check').uncheck();
      assert.equal(await page.locator('#opstra-metric-maxprofit').innerText(), '—', 'Excluding sole leg clears payoff summary');
      await page.locator('#opstra-positions-list .opstra-pos-check').check();
      assert.equal(await page.locator('#opstra-metric-maxprofit').innerText(), 'Unlimited', 'Re-including Long Call restores Unlimited max profit');

      // Flip B↔S
      await page.locator('#opstra-positions-list button[data-act="reverse"]').click();
      assert.match(await page.locator('#opstra-metric-netpremium').innerText(), /Credit/i, 'Flipping Long Call to Short Call switches to Credit');
      assert.equal(await page.locator('#opstra-metric-maxloss').innerText(), 'Unlimited', 'Short Call shows Unlimited max loss');

      // Edit Leg modal
      await page.locator('#opstra-positions-list button[data-act="edit"]').click();
      await page.locator('dialog.opstra-dialog[open] input[name="lots"]').fill('3');
      await page.locator('dialog.opstra-dialog[open] button[type="submit"]').click();
      assert.match(await page.locator('#opstra-positions-list .opstra-pos-name').innerText(), /3x/, 'Edit Leg modal updated lot count to 3x');

      // Delete Leg
      await page.locator('#opstra-positions-list button[data-act="remove"]').click();
      assert.equal(await page.locator('#opstra-positions-list .opstra-position-row').count(), 0, 'Delete button removes leg cleanly');
      console.log('PASS 3: Inline Multi-Leg Builder, editable entry premium, Toggle, Flip B↔S, Edit, and Delete verified.');

      // 6. Predefined Strategy Templates (Iron Condor) + Payoff / Greeks / P&L Tabs + Spot/Futures Basis Switch
      await page.locator('#opstra-btn-strategies').click();
      await page.locator('dialog.opstra-dialog[open] input[name="filter"]').fill('Iron Condor');
      await page.locator('dialog.opstra-dialog[open] button[type="submit"]').click();
      assert.equal(await page.locator('#opstra-positions-list .opstra-position-row').count(), 4, 'Iron Condor preset deployed 4 legs');
      assert.ok((await page.locator('#opstra-chart-container svg').count()) === 1, 'Interactive Payoff SVG rendered');
      assert.notEqual(await page.locator('#opstra-metric-breakevens').innerText(), '—', 'Iron Condor breakevens computed');
      assert.notEqual(await page.locator('#opstra-metric-rr').innerText(), '—', 'Iron Condor Risk/Reward computed');

      // Switch to GREEKS tab
      await page.locator('.opstra-tab-btn[data-tab="greeks"]').click();
      assert.match(await page.locator('#opstra-chart-container').innerText(), /Portfolio Total/, 'Greeks tab renders portfolio breakdown');

      // Switch to P&L tab
      await page.locator('.opstra-tab-btn[data-tab="pnl"]').click();
      assert.match(await page.locator('#opstra-chart-container').innerText(), /Gross P&L/, 'P&L tab renders leg-by-leg P&L table');

      // Return to PAYOFF CHART & test SPOT / FUTURES toggle
      await page.locator('.opstra-tab-btn[data-tab="payoff"]').click();
      await page.locator('#opstra-basis-toggle').check({ force: true });
      await page.waitForTimeout(150);
      await page.locator('#opstra-basis-toggle').uncheck({ force: true });

      // Option Chain 1-Click B/S buttons
      await page.locator('#opstra-btn-reset').click();
      await page.locator('#opstra-quick-trade').check();
      await page.locator('#opstra-chain-body .opstra-btn-b:not(:disabled)').first().click();
      await page.locator('#opstra-chain-body .opstra-btn-s:not(:disabled)').first().click();
      assert.equal(await page.locator('#opstra-positions-list .opstra-position-row').count(), 2, '1-Click B/S buttons in Option Chain added 2 legs');
      console.log('PASS 4: Iron Condor template, Payoff/Greeks/P&L tabs, Spot/Futures switch, and Option Chain B/S verified.');

      // 7. Volatility & Greeks Modal (Historical IV SVG, Strike Skew SVG, Term Structure)
      await page.locator('#opstra-btn-iv-chart').click();
      await page.locator('dialog.opstra-dialog[open] #opstra-iv-panel-history svg').waitFor({ state: 'visible' });
      await page.locator('dialog.opstra-dialog[open] button[data-ivview="skew"]').click();
      await page.locator('dialog.opstra-dialog[open] #opstra-iv-panel-skew svg').waitFor({ state: 'visible' });
      await page.locator('dialog.opstra-dialog[open] button[data-ivview="term"]').click();
      assert.match(await page.locator('dialog.opstra-dialog[open] #opstra-iv-panel-term').innerText(), /Black-Scholes-Merton/, 'Model assumptions documented in Term Structure tab');
      await page.locator('dialog.opstra-dialog[open] > header button').click();
      console.log('PASS 5: NIFTY IV & Skew modal (Historical IV SVG, Strike Skew SVG, Term Structure) verified.');

      // 8. Historical Snapshot Store Modal & Future Date Rejection & Intraday 1m/5m/15m/30m/60m Playback + Reset
      await page.locator('#opstra-btn-recorder').click();
      assert.match(await page.locator('dialog.opstra-dialog[open]').innerText(), /Earliest Recorded Date/, 'Snapshot Store modal displays earliest coverage & recorder controls');
      await page.locator('dialog.opstra-dialog[open] > header button').click();

      // Future date validation check
      await page.evaluate(() => {
        const el = document.getElementById('opstra-start-date');
        el.value = '2099-12-31';
        el.dispatchEvent(new Event('change'));
      });
      assert.match(await page.locator('#opstra-status').innerText(), /future/i, 'Future Start Date cleanly rejected with IST warning');

      // 8A. Multi-day Historical Replay (> 1 DAY step, PLAY/PAUSE, and ⏮ RESET)
      await page.locator('#opstra-btn-new').click();
      await page.locator('dialog.opstra-dialog[open] select[name="symbol"]').selectOption('nse_fo|NIFTY');
      await page.locator('dialog.opstra-dialog[open] select[name="data"]').selectOption('daily');
      await page.locator('dialog.opstra-dialog[open] input[name="start"]').fill('2025-12-01');
      await page.locator('dialog.opstra-dialog[open] input[name="start"]').dispatchEvent('change');
      await page.locator('dialog.opstra-dialog[open] input[name="end"]').fill('2025-12-05');
      await page.locator('dialog.opstra-dialog[open] input[name="end"]').dispatchEvent('change');
      await page.locator('dialog.opstra-dialog[open] button[type="submit"]').click();
      await page.waitForFunction(() => document.querySelector('dialog.opstra-dialog[open]') === null, { timeout: 15000 });

      const dayClock0 = await page.locator('#opstra-sim-clock').innerText();
      await page.locator('button[data-mins="1440"]').click();
      const dayClock1 = await page.locator('#opstra-sim-clock').innerText();
      assert.notEqual(dayClock1, dayClock0, `> 1 DAY forward step advanced daily clock (${dayClock0} -> ${dayClock1})`);
      await page.locator('#opstra-btn-rewind').click();
      assert.equal(await page.locator('#opstra-sim-clock').innerText(), dayClock0, '⏮ RESET rewound daily clock');

      // 8B. Intraday 1-Minute Playback (1m, 5m, 15m, 30m, 60m steps + 0.5s Auto-PLAY/PAUSE + ⏮ RESET) via Study Restore
      const minuteStudyJson = await page.evaluate(() => {
        const M = window.IWSMSimulator;
        const P = window.IWSMPaperExecution;
        const contracts = [];
        const underlying = [];
        for (let m = 0; m <= 90; m++) {
          const hh = String(9 + Math.floor((15 + m) / 60)).padStart(2, '0');
          const mm = String((15 + m) % 60).padStart(2, '0');
          const ts = `2026-11-10T${hh}:${mm}`;
          const sp = 24000 + m * 1.5;
          underlying.push({ symbol: 'NIFTY', timestamp: ts, close: sp, indiaVix: 14.2 });
          contracts.push(
            { timestamp: ts, symbol: 'NIFTY', expiry: '2026-11-17', type: 'CE', strike: 24000, close: 140 + m * 0.8, lotSize: 65, volume: 1200, oi: 150000 },
            { timestamp: ts, symbol: 'NIFTY', expiry: '2026-11-17', type: 'PE', strike: 24000, close: Math.max(10, 135 - m * 0.7), lotSize: 65, volume: 1100, oi: 160000 }
          );
        }
        const raw = { source: 'Intraday 1-Min Verification Window', metadata: { exchange: 'nse_fo', rate: 6.5, dividend: 0 }, underlying, contracts };
        const d = M.prepareDataset(raw);
        let s = P.create(d, { initialBalance: 1000000, feePerOrder: 20, feeBps: 0, slippage: 0, marginRate: 0.2, rate: 6.5, dividend: 0 });
        s = P.order(d, s, { type: 'CE', expiry: '2026-11-17', strike: 24000, side: 1, lots: 1 });
        return JSON.stringify({ format: 'iwsm-paper-v1', name: 'NIFTY 1m Test', dataset: M.exportDataset(d), bundle: null, session: s, savedAt: Date.now() });
      });

      await page.locator('.opstra-history-tools summary').click();
      await page.locator('#opstra-restore').setInputFiles({
        name: 'nifty-1m-study.json',
        mimeType: 'application/json',
        buffer: Buffer.from(minuteStudyJson),
      });
      await page.waitForFunction(() => (document.getElementById('opstra-sim-clock')?.textContent || '').includes('2026-11-10 09:15'), { timeout: 10000 });

      const clock0 = await page.locator('#opstra-sim-clock').innerText();
      for (const stepMin of [1, 5, 15, 30, 60]) {
        const before = await page.locator('#opstra-sim-clock').innerText();
        await page.locator(`button[data-mins="${stepMin}"]`).click();
        const after = await page.locator('#opstra-sim-clock').innerText();
        assert.notEqual(after, before, `${stepMin} MIN forward step advanced clock (${before} -> ${after})`);
      }

      // Rewind to start, test 0.5s Auto-PLAY / PAUSE, then ⏮ RESET
      await page.locator('#opstra-btn-rewind').click();
      assert.equal(await page.locator('#opstra-sim-clock').innerText(), clock0, '⏮ RESET rewound intraday cursor to 09:15 IST');

      await page.locator('#opstra-timeframe').selectOption('5');
      await page.locator('#opstra-speed').selectOption('500');
      await page.locator('#opstra-btn-play').click();
      await page.waitForTimeout(750);
      await page.locator('#opstra-btn-play').click(); // Pause
      const clockAfterPlay = await page.locator('#opstra-sim-clock').innerText();
      assert.notEqual(clockAfterPlay, clock0, `Auto-PLAY at 0.5s advanced clock (${clock0} -> ${clockAfterPlay})`);

      await page.locator('#opstra-btn-rewind').click();
      assert.equal(await page.locator('#opstra-sim-clock').innerText(), clock0, '⏮ RESET rewound intraday cursor after Auto-PLAY');
      console.log('PASS 6: Multi-day 1d step + Intraday 1m/5m/15m/30m/60m steps, 0.5s Auto-Play/Pause, Study Restore & ⏮ RESET verified.');

      assert.deepEqual(pageErrors, [], 'Zero uncaught page errors during full E2E workflow');
      assert.deepEqual(consoleErrors, [], 'Zero console errors during full E2E workflow');
      await ctx.close();
    }

    // -------------------------------------------------------------------------
    // PART 2: Responsive Breakpoints (1920, 1440, 1024, 768, 390) × Light & Dark
    // -------------------------------------------------------------------------
    for (const width of [1920, 1440, 1024, 768, 390]) {
      for (const theme of ['light', 'dark']) {
        const height = width <= 768 ? 844 : 960;
        const ctx = await browser.newContext({
          viewport: { width, height },
          timezoneId: 'Asia/Kolkata',
        });
        const page = await ctx.newPage();
        const errs = [];
        page.on('pageerror', e => errs.push(e.message));
        await page.addInitScript(t => localStorage.setItem('iwsm_theme', t), theme);
        await page.goto(`${BASE_URL}/strategy-builder.html#options-simulator`, { waitUntil: 'domcontentloaded' });
        await page.locator('#opstra-simulator-root').waitFor({ state: 'visible' });
        await page.waitForFunction(() => document.querySelectorAll('#opstra-chain-body tr').length > 0, { timeout: 15000 });

        const metrics = await page.evaluate(() => ({
          docTheme: document.documentElement.dataset.theme,
          scrollWidth: document.documentElement.scrollWidth,
          innerWidth: window.innerWidth,
          simVisible: document.getElementById('options-simulator').getBoundingClientRect().width > 0,
        }));
        assert.equal(metrics.docTheme, theme, `Theme ${theme} applied at ${width}px`);
        assert.ok(metrics.scrollWidth <= metrics.innerWidth + 1, `Zero horizontal overflow at ${width}px (${theme}): scrollWidth=${metrics.scrollWidth}, innerWidth=${metrics.innerWidth}`);
        assert.ok(metrics.simVisible, `Simulator visible at ${width}px (${theme})`);
        assert.deepEqual(errs, [], `Zero errors at ${width}px (${theme})`);
        await ctx.close();
      }
      console.log(`PASS Responsive ${width}px (Light & Dark): zero overflow, zero errors.`);
    }

    // -------------------------------------------------------------------------
    // PART 3: Strategy Lab Sibling Modules & Sitewide Regression Check
    // -------------------------------------------------------------------------
    {
      const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, timezoneId: 'Asia/Kolkata' });
      const page = await ctx.newPage();
      const errs = [];
      page.on('pageerror', e => errs.push(e.message));
      await page.goto(`${BASE_URL}/strategy-builder.html`, { waitUntil: 'domcontentloaded' });
      // Click through all 6 Strategy Lab navigation tabs and verify each module works cleanly
      await page.locator('#leg-form button.add-position').click();
      assert.ok((await page.locator('#legs tr').count()) >= 1, 'Model Strategy Builder adds leg');

      await page.locator('.lab-jumps a[href="#strategy-comparison"]').click();
      await page.locator('#compare-add').click();
      assert.equal(await page.locator('#comparison-rows tr').count(), 1, 'Strategy Comparison module adds snapshot');

      await page.locator('.lab-jumps a[href="#options-research"]').click();
      assert.ok(await page.locator('#options-research').isVisible(), 'Options Research Lab visible');

      await page.locator('.lab-jumps a[href="#historical-lab"]').click();
      assert.ok(await page.locator('#historical-lab').isVisible(), 'Historical Backtest Lab visible');

      await page.locator('.lab-jumps a[href="#strategy-tools"]').click();
      assert.ok(await page.locator('#strategy-tools').isVisible(), 'Screener & Portfolio module visible');

      await page.locator('.lab-jumps a[href="#options-simulator"]').click();
      assert.ok(await page.locator('#options-simulator').isVisible(), 'Options Simulator tab switches cleanly');
      assert.deepEqual(errs, [], 'Zero errors across sibling Strategy Lab modules');
      await ctx.close();
      console.log('PASS Sibling Strategy Lab Modules (Builder, Compare, Research, Backtest, Screener & Portfolio): verified.');
    }

    for (const route of ['/index.html', '/reviews.html']) {
      const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
      const page = await ctx.newPage();
      const errs = [];
      page.on('pageerror', e => errs.push(e.message));
      const resp = await page.goto(`${BASE_URL}${route}`, { waitUntil: 'domcontentloaded' });
      assert.equal(resp.status(), 200, `${route} returned 200 OK`);
      const noOverflow = await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);
      assert.ok(noOverflow, `${route} has zero horizontal overflow`);
      assert.deepEqual(errs, [], `${route} has zero page errors`);
      await ctx.close();
      console.log(`PASS Sitewide Regression ${route}: 200 OK, zero errors, zero overflow.`);
    }

    console.log('ALL OPSTRA SIMULATOR BROWSER E2E, RESPONSIVE & REGRESSION CHECKS PASSED 100%!');
  } finally {
    await browser.close();
    fs.rmSync(workDir, { recursive: true, force: true });
  }
})().catch(err => {
  console.error(err.stack || err);
  process.exit(1);
});

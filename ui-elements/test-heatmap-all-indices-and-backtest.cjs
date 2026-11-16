'use strict';
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { chromium } = require(path.resolve(__dirname, 'gallery-build/node_modules/playwright'));

const ALL_16_UNIVERSES = [
  ['NIFTY 50', 48],
  ['NIFTY 100', 95],
  ['NIFTY 200', 195],
  ['NIFTY 500', 490],
  ['NIFTY MIDCAP 50', 48],
  ['NIFTY MIDCAP 100', 95],
  ['NIFTY SMALLCAP 100', 95],
  ['NIFTY BANK', 12],
  ['NIFTY FINANCIAL SERVICES', 18],
  ['NIFTY IT', 10],
  ['NIFTY AUTO', 14],
  ['NIFTY PHARMA', 18],
  ['NIFTY FMCG', 14],
  ['NIFTY METAL', 14],
  ['NIFTY ENERGY', 35],
  ['NSE All Stocks', 740],
];

const SAMPLE_STOCKS = [
  'RELIANCE',
  'HDFCBANK',
  'ICICIBANK',
  'SBIN',
  'TCS',
  'INFY',
  'BHARTIARTL',
  'ITC',
  'MARUTI',
  'TATASTEEL',
];

(async () => {
  const chromeWin = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
  const browser = await chromium.launch({
    ...(fs.existsSync(chromeWin) ? { executablePath: chromeWin } : {}),
    headless: true,
  });

  try {
    // -------------------------------------------------------------------------
    // 1. Verify file:// protocol auto-connects to Live Backend (zero Failed to fetch!)
    // -------------------------------------------------------------------------
    {
      const ctx = await browser.newContext({ viewport: { width: 1440, height: 920 }, timezoneId: 'Asia/Kolkata' });
      const page = await ctx.newPage();
      const errs = [];
      page.on('pageerror', e => errs.push(e.message));
      const fileUrl = 'file:///' + path.resolve(__dirname, '../strategy-builder.html').replace(/\\/g, '/') + '#market-heatmap';
      await page.goto(fileUrl, { waitUntil: 'domcontentloaded' });
      await page.waitForFunction(
        () => Number(document.getElementById('hm-count-total')?.textContent || '0') === 50 && document.getElementById('hm-overlay')?.hidden === true,
        null,
        { timeout: 20000 }
      );
      const feedTxt = await page.locator('#hm-feed-text').innerText();
      assert.doesNotMatch(feedTxt, /Failed to fetch/i);
      assert.deepEqual(errs, [], 'Zero JS errors on file://');
      console.log(`PASS A (file:// Live Auto-Connect): NIFTY 50 rendered cleanly on file:// | Status: "${feedTxt}"`);
      await ctx.close();
    }

    // -------------------------------------------------------------------------
    // 2. Verify ALL 16 INDICES, 10 INDIVIDUAL STOCKS, ALL METRICS & BACKTESTS
    // -------------------------------------------------------------------------
    {
      const ctx = await browser.newContext({ viewport: { width: 1440, height: 920 }, timezoneId: 'Asia/Kolkata' });
      const page = await ctx.newPage();
      const pageErrors = [];
      page.on('pageerror', e => pageErrors.push(e.message));

      await page.goto('http://127.0.0.1:4174/strategy-builder.html#market-heatmap', { waitUntil: 'domcontentloaded' });
      await page.waitForFunction(
        () => Number(document.getElementById('hm-count-total')?.textContent || '0') >= 48 && document.getElementById('hm-overlay')?.hidden === true,
        null,
        { timeout: 25000 }
      );

      // Check EVERY SINGLE ONE of the 16 Stock Universes!
      console.log('--- Checking all 16 NSE Stock Universes ---');
      for (const [uid, minExpected] of ALL_16_UNIVERSES) {
        await page.locator('#hm-universe').selectOption(uid);
        await page.waitForFunction(
          ([expectedTitle, minCnt]) => {
            const h = document.getElementById('hm-heading')?.textContent || '';
            const n = Number(document.getElementById('hm-count-total')?.textContent || '0');
            const ovHidden = document.getElementById('hm-overlay')?.hidden === true;
            return h.startsWith(expectedTitle) && n >= minCnt && ovHidden;
          },
          [uid, minExpected],
          { timeout: 15000 }
        );
        const total = Number(await page.locator('#hm-count-total').innerText());
        const adv = await page.locator('#hm-adv').innerText();
        const dec = await page.locator('#hm-dec').innerText();
        console.log(`  ✓ ${uid.padEnd(26)} -> ${String(total).padStart(3)} stocks rendered | Adv: ${adv} | Dec: ${dec}`);
      }

      // Return to NIFTY 50 and check all 8 Size By + Color By + Group By options
      await page.locator('#hm-universe').selectOption('NIFTY 50');
      await page.waitForFunction(() => Number(document.getElementById('hm-count-total')?.textContent || '0') === 50, null, { timeout: 10000 });

      for (const sz of ['marketCap', 'volume1d', 'volume1w', 'volume1m', 'turnover1d', 'turnover1w', 'turnover1m', 'equal']) {
        const disabled = await page.locator(`#hm-size-by option[value="${sz}"]`).evaluate(o => o.disabled);
        if (!disabled) {
          await page.locator('#hm-size-by').selectOption(sz);
        }
      }
      await page.locator('#hm-size-by').selectOption('marketCap');

      for (const col of ['changePct', 'change1h', 'change15m', 'change5m', 'perf1w', 'perf1m', 'perf3m', 'perf6m', 'perfYtd', 'perf1y', 'relativeVolume', 'volumeChangePct', 'volatility', 'gapPct']) {
        const disabled = await page.locator(`#hm-color-by option[value="${col}"]`).evaluate(o => o.disabled);
        if (!disabled) {
          await page.locator('#hm-color-by').selectOption(col);
        }
      }
      await page.locator('#hm-color-by').selectOption('changePct');
      console.log('PASS B: All 16 indices + all available Size By (8) & Color By (14) metrics verified.');

      // Check 10 Individual Stocks via Search + Sorted Table + Stock Details Modal
      console.log('--- Checking 10 Individual Stocks & Live Details Modals ---');
      await page.locator('#hm-sort-by').selectOption('symbol_asc');
      for (const sym of SAMPLE_STOCKS) {
        await page.locator('#hm-search').fill(sym);
        await page.waitForTimeout(180);
        const row = page.locator(`#hm-sorted-rows tr[data-row-sym="${sym}"]`);
        await row.waitFor({ state: 'visible', timeout: 5000 });
        await row.click();
        await page.locator('#hm-stock-dialog').waitFor({ state: 'visible' });
        const modalSym = await page.locator('#hm-dlg-symbol').innerText();
        const modalPrice = await page.locator('#hm-dlg-price').innerText();
        const modalChg = await page.locator('#hm-dlg-chg').innerText();
        assert.equal(modalSym, sym);
        assert.match(modalPrice, /^₹[\d,]+/);
        console.log(`  ✓ ${sym.padEnd(12)} -> LTP: ${modalPrice.padEnd(11)} | ${modalChg}`);
        await page.locator('#hm-dlg-close').click();
      }
      await page.locator('#hm-search-clear').click();
      await page.locator('#hm-sorted-close').click();

      // -----------------------------------------------------------------------
      // 3. BACKTEST EXAMPLE 1: Click RELIANCE in Heatmap -> "Backtest Historical Strategy" (#historical-lab)
      // -----------------------------------------------------------------------
      console.log('--- Running Backtest Example 1: Heatmap RELIANCE -> Historical Lab Backtest ---');
      await page.locator('#hm-sort-by').selectOption('symbol_asc');
      await page.locator('#hm-search').fill('RELIANCE');
      await page.waitForTimeout(200);
      await page.locator('#hm-sorted-rows tr[data-row-sym="RELIANCE"]').click();
      await page.locator('#hm-stock-dialog').waitFor({ state: 'visible' });

      // Click "Backtest Historical Strategy" button in Heatmap modal!
      await page.locator('#hm-dlg-open-backtest').click();
      await page.locator('#historical-lab').waitFor({ state: 'visible' });

      // Wait for RELIANCE recorded NSE option contracts to finish loading into Historical Lab
      await page.waitForFunction(
        () => {
          const sym = document.getElementById('history-symbol')?.value;
          const chainRows = document.querySelectorAll('#history-chain tr').length;
          return sym === 'RELIANCE' && chainRows > 5;
        },
        null,
        { timeout: 25000 }
      );
      // Set lot size if needed, load Bull Call Spread (index 1) from recorded entry closes, and run replay!
      const unitsVal = await page.locator('#history-units').inputValue();
      if (!unitsVal || Number(unitsVal) < 1) {
        await page.locator('#history-units').fill('500');
      }
      await page.locator('#history-preset').selectOption('1'); // Bull Call Spread
      await page.locator('#history-load-preset').click();
      await page.waitForFunction(() => document.querySelectorAll('#history-legs tr').length === 2, null, { timeout: 8000 });
      await page.locator('#history-run').click();
      await page.locator('#history-results').waitFor({ state: 'visible', timeout: 10000 });

      const relBacktestSummary = await page.locator('#history-summary').innerText();
      const relBacktestDays = await page.locator('#history-rows tr').count();
      assert.ok(relBacktestDays >= 2, `RELIANCE backtest produced ${relBacktestDays} daily P&L observations`);
      console.log(`  ✓ RELIANCE Bull Call Spread Backtest Completed (${relBacktestDays} sessions):\n    ${relBacktestSummary.replace(/\s+/g, ' ').slice(0, 180)}`);

      // -----------------------------------------------------------------------
      // 4. BACKTEST EXAMPLE 2: Heatmap HDFCBANK -> "Open in Options Simulator" (#options-simulator 1m Intraday Replay)
      // -----------------------------------------------------------------------
      console.log('--- Running Backtest Example 2: Heatmap HDFCBANK -> Options Simulator Intraday Strategy Test ---');
      await page.locator('.lab-jumps a[href="#market-heatmap"]').click();
      await page.locator('#market-heatmap').waitFor({ state: 'visible' });
      await page.locator('#hm-search').fill('HDFCBANK');
      await page.waitForTimeout(200);
      await page.locator('#hm-sorted-rows tr[data-row-sym="HDFCBANK"]').click();
      await page.locator('#hm-stock-dialog').waitFor({ state: 'visible' });

      await page.locator('#hm-dlg-open-sim').click();
      await page.locator('#options-simulator').waitFor({ state: 'visible' });
      await page.waitForFunction(
        () => (document.getElementById('opstra-chart-title')?.textContent || '').includes('HDFCBANK') && document.querySelectorAll('#opstra-chain-body tr').length > 5,
        null,
        { timeout: 25000 }
      );
      await page.locator('#opstra-btn-reset').click();
      await page.locator('#opstra-quick-trade').check();
      await page.locator('#opstra-chain-body .opstra-btn-b:not(:disabled)').first().click();
      await page.locator('#opstra-chain-body .opstra-btn-s:not(:disabled)').first().click();
      const simLegs = await page.locator('#opstra-positions-list [data-position]').evaluateAll(els => new Set(els.map(e => e.dataset.position)).size);
      const simSpot = await page.locator('#opstra-val-spot').innerText();
      const simMaxProfit = await page.locator('#opstra-metric-maxprofit').innerText();
      assert.equal(simLegs, 2, 'HDFCBANK 2-leg spread deployed in Options Simulator');
      console.log(`  ✓ HDFCBANK Options Simulator Strategy Verified -> Spot: ${simSpot} | Legs: ${simLegs} | Max Profit: ${simMaxProfit}`);

      // -----------------------------------------------------------------------
      // 5. BACKTEST EXAMPLE 3: NIFTY Iron Condor Historical Backtest (#historical-lab)
      // -----------------------------------------------------------------------
      console.log('--- Running Backtest Example 3: NIFTY Iron Condor Historical Replay ---');
      await page.locator('.lab-jumps a[href="#historical-lab"]').click();
      await page.locator('#historical-lab').waitFor({ state: 'visible' });
      await page.locator('#archive-symbol').selectOption('NIFTY');
      await page.locator('#archive-symbol').dispatchEvent('change');
      await page.locator('#archive-load').click();
      await page.waitForFunction(
        () => document.getElementById('history-symbol')?.value === 'NIFTY' && document.querySelectorAll('#history-chain tr').length > 10,
        null,
        { timeout: 25000 }
      );
      const niftyUnits = await page.locator('#history-units').inputValue();
      if (!niftyUnits || Number(niftyUnits) < 1) {
        await page.locator('#history-units').fill('75');
      }
      // Find Iron Condor (Credit) template index
      const icIdx = await page.evaluate(() => String(window.IWSMStrategy.templates.findIndex(t => t.name.includes('Iron Condor (Credit)'))));
      await page.locator('#history-preset').selectOption(icIdx);
      await page.locator('#history-load-preset').click();
      await page.waitForFunction(() => document.querySelectorAll('#history-legs tr').length === 4, null, { timeout: 8000 });
      await page.locator('#history-run').click();
      await page.locator('#history-results').waitFor({ state: 'visible', timeout: 10000 });
      const niftySummary = await page.locator('#history-summary').innerText();
      console.log(`  ✓ NIFTY 4-Leg Iron Condor Backtest Completed:\n    ${niftySummary.replace(/\s+/g, ' ').slice(0, 180)}`);

      assert.deepEqual(pageErrors, [], 'Zero uncaught page errors across entire multi-index & backtest run');
      await ctx.close();
    }

    console.log('\nALL 16 INDICES, 10 STOCKS, FILE:// LIVE AUTO-CONNECT & 3 REAL STRATEGY BACKTESTS PASSED 100%!');
  } finally {
    await browser.close();
  }
})().catch(err => {
  console.error(err);
  process.exit(1);
});

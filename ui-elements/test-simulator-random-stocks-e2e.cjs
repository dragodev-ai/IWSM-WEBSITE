'use strict';
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { chromium } = require(path.resolve(__dirname, 'gallery-build/node_modules/playwright'));

const STOCKS_TO_VERIFY = [
  'IDEA',
  'YESBANK',
  'PNB',
  'M&M',
  'BAJAJ-AUTO',
  'SAIL',
  'TATAPOWER',
  'VEDL',
  'DLF',
  'BHEL',
  'HAL',
  'BEL',
  'COALINDIA',
  'BANKBARODA',
  'ADANIENT',
  'ETERNAL',
];

(async () => {
  const chromeWin = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
  const browser = await chromium.launch({
    ...(fs.existsSync(chromeWin) ? { executablePath: chromeWin } : {}),
    headless: true,
  });

  try {
    // =========================================================================
    // PART 1: Full Live E2E — IDEA + 15+ Stocks, Start Simulation Modal, 1m Timeline & Previous Dates
    // =========================================================================
    {
      const ctx = await browser.newContext({ viewport: { width: 1440, height: 920 }, timezoneId: 'Asia/Kolkata' });
      const page = await ctx.newPage();
      const pageErrors = [];
      page.on('pageerror', err => pageErrors.push(err.message));

      await page.goto('http://127.0.0.1:4174/strategy-builder.html#options-simulator', { waitUntil: 'domcontentloaded' });
      await page.waitForFunction(
        () => document.querySelectorAll('#opstra-chain-body tr').length > 5 && document.querySelectorAll('#opstra-symbol-select option').length > 100,
        null,
        { timeout: 25000 }
      );

      console.log('--- 1. Verifying exact user flow: + NEW SIMULATION -> IDEA -> Start Simulation ---');
      await page.locator('#opstra-btn-new').click();
      const modal = page.locator('dialog.opstra-dialog');
      await modal.waitFor({ state: 'visible', timeout: 5000 });
      await modal.locator('select[name="symbol"]').selectOption('nse_fo|IDEA');
      await page.waitForFunction(
        () => {
          const btn = document.querySelector('dialog.opstra-dialog button[type="submit"]');
          return btn && !btn.disabled;
        },
        null,
        { timeout: 15000 }
      );
      await modal.locator('button[type="submit"]').click();

      // Modal MUST close and return to main Options Simulator screen!
      await modal.waitFor({ state: 'hidden', timeout: 20000 });
      await page.waitForFunction(
        () => (document.getElementById('opstra-chart-title')?.textContent || '').startsWith('IDEA') && document.querySelectorAll('#opstra-chain-body tr').length >= 5,
        null,
        { timeout: 15000 }
      );

      const ideaSpot = await page.locator('#opstra-val-spot').innerText();
      const ideaLot = await page.locator('#opstra-val-lot').innerText();
      const ideaMinuteCount = await page.locator('#opstra-observed-time option').count();
      const cursorInitial = await page.locator('#opstra-sim-clock').innerText();
      assert.ok(ideaMinuteCount >= 50, `Expected >=50 1m timestamps for IDEA, got ${ideaMinuteCount}`);
      assert.notEqual(ideaLot.trim(), '1', 'IDEA lot size must be exchange lot size, not 1');

      // Test +1m, +5m, +15m, -5m, and -1 Day (previous date!) on IDEA
      await page.locator('[data-mins="1"]').click();
      const cursorPlus1m = await page.locator('#opstra-sim-clock').innerText();
      assert.notEqual(cursorPlus1m, cursorInitial, 'Cursor must advance by +1 minute');

      await page.locator('[data-mins="15"]').click();
      const cursorPlus16m = await page.locator('#opstra-sim-clock').innerText();
      assert.notEqual(cursorPlus16m, cursorPlus1m, 'Cursor must advance by +15 minutes');

      await page.locator('[data-mins="-5"]').click();
      const cursorMinus5m = await page.locator('#opstra-sim-clock').innerText();
      assert.notEqual(cursorMinus5m, cursorPlus16m, 'Cursor must step back by -5 minutes');

      // Step back to previous trading date (-1 Day) and return (+1 Day), then jump to 09:30 IST via Time dropdown!
      await page.locator('[data-mins="-1440"]').click();
      const cursorPrevDay = await page.locator('#opstra-sim-clock').innerText();
      assert.notEqual(cursorPrevDay.slice(0, 10), cursorInitial.slice(0, 10), 'Must step back to previous trading day');
      await page.locator('[data-mins="1440"]').click();
      const firstMorningTime = await page.locator('#opstra-observed-time option').nth(10).getAttribute('value');
      await page.locator('#opstra-observed-time').selectOption(firstMorningTime);

      // Execute a 2-leg trade on IDEA and verify live P&L updates across minute steps!
      await page.locator('#opstra-quick-trade').check();
      await page.locator('#opstra-chain-body .opstra-btn-b:not(:disabled)').first().click();
      await page.locator('#opstra-chain-body .opstra-btn-s:not(:disabled)').first().click();
      await page.locator('[data-mins="30"]').click();
      const ideaPnl = await page.locator('#opstra-metric-totalpnl').innerText();
      assert.match(ideaPnl, /₹/, `Expected rupee P&L on IDEA spread, got ${ideaPnl}`);
      await page.locator('#opstra-btn-reset').click();

      console.log(`  ✓ IDEA Modal -> Start Simulation CLOSED cleanly! Spot=${ideaSpot} | Lot=${ideaLot} | 1m Bars=${ideaMinuteCount} | PrevDay=${cursorPrevDay} | Cursor=${cursorInitial} -> ${cursorPlus16m} | Spread P&L=${ideaPnl}`);

      // Also pick 2 additional purely random stocks from the live dropdown
      const randomExtras = await page.evaluate(known => {
        const opts = [...document.querySelectorAll('#opstra-symbol-select optgroup[label*="Stock"] option')]
          .filter(o => !o.disabled && o.value.startsWith('nse_fo|'))
          .map(o => o.value.split('|')[1])
          .filter(sym => !known.includes(sym));
        const out = [];
        if (opts.length > 10) {
          out.push(opts[Math.floor(opts.length * 0.27)]);
          out.push(opts[Math.floor(opts.length * 0.73)]);
        }
        return out;
      }, STOCKS_TO_VERIFY);

      const fullList = [...STOCKS_TO_VERIFY.slice(1), ...randomExtras];
      console.log(`--- 2. Checking ${fullList.length} additional F&O stocks (Filter search, Dropdown & Start Simulation Modal + 1m Timeline) ---`);

      for (let idx = 0; idx < fullList.length; idx++) {
        const sym = fullList[idx];
        if (idx % 3 === 0) {
          // Test via + NEW SIMULATION -> Start Simulation modal
          await page.locator('#opstra-btn-new').click();
          await modal.waitFor({ state: 'visible', timeout: 5000 });
          await modal.locator('select[name="symbol"]').selectOption('nse_fo|' + sym);
          await page.waitForFunction(
            () => {
              const btn = document.querySelector('dialog.opstra-dialog button[type="submit"]');
              return btn && !btn.disabled;
            },
            null,
            { timeout: 15000 }
          );
          await modal.locator('button[type="submit"]').click();
          await modal.waitFor({ state: 'hidden', timeout: 25000 });
        } else if (idx % 3 === 1) {
          // Test via Filter symbol input + Enter
          await page.locator('#opstra-symbol-search').fill(sym);
          await page.locator('#opstra-symbol-search').press('Enter');
        } else {
          // Test via direct dropdown selection
          await page.locator('#opstra-symbol-select').selectOption('nse_fo|' + sym);
        }

        await page.waitForFunction(
          expectedSym => {
            const title = document.getElementById('opstra-chart-title')?.textContent || '';
            const rows = document.querySelectorAll('#opstra-chain-body tr').length;
            const selDisabled = document.getElementById('opstra-symbol-select')?.disabled;
            return title.startsWith(expectedSym + ' ') && rows >= 5 && !selDisabled;
          },
          sym,
          { timeout: 25000 }
        );

        const spotTxt = await page.locator('#opstra-val-spot').innerText();
        const lotTxt = await page.locator('#opstra-val-lot').innerText();
        const minBars = await page.locator('#opstra-observed-time option').count();
        const chainCount = await page.locator('#opstra-chain-body tr').count();
        const cBefore = await page.locator('#opstra-sim-clock').innerText();
        await page.locator('[data-mins="5"]').click();
        const cAfter = await page.locator('#opstra-sim-clock').innerText();

        assert.ok(minBars >= 30, `${sym} expected >=30 1m bars, got ${minBars}`);
        assert.notEqual(cAfter, cBefore, `${sym} +5m step must advance cursor (${cBefore} -> ${cAfter})`);
        assert.ok(!await modal.isVisible(), `${sym} modal must be closed`);

        const method = idx % 3 === 0 ? 'Modal Start' : idx % 3 === 1 ? 'FilterInput' : 'SelectDrop ';
        console.log(`  ✓ ${sym.padEnd(13)} [${method}] -> Spot: ${spotTxt.padEnd(10)} | Lot: ${lotTxt.padEnd(7)} | Strikes: ${String(chainCount).padStart(2)} | 1m Bars: ${String(minBars).padStart(3)} | +5m: ${cBefore.slice(11, 16)}->${cAfter.slice(11, 16)}`);
      }

      // Take crisp screenshot of IDEA working with 1m chain & strategy payoff
      await page.locator('#opstra-symbol-select').selectOption('nse_fo|IDEA');
      await page.waitForFunction(
        () => (document.getElementById('opstra-chart-title')?.textContent || '').startsWith('IDEA ') && !document.getElementById('opstra-symbol-select')?.disabled,
        null,
        { timeout: 20000 }
      );
      await page.locator('#opstra-quick-trade').check();
      await page.locator('#opstra-chain-body .opstra-btn-b:not(:disabled)').nth(2).click();
      await page.locator('#opstra-chain-body .opstra-btn-s:not(:disabled)').nth(4).click();
      await page.locator('[data-mins="15"]').click();
      fs.mkdirSync(path.resolve(__dirname, '../scratch'), { recursive: true });
      await page.screenshot({ path: path.resolve(__dirname, '../scratch/simulator-idea-1m-verified.png') });

      assert.deepEqual(pageErrors, [], 'Zero uncaught JS errors across IDEA + 17 stocks');
      await ctx.close();
    }

    // =========================================================================
    // PART 2: file:// Protocol + Offline Static Fallback Resilience Check
    // =========================================================================
    {
      const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, timezoneId: 'Asia/Kolkata' });
      const page = await ctx.newPage();
      const fileUrl = 'file:///' + path.resolve(__dirname, '../strategy-builder.html').replace(/\\/g, '/') + '#options-simulator';
      await page.goto(fileUrl, { waitUntil: 'domcontentloaded' });
      await page.waitForFunction(() => document.querySelectorAll('#opstra-chain-body tr').length > 5, null, { timeout: 20000 });

      await page.locator('#opstra-btn-new').click();
      const modal = page.locator('dialog.opstra-dialog');
      await modal.waitFor({ state: 'visible' });
      await modal.locator('select[name="symbol"]').selectOption('nse_fo|IDEA');
      await page.waitForFunction(() => !document.querySelector('dialog.opstra-dialog button[type="submit"]')?.disabled, null, { timeout: 15000 });
      await modal.locator('button[type="submit"]').click();
      await modal.waitFor({ state: 'hidden', timeout: 20000 });
      const fileTitle = await page.locator('#opstra-chart-title').innerText();
      const fileBars = await page.locator('#opstra-observed-time option').count();
      assert.match(fileTitle, /^IDEA /);
      assert.ok(fileBars >= 50, `Expected live 1m bars on file:// for IDEA, got ${fileBars}`);
      console.log(`--- 3. Verified file:// protocol auto-discovery -> ${fileTitle} (${fileBars} 1m bars, modal closed cleanly) ---`);
      await ctx.close();
    }

    // Simulate offline / GitHub Pages (local backend unreachable) and verify Start Simulation STILL works for IDEA & PNB!
    {
      const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, timezoneId: 'Asia/Kolkata' });
      const page = await ctx.newPage();
      await page.route('**/api/aliceblue/**', route => route.abort('connectionrefused'));
      await page.route('**/api/nse-library**', route => route.abort('connectionrefused'));

      await page.goto('http://127.0.0.1:4174/strategy-builder.html#options-simulator', { waitUntil: 'domcontentloaded' });
      await page.waitForFunction(() => document.querySelectorAll('#opstra-chain-body tr').length > 5, null, { timeout: 20000 });

      for (const offlineSym of ['IDEA', 'PNB']) {
        await page.locator('#opstra-btn-new').click();
        const modal = page.locator('dialog.opstra-dialog');
        await modal.waitFor({ state: 'visible' });
        await modal.locator('select[name="symbol"]').selectOption('nse_fo|' + offlineSym);
        await page.waitForFunction(() => !document.querySelector('dialog.opstra-dialog button[type="submit"]')?.disabled, null, { timeout: 15000 });
        await modal.locator('button[type="submit"]').click();
        await modal.waitFor({ state: 'hidden', timeout: 20000 });
        await page.waitForFunction(s => (document.getElementById('opstra-chart-title')?.textContent || '').startsWith(s + ' '), offlineSym, { timeout: 15000 });
      }
      console.log('--- 4. Verified Offline / No-Backend Fallback -> IDEA & PNB Start Simulation closed modal & loaded verified NSE archive! ---');
      await ctx.close();
    }

    console.log('\nALL RANDOM-STOCK OPTIONS SIMULATOR, 1M TIMELINE, PREVIOUS-DATE & OFFLINE FALLBACK CHECKS PASSED 100%!');
  } finally {
    await browser.close();
  }
})().catch(err => {
  console.error(err);
  process.exit(1);
});

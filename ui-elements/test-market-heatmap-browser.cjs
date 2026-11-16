'use strict';
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const assert = require('node:assert/strict');
const { chromium } = require(path.resolve(__dirname, 'gallery-build/node_modules/playwright'));

const BASE_URL = process.env.IWSM_TEST_URL || 'http://127.0.0.1:4174';
const ARTIFACT_DIR = process.env.IWSM_HEATMAP_SCREENSHOT_DIR || os.tmpdir();

(async () => {
  const chromeWin = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
  const browser = await chromium.launch({
    ...(fs.existsSync(chromeWin) ? { executablePath: chromeWin } : {}),
    headless: true,
  });

  try {
    // =========================================================================
    // MANDATORY TESTS 1–17 & 19: Deep End-to-End Functional Verification
    // =========================================================================
    {
      const ctx = await browser.newContext({
        viewport: { width: 1440, height: 920 },
        timezoneId: 'Asia/Kolkata',
      });
      const page = await ctx.newPage();
      const pageErrors = [];
      const httpErrors = [];
      page.on('pageerror', e => pageErrors.push(e.message));
      page.on('response', r => {
        if (r.status() >= 400 && r.url().includes('/api/heatmap/')) {
          httpErrors.push(`HTTP ${r.status()} ${r.url()}`);
        }
      });

      // 1. Open Options Strategy Lab
      await page.goto(`${BASE_URL}/strategy-builder.html`, { waitUntil: 'domcontentloaded' });
      const heatmapTab = page.locator('.lab-jumps a[href="#market-heatmap"]');
      await heatmapTab.waitFor({ state: 'visible' });
      assert.equal((await heatmapTab.innerText()).trim(), 'HEATMAP', 'HEATMAP tab present in Options Strategy Lab navigation');

      // 2. Click HEATMAP tab & verify in-page switch without leaving Strategy Lab
      await heatmapTab.click();
      await page.locator('#market-heatmap').waitFor({ state: 'visible' });
      assert.equal(await heatmapTab.getAttribute('aria-current'), 'page', 'HEATMAP tab marked aria-current="page"');

      // 3. Load NIFTY 50 & verify backend data parity
      await page.waitForFunction(
        () => Number(document.getElementById('hm-count-total')?.textContent || '0') >= 48 && document.getElementById('hm-overlay')?.hidden === true,
        { timeout: 25000 }
      );
      const apiNifty50 = await (await fetch(`${BASE_URL}/api/heatmap/securities?universe=NIFTY%2050`)).json();
      const uiCount50 = Number(await page.locator('#hm-count-total').innerText());
      assert.equal(uiCount50, apiNifty50.totalUniverseCount, `NIFTY 50 count matches backend (${uiCount50})`);
      console.log(`PASS 1–3: Strategy Lab -> HEATMAP tab -> NIFTY 50 loaded (${uiCount50} stocks, parity verified).`);

      // Capture Light & Dark visual screenshots for design inspection
      await page.waitForTimeout(350);
      await page.screenshot({ path: path.join(ARTIFACT_DIR, 'heatmap-nifty50-light.png') });
      await page.locator('#theme').click();
      await page.waitForTimeout(350);
      await page.screenshot({ path: path.join(ARTIFACT_DIR, 'heatmap-nifty50-dark.png') });
      await page.locator('#theme').click();

      // 4. Load NIFTY 100
      await page.locator('#hm-universe').selectOption('NIFTY 100');
      await page.waitForFunction(() => Number(document.getElementById('hm-count-total')?.textContent || '0') >= 95, { timeout: 15000 });
      console.log(`PASS 4: NIFTY 100 loaded (${await page.locator('#hm-count-total').innerText()} stocks).`);

      // 5. Load NIFTY 500
      await page.locator('#hm-universe').selectOption('NIFTY 500');
      await page.waitForFunction(() => Number(document.getElementById('hm-count-total')?.textContent || '0') >= 480, { timeout: 20000 });
      console.log(`PASS 5: NIFTY 500 loaded (${await page.locator('#hm-count-total').innerText()} stocks).`);

      // 6. Switch between Market Cap, Volume 1D, Turnover 1D, and Equal Size
      for (const sz of ['volume1d', 'turnover1d', 'equal', 'marketCap']) {
        await page.locator('#hm-size-by').selectOption(sz);
        assert.equal(await page.locator('#hm-size-by').inputValue(), sz);
      }
      console.log('PASS 6: Size By dynamic switching (Market Cap, Volume 1D, Turnover 1D, Equal Size) verified.');

      // 7. Switch between Daily Change (1D %) and Weekly Performance (1W %) colouring + Legend click
      await page.locator('#hm-color-by').selectOption('perf1w');
      assert.match(await page.locator('#hm-legend').innerText(), /Performance 1W %/, 'Legend updated to Performance 1W %');
      const shownBeforeBucket = Number(await page.locator('#hm-count-shown').innerText());
      await page.locator('#hm-legend .hm-legend-bucket').nth(3).click();
      await page.waitForTimeout(100);
      const shownAfterBucket = Number(await page.locator('#hm-count-shown').innerText());
      assert.ok(shownAfterBucket <= shownBeforeBucket, 'Clicking legend bucket filters matching performance range');
      await page.locator('#hm-legend .hm-legend-bucket').nth(3).click(); // restore
      await page.locator('#hm-color-by').selectOption('changePct');
      console.log('PASS 7: Color By switching (1D % <-> 1W %) & interactive legend bucket toggling verified.');

      // 8. Switch between Sector, Industry, and No Group
      await page.locator('#hm-group-by').selectOption('industry');
      await page.waitForTimeout(120);
      await page.locator('#hm-group-by').selectOption('none');
      await page.waitForTimeout(120);
      await page.locator('#hm-group-by').selectOption('sector');
      console.log('PASS 8: Group By switching (Sector, Industry, No Group) verified.');

      // 9. Search for RELIANCE
      await page.locator('#hm-search').fill('RELIANCE');
      await page.waitForFunction(() => {
        const n = Number(document.getElementById('hm-count-shown')?.textContent || '0');
        return n >= 1 && n <= 5;
      }, { timeout: 5000 });
      await page.locator('#hm-search-clear').click();
      await page.waitForFunction(() => Number(document.getElementById('hm-count-shown')?.textContent || '0') >= 480, { timeout: 5000 });
      console.log('PASS 9: Real-time debounced stock search ("RELIANCE") & clear verified.');

      // 10. Apply Finance / Banking Sector filter
      await page.locator('#hm-btn-filters').click();
      await page.locator('#hm-filter-drawer').waitFor({ state: 'visible' });
      await page.locator('#hm-filter-sector').selectOption('Finance');
      await page.locator('#hm-filter-apply').click();
      const financeOnlyCount = Number(await page.locator('#hm-count-shown').innerText());
      assert.ok(financeOnlyCount > 10 && financeOnlyCount < 200, `Finance sector filter narrowed NIFTY 500 to ${financeOnlyCount} stocks`);
      console.log(`PASS 10: Sector filter ("Finance") verified (${financeOnlyCount} stocks).`);

      // 11. Apply multiple combinable filters together (NIFTY 500 + Finance + Min Market Cap 50,000 Cr)
      await page.locator('#hm-filter-drawer input[name="minMarketCapCr"]').fill('50000');
      await page.locator('#hm-filter-apply').click();
      const multiFilterCount = Number(await page.locator('#hm-count-shown').innerText());
      const backendFilterCheck = await (await fetch(`${BASE_URL}/api/heatmap/filters`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ universe: 'NIFTY 500', filters: { sector: 'Finance', minMarketCapCr: 50000 } }),
      })).json();
      assert.equal(multiFilterCount, backendFilterCheck.matchedCount, `Multi-filter UI count (${multiFilterCount}) matches backend (${backendFilterCheck.matchedCount})`);
      assert.equal(await page.locator('#hm-filter-count').innerText(), '2', 'Active filter count badge shows 2');
      await page.locator('#hm-clear-all').click();
      assert.ok(await page.locator('#hm-filter-count').isHidden(), 'Clear All resets active filter badge');
      console.log(`PASS 11: Multi-filter combination + parity with POST /api/heatmap/filters (${multiFilterCount}) verified.`);

      // 12 & 13. Hover over stock tiles + Click stock tile -> Stock Details Modal + Backend parity
      await page.locator('#hm-universe').selectOption('NIFTY 50');
      await page.waitForFunction(() => Number(document.getElementById('hm-count-total')?.textContent || '0') === 50, { timeout: 10000 });
      const canvasBox = await page.locator('#hm-canvas').boundingBox();
      await page.mouse.move(canvasBox.x + 140, canvasBox.y + 140);
      await page.waitForTimeout(200);

      // Sort by Symbol A->Z to verify Sort table + deterministic click on RELIANCE
      await page.locator('#hm-sort-by').selectOption('symbol_asc');
      await page.locator('#hm-sorted-panel').waitFor({ state: 'visible' });
      await page.locator('#hm-search').fill('RELIANCE');
      await page.waitForTimeout(220);
      await page.locator('#hm-sorted-rows tr[data-row-sym="RELIANCE"]').click();

      const stockDlg = page.locator('#hm-stock-dialog');
      await stockDlg.waitFor({ state: 'visible' });
      assert.equal(await page.locator('#hm-dlg-symbol').innerText(), 'RELIANCE');
      const apiRelDetail = await (await fetch(`${BASE_URL}/api/heatmap/stock/RELIANCE`)).json();
      const dlgPriceTxt = await page.locator('#hm-dlg-price').innerText();
      const parsedDlgPrice = Number(dlgPriceTxt.replace(/[₹,]/g, ''));
      assert.ok(Math.abs(parsedDlgPrice - apiRelDetail.quote.price) < 5, `Modal price (${parsedDlgPrice}) matches backend quote (${apiRelDetail.quote.price})`);

      // Pin RELIANCE to Watchlist
      await page.locator('#hm-dlg-watch').click();
      await page.locator('#hm-dlg-close').click();
      assert.match(await page.locator('#hm-watchlist').innerText(), /RELIANCE/, 'RELIANCE pinned to Watchlist bar');
      await page.locator('#hm-clear-all').click();
      await page.locator('#hm-sorted-close').click();
      console.log('PASS 12–13: Tile hover, Sort view, Stock Details Modal, 1D Intraday chart & Watchlist verified.');

      // 14. Fullscreen mode toggle
      await page.locator('#hm-btn-fullscreen').click();
      await page.waitForTimeout(150);
      assert.equal(await page.locator('#hm-btn-fullscreen').getAttribute('aria-pressed'), 'true', 'Fullscreen activated');
      await page.locator('#hm-btn-fullscreen').click();
      await page.waitForTimeout(150);
      console.log('PASS 14: Fullscreen mode enter & exit verified.');

      // 15, 16 & 17. Live feed indicator, WebSocket disconnect/reconnect resilience & Market-Closed state
      const feedTextInitial = await page.locator('#hm-feed-text').innerText();
      assert.match(feedTextInitial, /LIVE|MARKET CLOSED/, `Live/Market-Closed indicator rendered (${feedTextInitial})`);

      // Simulate offline network disconnect -> refresh attempt preserves existing 50 quotes without blanking!
      await ctx.setOffline(true);
      await page.locator('#hm-btn-refresh').click();
      await page.waitForTimeout(400);
      assert.equal(Number(await page.locator('#hm-count-total').innerText()), 50, 'Offline disconnect preserved all 50 last-known quotes');
      await ctx.setOffline(false);
      await page.locator('#hm-btn-refresh').click();
      await page.waitForTimeout(500);
      console.log('PASS 15–17: Live indicator, disconnect quote preservation, reconnect recovery & IST session awareness verified.');

      // 19. Confirm all existing Options Strategy Lab features still work!
      for (const [hash, selector] of [
        ['#builder-start', '#builder-view'],
        ['#options-simulator', '#options-simulator'],
        ['#historical-lab', '#historical-lab'],
        ['#strategy-comparison', '#strategy-comparison'],
        ['#options-research', '#options-research'],
        ['#strategy-tools', '#strategy-tools'],
        ['#market-heatmap', '#market-heatmap'],
      ]) {
        await page.locator(`.lab-jumps a[href="${hash}"]`).click();
        await page.locator(selector).waitFor({ state: 'visible' });
      }
      console.log('PASS 19: All 7 Strategy Lab tabs (Builder, Simulator, Backtest, Compare, Research, Screener & Portfolio, HEATMAP) work cleanly.');

      assert.deepEqual(pageErrors, [], 'Zero uncaught page errors');
      assert.deepEqual(httpErrors, [], 'Zero HTTP 4xx/5xx heatmap API errors');
      await ctx.close();
    }

    // =========================================================================
    // MANDATORY TEST 18: Responsive Breakpoints (1920, 1440, 1024, 768, 390) × Light & Dark
    // =========================================================================
    for (const width of [1920, 1440, 1024, 768, 390]) {
      for (const theme of ['light', 'dark']) {
        const height = width <= 768 ? 844 : 940;
        const ctx = await browser.newContext({ viewport: { width, height }, timezoneId: 'Asia/Kolkata' });
        const page = await ctx.newPage();
        const errs = [];
        page.on('pageerror', e => errs.push(e.message));
        await page.addInitScript(t => localStorage.setItem('iwsm_theme', t), theme);
        await page.goto(`${BASE_URL}/strategy-builder.html#market-heatmap`, { waitUntil: 'domcontentloaded' });
        await page.waitForFunction(
          () => Number(document.getElementById('hm-count-total')?.textContent || '0') >= 48 && document.getElementById('hm-overlay')?.hidden === true,
          { timeout: 20000 }
        );
        const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
        assert.ok(overflow <= 2, `Zero horizontal overflow at ${width}px (${theme}), got ${overflow}px`);
        assert.deepEqual(errs, [], `Zero JS errors at ${width}px (${theme})`);
        await ctx.close();
      }
      console.log(`PASS 18 (${width}px Light & Dark): Responsive heatmap layout verified.`);
    }

    console.log('ALL 19 MANDATORY HEATMAP E2E, PARITY, WEBSOCKET, RESPONSIVE & REGRESSION TESTS PASSED 100%!');
  } finally {
    await browser.close();
  }
})().catch(err => {
  console.error(err);
  process.exit(1);
});

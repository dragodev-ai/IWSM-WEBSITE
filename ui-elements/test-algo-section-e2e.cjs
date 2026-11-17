'use strict';
const path = require('node:path');
const fs = require('node:fs');
const assert = require('node:assert/strict');
const { chromium } = require(path.resolve(__dirname, 'gallery-build/node_modules/playwright'));

const OUT_DIR = path.resolve(
  process.env.ALGO_SCREENSHOT_DIR ||
    path.join(__dirname, '..', '.playwright-screenshots')
);

async function runSuite() {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const chromeWin = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
  const browser = await chromium.launch({
    ...(fs.existsSync(chromeWin) ? { executablePath: chromeWin } : {}),
    headless: true,
  });

  try {
    // -----------------------------------------------------------------------
    // 1. Test HTTP Local Preview (http://127.0.0.1:4174/index.html#algo-trading)
    // -----------------------------------------------------------------------
    const ctxHttp = await browser.newContext({ viewport: { width: 1440, height: 960 } });
    const page = await ctxHttp.newPage();
    const consoleErrors = [];
    page.on('pageerror', (err) => consoleErrors.push('PAGEERROR: ' + err.message));
    page.on('console', (msg) => {
      if (msg.type() === 'error') consoleErrors.push('CONSOLE: ' + msg.text());
    });

    await page.goto('http://127.0.0.1:4174/index.html#algo-trading', { waitUntil: 'networkidle' });
    await page.locator('#ar-equity-canvas').waitFor({ state: 'visible', timeout: 10000 });
    await page.waitForTimeout(400);

    const sectionText = await page.locator('#algo-trading').innerText();
    assert(!/temporarily unavailable/i.test(sectionText), 'Must never show unavailable error');
    assert(!/alice\s*blue|aliceblue|1lyalgos|1ly\s*algo/i.test(sectionText), 'Must contain ZERO Alice Blue or 1lyAlgos brand text');

    // Verify Free Algo CTA links
    const ctaLinks = await page.locator('#algo-trading a.ar-free-algo-btn').evaluateAll((els) =>
      els.map((a) => ({ text: a.innerText.trim(), href: a.getAttribute('href'), target: a.getAttribute('target') }))
    );
    assert(ctaLinks.length >= 2, 'Expected Free Algo CTA buttons');
    for (const link of ctaLinks) {
      assert.equal(link.href, 'https://ekyc.aliceblueonline.com/?source=WRAJ1371');
      assert.equal(link.target, '_blank');
      assert(/free algo/i.test(link.text), `CTA text should mention Free Algo, got: ${link.text}`);
    }

    // Verify exact Overall headline & curve values
    assert.equal(await page.locator('#ar-top-capital').innerText(), '₹18,000');
    assert.equal(await page.locator('#ar-top-winrate').innerText(), '60.12%');
    assert.equal(await page.locator('#ar-top-netprofit').innerText(), '+₹1,05,054.00');
    assert.equal(await page.locator('#ar-top-winstreak').innerText(), '12');
    assert.equal(await page.locator('#ar-top-lossstreak').innerText(), '5');

    assert.equal(await page.locator('#ar-spec-min').innerText(), '₹18,000');
    assert.equal(await page.locator('#ar-spec-dd').innerText(), '24.2%');
    assert.equal(await page.locator('#ar-spec-period').innerText(), '2 years 10 months 20 days');
    assert.equal(await page.locator('#ar-spec-risk').innerText(), 'Medium');

    assert.equal(await page.locator('#ar-kpi-pnl').innerText(), '+₹1,05,054.00');
    assert.equal(await page.locator('#ar-kpi-return').innerText(), '+583.63%');
    assert.equal(await page.locator('#ar-kpi-dd').innerText(), '-₹7,442.00');
    assert.equal(await page.locator('#ar-kpi-winratio').innerText(), '60.12%');
    assert.equal(await page.locator('#ar-kpi-winstreak').innerText(), '12');
    assert.equal(await page.locator('#ar-kpi-lossstreak').innerText(), '5');

    // Verify both Chart.js canvases rendered non-zero dimensions and 658 points on Overall
    const chartCheck = await page.evaluate(() => {
      const eq = document.getElementById('ar-equity-canvas');
      const dd = document.getElementById('ar-dd-canvas');
      const eqChart = window.Chart && window.Chart.getChart(eq);
      const ddChart = window.Chart && window.Chart.getChart(dd);
      return {
        eqWidth: eq.width,
        eqHeight: eq.height,
        ddWidth: dd.width,
        ddHeight: dd.height,
        eqPoints: eqChart ? eqChart.data.datasets[0].data.length : 0,
        eqFirst: eqChart ? eqChart.data.datasets[0].data[0] : null,
        eqLast: eqChart ? eqChart.data.datasets[0].data.at(-1) : null,
        ddMin: ddChart ? Math.min(...ddChart.data.datasets[0].data) : null,
        ddScaleMin: ddChart ? ddChart.options.scales.y.min : null,
      };
    });
    assert(chartCheck.eqWidth > 300 && chartCheck.eqHeight > 150, 'Equity canvas must render');
    assert(chartCheck.ddWidth > 300 && chartCheck.ddHeight > 120, 'Drawdown canvas must render');
    assert.equal(chartCheck.eqPoints, 658);
    assert.equal(chartCheck.eqFirst, 18000);
    assert.equal(chartCheck.eqLast, 123054);
    assert.equal(chartCheck.ddMin, -7442);
    assert.equal(chartCheck.ddScaleMin, -8186.2);

    // Screenshot 1: Desktop Dark Mode
    await page.locator('#algo-trading').scrollIntoViewIfNeeded();
    await page.waitForTimeout(250);
    await page.locator('#algo-trading').screenshot({ path: path.join(OUT_DIR, 'algo-desktop-dark.png') });

    // Test Period Tabs: Monthly, Weekly, Today, Range
    await page.locator('.ar-period-pills button[data-period="monthly"]').click();
    assert.equal(await page.locator('#ar-kpi-pnl').innerText(), '+₹4,570.00');
    assert.equal(await page.locator('#ar-kpi-return').innerText(), '+25.39%');
    assert.equal(await page.locator('#ar-kpi-dd').innerText(), '-₹638.00');
    assert.equal(await page.locator('#ar-kpi-winratio').innerText(), '81.82%');

    await page.locator('.ar-period-pills button[data-period="weekly"]').click();
    assert.equal(await page.locator('#ar-kpi-pnl').innerText(), '+₹267.00');
    assert.equal(await page.locator('#ar-kpi-return').innerText(), '+1.48%');
    assert.equal(await page.locator('#ar-kpi-dd').innerText(), '-₹623.00');
    assert.equal(await page.locator('#ar-kpi-winratio').innerText(), '50.00%');

    await page.locator('.ar-period-pills button[data-period="today"]').click();
    assert.equal(await page.locator('#ar-kpi-pnl').innerText(), '-₹623.00');
    assert.equal(await page.locator('#ar-kpi-return').innerText(), '-3.46%');
    assert.equal(await page.locator('#ar-kpi-dd').innerText(), '-₹623.00');
    assert.equal(await page.locator('#ar-kpi-winratio').innerText(), '0.00%');

    await page.locator('.ar-period-pills button[data-period="range"]').click();
    await page.locator('#ar-range-from').fill('2024-01-02');
    await page.locator('#ar-range-to').fill('2024-12-31');
    await page.locator('#ar-range-apply').click();
    const pnl2024 = await page.locator('#ar-kpi-pnl').innerText();
    assert(pnl2024.startsWith('+₹'), `Expected positive 2024 P&L, got ${pnl2024}`);

    // Reset back to Overall & test interactive Capital scaling (2 Lots = ₹36,000)
    await page.locator('#ar-reset-btn').click();
    assert.equal(await page.locator('#ar-kpi-pnl').innerText(), '+₹1,05,054.00');

    await page.locator('#ar-cap-inc').click();
    assert.equal(await page.locator('#ar-top-capital').innerText(), '₹36,000');
    assert.equal(await page.locator('#ar-top-netprofit').innerText(), '+₹2,10,108.00');
    assert.equal(await page.locator('#ar-kpi-pnl').innerText(), '+₹2,10,108.00');
    assert.equal(await page.locator('#ar-kpi-dd').innerText(), '-₹14,884.00');
    assert.equal(await page.locator('#ar-kpi-return').innerText(), '+583.63%');
    await page.locator('#ar-reset-btn').click();

    // Screenshot 2: Desktop Light Mode
    await page.locator('#theme-toggle-btn').click();
    await page.waitForTimeout(300);
    await page.locator('#algo-trading').screenshot({ path: path.join(OUT_DIR, 'algo-desktop-light.png') });

    // Mobile Responsive Check (390px) — Zero Horizontal Overflow
    await page.setViewportSize({ width: 390, height: 844 });
    await page.waitForTimeout(300);
    const mobileOverflow = await page.evaluate(() => {
      return document.documentElement.scrollWidth - document.documentElement.clientWidth;
    });
    assert(mobileOverflow <= 1, `Expected zero mobile horizontal overflow, got ${mobileOverflow}px`);
    await page.locator('#ar-graphs-card').screenshot({ path: path.join(OUT_DIR, 'algo-mobile-graphs.png') });

    assert.equal(consoleErrors.length, 0, 'Unexpected console/page errors: ' + consoleErrors.join(' | '));
    await ctxHttp.close();

    // -----------------------------------------------------------------------
    // 2. Test Offline file:/// Protocol (file:///D:/IWSM%20WEBSITE/index.html)
    // -----------------------------------------------------------------------
    const ctxFile = await browser.newContext({ viewport: { width: 1440, height: 960 } });
    const filePage = await ctxFile.newPage();
    const fileUrl = 'file:///' + path.resolve(__dirname, '..', 'index.html').replace(/\\/g, '/') + '#algo-trading';
    await filePage.goto(fileUrl, { waitUntil: 'load' });
    await filePage.locator('#ar-equity-canvas').waitFor({ state: 'visible', timeout: 10000 });
    assert.equal(await filePage.locator('#ar-top-netprofit').innerText(), '+₹1,05,054.00');
    assert.equal(await filePage.locator('#ar-kpi-pnl').innerText(), '+₹1,05,054.00');
    await ctxFile.close();

    console.log('ALL ALGO SECTION E2E CHECKS PASSED (HTTP + FILE + PERIODS + CAPITAL + LIGHT/DARK + MOBILE)!');
  } finally {
    await browser.close();
  }
}

runSuite().catch((err) => {
  console.error('ALGO SECTION E2E FAILED:', err);
  process.exit(1);
});

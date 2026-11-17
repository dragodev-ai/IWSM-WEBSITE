'use strict';
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { chromium } = require(path.resolve(__dirname, 'gallery-build/node_modules/playwright'));

const OUT_DIR = path.resolve(
  process.env.CHAIN_SCREENSHOT_DIR ||
    path.join(__dirname, '..', '.playwright-screenshots')
);

async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const chromeWin = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
  const browser = await chromium.launch({
    ...(fs.existsSync(chromeWin) ? { executablePath: chromeWin } : {}),
    headless: true,
  });

  try {
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 960 }, timezoneId: 'Asia/Kolkata' });
    const page = await ctx.newPage();
    const errs = [];
    page.on('pageerror', (e) => errs.push(e.message));

    await page.addInitScript(() => localStorage.setItem('iwsm_theme', 'light'));
    await page.goto('http://127.0.0.1:4174/strategy-builder.html#options-simulator', { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(
      () => document.querySelectorAll('#opstra-chain-body tr').length >= 15,
      null,
      { timeout: 25000 }
    );

    // Select All Strikes to guarantee tall scrollable chain
    await page.locator('#opstra-chain-range').selectOption('0');
    await page.waitForTimeout(250);

    await page.locator('#opstra-chain-section').scrollIntoViewIfNeeded();
    await page.waitForTimeout(200);

    // Verify 11 default headers and group colspans = 5
    const defaultCols = await page.evaluate(() => {
      const ths = [...document.querySelectorAll('#opstra-chain-head th:not([hidden])')].map((t) => t.textContent.trim());
      const groups = [...document.querySelectorAll('#opstra-chain-head .opstra-group-side')].map((td) => td.colSpan);
      return { ths, groups };
    });
    assert.deepEqual(defaultCols.ths, [
      'Call B/S',
      'Call OI',
      'Call LTP',
      'Call IV',
      'Call Delta',
      'Strike',
      'Put Delta',
      'Put IV',
      'Put LTP',
      'Put OI',
      'Put B/S',
    ]);
    assert.deepEqual(defaultCols.groups, [5, 5]);

    // Verify internal scrollability and sticky header lock when scrolled down 450px
    const stickyMetrics = await page.evaluate(() => {
      const scroller = document.getElementById('opstra-chain-scroll');
      scroller.scrollTop = 0;
      const boxBefore = scroller.getBoundingClientRect();
      const groupBefore = scroller.querySelector('.opstra-group-call').getBoundingClientRect();
      const colsBefore = scroller.querySelector('.opstra-th-strike').getBoundingClientRect();
      const firstRowBefore = scroller.querySelector('#opstra-chain-body tr td').getBoundingClientRect();

      scroller.scrollTop = Math.min(450, scroller.scrollHeight - scroller.clientHeight);
      const actualScrollTop = scroller.scrollTop;
      const boxAfter = scroller.getBoundingClientRect();
      const groupAfter = scroller.querySelector('.opstra-group-call').getBoundingClientRect();
      const colsAfter = scroller.querySelector('.opstra-th-strike').getBoundingClientRect();
      const firstRowAfter = scroller.querySelector('#opstra-chain-body tr td').getBoundingClientRect();

      return {
        scrollHeight: scroller.scrollHeight,
        clientHeight: scroller.clientHeight,
        actualScrollTop,
        groupOffsetBefore: groupBefore.top - boxBefore.top,
        groupOffsetAfter: groupAfter.top - boxAfter.top,
        colsOffsetBefore: colsBefore.top - boxBefore.top,
        colsOffsetAfter: colsAfter.top - boxAfter.top,
        rowMovedPx: firstRowBefore.top - firstRowAfter.top,
      };
    });

    assert.ok(stickyMetrics.scrollHeight > stickyMetrics.clientHeight + 100, 'Option chain container must scroll internally');
    assert.ok(stickyMetrics.actualScrollTop > 100, 'Option chain must scroll down');
    assert.ok(stickyMetrics.rowMovedPx > 100, 'Body rows must move upward when scrolling down');
    assert.ok(Math.abs(stickyMetrics.groupOffsetAfter - stickyMetrics.groupOffsetBefore) <= 1.5, 'Group banner row must stay pinned at top:0');
    assert.ok(Math.abs(stickyMetrics.colsOffsetAfter - stickyMetrics.colsOffsetBefore) <= 1.5, 'Column index row must stay pinned right below group row');

    // Capture Light Mode screenshot WHILE scrolled down!
    await page.locator('#opstra-chain-section').screenshot({ path: path.join(OUT_DIR, 'chain-sticky-light.png') });

    // Test Center ATM button
    await page.locator('#opstra-btn-center-atm').click();
    await page.waitForTimeout(350);
    const atmVisible = await page.evaluate(() => {
      const scroller = document.getElementById('opstra-chain-scroll');
      const atm = scroller.querySelector('.opstra-row-atm');
      if (!atm) return false;
      const sr = scroller.getBoundingClientRect();
      const ar = atm.getBoundingClientRect();
      return ar.top >= sr.top + 55 && ar.bottom <= sr.bottom;
    });
    assert.ok(atmVisible, 'Center ATM button brings ATM row cleanly into visible scroll area below sticky header');

    // Test Full Columns toggle (17 columns, colSpan = 8)
    await page.locator('#opstra-chain-detail-cols').check();
    const detailState = await page.evaluate(() => ({
      count: document.querySelectorAll('#opstra-chain-head th:not([hidden])').length,
      groups: [...document.querySelectorAll('#opstra-chain-head .opstra-group-side')].map((td) => td.colSpan),
    }));
    assert.equal(detailState.count, 17);
    assert.deepEqual(detailState.groups, [8, 8]);
    await page.locator('#opstra-chain-detail-cols').uncheck();

    // Switch to Dark Mode, scroll down 350px, and capture Dark Mode screenshot!
    await page.locator('#theme').click();
    await page.waitForTimeout(250);
    await page.evaluate(() => {
      const scroller = document.getElementById('opstra-chain-scroll');
      scroller.scrollTop = Math.min(350, scroller.scrollHeight - scroller.clientHeight);
    });
    await page.waitForTimeout(150);
    await page.locator('#opstra-chain-section').screenshot({ path: path.join(OUT_DIR, 'chain-sticky-dark.png') });

    assert.deepEqual(errs, [], 'Zero page errors during Option Chain sticky scroll checks');
    await ctx.close();
    console.log('ALL OPTION CHAIN STICKY HEADER & COLUMN CLARITY CHECKS PASSED!');
  } finally {
    await browser.close();
  }
}

main().catch((err) => {
  console.error('OPTION CHAIN STICKY SCROLL TEST FAILED:', err);
  process.exit(1);
});

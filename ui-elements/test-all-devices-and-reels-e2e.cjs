'use strict';
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { chromium } = require(path.resolve(__dirname, 'gallery-build/node_modules/playwright'));

const BASE = process.env.IWSM_TEST_URL || 'http://127.0.0.1:4174';
const ARTIFACT_DIR = process.env.IWSM_ARTIFACT_DIR || '';

const VIEWPORTS = [
  { name: 'Phone-320', width: 320, height: 568, hasTouch: true },
  { name: 'Phone-390', width: 390, height: 844, hasTouch: true },
  { name: 'Phone-Land-844x390', width: 844, height: 390, hasTouch: true },
  { name: 'Tablet-Port-768', width: 768, height: 1024, hasTouch: true },
  { name: 'Tablet-Land-1024', width: 1024, height: 768, hasTouch: true },
  { name: 'Laptop-1280x720', width: 1280, height: 720, hasTouch: false },
  { name: 'Laptop-1366x768', width: 1366, height: 768, hasTouch: false },
  { name: 'Desktop-1440', width: 1440, height: 900, hasTouch: false },
  { name: 'FHD-TV-Panel-1920', width: 1920, height: 1080, hasTouch: false },
  { name: 'QHD-Board-2560', width: 2560, height: 1440, hasTouch: false },
  { name: 'UHD-4K-TV-3840', width: 3840, height: 2160, hasTouch: false },
];

const PAGES = [
  { name: 'home', path: '/index.html' },
  { name: 'reviews', path: '/reviews.html' },
  { name: 'lab-builder', path: '/strategy-builder.html#builder-start' },
  { name: 'lab-simulator', path: '/strategy-builder.html#options-simulator' },
  { name: 'lab-heatmap', path: '/strategy-builder.html#market-heatmap' },
];

(async () => {
  const chromeWin = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
  const browser = await chromium.launch({
    ...(fs.existsSync(chromeWin) ? { executablePath: chromeWin } : {}),
    headless: true,
  });

  try {
    // =========================================================================
    // PART 1: ALL 11 DEVICE PROFILES x 5 VIEWS (Zero Overflow, Zero Broken Assets, Big-Screen Scaling)
    // =========================================================================
    let checkedCount = 0;
    for (const vp of VIEWPORTS) {
      const ctx = await browser.newContext({
        viewport: { width: vp.width, height: vp.height },
        hasTouch: vp.hasTouch,
        timezoneId: 'Asia/Kolkata',
      });
      for (const pg of PAGES) {
        const page = await ctx.newPage();
        const pageErrors = [];
        const consoleErrors = [];
        const httpFails = [];
        page.on('pageerror', e => pageErrors.push(e.message));
        page.on('console', m => { if (m.type() === 'error') consoleErrors.push(m.text()); });
        page.on('response', r => {
          if (r.status() >= 400 && r.status() !== 401) {
            httpFails.push(`${r.status()} ${r.url()}`);
          }
        });

        await page.goto(BASE + pg.path, { waitUntil: 'domcontentloaded', timeout: 25000 });
        await page.waitForTimeout(pg.name.startsWith('lab-') ? 1200 : 700);

        const m = await page.evaluate(() => {
          const vw = window.innerWidth;
          const sw = document.documentElement.scrollWidth;
          const overflowPx = Math.max(0, sw - vw);
          const mainEl = document.querySelector('.iwsm-lab main, .container');
          const containerW = mainEl ? Math.round(mainEl.getBoundingClientRect().width) : 0;
          const bodyFontPx = parseFloat(getComputedStyle(document.body).fontSize) || 16;
          const brokenImgs = [...document.querySelectorAll('img')]
            .filter(img => {
              const st = getComputedStyle(img);
              return st.display !== 'none' && st.visibility !== 'hidden' && img.complete && img.naturalWidth === 0;
            })
            .map(img => img.getAttribute('src') || img.alt);
          let smallButtons = 0;
          if (vw <= 1024) {
            for (const b of document.querySelectorAll('button, a.btn, .nav-item, .drawer-link, .video-filter-pill, .opstra-tf-pill')) {
              const st = getComputedStyle(b);
              if (st.display === 'none' || st.visibility === 'hidden') continue;
              const r = b.getBoundingClientRect();
              if (r.width > 0 && r.height > 0 && (r.height < 40 || r.width < 40)) smallButtons++;
            }
          }
          return { vw, sw, overflowPx, containerW, bodyFontPx, brokenImgs, smallButtons };
        });

        assert.equal(m.overflowPx, 0, `${vp.name} ${pg.name}: horizontal overflow ${m.overflowPx}px (sw=${m.sw} > vw=${m.vw})`);
        assert.equal(m.brokenImgs.length, 0, `${vp.name} ${pg.name}: broken images ${JSON.stringify(m.brokenImgs)}`);
        assert.equal(pageErrors.length, 0, `${vp.name} ${pg.name}: pageErrors ${JSON.stringify(pageErrors)}`);
        assert.equal(consoleErrors.length, 0, `${vp.name} ${pg.name}: consoleErrors ${JSON.stringify(consoleErrors)}`);
        assert.equal(httpFails.length, 0, `${vp.name} ${pg.name}: httpFails ${JSON.stringify(httpFails)}`);
        if (vp.hasTouch && pg.name === 'home') {
          assert.equal(m.smallButtons, 0, `${vp.name} ${pg.name}: found ${m.smallButtons} undersized touch buttons (<40px)`);
        }

        // Verify big-screen Classroom Panel & 4K TV scaling
        if (vp.width === 2560 && pg.name === 'home') {
          assert.ok(m.bodyFontPx >= 18, `2K SmartBoard font should scale >= 18px (got ${m.bodyFontPx})`);
          assert.ok(m.containerW >= 1800, `2K SmartBoard container should expand >= 1800px (got ${m.containerW})`);
        }
        if (vp.width === 3840 && pg.name === 'home') {
          assert.ok(m.bodyFontPx >= 22, `4K TV / Classroom Panel font should scale >= 22px (got ${m.bodyFontPx})`);
          assert.ok(m.containerW >= 2400, `4K TV / Classroom Panel container should expand >= 2400px (got ${m.containerW})`);
        }
        if (vp.width === 3840 && pg.name === 'lab-simulator') {
          assert.ok(m.containerW >= 2900, `4K Strategy Lab container should expand >= 2900px (got ${m.containerW})`);
        }

        // Capture visual verification screenshots if requested
        if (ARTIFACT_DIR) {
          if (vp.name === 'Phone-390' && pg.name === 'home') {
            await page.locator('#videos').scrollIntoViewIfNeeded();
            await page.waitForTimeout(500);
            await page.screenshot({ path: path.join(ARTIFACT_DIR, 'verify-phone-390-reels.png') });
          }
          if (vp.name === 'Tablet-Port-768' && pg.name === 'home') {
            await page.screenshot({ path: path.join(ARTIFACT_DIR, 'verify-tablet-768-home.png') });
          }
          if (vp.name === 'UHD-4K-TV-3840' && pg.name === 'home') {
            await page.screenshot({ path: path.join(ARTIFACT_DIR, 'verify-4k-tv-classroom-home.png') });
          }
          if (vp.name === 'UHD-4K-TV-3840' && pg.name === 'lab-simulator') {
            await page.waitForFunction(() => document.querySelectorAll('#opstra-chain-body tr').length > 5, { timeout: 15000 }).catch(() => {});
            await page.waitForTimeout(300);
            await page.screenshot({ path: path.join(ARTIFACT_DIR, 'verify-4k-tv-classroom-simulator.png') });
          }
        }

        await page.close();
        checkedCount++;
      }
      await ctx.close();
    }
    console.log(`PASS PART 1: All ${checkedCount} viewport x page combinations passed (320px phone -> 4K 3840px TV/Classroom Panel, 0 overflow, 0 broken images, 0 console/HTTP errors).`);

    // =========================================================================
    // PART 2: NEW-USER TOP-TO-BOTTOM WALKTHROUGH + 22 REAL REEL THUMBNAILS
    // =========================================================================
    {
      const ctx = await browser.newContext({ viewport: { width: 1366, height: 768 }, timezoneId: 'Asia/Kolkata' });
      const page = await ctx.newPage();
      const errs = [];
      page.on('pageerror', e => errs.push('pageerror: ' + e.message));
      page.on('console', m => { if (m.type() === 'error') errs.push('console: ' + m.text()); });
      page.on('response', r => { if (r.status() >= 400 && r.status() !== 401) errs.push(`HTTP ${r.status()} ${r.url()}`); });

      await page.goto(BASE + '/index.html', { waitUntil: 'load', timeout: 30000 });
      await page.waitForTimeout(600);

      // 2.1 Verify all in-page #anchors resolve
      const badAnchors = await page.evaluate(() =>
        [...document.querySelectorAll('a[href^="#"]')]
          .map(a => a.getAttribute('href'))
          .filter(h => h && h !== '#' && !document.getElementById(h.slice(1)))
      );
      assert.equal(badAnchors.length, 0, `Broken #anchors: ${JSON.stringify(badAnchors)}`);

      // 2.2 Verify Theme toggle Light <-> Dark
      const t0 = await page.evaluate(() => document.documentElement.dataset.theme || 'dark');
      await page.locator('#theme-toggle-btn').click();
      const t1 = await page.evaluate(() => document.documentElement.dataset.theme || 'dark');
      assert.notEqual(t0, t1, 'Homepage theme toggle switches Light/Dark');
      await page.locator('#theme-toggle-btn').click();

      // 2.3 Verify Top Banner carousel & Anthem toggle
      await page.locator('.banner-next-btn').click();
      await page.waitForTimeout(200);
      await page.locator('.banner-prev-btn').click();
      await page.locator('#iwsm-music').click();
      await page.locator('#iwsm-music').click();

      // 2.4 Verify Hero Counselling Form + Party Popper Modal (intercepted so zero real spam)
      const mockEnquiry = route => {
        let subId = 'mock-sub';
        try {
          const parsed = JSON.parse(route.request().postData() || '{}');
          if (parsed.submission_id) subId = parsed.submission_id;
        } catch {}
        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ success: true, submission_id: subId, month: '2026-11', duplicate: true }),
        });
      };
      await page.route('**/macros/s/**', mockEnquiry);
      await page.route('**/api/enquiry**', mockEnquiry);
      await page.route('**/.netlify/functions/**', mockEnquiry);
      const form = page.locator('#hero-lead-form');
      await form.locator('input[name="fullname"]').fill('First Time Visitor');
      await form.locator('input[name="phone"]').fill('9876543210');
      await form.locator('input[name="email"]').fill('visitor@example.com');
      await form.locator('button[type="submit"]').click();
      await page.locator('#lead-modal.active').waitFor({ state: 'visible', timeout: 8000 });
      const celebTxt = await page.locator('#lead-modal').innerText();
      assert.match(celebTxt, /Right Path/i, 'Celebration modal shows "You Are on the Right Path!"');
      await page.locator('#lead-modal .confirm-modal-close').click();
      await page.unroute('**/macros/s/**');
      await page.unroute('**/api/enquiry**');
      await page.unroute('**/.netlify/functions/**');

      // 2.5 Curriculum tags, Personas (7 tabs), Algo Results, Risk Calculator, Gallery
      await page.locator('.curriculum-tag-btn').nth(1).click();
      await page.locator('.curriculum-tag-btn').nth(0).click();
      const personas = page.locator('.persona-tab-btn, [data-persona]');
      assert.ok((await personas.count()) >= 7, 'All 7 eligibility personas present');
      await personas.nth(2).click();
      await personas.nth(4).click();

      await page.locator('#ar-cap-inc').click();
      await page.locator('.algo-results button:has-text("Monthly")').first().click();
      await page.locator('#open-risk-calc-btn').click();
      await page.locator('#risk-calc-modal.active').waitFor({ state: 'visible' });
      await page.locator('#calc-instrument').selectOption('banknifty');
      await page.locator('#close-risk-calc-btn').click();

      // 2.6 Scroll full page top-to-bottom without crash & verify ALL 22 REAL REEL THUMBNAILS!
      await page.evaluate(async () => {
        for (let y = 0; y <= document.body.scrollHeight; y += 900) {
          window.scrollTo(0, y);
          await new Promise(r => setTimeout(r, 70));
        }
      });
      await page.locator('#videos').scrollIntoViewIfNeeded();
      await page.waitForTimeout(900);

      const reelsAudit = await page.evaluate(() => {
        const cards = [...document.querySelectorAll('.videos-grid-container .video-card-item')];
        const thumbs = cards.map(c => {
          const img = c.querySelector('img.video-thumb');
          const dur = c.querySelector('.video-duration-pill')?.textContent?.trim() || '';
          return {
            src: img?.getAttribute('src') || '',
            complete: Boolean(img?.complete),
            nw: img?.naturalWidth || 0,
            nh: img?.naturalHeight || 0,
            dur,
          };
        });
        const uniqueSrcs = new Set(thumbs.map(t => t.src).filter(Boolean));
        const loadedCount = thumbs.filter(t => t.complete && t.nw >= 300).length;
        const withDur = thumbs.filter(t => /^\d+:\d{2}$/.test(t.dur)).length;
        return { total: cards.length, uniqueSrcCount: uniqueSrcs.size, loadedCount, withDur, sample: thumbs.slice(0, 4) };
      });
      assert.equal(reelsAudit.total, 22, '22 reel cards rendered');
      assert.equal(reelsAudit.uniqueSrcCount, 22, `All 22 reels must have unique thumbnails (got ${reelsAudit.uniqueSrcCount})`);
      assert.equal(reelsAudit.loadedCount, 22, `All 22 reel thumbnails must load cleanly (got ${reelsAudit.loadedCount}/22)`);
      assert.equal(reelsAudit.withDur, 22, `All 22 reel cards must display duration pills (got ${reelsAudit.withDur}/22)`);

      if (ARTIFACT_DIR) {
        // Scroll directly onto the filter pills + top 2 rows of 22 Reels cards so thumbnails are prominently framed
        await page.evaluate(() => {
          const g = document.querySelector('#videos .videos-filter-bar');
          if (g) {
            const y = g.getBoundingClientRect().top + window.scrollY - 148;
            window.scrollTo(0, Math.max(0, y));
          }
        });
        await page.evaluate(() => document.documentElement.setAttribute('data-theme', 'light'));
        await page.waitForTimeout(300);
        await page.screenshot({ path: path.join(ARTIFACT_DIR, 'verify-reels-22-thumbnails-light.png') });
        // Dark mode screenshot
        await page.evaluate(() => document.documentElement.removeAttribute('data-theme'));
        await page.waitForTimeout(300);
        await page.screenshot({ path: path.join(ARTIFACT_DIR, 'verify-reels-22-thumbnails-dark.png') });
      }

      // Test reel category filter pills
      await page.locator('.video-filter-pill[data-category="reviews"]').click();
      assert.ok((await page.locator('.videos-grid-container .video-card-item').count()) > 0, 'Reviews filter shows reels');
      await page.locator('.video-filter-pill[data-category="floor"]').click();
      assert.ok((await page.locator('.videos-grid-container .video-card-item').count()) > 0, 'Floor filter shows reels');
      await page.locator('.video-filter-pill[data-category="lessons"]').click();
      assert.ok((await page.locator('.videos-grid-container .video-card-item').count()) > 0, 'Lessons filter shows reels');
      await page.locator('.video-filter-pill[data-category="all"]').click();
      assert.equal(await page.locator('.videos-grid-container .video-card-item').count(), 22, 'All 22 Reels restored');

      // Open Reel #1 Modal on 1366x768 laptop, verify modal fits cleanly inside viewport, keyboard nav, & Enquire CTA closes modal!
      await page.locator('.videos-grid-container .video-card-item').first().click();
      await page.locator('#video-modal.active').waitFor({ state: 'visible' });
      await page.waitForTimeout(450);
      const modalFit = await page.evaluate(() => {
        const w = document.querySelector('.video-modal-window')?.getBoundingClientRect();
        const v = document.querySelector('#modal-video-player');
        return {
          bottomOk: w ? w.bottom <= window.innerHeight + 2 : false,
          topOk: w ? w.top >= -2 : false,
          src: v?.getAttribute('src') || '',
          poster: v?.getAttribute('poster') || '',
        };
      });
      assert.ok(modalFit.bottomOk && modalFit.topOk, `Video modal fits inside 1366x768 viewport: ${JSON.stringify(modalFit)}`);
      assert.ok(modalFit.src.includes('0001.mp4') && modalFit.poster.includes('reel-01.webp'), 'Modal loaded reel 01 mp4 & poster');

      if (ARTIFACT_DIR) {
        await page.screenshot({ path: path.join(ARTIFACT_DIR, 'verify-reels-modal-portrait.png') });
      }

      // Keyboard ArrowRight / ArrowLeft / Escape (Desktop & TV Remote D-Pad)
      await page.keyboard.press('ArrowRight');
      await page.waitForTimeout(250);
      assert.ok((await page.locator('#modal-video-player').getAttribute('src')).includes('0002.mp4'), 'ArrowRight advanced to Reel 02');
      await page.keyboard.press('ArrowLeft');
      await page.waitForTimeout(250);
      assert.ok((await page.locator('#modal-video-player').getAttribute('src')).includes('0001.mp4'), 'ArrowLeft returned to Reel 01');

      // Clicking "Enquire About Batch" inside Video Modal must close the modal!
      await page.locator('#video-modal a[href="#enquire"]').click();
      await page.waitForTimeout(250);
      assert.equal(await page.locator('#video-modal.active').count(), 0, 'Clicking Enquire About Batch closes video modal cleanly');

      // 2.7 Verify Reviews page theme toggle & Strategy Lab link
      const revPage = await ctx.newPage();
      revPage.on('response', r => { if (r.status() >= 400) errs.push(`reviews HTTP ${r.status()} ${r.url()}`); });
      await revPage.goto(BASE + '/reviews.html', { waitUntil: 'load' });
      const rt0 = await revPage.evaluate(() => document.documentElement.dataset.theme || 'dark');
      await revPage.locator('#theme-toggle-btn').click();
      const rt1 = await revPage.evaluate(() => document.documentElement.dataset.theme || 'dark');
      assert.notEqual(rt0, rt1, 'Reviews page theme toggle works');
      assert.ok((await revPage.locator('nav a[href="strategy-builder.html"]').count()) >= 1, 'Reviews navbar links to Strategy Lab');
      await revPage.close();

      // 2.8 Verify Mobile Drawer open/Escape/close on 390px phone
      const mobCtx = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true });
      const mobPage = await mobCtx.newPage();
      await mobPage.goto(BASE + '/index.html', { waitUntil: 'domcontentloaded' });
      await mobPage.waitForTimeout(500);
      await mobPage.locator('.hamburger-btn').click();
      assert.equal(await mobPage.locator('.mobile-nav-drawer.open').count(), 1, 'Mobile drawer opens');
      await mobPage.keyboard.press('Escape');
      assert.equal(await mobPage.locator('.mobile-nav-drawer.open').count(), 0, 'Mobile drawer closes on Escape');
      await mobCtx.close();

      assert.equal(errs.length, 0, `Zero errors during full New-User Walkthrough: ${JSON.stringify(errs)}`);
      await ctx.close();
    }

    console.log('PASS PART 2: Complete New-User Walkthrough + 22 Unique Reel Thumbnails + Modal + Reviews + Mobile Drawer verified 100%!');
  } finally {
    await browser.close();
  }
})();

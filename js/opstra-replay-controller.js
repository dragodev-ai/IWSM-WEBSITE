/* IWSM Options Simulator Controller — Live Exchange Option Chains, Recorded Snapshot Store, Multi-Leg Strategy Builder, BSM Greeks & Deterministic Playback. */
(function (root) {
  'use strict';

  root.IWSMOpstraReplay = {
    install(host) {
      if (host.dataset.replayMounted) return;
      host.dataset.replayMounted = 'true';

      const M = root.IWSMSimulator;
      const P = root.IWSMPaperExecution;
      const C = root.IWSMCandleModel;
      const A = root.IWSMPaperAnalysis;
      const E = root.IWSMStrategy;
      const Q = root.IWSMResearch;
      const Store = root.IWSMStudyStore;

      const el = id => host.querySelector('#opstra-' + id);
      const esc = x => String(x ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
      const num = (x, digits = 2) => Number.isFinite(x) ? x.toLocaleString('en-IN', { minimumFractionDigits: 0, maximumFractionDigits: digits }) : '—';
      const numFixed = (x, digits = 2) => Number.isFinite(x) ? x.toLocaleString('en-IN', { minimumFractionDigits: digits, maximumFractionDigits: digits }) : '—';
      const money = x => x === Infinity ? 'Unlimited' : x === -Infinity ? 'Unlimited' : Number.isFinite(x) ? '₹ ' + numFixed(x, 2) : 'Unavailable';
      const signedMoney = x => Number.isFinite(x) ? (x >= 0 ? '+₹ ' : '−₹ ') + numFixed(Math.abs(x), 2) : '—';
      const options = (values, current) => values.map(x => '<option value="' + esc(x) + '" ' + (x === current ? 'selected' : '') + '>' + esc(x) + '</option>').join('');
      const table = (headers, rows) =>
        '<div class="opstra-table-container"><table class="opstra-chain-table"><thead><tr>' +
        headers.map(x => '<th scope="col">' + esc(x) + '</th>').join('') +
        '</tr></thead><tbody>' +
        rows.map(row => '<tr>' + row.map(x => '<td>' + x + '</td>').join('') + '</tr>').join('') +
        '</tbody></table></div>';

      let d = null, s = null, bundle = null, db = null, saveQueue = Promise.resolve();
      let generation = 0, timer = null, autoRefreshTimer = null, refreshInFlight = false;
      let viewExpiry = '', payoffDate = '', activeTab = 'payoff', basis = 'spot', recording = false, modal = null;
      let chainRows = [], symbols = ['NIFTY'], archiveDates = [], symbolDates = {}, loading = false;
      let symbolSearchQuery = '', chainSearchQuery = '', chainRangeCount = 25, showDetailCols = false, quickTrade = false;
      let serverMarketStatus = null, snapshotCoverage = null, brokerExpiryDetails = {};
      let apiBase = '', apiProbePromise = null, brokerAuth = { connected: false };

      const settings = { initialBalance: 1000000, feePerOrder: 20, feeBps: 0, slippage: 0, marginRate: 0.2, rate: 6.5, dividend: 0 };

      // Status, source provenance, playback helper, archive browser & expandable account/journal drawer
      const status = document.createElement('p');
      status.className = 'opstra-status';
      status.id = 'opstra-status';
      status.setAttribute('role', 'status');
      status.setAttribute('aria-live', 'polite');
      el('simulator-root').querySelector('header').after(status);

      const source = document.createElement('p');
      source.className = 'opstra-source-note';
      source.id = 'opstra-source-note';
      status.after(source);

      const playbackHelp = document.createElement('div');
      playbackHelp.className = 'opstra-playback-help';
      playbackHelp.innerHTML = '<p id="opstra-playback-explanation" role="status"></p>';
      host.querySelector('.opstra-clock-row').after(playbackHelp);

      const browse = document.createElement('div');
      browse.className = 'opstra-data-actions';
      browse.innerHTML = '<label>Archive year<select id="opstra-archive-year" aria-label="Archive year"></select></label><label>Month<select id="opstra-archive-month" aria-label="Archive month"></select></label><button type="button" id="opstra-browse-expiries">Browse historical expiries</button><button type="button" id="opstra-minute-source">Load minute data</button><small id="opstra-resolution-note"></small>';
      browse.hidden = true;
      host.querySelector('.opstra-expiry-row').after(browse);

      const clockTools = host.querySelector('.opstra-clock-row').firstElementChild;
      clockTools.innerHTML = '<label>Session Date <input id="opstra-replay-date" type="date" aria-label="Session replay date"></label><label>Time (IST) <select id="opstra-observed-time" aria-label="Observed time IST"></select></label>';

      const tools = document.createElement('details');
      tools.className = 'opstra-history-tools';
      tools.innerHTML = '<summary>Paper Account, Order Book &amp; Trade Journal</summary><div id="opstra-account"></div><div class="opstra-data-actions"><button type="button" id="opstra-branch">Branch at Cursor</button><button type="button" id="opstra-export">Export Study JSON</button><button type="button" id="opstra-save-candles" hidden>Save Candles to Local Library</button><label>Restore Study<input type="file" id="opstra-restore" accept=".json"></label><button type="button" id="opstra-journal-export">Export Journal CSV</button></div><div id="opstra-orders"></div><div id="opstra-journal"></div>';
      el('simulator-root').append(tools);

      el('basis-toggle').setAttribute('aria-label', 'Use futures reference');

      function todayIST() {
        return new Date(Date.now() + 19800000).toISOString().slice(0, 10);
      }

      function isoToBrokerCode(iso) {
        if (!/^\d{4}-\d{2}-\d{2}$/.test(iso || '')) return iso || '';
        const months = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
        const [y, m, day] = iso.split('-');
        return day + months[Number(m) - 1] + y.slice(2);
      }

      function brokerCodeToIso(code) {
        if (/^\d{4}-\d{2}-\d{2}$/.test(code || '')) return code;
        const m = /^(\d{2})([A-Z]{3})(\d{2,4})$/i.exec(String(code || '').trim());
        if (!m) return '';
        const months = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
        const idx = months.indexOf(m[2].toUpperCase());
        if (idx < 0) return '';
        const yr = m[3].length === 2 ? '20' + m[3] : m[3];
        return yr + '-' + String(idx + 1).padStart(2, '0') + '-' + m[1];
      }

      function classifyExpiryMap(expiriesList, refDateIso) {
        const monthMax = {};
        for (const exp of expiriesList) {
          const ym = exp.slice(0, 7);
          if (!monthMax[ym] || exp > monthMax[ym]) monthMax[ym] = exp;
        }
        const refMs = Date.parse((refDateIso || todayIST()) + 'T00:00:00Z');
        const map = {};
        for (const exp of expiriesList) {
          const dte = Math.round((Date.parse(exp + 'T00:00:00Z') - refMs) / 86400000);
          const apiDetail = brokerExpiryDetails[exp];
          const cycle = apiDetail?.cycle || (monthMax[exp.slice(0, 7)] === exp ? 'monthly' : 'weekly');
          map[exp] = {
            iso: exp,
            code: isoToBrokerCode(exp),
            cycle,
            dte,
            label: exp + ' (' + isoToBrokerCode(exp) + ' · ' + (cycle === 'monthly' ? 'Monthly' : 'Weekly') + (Number.isFinite(dte) ? ' · ' + (dte === 0 ? '0d Expiry' : dte + 'd') : '') + ')',
          };
        }
        return map;
      }

      function msg(text) {
        status.textContent = text;
      }

      function pause() {
        clearInterval(timer);
        timer = null;
        const frames = d && s ? P.frames(d, s) : [];
        el('btn-play').textContent = frames.length > 1 && s.cursor === frames.at(-1) ? '↻ REPLAY' : '▶ PLAY';
        el('btn-play').setAttribute('aria-pressed', 'false');
      }

      function stopAutoRefresh() {
        clearInterval(autoRefreshTimer);
        autoRefreshTimer = null;
        if (el('auto-refresh')) el('auto-refresh').checked = false;
      }

      function guard(fn) {
        return async (...args) => {
          try {
            await fn(...args);
          } catch (e) {
            pause();
            msg(e.message || String(e));
          }
        };
      }

      function serial() {
        return { format: 'iwsm-paper-v1', name: s.symbol + ' · ' + s.cursor, dataset: M.exportDataset(d), bundle, session: s, savedAt: Date.now() };
      }

      function persist() {
        if (!s || !db) return Promise.resolve();
        const raw = serial();
        saveQueue = saveQueue.catch(() => {}).then(() => db.save(raw));
        saveQueue.catch(e => msg(e.message));
        return saveQueue;
      }

      function download(name, text, type = 'application/json') {
        const a = document.createElement('a');
        a.href = URL.createObjectURL(new Blob([text], { type }));
        a.download = name;
        a.click();
        setTimeout(() => URL.revokeObjectURL(a.href), 1000);
      }

      function close() {
        if (modal) {
          modal.close();
          modal.remove();
          modal = null;
        }
      }

      function dialog(title, content, wide = false) {
        pause();
        close();
        modal = document.createElement('dialog');
        modal.className = 'opstra-dialog' + (wide ? ' opstra-dialog-wide' : '');
        modal.innerHTML =
          '<header><h2>' + esc(title) + '</h2><button type="button" aria-label="Close ' + esc(title) + '">×</button></header>' +
          '<div class="opstra-dialog-body">' + content + '</div>';
        el('modal-container').append(modal);
        modal.querySelector('header button').onclick = close;
        modal.addEventListener('cancel', () => {
          const old = modal;
          modal = null;
          old.remove();
        });
        modal.showModal();
        return modal;
      }

      function adopt(raw, b = null, session = null, preservePositions = false) {
        const next = M.prepareDataset(raw);
        let state;
        if (session) {
          state = P.restore(next, session);
        } else if (preservePositions && s && s.symbol === next.symbols[0]) {
          state = P.create(next, settings);
        } else {
          state = P.create(next, settings);
        }
        pause();
        generation++;
        if (s) persist();
        d = next;
        s = state;
        bundle = b;
        if (!preservePositions) {
          viewExpiry = '';
          payoffDate = '';
          basis = 'spot';
          el('basis-toggle').checked = false;
          if (el('build-expiry')) el('build-expiry').innerHTML = '';
          if (el('build-strike')) el('build-strike').innerHTML = '';
        }
        if (!session && d.kind !== 'daily') {
          const at = P.frames(d, s).find(
            t => Number.isFinite(d.spots.get(s.symbol + '|' + t)) && (d.byFrame.get(s.symbol + '|' + t) || []).some(q => q.type !== 'FUT' && q.volume !== 0 && q.lotSize > 0)
          );
          if (at && at !== s.cursor) s = P.advance(d, s, at);
        }
        render();
        persist();
      }

      function restore(raw) {
        const v = Store.validate(raw);
        adopt(v.dataset, v.bundle, v.session);
        msg('Saved simulation restored at ' + s.cursor.replace('T', ' ') + ' IST.');
      }

      function change(next) {
        generation++;
        s = next;
        render();
        persist();
      }

      function resolution() {
        if (bundle) return bundle.intervalMinutes;
        const frames = P.frames(d, s);
        let min = Infinity;
        for (let i = 1; i < frames.length; i++) {
          if (frames[i].slice(0, 10) === frames[i - 1].slice(0, 10)) {
            min = Math.min(min, (M.instant(frames[i]) - M.instant(frames[i - 1])) / 60000);
          }
        }
        return Number.isFinite(min) ? min : 1;
      }

      function frameStep(minutes) {
        if (!s) return;
        const dir = Math.sign(minutes), amount = Math.abs(minutes), base = resolution();
        if (amount !== 1440 && (d.kind === 'daily' || amount < base)) {
          throw Error('Loaded dataset has ' + (d.kind === 'daily' ? 'daily' : base + '-minute') + ' resolution. Load 1-minute history or snapshots for finer steps.');
        }
        const frames = P.frames(d, s);
        const target =
          amount !== 1440 && ![1, 5, 15, 30, 60, 120].includes(amount)
            ? frames[Math.max(0, Math.min(frames.length - 1, frames.indexOf(s.cursor) + dir))]
            : M.step(d, s, dir, amount === 1440 ? 'day' : amount).cursor;
        if (target === s.cursor) {
          pause();
          msg('Reached the ' + (dir < 0 ? 'first' : 'last') + ' available timestamp in this simulation window.');
          return;
        }
        change(P.advance(d, s, target));
        if (s.cursor === frames.at(-1)) pause();
        msg('Simulation cursor: ' + s.cursor.replace('T', ' ') + ' IST' + (recording ? ' · Saved to browser study store.' : ''));
      }

      function addCalendarDays(isoDate, deltaDays) {
        const dt = new Date(isoDate + 'T00:00:00Z');
        dt.setUTCDate(dt.getUTCDate() + deltaDays);
        return dt.toISOString().slice(0, 10);
      }

      function defaultMinuteStartIST(nowIso = todayIST()) {
        const dt = new Date(nowIso + 'T00:00:00Z');
        let tradingBack = 0;
        let calBack = 0;
        while (tradingBack < 3 && calBack < 6) {
          dt.setUTCDate(dt.getUTCDate() - 1);
          calBack++;
          if (dt.getUTCDay() !== 0 && dt.getUTCDay() !== 6) tradingBack++;
        }
        return dt.toISOString().slice(0, 10);
      }

      function friendlyFetchError(err) {
        const raw = String(err?.message || err || '');
        if (/failed to fetch|networkerror|load failed|fetch/i.test(raw)) {
          return 'Local IWSM market-data server could not be reached. Ensure "node tools/local-preview.cjs" is running and open http://127.0.0.1:4174/strategy-builder.html#options-simulator.';
        }
        return raw || 'Market data request failed.';
      }

      async function probeLocalBackend() {
        if (apiBase) return apiBase;
        if (apiProbePromise) return apiProbePromise;
        const isFile = root.location?.protocol === 'file:';
        const isHttpsPage = root.location?.protocol === 'https:';
        apiProbePromise = (async () => {
          for (const candidate of ['http://127.0.0.1:4174', 'http://localhost:4174']) {
            try {
              if (root.location?.origin === candidate) continue;
              const r = await fetch(candidate + '/api/aliceblue/health', {
                credentials: isFile || isHttpsPage ? 'omit' : 'include',
                signal: AbortSignal.timeout(3500),
              });
              if (r.ok && (r.headers.get('content-type') || '').includes('application/json')) {
                apiBase = candidate;
                return apiBase;
              }
            } catch {}
          }
          return '';
        })().finally(() => {
          apiProbePromise = null;
        });
        return apiProbePromise;
      }

      async function apiFetch(urlPath, initOpts = {}) {
        const isFile = root.location?.protocol === 'file:';
        const isHttpsPage = root.location?.protocol === 'https:';
        const isGithubPages = /\.github\.io$/i.test(root.location?.hostname || '');
        if ((isFile || isGithubPages) && !apiBase) {
          const discovered = await probeLocalBackend();
          if (isGithubPages && !discovered) {
            throw Error('Static GitHub Pages mode active; local market-data server is offline.');
          }
        }
        const buildOpts = base => ({
          credentials: isFile || (isHttpsPage && base) ? 'omit' : base ? 'include' : 'same-origin',
          signal: AbortSignal.timeout(120000),
          ...initOpts,
        });
        try {
          const r = await fetch((apiBase || '') + urlPath, buildOpts(apiBase));
          if (!apiBase && (r.status === 404 || r.status === 405 || !(r.headers.get('content-type') || '').includes('application/json'))) {
            const discovered = await probeLocalBackend();
            if (discovered) return await fetch(discovered + urlPath, buildOpts(discovered));
          }
          return r;
        } catch (err) {
          if (!apiBase) {
            const discovered = await probeLocalBackend();
            if (discovered) {
              try {
                return await fetch(discovered + urlPath, buildOpts(discovered));
              } catch (retryErr) {
                throw Error(friendlyFetchError(retryErr));
              }
            }
          }
          throw Error(friendlyFetchError(err));
        }
      }

      async function jsonResponse(r) {
        if (!(r.headers.get('content-type') || '').includes('application/json')) {
          throw Error('Local preview backend required for this endpoint (http://127.0.0.1:4174).');
        }
        const j = await r.json();
        if (!r.ok || j.success === false) throw Error(j.error || j.detail || 'Data could not be loaded.');
        return j;
      }

      async function brokerApi(path, initOpts = {}) {
        const r = await apiFetch('/api/aliceblue/' + path, initOpts);
        if (!(r.headers.get('content-type') || '').includes('application/json')) {
          throw Error('Live broker service requires the local data backend (http://127.0.0.1:4174).');
        }
        const j = await r.json();
        if (!r.ok) throw Error(j.detail || 'Broker data unavailable');
        return j;
      }

      async function refreshBrokerAuthStatus() {
        try {
          const j = await brokerApi('auth/status');
          brokerAuth = j || { connected: false };
          if (j?.marketStatus) serverMarketStatus = j.marketStatus;
          updateMarketBadges();
          return brokerAuth;
        } catch {
          return brokerAuth;
        }
      }

      function fnoExch(raw = d?.metadata?.exchange) {
        const x = String(raw || '').toLowerCase();
        return x === 'bse_fo' || x === 'bse' || x === 'bfo' ? 'bse_fo' : 'nse_fo';
      }

      async function refreshMarketAndCoverage(sym = '') {
        try {
          const exch = fnoExch();
          const j = await brokerApi('market-status?' + new URLSearchParams({ underlying: sym || s?.symbol || 'NIFTY', exch }));
          serverMarketStatus = j.marketStatus || null;
          snapshotCoverage = j.snapshotCoverage || null;
          updateMarketBadges();
        } catch {
          // Non-fatal on static preview
        }
      }

      function updateMarketBadges() {
        const pill = el('market-status');
        const covTag = el('snapshot-coverage');
        if (pill) {
          const isSnap = Boolean(d?.metadata?.quoteTiming?.startsWith('Snapshot'));
          if (serverMarketStatus) {
            const openTxt = serverMarketStatus.isOpen ? 'MARKET OPEN · IST' : 'MARKET CLOSED · ' + serverMarketStatus.reason;
            pill.textContent = (isSnap ? 'LIVE SNAPSHOT · ' : 'REPLAY MODE · ') + openTxt;
            pill.className = 'opstra-market-pill ' + (serverMarketStatus.isOpen ? 'is-open' : 'is-closed');
          } else {
            pill.textContent = isSnap ? 'LIVE SNAPSHOT MODE (IST)' : 'HISTORICAL SIMULATION MODE (IST)';
            pill.className = 'opstra-market-pill';
          }
        }
        if (covTag) {
          if (snapshotCoverage?.hasSnapshots) {
            covTag.textContent = 'Earliest Snapshot: ' + snapshotCoverage.earliestDate + ' (' + snapshotCoverage.frameCount + ' frames)';
          } else {
            covTag.textContent = 'Recorded Snapshots: 0 (enable Snapshot Store during live session)';
          }
        }
      }

      function resolveArchiveWindow(symbol, preferredStart = '', preferredEnd = '') {
        const sym = String(symbol || 'NIFTY').trim().toUpperCase();
        const avail = (Array.isArray(symbolDates[sym]) && symbolDates[sym].length ? symbolDates[sym] : archiveDates) || [];
        if (!avail.length) {
          if (preferredStart && preferredEnd && preferredStart <= preferredEnd && (Date.parse(preferredEnd) - Date.parse(preferredStart)) / 86400000 <= 30) {
            return { start: preferredStart, end: preferredEnd };
          }
          return { start: '2026-10-28', end: '2026-11-04' };
        }
        if (preferredStart && preferredEnd && preferredStart <= preferredEnd) {
          const inWindow = avail.filter(dt => dt >= preferredStart && dt <= preferredEnd);
          if (inWindow.length && (Date.parse(preferredEnd) - Date.parse(preferredStart)) / 86400000 <= 30) {
            return { start: preferredStart, end: preferredEnd };
          }
          // If requested date is historical (before latest archive date), find nearest available trading days around preferredStart
          if (preferredStart <= avail.at(-1)) {
            const idx = avail.findIndex(dt => dt >= preferredStart);
            if (idx >= 0) {
              const slice = avail.slice(Math.max(0, idx - 1), Math.min(avail.length, idx + 5));
              return { start: slice[0], end: slice.at(-1) };
            }
          }
        }
        const recent = avail.slice(-5);
        return { start: recent[0], end: recent.at(-1) };
      }

      async function loadRecorded(symbol, start, end) {
        pause();
        stopAutoRefresh();
        const request = ++generation;
        msg('Loading ' + symbol.toUpperCase() + ' historical archive (' + start + ' to ' + end + ')…');
        const q = new URLSearchParams({ mode: 'load', symbol: symbol.toUpperCase(), start, end });
        const j = await jsonResponse(await apiFetch('/api/nse-library?' + q));
        if (request !== generation) return;
        adopt(j.dataset || j.data || j);
        close();
        refreshMarketAndCoverage(symbol);
        msg('Historical daily closes loaded for ' + symbol.toUpperCase() + ' (' + s.cursor.slice(0, 10) + '). Use 1-Day step or load minute/snapshot data for intraday steps.');
      }

      function currentFuture() {
        if (!d || !s) return null;
        const list = (d.byFrame.get(s.symbol + '|' + s.cursor) || []).filter(q => q.type === 'FUT' && q.expiry >= s.cursor.slice(0, 10));
        if (!list.length) return null;
        if (viewExpiry) {
          const sameMonth = list.filter(q => q.expiry.slice(0, 7) === viewExpiry.slice(0, 7));
          if (sameMonth.length) return sameMonth.sort((a, b) => a.expiry.localeCompare(b.expiry))[0];
        }
        return list.sort((a, b) => a.expiry.localeCompare(b.expiry))[0];
      }

      function greeks(q, refPrice, useFuturesCarry = false) {
        if (!q) return { iv: null, g: null, source: null };
        if (Number.isFinite(q.iv) && Number.isFinite(q.delta)) {
          return {
            iv: q.iv / 100,
            g: { delta: q.delta, gamma: q.gamma ?? 0, theta: q.theta ?? 0, vega: q.vega ?? 0, rho: q.rho ?? 0 },
            source: q.greeksSource || 'recorded',
          };
        }
        if (!Number.isFinite(refPrice) || refPrice <= 0 || !(q.close > 0)) return { iv: null, g: null, source: null };
        const days = Math.max(0, (Date.parse(q.expiry + 'T15:30:00+05:30') - M.instant(s.cursor)) / 86400000);
        const rate = (d.metadata.rate ?? s.settings.rate) / 100;
        const div = useFuturesCarry ? rate : (d.metadata.dividend ?? s.settings.dividend) / 100;
        const iv = d.metadata.modelled ? d.metadata.iv / 100 : Q.impliedVolatility(q.type, refPrice, q.strike, days, q.close, rate, div);
        return {
          iv,
          g: iv === null ? null : E.greeks(q.type, refPrice, q.strike, days, iv, rate, div),
          source: d.metadata.modelled ? 'model' : 'calculated',
        };
      }

      function computeAtmSummary(spot, future) {
        const refPrice = Number.isFinite(spot) && spot > 0 ? spot : (Number.isFinite(future?.close) ? future.close : null);
        const useFut = !(Number.isFinite(spot) && spot > 0) && Number.isFinite(future?.close);
        const strikes = [...new Set(chainRows.filter(q => q.type !== 'FUT').map(q => q.strike))].sort((a, b) => a - b);
        if (!strikes.length || !Number.isFinite(refPrice)) return { atmStrike: null, atmIvPct: d?.metadata?.modelled ? d.metadata.iv : null };
        const atmStrike = strikes.reduce((best, k) => (Math.abs(k - refPrice) < Math.abs(best - refPrice) ? k : best), strikes[0]);
        if (d?.metadata?.modelled && Number.isFinite(d.metadata.iv)) {
          return { atmStrike, atmIvPct: d.metadata.iv, source: 'Model' };
        }
        const ce = chainRows.find(q => q.type === 'CE' && q.strike === atmStrike);
        const pe = chainRows.find(q => q.type === 'PE' && q.strike === atmStrike);
        const ivs = [ce ? greeks(ce, refPrice, useFut).iv : null, pe ? greeks(pe, refPrice, useFut).iv : null].filter(x => Number.isFinite(x) && x > 0);
        const atmIvPct = ivs.length ? (ivs.reduce((a, b) => a + b, 0) / ivs.length) * 100 : null;
        return { atmStrike, atmIvPct, source: 'Calc' };
      }

      function analysis(atmIvPct = null) {
        const open = P.valuation(d, s).positions.filter(p => !p.closed && p.enabled !== false);
        const first = open.map(p => p.expiry).sort()[0];
        if (first && (!payoffDate || payoffDate < s.cursor.slice(0, 10) || payoffDate > first)) payoffDate = first;
        return A.analyze(d, s, {
          basis,
          expiry: viewExpiry,
          atmIv: atmIvPct,
          ...(first && payoffDate ? { payoffDate } : {}),
        });
      }

      function syncLegBuilder(expiries, strikes, future) {
        const f = el('leg-builder');
        if (!f) return;
        const expSel = el('build-expiry'), strSel = el('build-strike'), typeSel = el('build-type'), priceIn = el('build-price'), hint = el('build-quote-hint');
        const prevExp = expSel.value && expiries.includes(expSel.value) ? expSel.value : viewExpiry;
        const isFut = typeSel.value === 'FUT';
        if (isFut) {
          const futExps = [...new Set((d.byFrame.get(s.symbol + '|' + s.cursor) || []).filter(q => q.type === 'FUT').map(q => q.expiry))].sort();
          expSel.innerHTML = options(futExps.length ? futExps : (future ? [future.expiry] : expiries), future?.expiry || prevExp);
          strSel.innerHTML = '<option value="0">FUT</option>';
          strSel.disabled = true;
        } else {
          expSel.innerHTML = options(expiries, prevExp);
          const expRows = (d.byFrame.get(s.symbol + '|' + s.cursor) || []).filter(q => q.expiry === expSel.value && q.type === typeSel.value);
          const availStrikes = [...new Set(expRows.map(q => q.strike))].sort((a, b) => a - b);
          const spot = d.spots.get(s.symbol + '|' + s.cursor) || future?.close || availStrikes[0] || 0;
          const atm = availStrikes.length ? availStrikes.reduce((a, b) => (Math.abs(b - spot) < Math.abs(a - spot) ? b : a), availStrikes[0]) : '';
          const chosenStrike = availStrikes.includes(+strSel.value) ? +strSel.value : atm;
          strSel.innerHTML = availStrikes.map(k => '<option value="' + k + '" ' + (k === chosenStrike ? 'selected' : '') + '>' + k + '</option>').join('');
          strSel.disabled = !availStrikes.length;
        }
        updateBuilderQuoteHint();
      }

      function updateBuilderQuoteHint() {
        const type = el('build-type').value, exp = el('build-expiry').value, strike = type === 'FUT' ? 0 : +el('build-strike').value;
        const q = d && s ? d.records.get([s.symbol, s.cursor, exp, type, strike].join('|')) : null;
        const hint = el('build-quote-hint'), priceIn = el('build-price');
        if (q) {
          priceIn.placeholder = String(q.close);
          if (!priceIn.dataset.userEdited) priceIn.value = String(q.close);
          hint.textContent = 'Mkt LTP: ₹ ' + numFixed(q.close, 2) + ' · Lot: ' + (q.lotSize || '—') + (q.oi != null ? ' · OI: ' + num(q.oi, 0) : '');
        } else {
          priceIn.placeholder = 'Unavailable';
          if (!priceIn.dataset.userEdited) priceIn.value = '';
          hint.textContent = 'No quote for selected contract at this timestamp.';
        }
      }

      function renderChart(a) {
        const box = el('chart-container'), v = P.valuation(d, s);
        host.querySelectorAll('.opstra-tab-btn').forEach(b => {
          b.classList.toggle('active', b.dataset.tab === activeTab);
          b.setAttribute('aria-pressed', String(b.dataset.tab === activeTab));
        });
        if (activeTab === 'payoff') {
          root.IWSMPaperChart.render(box, a, { cursor: s.cursor, symbol: s.symbol, startDate: s.start });
          return;
        }
        if (activeTab === 'greeks') {
          if (a.empty) {
            box.innerHTML = '<p class="opstra-empty">' + esc(a.reason) + '</p>';
            return;
          }
          const rows = a.rows.map(r => [
            esc((r.side === 1 ? 'BUY ' : 'SELL ') + r.type + ' ' + (r.type === 'FUT' ? 'FUT' : r.strike) + ' · ' + r.expiry),
            esc(String(r.units)),
            r.iv === null ? '—' : numFixed(r.iv, 2) + '%',
            ...['delta', 'gamma', 'theta', 'vega', 'rho'].map(k => (r.greeks ? numFixed(r.greeks[k] * r.units * r.side, k === 'gamma' ? 4 : 2) : '—')),
          ]);
          if (a.total) {
            rows.push([
              '<strong>Portfolio Total</strong>',
              '—',
              '—',
              ...['delta', 'gamma', 'theta', 'vega', 'rho'].map(k => '<strong>' + numFixed(a.total[k], k === 'gamma' ? 4 : 2) + '</strong>'),
            ]);
          }
          box.innerHTML =
            table(['Position', 'Units', 'IV %', 'Delta', 'Gamma', 'Theta / day', 'Vega', 'Rho'], rows) +
            '<p class="opstra-tab-footnote">Calculated analytically via European Black-Scholes / Black-76 (r = ' +
            numFixed(d.metadata?.rate ?? s.settings.rate, 2) +
            '%, q = ' +
            (a.basis === 'future' ? 'r (forward carry)' : numFixed(d.metadata?.dividend ?? s.settings.dividend, 2) + '%') +
            ', ACT/365). Positional sensitivities include leg direction and active quantity.</p>';
          return;
        }
        const pnlRows = v.positions.map(p => [
          esc((p.side === 1 ? '+ ' : '− ') + p.remainingLots + 'x ' + p.expiry + ' ' + (p.type === 'FUT' ? 'FUT' : p.strike + p.type) + (p.enabled === false ? ' (Excluded)' : '')),
          esc(String(p.remainingUnits)),
          money(p.entry) + (p.customEntry ? ' <small>(edited)</small>' : ''),
          p.closed ? '—' : money(p.mark),
          p.closed ? money(p.exit) : '—',
          '<span class="' + ((p.pnl ?? 0) >= 0 ? 'opstra-val-gain' : 'opstra-val-loss') + '">' + money(p.pnl) + '</span>',
          '<span class="' + ((p.net ?? 0) >= 0 ? 'opstra-val-gain' : 'opstra-val-loss') + '">' + money(p.net) + '</span>',
        ]);
        box.innerHTML =
          (pnlRows.length
            ? table(['Position', 'Units', 'Entry Price', 'Current Mark', 'Exit Price', 'Gross P&L', 'Net P&L'], pnlRows)
            : '<p class="opstra-empty">No positions added yet. Use the Multi-Leg Builder, Strategies presets, or Option Chain B/S buttons.</p>') +
          '<p class="opstra-tab-footnote">Realized: ' + money(v.realized) + ' · Unrealized: ' + money(v.unrealized) + ' · Est. Fees: ' + money(v.costs) + ' · <strong>Net Total: ' + money(v.net) + '</strong></p>';
      }

      const catalogue = root.IWSMSimulatorCatalogue;
      let browserStorage = null;
      try { browserStorage = root.localStorage; } catch {}
      let brokerInstruments = catalogue?.read(browserStorage) || [], catalogueTask = null, catalogueAt = 0;

      function instrumentChoice(value) {
        const [exchange, symbol] = String(value || 'nse_fo|NIFTY').includes('|') ? String(value).split('|') : ['nse_fo', String(value || 'NIFTY')];
        return { exchange, symbol };
      }

      function activeInstrumentMeta(symbol, exchange) {
        return brokerInstruments.find(x => x.symbol === symbol && x.exchange === exchange) || null;
      }

      function instrumentOptions(symbol, exchange = 'nse_fo', filterText = '') {
        const selected = exchange + '|' + symbol;
        const q = String(filterText || '').trim().toUpperCase();
        const matches = (sym, und = '') => !q || sym.toUpperCase().includes(q) || String(und).toUpperCase().includes(q);
        const currentMatches = matches(symbol, activeInstrumentMeta(symbol, exchange)?.underlying || '');
        let html = '';
        if (q && !currentMatches) {
          html += '<option value="' + esc(selected) + '" selected>Current: ' + esc(symbol) + ' — choose match below</option>';
        }
        const seen = new Set();
        for (const [code, title, kind] of [
          ['nse_fo', 'NSE Indices (NFO)', 'index'],
          ['nse_fo', 'NSE Stock F&O (NFO)', 'stock'],
          ['bse_fo', 'BSE Indices (BFO)', 'index'],
          ['bse_fo', 'BSE Stock F&O (BFO)', 'stock'],
        ]) {
          const rows = brokerInstruments.filter(x => x.exchange === code && x.kind === kind && matches(x.symbol, x.underlying));
          if (!rows.length) continue;
          html +=
            '<optgroup label="' + title + '">' +
            rows.map(x => {
              const key = x.exchange + '|' + x.symbol;
              seen.add(key);
              const metaTag = x.lotSize ? ' · Lot ' + x.lotSize : '';
              const unavail = x.chainAvailable === false ? ' · chain unavailable' : '';
              return '<option value="' + esc(key) + '" ' + (key === selected ? 'selected' : '') + (x.chainAvailable === false ? ' disabled' : '') + '>' + esc(x.symbol + metaTag + unavail) + '</option>';
            }).join('') +
            '</optgroup>';
        }
        const archive = [...new Set([...symbols, ...(d?.symbols || [])])].filter(x => !seen.has('nse_fo|' + x) && matches(x));
        if (archive.length) {
          html +=
            '<optgroup label="Historical Archive">' +
            archive.sort().map(x => '<option value="nse_fo|' + esc(x) + '" ' + ('nse_fo|' + x === selected ? 'selected' : '') + '>' + esc(x) + '</option>').join('') +
            '</optgroup>';
        }
        return html || '<option value="' + esc(selected) + '" selected>' + esc(symbol) + '</option>';
      }

      function findMatchingInstruments(query) {
        const q = String(query || '').trim().toUpperCase();
        if (!q) return [];
        const pool = [];
        const seen = new Set();
        for (const x of brokerInstruments) {
          if (x.chainAvailable === false) continue;
          const key = x.exchange + '|' + x.symbol;
          if (seen.has(key)) continue;
          if (x.symbol.toUpperCase().includes(q) || String(x.underlying || '').toUpperCase().includes(q)) {
            seen.add(key);
            pool.push(x);
          }
        }
        for (const sym of symbols) {
          const key = 'nse_fo|' + sym;
          if (!seen.has(key) && sym.toUpperCase().includes(q)) {
            seen.add(key);
            pool.push({ symbol: sym, underlying: sym, exchange: 'nse_fo', kind: 'stock' });
          }
        }
        return pool.sort((a, b) => {
          const aExact = a.symbol.toUpperCase() === q ? 0 : a.symbol.toUpperCase().startsWith(q) ? 1 : 2;
          const bExact = b.symbol.toUpperCase() === q ? 0 : b.symbol.toUpperCase().startsWith(q) ? 1 : 2;
          if (aExact !== bExact) return aExact - bExact;
          if (a.exchange !== b.exchange) return a.exchange === 'nse_fo' ? -1 : 1;
          return a.symbol.localeCompare(b.symbol);
        });
      }

      function renderSearchMatches() {
        const box = el('search-matches');
        if (!box) return;
        const q = String(symbolSearchQuery || '').trim();
        if (!q) {
          box.hidden = true;
          box.innerHTML = '';
          return;
        }
        const matches = findMatchingInstruments(q).slice(0, 8);
        if (!matches.length) {
          box.hidden = false;
          box.innerHTML = '<small class="opstra-helper-text">No F&amp;O contract matches "' + esc(q.toUpperCase()) + '".</small>';
          return;
        }
        box.hidden = false;
        box.innerHTML = matches
          .map(x => {
            const key = x.exchange + '|' + x.symbol;
            const seg = x.exchange === 'bse_fo' ? 'BFO' : 'NFO';
            const lot = x.lotSize ? ' · Lot ' + x.lotSize : '';
            return '<button type="button" class="opstra-match-pill" data-pick-symbol="' + esc(key) + '">' + esc(x.symbol + ' (' + seg + lot + ')') + '</button>';
          })
          .join('');
      }

      async function refreshInstruments() {
        if (catalogueTask && Date.now() - catalogueAt > 300000) catalogueTask = null;
        if (!catalogueTask) {
          catalogueAt = Date.now();
          catalogueTask = brokerApi('instruments')
            .then(j => {
              if (!Array.isArray(j.instruments) || !j.instruments.length) throw Error('Broker instrument catalogue is empty');
              brokerInstruments = j.instruments;
              if (j.marketStatus) serverMarketStatus = j.marketStatus;
              catalogue?.save(browserStorage, brokerInstruments);
              return j;
            })
            .catch(e => {
              catalogueTask = null;
              throw e;
            });
        }
        return catalogueTask;
      }

      function render() {
        if (!s || !d) return;
        const exch = fnoExch();
        const all = d.byFrame.get(s.symbol + '|' + s.cursor) || [];
        const expiries = [...new Set(d.contracts.filter(q => q.symbol === s.symbol && q.type !== 'FUT').map(q => q.expiry))].sort();
        if (!expiries.includes(viewExpiry)) viewExpiry = expiries[0] || '';
        chainRows = all.filter(q => q.expiry === viewExpiry);

        const spot = d.spots.get(s.symbol + '|' + s.cursor);
        const future = currentFuture();
        const atmInfo = computeAtmSummary(spot, future);
        const v = P.valuation(d, s);
        const a = analysis(atmInfo.atmIvPct);
        const frames = P.frames(d, s);
        const base = resolution();
        const expMap = classifyExpiryMap(expiries, s.cursor.slice(0, 10));
        const activeExpDetail = expMap[viewExpiry];

        // Instrument selector & rich metadata line
        el('symbol-select').innerHTML = instrumentOptions(s.symbol, exch, symbolSearchQuery);
        el('symbol-select').disabled = loading;
        renderSearchMatches();
        const instMeta = activeInstrumentMeta(s.symbol, exch);
        const strikeDiffs = (() => {
          const st = [...new Set(chainRows.filter(q => q.type !== 'FUT').map(q => q.strike))].sort((x, y) => x - y);
          return st.length >= 2 ? st[1] - st[0] : instMeta?.strikeInterval || null;
        })();
        el('instrument-meta').textContent = [
          exch === 'bse_fo' ? 'BSE F&O (BFO)' : 'NSE F&O (NFO)',
          instMeta?.underlying || s.symbol,
          instMeta?.instrumentType || (instMeta?.kind === 'stock' ? 'Stock F&O' : 'Index F&O'),
          strikeDiffs ? 'Strike Step: ' + strikeDiffs : null,
          expiries.length ? expiries.length + ' Expir' + (expiries.length === 1 ? 'y' : 'ies') + ' Loaded' : 'No Active Expiries',
          instMeta?.chainAvailable === false ? '⚠ Live Chain Unavailable' : null,
        ].filter(Boolean).join(' · ');

        // Expiry selector with Weekly / Monthly & DTE labels
        el('expiry-select').innerHTML =
          expiries.map(e => '<option value="' + esc(e) + '" ' + (e === viewExpiry ? 'selected' : '') + '>' + esc(expMap[e]?.label || e) + '</option>').join('') +
          '<option value="__browse__">Browse historical archive expiries…</option>';
        el('expiry-meta').textContent = activeExpDetail
          ? (activeExpDetail.cycle === 'monthly' ? 'Monthly Contract' : 'Weekly Contract') +
            ' · ' +
            (activeExpDetail.dte < 0 ? 'Expired' : activeExpDetail.dte === 0 ? 'Expiry Day (15:30 IST settlement)' : activeExpDetail.dte + ' calendar days to expiry')
          : 'Select Expiry';

        // Market info badges
        el('val-spot').textContent = Number.isFinite(spot) ? numFixed(spot, 2) : 'Unavailable';
        el('val-future').textContent = el('chain-fut-price').textContent = Number.isFinite(future?.close) ? numFixed(future.close, 2) : 'Unavailable';
        el('chain-fut-price').title = future ? 'Futures expiry ' + future.expiry : 'No futures contract quote at this timestamp';
        el('val-atm').textContent = atmInfo.atmStrike !== null ? num(atmInfo.atmStrike, 0) : '—';
        const lotVal = chainRows[0]?.lotSize || future?.lotSize || instMeta?.lotSize || null;
        el('val-lot').textContent = lotVal ? num(lotVal, 0) : '—';
        el('val-iv').textContent = Number.isFinite(atmInfo.atmIvPct) ? numFixed(atmInfo.atmIvPct, 2) + '% (' + atmInfo.source + ')' : '—';
        const vixVal = d.vix?.get(s.symbol + '|' + s.cursor) ?? d.metadata?.indiaVix ?? null;
        el('val-vix').textContent = Number.isFinite(vixVal) ? numFixed(vixVal, 2) : '—';
        el('btn-iv-chart').textContent = s.symbol + ' IV & Skew';
        el('chart-title').textContent = s.symbol + (viewExpiry ? ' · ' + viewExpiry : '');

        // Dates & clock
        el('start-date').value = s.start;
        el('start-date').max = todayIST();
        el('payoff-date').value = payoffDate || a.expiry || viewExpiry;
        el('payoff-date').min = s.cursor.slice(0, 10);
        el('payoff-date').max = a.expiry || viewExpiry;

        const capturedAt = d.metadata?.capturedAt ? new Date(d.metadata.capturedAt).toLocaleTimeString('en-IN', { timeZone: 'Asia/Kolkata', hour12: false }) + ' IST' : s.cursor.replace('T', ' ') + ' IST';
        el('last-updated').textContent = 'As of: ' + capturedAt;
        updateMarketBadges();

        el('chain-title').textContent = (activeExpDetail ? activeExpDetail.code + ' (' + viewExpiry + ')' : viewExpiry) + ' · Option Chain';
        el('sim-clock').textContent = s.cursor.replace('T', ' ') + ' IST';
        el('replay-date').value = s.cursor.slice(0, 10);
        el('replay-date').min = s.start;
        el('replay-date').max = s.end;
        el('observed-time').innerHTML = options(frames.filter(t => t.startsWith(s.cursor.slice(0, 10))).map(t => t.slice(11)), s.cursor.slice(11));

        // Playback state & timeframe buttons
        const playback = root.IWSMSimulatorPlayback.describe({ kind: d.kind, frames, cursor: s.cursor, exchange: exch, base });
        el('playback-explanation').textContent = playback.notice;
        el('resolution-note').textContent = d.kind === 'daily' ? 'Daily archive loaded (1D steps).' : 'Intraday replay active (' + frames.length + ' timestamps).';

        const supported = playback.supported, oldTf = +el('timeframe').value;
        el('timeframe').innerHTML = playback.single
          ? '<option value="">Single snapshot</option>'
          : [1, 5, 15, 30, 60, 120, 1440]
              .map(n => '<option value="' + n + '" ' + (!supported.includes(n) ? 'disabled' : '') + '>' + (n === 1440 ? '1 Day' : n + ' Min') + '</option>')
              .join('');
        if (!playback.single) el('timeframe').value = String(supported.includes(oldTf) ? oldTf : supported[0]);
        el('timeframe').disabled = el('speed').disabled = playback.single;
        el('btn-rewind').disabled = frames.length < 2 || s.cursor === frames[0];

        host.querySelectorAll('[data-mins]').forEach(b => {
          const n = +b.dataset.mins, amount = Math.abs(n);
          b.disabled =
            (n < 0 ? s.cursor === frames[0] : s.cursor === frames.at(-1)) ||
            (amount !== 1440 && (d.kind === 'daily' || amount < base));
          b.title = playback.single
            ? playback.notice
            : amount !== 1440 && d.kind === 'daily'
            ? 'Daily archive loaded. Open New Simulation to load 1-minute candles or recorded snapshots.'
            : '';
          b.setAttribute('aria-label', (n < 0 ? 'Back ' : 'Forward ') + (amount === 1440 ? '1 day' : amount + ' minutes'));
        });
        el('btn-play').disabled = !playback.canPlay;
        el('btn-play').title = playback.notice;
        if (!timer) el('btn-play').textContent = playback.restart ? '↻ REPLAY' : '▶ PLAY';
        el('btn-fut-buy').disabled = el('btn-fut-sell').disabled = !future;

        // Data source provenance banner (always visible so Live vs Historical vs Modelled is unmistakable)
        const isSnap = Boolean(d.metadata?.quoteTiming?.startsWith('Snapshot'));
        const provPrefix = d.metadata?.modelled
          ? 'MODELLED OPTION ESTIMATES'
          : d.metadata?.backup
          ? 'LOCAL HISTORICAL BACKUP'
          : isSnap
          ? 'LIVE EXCHANGE SNAPSHOT'
          : 'GENUINE RECORDED OBSERVATIONS';
        const warnText = (d.metadata?.warnings || []).concat(d.warnings || []).filter(Boolean).join(' · ');
        source.hidden = false;
        source.textContent =
          provPrefix +
          ' · ' +
          d.source +
          ' · ' +
          (d.kind === 'daily' ? 'Daily EOD closes' : isSnap ? 'Point-in-time snapshot' : base + '-min bars') +
          ' · Fees ₹' +
          s.settings.feePerOrder +
          '/order' +
          (s.cursor < s.frontier ? ' · Review mode (edits auto-branch at cursor)' : '') +
          (warnText ? ' · Note: ' + warnText : '');

        // Sync inline Multi-Leg Builder & keep Option Chain strike ladder continuous across 1-minute bars
        const builderStrikes = [...new Set(chainRows.filter(q => q.type !== 'FUT').map(q => q.strike))].sort((x, y) => x - y);
        const allStrikes = chainRows.some(q => q.type !== 'FUT')
          ? [...new Set(d.contracts.filter(q => q.symbol === s.symbol && q.expiry === viewExpiry && q.type !== 'FUT').map(q => q.strike))].sort((x, y) => x - y)
          : builderStrikes;
        syncLegBuilder(expiries, builderStrikes, future);

        // Strategy Positions list with 5 Opstra-grade controls: Toggle, Edit, Flip, Exit/SL, Delete
        el('positions-list').innerHTML =
          v.positions
            .map((p, i) => {
              const sideCls = p.side === 1 ? 'opstra-pos-buy' : 'opstra-pos-sell';
              const pnlVal = p.closed ? p.realized : p.pnl;
              const pnlCls = (pnlVal ?? 0) >= 0 ? 'opstra-val-gain' : 'opstra-val-loss';
              const label = (p.side === 1 ? '+' : '−') + p.remainingLots + 'x ' + isoToBrokerCode(p.expiry) + ' ' + (p.type === 'FUT' ? 'FUT' : p.strike + p.type);
              return (
                '<div class="opstra-position-row' + (p.enabled === false ? ' is-excluded' : '') + (p.closed ? ' is-closed' : '') + '">' +
                '<div class="opstra-pos-head">' +
                (!p.closed
                  ? '<input type="checkbox" class="opstra-pos-check" data-position="' + i + '" data-act="toggle" ' + (p.enabled !== false ? 'checked' : '') + ' aria-label="Include ' + esc(label) + ' in strategy">'
                  : '<span class="opstra-closed-pill">CLOSED</span>') +
                '<div class="opstra-pos-info">' +
                '<strong class="opstra-pos-name ' + sideCls + '">' + esc(label) + '</strong> ' +
                '<span class="opstra-pos-pnl ' + pnlCls + '">(' + signedMoney(pnlVal) + ')</span>' +
                '<small>Entry ' + money(p.entry) + (p.customEntry ? ' [Edited]' : '') + ' · ' + (p.closed ? 'Exit ' + money(p.exit) : 'Mark ' + money(p.mark)) + ' · ' + p.remainingUnits + ' qty</small>' +
                '</div>' +
                '</div>' +
                '<div class="opstra-pos-actions">' +
                (!p.closed
                  ? '<button type="button" data-position="' + i + '" data-act="edit" title="Edit strike, lots or entry premium">Edit</button>' +
                    '<button type="button" data-position="' + i + '" data-act="reverse" title="Flip Buy / Sell">B↔S</button>' +
                    '<button type="button" data-position="' + i + '" data-act="risk" title="Exit position or set Stop-Loss / Target">Exit/SL</button>'
                  : '') +
                '<button type="button" class="opstra-btn-del" data-position="' + i + '" data-act="remove" title="Remove leg from strategy" aria-label="Delete leg ' + esc(label) + '">×</button>' +
                '</div>' +
                '</div>'
              );
            })
            .join('') || '<p class="opstra-empty">Add legs using the Builder above, <strong>STRATEGIES</strong> presets, or <strong>B / S</strong> buttons in the Option Chain below.</p>';

        // Strategy Summary Metrics
        const risk = a.risk;
        const mixedEst = a.mixedExpiryEstimate;
        if (risk?.available) {
          el('metric-maxprofit').textContent = money(risk.maxProfit);
          el('metric-maxloss').textContent = risk.maxLoss === Infinity ? 'Unlimited' : money(risk.maxLoss ? -Math.abs(risk.maxLoss) : 0);
          el('metric-breakevens').textContent = risk.breaks?.length ? risk.breaks.map(x => numFixed(x, 2)).join(', ') : 'None';
        } else if (mixedEst) {
          el('metric-maxprofit').textContent = money(mixedEst.maxProfit) + ' (est.)';
          el('metric-maxloss').textContent = money(-Math.abs(mixedEst.maxLoss)) + ' (est.)';
          el('metric-breakevens').textContent = mixedEst.breaks?.length ? mixedEst.breaks.map(x => numFixed(x, 2)).join(', ') : 'Model curve';
        } else {
          el('metric-maxprofit').textContent = '—';
          el('metric-maxloss').textContent = '—';
          el('metric-breakevens').textContent = '—';
        }

        if (!a.empty && Number.isFinite(a.netPremium)) {
          const premLabel = a.netPremiumKind === 'credit' ? ' Credit' : a.netPremiumKind === 'debit' ? ' Debit' : ' Even';
          el('metric-netpremium').textContent = '₹ ' + numFixed(Math.abs(a.netPremium), 2) + premLabel;
          el('metric-netpremium').className = a.netPremiumKind === 'credit' ? 'opstra-val-gain' : '';
        } else {
          el('metric-netpremium').textContent = '—';
          el('metric-netpremium').className = '';
        }

        el('metric-rr').textContent = Number.isFinite(a.riskRewardRatio) ? '1 : ' + numFixed(a.riskRewardRatio, 2) : '—';
        el('metric-totalpnl').textContent = el('strip-pnl').textContent = money(v.net);
        el('metric-totalpnl').className = el('strip-pnl').className = (v.net ?? 0) >= 0 ? 'opstra-val-gain' : 'opstra-val-loss';

        for (const k of ['delta', 'theta', 'gamma', 'vega', 'rho']) {
          const node = el('pos-' + k);
          if (node) node.textContent = a.total ? numFixed(a.total[k], k === 'gamma' ? 4 : 2) : '—';
        }

        // Option Chain Table with ITM/OTM tint, ATM badge, Active-Position highlight, OI bars, B/S buttons & optional detail columns
        host.querySelectorAll('#opstra-chain-head .opstra-col-detail').forEach(th => { th.hidden = !showDetailCols; });
        const refForChain = Number.isFinite(spot) && spot > 0 ? spot : future?.close;
        const useFutForChain = !(Number.isFinite(spot) && spot > 0) && Number.isFinite(future?.close);
        const activeStrikes = new Map();
        for (const p of v.positions) {
          if (!p.closed && p.enabled !== false && p.expiry === viewExpiry && p.type !== 'FUT') {
            const cur = activeStrikes.get(p.strike) || [];
            cur.push((p.side === 1 ? '+' : '−') + p.remainingLots + p.type);
            activeStrikes.set(p.strike, cur);
          }
        }

        let visibleStrikes = allStrikes;
        if (chainSearchQuery) {
          visibleStrikes = visibleStrikes.filter(k => String(k).includes(chainSearchQuery));
        } else if (chainRangeCount > 0 && atmInfo.atmStrike !== null && visibleStrikes.length > chainRangeCount * 2 + 1) {
          const atmIdx = visibleStrikes.indexOf(atmInfo.atmStrike);
          if (atmIdx >= 0) {
            visibleStrikes = visibleStrikes.slice(Math.max(0, atmIdx - chainRangeCount), atmIdx + chainRangeCount + 1);
          }
        }

        const maxCallOi = Math.max(1, ...chainRows.filter(q => q.type === 'CE' && Number.isFinite(q.oi)).map(q => q.oi));
        const maxPutOi = Math.max(1, ...chainRows.filter(q => q.type === 'PE' && Number.isFinite(q.oi)).map(q => q.oi));

        function actionCell(q, sideType) {
          if (!q) return '<td class="opstra-td-act">—</td>';
          const idx = chainRows.indexOf(q);
          const dis = q.volume === 0 ? 'disabled title="Zero recorded volume at this timestamp"' : '';
          return (
            '<td class="opstra-td-act">' +
            '<div class="opstra-bs-group">' +
            '<button type="button" class="opstra-btn-bs opstra-btn-b" data-quote="' + idx + '" data-side="1" ' + dis + ' aria-label="Buy ' + q.strike + ' ' + sideType + '">B</button>' +
            '<button type="button" class="opstra-btn-bs opstra-btn-s" data-quote="' + idx + '" data-side="-1" ' + dis + ' aria-label="Sell ' + q.strike + ' ' + sideType + '">S</button>' +
            '</div>' +
            '</td>'
          );
        }

        el('chain-body').innerHTML = visibleStrikes.length
          ? visibleStrikes
              .map(k => {
                const ce = chainRows.find(q => q.type === 'CE' && q.strike === k);
                const pe = chainRows.find(q => q.type === 'PE' && q.strike === k);
                const gCe = ce ? greeks(ce, refForChain, useFutForChain) : { iv: null, g: null };
                const gPe = pe ? greeks(pe, refForChain, useFutForChain) : { iv: null, g: null };
                const isAtm = atmInfo.atmStrike === k;
                const posBadges = activeStrikes.get(k);
                const callItm = Number.isFinite(refForChain) && k < refForChain ? ' opstra-td-itm' : '';
                const putItm = Number.isFinite(refForChain) && k > refForChain ? ' opstra-td-itm' : '';
                const callOiPct = ce && Number.isFinite(ce.oi) ? Math.min(100, Math.round((ce.oi / maxCallOi) * 100)) : 0;
                const putOiPct = pe && Number.isFinite(pe.oi) ? Math.min(100, Math.round((pe.oi / maxPutOi) * 100)) : 0;
                const rowCls = [isAtm ? 'opstra-row-atm' : '', posBadges ? 'opstra-row-selected' : ''].filter(Boolean).join(' ');

                const ceBidAsk = ce && (Number.isFinite(ce.bid) || Number.isFinite(ce.ask)) ? numFixed(ce.bid, 2) + ' / ' + numFixed(ce.ask, 2) : '—';
                const peBidAsk = pe && (Number.isFinite(pe.bid) || Number.isFinite(pe.ask)) ? numFixed(pe.bid, 2) + ' / ' + numFixed(pe.ask, 2) : '—';

                return (
                  '<tr' + (rowCls ? ' class="' + rowCls + '"' : '') + '>' +
                  actionCell(ce, 'CE') +
                  '<td class="' + callItm + '"><div class="opstra-oi-cell"><span class="opstra-oi-bar call" style="width:' + callOiPct + '%"></span><span>' + (ce && Number.isFinite(ce.oi) ? num(ce.oi, 0) : '—') + '</span></div></td>' +
                  (showDetailCols ? '<td class="' + callItm + '">' + (ce && Number.isFinite(ce.oiChange) ? (ce.oiChange > 0 ? '+' : '') + num(ce.oiChange, 0) : '—') + '</td>' : '') +
                  (showDetailCols ? '<td class="' + callItm + '">' + (ce && Number.isFinite(ce.volume) ? num(ce.volume, 0) : '—') + '</td>' : '') +
                  (showDetailCols ? '<td class="' + callItm + '">' + ceBidAsk + '</td>' : '') +
                  '<td class="' + callItm + ' opstra-td-ltp">' + (ce ? numFixed(ce.close, 2) : '—') + '</td>' +
                  '<td class="' + callItm + '">' + (gCe.iv === null ? '—' : numFixed(gCe.iv * 100, 1)) + '</td>' +
                  '<td class="' + callItm + '">' + (gCe.g ? numFixed(gCe.g.delta, 2) : '—') + '</td>' +
                  '<td class="opstra-td-strike"><strong>' + num(k, 0) + '</strong>' +
                  (isAtm ? '<span class="opstra-strike-tag atm">ATM</span>' : '') +
                  (posBadges ? '<span class="opstra-strike-tag pos">' + esc(posBadges.join(' ')) + '</span>' : '') +
                  '</td>' +
                  '<td class="' + putItm + '">' + (gPe.g ? numFixed(gPe.g.delta, 2) : '—') + '</td>' +
                  '<td class="' + putItm + '">' + (gPe.iv === null ? '—' : numFixed(gPe.iv * 100, 1)) + '</td>' +
                  '<td class="' + putItm + ' opstra-td-ltp">' + (pe ? numFixed(pe.close, 2) : '—') + '</td>' +
                  (showDetailCols ? '<td class="' + putItm + '">' + peBidAsk + '</td>' : '') +
                  (showDetailCols ? '<td class="' + putItm + '">' + (pe && Number.isFinite(pe.volume) ? num(pe.volume, 0) : '—') + '</td>' : '') +
                  (showDetailCols ? '<td class="' + putItm + '">' + (pe && Number.isFinite(pe.oiChange) ? (pe.oiChange > 0 ? '+' : '') + num(pe.oiChange, 0) : '—') + '</td>' : '') +
                  '<td class="' + putItm + '"><div class="opstra-oi-cell"><span class="opstra-oi-bar put" style="width:' + putOiPct + '%"></span><span>' + (pe && Number.isFinite(pe.oi) ? num(pe.oi, 0) : '—') + '</span></div></td>' +
                  actionCell(pe, 'PE') +
                  '</tr>'
                );
              })
              .join('')
          : '<tr><td colspan="' + (showDetailCols ? 17 : 11) + '" class="opstra-empty">No strikes match the current filter for ' + esc(viewExpiry || s.symbol) + '.</td></tr>';

        el('save-candles').hidden = !bundle || bundle.synthetic === true;
        renderChart(a);
        renderTools(v);
      }

      function renderTools(v) {
        el('account').innerHTML = table(
          ['Equity', 'Available', 'Realized Gross', 'Unrealized Gross', 'Fees/Costs', 'Net P&L', 'Est. Margin'],
          [[v.equity, v.available, v.realized, v.unrealized, v.costs, v.net, v.margin].map(money)]
        );
        el('orders').innerHTML =
          '<h3>Orders</h3>' +
          table(
            ['Submitted IST', 'Contract', 'Order', 'Status', 'Details'],
            v.orders.map((o, i) => [
              esc(o.at),
              esc(o.type + ' ' + (o.type === 'FUT' ? 'FUT' : o.strike)),
              esc(o.orderType),
              esc(o.status),
              o.status === 'pending' ? '<button type="button" data-cancel="' + i + '">Cancel</button>' : esc(o.reason || o.fillAt || o.cancelAt),
            ])
          );
        el('journal').innerHTML =
          '<h3>Journal</h3>' +
          table(
            ['Opened IST', 'Closed IST', 'Contract', 'Entry', 'Exit / Mark', 'Net', 'Status'],
            P.journal(d, s).map(p => [
              esc(p.openAt || '—'),
              esc(p.closeAt || '—'),
              esc((p.type || '') + ' ' + (p.type === 'FUT' ? 'FUT' : p.strike ?? '')),
              money(p.entry),
              money(p.price ?? p.mark),
              money(p.net),
              esc(p.status),
            ])
          );
      }

      function editAtCursor() {
        if (s.cursor < s.frontier) s = P.branch(d, s);
      }

      function addLegOrder(q, side, lots, customEntryPrice) {
        if (!q) throw Error('Exact contract quote unavailable at this timestamp.');
        editAtCursor();
        const useCustom = customEntryPrice !== undefined && customEntryPrice !== null && customEntryPrice !== '' && Math.abs(Number(customEntryPrice) - q.close) > 1e-6;
        const next = P.order(d, s, {
          type: q.type,
          expiry: q.expiry,
          strike: q.strike,
          side,
          lots,
          orderType: 'market',
          ...(useCustom ? { entryPrice: Number(customEntryPrice) } : {}),
        });
        const last = P.valuation(d, next).orders.at(-1);
        if (last.status === 'rejected') {
          change(next);
          throw Error(last.reason);
        }
        change(next);
        msg((side === 1 ? 'Bought ' : 'Sold ') + lots + 'x ' + q.expiry + ' ' + (q.type === 'FUT' ? 'FUT' : q.strike + q.type) + ' @ ₹' + numFixed(useCustom ? Number(customEntryPrice) : q.close, 2) + '.');
      }

      function ticket(q, side = 1) {
        if (!q) throw Error('Exact quote unavailable.');
        if (quickTrade) {
          addLegOrder(q, side, Math.max(1, +el('chain-lots').value || 1));
          return;
        }
        const dom = dialog(
          'Add Strategy Leg',
          '<p><strong>' + esc(s.symbol + ' · ' + q.expiry + ' · ' + (q.type === 'FUT' ? 'FUT' : q.strike + ' ' + q.type)) + '</strong><br><small>Lot Size: ' + (q.lotSize || '—') + ' · Market LTP: ₹ ' + numFixed(q.close, 2) + '</small></p>' +
            '<form class="opstra-simple-ticket">' +
            '<label>Entry Premium (₹ — editable)<input name="premium" type="number" min="0" step="0.05" value="' + q.close + '" required></label>' +
            '<div class="opstra-ticket-row">' +
            '<button type="button" data-side="1">BUY</button>' +
            '<button type="button" data-side="-1">SELL</button>' +
            '<button type="button" data-lots="-1" aria-label="Decrease ticket lots">−</button>' +
            '<input name="lots" type="number" min="1" max="1000" aria-label="Position lots" value="' + esc(el('chain-lots').value) + '" required>' +
            '<button type="button" data-lots="1" aria-label="Increase ticket lots">+</button>' +
            '</div>' +
            '<button type="submit">ADD POSITION</button>' +
            '</form>'
        );
        const f = dom.querySelector('form');
        function choose(n) {
          side = n;
          f.querySelectorAll('[data-side]').forEach(b => {
            b.classList.toggle('selected', +b.dataset.side === side);
            b.setAttribute('aria-pressed', String(+b.dataset.side === side));
          });
        }
        choose(side);
        f.onclick = e => {
          if (e.target.dataset.side) choose(+e.target.dataset.side);
          if (e.target.dataset.lots) f.elements.lots.value = Math.max(1, Math.min(1000, +f.elements.lots.value + +e.target.dataset.lots));
        };
        f.onsubmit = guard(e => {
          e.preventDefault();
          addLegOrder(q, side, +f.elements.lots.value, +f.elements.premium.value);
          close();
        });
      }

      function editLegDialog(p) {
        const expiries = [...new Set(d.contracts.filter(q => q.symbol === s.symbol && (p.type === 'FUT' ? q.type === 'FUT' : q.type !== 'FUT')).map(q => q.expiry))].sort();
        const strikesFor = (exp, tp) => [...new Set((d.byFrame.get(s.symbol + '|' + s.cursor) || []).filter(q => q.expiry === exp && q.type === tp).map(q => q.strike))].sort((a, b) => a - b);
        const initStrikes = strikesFor(p.expiry, p.type);
        const dom = dialog(
          'Edit Strategy Leg',
          '<form>' +
            '<div class="opstra-fields">' +
            '<label>Side<select name="side"><option value="1" ' + (p.side === 1 ? 'selected' : '') + '>BUY (+)</option><option value="-1" ' + (p.side === -1 ? 'selected' : '') + '>SELL (−)</option></select></label>' +
            '<label>Type<select name="type"><option value="CE" ' + (p.type === 'CE' ? 'selected' : '') + '>CE</option><option value="PE" ' + (p.type === 'PE' ? 'selected' : '') + '>PE</option><option value="FUT" ' + (p.type === 'FUT' ? 'selected' : '') + '>FUT</option></select></label>' +
            '<label>Expiry<select name="expiry">' + options(expiries, p.expiry) + '</select></label>' +
            '<label>Strike<select name="strike" ' + (p.type === 'FUT' ? 'disabled' : '') + '>' + (p.type === 'FUT' ? '<option value="0">FUT</option>' : options(initStrikes.length ? initStrikes : [p.strike], p.strike)) + '</select></label>' +
            '<label>Lots<input name="lots" type="number" min="1" max="1000" value="' + p.remainingLots + '" required></label>' +
            '<label>Entry Premium (₹)<input name="entryPrice" type="number" min="0" step="0.05" value="' + p.entry + '" required></label>' +
            '</div>' +
            '<button type="submit">Save Leg Changes</button>' +
            '</form>'
        );
        const f = dom.querySelector('form');
        const refreshStrikes = () => {
          const tp = f.elements.type.value, exp = f.elements.expiry.value;
          if (tp === 'FUT') {
            f.elements.strike.innerHTML = '<option value="0">FUT</option>';
            f.elements.strike.disabled = true;
          } else {
            const list = strikesFor(exp, tp);
            f.elements.strike.disabled = false;
            f.elements.strike.innerHTML = options(list.length ? list : [p.strike], list.includes(+f.elements.strike.value) ? +f.elements.strike.value : list[0] || p.strike);
          }
          const q = d.records.get([s.symbol, s.cursor, exp, tp, tp === 'FUT' ? 0 : +f.elements.strike.value].join('|'));
          if (q) f.elements.entryPrice.value = q.close;
        };
        f.elements.type.onchange = refreshStrikes;
        f.elements.expiry.onchange = refreshStrikes;
        f.elements.strike.onchange = () => {
          const tp = f.elements.type.value, exp = f.elements.expiry.value;
          const q = d.records.get([s.symbol, s.cursor, exp, tp, tp === 'FUT' ? 0 : +f.elements.strike.value].join('|'));
          if (q) f.elements.entryPrice.value = q.close;
        };
        f.onsubmit = guard(e => {
          e.preventDefault();
          editAtCursor();
          const tp = f.elements.type.value;
          change(
            P.modify(d, s, p.id, {
              side: +f.elements.side.value,
              type: tp,
              expiry: f.elements.expiry.value,
              strike: tp === 'FUT' ? 0 : +f.elements.strike.value,
              lots: +f.elements.lots.value,
              entryPrice: +f.elements.entryPrice.value,
            })
          );
          close();
          msg('Strategy leg updated.');
        });
      }

      function riskDialog(p) {
        const dom = dialog(
          'Exit Position / Risk Rules',
          '<p><strong>' + esc(p.expiry + ' ' + (p.type === 'FUT' ? 'FUT' : p.strike + p.type)) + '</strong> · Entry ' + money(p.entry) + ' · Current Mark ' + money(p.mark) + '</p>' +
            '<form>' +
            '<div class="opstra-fields">' +
            '<label>Stop-Loss Premium<input name="stopLoss" type="number" min="0" step="any" value="' + (p.risk.stopLoss ?? '') + '"></label>' +
            '<label>Target Premium<input name="target" type="number" min="0" step="any" value="' + (p.risk.target ?? '') + '"></label>' +
            '<label>Trailing Distance<input name="trailing" type="number" min=".01" step="any" value="' + (p.risk.trailing ?? '') + '"></label>' +
            '<label>Exit Lots<input name="lots" type="number" min="1" max="' + p.remainingLots + '" value="' + p.remainingLots + '"></label>' +
            '<label>Exit Price (₹ — defaults to market mark)<input name="exitPrice" type="number" min="0" step="0.05" value="' + (Number.isFinite(p.mark) ? p.mark : '') + '"></label>' +
            '</div>' +
            '<p>Risk rules trigger automatically on subsequent replay bars without lookahead bias.</p>' +
            '<div class="opstra-data-actions">' +
            '<button name="risk" type="submit">Save SL / Target Rules</button>' +
            '<button name="exit" type="submit">Exit Lots Now</button>' +
            '</div>' +
            '</form>'
        );
        const f = dom.querySelector('form');
        f.onsubmit = guard(e => {
          e.preventDefault();
          editAtCursor();
          if (e.submitter?.name === 'exit') {
            const customEx = f.elements.exitPrice.value !== '' ? +f.elements.exitPrice.value : undefined;
            change(P.exit(d, s, p.id, +f.elements.lots.value, customEx));
            msg('Position exited.');
          } else {
            change(P.risk(d, s, p.id, Object.fromEntries(['stopLoss', 'target', 'trailing'].map(k => [k, f.elements[k].value === '' ? null : +f.elements[k].value]))));
            msg('Risk rules saved for position.');
          }
          close();
        });
      }

      async function fetchLiveSnapshotNow(silent = false) {
        if (refreshInFlight || !s) return;
        refreshInFlight = true;
        const btn = el('btn-live-refresh');
        if (btn) btn.textContent = '↻ Loading…';
        try {
          const exch = fnoExch();
          const expRes = await brokerApi('expiries?' + new URLSearchParams({ underlying: s.symbol, exch }));
          if (Array.isArray(expRes.expiryDetails)) {
            for (const item of expRes.expiryDetails) if (item.iso) brokerExpiryDetails[item.iso] = item;
          }
          const desiredCode = isoToBrokerCode(viewExpiry);
          const chosenExp = expRes.expiries.includes(desiredCode) ? desiredCode : expRes.expiries[0];
          if (!chosenExp) throw Error('No active option expiries returned for ' + s.symbol);
          const snap = await brokerApi('snapshot?' + new URLSearchParams({ underlying: s.symbol, expiry: chosenExp, exch }));
          adopt(snap.dataset);
          await refreshBrokerAuthStatus();
          await refreshMarketAndCoverage(s.symbol);
          if (!silent) {
            msg(snap.notice || ('Live ' + s.symbol + ' (' + chosenExp + ') option-chain snapshot refreshed & recorded to Snapshot Store.'));
          }
        } catch (err) {
          stopAutoRefresh();
          if (!silent) {
            msg(err.message);
          }
        } finally {
          refreshInFlight = false;
          if (btn) btn.textContent = '↻ Refresh';
        }
      }

      async function openSnapshotStoreModal() {
        const statusData = await brokerApi('recorder/status');
        snapshotCoverage = statusData.coverage;
        serverMarketStatus = statusData.marketStatus;
        updateMarketBadges();

        const symRows = (snapshotCoverage?.symbols || []).map(row => [
          esc(row.symbol + ' (' + row.exchange + ')'),
          esc(String(row.frameCount)),
          esc(row.earliestTimestamp || '—'),
          esc(row.latestTimestamp || '—'),
          esc((row.expiries || []).join(', ')),
          '<button type="button" data-replay-sym="' + esc(row.symbol) + '" data-replay-exch="' + esc(row.exchange) + '" data-replay-exp="' + esc((row.expiries || [])[0] || '') + '" data-replay-start="' + esc((row.earliestTimestamp || '').slice(0, 10)) + '" data-replay-end="' + esc((row.latestTimestamp || '').slice(0, 10)) + '">Load Replay</button>',
        ]);

        const dom = dialog(
          'Historical Option-Chain Snapshot Store & Recorder',
          '<p><strong>Historical Data Integrity:</strong> Live exchange feeds provide 1-minute historical OHLCV bars for active option contracts, while historical OI, Change in OI, Bid/Ask, IV &amp; Greeks are preserved by IWSM\'s local SQLite <code>SnapshotStore</code> from the moment live recording is enabled. Historical option prices are never fabricated.</p>' +
            '<div class="opstra-stat-grid">' +
            '<div class="opstra-stat-box"><small>Earliest Recorded Date</small><strong>' + esc(snapshotCoverage?.earliestDate || 'None recorded yet') + '</strong></div>' +
            '<div class="opstra-stat-box"><small>Total Recorded Frames</small><strong>' + esc(String(snapshotCoverage?.frameCount || 0)) + '</strong></div>' +
            '<div class="opstra-stat-box"><small>Contract Rows Stored</small><strong>' + esc(String(snapshotCoverage?.contractRowCount || 0)) + '</strong></div>' +
            '<div class="opstra-stat-box"><small>Background Recorder</small><strong>' + esc(statusData.enabled ? 'Active (' + statusData.intervalSeconds + 's)' : 'Stopped') + '</strong></div>' +
            '</div>' +
            (symRows.length ? table(['Symbol', 'Frames', 'Earliest IST', 'Latest IST', 'Expiries', 'Action'], symRows) : '<p class="opstra-empty">No live option-chain snapshots recorded yet. During market hours (09:15–15:30 IST), click Record Snapshot Now or enable Background Recording below.</p>') +
            '<form id="opstra-recorder-form">' +
            '<div class="opstra-fields">' +
            '<label>Target Symbol<input name="underlying" value="' + esc(s?.symbol || 'NIFTY') + '" required></label>' +
            '<label>Target Expiry (DDMMMYY or YYYY-MM-DD)<input name="expiry" value="' + esc(isoToBrokerCode(viewExpiry) || '') + '" required></label>' +
            '<label>Exchange<select name="exch"><option value="nse_fo" ' + ((d?.metadata?.exchange || 'nse_fo') === 'nse_fo' ? 'selected' : '') + '>NSE F&amp;O (nse_fo)</option><option value="bse_fo" ' + (d?.metadata?.exchange === 'bse_fo' ? 'selected' : '') + '>BSE F&amp;O (bse_fo)</option></select></label>' +
            '<label>Auto-Record Interval (seconds)<select name="intervalSeconds"><option value="60" selected>Every 60 sec (1m)</option><option value="180">Every 180 sec (3m)</option><option value="300">Every 300 sec (5m)</option></select></label>' +
            '</div>' +
            '<p class="opstra-dialog-status" id="opstra-rec-msg" role="status">Status: ' + esc(statusData.lastStatus || 'idle') + '</p>' +
            '<div class="opstra-data-actions">' +
            '<button type="button" id="opstra-rec-once">Record Snapshot Now</button>' +
            '<button type="submit" name="enable">Start Background IST Recorder</button>' +
            (statusData.enabled ? '<button type="button" id="opstra-rec-stop">Stop Recorder</button>' : '') +
            '</div>' +
            '</form>',
          true
        );

        const recMsg = dom.querySelector('#opstra-rec-msg');
        const form = dom.querySelector('#opstra-recorder-form');

        dom.onclick = guard(async e => {
          const btn = e.target.closest('[data-replay-sym]');
          if (!btn) return;
          const j = await brokerApi(
            'snapshots/replay?' +
              new URLSearchParams({
                underlying: btn.dataset.replaySym,
                exch: btn.dataset.replayExch,
                expiry: btn.dataset.replayExp,
                start: btn.dataset.replayStart,
                end: btn.dataset.replayEnd,
              })
          );
          adopt(j.dataset);
          close();
          msg('Loaded genuinely recorded option-chain snapshots for ' + btn.dataset.replaySym + '.');
        });

        dom.querySelector('#opstra-rec-once').onclick = guard(async () => {
          const fd = Object.fromEntries(new FormData(form));
          recMsg.textContent = 'Capturing live exchange option-chain snapshot…';
          const j = await brokerApi('snapshots/record', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ underlying: fd.underlying, expiry: fd.expiry, exch: fd.exch }),
          });
          snapshotCoverage = j.coverage;
          adopt(j.dataset);
          recMsg.textContent = 'Snapshot recorded! Total frames for ' + fd.underlying + ': ' + j.coverage.frameCount;
        });

        const stopBtn = dom.querySelector('#opstra-rec-stop');
        if (stopBtn) {
          stopBtn.onclick = guard(async () => {
            await brokerApi('recorder/configure', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ enabled: false, intervalSeconds: 60, targets: [] }),
            });
            recMsg.textContent = 'Background recorder stopped.';
          });
        }

        form.onsubmit = guard(async e => {
          e.preventDefault();
          const fd = Object.fromEntries(new FormData(form));
          const j = await brokerApi('recorder/configure', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              enabled: true,
              intervalSeconds: +fd.intervalSeconds,
              targets: [{ underlying: fd.underlying, expiry: fd.expiry, exch: fd.exch }],
            }),
          });
          recMsg.textContent = 'Background IST recorder scheduled (' + j.lastStatus + ').';
        });
      }

      function renderIvAnalyticsModal() {
        const spot = d.spots.get(s.symbol + '|' + s.cursor);
        const fut = currentFuture();
        const refPrice = Number.isFinite(spot) && spot > 0 ? spot : fut?.close;
        const useFut = !(Number.isFinite(spot) && spot > 0) && Number.isFinite(fut?.close);
        const opts = chainRows.filter(q => q.type === 'CE');
        if (!opts.length || !Number.isFinite(refPrice)) {
          msg('Select an active option expiry with underlying quotes first.');
          return;
        }
        const atmCall = [...opts].sort((a, b) => Math.abs(a.strike - refPrice) - Math.abs(b.strike - refPrice))[0];

        // 1. Historical IV & Underlying time series across loaded frames up to cursor
        const histPoints = P.frames(d, s)
          .filter(t => t <= s.cursor)
          .map(t => {
            const sp = d.spots.get(s.symbol + '|' + t) ?? (d.byFrame.get(s.symbol + '|' + t) || []).find(x => x.type === 'FUT')?.close ?? null;
            const row = d.records.get([s.symbol, t, atmCall.expiry, 'CE', atmCall.strike].join('|'));
            const days = Math.max(0, (Date.parse(atmCall.expiry + 'T15:30:00+05:30') - M.instant(t)) / 86400000);
            const rate = (d.metadata.rate ?? s.settings.rate) / 100;
            const div = useFut ? rate : (d.metadata.dividend ?? s.settings.dividend) / 100;
            let ivPct = null;
            if (d.metadata.modelled && Number.isFinite(d.metadata.iv)) ivPct = d.metadata.iv;
            else if (row && Number.isFinite(row.iv)) ivPct = row.iv;
            else if (row && Number.isFinite(sp) && sp > 0 && row.close > 0) {
              const solved = Q.impliedVolatility('CE', sp, atmCall.strike, days, row.close, rate, div);
              if (solved !== null) ivPct = solved * 100;
            }
            return { t, spot: sp, iv: ivPct };
          })
          .filter(x => Number.isFinite(x.spot) || Number.isFinite(x.iv));

        // 2. Strike IV Skew across active chain
        const strikes = [...new Set(chainRows.filter(q => q.type !== 'FUT').map(q => q.strike))].sort((a, b) => a - b);
        const skewPoints = strikes
          .map(k => {
            const ce = chainRows.find(q => q.type === 'CE' && q.strike === k);
            const pe = chainRows.find(q => q.type === 'PE' && q.strike === k);
            const cIv = ce ? greeks(ce, refPrice, useFut).iv : null;
            const pIv = pe ? greeks(pe, refPrice, useFut).iv : null;
            return { strike: k, callIv: cIv !== null ? cIv * 100 : null, putIv: pIv !== null ? pIv * 100 : null };
          })
          .filter(x => Number.isFinite(x.callIv) || Number.isFinite(x.putIv));

        // 3. Expiry Term Structure across all expiries at cursor
        const allAtCursor = d.byFrame.get(s.symbol + '|' + s.cursor) || [];
        const allExps = [...new Set(allAtCursor.filter(q => q.type !== 'FUT').map(q => q.expiry))].sort();
        const termRows = allExps.map(exp => {
          const eRows = allAtCursor.filter(q => q.expiry === exp && q.type !== 'FUT');
          const eStrikes = [...new Set(eRows.map(q => q.strike))].sort((a, b) => a - b);
          const eAtm = eStrikes.reduce((a, b) => (Math.abs(b - refPrice) < Math.abs(a - refPrice) ? b : a), eStrikes[0]);
          const ce = eRows.find(q => q.type === 'CE' && q.strike === eAtm);
          const pe = eRows.find(q => q.type === 'PE' && q.strike === eAtm);
          const ivs = [ce ? greeks(ce, refPrice, useFut).iv : null, pe ? greeks(pe, refPrice, useFut).iv : null].filter(x => Number.isFinite(x) && x > 0);
          const avgIv = ivs.length ? (ivs.reduce((a, b) => a + b, 0) / ivs.length) * 100 : null;
          const dte = Math.max(0, Math.round((Date.parse(exp + 'T15:30:00+05:30') - M.instant(s.cursor)) / 86400000));
          return { expiry: exp, dte, atmStrike: eAtm, atmIv: avgIv };
        });

        function buildDualLineSvg(points) {
          const validIv = points.map(p => p.iv).filter(Number.isFinite);
          const validSp = points.map(p => p.spot).filter(Number.isFinite);
          if (!validIv.length && !validSp.length) return '<p class="opstra-empty">Insufficient IV observations in the loaded window.</p>';
          const W = 680, H = 250, L = 58, R = 58, T = 22, B = 36, pw = W - L - R, ph = H - T - B;
          const spMin = Math.min(...(validSp.length ? validSp : [0])), spMax = Math.max(...(validSp.length ? validSp : [1]));
          const ivMin = Math.max(0, Math.min(...(validIv.length ? validIv : [10])) - 1), ivMax = Math.max(...(validIv.length ? validIv : [20])) + 1;
          const x = i => L + (points.length <= 1 ? pw / 2 : (i / (points.length - 1)) * pw);
          const ySp = v => T + (1 - (v - spMin) / (spMax - spMin || 1)) * ph;
          const yIv = v => T + (1 - (v - ivMin) / (ivMax - ivMin || 1)) * ph;
          const linePath = (fn, key) => {
            let open = false;
            return points.map((p, i) => {
              if (!Number.isFinite(p[key])) { open = false; return ''; }
              const cmd = (open ? 'L' : 'M') + x(i).toFixed(1) + ',' + fn(p[key]).toFixed(1);
              open = true;
              return cmd;
            }).join(' ');
          };
          const latestIv = validIv.at(-1), minIv = Math.min(...validIv), maxIv = Math.max(...validIv);
          const avgIv = validIv.length ? validIv.reduce((a, b) => a + b, 0) / validIv.length : null;
          return (
            '<div class="opstra-stat-grid">' +
            '<div class="opstra-stat-box"><small>Current ATM IV</small><strong>' + numFixed(latestIv, 2) + '%</strong></div>' +
            '<div class="opstra-stat-box"><small>Window Mean IV</small><strong>' + numFixed(avgIv, 2) + '%</strong></div>' +
            '<div class="opstra-stat-box"><small>Window Low / High IV</small><strong>' + numFixed(minIv, 2) + '% – ' + numFixed(maxIv, 2) + '%</strong></div>' +
            '<div class="opstra-stat-box"><small>Reference Strike</small><strong>' + atmCall.strike + ' CE (' + atmCall.expiry + ')</strong></div>' +
            '</div>' +
            '<div class="opstra-iv-legend"><span style="color:#0284c7">━ Underlying Price (Left Axis)</span><span style="color:#d97706">━ Implied Volatility % (Right Axis)</span></div>' +
            '<svg viewBox="0 0 ' + W + ' ' + H + '" class="opstra-iv-svg" role="img" aria-label="' + esc(s.symbol) + ' Historical Implied Volatility and Underlying Chart">' +
            [0, 0.25, 0.5, 0.75, 1].map(f => {
              const py = T + f * ph;
              const sVal = spMax - f * (spMax - spMin);
              const iVal = ivMax - f * (ivMax - ivMin);
              return (
                '<line x1="' + L + '" y1="' + py + '" x2="' + (W - R) + '" y2="' + py + '" stroke="var(--border)" stroke-opacity="0.5"/>' +
                '<text x="' + (L - 6) + '" y="' + (py + 4) + '" text-anchor="end" fill="#0284c7" font-size="10">' + numFixed(sVal, 0) + '</text>' +
                '<text x="' + (W - R + 6) + '" y="' + (py + 4) + '" text-anchor="start" fill="#d97706" font-size="10">' + numFixed(iVal, 1) + '%</text>'
              );
            }).join('') +
            '<path d="' + linePath(ySp, 'spot') + '" fill="none" stroke="#0284c7" stroke-width="2"/>' +
            '<path d="' + linePath(yIv, 'iv') + '" fill="none" stroke="#d97706" stroke-width="2.2"/>' +
            (points.length === 1 && Number.isFinite(points[0].iv) ? '<circle cx="' + x(0) + '" cy="' + yIv(points[0].iv) + '" r="4.5" fill="#d97706"/>' : '') +
            '<text x="' + L + '" y="' + (H - 10) + '" fill="var(--muted)" font-size="10">' + esc(points[0]?.t || '') + '</text>' +
            '<text x="' + (W - R) + '" y="' + (H - 10) + '" text-anchor="end" fill="var(--muted)" font-size="10">' + esc(points.at(-1)?.t || '') + '</text>' +
            '</svg>'
          );
        }

        function buildSkewSvg(points) {
          if (!points.length) return '<p class="opstra-empty">No strike IV skew points available for ' + esc(viewExpiry) + '.</p>';
          const W = 680, H = 240, L = 52, R = 24, T = 22, B = 36, pw = W - L - R, ph = H - T - B;
          const allIvs = points.flatMap(p => [p.callIv, p.putIv]).filter(Number.isFinite);
          const kMin = points[0].strike, kMax = points.at(-1).strike;
          const ivMin = Math.max(0, Math.min(...allIvs) - 1.5), ivMax = Math.max(...allIvs) + 1.5;
          const x = k => L + (kMax === kMin ? pw / 2 : ((k - kMin) / (kMax - kMin)) * pw);
          const y = v => T + (1 - (v - ivMin) / (ivMax - ivMin || 1)) * ph;
          const pathFor = key => {
            let open = false;
            return points.map(p => {
              if (!Number.isFinite(p[key])) { open = false; return ''; }
              const cmd = (open ? 'L' : 'M') + x(p.strike).toFixed(1) + ',' + y(p[key]).toFixed(1);
              open = true;
              return cmd;
            }).join(' ');
          };
          const atmX = x(atmCall.strike);
          return (
            '<div class="opstra-iv-legend"><span style="color:#16a34a">━ Call IV %</span><span style="color:#dc2626">━ Put IV %</span><span>┊ ATM (' + atmCall.strike + ')</span></div>' +
            '<svg viewBox="0 0 ' + W + ' ' + H + '" class="opstra-iv-svg" role="img" aria-label="Implied Volatility Skew Across Strikes">' +
            [0, 0.25, 0.5, 0.75, 1].map(f => {
              const py = T + f * ph;
              return '<line x1="' + L + '" y1="' + py + '" x2="' + (W - R) + '" y2="' + py + '" stroke="var(--border)" stroke-opacity="0.5"/><text x="' + (L - 6) + '" y="' + (py + 4) + '" text-anchor="end" fill="var(--muted)" font-size="10">' + numFixed(ivMax - f * (ivMax - ivMin), 1) + '%</text>';
            }).join('') +
            '<line x1="' + atmX + '" y1="' + T + '" x2="' + atmX + '" y2="' + (H - B) + '" stroke="var(--muted)" stroke-dasharray="3 3"/>' +
            '<path d="' + pathFor('callIv') + '" fill="none" stroke="#16a34a" stroke-width="2"/>' +
            '<path d="' + pathFor('putIv') + '" fill="none" stroke="#dc2626" stroke-width="2"/>' +
            '<text x="' + L + '" y="' + (H - 10) + '" fill="var(--muted)" font-size="10">' + kMin + '</text>' +
            '<text x="' + atmX + '" y="' + (H - 10) + '" text-anchor="middle" fill="var(--ink)" font-size="10">ATM ' + atmCall.strike + '</text>' +
            '<text x="' + (W - R) + '" y="' + (H - 10) + '" text-anchor="end" fill="var(--muted)" font-size="10">' + kMax + '</text>' +
            '</svg>'
          );
        }

        const dom = dialog(
          s.symbol + ' Volatility Analytics — Historical IV, Skew & Term Structure',
          '<div class="opstra-data-actions" id="opstra-iv-tabs">' +
            '<button type="button" data-ivview="history">Historical IV Chart</button>' +
            '<button type="button" data-ivview="skew">Strike IV Skew (' + esc(viewExpiry) + ')</button>' +
            '<button type="button" data-ivview="term">Expiry Term Structure &amp; Model</button>' +
            '</div>' +
            '<div id="opstra-iv-panel-history">' +
            buildDualLineSvg(histPoints) +
            '<details><summary>Inspect Timestamped IV Table (' + histPoints.length + ' observations)</summary>' +
            table(['Observed IST', 'Underlying', 'ATM IV %'], histPoints.slice(-120).map(p => [esc(p.t), numFixed(p.spot, 2), numFixed(p.iv, 2)])) +
            '</details>' +
            '</div>' +
            '<div id="opstra-iv-panel-skew" hidden>' +
            buildSkewSvg(skewPoints) +
            '</div>' +
            '<div id="opstra-iv-panel-term" hidden>' +
            table(['Expiry', 'DTE (Calendar)', 'ATM Strike', 'ATM Implied Volatility %'], termRows.map(r => [esc(r.expiry + ' (' + isoToBrokerCode(r.expiry) + ')'), esc(r.dte + 'd'), esc(String(r.atmStrike)), numFixed(r.atmIv, 2) + '%'])) +
            '<p class="opstra-tab-footnote"><strong>Pricing Model &amp; Assumptions:</strong> European Black-Scholes-Merton (Spot basis, continuous dividend yield q = ' + numFixed(d.metadata?.dividend ?? s.settings.dividend, 2) + '%) and Black-76 (Futures basis, q = r), annualized risk-free rate r = ' + numFixed(d.metadata?.rate ?? s.settings.rate, 2) + '%, ACT/365 day-count to 15:30 IST on expiry day. Implied volatility is solved via safeguarded Newton-Raphson + bisection. All derived IVs and Greeks are explicitly badged as model-calculated, never misrepresented as exchange-supplied values.</p>' +
            '</div>',
          true
        );

        dom.querySelector('#opstra-iv-tabs').onclick = e => {
          const vName = e.target.dataset.ivview;
          if (!vName) return;
          for (const k of ['history', 'skew', 'term']) {
            dom.querySelector('#opstra-iv-panel-' + k).hidden = k !== vName;
          }
        };
      }

      function newSimulation(preferred) {
        generation++;
        pause();
        stopAutoRefresh();
        const selected = instrumentChoice(preferred || fnoExch() + '|' + (s?.symbol || 'NIFTY'));
        const now = todayIST();
        const day = defaultMinuteStartIST(now);

        const dom = dialog(
          'New Options Simulation',
          '<form>' +
            '<div class="opstra-fields">' +
            '<label>Index / Stock F&amp;O<select name="symbol" required>' + instrumentOptions(selected.symbol, selected.exchange) + '</select></label>' +
            '<label class="history-date">Start Date (IST)<input name="start" type="date" value="' + day + '" max="' + now + '" required></label>' +
            '<label class="history-date">End Date (IST)<input name="end" type="date" value="' + now + '" max="' + now + '" required></label>' +
            '<label class="broker-expiry">Contract Expiry<select name="expiry"></select></label>' +
            '</div>' +
            '<p class="opstra-dialog-status" role="status"></p>' +
            '<div class="opstra-data-actions">' +
            '<button type="submit">Start Simulation</button>' +
            '</div>' +
            '</form>'
        );
        const f = dom.querySelector('form'), note = dom.querySelector('[role=status]');
        let request = 0, archiveFallbackOnly = false;

        function clampModalDates() {
          const sVal = f.elements.start.value;
          let eVal = f.elements.end.value;
          if (!sVal) return;
          if (!eVal || eVal < sVal) eVal = sVal;
          const daysAgo = (Date.parse(now) - Date.parse(sVal)) / 86400000;
          const maxSpan = daysAgo <= 6 ? 6 : 30;
          if ((Date.parse(eVal) - Date.parse(sVal)) / 86400000 > maxSpan) {
            const clamped = addCalendarDays(sVal, maxSpan);
            eVal = clamped > now ? now : clamped;
          }
          if (f.elements.end.value !== eVal) f.elements.end.value = eVal;
        }

        async function loadModalExpiries() {
          clampModalDates();
          const n = ++request, choice = instrumentChoice(f.elements.symbol.value);
          const startVal = f.elements.start.value, endVal = f.elements.end.value;
          archiveFallbackOnly = false;
          f.querySelector('.broker-expiry').hidden = false;
          f.elements.expiry.innerHTML = '';
          f.querySelector('[type=submit]').disabled = true;

          if (!startVal || !endVal || startVal > now || endVal > now || startVal > endVal) {
            note.textContent = 'Invalid date selection: Start Date must be ≤ End Date and cannot be in the future (' + now + ' IST).';
            return;
          }

          note.textContent = 'Loading ' + choice.symbol + ' expiries…';
          try {
            const j = await brokerApi(
              'expiries?' +
                new URLSearchParams({
                  underlying: choice.symbol,
                  exch: choice.exchange,
                  start: startVal,
                  end: endVal,
                })
            );
            if (n !== request || !f.isConnected) return;
            if (Array.isArray(j.expiryDetails) && j.expiryDetails.length) {
              for (const item of j.expiryDetails) if (item.iso) brokerExpiryDetails[item.iso] = item;
              f.elements.expiry.innerHTML = j.expiryDetails
                .map(item => '<option value="' + esc(item.expiry) + '">' + esc(item.expiry + ' · ' + (item.cycle === 'monthly' ? 'Monthly' : 'Weekly') + ' (' + item.dte + 'd)') + '</option>')
                .join('');
            } else {
              f.elements.expiry.innerHTML = options(j.expiries || [], (j.expiries || [])[0]);
            }
            if (!j.expiries?.length) {
              if (choice.exchange === 'nse_fo') {
                const win = resolveArchiveWindow(choice.symbol, startVal, endVal);
                if (win.start !== startVal || win.end !== endVal) {
                  note.textContent = 'Adjusted weekend/holiday date to nearest trading session (' + win.start + ' to ' + win.end + ').';
                  f.elements.start.value = win.start;
                  f.elements.end.value = win.end;
                  return loadModalExpiries();
                }
                archiveFallbackOnly = true;
                f.querySelector('.broker-expiry').hidden = true;
                note.textContent = 'Historical option chain archive ready (' + win.start + ' to ' + win.end + ').';
                f.querySelector('[type=submit]').disabled = false;
                return;
              }
              note.textContent = 'No option contracts found for ' + choice.symbol + ' in ' + startVal + ' – ' + endVal + '.';
              return;
            }
            if (j.historicalOnly && choice.exchange === 'nse_fo') {
              archiveFallbackOnly = true;
            }
            note.textContent = j.historicalOnly || j.backup
              ? 'Historical contracts resolved (' + (j.source || 'verified local archive') + '). Automatically loads best available intraday or daily chain.'
              : '1-Minute Intraday Option History ready · Automatically loads observed 1m option-chain bars.';
            f.querySelector('[type=submit]').disabled = !j.expiries.length;
          } catch (e) {
            if (n !== request) return;
            if (choice.exchange === 'nse_fo') {
              archiveFallbackOnly = true;
              f.querySelector('.broker-expiry').hidden = true;
              note.textContent = 'Historical option chain archive ready for ' + choice.symbol + '.';
              f.querySelector('[type=submit]').disabled = false;
              return;
            }
            note.textContent = e.message;
          }
        }

        f.elements.symbol.onchange = loadModalExpiries;
        f.elements.start.onchange = loadModalExpiries;
        f.elements.end.onchange = loadModalExpiries;
        loadModalExpiries();

        refreshInstruments()
          .then(() => {
            if (!f.isConnected) return;
            const current = instrumentChoice(f.elements.symbol.value);
            f.elements.symbol.innerHTML = instrumentOptions(current.symbol, current.exchange);
          })
          .catch(() => {});

        f.onsubmit = guard(async e => {
          e.preventDefault();
          const values = Object.fromEntries(new FormData(f)), choice = instrumentChoice(values.symbol);
          const spanDays = (Date.parse(values.end) - Date.parse(values.start)) / 86400000;
          if (archiveFallbackOnly || (spanDays > 6 && choice.exchange === 'nse_fo')) {
            const win = resolveArchiveWindow(choice.symbol, values.start, values.end);
            await loadRecorded(choice.symbol, win.start, win.end);
            return;
          }
          const n = ++generation;
          f.querySelector('[type=submit]').disabled = true;
          note.textContent = 'Loading ' + choice.symbol + ' option chain…';
          try {
            const j = await brokerApi(
              'replay?' +
                new URLSearchParams({
                  underlying: choice.symbol,
                  expiry: values.expiry,
                  start: values.start,
                  end: values.end,
                  exch: choice.exchange,
                })
            );
            if (n !== generation) return;
            adopt(j.dataset);
            close();
            refreshMarketAndCoverage(choice.symbol);
            msg(
              (j.notice || ('Intraday 1-minute ' + choice.symbol + ' option chain loaded · ' + s.cursor.replace('T', ' ') + ' IST.')) +
                (j.dataset.metadata?.warnings?.length ? ' ' + j.dataset.metadata.warnings.join(' ') : '')
            );
          } catch (err) {
            if (choice.exchange === 'nse_fo') {
              try {
                const win = resolveArchiveWindow(choice.symbol, values.start, values.end);
                await loadRecorded(choice.symbol, win.start, win.end);
                msg('Loaded verified ' + choice.symbol + ' historical option chain (' + s.cursor.slice(0, 10) + ').');
                return;
              } catch {}
            }
            note.textContent = err.message;
            msg(err.message);
          } finally {
            if (f.isConnected) f.querySelector('[type=submit]').disabled = false;
          }
        });
      }

      // Wire top header & toolbar actions
      el('btn-new').onclick = () => newSimulation();
      el('btn-live-chain').onclick = guard(() => fetchLiveSnapshotNow(false));
      el('btn-live-refresh').onclick = guard(() => fetchLiveSnapshotNow(false));
      el('btn-recorder').onclick = guard(() => openSnapshotStoreModal());

      el('auto-refresh').onchange = () => {
        if (el('auto-refresh').checked) {
          pause();
          fetchLiveSnapshotNow(false);
          autoRefreshTimer = setInterval(() => {
            if (!document.hidden) fetchLiveSnapshotNow(true);
          }, 10000);
        } else {
          stopAutoRefresh();
        }
      };

      el('symbol-search').oninput = e => {
        symbolSearchQuery = e.target.value || '';
        if (s && d) {
          el('symbol-select').innerHTML = instrumentOptions(s.symbol, fnoExch(), symbolSearchQuery);
        }
        renderSearchMatches();
      };
      if (el('search-matches')) {
        el('search-matches').onclick = guard(async e => {
          const btn = e.target.closest('[data-pick-symbol]');
          if (!btn) return;
          const picked = btn.dataset.pickSymbol;
          symbolSearchQuery = '';
          el('symbol-search').value = '';
          renderSearchMatches();
          await switchInstrument(picked);
        });
      }
      el('symbol-search').onkeydown = guard(async e => {
        if (e.key === 'Enter') {
          e.preventDefault();
          const q = (el('symbol-search').value || '').trim().toUpperCase();
          if (!q) return;
          let matches = findMatchingInstruments(q);
          if (!matches.length) {
            await refreshInstruments().catch(() => {});
            matches = findMatchingInstruments(q);
          }
          if (!matches.length) {
            msg('No listed F&O derivative contract matches "' + q + '".');
            return;
          }
          const picked = matches[0].exchange + '|' + matches[0].symbol;
          symbolSearchQuery = '';
          el('symbol-search').value = '';
          renderSearchMatches();
          await switchInstrument(picked);
        }
      });

      el('btn-simulations').onclick = guard(async () => {
        generation++;
        pause();
        await saveQueue.catch(() => {});
        if (!db) throw Error('Browser study storage unavailable. Restore a JSON backup instead.');
        const rows = await db.list();
        const dom = dialog('Saved Simulations', rows.map((x, i) => '<button type="button" data-study="' + i + '">' + esc(x.name) + '</button>').join('') || '<p>No saved simulations yet.</p>');
        dom.onclick = guard(e => {
          if (e.target.dataset.study !== undefined) {
            restore(rows[+e.target.dataset.study]);
            close();
          }
        });
      });

      el('btn-liquidity').onclick = () =>
        dialog(
          'Execution, Data Integrity & Liquidity Guidelines',
          '<p><strong>Simulation Only — Zero Real Orders:</strong> All leg entries, edits, flips, exits, and playback steps execute strictly inside IWSM\'s isolated paper ledger. No live order API is ever imported or called.</p>' +
            '<p><strong>Market Data Honesty:</strong> Live quotes originate from verified exchange market-data feeds. Historical replay uses genuinely recorded IWSM option-chain snapshots, 1-minute intraday contract bars, or verified NSE historical archives. Missing fields (e.g. historical bid/ask on EOD archives) are displayed as <code>—</code> rather than fabricated.</p>' +
            '<p><strong>Deterministic Execution:</strong> Orders fill at recorded closes (or user-specified custom entry premiums when explicitly edited). Zero-volume bars block market execution; stop-loss and target rules evaluate chronologically without lookahead bias.</p>'
        );

      el('btn-record').onclick = guard(async () => {
        recording = !recording;
        await persist();
        el('btn-record').classList.toggle('recording', recording);
        el('btn-record').innerHTML = recording ? '<span class="opstra-dot-red">■</span> STOP RECORDING' : '<span class="opstra-dot-red">●</span> RECORD SIMULATION';
        el('btn-record').setAttribute('aria-pressed', String(recording));
        msg(recording ? 'Simulation state is continuously persisted to browser storage. Open Simulations to restore anytime.' : 'Simulation recording paused. Latest state remains saved.');
      });

      el('btn-reset').onclick = guard(() => {
        pause();
        persist();
        change(P.create(d, { symbol: s.symbol, start: s.start, end: s.end, ...s.settings }));
        msg('Strategy positions cleared. Previous study remains saved in Simulations.');
      });

      el('btn-rewind').onclick = guard(() => {
        pause();
        const frames = P.frames(d, s);
        if (!frames.length) return;
        change(P.advance(d, s, frames[0]));
        msg('Rewound simulation cursor to start: ' + s.cursor.replace('T', ' ') + ' IST.');
      });

      el('btn-toggle-builder').onclick = () => {
        const fb = el('leg-builder');
        fb.hidden = !fb.hidden;
        el('btn-toggle-builder').setAttribute('aria-expanded', String(!fb.hidden));
      };

      // Inline Multi-Leg Builder events
      el('build-type').onchange = () => { el('build-price').dataset.userEdited = ''; render(); };
      el('build-expiry').onchange = () => { el('build-price').dataset.userEdited = ''; render(); };
      el('build-strike').onchange = () => { el('build-price').dataset.userEdited = ''; updateBuilderQuoteHint(); };
      el('build-price').oninput = () => { el('build-price').dataset.userEdited = el('build-price').value !== '' ? '1' : ''; };
      el('leg-builder').onsubmit = guard(e => {
        e.preventDefault();
        const side = +el('build-side').value;
        const type = el('build-type').value;
        const exp = el('build-expiry').value;
        const strike = type === 'FUT' ? 0 : +el('build-strike').value;
        const lots = +el('build-lots').value;
        const q = d.records.get([s.symbol, s.cursor, exp, type, strike].join('|'));
        if (!q) throw Error('Selected contract (' + exp + ' ' + (type === 'FUT' ? 'FUT' : strike + type) + ') has no quote at ' + s.cursor + '.');
        const customPrice = el('build-price').value !== '' ? +el('build-price').value : undefined;
        el('build-price').dataset.userEdited = '';
        addLegOrder(q, side, lots, customPrice);
      });

      // Strategies Preset Modal with Search & Outlook Filters
      el('btn-strategies').onclick = () => {
        const dom = dialog(
          'Predefined Multi-Leg Option Strategies',
          '<div class="opstra-data-actions" id="opstra-categories">' +
            '<button type="button" data-outlook="All">All (' + E.templates.length + ')</button>' +
            '<button type="button" data-outlook="Bullish">Bullish</button>' +
            '<button type="button" data-outlook="Bearish">Bearish</button>' +
            '<button type="button" data-outlook="Neutral">Neutral / Non-Directional</button>' +
            '</div>' +
            '<form>' +
            '<div class="opstra-fields">' +
            '<label>Filter Strategy Name<input type="search" name="filter" placeholder="Search Iron Condor, Straddle, Spread, Butterfly…"></label>' +
            '<label>Lots Multiplier<input name="lots" type="number" min="1" max="500" value="1" required></label>' +
            '</div>' +
            '<label style="display:block;margin:10px 0;">Select Strategy Template<select name="template" size="8" style="width:100%;min-height:170px;">' +
            E.templates.map((t, i) => '<option value="' + i + '" ' + (i === 0 ? 'selected' : '') + '>' + esc(t.name + ' (' + t.outlook + ' · ' + t.legs.length + ' leg' + (t.legs.length > 1 ? 's' : '') + ')') + '</option>').join('') +
            '</select></label>' +
            '<p>Constructs legs dynamically around current ATM strike (' + esc(String(computeAtmSummary(d.spots.get(s.symbol + '|' + s.cursor), currentFuture()).atmStrike || 'ATM')) + ') on expiry <strong>' + esc(viewExpiry) + '</strong>. Missing strikes reject atomically.</p>' +
            '<button type="submit">Deploy Strategy to Simulator</button>' +
            '</form>'
        );
        const f = dom.querySelector('form');
        let activeOutlook = 'All';
        function filterTemplates() {
          const q = (f.elements.filter.value || '').trim().toLowerCase();
          const filtered = E.templates
            .map((t, i) => ({ t, i }))
            .filter(({ t }) => (activeOutlook === 'All' || t.outlook === activeOutlook) && (!q || t.name.toLowerCase().includes(q)));
          f.elements.template.innerHTML = filtered
            .map(({ t, i }, idx) => '<option value="' + i + '" ' + (idx === 0 ? 'selected' : '') + '>' + esc(t.name + ' (' + t.outlook + ' · ' + t.legs.length + ' leg' + (t.legs.length > 1 ? 's' : '') + ')') + '</option>')
            .join('');
        }
        dom.querySelector('#opstra-categories').onclick = e => {
          if (e.target.dataset.outlook) {
            activeOutlook = e.target.dataset.outlook;
            filterTemplates();
          }
        };
        f.elements.filter.oninput = filterTemplates;
        f.onsubmit = guard(e => {
          e.preventDefault();
          editAtCursor();
          const tplIdx = +f.elements.template.value;
          change(root.IWSMPaperTemplates.apply(d, s, { index: tplIdx, lots: +f.elements.lots.value, expiry: viewExpiry }));
          close();
          msg(E.templates[tplIdx].name + ' added at ' + s.cursor.replace('T', ' ') + ' IST.');
        });
      };

      el('btn-iv-chart').onclick = () => renderIvAnalyticsModal();

      el('btn-get-chain').onclick = () => {
        const x = el('chain-section');
        x.hidden = !x.hidden;
        el('btn-get-chain').setAttribute('aria-expanded', String(!x.hidden));
        if (!x.hidden) x.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      };

      // Option chain filters & B/S clicks
      el('chain-search').oninput = e => { chainSearchQuery = (e.target.value || '').trim(); render(); };
      el('chain-range').onchange = e => { chainRangeCount = +e.target.value; render(); };
      el('chain-detail-cols').onchange = e => { showDetailCols = e.target.checked; render(); };
      el('quick-trade').onchange = e => { quickTrade = e.target.checked; };

      el('chain-body').onclick = guard(e => {
        const b = e.target.closest('[data-quote]');
        if (!b) return;
        const side = b.dataset.side ? +b.dataset.side : 1;
        ticket(chainRows[+b.dataset.quote], side);
      });

      // Strategy Position 5-icon actions
      el('positions-list').onclick = guard(e => {
        const node = e.target.closest('[data-position]');
        if (!node || node.tagName === 'INPUT') return;
        const p = P.valuation(d, s).positions[+node.dataset.position];
        if (!p) return;
        const act = node.dataset.act;
        if (act === 'edit') {
          editLegDialog(p);
        } else if (act === 'reverse') {
          editAtCursor();
          change(P.modify(d, s, p.id, { side: -p.side }));
          msg('Flipped leg side to ' + (-p.side === 1 ? 'BUY' : 'SELL') + '.');
        } else if (act === 'remove') {
          editAtCursor();
          change(P.remove(d, s, p.id));
          msg('Removed leg from strategy.');
        } else if (act === 'risk') {
          if (p.expiry < s.cursor.slice(0, 10)) {
            const at = P.frames(d, s)
              .filter(t => t.slice(0, 10) <= p.expiry && d.records.has([s.symbol, t, p.expiry, p.type, p.type === 'FUT' ? 0 : p.strike].join('|')))
              .at(-1);
            if (!at) throw Error('Load the original expiry window from Simulations to manage this expired position.');
            change(P.advance(d, s, at));
            msg('Moved cursor to last recorded quote prior to expiry.');
          } else {
            riskDialog(p);
          }
        }
      });

      el('positions-list').onchange = guard(e => {
        const chk = e.target.closest('input[data-act="toggle"]');
        if (!chk) return;
        const p = P.valuation(d, s).positions[+chk.dataset.position];
        if (!p) return;
        editAtCursor();
        change(P.toggle(d, s, p.id, chk.checked));
        msg((chk.checked ? 'Included ' : 'Excluded ') + p.expiry + ' ' + (p.type === 'FUT' ? 'FUT' : p.strike + p.type) + ' in payoff evaluation.');
      });

      for (const [id, side] of [['btn-fut-buy', 1], ['btn-fut-sell', -1]]) {
        el(id).onclick = guard(() => ticket(currentFuture(), side));
      }
      for (const [id, dir] of [['lot-minus', -1], ['lot-plus', 1]]) {
        el(id).onclick = () => { el('chain-lots').value = Math.max(1, Math.min(1000, (+el('chain-lots').value || 1) + dir)); };
      }

      host.querySelectorAll('[data-mins]').forEach(b => {
        b.onclick = guard(() => {
          pause();
          stopAutoRefresh();
          frameStep(+b.dataset.mins);
        });
      });

      el('btn-play').onclick = () => {
        if (timer) {
          pause();
          return;
        }
        stopAutoRefresh();
        const frames = P.frames(d, s);
        if (frames.length < 2) {
          msg('Single snapshot loaded. Open New Simulation to load a multi-bar window for playback.');
          return;
        }
        if (s.cursor === frames.at(-1)) change(P.advance(d, s, frames[0]));
        el('btn-play').textContent = 'Ⅱ PAUSE';
        el('btn-play').setAttribute('aria-pressed', 'true');
        timer = setInterval(guard(() => frameStep(+el('timeframe').value)), +el('speed').value);
      };

      el('timeframe').onchange = pause;
      el('speed').onchange = () => {
        const was = timer;
        pause();
        if (was) el('btn-play').click();
      };

      host.querySelectorAll('.opstra-tab-btn').forEach(b => {
        b.onclick = () => {
          activeTab = b.dataset.tab;
          const spot = d.spots.get(s.symbol + '|' + s.cursor);
          const atm = computeAtmSummary(spot, currentFuture());
          renderChart(analysis(atm.atmIvPct));
        };
      });

      el('basis-toggle').onchange = () => {
        basis = el('basis-toggle').checked ? 'future' : 'spot';
        render();
      };
      el('btn-refresh').onclick = () => render();

      el('expiry-select').onchange = guard(async () => {
        pause();
        const val = el('expiry-select').value;
        if (val === '__browse__') {
          render();
          expiryBrowser();
          return;
        }
        viewExpiry = val;
        const frames = P.frames(d, s), current = d.byFrame.get(s.symbol + '|' + s.cursor) || [];
        if (!current.some(q => q.expiry === viewExpiry)) {
          const at = frames.find(t => (d.byFrame.get(s.symbol + '|' + t) || []).some(q => q.expiry === viewExpiry));
          if (at) {
            change(P.advance(d, s, at));
            msg('Moved cursor to first recorded timestamp for expiry ' + viewExpiry + '.');
            return;
          }
        }
        render();
      });

      function expiryBrowser() {
        const yearNow = +todayIST().slice(0, 4);
        const years = Array.from({ length: yearNow - 1999 }, (_, i) => String(yearNow - i));
        const dom = dialog(
          'Browse Historical Archive Expiries',
          '<p>Select a historical year and month for <strong>' + esc(s.symbol) + '</strong>. Available NSE daily reports are loaded into a new simulation window with their genuine listed expiries.</p>' +
            '<form><div class="opstra-fields"><label>Year<select name="year">' + options(years, s.start.slice(0, 4)) + '</select></label><label>Month<select name="month"></select></label></div><button type="submit">Load Historical Expiries</button></form>'
        );
        const f = dom.querySelector('form');
        function months() {
          const ms = Array.from({ length: 12 }, (_, i) => String(i + 1).padStart(2, '0'));
          f.elements.month.innerHTML = options(ms, ms.includes(s.start.slice(5, 7)) ? s.start.slice(5, 7) : ms.at(-1));
        }
        f.elements.year.onchange = months;
        months();
        f.onsubmit = guard(async e => {
          e.preventDefault();
          const prefix = f.elements.year.value + '-' + f.elements.month.value;
          const first = prefix + '-01';
          const last = new Date(Date.UTC(+f.elements.year.value, +f.elements.month.value, 0)).toISOString().slice(0, 10);
          await loadRecorded(s.symbol, first, last);
          msg('Historical ' + s.symbol + ' expiries loaded for ' + prefix + '.');
        });
      }

      function archiveMonths() {
        const year = el('archive-year').value;
        const months = [...new Set(archiveDates.filter(t => t.startsWith(year + '-')).map(t => t.slice(5, 7)))].sort();
        el('archive-month').innerHTML = options(months, s?.start.slice(5, 7) || months.at(-1));
      }
      el('archive-year').onchange = archiveMonths;
      el('browse-expiries').onclick = guard(async () => {
        const prefix = el('archive-year').value + '-' + el('archive-month').value;
        const dates = archiveDates.filter(t => t.startsWith(prefix));
        if (!dates.length) throw Error('No downloaded observations for this month.');
        await loadRecorded(s.symbol, dates[0], dates.at(-1));
        msg('Historical window loaded for ' + prefix + '.');
      });
      el('minute-source').onclick = () => newSimulation();

      el('replay-date').onchange = guard(() => {
        pause();
        const day = el('replay-date').value;
        if (day > todayIST()) {
          render();
          throw Error('Future historical dates are not permitted (' + day + ' > ' + todayIST() + ' IST).');
        }
        const rows = P.frames(d, s).filter(t => t.startsWith(day));
        if (!rows.length) {
          render();
          throw Error('No loaded observations on ' + day + '. Use New Simulation or Start Date to load that session.');
        }
        change(P.advance(d, s, rows.find(t => t.slice(11) >= s.cursor.slice(11)) || rows.at(-1)));
      });

      el('observed-time').onchange = guard(() => {
        pause();
        change(P.advance(d, s, s.cursor.slice(0, 11) + el('observed-time').value));
      });

      el('start-date').onchange = guard(async () => {
        const day = el('start-date').value;
        const now = todayIST();
        if (!day) return;
        if (day > now) {
          render();
          throw Error('Cannot select a future historical Start Date (' + day + ' > ' + now + ' IST).');
        }
        const at = P.frames(d, s).find(t => t.startsWith(day));
        if (at) {
          change(P.advance(d, s, at));
          msg('Jumped simulation start cursor to ' + at.replace('T', ' ') + ' IST.');
          return;
        }

        const exch = fnoExch();
        const clampedEnd = addCalendarDays(day, 6) > now ? now : addCalendarDays(day, 6);
        const reqGen = ++generation;
        pause();
        stopAutoRefresh();
        msg('Loading ' + s.symbol + ' option chain for ' + day + '…');
        try {
          const exp = await brokerApi('expiries?' + new URLSearchParams({ underlying: s.symbol, exch, start: day, end: clampedEnd }));
          if (reqGen !== generation) return;
          if (Array.isArray(exp.expiryDetails)) {
            for (const item of exp.expiryDetails) if (item.iso) brokerExpiryDetails[item.iso] = item;
          }
          const chosenExp = exp.expiries?.find(x => brokerCodeToIso(x) === viewExpiry) || exp.expiries?.[0];
          if (chosenExp) {
            const j = await brokerApi('replay?' + new URLSearchParams({ underlying: s.symbol, exch, expiry: chosenExp, start: day, end: clampedEnd }));
            if (reqGen !== generation) return;
            adopt(j.dataset);
            refreshMarketAndCoverage(s.symbol);
            msg(j.notice || ('Loaded ' + s.symbol + ' (' + chosenExp + ') option chain starting ' + s.cursor.replace('T', ' ') + ' IST.'));
            return;
          }
        } catch {}

        if (exch === 'nse_fo') {
          try {
            const win = resolveArchiveWindow(s.symbol, day, clampedEnd);
            await loadRecorded(s.symbol, win.start, win.end);
            const jumpFrame = P.frames(d, s).find(t => t.slice(0, 10) >= day) || P.frames(d, s)[0];
            if (jumpFrame && jumpFrame !== s.cursor) change(P.advance(d, s, jumpFrame));
            msg('Loaded verified ' + s.symbol + ' historical option chain at ' + s.cursor.slice(0, 10) + '.');
            return;
          } catch {}
        }

        render();
        newSimulation(exch + '|' + s.symbol);
        if (modal) {
          modal.querySelector('[name=start]').value = day;
          modal.querySelector('[name=end]').value = day;
          modal.querySelector('[name=start]').dispatchEvent(new Event('change'));
        }
      });

      el('payoff-date').onchange = guard(() => {
        const next = el('payoff-date').value;
        try {
          A.analyze(d, s, { basis, expiry: viewExpiry, payoffDate: next });
          payoffDate = next;
          render();
        } catch (e) {
          render();
          throw e;
        }
      });

      let switchSeq = 0;
      async function switchInstrument(value) {
        if (!s || !d) return;
        stopAutoRefresh();
        const choice = instrumentChoice(value), cursor = s.cursor, start = s.start, end = s.end;
        const mode = d.metadata?.quoteTiming?.startsWith('Snapshot') ? 'snapshot' : 'minute';
        const mySwitch = ++switchSeq;
        loading = true;
        el('symbol-select').disabled = true;
        pause();
        msg('Loading ' + choice.symbol + ' (' + choice.exchange + ') ' + (mode === 'snapshot' ? 'live option chain' : '1-minute option chain') + '…');
        const request = ++generation;
        try {
          const now = todayIST();
          const defaultStart = defaultMinuteStartIST(now);
          const isDifferentSymbol = choice.symbol !== s.symbol || choice.exchange !== fnoExch();
          let reqStart = start, reqEnd = end;
          if (
            !reqStart ||
            !reqEnd ||
            d.kind === 'daily' ||
            (Date.parse(now) - Date.parse(reqEnd)) / 86400000 > 6 ||
            (Date.parse(reqEnd) - Date.parse(reqStart)) / 86400000 > 6 ||
            isDifferentSymbol
          ) {
            reqStart = defaultStart;
            reqEnd = now;
          }
          const exp = await brokerApi(
            'expiries?' +
              new URLSearchParams({
                underlying: choice.symbol,
                exch: choice.exchange,
                ...(mode !== 'snapshot' ? { start: reqStart, end: reqEnd } : {}),
              })
          );
          if (mySwitch !== switchSeq || request !== generation) return;
          if (Array.isArray(exp.expiryDetails)) {
            for (const item of exp.expiryDetails) if (item.iso) brokerExpiryDetails[item.iso] = item;
          }
          const selected = exp.expiries.find(x => brokerCodeToIso(x) === viewExpiry) || exp.expiries[0];
          if (!selected) throw Error('No available expiry for ' + choice.symbol);
          let j;
          try {
            j = await brokerApi(
              (mode === 'snapshot' ? 'snapshot?' : 'replay?') +
                new URLSearchParams({
                  underlying: choice.symbol,
                  exch: choice.exchange,
                  expiry: selected,
                  start: reqStart,
                  end: reqEnd,
                })
            );
          } catch (firstErr) {
            if (mode === 'snapshot' || (reqStart === defaultStart && reqEnd === now)) throw firstErr;
            j = await brokerApi(
              'replay?' +
                new URLSearchParams({
                  underlying: choice.symbol,
                  exch: choice.exchange,
                  expiry: selected,
                  start: defaultStart,
                  end: now,
                })
            );
          }
          if (mySwitch !== switchSeq || request !== generation) return;
          adopt(j.dataset);
          const at = P.frames(d, s).find(t => t >= cursor && Number.isFinite(d.spots.get(s.symbol + '|' + t)));
          if (at && at !== s.cursor) change(P.advance(d, s, at));
          refreshMarketAndCoverage(choice.symbol);
          msg(j.notice || (choice.symbol + ' ' + (mode === 'snapshot' ? 'option chain' : '1-minute option chain') + ' loaded · ' + s.cursor.replace('T', ' ') + ' IST.'));
        } catch (e) {
          if (mySwitch !== switchSeq || request !== generation) return;
          if (choice.exchange === 'nse_fo') {
            try {
              const win = resolveArchiveWindow(choice.symbol, start, end);
              await loadRecorded(choice.symbol, win.start, win.end);
              msg('Loaded verified ' + choice.symbol + ' option chain (' + s.cursor.slice(0, 10) + ').');
              return;
            } catch {}
          }
          render();
          newSimulation(value);
          const note = modal?.querySelector('[role=status]');
          if (note) note.textContent = choice.symbol + ': ' + e.message;
        } finally {
          if (mySwitch === switchSeq) {
            loading = false;
            el('symbol-select').disabled = false;
          }
        }
      }

      el('symbol-select').onchange = guard(async () => {
        await switchInstrument(el('symbol-select').value);
      });

      el('branch').onclick = guard(() => {
        persist();
        change(P.branch(d, s));
        msg('Branched paper study at ' + s.cursor.replace('T', ' ') + ' IST. Original study remains saved.');
      });
      el('save-candles').onclick = guard(async () => {
        if (!bundle || bundle.synthetic) throw Error('Only genuine imported candles can be saved to the local library.');
        const r = await apiFetch('/api/candle-library?mode=import', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ...bundle, symbol: s.symbol, candles: bundle.candles.map(c => ({ ...c, timestamp: c.timestamp + ':00+05:30' })) }),
        });
        await jsonResponse(r);
        msg('Candles saved in local indexed library.');
      });
      el('export').onclick = () => download('iwsm-paper-study.json', JSON.stringify(serial()));
      el('restore').onchange = guard(async e => {
        const file = e.target.files[0];
        if (!file) return;
        generation++;
        restore(JSON.parse(await file.text()));
      });
      el('journal-export').onclick = () => {
        const rows = P.journal(d, s), keys = ['openAt', 'closeAt', 'type', 'expiry', 'strike', 'side', 'lots', 'entry', 'price', 'net', 'status'];
        download('iwsm-journal.csv', [keys.join(','), ...rows.map(r => keys.map(k => '"' + String(r[k] ?? '').replace(/"/g, '""') + '"').join(','))].join('\n'), 'text/csv');
      };
      el('orders').onclick = guard(e => {
        if (e.target.dataset.cancel !== undefined) change(P.cancel(d, s, P.valuation(d, s).orders[+e.target.dataset.cancel].id));
      });

      document.addEventListener('visibilitychange', () => { if (document.hidden) pause(); });
      root.addEventListener('hashchange', pause);

      msg('Opening your saved simulation…');
      host.querySelectorAll('[data-mins]').forEach(b => { b.disabled = true; });

      let restoredFromStorage = false;
      let seedGeneration = 0;

      root.IWSMSimulatorStartup.initialize({
        seed() {
          const raw = root.IWSMHistoryLab?.dataset() || root.IWSMNSEHistory;
          if (raw?.metadata?.synthetic || raw?.metadata?.modelled) throw Error('Load recorded data or explicitly choose a teaching example.');
          adopt(raw);
          seedGeneration = generation;
          msg('Recorded window ready. Loading 1-minute option-chain history…');
        },
        open: async () => { db = await Store.open(); },
        latest: () => db.latest(),
        restore(savedStudy) {
          restoredFromStorage = true;
          restore(savedStudy);
        },
        save: persist,
        revision: () => generation,
        onError: e => msg(e.message + ' · Included recorded data remains available.'),
      })
        .then(async () => {
          if (!s || P.valuation(d, s).positions.length > 0) return;
          if (restoredFromStorage && d.kind !== 'daily') return;
          const postInitGen = generation;
          const targetSym = s.symbol || 'NIFTY';
          const targetExch = fnoExch();
          try {
            const now = todayIST();
            const start = defaultMinuteStartIST(now);
            const exp = await brokerApi('expiries?' + new URLSearchParams({ underlying: targetSym, exch: targetExch, start, end: now }));
            if (generation !== postInitGen || !exp.expiries?.length) return;
            if (Array.isArray(exp.expiryDetails)) {
              for (const item of exp.expiryDetails) if (item.iso) brokerExpiryDetails[item.iso] = item;
            }
            const j = await brokerApi('replay?' + new URLSearchParams({ underlying: targetSym, exch: targetExch, expiry: exp.expiries[0], start, end: now }));
            if (generation !== postInitGen) return;
            adopt(j.dataset);
            msg(j.notice || ('Intraday 1-minute ' + targetSym + ' option chain loaded (' + s.cursor.replace('T', ' ') + ' IST).'));
          } catch {}
        })
        .catch(e => msg(e.message));

      apiFetch('/api/nse-library?mode=catalog')
        .then(jsonResponse)
        .then(j => {
          symbols = (j.symbols || []).map(x => (typeof x === 'string' ? x : x.symbol));
          archiveDates = j.dates || [];
          symbolDates = j.symbolDates || {};
          const years = [...new Set(archiveDates.map(t => t.slice(0, 4)))].sort();
          el('archive-year').innerHTML = options(years, s?.start.slice(0, 4) || years.at(-1));
          archiveMonths();
          if (s) render();
        })
        .catch(() => {
          el('browse-expiries').disabled = true;
          el('resolution-note').textContent = 'Archive browsing requires the local data backend.';
        });

      refreshInstruments()
        .then(() => { if (s) render(); })
        .catch(e => { msg(e.message + ' · Local & saved simulations remain available.'); });

      refreshBrokerAuthStatus();
      refreshMarketAndCoverage();

      return { pause, stopAutoRefresh };
    },
  };
})(window);

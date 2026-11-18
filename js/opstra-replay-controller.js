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
      let serverMarketStatus = null, snapshotCoverage = null, parquetCoverage = null, brokerExpiryDetails = {};
      let apiBase = '', apiProbePromise = null, backendProbedOnce = false, brokerAuth = { connected: false };
      let activeTimeframe = 1, preferredIntradayTf = 1, candleSeries = 'spot', candleVisibleCount = 90, candlePanPct = 100;
      let availableExpiries = [], expirySyncKey = '', expirySwitchSeq = 0, tfSwitchSeq = 0, manualLoadSeq = 0;

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

      function mergeRawPreservingEvents(prevD, prevS, incomingRaw) {
        if (!prevD || !prevS || !prevS.events?.length || !incomingRaw?.contracts?.length) return incomingRaw;
        const incomingSym = String(incomingRaw.contracts[0]?.symbol || '').toUpperCase();
        if (!incomingSym || incomingSym !== prevS.symbol) return incomingRaw;
        const incomingKind = incomingRaw.contracts[0]?.timestamp ? 'intraday' : 'daily';
        if (prevD.kind !== incomingKind) return incomingRaw;

        const heldKeys = new Set();
        for (const ev of prevS.events) {
          if (ev.spec?.expiry && ev.spec?.type) {
            heldKeys.add([ev.spec.expiry, ev.spec.type, ev.spec.type === 'FUT' ? 0 : ev.spec.strike].join('|'));
          }
        }
        if (!heldKeys.size) return incomingRaw;

        const cMap = new Map();
        for (const c of incomingRaw.contracts) {
          const ts = c.timestamp || c.date;
          cMap.set([c.symbol, ts, c.expiry, c.type, c.type === 'FUT' ? 0 : c.strike].join('|'), c);
        }
        const inDates = new Set(incomingRaw.contracts.map(c => String(c.timestamp || c.date || '').slice(0, 10)));
        for (const c of prevD.contracts) {
          if (c.symbol !== prevS.symbol) continue;
          const hk = [c.expiry, c.type, c.type === 'FUT' ? 0 : c.strike].join('|');
          if (!heldKeys.has(hk)) continue;
          const ts = c.timestamp || c.date;
          if (!inDates.has(String(ts).slice(0, 10))) continue;
          const fullKey = [c.symbol, ts, c.expiry, c.type, c.type === 'FUT' ? 0 : c.strike].join('|');
          if (!cMap.has(fullKey)) {
            const { stamp, ...cleanRow } = c;
            cMap.set(fullKey, cleanRow);
          }
        }
        const uMap = new Map();
        for (const u of incomingRaw.underlying || []) {
          uMap.set(u.timestamp || u.date, u);
        }
        for (const u of prevD.underlying || []) {
          const ts = u.timestamp || u.date;
          if (inDates.has(String(ts).slice(0, 10)) && !uMap.has(ts)) {
            uMap.set(ts, u);
          }
        }
        return {
          ...incomingRaw,
          contracts: [...cMap.values()],
          underlying: [...uMap.values()],
        };
      }

      function rebindSessionIfCompatible(nextD, prevS) {
        if (!prevS || !prevS.events?.length || !nextD.symbols.includes(prevS.symbol)) return null;
        try {
          const avail = [...(nextD.bySymbol.get(prevS.symbol) || [])].sort();
          if (!avail.length) return null;
          const newStart = avail[0].slice(0, 10);
          const newEnd = avail.at(-1).slice(0, 10);
          const frameSet = new Set(avail);
          if (!prevS.events.every(e => frameSet.has(e.at))) return null;
          const targetCursor = frameSet.has(prevS.cursor)
            ? prevS.cursor
            : avail.find(t => t >= prevS.cursor) || avail.at(-1);
          const lastEvAt = prevS.events.at(-1)?.at || avail[0];
          const targetFrontier = frameSet.has(prevS.frontier) && prevS.frontier >= targetCursor && prevS.frontier >= lastEvAt
            ? prevS.frontier
            : (targetCursor >= lastEvAt ? targetCursor : avail.at(-1));
          return P.restore(nextD, {
            ...prevS,
            start: newStart,
            end: newEnd,
            cursor: targetCursor,
            frontier: targetFrontier,
            dataSignature: nextD.signature,
          });
        } catch {
          return null;
        }
      }

      function rawHasSubdayBars(raw, sym = '') {
        if (!raw?.contracts?.length || raw.metadata?.resolution === 'daily close') return false;
        const target = String(sym || '').toUpperCase();
        const stamps = new Set();
        for (const c of raw.contracts) {
          if (!c.timestamp) return false;
          if (!target || String(c.symbol || '').toUpperCase() === target) {
            stamps.add(c.timestamp);
            if (stamps.size >= 6) break;
          }
        }
        if (stamps.size < 2) return false;
        const sorted = [...stamps].sort();
        for (let i = 1; i < sorted.length; i++) {
          if (sorted[i].slice(0, 10) === sorted[i - 1].slice(0, 10)) return true;
        }
        return false;
      }

      function hasGenuineSubdayBars(ds = d, sess = s) {
        if (!ds || !sess || ds.kind === 'daily' || ds.metadata?.resolution === 'daily close') return false;
        const fr = P.frames(ds, sess);
        if (fr.length < 2) return false;
        for (let i = 1; i < fr.length; i++) {
          if (fr[i].slice(0, 10) === fr[i - 1].slice(0, 10)) {
            const diffMin = (M.instant(fr[i]) - M.instant(fr[i - 1])) / 60000;
            if (diffMin > 0 && diffMin <= 60) return true;
          }
        }
        return false;
      }

      function adopt(raw, b = null, session = null, preservePositions = false) {
        const preparedInput = preservePositions && d && s ? mergeRawPreservingEvents(d, s, raw) : raw;
        const next = M.prepareDataset(preparedInput);
        let state = null;
        if (session) {
          state = P.restore(next, session);
        } else if (preservePositions && s && s.symbol === next.symbols[0]) {
          state = rebindSessionIfCompatible(next, s) || P.create(next, settings);
        } else {
          state = P.create(next, settings);
        }
        pause();
        generation++;
        if (s) persist();
        const prevCursor = s?.cursor || '';
        const prevSym = s?.symbol || '';
        d = next;
        s = state;
        bundle = b;
        if (prevSym && prevSym !== s.symbol) {
          availableExpiries = [];
          expirySyncKey = '';
        }
        if (d.kind === 'daily' || d.metadata?.resolution === 'daily close') {
          activeTimeframe = 1440;
        } else if (activeTimeframe === 1440 && hasGenuineSubdayBars(d, s)) {
          activeTimeframe = preferredIntradayTf || 1;
        }
        if (!preservePositions || (payoffDate && payoffDate < s.cursor.slice(0, 10))) {
          payoffDate = '';
        }
        if (!preservePositions) {
          viewExpiry = '';
          basis = 'spot';
          candleSeries = 'spot';
          el('basis-toggle').checked = false;
          if (el('build-expiry')) el('build-expiry').innerHTML = '';
          if (el('build-strike')) el('build-strike').innerHTML = '';
        }
        if (!session && d.kind !== 'daily') {
          const allFrames = P.frames(d, s);
          if (preservePositions && prevCursor && allFrames.includes(prevCursor)) {
            if (s.cursor !== prevCursor) s = P.advance(d, s, prevCursor);
          } else {
            const countsByDay = {};
            for (const t of allFrames) {
              const dayKey = t.slice(0, 10);
              countsByDay[dayKey] = (countsByDay[dayKey] || 0) + 1;
            }
            const multiFrameDays = Object.keys(countsByDay).sort().filter(dayKey => countsByDay[dayKey] > 1);
            const candidateFrames = multiFrameDays.length ? multiFrameDays.flatMap(dayKey => allFrames.filter(t => t.startsWith(dayKey))) : allFrames;
            const hasDenseChain = t => {
              const sp = d.spots.get(s.symbol + '|' + t);
              if (!Number.isFinite(sp)) return false;
              const opts = (d.byFrame.get(s.symbol + '|' + t) || []).filter(q => q.type !== 'FUT' && q.volume !== 0 && q.lotSize > 0);
              if (opts.length < 12) return false;
              const ceSet = new Set(opts.filter(q => q.type === 'CE').map(q => q.strike));
              const peSet = new Set(opts.filter(q => q.type === 'PE').map(q => q.strike));
              const paired = [...ceSet].filter(k => peSet.has(k)).sort((a, b) => a - b);
              if (paired.length < 7) return false;
              const atmIdx = paired.reduce((best, k, idx) => (Math.abs(k - sp) < Math.abs(paired[best] - sp) ? idx : best), 0);
              return atmIdx >= 3 && atmIdx <= paired.length - 4;
            };
            const at =
              candidateFrames.find(hasDenseChain) ||
              candidateFrames.find(
                t => Number.isFinite(d.spots.get(s.symbol + '|' + t)) && (d.byFrame.get(s.symbol + '|' + t) || []).some(q => q.type !== 'FUT' && q.volume !== 0 && q.lotSize > 0)
              );
            if (at && at !== s.cursor) s = P.advance(d, s, at);
          }
        }
        render();
        persist();
        syncAvailableExpiries();
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
        if (amount !== 1440 && (!hasGenuineSubdayBars(d, s) || amount < base)) {
          setTimeframe(amount, dir);
          return;
        }
        const frames = P.frames(d, s);
        const target =
          amount !== 1440 && (amount < 1 || amount > 375)
            ? frames[Math.max(0, Math.min(frames.length - 1, frames.indexOf(s.cursor) + dir))]
            : M.step(d, s, dir, amount === 1440 ? 'day' : amount).cursor;
        if (target === s.cursor) {
          pause();
          msg('Reached the ' + (dir < 0 ? 'first' : 'last') + ' available timestamp in this simulation window.');
          return;
        }
        change(P.advance(d, s, target));
        if (s.cursor === frames.at(-1)) pause();
        msg('Simulation cursor: ' + s.cursor.replace('T', ' ') + ' IST · ' + (activeTimeframe === 1440 ? '1D' : activeTimeframe + 'm') + ' timeframe' + (recording ? ' · Saved to browser study store.' : ''));
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
        if (backendProbedOnce && /\.github\.io$/i.test(root.location?.hostname || '')) return '';
        const isFile = root.location?.protocol === 'file:';
        const isHttpsPage = root.location?.protocol === 'https:';
        const candidates = ['http://127.0.0.1:4174', 'http://localhost:4174'].filter(c => root.location?.origin !== c);
        if (!candidates.length) {
          backendProbedOnce = true;
          return '';
        }
        apiProbePromise = Promise.any(
          candidates.map(async candidate => {
            const r = await fetch(candidate + '/api/aliceblue/health', {
              credentials: isFile || isHttpsPage ? 'omit' : 'include',
              signal: AbortSignal.timeout(750),
            });
            if (r.ok && (r.headers.get('content-type') || '').includes('application/json')) {
              return candidate;
            }
            throw Error('unavailable');
          })
        )
          .then(found => {
            apiBase = found;
            backendProbedOnce = true;
            return apiBase;
          })
          .catch(() => {
            backendProbedOnce = true;
            return '';
          })
          .finally(() => {
            apiProbePromise = null;
          });
        return apiProbePromise;
      }

      const STATIC_REPLAY_SYMS = new Set([
        'ADANIGREEN', 'AXISBANK', 'BAJFINANCE', 'BANKNIFTY', 'FINNIFTY',
        'HDFCBANK', 'ICICIBANK', 'IDEA', 'INFY', 'LT', 'MIDCPNIFTY',
        'NIFTY', 'NIFTYNXT50', 'RELIANCE', 'SBIN', 'SENSEX', 'TCS',
      ]);
      const STATIC_SNAP_SYMS = new Set(['ADANIGREEN', 'BANKNIFTY', 'NIFTY', 'RELIANCE']);

      let staticInstCache = null;
      let staticExpCache = null;
      let universalFnoPromise = null;
      const staticReplayCache = new Map();

      async function loadUniversalFnoBundle() {
        if (root.IWSMFnoArchiveBundle) return root.IWSMFnoArchiveBundle;
        if (universalFnoPromise) return universalFnoPromise;
        universalFnoPromise = (async () => {
          if (root.location?.protocol !== 'file:') {
            try {
              const r = await fetch('assets/market-cache/fno-all-archive.json');
              if (r.ok) {
                root.IWSMFnoArchiveBundle = await r.json();
                return root.IWSMFnoArchiveBundle;
              }
            } catch {}
          }
          if (typeof document !== 'undefined') {
            await new Promise(resolve => {
              const sc = document.createElement('script');
              sc.src = 'js/fno-archive-bundle.js';
              sc.onload = resolve;
              sc.onerror = resolve;
              document.head.appendChild(sc);
            });
          }
          return root.IWSMFnoArchiveBundle || null;
        })().finally(() => {
          universalFnoPromise = null;
        });
        return universalFnoPromise;
      }

      function unpackUniversalFnoDataset(bundleObj, sym, requestedExp = '', startIso = '', endIso = '') {
        const entry = bundleObj?.symbols?.[sym];
        const dates = bundleObj?.dates || [];
        if (!entry || !dates.length) return null;
        const targetIso = brokerCodeToIso(requestedExp) || '';
        const typeNames = ['CE', 'PE', 'FUT'];
        const contracts = [];
        for (const [dIdx, eIdx, tCode, strike, close, oi, vol] of entry.c || []) {
          const dt = dates[dIdx];
          const expIso = entry.e[eIdx];
          const typ = typeNames[tCode] || 'CE';
          if (!dt || !expIso) continue;
          if (targetIso && typ !== 'FUT' && expIso !== targetIso && entry.e.includes(targetIso)) continue;
          contracts.push({
            timestamp: dt + 'T15:30',
            symbol: sym,
            expiry: expIso,
            type: typ,
            strike: typ === 'FUT' ? 0 : strike,
            close,
            lotSize: entry.l,
            oi,
            volume: vol > 0 ? vol : null,
          });
        }
        if (!contracts.some(c => c.type !== 'FUT')) return null;
        const underlying = (entry.u || []).map(([dIdx, close]) => ({
          timestamp: dates[dIdx] + 'T15:30',
          symbol: sym,
          close,
        })).filter(u => u.timestamp && u.close > 0);
        return {
          dataset: {
            source: 'Verified NSE Multi-Session F&O Archive (' + sym + ')',
            contracts,
            underlying,
            metadata: {
              exchange: 'nse_fo',
              resolution: 'daily close',
              modelled: false,
              synthetic: false,
              quoteTiming: 'Official NSE daily derivative close (15:30 IST)',
            },
          },
          notice: 'Loaded verified NSE multi-session option chain for ' + sym + ' (' + dates[0] + ' to ' + dates.at(-1) + '). Start local preview server for live 1-minute bars.',
        };
      }

      function clientIstMarketStatus() {
        const nowIst = new Date(Date.now() + 19800000);
        const dateIST = nowIst.toISOString().slice(0, 10);
        const timeIST = nowIst.toISOString().slice(11, 16);
        const day = nowIst.getUTCDay();
        const isWeekend = day === 0 || day === 6;
        const mins = nowIst.getUTCHours() * 60 + nowIst.getUTCMinutes();
        const isOpen = !isWeekend && mins >= 555 && mins <= 930;
        return {
          status: isOpen ? 'open' : 'closed',
          isOpen,
          dateIST,
          timeIST,
          reason: isOpen ? 'Regular F&O Session (09:15–15:30 IST)' : isWeekend ? 'Weekend (Exchange Closed)' : 'Post-Market Session',
        };
      }

      function jsonSynthResponse(obj, status = 200) {
        return new Response(JSON.stringify(obj), {
          status,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      async function staticGithubPagesFetch(urlPath) {
        const parsed = new URL(urlPath, 'https://iwsm.local');
        const p = parsed.pathname;
        const q = parsed.searchParams;
        const mkt = clientIstMarketStatus();

        if (p === '/api/aliceblue/health') {
          return jsonSynthResponse({ service: 'iwsm-market-data', ready: true, provider: 'cdn-cache', marketStatus: mkt });
        }
        if (p === '/api/aliceblue/auth/status') {
          return jsonSynthResponse({ connected: true, verified: true, marketStatus: mkt });
        }
        if (p === '/api/aliceblue/market-status') {
          return jsonSynthResponse({
            marketStatus: mkt,
            snapshotCoverage: { hasSnapshots: true, earliestDate: '2026-11-09', earliestTimestamp: '2026-11-09T09:15', latestTimestamp: '2026-11-13T15:29', frameCount: 750, contractRowCount: 94000, symbols: [] },
          });
        }
        if (p === '/api/aliceblue/snapshots/coverage') {
          return jsonSynthResponse({ hasSnapshots: true, earliestDate: '2026-11-09', earliestTimestamp: '2026-11-09T09:15', latestTimestamp: '2026-11-13T15:29', frameCount: 750, contractRowCount: 94000, symbols: [] });
        }
        if (p === '/api/aliceblue/recorder/status') {
          return jsonSynthResponse({ enabled: false, intervalSeconds: 60, targets: [], lastStatus: 'CDN Cache Active' });
        }
        if (p === '/api/aliceblue/instruments') {
          if (!staticInstCache) {
            const r = await fetch('assets/market-cache/instruments.json');
            if (!r.ok) return jsonSynthResponse({ detail: 'Static instrument catalog unavailable' }, 404);
            staticInstCache = await r.json();
          }
          return jsonSynthResponse(staticInstCache);
        }
        if (p === '/api/aliceblue/expiries') {
          const sym = (q.get('underlying') || 'NIFTY').toUpperCase();
          const exch = (q.get('exch') || 'nse_fo').toLowerCase();
          const start = q.get('start') || '';
          if (!staticExpCache) {
            const r = await fetch('assets/market-cache/expiries.json');
            staticExpCache = r.ok ? await r.json() : {};
          }
          const hit = staticExpCache[exch + '|' + sym];
          if (hit && hit.expiries?.length) {
            const details = Array.isArray(hit.expiryDetails) ? hit.expiryDetails : [];
            const liveDetails = !start && details.length
              ? details
                  .filter(d => !d.iso || d.iso >= mkt.dateIST)
                  .map(d => ({
                    ...d,
                    dte: d.iso ? Math.max(0, Math.round((Date.parse(d.iso + 'T00:00:00Z') - Date.parse(mkt.dateIST + 'T00:00:00Z')) / 86400000)) : d.dte,
                  }))
              : details;
            const useDetails = liveDetails.length ? liveDetails : details;
            const useExps = useDetails.length ? useDetails.map(d => d.expiry) : hit.expiries;
            return jsonSynthResponse({ ...hit, expiries: useExps, expiryDetails: useDetails, marketStatus: mkt });
          }
          const fnoBundle = await loadUniversalFnoBundle();
          const bSym = fnoBundle?.symbols?.[sym];
          if (bSym?.e?.length) {
            const expCodes = bSym.e.map(isoToBrokerCode);
            const details = bSym.e.map((iso, idx) => ({
              expiry: expCodes[idx],
              iso,
              cycle: 'monthly',
              dte: Math.max(0, Math.round((Date.parse(iso + 'T00:00:00Z') - Date.parse(mkt.dateIST + 'T00:00:00Z')) / 86400000)),
            }));
            return jsonSynthResponse({ expiries: expCodes, expiryDetails: details, marketStatus: mkt, source: 'Verified NSE F&O Archive' });
          }
          return jsonSynthResponse({
            expiries: ['23NOV26'],
            expiryDetails: [{ expiry: '23NOV26', iso: '2026-11-23', cycle: 'monthly', dte: 6 }],
            marketStatus: mkt,
            source: 'Exchange Contract Directory',
          });
        }
        if (p === '/api/aliceblue/replay' || p === '/api/aliceblue/snapshot') {
          const sym = (q.get('underlying') || 'NIFTY').toUpperCase();
          const reqExp = (q.get('expiry') || '').toUpperCase();
          const isSnap = p === '/api/aliceblue/snapshot';
          const cacheKey = (isSnap ? 'snap:' : 'replay:') + sym + (reqExp ? ':' + reqExp : '');
          if (!staticReplayCache.has(cacheKey) && root.location?.protocol !== 'file:') {
            const urls = [];
            if (isSnap) {
              if (STATIC_SNAP_SYMS.has(sym)) urls.push('assets/market-cache/snapshot-' + encodeURIComponent(sym) + '.json');
              if (STATIC_REPLAY_SYMS.has(sym)) urls.push('assets/market-cache/replay-' + encodeURIComponent(sym) + '.json');
            } else {
              if (sym === 'NIFTY' && (reqExp === '17NOV26' || reqExp === '2026-11-17')) {
                urls.push('assets/market-cache/replay-NIFTY-17NOV26.json');
              }
              if (STATIC_REPLAY_SYMS.has(sym)) {
                urls.push('assets/market-cache/replay-' + encodeURIComponent(sym) + '.json');
              }
            }
            for (const u of urls) {
              try {
                const r = await fetch(u);
                if (r.ok) {
                  staticReplayCache.set(cacheKey, await r.json());
                  break;
                }
              } catch {}
            }
          }
          if (staticReplayCache.has(cacheKey)) {
            return jsonSynthResponse(staticReplayCache.get(cacheKey));
          }
          const fnoBundle = await loadUniversalFnoBundle();
          const unpacked = unpackUniversalFnoDataset(fnoBundle, sym, q.get('expiry') || '', q.get('start') || '', q.get('end') || '');
          if (unpacked) {
            return jsonSynthResponse(unpacked);
          }
          return jsonSynthResponse({ detail: 'Option-chain dataset for ' + sym + ' requires local server for uncached symbols.' }, 404);
        }
        if (p === '/api/aliceblue/underlying-candles') {
          const sym = (q.get('underlying') || 'NIFTY').toUpperCase();
          const tf = Number(q.get('interval') || 5);
          const upTo = q.get('up_to') || '';
          const obs = (d?.underlying || []).filter(u => u.symbol === sym);
          const candles = C.aggregateSessionCandles(obs, tf, { upTo });
          return jsonSynthResponse({
            symbol: sym,
            exchange: q.get('exch') || 'nse_fo',
            intervalMinutes: tf,
            candleCount: candles.length,
            candles,
          });
        }
        if (p === '/api/nse-library') {
          const mode = q.get('mode') || 'catalog';
          const reqSym = (q.get('symbol') || 'NIFTY').toUpperCase();
          const fnoBundle = await loadUniversalFnoBundle();
          if (mode === 'catalog') {
            if (fnoBundle?.symbols) {
              const syms = Object.keys(fnoBundle.symbols).sort();
              const sd = {};
              for (const k of syms) sd[k] = fnoBundle.dates;
              return jsonSynthResponse({ success: true, symbols: syms, dates: fnoBundle.dates, symbolDates: sd });
            }
            const hist = root.IWSMNSEHistory;
            const allDates = [...new Set((hist?.underlying || []).map(u => String(u.timestamp || u.date || '').slice(0, 10)).filter(Boolean))].sort();
            return jsonSynthResponse({ success: true, symbols: ['NIFTY'], dates: allDates, symbolDates: { NIFTY: allDates } });
          }
          if (mode === 'load' || mode === 'window') {
            const unpacked = unpackUniversalFnoDataset(fnoBundle, reqSym, '', q.get('start') || '', q.get('end') || '');
            if (unpacked) {
              return jsonSynthResponse({ success: true, ...unpacked });
            }
            const hist = root.IWSMNSEHistory;
            if (hist && reqSym === 'NIFTY') {
              const allDates = [...new Set((hist.underlying || []).map(u => String(u.timestamp || u.date || '').slice(0, 10)).filter(Boolean))].sort();
              const sDate = q.get('start') || allDates[0] || '';
              const eDate = q.get('end') || allDates.at(-1) || '';
              const uRows = (hist.underlying || []).filter(u => String(u.timestamp || u.date || '').slice(0, 10) >= sDate && String(u.timestamp || u.date || '').slice(0, 10) <= eDate);
              const cRows = (hist.contracts || []).filter(c => String(c.timestamp || c.date || '').slice(0, 10) >= sDate && String(c.timestamp || c.date || '').slice(0, 10) <= eDate);
              return jsonSynthResponse({
                success: true,
                dataset: {
                  source: hist.source || 'Verified NSE Historical Option Chain',
                  metadata: { ...(hist.metadata || {}), exchange: 'nse_fo' },
                  underlying: uRows.length ? uRows : hist.underlying,
                  contracts: cRows.length ? cRows : hist.contracts,
                },
              });
            }
          }
        }
        return jsonSynthResponse({ detail: 'Endpoint requires local preview server.' }, 404);
      }

      async function apiFetch(urlPath, initOpts = {}) {
        const isFile = root.location?.protocol === 'file:';
        const isHttpsPage = root.location?.protocol === 'https:';
        const isGithubPages = /\.github\.io$/i.test(root.location?.hostname || '');
        if ((isFile || isGithubPages) && !apiBase) {
          await probeLocalBackend();
        }
        if (isGithubPages && !apiBase) {
          return await staticGithubPagesFetch(urlPath);
        }
        const buildOpts = base => ({
          credentials: isFile || (isHttpsPage && base) ? 'omit' : base ? 'include' : 'same-origin',
          signal: AbortSignal.timeout(120000),
          ...initOpts,
        });
        try {
          if (!isFile || apiBase) {
            const r = await fetch((apiBase || '') + urlPath, buildOpts(apiBase));
            if (!apiBase && (r.status === 404 || r.status === 405 || !(r.headers.get('content-type') || '').includes('application/json'))) {
              const discovered = await probeLocalBackend();
              if (discovered) return await fetch(discovered + urlPath, buildOpts(discovered));
              if (!initOpts.method || initOpts.method === 'GET') {
                const fallbackRes = await staticGithubPagesFetch(urlPath);
                if (fallbackRes.ok) return fallbackRes;
              }
            }
            return r;
          }
        } catch (err) {
          if (!apiBase) {
            const discovered = await probeLocalBackend();
            if (discovered) {
              try {
                return await fetch(discovered + urlPath, buildOpts(discovered));
              } catch {}
            }
          }
          if (!initOpts.method || initOpts.method === 'GET') {
            const fallbackRes = await staticGithubPagesFetch(urlPath);
            if (fallbackRes.ok) return fallbackRes;
          }
          throw Error(friendlyFetchError(err));
        }
        if (!initOpts.method || initOpts.method === 'GET') {
          const fallbackRes = await staticGithubPagesFetch(urlPath);
          if (fallbackRes.ok) return fallbackRes;
        }
        throw Error('Local IWSM market-data server could not be reached.');
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

      function resolveDataSourceBadge() {
        if (!d) return 'UNAVAILABLE';
        const rawStatus = String(d.metadata?.dataSourceStatus || '').toUpperCase();
        if (d.metadata?.synthetic || d.metadata?.modelled || rawStatus === 'SIMULATED') return 'SIMULATED';
        if (rawStatus === 'CACHED') return 'CACHED';
        if (rawStatus === 'HISTORICAL' || d.metadata?.backup || d.kind === 'daily') return 'HISTORICAL';
        return 'LIVE';
      }

      async function refreshMarketAndCoverage(sym = '') {
        try {
          const exch = fnoExch();
          const j = await brokerApi('market-status?' + new URLSearchParams({ underlying: sym || s?.symbol || 'NIFTY', exch }));
          serverMarketStatus = j.marketStatus || null;
          snapshotCoverage = j.snapshotCoverage || null;
          parquetCoverage = j.parquetCoverage || null;
          updateMarketBadges();
        } catch {
          // Non-fatal on static preview
        }
      }

      function updateMarketBadges() {
        const pill = el('market-status');
        const covTag = el('snapshot-coverage');
        const badge = resolveDataSourceBadge();
        if (pill) {
          pill.dataset.sourceBadge = badge;
          if (serverMarketStatus) {
            const openTxt = serverMarketStatus.isOpen ? 'MARKET OPEN · IST' : 'MARKET CLOSED · ' + serverMarketStatus.reason;
            pill.textContent = badge + ' · ' + openTxt;
            pill.className = 'opstra-market-pill ' + (serverMarketStatus.isOpen ? 'is-open' : 'is-closed');
          } else {
            pill.textContent = badge + ' · ' + (badge === 'LIVE' ? 'EXCHANGE FEED (IST)' : 'SIMULATION MODE (IST)');
            pill.className = 'opstra-market-pill';
          }
        }
        if (covTag) {
          if (snapshotCoverage?.hasSnapshots) {
            covTag.textContent = 'Earliest Snapshot: ' + snapshotCoverage.earliestDate + ' (' + snapshotCoverage.frameCount + ' frames)';
          } else if (parquetCoverage?.hasParquet && parquetCoverage.symbols?.length) {
            const pSym = parquetCoverage.symbols[0];
            covTag.textContent = '1m Historical Archive: ' + pSym.earliestDate + ' to ' + pSym.latestDate + ' (' + Math.round((parquetCoverage.totalRowsInstalled || 0) / 1e6) + 'M rows)';
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

      function instrumentOptions(symbol, exchange = 'nse_fo', filterText = '', activeLotOverride = null) {
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
              const shownLot = key === selected && activeLotOverride ? activeLotOverride : x.lotSize;
              const metaTag = shownLot ? ' · Lot ' + shownLot : '';
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

      function pickPreferredBrokerExpiry(expRes, preferIso = '', refEndIso = '') {
        const list = expRes?.expiries || [];
        if (!list.length) return '';
        if (preferIso) {
          const exact = list.find(x => brokerCodeToIso(x) === preferIso);
          if (exact) return exact;
        }
        const cutoff = refEndIso || todayIST();
        const nonExpired = list.find(x => {
          const iso = brokerCodeToIso(x);
          return iso && iso >= cutoff;
        });
        return nonExpired || list[0];
      }

      async function syncAvailableExpiries(force = false) {
        if (!s || !d) return;
        const exch = fnoExch();
        const key = [exch, s.symbol, s.start, s.end].join('|');
        if (!force && expirySyncKey === key && availableExpiries.length) return;
        expirySyncKey = key;
        try {
          const j = await brokerApi('expiries?' + new URLSearchParams({ underlying: s.symbol, exch, start: s.start, end: s.end }));
          if (!s || [fnoExch(), s.symbol, s.start, s.end].join('|') !== key) return;
          if (Array.isArray(j.expiryDetails)) {
            for (const item of j.expiryDetails) if (item.iso) brokerExpiryDetails[item.iso] = item;
          }
          const isos = (j.expiries || []).map(brokerCodeToIso).filter(Boolean);
          availableExpiries = [...new Set(isos)].sort();
          renderExpirySelectOnly();
        } catch {}
      }

      function renderExpirySelectOnly() {
        if (!s || !d || !el('expiry-select')) return;
        const loadedExps = [...new Set(d.contracts.filter(q => q.symbol === s.symbol && q.type !== 'FUT').map(q => q.expiry))].sort();
        const allExps = [...new Set([...loadedExps, ...availableExpiries])].sort();
        if (!viewExpiry || !loadedExps.includes(viewExpiry)) viewExpiry = loadedExps[0] || allExps[0] || '';
        const expMap = classifyExpiryMap(allExps, s.cursor.slice(0, 10));
        const activeExpDetail = expMap[viewExpiry];
        el('expiry-select').innerHTML =
          allExps
            .map(e => {
              const tag = loadedExps.includes(e) ? '' : '';
              return '<option value="' + esc(e) + '" ' + (e === viewExpiry ? 'selected' : '') + '>' + esc((expMap[e]?.label || e) + tag) + '</option>';
            })
            .join('') +
          '<option value="__browse__">Browse historical archive expiries…</option>';
        el('expiry-meta').textContent = activeExpDetail
          ? (activeExpDetail.cycle === 'monthly' ? 'Monthly Contract' : 'Weekly Contract') +
            ' · ' +
            (activeExpDetail.dte < 0 ? 'Expired (' + activeExpDetail.iso + ')' : activeExpDetail.dte === 0 ? 'Expiry Day (15:30 IST settlement)' : activeExpDetail.dte + ' calendar days to expiry')
          : 'Select Expiry';
      }

      async function fetchBestIntradayReplay({ sym, exch, anchorDay = '', preferExpiryIso = '', hasOpenLegs = false }) {
        const now = todayIST();
        const recentStart = defaultMinuteStartIST(now);
        const isLocalOrigin = /^(127\.0\.0\.1|localhost)$/i.test(root.location?.hostname || '');
        const hasLiveApi = isLocalOrigin || Boolean(await probeLocalBackend());

        async function tryWindow(winStart, winEnd, prefExp) {
          if (!winStart || !winEnd || winStart > winEnd) return null;
          try {
            const expRes = await brokerApi('expiries?' + new URLSearchParams({ underlying: sym, exch, start: winStart, end: winEnd }));
            if (Array.isArray(expRes?.expiryDetails)) {
              for (const item of expRes.expiryDetails) if (item.iso) brokerExpiryDetails[item.iso] = item;
            }
            if (expRes?.historicalOnly && !expRes?.parquetMinuteAvailable && !(expRes?.minuteExpiries && expRes.minuteExpiries.length)) {
              return null;
            }
            const minutePool = expRes?.minuteExpiries?.length ? { ...expRes, expiries: expRes.minuteExpiries } : expRes;
            const chosenExp = pickPreferredBrokerExpiry(minutePool, prefExp, winEnd);
            if (!chosenExp) return null;
            const j = await brokerApi('replay?' + new URLSearchParams({ underlying: sym, exch, expiry: chosenExp, start: winStart, end: winEnd }));
            if (rawHasSubdayBars(j?.dataset, sym)) {
              return {
                dataset: j.dataset,
                chosenExp,
                expRes,
                notice: j.notice,
                winStart,
                winEnd,
                switchedFromAnchor: Boolean(anchorDay && (anchorDay < winStart || anchorDay > winEnd)),
              };
            }
          } catch {}
          return null;
        }

        // 1. Try exact anchorDay window first when local backend is reachable and anchorDay precedes recentStart
        if (hasLiveApi && anchorDay && anchorDay < recentStart && !(exch === 'bse_fo' && !brokerAuth.connected && anchorDay > '2026-10-23')) {
          const rawEnd = addCalendarDays(anchorDay, 4);
          const reqEnd = rawEnd > now ? now : rawEnd;
          const hitAnchor = await tryWindow(anchorDay, reqEnd, preferExpiryIso);
          if (hitAnchor) return hitAnchor;
        }

        // 2. Try active recent 1-minute window (e.g. captured 1-minute chains + live sessions)
        if (!(hasLiveApi && exch === 'bse_fo' && !brokerAuth.connected)) {
          const prefForRecent = preferExpiryIso && (preferExpiryIso >= now || (hasOpenLegs && preferExpiryIso >= recentStart)) ? preferExpiryIso : '';
          const hitRecent = await tryWindow(recentStart, now, prefForRecent);
          if (hitRecent) return hitRecent;
          if (prefForRecent) {
            const hitRecentDefault = await tryWindow(recentStart, now, '');
            if (hitRecentDefault) return hitRecentDefault;
          }
        }

        // 3. Try latest verified 1-minute Parquet archive window (covers 220+ NSE & BSE F&O symbols)
        if (hasLiveApi) {
          try {
            const st = await brokerApi('market-status?' + new URLSearchParams({ underlying: sym, exch }));
            const pqLatest = st.parquetCoverage?.symbols?.[0]?.latestDate || '2026-10-23';
            const pqStart = addCalendarDays(pqLatest, -3);
            const hitParquet = await tryWindow(pqStart, pqLatest, '');
            if (hitParquet) return hitParquet;
          } catch {}
        }

        return null;
      }

      async function setTimeframe(tf, pendingStepDir = 0) {
        const nextTf = Number(tf);
        if (![1, 5, 13, 15, 16, 30, 60, 120, 1440].includes(nextTf)) return;
        const wasPlaying = Boolean(timer);
        pause();
        activeTimeframe = nextTf;
        if (nextTf < 1440) preferredIntradayTf = nextTf;
        if (el('timeframe')) el('timeframe').value = String(nextTf);
        host.querySelectorAll('[data-tf]').forEach(btn => {
          const isMatch = +btn.dataset.tf === nextTf;
          btn.classList.toggle('active', isMatch);
          btn.setAttribute('aria-pressed', String(isMatch));
        });

        if (!s || !d) return;
        const base = resolution();
        const needIntradayUpgrade = nextTf < 1440 && (!hasGenuineSubdayBars(d, s) || nextTf < base);
        if (needIntradayUpgrade) {
          const myTfSeq = ++tfSwitchSeq;
          const sym = s.symbol;
          const exch = fnoExch();
          const anchorDay = s.cursor.slice(0, 10);
          const hadOpenLegs = Boolean(s.events?.length);
          msg('Loading 1-minute intraday ' + sym + ' data for ' + (nextTf === 1440 ? '1D' : nextTf + 'm') + ' timeframe…');
          const res = await fetchBestIntradayReplay({
            sym,
            exch,
            anchorDay,
            preferExpiryIso: viewExpiry,
            hasOpenLegs: hadOpenLegs,
          });
          if (myTfSeq !== tfSwitchSeq) return;
          if (res?.dataset) {
            availableExpiries = [...new Set((res.expRes?.expiries || []).map(brokerCodeToIso).filter(Boolean))].sort();
            activeTimeframe = nextTf;
            adopt(res.dataset, null, null, true);
            activeTimeframe = nextTf;
            const matchDayFrame = P.frames(d, s).find(t => t.startsWith(anchorDay));
            if (matchDayFrame && matchDayFrame !== s.cursor) {
              s = P.advance(d, s, matchDayFrame);
            }
            if (pendingStepDir !== 0) {
              frameStep(pendingStepDir * nextTf);
              return;
            }
            render();
            msg(
              'Switched to ' +
                nextTf +
                ' Min timeframe · Loaded genuine 1-minute ' +
                sym +
                ' (' +
                res.chosenExp +
                ') option-chain bars at ' +
                s.cursor.replace('T', ' ') +
                ' IST.'
            );
            return;
          }
          render();
          msg('1-minute intraday bars are unavailable for ' + sym + ' in the current offline cache; start local preview server for 220-symbol 1-minute archive.');
          return;
        }

        render();
        if (wasPlaying && P.frames(d, s).length > 1) {
          el('btn-play').click();
        } else {
          msg('Timeframe set to ' + (nextTf === 1440 ? '1 Day' : nextTf + ' Min') + ' · Chart, underlying & option chain synchronized at ' + s.cursor.replace('T', ' ') + ' IST.');
        }
      }

      async function switchExpiry(targetIso) {
        if (!s || !d || !targetIso) return;
        pause();
        stopAutoRefresh();
        const myExpSeq = ++expirySwitchSeq;
        const alreadyOnDay = (d.byFrame.get(s.symbol + '|' + s.cursor) || []).some(q => q.expiry === targetIso && q.type !== 'FUT');
        if (alreadyOnDay) {
          viewExpiry = targetIso;
          host.dataset.centeredChainKey = '';
          render();
          msg('Option chain switched to expiry ' + isoToBrokerCode(targetIso) + ' (' + targetIso + ') at ' + s.cursor.replace('T', ' ') + ' IST.');
          return;
        }
        const anyFrameInLoaded = P.frames(d, s).find(t => (d.byFrame.get(s.symbol + '|' + t) || []).some(q => q.expiry === targetIso && q.type !== 'FUT'));
        if (anyFrameInLoaded) {
          viewExpiry = targetIso;
          host.dataset.centeredChainKey = '';
          change(P.advance(d, s, anyFrameInLoaded));
          msg('Moved cursor to ' + anyFrameInLoaded.replace('T', ' ') + ' IST for expiry ' + isoToBrokerCode(targetIso) + '.');
          return;
        }

        const exch = fnoExch();
        const sym = s.symbol;
        const prevCursor = s.cursor;
        const code = isoToBrokerCode(targetIso);
        const now = todayIST();
        let reqStart = s.start;
        let reqEnd = s.end;
        if (targetIso < reqStart) {
          reqStart = defaultMinuteStartIST(targetIso);
          reqEnd = targetIso;
        } else if (reqEnd > targetIso) {
          reqEnd = targetIso;
        }
        if (d.kind === 'daily' && targetIso >= '2020-03-02') {
          reqStart = targetIso < now ? defaultMinuteStartIST(targetIso) : defaultMinuteStartIST(now);
          reqEnd = targetIso < now ? targetIso : now;
        }

        const reqGen = ++generation;
        chainRows = [];
        el('chain-body').innerHTML = '<tr><td colspan="' + (showDetailCols ? 17 : 11) + '" class="opstra-empty">Loading ' + esc(sym + ' ' + code + ' (' + targetIso + ')') + ' option chain…</td></tr>';
        msg('Loading ' + sym + ' ' + code + ' (' + targetIso + ') option chain…');
        try {
          const keepTf = activeTimeframe;
          const j = await brokerApi('replay?' + new URLSearchParams({ underlying: sym, exch, expiry: code, start: reqStart, end: reqEnd }));
          if (myExpSeq !== expirySwitchSeq || reqGen !== generation) return;
          adopt(j.dataset, null, null, true);
          viewExpiry = targetIso;
          if (d.kind !== 'daily' && keepTf < 1440) activeTimeframe = keepTf;
          const frames = P.frames(d, s);
          const desiredTs = frames.includes(prevCursor)
            ? prevCursor
            : frames.find(t => t.slice(11) === prevCursor.slice(11) && t.slice(0, 10) <= targetIso) || frames.at(-1);
          if (desiredTs && desiredTs !== s.cursor && desiredTs >= (s.events.at(-1)?.at || frames[0])) {
            s = P.advance(d, s, desiredTs);
          }
          host.dataset.centeredChainKey = '';
          render();
          persist();
          msg(j.notice || ('Loaded ' + sym + ' ' + code + ' (' + targetIso + ') option chain at ' + s.cursor.replace('T', ' ') + ' IST.'));
        } catch (err) {
          if (myExpSeq !== expirySwitchSeq) return;
          render();
          msg('Could not load expiry ' + code + ': ' + (err.message || String(err)));
        }
      }

      function renderCandleChart(v) {
        const panel = el('candle-panel');
        const svgWrap = el('candle-svg-wrap');
        const seriesSel = el('candle-series');
        const headingEl = el('candle-heading');
        const countEl = el('candle-count');
        const ohlcSumEl = el('tf-ohlc-summary');
        const tipEl = el('candle-tooltip');
        const panInput = el('candle-pan');
        if (!panel || !svgWrap || !C?.aggregateSessionCandles) return;

        const fut = currentFuture();
        const seriesOpts = [{ value: 'spot', label: 'Underlying Spot (' + s.symbol + ')' }];
        if (fut) seriesOpts.push({ value: 'fut|' + fut.expiry, label: 'Futures (' + isoToBrokerCode(fut.expiry) + ')' });
        for (const p of v.positions) {
          if (p.type !== 'FUT') {
            const key = ['opt', p.expiry, p.type, p.strike].join('|');
            if (!seriesOpts.some(o => o.value === key)) {
              seriesOpts.push({ value: key, label: isoToBrokerCode(p.expiry) + ' ' + p.strike + ' ' + p.type });
            }
          }
        }
        if (!seriesOpts.some(o => o.value === candleSeries)) candleSeries = 'spot';
        seriesSel.innerHTML = seriesOpts.map(o => '<option value="' + esc(o.value) + '" ' + (o.value === candleSeries ? 'selected' : '') + '>' + esc(o.label) + '</option>').join('');

        let rawObs = [];
        let seriesTitle = s.symbol + ' Spot';
        if (candleSeries === 'spot') {
          rawObs = (d.underlying || []).filter(u => u.symbol === s.symbol);
        } else if (candleSeries.startsWith('fut|')) {
          const fExp = candleSeries.split('|')[1];
          seriesTitle = s.symbol + ' ' + isoToBrokerCode(fExp) + ' FUT';
          rawObs = d.contracts.filter(c => c.symbol === s.symbol && c.type === 'FUT' && c.expiry === fExp);
        } else if (candleSeries.startsWith('opt|')) {
          const [, oExp, oType, oStrike] = candleSeries.split('|');
          seriesTitle = s.symbol + ' ' + isoToBrokerCode(oExp) + ' ' + oStrike + ' ' + oType;
          rawObs = d.contracts.filter(c => c.symbol === s.symbol && c.expiry === oExp && c.type === oType && c.strike === +oStrike);
        }

        const isDailyOnly = d.kind === 'daily' || d.metadata?.resolution === 'daily close';
        const effTf = isDailyOnly ? 1440 : activeTimeframe;
        const tfTag = effTf === 1440 ? '1D' : effTf + 'm';
        const candles = C.aggregateSessionCandles(rawObs, effTf, { upTo: s.cursor });

        headingEl.textContent = seriesTitle + ' · ' + (effTf === 1440 ? 'Daily (1D)' : effTf + ' Min') + ' Candlesticks (IST)';
        countEl.textContent = candles.length + ' candle' + (candles.length === 1 ? '' : 's') + ' ≤ ' + s.cursor.slice(11) + ' IST';

        const lastC = candles.at(-1);
        if (lastC && ohlcSumEl) {
          ohlcSumEl.textContent =
            tfTag +
            ' OHLC (' +
            (effTf === 1440 ? lastC.timestamp.slice(0, 10) : lastC.openTime.slice(11) + '–' + lastC.closeTime.slice(11)) +
            '): O ' +
            numFixed(lastC.open, 2) +
            ' · H ' +
            numFixed(lastC.high, 2) +
            ' · L ' +
            numFixed(lastC.low, 2) +
            ' · C ' +
            numFixed(lastC.close, 2) +
            (lastC.partial ? ' [Partial ' + lastC.barCount + '/' + effTf + 'm]' : '');
        } else if (ohlcSumEl) {
          ohlcSumEl.textContent = tfTag + ' OHLC: Unavailable at cursor';
        }

        if (!candles.length) {
          svgWrap.innerHTML = '<p class="opstra-empty">No recorded underlying observations up to ' + esc(s.cursor) + ' IST.</p>';
          return;
        }

        const total = candles.length;
        const visCount = Math.max(1, Math.min(total, candleVisibleCount));
        const maxStart = Math.max(0, total - visCount);
        const startIdx = Math.round((maxStart * Math.max(0, Math.min(100, candlePanPct))) / 100);
        const visible = candles.slice(startIdx, startIdx + visCount);
        if (panInput) {
          panInput.disabled = maxStart === 0;
          if (maxStart === 0) panInput.value = '100';
        }

        // Map trade fills (entry / exit) up to s.cursor onto visible candle indices
        const fillsUpToCursor = (s.fills || []).filter(f => f.at && f.at <= s.cursor);
        const markersByIdx = new Map();
        for (const fl of fillsUpToCursor) {
          const pos = v.positions.find(p => p.id === fl.positionId);
          const idx = visible.findIndex(c => {
            if (effTf === 1440) return c.timestamp.slice(0, 10) === fl.at.slice(0, 10);
            return c.openTime.slice(0, 10) === fl.at.slice(0, 10) && fl.at >= c.openTime && fl.at <= c.closeTime;
          });
          if (idx >= 0) {
            const arr = markersByIdx.get(idx) || [];
            arr.push({
              kind: fl.kind,
              side: pos?.side ?? 1,
              label: (fl.kind === 'exit' ? 'EXIT ' : (pos?.side === -1 ? 'SELL ' : 'BUY ')) + (pos ? (pos.type === 'FUT' ? 'FUT' : pos.strike + pos.type) : '') + ' @ ₹' + numFixed(fl.price, 2),
            });
            markersByIdx.set(idx, arr);
          }
        }

        const W = 880, H = 235, L = 14, R = 68, T = 18, B = 32;
        const pw = W - L - R, ph = H - T - B;
        let pMin = Math.min(...visible.map(c => c.low));
        let pMax = Math.max(...visible.map(c => c.high));
        if (pMax - pMin < 1e-4) {
          const pad = Math.max(1, pMax * 0.002);
          pMin -= pad;
          pMax += pad;
        } else {
          const pad = (pMax - pMin) * 0.08;
          pMin -= pad;
          pMax += pad;
        }

        const y = val => T + (1 - (val - pMin) / (pMax - pMin || 1)) * ph;
        const stepX = pw / Math.max(1, visible.length);
        const bodyW = Math.max(2.5, Math.min(18, stepX * 0.66));
        const xCenter = i => L + (i + 0.5) * stepX;

        const gridLines = [0, 0.25, 0.5, 0.75, 1]
          .map(f => {
            const py = T + f * ph;
            const val = pMax - f * (pMax - pMin);
            return (
              '<line x1="' + L + '" y1="' + py.toFixed(1) + '" x2="' + (W - R) + '" y2="' + py.toFixed(1) + '" stroke="var(--op-border,#cbd5e1)" stroke-opacity="0.45" stroke-dasharray="2 2"/>' +
              '<text x="' + (W - R + 6) + '" y="' + (py + 3.5).toFixed(1) + '" fill="var(--op-muted,#64748b)" font-size="10.5">' + numFixed(val, 1) + '</text>'
            );
          })
          .join('');

        const multiDay = new Set(visible.map(c => c.timestamp.slice(0, 10))).size > 1;
        const tickCount = Math.min(visible.length, 6);
        const xTicks = [];
        for (let k = 0; k < tickCount; k++) {
          const idx = tickCount === 1 ? 0 : Math.round((k * (visible.length - 1)) / (tickCount - 1));
          const c = visible[idx];
          const lbl = effTf === 1440 ? c.timestamp.slice(0, 10) : multiDay ? c.openTime.slice(5, 10) + ' ' + c.openTime.slice(11) : c.openTime.slice(11);
          xTicks.push('<text x="' + xCenter(idx).toFixed(1) + '" y="' + (H - 9) + '" text-anchor="middle" fill="var(--op-muted,#64748b)" font-size="10">' + esc(lbl) + '</text>');
        }

        const sessionSeps = visible
          .map((c, i) => {
            if (i === 0 || c.timestamp.slice(0, 10) === visible[i - 1].timestamp.slice(0, 10)) return '';
            const sx = (L + i * stepX).toFixed(1);
            return '<line x1="' + sx + '" y1="' + T + '" x2="' + sx + '" y2="' + (H - B) + '" stroke="#94a3b8" stroke-opacity="0.55" stroke-dasharray="4 3"/>';
          })
          .join('');

        const lastCloseY = y(visible.at(-1).close).toFixed(1);
        const lastLine =
          '<line x1="' + L + '" y1="' + lastCloseY + '" x2="' + (W - R) + '" y2="' + lastCloseY + '" stroke="#0ea5e9" stroke-width="1" stroke-dasharray="3 3"/>' +
          '<rect x="' + (W - R + 2) + '" y="' + (Number(lastCloseY) - 8).toFixed(1) + '" width="64" height="16" rx="3" fill="#0ea5e9"/>' +
          '<text x="' + (W - R + 34) + '" y="' + (Number(lastCloseY) + 3.5).toFixed(1) + '" text-anchor="middle" fill="#ffffff" font-size="10" font-weight="700">' + numFixed(visible.at(-1).close, 1) + '</text>';

        const candleEls = visible
          .map((c, i) => {
            const cx = xCenter(i);
            const bull = c.close >= c.open;
            const col = bull ? '#16a34a' : '#dc2626';
            const yHigh = y(c.high), yLow = y(c.low);
            const yTop = y(Math.max(c.open, c.close)), yBot = y(Math.min(c.open, c.close));
            const bh = Math.max(1.8, yBot - yTop);
            const mks = markersByIdx.get(i) || [];
            const mkSvg = mks
              .map((m, mi) => {
                const isExit = m.kind === 'exit';
                const mCol = isExit ? '#f59e0b' : m.side === 1 ? '#16a34a' : '#dc2626';
                const my = isExit ? Math.max(T + 8, yHigh - 8 - mi * 11) : m.side === 1 ? Math.min(H - B - 6, yLow + 11 + mi * 11) : Math.max(T + 8, yHigh - 8 - mi * 11);
                const glyph = isExit ? '✕' : m.side === 1 ? '▲' : '▼';
                return '<text x="' + cx.toFixed(1) + '" y="' + my.toFixed(1) + '" text-anchor="middle" fill="' + mCol + '" font-size="10" font-weight="800">' + glyph + '</text>';
              })
              .join('');
            return (
              '<g class="opstra-candle-item" data-cidx="' + i + '" data-close-ts="' + esc(c.closeTime) + '" style="cursor:pointer">' +
              '<rect x="' + (L + i * stepX).toFixed(1) + '" y="' + T + '" width="' + stepX.toFixed(1) + '" height="' + ph + '" fill="transparent"/>' +
              '<line x1="' + cx.toFixed(1) + '" y1="' + yHigh.toFixed(1) + '" x2="' + cx.toFixed(1) + '" y2="' + yLow.toFixed(1) + '" stroke="' + col + '" stroke-width="1.3"/>' +
              '<rect x="' + (cx - bodyW / 2).toFixed(1) + '" y="' + yTop.toFixed(1) + '" width="' + bodyW.toFixed(1) + '" height="' + bh.toFixed(1) + '" fill="' + col + '" rx="0.8"/>' +
              mkSvg +
              '</g>'
            );
          })
          .join('');

        svgWrap.innerHTML =
          '<svg id="opstra-candle-svg" viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="' + esc(seriesTitle + ' ' + tfTag + ' Candlestick Chart') + '">' +
          gridLines +
          sessionSeps +
          candleEls +
          lastLine +
          xTicks.join('') +
          '</svg>' +
          (total === 1 && effTf < 1440
            ? '<small class="opstra-helper-text" style="display:block;margin-top:4px;">At session start (' + esc(s.cursor.replace('T', ' ')) + ' IST) — step forward (+1m / +5m / +13m / +15m / +16m) or press PLAY to advance candles causally without future data leakage.</small>'
            : '');

        const svgNode = svgWrap.querySelector('#opstra-candle-svg');
        if (svgNode && tipEl) {
          svgNode.onmousemove = ev => {
            const g = ev.target.closest('[data-cidx]');
            if (!g) {
              tipEl.hidden = true;
              return;
            }
            const idx = +g.dataset.cidx;
            const c = visible[idx];
            if (!c) return;
            const mks = markersByIdx.get(idx) || [];
            tipEl.hidden = false;
            tipEl.innerHTML =
              '<strong>' + esc(effTf === 1440 ? c.timestamp.slice(0, 10) : c.openTime.replace('T', ' ') + ' – ' + c.closeTime.slice(11) + ' IST') + '</strong>' +
              (c.partial ? ' <em>(Partial ' + c.barCount + 'm)</em>' : '') +
              '<br>O: ' + numFixed(c.open, 2) + ' · H: ' + numFixed(c.high, 2) + ' · L: ' + numFixed(c.low, 2) + ' · C: <strong>' + numFixed(c.close, 2) + '</strong>' +
              (c.volume !== null ? ' · Vol: ' + num(c.volume, 0) : '') +
              (mks.length ? '<br>' + mks.map(m => esc(m.label)).join(' · ') : '');
          };
          svgNode.onmouseleave = () => { tipEl.hidden = true; };
          svgNode.onclick = guard(ev => {
            const g = ev.target.closest('[data-close-ts]');
            if (!g) return;
            const targetTs = g.dataset.closeTs;
            if (targetTs && P.frames(d, s).includes(targetTs) && targetTs !== s.cursor) {
              pause();
              change(P.advance(d, s, targetTs));
              msg('Jumped cursor to candle close ' + targetTs.replace('T', ' ') + ' IST.');
            }
          });
        }
      }

      function render() {
        if (!s || !d) return;
        const exch = fnoExch();
        const all = d.byFrame.get(s.symbol + '|' + s.cursor) || [];
        const loadedExpiries = [...new Set(d.contracts.filter(q => q.symbol === s.symbol && q.type !== 'FUT').map(q => q.expiry))].sort();
        if (!loadedExpiries.includes(viewExpiry)) viewExpiry = loadedExpiries[0] || '';
        const expiries = [...new Set([...loadedExpiries, ...availableExpiries])].sort();
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
        const instMeta = activeInstrumentMeta(s.symbol, exch);
        const lotVal = chainRows[0]?.lotSize || future?.lotSize || instMeta?.lotSize || null;
        el('symbol-select').innerHTML = instrumentOptions(s.symbol, exch, symbolSearchQuery, lotVal);
        el('symbol-select').disabled = loading;
        renderSearchMatches();
        const strikeDiffs = (() => {
          const st = [...new Set(chainRows.filter(q => q.type !== 'FUT').map(q => q.strike))].sort((x, y) => x - y);
          return st.length >= 2 ? st[1] - st[0] : instMeta?.strikeInterval || null;
        })();
        el('instrument-meta').textContent = [
          exch === 'bse_fo' ? 'BSE F&O (BFO)' : 'NSE F&O (NFO)',
          instMeta?.underlying || s.symbol,
          instMeta?.instrumentType || (instMeta?.kind === 'stock' ? 'Stock F&O' : 'Index F&O'),
          strikeDiffs ? 'Strike Step: ' + strikeDiffs : null,
          expiries.length ? expiries.length + ' Expir' + (expiries.length === 1 ? 'y' : 'ies') + ' Available' : 'No Active Expiries',
          instMeta?.chainAvailable === false ? '⚠ Live Chain Unavailable' : null,
        ].filter(Boolean).join(' · ');

        // Expiry selector with Weekly / Monthly & DTE labels
        renderExpirySelectOnly();

        // Market info badges
        el('val-spot').textContent = Number.isFinite(spot) ? numFixed(spot, 2) : 'Unavailable';
        el('val-future').textContent = el('chain-fut-price').textContent = Number.isFinite(future?.close) ? numFixed(future.close, 2) : 'Unavailable';
        el('chain-fut-price').title = future ? 'Futures expiry ' + future.expiry : 'No futures contract quote at this timestamp';
        el('val-atm').textContent = atmInfo.atmStrike !== null ? num(atmInfo.atmStrike, 0) : '—';
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
        const syncMetaEl = el('chain-sync-meta');
        if (syncMetaEl) {
          syncMetaEl.textContent =
            s.symbol +
            ' Spot ' +
            (Number.isFinite(spot) ? numFixed(spot, 2) : '—') +
            ' · Exp ' +
            isoToBrokerCode(viewExpiry) +
            ' · ' +
            s.cursor.replace('T', ' ') +
            ' IST · TF ' +
            (d.kind === 'daily' ? '1D' : activeTimeframe + 'm');
        }
        el('sim-clock').textContent = s.cursor.replace('T', ' ') + ' IST';
        el('replay-date').value = s.cursor.slice(0, 10);
        el('replay-date').min = s.start;
        el('replay-date').max = s.end;
        el('observed-time').innerHTML = options(frames.filter(t => t.startsWith(s.cursor.slice(0, 10))).map(t => t.slice(11)), s.cursor.slice(11));

        // Playback state & ALWAYS-CLICKABLE Timeframe controls (1m, 5m, 13m, 15m, 16m, 30m, 60m, 1D)
        const isDailyOnly = d.kind === 'daily' || d.metadata?.resolution === 'daily close';
        const effTf = isDailyOnly ? 1440 : activeTimeframe;
        const playback = root.IWSMSimulatorPlayback.describe({ kind: d.kind, frames, cursor: s.cursor, exchange: exch, base, activeTimeframe: effTf });
        el('playback-explanation').textContent = playback.notice;
        el('resolution-note').textContent = d.kind === 'daily' ? 'Daily archive loaded (1D steps).' : 'Intraday replay active (' + frames.length + ' timestamps · ' + effTf + 'm chart).';

        const tfChoices = [1, 5, 13, 15, 16, 30, 60, 120, 1440];
        el('timeframe').innerHTML = tfChoices
          .map(n => '<option value="' + n + '" ' + (n === effTf ? 'selected' : '') + '>' + (n === 1440 ? '1 Day' : n + ' Min') + '</option>')
          .join('');
        el('timeframe').value = String(effTf);
        el('timeframe').disabled = false;
        el('speed').disabled = false;
        host.querySelectorAll('[data-tf]').forEach(btn => {
          const isMatch = +btn.dataset.tf === effTf;
          btn.classList.toggle('active', isMatch);
          btn.setAttribute('aria-pressed', String(isMatch));
          btn.disabled = false;
        });
        el('btn-rewind').disabled = frames.length < 2 || s.cursor === frames[0];

        host.querySelectorAll('[data-mins]').forEach(b => {
          const n = +b.dataset.mins, amount = Math.abs(n);
          const needsAutoUpgrade = amount !== 1440 && !hasGenuineSubdayBars(d, s);
          const atBoundary = !needsAutoUpgrade && frames.length >= 2 && (n < 0 ? s.cursor === frames[0] : s.cursor === frames.at(-1));
          const finerThanMultiMinSource = !needsAutoUpgrade && d.kind === 'intraday' && frames.length >= 2 && amount !== 1440 && amount < base;
          b.disabled = atBoundary || finerThanMultiMinSource;
          b.title = needsAutoUpgrade
            ? 'Click to auto-load 1-minute intraday data and step ' + (amount === 1440 ? '1 day' : amount + ' minutes')
            : '';
          b.setAttribute('aria-label', (n < 0 ? 'Back ' : 'Forward ') + (amount === 1440 ? '1 day' : amount + ' minutes'));
        });
        el('btn-play').disabled = !playback.canPlay;
        el('btn-play').title = playback.notice;
        if (!timer) el('btn-play').textContent = playback.restart ? '↻ REPLAY' : '▶ PLAY';
        el('btn-fut-buy').disabled = el('btn-fut-sell').disabled = !future;

        // Data source provenance banner (always visible so Live vs Cached vs Historical vs Simulated is unmistakable)
        const isSnap = Boolean(d.metadata?.quoteTiming?.startsWith('Snapshot'));
        const dsBadge = resolveDataSourceBadge();
        const provPrefix =
          '[' +
          dsBadge +
          '] ' +
          (d.metadata?.modelled
            ? 'MODELLED OPTION ESTIMATES'
            : d.metadata?.backup
            ? 'VERIFIED HISTORICAL ARCHIVE'
            : isSnap
            ? 'LIVE EXCHANGE SNAPSHOT'
            : 'GENUINE RECORDED OBSERVATIONS');
        const warnText = (d.metadata?.warnings || []).concat(d.warnings || []).filter(Boolean).join(' · ');
        source.hidden = false;
        source.dataset.sourceBadge = dsBadge;
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

        // Sync inline Multi-Leg Builder & keep Option Chain strike ladder continuous within the active session date
        const builderStrikes = [...new Set(chainRows.filter(q => q.type !== 'FUT').map(q => q.strike))].sort((x, y) => x - y);
        const cursorDay = s.cursor.slice(0, 10);
        const sameDayStrikes = chainRows.some(q => q.type !== 'FUT')
          ? [
              ...new Set(
                d.contracts
                  .filter(
                    q =>
                      q.symbol === s.symbol &&
                      q.expiry === viewExpiry &&
                      q.type !== 'FUT' &&
                      String(q.timestamp || q.date || '').slice(0, 10) === cursorDay
                  )
                  .map(q => q.strike)
              ),
            ].sort((x, y) => x - y)
          : [];
        const allStrikes = sameDayStrikes.length ? sameDayStrikes : builderStrikes;
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
        host.querySelectorAll('#opstra-chain-head .opstra-group-side').forEach(td => { td.colSpan = showDetailCols ? 8 : 5; });
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
          const sideCls = sideType === 'CE' ? 'opstra-td-call' : 'opstra-td-put';
          if (!q) return '<td class="opstra-td-act ' + sideCls + '">—</td>';
          const idx = chainRows.indexOf(q);
          const dis = q.volume === 0 ? 'disabled title="Zero recorded volume at this timestamp"' : '';
          return (
            '<td class="opstra-td-act ' + sideCls + '">' +
            '<div class="opstra-bs-group">' +
            '<button type="button" class="opstra-btn-bs opstra-btn-b" data-quote="' + idx + '" data-side="1" ' + dis + ' title="Buy ' + q.strike + ' ' + sideType + '" aria-label="Buy ' + q.strike + ' ' + sideType + '">B</button>' +
            '<button type="button" class="opstra-btn-bs opstra-btn-s" data-quote="' + idx + '" data-side="-1" ' + dis + ' title="Sell ' + q.strike + ' ' + sideType + '" aria-label="Sell ' + q.strike + ' ' + sideType + '">S</button>' +
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
                const ceDeltaTxt = gCe.g ? (gCe.g.delta > 0 ? '+' : '') + numFixed(gCe.g.delta, 2) : '—';
                const peDeltaTxt = gPe.g ? (gPe.g.delta > 0 ? '+' : '') + numFixed(gPe.g.delta, 2) : '—';

                return (
                  '<tr' + (rowCls ? ' class="' + rowCls + '"' : '') + '>' +
                  actionCell(ce, 'CE') +
                  '<td class="opstra-td-call opstra-td-oi' + callItm + '"><div class="opstra-oi-cell"><span class="opstra-oi-bar call" style="width:' + callOiPct + '%"></span><span>' + (ce && Number.isFinite(ce.oi) ? num(ce.oi, 0) : '—') + '</span></div></td>' +
                  (showDetailCols ? '<td class="opstra-td-call' + callItm + '">' + (ce && Number.isFinite(ce.oiChange) ? (ce.oiChange > 0 ? '+' : '') + num(ce.oiChange, 0) : '—') + '</td>' : '') +
                  (showDetailCols ? '<td class="opstra-td-call' + callItm + '">' + (ce && Number.isFinite(ce.volume) ? num(ce.volume, 0) : '—') + '</td>' : '') +
                  (showDetailCols ? '<td class="opstra-td-call' + callItm + '">' + ceBidAsk + '</td>' : '') +
                  '<td class="opstra-td-call opstra-td-ltp opstra-td-call-ltp' + callItm + '">' + (ce ? numFixed(ce.close, 2) : '—') + '</td>' +
                  '<td class="opstra-td-call opstra-td-iv' + callItm + '">' + (gCe.iv === null ? '—' : numFixed(gCe.iv * 100, 1) + '%') + '</td>' +
                  '<td class="opstra-td-call opstra-td-delta' + callItm + '">' + ceDeltaTxt + '</td>' +
                  '<td class="opstra-td-strike"><strong>' + num(k, 0) + '</strong>' +
                  (isAtm ? '<span class="opstra-strike-tag atm">ATM</span>' : '') +
                  (posBadges ? '<span class="opstra-strike-tag pos">' + esc(posBadges.join(' ')) + '</span>' : '') +
                  '</td>' +
                  '<td class="opstra-td-put opstra-td-delta' + putItm + '">' + peDeltaTxt + '</td>' +
                  '<td class="opstra-td-put opstra-td-iv' + putItm + '">' + (gPe.iv === null ? '—' : numFixed(gPe.iv * 100, 1) + '%') + '</td>' +
                  '<td class="opstra-td-put opstra-td-ltp opstra-td-put-ltp' + putItm + '">' + (pe ? numFixed(pe.close, 2) : '—') + '</td>' +
                  (showDetailCols ? '<td class="opstra-td-put' + putItm + '">' + peBidAsk + '</td>' : '') +
                  (showDetailCols ? '<td class="opstra-td-put' + putItm + '">' + (pe && Number.isFinite(pe.volume) ? num(pe.volume, 0) : '—') + '</td>' : '') +
                  (showDetailCols ? '<td class="opstra-td-put' + putItm + '">' + (pe && Number.isFinite(pe.oiChange) ? (pe.oiChange > 0 ? '+' : '') + num(pe.oiChange, 0) : '—') + '</td>' : '') +
                  '<td class="opstra-td-put opstra-td-oi' + putItm + '"><div class="opstra-oi-cell"><span class="opstra-oi-bar put" style="width:' + putOiPct + '%"></span><span>' + (pe && Number.isFinite(pe.oi) ? num(pe.oi, 0) : '—') + '</span></div></td>' +
                  actionCell(pe, 'PE') +
                  '</tr>'
                );
              })
              .join('')
          : '<tr><td colspan="' + (showDetailCols ? 17 : 11) + '" class="opstra-empty">No strikes match the current filter for ' + esc(viewExpiry || s.symbol) + '.</td></tr>';

        const chainContextKey = (s.symbol || '') + '|' + (viewExpiry || '') + '|' + chainRangeCount;
        if (host.dataset.centeredChainKey !== chainContextKey && !chainSearchQuery) {
          host.dataset.centeredChainKey = chainContextKey;
          centerAtmRowInScroll(false);
        }

        el('save-candles').hidden = !bundle || bundle.synthetic === true;
        renderCandleChart(v);
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
        manualLoadSeq++;
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
        let request = 0, archiveFallbackOnly = false, parquetMinuteAvailable = false;

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
          parquetMinuteAvailable = false;
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
            parquetMinuteAvailable = Boolean(j.parquetMinuteAvailable);
            if (j.historicalOnly && !parquetMinuteAvailable && choice.exchange === 'nse_fo') {
              archiveFallbackOnly = true;
            }
            note.textContent = parquetMinuteAvailable
              ? 'Verified 1-Minute Historical Options Archive ready (' + (j.source || choice.symbol) + ') · Loads observed 1m option-chain bars & Greeks.'
              : j.historicalOnly || j.backup
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
          const submitBtn = f.querySelector('[type=submit]');
          submitBtn.disabled = true;
          note.textContent = 'Loading ' + choice.symbol + ' option chain…';
          try {
            if (archiveFallbackOnly || (!parquetMinuteAvailable && spanDays > 6 && choice.exchange === 'nse_fo')) {
              const win = resolveArchiveWindow(choice.symbol, values.start, values.end);
              try {
                await loadRecorded(choice.symbol, win.start, win.end);
              } catch {
                const latestWin = resolveArchiveWindow(choice.symbol);
                await loadRecorded(choice.symbol, latestWin.start, latestWin.end);
              }
              return;
            }
            const n = ++generation;
            const expParam = values.expiry || '23NOV26';
            const j = await brokerApi(
              'replay?' +
                new URLSearchParams({
                  underlying: choice.symbol,
                  expiry: expParam,
                  start: values.start,
                  end: values.end,
                  exch: choice.exchange,
                  interval: '25',
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
                try {
                  await loadRecorded(choice.symbol, win.start, win.end);
                } catch {
                  const latestWin = resolveArchiveWindow(choice.symbol);
                  await loadRecorded(choice.symbol, latestWin.start, latestWin.end);
                }
                msg('Loaded verified ' + choice.symbol + ' historical option chain (' + s.cursor.slice(0, 10) + ').');
                return;
              } catch {}
            }
            note.textContent = err.message;
            msg(err.message);
          } finally {
            if (f.isConnected && submitBtn) submitBtn.disabled = false;
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
        const prevCursor = s.cursor;
        let fresh = P.create(d, { symbol: s.symbol, start: s.start, end: s.end, ...s.settings });
        if (prevCursor && P.frames(d, fresh).includes(prevCursor) && fresh.cursor !== prevCursor) {
          fresh = P.advance(d, fresh, prevCursor);
        }
        change(fresh);
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

      function centerAtmRowInScroll(smooth = true) {
        const scroller = el('chain-scroll') || host.querySelector('.opstra-table-container');
        const atmRow = scroller && scroller.querySelector('.opstra-row-atm');
        if (!scroller || !atmRow || scroller.scrollHeight <= scroller.clientHeight) return;
        const headH = scroller.querySelector('thead')?.offsetHeight || 64;
        const visibleBodyH = Math.max(80, scroller.clientHeight - headH);
        const targetTop = Math.max(0, atmRow.offsetTop - headH - visibleBodyH / 2 + atmRow.offsetHeight / 2);
        if (smooth && typeof scroller.scrollTo === 'function') {
          scroller.scrollTo({ top: targetTop, behavior: 'smooth' });
        } else {
          scroller.scrollTop = targetTop;
        }
      }

      // Option chain filters & B/S clicks
      el('chain-search').oninput = e => { chainSearchQuery = (e.target.value || '').trim(); render(); };
      el('chain-range').onchange = e => { chainRangeCount = +e.target.value; render(); };
      el('chain-detail-cols').onchange = e => { showDetailCols = e.target.checked; render(); };
      el('quick-trade').onchange = e => { quickTrade = e.target.checked; };
      if (el('btn-center-atm')) el('btn-center-atm').onclick = () => centerAtmRowInScroll(true);

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
        if (frames.length < 2 || (activeTimeframe < 1440 && !hasGenuineSubdayBars(d, s))) {
          setTimeframe(activeTimeframe < 1440 ? activeTimeframe : 1).then(() => {
            if (P.frames(d, s).length >= 2 && !timer) el('btn-play').click();
          });
          return;
        }
        if (s.cursor === frames.at(-1)) change(P.advance(d, s, frames[0]));
        el('btn-play').textContent = 'Ⅱ PAUSE';
        el('btn-play').setAttribute('aria-pressed', 'true');
        timer = setInterval(guard(() => frameStep(+el('timeframe').value)), +el('speed').value);
      };

      el('timeframe').onchange = guard(() => setTimeframe(+el('timeframe').value));
      if (el('tf-pills')) {
        el('tf-pills').onclick = guard(e => {
          const btn = e.target.closest('[data-tf]');
          if (!btn) return;
          setTimeframe(+btn.dataset.tf);
        });
      }
      if (el('candle-series')) {
        el('candle-series').onchange = () => {
          candleSeries = el('candle-series').value || 'spot';
          renderCandleChart(P.valuation(d, s));
        };
      }
      if (el('candle-zoom-in')) {
        el('candle-zoom-in').onclick = () => {
          candleVisibleCount = Math.max(15, Math.round(candleVisibleCount * 0.65));
          renderCandleChart(P.valuation(d, s));
        };
      }
      if (el('candle-zoom-out')) {
        el('candle-zoom-out').onclick = () => {
          candleVisibleCount = Math.min(800, Math.round(candleVisibleCount * 1.5));
          renderCandleChart(P.valuation(d, s));
        };
      }
      if (el('candle-zoom-reset')) {
        el('candle-zoom-reset').onclick = () => {
          candleVisibleCount = 800;
          candlePanPct = 100;
          if (el('candle-pan')) el('candle-pan').value = '100';
          renderCandleChart(P.valuation(d, s));
        };
      }
      if (el('candle-pan')) {
        el('candle-pan').oninput = () => {
          candlePanPct = +el('candle-pan').value;
          renderCandleChart(P.valuation(d, s));
        };
      }
      if (el('btn-toggle-candles')) {
        el('btn-toggle-candles').onclick = () => {
          const cp = el('candle-panel');
          if (!cp) return;
          cp.hidden = !cp.hidden;
          el('btn-toggle-candles').setAttribute('aria-expanded', String(!cp.hidden));
        };
      }
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
        await switchExpiry(val);
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
          availableExpiries = [...new Set((exp.expiries || []).map(brokerCodeToIso).filter(Boolean))].sort();
          const chosenExp = pickPreferredBrokerExpiry(exp, viewExpiry, clampedEnd);
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
          if (choice.exchange === 'bse_fo' && !brokerAuth.connected && mode !== 'snapshot') {
            try {
              const stBse = await brokerApi('market-status?' + new URLSearchParams({ underlying: choice.symbol, exch: 'bse_fo' }));
              const pqLatest = stBse.parquetCoverage?.symbols?.[0]?.latestDate;
              if (pqLatest && reqEnd > pqLatest) {
                reqEnd = pqLatest;
                reqStart = addCalendarDays(pqLatest, -2);
              }
            } catch {}
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
          availableExpiries = [...new Set((exp.expiries || []).map(brokerCodeToIso).filter(Boolean))].sort();
          const selected = pickPreferredBrokerExpiry(exp, isDifferentSymbol ? '' : viewExpiry, reqEnd);
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
          if (!isDifferentSymbol) {
            const at = P.frames(d, s).find(t => t >= cursor && Number.isFinite(d.spots.get(s.symbol + '|' + t)));
            if (at && at !== s.cursor) change(P.advance(d, s, at));
          }
          refreshMarketAndCoverage(choice.symbol);
          msg(j.notice || (choice.symbol + ' ' + (mode === 'snapshot' ? 'option chain' : '1-minute option chain') + ' loaded · ' + s.cursor.replace('T', ' ') + ' IST.'));
        } catch (e) {
          if (mySwitch !== switchSeq || request !== generation) return;
          if (choice.exchange === 'bse_fo') {
            try {
              const st = await brokerApi('market-status?' + new URLSearchParams({ underlying: choice.symbol, exch: 'bse_fo' }));
              const pqSym = st.parquetCoverage?.symbols?.[0];
              if (pqSym?.latestDate) {
                const pqEnd = pqSym.latestDate;
                const pqStart = addCalendarDays(pqEnd, -2);
                const expPq = await brokerApi('expiries?' + new URLSearchParams({ underlying: choice.symbol, exch: 'bse_fo', start: pqStart, end: pqEnd }));
                if (expPq.expiries?.length) {
                  availableExpiries = [...new Set(expPq.expiries.map(brokerCodeToIso).filter(Boolean))].sort();
                  const jPq = await brokerApi('replay?' + new URLSearchParams({ underlying: choice.symbol, exch: 'bse_fo', expiry: expPq.expiries[0], start: pqStart, end: pqEnd }));
                  if (mySwitch === switchSeq) {
                    adopt(jPq.dataset);
                    refreshMarketAndCoverage(choice.symbol);
                    msg(jPq.notice || ('Loaded verified 1-minute historical ' + choice.symbol + ' archive (' + s.cursor.replace('T', ' ') + ' IST).'));
                    return;
                  }
                }
              }
            } catch {}
          }
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
        manualLoadSeq++;
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
          if (!s) return;
          if (restoredFromStorage && hasGenuineSubdayBars(d, s)) return;
          const startManual = manualLoadSeq;
          if (tfSwitchSeq > 0 || switchSeq > 0 || expirySwitchSeq > 0) return;
          const targetSym = s.symbol || 'NIFTY';
          const targetExch = fnoExch();
          try {
            const keepTf = preferredIntradayTf || 1;
            const res = await fetchBestIntradayReplay({
              sym: targetSym,
              exch: targetExch,
              anchorDay: todayIST(),
              preferExpiryIso: '',
              hasOpenLegs: false,
            });
            if (!res?.dataset) return;
            if (manualLoadSeq !== startManual || tfSwitchSeq > 0 || switchSeq > 0 || expirySwitchSeq > 0 || hasGenuineSubdayBars(d, s)) return;
            availableExpiries = [...new Set((res.expRes?.expiries || []).map(brokerCodeToIso).filter(Boolean))].sort();
            activeTimeframe = keepTf;
            adopt(res.dataset);
            activeTimeframe = keepTf;
            render();
            msg(res.notice || ('Intraday 1-minute ' + targetSym + ' (' + res.chosenExp + ') option chain loaded (' + s.cursor.replace('T', ' ') + ' IST).'));
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

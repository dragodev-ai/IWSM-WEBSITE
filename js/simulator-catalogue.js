(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.IWSMSimulatorCatalogue = factory();
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  const key = 'iwsm-public-instruments-v2';
  const age = 30 * 86400000;

  // Built-in F&O directory seed so indices & major stocks (NIFTY, BANKNIFTY, SENSEX, RELIANCE, etc.)
  // are searchable at 0ms even before the 446-instrument live contract master finishes loading.
  const FALLBACK_ROWS = [
    { symbol: 'NIFTY', underlying: 'NIFTY 50', exchange: 'nse_fo', kind: 'index', lotSize: 65, strikeInterval: 50, chainAvailable: true },
    { symbol: 'BANKNIFTY', underlying: 'NIFTY BANK', exchange: 'nse_fo', kind: 'index', lotSize: 30, strikeInterval: 100, chainAvailable: true },
    { symbol: 'FINNIFTY', underlying: 'NIFTY FIN SERVICE', exchange: 'nse_fo', kind: 'index', lotSize: 60, strikeInterval: 50, chainAvailable: true },
    { symbol: 'MIDCPNIFTY', underlying: 'NIFTY MID SELECT', exchange: 'nse_fo', kind: 'index', lotSize: 120, strikeInterval: 25, chainAvailable: true },
    { symbol: 'NIFTYNXT50', underlying: 'NIFTY NEXT 50', exchange: 'nse_fo', kind: 'index', lotSize: 25, strikeInterval: 100, chainAvailable: true },
    { symbol: 'SENSEX', underlying: 'BSE SENSEX', exchange: 'bse_fo', kind: 'index', lotSize: 20, strikeInterval: 100, chainAvailable: true },
    { symbol: 'BANKEX', underlying: 'BSE BANKEX', exchange: 'bse_fo', kind: 'index', lotSize: 30, strikeInterval: 100, chainAvailable: true },
    ...([
      ['RELIANCE', 500], ['HDFCBANK', 550], ['ICICIBANK', 700], ['INFY', 400], ['TCS', 175],
      ['SBIN', 750], ['BHARTIARTL', 475], ['AXISBANK', 625], ['LT', 175], ['ITC', 1600],
      ['KOTAKBANK', 400], ['BAJFINANCE', 750], ['M&M', 200], ['MARUTI', 50], ['SUNPHARMA', 350],
      ['TATAMOTORS', 550], ['TATASTEEL', 5500], ['NTPC', 1500], ['HCLTECH', 350], ['WIPRO', 3000],
      ['TITAN', 175], ['ADANIENT', 300], ['ADANIPORTS', 475], ['BAJAJFINSV', 500], ['ULTRACEMCO', 50],
      ['POWERGRID', 1900], ['ONGC', 2250], ['HAL', 150], ['BEL', 2850], ['TRENT', 100],
      ['ASIANPAINT', 250], ['COALINDIA', 1350], ['HINDALCO', 700], ['JSWSTEEL', 675], ['GRASIM', 250],
      ['BAJAJ-AUTO', 75], ['TECHM', 600], ['CIPLA', 375], ['DRREDDY', 625], ['INDUSINDBK', 700],
      ['EICHERMOT', 175], ['DIVISLAB', 100], ['BPCL', 1975], ['APOLLOHOSP', 125], ['HEROMOTOCO', 150],
      ['BRITANNIA', 125], ['NESTLEIND', 500], ['TATACONSUM', 550], ['SHRIRAMFIN', 825], ['DLF', 825],
      ['INDIGO', 150], ['JIOFIN', 1650], ['ZOMATO', 2000], ['VEDL', 1150], ['PFC', 1300],
      ['RECLTD', 1275], ['BHEL', 2625], ['BANKBARODA', 2925], ['PNB', 8000], ['CANBK', 6750],
      ['CHOLAFIN', 625], ['SIEMENS', 125], ['ABB', 125], ['PIDILITIND', 250], ['TVSMOTOR', 350],
      ['DIXON', 50], ['POLYCAB', 125], ['PERSISTENT', 100], ['COFORGE', 375], ['LTIM', 150],
      ['IRCTC', 875], ['HAVELLS', 500], ['VOLTAS', 375], ['ASHOKLEY', 2500], ['IDEA', 40000],
      ['INDUSTOWER', 1700], ['MUTHOOTFIN', 275], ['PAYTM', 725], ['NYKAA', 3125], ['DMART', 150],
    ].map(([symbol, lotSize]) => ({
      symbol,
      underlying: symbol,
      exchange: 'nse_fo',
      kind: 'stock',
      lotSize,
      chainAvailable: true,
    }))),
  ];

  function clean(rows) {
    if (!Array.isArray(rows)) return [];
    return rows
      .slice(0, 1500)
      .filter(
        r =>
          r &&
          ['nse_fo', 'bse_fo'].includes(r.exchange) &&
          ['index', 'stock'].includes(r.kind) &&
          typeof r.symbol === 'string' &&
          /^[A-Z0-9&._ -]{1,50}$/.test(r.symbol)
      )
      .map(r => ({
        symbol: r.symbol,
        underlying: typeof r.underlying === 'string' && r.underlying ? r.underlying : r.symbol,
        exchange: r.exchange,
        kind: r.kind,
        ...(Number.isFinite(r.lotSize) && r.lotSize > 0 ? { lotSize: r.lotSize } : {}),
        ...(Number.isFinite(r.strikeInterval) && r.strikeInterval > 0 ? { strikeInterval: r.strikeInterval } : {}),
        ...(typeof r.instrumentType === 'string' ? { instrumentType: r.instrumentType } : {}),
        ...(typeof r.chainAvailable === 'boolean' ? { chainAvailable: r.chainAvailable } : {}),
      }));
  }

  function read(storage, now = Date.now()) {
    try {
      if (storage) {
        const v = JSON.parse(storage.getItem(key));
        if (v && Number.isFinite(v.saved) && now - v.saved >= 0 && now - v.saved <= age) {
          const parsed = clean(v.rows);
          if (parsed.length) return parsed;
        }
      }
    } catch {}
    return clean(FALLBACK_ROWS);
  }

  function save(storage, rows, now = Date.now()) {
    try {
      const cleaned = clean(rows);
      if (storage && cleaned.length) {
        storage.setItem(key, JSON.stringify({ saved: now, rows: cleaned }));
      }
    } catch {}
  }

  return { read, save, fallback: () => clean(FALLBACK_ROWS) };
});

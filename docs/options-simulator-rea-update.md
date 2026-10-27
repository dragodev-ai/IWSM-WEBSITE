# Options simulator replay update — 27 October 2026

## Requested behavior and scope

The owner selected NiftyTrader's options simulator as a behavioral reference: dated option/futures entries, five-minute replay, configurable option-chain columns and a payoff inspector showing underlying price, expiry P&L, replay P&L and dates. This is an independent IWSM implementation built on the existing recorded-price engine and website theme.

## Reference evidence

Reference URL: https://www.niftytrader.in/options-simulator

Observed in the user's open reference session:

- Symbol, historical date, IST time and expiry selectors; ±5/15/30 minutes, ±1/2 hours, SOD/EOD, ±1 session and autoplay.
- Replay 14 October 2026 from 09:15 to 09:20. Existing 22,300 PE short and CE long retained their entry prices. Marks changed to 40.50 and 442.25, with individual P&L -61.75 and -100.75, total -162.50.
- Options/Futures tabs. Futures rows showed separate expiries, OI, volume, LTP and buy/sell actions.
- Trades/Greeks tabs, per-leg lots, expiry, entry/LTP and SL/TP controls.
- Settings dialog: quantities/lots, independent numbers of strikes above/below ATM, optional IV/Greeks/volume/OI columns and highlight colors.
- Shipped chart code supports pointer and keyboard inspection of two curves and includes start/replay date and expiry labels.

Publicly shipped JavaScript was downloaded for inert analysis. REA analyzed the route loader and the specific workspace chunk it loads. No private server source, credentials or private account storage was acquired. The in-app browser did not expose a CDP endpoint, so the user's interaction evidence came from CUA; REA's analysis was static, not a claimed live network recording.

- Route loader: `/_next/static/chunks/pages/options-simulator-6f28d1882f5d5538.js`, SHA-256 `18b98f4f8e3c98394beba3d7585dbd0924f8d8eab0c16a8ca00190a236a2d348`.
- Workspace: `/_next/static/chunks/46677.34b403bc7467c8c3.js`, 156,356 bytes.
- REA workspace parent Evidence: `ev_5dc77c88b4effa3cd97560a5a25e8239e62631f47c7be58edea19be23e6b6900`.
- Coverage is partial: one selected workspace file, dependencies unselected, 5,000 semantic-node per-file limit. Static candidates do not establish server behavior or complete execution coverage.

The shipped frontend constructs snapshot requests with symbol, expiryDate, createdAt and createdTime. Its model payoff request references `https://api.niftytrader.in/api/Strategy/options-strategy`. These are observations about frontend integration, not permission or entitlement to use its data service. IWSM does not depend on those services, copy their account state or bundle their source.

## Implementation

- Existing `options-simulator-engine.js`: add 120-minute stepping. Preserve exact recorded contract matching, event history, costs, exits and missing-quote handling.
- `options-simulator-replay.js`: strict IST time selection, minute stepping, CSV/JSON snapshot normalization, a labelled synthetic teaching fixture and model payoff sampling anchored to recorded current P&L.
- `options-simulator-replay-ui.js`: date/time/expiry toolbar, ±1/5/15/30/60/120 minutes, session edges, option/futures views, independent strike windows, manual paper-entry ticket, positions summary tab, dataset import and chart pointer/touch/keyboard crosshair.
- `options-simulator-replay.css`: uses existing IWSM tokens, stacked controls at narrow widths, 44px controls and semantic gain/loss colors.
- `options-simulator-ui.js`: a small adapter attaches the new interface to the existing simulator closure. Existing history, strategy, underlying, combined, Greeks, trade log, presets, SL/target, saved simulations and JSON backups remain available.
- Chart solid line: first-expiry model. Dashed line: current replay-time model. For mixed expiries, later options retain model time value at the first expiry. Futures hold their current recorded basis fixed under spot scenarios. Both views include executed costs and closed-trade P&L. At current reference, dashed P&L equals recorded net P&L when all marks exist. Missing marks produce unavailable values, never carried-forward marks.
- GitHub Pages can replay a date range within its loaded data. Out-of-range requests explain the need to import data or run the connected preview; GitHub Pages cannot execute archive backend functions.

## Data boundary

The bundled archive is recorded daily closing data. It cannot establish minute prices, intraday stop order or five-minute fills. Actual intraday replay requires an imported CSV/JSON containing timestamped contract and underlying observations. Synthetic practice is conspicuously labelled and never presented as real market history. No live broker, market-data entitlement, SPAN margin engine or complete historical derivatives database is configured by this change.

CSV fields: `timestamp,symbol,expiry,type,strike,close,lotSize,spot,volume,oi`. Types are CE, PE and FUT; SPOT/INDEX rows can provide independent underlying observations. ISO timestamps without an offset are interpreted in IST. JSON supports canonical datasets, saved backups and `snapshots:[{timestamp,symbol,spot,contracts:[...]}]`.

## Verification

Run `node ui-elements/test-simulator-replay.cjs` for exact stepping, quote P&L, futures, chart anchors, costs, missing marks, backup restore, timeline branching, JSON/CSV import and SL/target processing. Existing strategy and history suites cover pricing and archive behavior. Browser acceptance verified timestamped CSV import, 2 × 65-unit calls repriced from 120 to 125 for +650 P&L after five minutes, save/restore, close at recorded mark, practice option/futures entries, all analysis views, theme switching, keyboard inspection and pointer tooltip.

No claim is made that NiftyTrader's entire private backend, data coverage or licensed analytics have been reproduced.

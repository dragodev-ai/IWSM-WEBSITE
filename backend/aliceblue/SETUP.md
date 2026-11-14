# Alice Blue read-only integration

The existing site is static HTML/CSS/JavaScript. Local preview runs Node on port 4174 and invokes Python/SQLite for archive data. Public GitHub Pages cannot run Python. Netlify currently publishes the website root and uses Node functions; the Python service must be hosted separately or reverse-proxied behind the same origin.

## Private configuration

Edit this file locally, never paste its contents into chat:

%LOCALAPPDATA%\IWSM\aliceblue.env

APP_CODE must be the identifier supplied for the ANT login URL by the Alice Blue Developer Portal. The account-opening referral identifier is not an API credential. API_SECRET comes from that same application. REDIRECT_URL must exactly match its registered callback URL. If the broker's redirect omits a state parameter (the documented callback returns only authCode and userId), set ALICEBLUE_CLIENT_ID to your expected account ID so the callback can verify ownership. Leave SESSION_ENCRYPTION_KEY blank: a Fernet key is generated automatically on first start and stored beside the session database (outside Git); you may set your own if preferred. No real values belong in .env.example.

Proposed local callback (register only if Alice Blue accepts local HTTP callbacks): http://127.0.0.1:4174/api/aliceblue/auth/callback . Production requires the deployed HTTPS backend callback. Confirm the registered URL and API activation in the broker portal; do not change account permissions as a workaround.

## Implemented local service

A dedicated Python FastAPI service handles authentication, encrypted sessions, validation, caching and broker rate limits. The existing Node preview forwards only explicitly allowed Alice Blue API routes to loopback Python. Public hosting needs a separately deployed Python backend and HTTPS reverse proxy. Current Strategy Lab access is public, so a browser-bound authenticated broker session or explicit admin access is required; a shared unrestricted broker-data proxy will not be exposed.

Broker API traffic will be read-only. No order APIs will be implemented. Sessions must never enter JavaScript, browser storage, Git or logs. Callback initiation must be short-lived, single-use and browser-bound because the documented redirect does not promise state echo. Callback query logging must be disabled at the server and reverse proxy.

Official sources checked 4 November 2026: Authentication, Option Chain, Rates Limits and Reference Libraries under https://ant.aliceblueonline.com/productdocumentation/ . Option-chain calls return current available expiries; they do not establish historical minute option data. The strike parser must be validated against an actual account response before live completion can be claimed.

## Running locally

Start backend/aliceblue/.venv/Scripts/python.exe with backend/aliceblue/alice_service.py from this directory. It binds only to 127.0.0.1:4180. Start node tools/local-preview.cjs from the website root for the same-origin proxy on port 4174.

Open http://127.0.0.1:4174/strategy-builder.html#options-simulator and open New Simulation and use Connect Alice Blue when prompted. Complete broker login within five minutes; if it expires, reconnect from the website. The callback configured locally is http://127.0.0.1:4174/api/aliceblue/auth/callback and must also match the active application's registered callback. Setting the local file alone does not register it with the broker.

If Alice Blue omits state on return, configure ALICEBLUE_CLIENT_ID with the expected broker account ID and restart the backend. Ownership validation intentionally fails closed. Do not enter account passwords or OTPs into this config.

Run test_alice_service.py with the isolated Python environment. Twelve mocked integration tests passed on 4 November 2026, covering encrypted storage, auth ownership/state/replay protection, normalization, validation, caching, expiry and rate-limit handling. Frontend selector wiring was repaired and verified in the browser: Connect opens the official ANT login form.

Live authentication succeeded on 4 November 2026 after correcting the active application callback from Google to IWSM. Actual NIFTY and RELIANCE chains, available expiries, strike-interval changes, and BSE SENSEX chains were verified. Strict BSE weekly/monthly parsing is based on observed broker contract names and covered by regression tests. The encrypted session survived service restart. Historical minute data, public deployment, MCX contract parsing and WebSocket streaming remain unverified. Public deployment requires HTTPS Python hosting and a same-origin reverse proxy with callback-query logging disabled. Keep private configuration and session files outside the published site.
## Simulator data flow (5 November 2026)
The Options Simulator uses an exchange-aware catalogue from the public Alice Blue NFO/BFO contract masters. Authenticated sessions also check option-chain availability; master-listed names missing from the chain API are marked unavailable rather than routed to another symbol. Archive-only names are grouped separately.

New Simulation offers recorded option-minute closes (up to seven calendar days for currently available NSE expiry contracts), latest NSE/BSE option-chain snapshots, and the existing historical daily archive. These sources are labelled separately. Current snapshots cannot replay minute history. Minute candles are not interpolated; missing OI stays unavailable. Public deployment still requires the Python backend and same-origin HTTPS proxy.

Verified in-browser: RELIANCE 3 November minute candles, actual underlying and lot size, entry and 1/5-minute P&L changes; SENSEX snapshot, underlying, lot size and 50 strike rows. Tests: 18 Python integration/normalization groups, execution regression, 12 payoff-chart groups and 41 replay checks passed. Broker login is required only when the saved provider session expires or is revoked; API secrets remain server-side.

## Remembered sessions (5 November 2026)
Removed the artificial one-hour lifetime for JWT sessions issued by Alice Blue. The backend retains encrypted sessions and HttpOnly browser cookies up to the provider-reported expiry (30-second safety margin, 90-day upper bound). Expiry claims only bound local caching; broker responses still enforce authentication and revocation. Opaque tokens retain the conservative fallback. No refresh-token or API-key-only login endpoint is assumed.

Private OS-side utility: run alice_restore_session.py from the backend virtual environment. It validates an already stored broker token with the broker and emits a two-minute, single-use local recovery link. Do not publish or log this link. It is for the local owner recovering a lost browser cookie; no anonymous web route can mint recovery grants. No passwords, OTPs or auth codes are stored by this utility. Recovery records are encrypted and cannot be used directly as browser sessions.

SDK 1.1.7 was downloaded from PyPI and inspected statically: get_session_id(session_id=...) reuses an existing token; generating a session still requires user_id, auth_code and secret_key/checksum. The existing read-only Python REST client follows that protocol and avoids the SDK's credential-printing generation path. The SDK was not installed into the runtime. The YouTube page description was reviewed; its transcript was unavailable, so full video/code coverage is not claimed.

Verification: 22 tests pass, including provider-expiry handling, remembered cookies, one-use recovery and revoked-token rejection. The existing real broker session was restored without a new login; expiry loading and data access survived a backend restart and browser reload.

References: https://pypi.org/project/Ant-A3-tradehub-sdk-production/ and https://ant.aliceblueonline.com/productdocumentation/Authentication/ .

## Historical Snapshot Store & Opstra-Equivalent Simulator (14 November 2026)

To preserve genuine historical Open Interest, Change in OI, Bid/Ask, India VIX, Implied Volatility, and analytical Greeks beyond Alice Blue's 1-minute OHLCV endpoint:

- **Snapshot Persistence (`snapshot_store.py`)**: Stores timestamped option-chain frames in `%LOCALAPPDATA%\IWSM\option-snapshots.sqlite3` (WAL mode, indexed and deduplicated on `(symbol, exchange, expiry, timestamp)`). Every live `/snapshot` fetch automatically records a frame, and `/recorder/configure` runs an optional background IST session recorder (`09:15–15:30 IST`, Monday–Friday, excluding NSE holidays).
- **Coverage & Fallback Transparency**: `/snapshots/coverage` and `/market-status` expose the earliest recorded snapshot date (`earliestDate`), total frame count, and IST market status (`open` / `closed`). When historical replay is requested and the live broker session is disconnected, `/replay` checks `SnapshotStore` for any symbol (indices and stock F&O) and `NiftyBackup` for NIFTY, surfacing partial-coverage warnings without ever fabricating missing historical option prices.
- **Security & Validation**: `validate_config()` validates configuration invariants on startup, and `log_event()` emits structured JSON events while redacting tokens, secrets, auth codes, cookies, and authorization headers.
- **Direct API Key Auto-Renewal & Stock/Date Fallbacks (14 November 2026)**:
  - **Direct API Key (`POST /api/aliceblue/auth/apikey`)**: Supports Alice Blue's official API Key handshake (`encryption/getEncKey` / `getAPIEncpkey` + `SHA256(userId + apiKey + encKey)` + `login/getUserSID`) via the **`🔑 CONNECT ALICE BLUE`** button in the simulator header. In local owner mode, `ALICEBLUE_CLIENT_ID` and `ALICEBLUE_API_KEY` are saved locally to `%LOCALAPPDATA%\IWSM\aliceblue.env` (never committed to Git) and automatically renew daily server-side without browser redirects.
  - **Vendor SSO Client ID Persistence**: `POST /api/aliceblue/auth/login` accepts `{"clientId": "..."}` once so callbacks where `ant.aliceblueonline.com` omits `state` pass ownership verification cleanly.
  - **Resilient Parallel 1-Minute Chain Loader**: `/chart/history` skips untraded OTM/ITM strikes returning `"No Data Available"` (`allow_not_ok=True`) instead of aborting the chain with `HTTP 502`, fetches strikes concurrently (`Semaphore(8)`), caches 1-minute replays in `SnapshotStore.minute_captures`, and overlaps `NiftyBackup` + `LocalNseArchive` across all 224 NSE F&O stocks & indices (`37/37` Python tests passing).



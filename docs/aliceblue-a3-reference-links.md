# Alice Blue (ANT A3) Official API & SDK Reference Links

Always consult these primary references when debugging broker authentication, option-chain fetches, live quotes, WebSocket streaming, or historical candle issues in `backend/aliceblue/`:

- **Historical Data**: https://ant.aliceblueonline.com/productdocumentation/Historical%20Data/
- **Market Data (Multi-OHLC)**: https://ant.aliceblueonline.com/productdocumentation/Market%20Data/
- **Option Chain**: https://ant.aliceblueonline.com/productdocumentation/Option%20Chain/
- **User Registration & Auth Setup**: https://ant.aliceblueonline.com/productdocumentation/#user-registration (and [Authentication](https://ant.aliceblueonline.com/productdocumentation/Authentication/))
- **Official Python SDK (`Ant-A3-tradehub-sdk-production` v1.1.7)**: https://pypi.org/project/Ant-A3-tradehub-sdk-production/

---

## Verified Protocol Details (Checked 17 November 2026)

### 1. Base URL & Case Sensitivity
- Base REST URL: `https://a3.aliceblueonline.com`
- Base URL, paths, and JSON payload key names are **case-sensitive**.
- Contract Master V2 JSON base: `https://v2api.aliceblueonline.com/restpy/static/contract_master/V2/` (updated daily at `08:00 IST`; legacy V1 discontinued after `05 Oct 2026`).

### 2. User Registration & Authentication
- App registration at `https://a3.aliceblueonline.com/` → **My Apps** → **Create New App** → generates `appCode` (`appKey`) and `apiSecret`.
- SSO login URL: `https://ant.aliceblueonline.com/?appcode=<appCode>` → redirects with `authCode` and `userId`.
- Session exchange:
  - `checkSum = SHA256(userId + authCode + apiSecret)` (lowercase hex)
  - `POST {{BASE_URL}}/open-api/od/v1/vendor/getUserDetails` with `{"checkSum": "<sha256>"}` → returns `{"stat": "Ok", "clientId": "...", "userSession": "<jwt>"}`.
- Direct API-key flow:
  - `POST /open-api/od/v1/kani/getEncKey` (or `/rest/AliceBlueAPIService/api/customer/getAPIEncpkey`) with `{"userId": "<CLIENT_ID>"}` → `encKey`.
  - `userData = SHA256(userId + apiKey + encKey)` → `POST /open-api/od/v1/kani/getUserSID` → `sessionID`.
- All subsequent authenticated REST calls pass `Authorization: Bearer <userSession>`.

### 3. Option Chain Endpoints
1. **Get Underlying List**: `POST {{BASE_URL}}/obrest/optionChain/getUnderlying`
   - Body: `{"exch": "nse_fo" | "bse_fo" | "mcx_fo"}` → `{"status": "Ok", "result": [{"list_underlying": [...]}]}`
2. **Get Underlying Expiry**: `POST {{BASE_URL}}/obrest/optionChain/getUnderlyingExp`
   - Body: `{"underlying": "NIFTY", "exch": "nse_fo"}` → `{"status": "Ok", "result": [{"underlying": "NIFTY", "underlying_expiry": ["25AUG26", ...]}]}`
3. **Get Option Chain**: `POST {{BASE_URL}}/obrest/optionChain/getOptionChain`
   - Body: `{"underlying": "NIFTY", "expiry": "25AUG26", "interval": 10, "exch": "nse_fo"}` (`interval` ∈ `{5, 10, 15, 20, 25}`)
   - Returns `CE` / `PE` objects with `token`, `tradingsymbol`, `forInsName`, `ltp`, `pdc`, `oi`, `pdoi`, `gval`.

### 4. Market Data (Live Multi-OHLC Quotes)
- `POST {{BASE_URL}}/open-api/od/ChartAPIService/chart/get/multi/ohlc`
- Body: `[{"exchange": "NSE" | "NFO" | "NSE::index" | ..., "token": "<token>"}]`
- Response uses `"status": "Ok"` and returns `e`, `tk`, `ltp`, `open`, `high`, `low`, `close`, `avg`, `volume`, `oi`, `poi`, `ft` (`HH:mm`).

### 5. Historical Data Constraints (Critical for Debugging)
- `POST {{BASE_URL}}/open-api/od/ChartAPIService/api/chart/history`
- Body:
  - Equity / Derivatives: `{"token": "<token>", "resolution": "1" | "D", "from": "<unix_ms_str>", "to": "<unix_ms_str>", "exchange": "NSE" | "NFO" | "CDS" | "MCX"}`
  - Indices: `"exchange": "NSE::index"` (e.g. token `"26000"` for NIFTY 50, `"26017"` for INDIA VIX).
- Response uses `"stat": "Ok"` and `result: [{"time": "YYYY-MM-DD HH:MM:SS", "open", "high", "low", "close", "volume"}]`.
- **Official availability & scope rules**:
  - Available **17:30 IST to 08:00 IST on weekdays (Mon–Fri)** and **all day on weekends & exchange holidays**; **NOT available during weekday market hours (`08:00–17:30 IST`)**.
  - **NSE**: up to **2 years** of historical candles.
  - **NFO / CDS / MCX**: **current expiry** contracts only.
  - **BSE / BCD / BFO**: chart history not yet provided by A3 ChartAPIService.
  - During weekday market hours or for BSE/older historical windows, `backend/aliceblue/alice_history.py` routes to `nse_live_chain.py` (official NSE 1-minute feeds), `snapshot_store.py`, `nifty_backup.py`, and `nse_archive_fallback.py`.

### 6. Live Market-Data WebSocket (`wss://ws1.aliceblueonline.com/NorenWS/`)
1. `POST {{BASE_URL}}/open-api/od/v1/profile/invalidateWsSess` (`{"source": "API", "userId": "<id>"}`)
2. `POST {{BASE_URL}}/open-api/od/v1/profile/createWsSess` (`{"source": "API", "userId": "<id>"}`)
3. Connect WS and send:
   `{"susertoken": sha256(sha256(session_id)), "t": "c", "actid": "<id>_API", "uid": "<id>_API", "source": "API"}`
4. Heartbeat every 50s: `{"k": "", "t": "h"}`
5. Subscribe tick (`"t"`) or depth (`"d"`): `{"k": "NFO|54957#NSE|26000", "t": "t"}`

### 7. Official Rate Limits
- **Order API**: 10 req/s · 300/min · 3,000/hr · 200,000/day
- **Data API**: 20 req/s · 300/min · 3,000/hr · 200,000/day
- **Quote API**: 5 req/s
- **Non-Trading APIs**: 30 req/s

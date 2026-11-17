# Alice Blue Backend Debugging Guide (A3 REST & WebSocket)

Whenever debugging authentication, option chain, quote, or historical data issues in `backend/aliceblue/`, always consult the saved reference notes and these five official primary links:

- Historical Data: https://ant.aliceblueonline.com/productdocumentation/Historical%20Data/
- Market Data: https://ant.aliceblueonline.com/productdocumentation/Market%20Data/
- Option Chain: https://ant.aliceblueonline.com/productdocumentation/Option%20Chain/
- User Registration / Auth: https://ant.aliceblueonline.com/productdocumentation/#user-registration
- Official Python SDK: https://pypi.org/project/Ant-A3-tradehub-sdk-production/
- Workspace summary: `docs/aliceblue-a3-reference-links.md`

## Quick Triage Reminders
1. `/open-api/od/ChartAPIService/api/chart/history` is only active **17:30–08:00 IST on Mon–Fri** and all day on weekends/holidays (`NFO`/`CDS`/`MCX` current expiry only; `BSE`/`BFO`/`BCD` unsupported; `NSE` 2 years). During market hours or for expired windows, verify `nse_live_chain.py`, `snapshot_store.py`, and `nse_archive_fallback.py`.
2. `/obrest/optionChain/*` and `/chart/get/multi/ohlc` return `"status": "Ok"`, whereas `/api/chart/history` returns `"stat": "Ok"`. JSON keys are strictly case-sensitive.
3. Market WebSocket (`wss://ws1.aliceblueonline.com/NorenWS/`) requires `invalidateWsSess` -> `createWsSess` and `susertoken = sha256(sha256(session_id))` with 50s `{"k": "", "t": "h"}` heartbeats.
4. Keep `.env` / `aliceblue.env` credentials server-side only (never commit or expose them) and never display the broker brand name in public frontend UI.

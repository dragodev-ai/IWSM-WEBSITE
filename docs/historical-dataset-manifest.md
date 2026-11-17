# Historical Market Data Manifest & Schema Reference

## 1. Source & Integrity Verification
- **Source Folder**: `https://drive.google.com/drive/folders/1sHM93cKaB1O94-hawo3o3MjUFeIsubgM`
- **Local Storage Layout** (gitignored under `market-data/`):
  - Raw verified archives: `market-data/raw/google_drive/`
  - Processed Hive-partitioned Parquet tables: `market-data/processed/options_1min/`
  - Machine-readable SHA256 & partition manifest: `market-data/manifests/google_drive_1min_manifest.json`
- **Backend Reader**: `backend/aliceblue/parquet_1min_store.py` (`Parquet1MinStore`, powered by Polars lazy predicate pushdown)

## 2. Downloaded & SHA256-Verified Archives (`345,056,549` 1-Minute Option Rows Installed)

| Archive | Size | SHA-256 Checksum (`SHA256SUMS.txt` Match) | Coverage |
|---|---:|---|---|
| `sample-1min-3indices.zip` | 337.0 MB | `6b8655ef625b88337190a50e36a61fcf628dd1e80910d5a690a61c163ee2e75c` (Verified) | `2020-03` COVID crash (`NIFTY`, `BANKNIFTY`), `2024-06` Election (`NIFTY`, `BANKNIFTY`, `SENSEX`), `2026-02` Budget + full `spot_1min.parquet` |
| `nifty-1min-2024.zip` | 649.4 MB | `c8d2533d9d0c663ec672ab19859c3ed55fc2447e08af889588000ef7264c834a` (Verified) | `NIFTY` (`nse_fo`) `2024-01-01` – `2024-12-31` (12 monthly partitions + `futures_1min_2024.parquet`) |
| `nifty-1min-2025.zip` | 660.4 MB | `8588929c832a1b20adc0e297eba18f0b4a96eb73be9694c9ed297c9a72d0fe61` (Verified) | `NIFTY` (`nse_fo`) `2025-01-01` – `2025-12-31` (12 monthly partitions + `futures_1min_2025.parquet`) |
| `nifty-1min-2026.zip` | 625.3 MB | `56801f94e3186aad86ddc4c793bbfc6f9579cf1c5bab6395a8900cb55ec850da` (Verified) | `NIFTY` (`nse_fo`) `2026-01-01` – `2026-10-23` (10 monthly partitions + `futures_1min_2026.parquet`) |
| `banknifty-1min-2025.zip` | 339.3 MB | `2dfe61d8161ee902d2f5d481434d9ccee1ada4977fef22dbf848ebf0f66d9803` (Verified) | `BANKNIFTY` (`nse_fo`) `2025-01-01` – `2025-12-31` (12 monthly partitions + `futures_1min_2025.parquet`) |
| `banknifty-1min-2026.zip` | 260.9 MB | `815278d70da296b9e08cf94007f169f3008c742673de9cacca39e9620899e590` (Verified) | `BANKNIFTY` (`nse_fo`) `2026-01-01` – `2026-09-29` (9 monthly partitions + `futures_1min_2026.parquet`) |
| `sensex-1min-2025.zip` | 363.0 MB | `a372a81fd296a29ab7255f202d63008bf63be96c350b6a2a84814afbc35dffda` (Verified) | `SENSEX` (`bse_fo`) `2025-01-01` – `2025-12-31` (12 monthly partitions + `futures_1min_2025.parquet`) |
| `sensex-1min-2026.zip` | 331.3 MB | `773463be2e9d47c094ccaf47cbfa77b05dcc6621fbd4c3a9790fa32353525c67` (Verified) | `SENSEX` (`bse_fo`) `2026-01-01` – `2026-10-22` (10 monthly partitions + `futures_1min_2026.parquet`) |

*(Remaining 2019–2023 annual zip archives in the Drive folder share the identical schema and can be dropped into `market-data/processed/options_1min/` at any time with zero code changes.)*

## 3. Normalized Schema, Timezone & Units
- **Timezone**: `Asia/Kolkata` (`IST`, `+05:30`), filtered strictly to regular exchange F&O session `09:15`–`15:30 IST`.
- **Prices (`open`, `high`, `low`, `close`, `spot`, `futures close`)**: INR (`₹`), rounded to 2 decimals (`0.05` tick).
- **Quantities (`oi`, `volume`)**: Contract units / shares (integer). Historical SEBI/NSE/BSE `lotSize` is dynamically verified per `(underlying, expiry)` from exact Open Interest multiples (`NIFTY`: `75 -> 50 -> 25 -> 75 -> 65`; `BANKNIFTY`: `20 -> 25 -> 15 -> 30 -> 35 -> 30`; `SENSEX`: `10 -> 20`).
- **Implied Volatility & Greeks**:
  - Parquet `iv` is stored as a decimal fraction (`0.134` = `13.40%`) and converted to percentage (`13.40`) by `Parquet1MinStore`.
  - `delta` (`[-1, 1]`), `gamma`, `theta` (INR per calendar day), and `vega` (INR per `1%` vol point) are Black-76 analytical sensitivities on put-call-parity forward (`ACT/365`).
  - Deep OTM ₹0.05–₹0.20 ticks where Black-76 IV is unidentifiable (~5.6% of rows) preserve `iv = None` (never `0` or `NaN`).

## 4. Documented Source Limitations
1. **No historical Bid/Ask order book**: Historical 1-minute archives record traded OHLCV + OI; `bid` and `ask` remain `None` (`—` in UI).
2. **Missing Dates / Futures**:
   - `NIFTY` omits `2021-10-29` and `2024-01-20` in upstream source.
   - `Jan–Sep 2026` index futures bars are absent in `futures_1min_2026.parquet`; cash `spot` is exact on every minute and futures are never substituted for spot.
3. **Fallback Priority**: Used strictly as **Priority 3 (`HISTORICAL`)** when live Alice Blue / live exchange feeds do not cover an expired or historical window, and explicitly badged `HISTORICAL` in API metadata and UI status pills.

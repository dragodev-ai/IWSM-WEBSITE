# NIFTY five-year backup

Created 5 November 2026 from verified official NSE daily derivative reports already downloaded to `market-data/nse-derivatives`. This task reused and audited the retained originals rather than downloading duplicate reports.

Requested window: 5 November 2021–4 November 2026. Available reports: 8 November 2021–4 November 2026, 1,239 report dates, 2,149,652 option records, 293 distinct observed expiry dates. Six yearly worksheets include every retained NIFTY CE/PE row within that window. Coverage and unavailable-date worksheets disclose availability; unavailable dates are not assumed to be holidays. Original reports and SHA-256 references remain in the archive and indexed `sources` table.

## Files

- `market-data/nifty-backup/NIFTY-five-year-options.xlsx`: portable Excel export; 127 MB, six year sheets because the total exceeds Excel's single-sheet row limit.
- `market-data/nifty-backup/nifty.sqlite3`: indexed server-side counterpart of the same daily source records, with NIFTY futures and available underlying prices for replay. The website queries this index instead of parsing a large workbook on every request.
- `market-data/nifty-backup/NIFTY-options-YYYY.csv`: Excel-ready yearly exports.
- `market-data/nifty-backup/coverage.json`: counts and availability audit.

## Website behavior

The local Python service must be running. `/api/aliceblue/replay` and `/snapshot` try broker data, then automatically load exact matching NIFTY backups for supported broker/authentication/data errors. Historical expiry selection reads the local index directly. Missing contracts or date windows still return an error; another date's price is never silently substituted in replay.

Successful broker minute/snapshot loads are saved as compressed public market-data captures in the local index. On failure, matching saved minute observations take priority over daily prices. Snapshots are dated captures, not minute history. A persistent LOCAL NIFTY BACKUP label shows the replay timestamp and resolution. Existing simulator studies remain in the browser's study store.

Five-year NSE bhavcopies contain daily OHLC, settlement, open interest and volume; they do **not** provide historical one-minute option-chain observations. Minute controls stay disabled for daily data. Legacy reports omit lot sizes/underlying prices; those fields remain unavailable and monetary positions require verified dated lot sizes. The backup is a fixed historical window, not a substitute for live quotes or an automatic five-year intraday feed.

This is installed and tested on the local website. GitHub Pages cannot execute the Python service or read the private local index. Public deployment needs this backend and data hosted separately; no credentials or session database belong in a public repository.

## Verification

The completed workbook passed ZIP integrity and an independent streaming comparison of every data cell against the verified yearly CSVs. The installed backend's 26 tests pass, including broker-disconnected daily fallback, exact date/expiry isolation, missing lot preservation and cached-minute priority. Local browser testing loaded November 2021 data, selected historical expiries and advanced daily prices. No live broker order endpoints are implemented or called.

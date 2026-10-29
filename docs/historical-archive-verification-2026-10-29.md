# Historical archive connection — 29 October 2026

The local simulator now uses `/api/nse-library` and the downloaded archive catalog rather than limiting its calendar to the bundled sample dates. Verified catalog: 1,240 downloaded trading dates, 307 symbols, 19 October 2021 through 16 October 2026.

## Browser checks

- Loaded the earliest available date, 19 October 2021. Legacy reports omit lot size and underlying reference; these remain unavailable rather than being replaced with current specifications.
- NIFTY, 14 October 2025, expiry 30 December 2025, 25,100 call: paper buy at 742.45, 75 units. Replay to 15 October: mark 881.55, gross P&L 10,432.50. Sell the matching put at 336.70: next-day mark 255.65, gross P&L 6,078.75.
- Moving that call to 14 November preserved its 742.45 entry and used the recorded 1,048 mark: gross P&L 22,916.25.
- Rewinding to 13 October hid the later orders without deleting them; returning to 14 October restored the original entries. New trades before retained future orders require an explicit branch.
- NIFTY, 14 October 2024, expiry 26 December 2024, 25,100 call/put: call buy 831.40 and put sell 415.60, 25 units each. On 15 October marks were 760.40 / 448.10; gross P&L was -1,775 / -812.50.
- Daily autoplay crossed the initial 13 November 2024 loaded-window boundary and reached 25 November. Entries stayed 831.40 / 415.60 and marks were 99.40 / 776.45. Pause worked.
- Selecting Saturday 23 November preserved the active 25 November cursor and both orders, with a missing-trading-date message.

## Implementation safeguards

- Extension rejects conflicting quote observations, validates original fills against preserved observations, and checks every intervening downloaded daily close for exit rules.
- Large histories retain traded-contract observations, an authentic frame anchor, and current full chains. Selecting a pruned chain fetches its original archive again.
- Async loads do not overwrite a simulation changed during loading. Failures preserve the current book.
- Daily archive, intraday imports and synthetic practice stay distinct; no five-minute prices are manufactured from daily closes.

## Verification and limits

Passed: 31 archive behavior checks (including a 200,004-observation compaction stress test); existing 186+ pricing, 102 historical-data, 125 research, 41 replay, 24 scenario/storage and 10 terminal-model checks. Syntax and diff whitespace checks passed.

The tested browser already has ten saved studies and reports storage full. The active tradebook remains intact; Export backup remains available. No existing studies were deleted.

The full archive is served by the local preview backend. GitHub Pages cannot read files from the user's D: drive; public access to this full library requires a deployed archive service. The public static site retains bundled/imported-data support.

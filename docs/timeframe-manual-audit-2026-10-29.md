# Timeframe and simulator manual audit — 29 October 2026

## Root cause

The installed archive contains official daily derivative closing reports, not historical intraday snapshots. Every daily observation is represented at 15:30 IST. Enabling 5/15/30/60/120-minute controls on these reports would fabricate observations. The controls are intentionally disabled in daily mode.

No intraday/minute/tick dataset was found in the website data inventory. The existing explicitly labelled synthetic practice dataset contains five-minute observations on 14–15 October 2026.

## Manual intraday control checks

These figures are **synthetic practice**, not recorded exchange prices or trading results.

At 09:15 on 14 October, paper-bought NIFTY 22,700 CE, expiry 19 October, 65 illustrative units, entry 195.33.

| Action | Resulting clock | Mark | Gross P&L |
| --- | --- | --- | --- |
| Entry | 09:15 | 195.33 | 0 |
| +5 minutes | 09:20 | 201.91 | 427.70 |
| +15 more minutes | 09:35 | 221.32 | 1,689.35 |
| +30 minutes | 10:05 | 250.86 | 3,609.45 |
| +1 hour | 11:05 | 239.35 | 2,861.30 |
| +2 hours | 13:05 | 204.03 | 565.50 |

Reverse steps of 5, 15, 30, 60 and 120 minutes returned from 13:05 to 09:15 and original zero P&L. A separate +15-minute step from entry reached 09:30, mark 214.99 and P&L 1,277.90.

Sold the matching futures at 09:30 at 22,732.04; +5 minutes gave 22,741.75 and -631.15 gross P&L for 65 units. EOD reached 15:30, SOD reached 09:15, and +1d reached 15 October 09:15 with both original entries retained.

## Tab checks

Opened and verified selected/rendered states for left/right Positions, Option chain, Payoff, Session, Trades and Greeks. Rendered Payoff, Future scenario, Recorded P&L, Underlying, Strategy, Combined and Trade log views. Opened a contract premium history from its chain price.

Settings, OI Chart, Saved, Prebuilt strategies, Historical Chart and Replay guide dialogs opened and closed. Futures chain and paper sell worked. Builder, Backtest, Compare, Research, Screener & Portfolio and Simulator navigation opened their corresponding panels. These navigation checks do not claim exhaustive execution of every form in the other workspaces.

The previously observed browser storage quota remains a separate save limitation; existing studies were not deleted.

## Backend change and real data checks

Added a 10-minute LRU cache for up to eight historical windows, bounded to 64 MiB of serialized responses. Cache keys include the archive index modification time. Identical pending requests share one Python archive read; unsuccessful responses are not cached. Existing validation and different-window concurrency limits remain.

Queried actual local official archive data for 14 October 2025: NIFTY 1,535 rows, RELIANCE 196, TCS 248, TATAMOTORS 81. None has an intraday timestamp. Cold one-day loads measured 320–634 ms; repeat cached loads measured 7–59 ms locally. These are local cached daily response timings, not Internet NSE feed latency or a general performance guarantee.

Passed 12 backend cache checks, 31 archive integration checks, and 41 replay checks after the backend change.

## Direct NSE intraday dependency

NSE documents 1/5-minute snapshots as subscription feeds distributed in binary files through SFTP. Historical order/trade data is a separate subscription product delivered through an online platform. A public daily-report download is not access to either service. No paid subscription or credentials were created or inferred.

Official references checked on 29 October 2026:

- https://www.nseindia.com/static/market-data/real-time-data-subscription
- https://www.nseindia.com/static/market-data/eod-historical-data-subscription

Real historical minute replay remains unconnected until access to the appropriate historical intraday service is available. Its ingestion must preserve observation times, historical contract identifiers and dated units; daily closes and current live option-chain quotes cannot substitute for them.

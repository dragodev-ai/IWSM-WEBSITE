# Reference-style simulator layout — 29 October 2026

## Scope

Reconstructed `strategy-builder.html#options-simulator` around the supplied Nifty Trader screenshot and observed simulator workflow. IWSM branding and its green light / blue dark themes remain. Other Strategy Lab routes remain accessible through the compact navigation.

The interface now has:

- A compact quote/header bar with Settings, OI Chart, Saved, Prebuilt, Historical Chart and Reset session.
- Date, IST time, expiry, backward/forward time shortcuts, autoplay and a replay slider.
- Left Option chain / Positions tabs, expiry controls, Options / Futures, optional chain columns, expand/restore and compact B/S order buttons.
- Right Payoff / Positions / Session tabs and an analysis selector retaining future scenarios, recorded P&L, individual-contract history and the other existing charts.
- Trades / Greeks tabs beneath the payoff, with Save, Add, Prebuilt, Close all and Columns controls.
- LTP buttons opening the selected contract's observed premium history.
- Working modal dialogs for settings/import, saved studies, prebuilt strategies, OI, underlying history and order entry.
- A taller payoff plot with a zero tick and compact rupee axis labels.

## Validation

The missing Option chain / Positions tab behaviour was observed before implementing the interface. New tabs then passed pointer and keyboard interaction checks.

Eight automated suites passed: 186+ pricing/risk checks, 102 historical checks, 125 research assertions, 236 workspace/portfolio assertions, 21 dated-strategy checks, 41 replay checks, 24 scenario/storage checks and 10 new terminal-model checks.

Independent review identified three regressions in the first reconstruction: inconsistent dividend assumptions between futures-reference chain IV and Greeks; lower position Greeks ignoring the selected reference; and unreachable contract history. Those were corrected. The new regression suite was observed failing before the reference-aware helpers were implemented, then passing. It covers Black–76 delta parity, synthetic/futures consistency and futures-only Greeks without a spot observation.

Browser checks completed:

- Buy call and sell put, then advance five minutes. Entry prices remained fixed while LTP and P&L changed.
- Open left Positions, right Positions, Trades, Greeks and Session views.
- Click LTP to display the individual contract's recorded history.
- Select Futures as the model reference and observe updated signed Greeks.
- Hide/restore the Units column through the Columns dialog.
- Enter a futures paper order through the Add ticket.
- Open OI, historical-price, settings, saved-study and prebuilt dialogs; save a study.
- Expand/restore the option chain and move between tabs with arrow keys.
- Navigate Builder, Backtest, Compare, Research, Screener & Portfolio and Simulator, waiting for each active tab and its corresponding visible content.
- Check responsive layout at 364 CSS-pixel mobile and 768 CSS-pixel tablet widths. Document scroll width equalled viewport width; panels stacked on mobile.
- Confirm the dark theme uses blue `#68a8ff` with navy panels and restores the green light theme.
- Final local browser console contained no errors.

## Boundaries

The replay and storage engines remain unchanged. The reference's branding, private backend, credentials and paid market data were not copied. Existing recorded-data/import and explicitly synthetic practice modes remain. Daily archives cannot supply intraday observations; future scenarios are model projections. Broker margin and executable fills are outside this simulator.

Desktop layout follows the supplied arrangement; mobile stacks panels instead of shrinking desktop controls beyond usability. This is browser viewport testing, not a certification of every physical device.

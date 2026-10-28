# Strategy Lab simulator audit — 28 October 2026

## Implemented

The Nifty Trader simulator route maps to `strategy-builder.html#options-simulator`. The rest of Strategy Lab retains its existing routes and design. The simulator keeps the IWSM green/light and blue/dark themes.

- Main workflow: symbol, recorded date/time in IST, contract expiry, backward/forward shortcuts, autoplay and timeline.
- Options and futures have direct paper Buy/Sell actions, editable order lots and an Add position ticket.
- Primary analysis: payoff, Greeks, recorded P&L and future scenario. Other charts and trade history remain under More charts.
- Data import, costs, rates, model reference, liquidity guidance and optional recording sit under Data & settings. Prebuilt strategies have their own disclosure.
- Future scenario changes date/time, underlying percentage and IV percentage points without changing recorded fills or the replay cursor. Projection stops at the earliest open expiry. Expired legs use intrinsic value; later legs retain model time value. Futures keep their recorded basis. Executed costs are included; hypothetical future exit costs and settlement are not simulated.
- Saved studies no longer have the old five-study cap. Compact observations reduce repeated field names; shared datasets are stored once per collection. Old saved arrays and ordinary JSON backups still open. Browser quota limits still apply; export remains available.
- Symbol changes now load matching contracts, boundary controls disable appropriately, and small Gamma values retain up to six decimal places.

## Reference installation and use

The following references were installed separately from the vanilla IWSM website in `external-references-20261028/`:

| Source | Use | Verification |
| --- | --- | --- |
| [JCodesMore website cloner](https://github.com/JCodesMore/ai-website-cloner-template) | Installed `clone-website` skill; observe/build/compare workflow; isolated Next.js reference template | Dependencies installed; lint, type check and production build passed. Initial font fetch failed under restricted networking; retry with network access passed. |
| [Elayadesign design skills](https://github.com/elayadesign/ai-design-skills) | Installed landing-page-design skill; disclosures, hierarchy, restrained spacing and state feedback, adapted to the existing trading interface | Skill read and applied without replacing the existing website framework or global branding. |
| [Option Strategy Simulator](https://github.com/OIV8/Option_Strategy_Simulator) | Isolated Python environment; model price and Greeks reference; explicit time and volatility scenario assumptions | Streamlit imports; known Black–Scholes call price 10.450584 verified. |
| [options-gym](https://github.com/iliutaadrian/options-gym) | Isolated React reference; time controls and model portfolio behaviour | Dependency installation and Vite production build passed. No source copied into IWSM. |
| [bkerler analysis notes](https://gist.github.com/bkerler/301c33b363ad3ff02160b3a11ddc247e) | Installed analysis skill; evidence, hypotheses, reproducibility and durable notes | Browser-relevant guidance used; native IDA/Ghidra instructions do not apply to this website. |

The two finance references are model simulators, not providers of Indian historical intraday prices. Their US price files were not presented as Indian data. Newly installed skills are available in subsequent turns.

## Observed reference and evidence boundaries

Observed Nifty Trader's current simulator, settings, expiry/contract switches and replay controls in the in-app browser. The important behaviour is fixed entry prices, changing LTP/P&L as replay advances, and model payoff inspection by underlying value.

REA statically analysed two previously downloaded public shipped JavaScript files: 157,918 bytes, 12 recovered modules, zero parse failures. Parent Evidence: `ev_425ca50d7b7ee29520723669d44294405863d600f70be4466cdadbdd597a1f4b`. Static coverage is partial, including a 5,000 semantic-node ceiling. This establishes frontend candidates, not private server code or live request execution. The retained source capture is distinct from the current browser observation.

No private Nifty Trader backend, credentials or paid dataset was integrated. The implementation uses IWSM's own engine and connected archive/import workflow.

## Verification

Automated suites passed: 186+ pricing/risk checks, 102 historical replay checks, 125 research assertions, 236 workspace/portfolio assertions, 21 dated strategy checks, 41 replay checks, and 24 new scenario/storage checks. New behaviour tests were observed failing before implementation, then passing.

Browser checks completed:

- Builder: Bull Call Spread preset, editable positions and resulting model risk.
- Backtest: included recorded-price replay and observation controls.
- Compare: adding a current-strategy snapshot with independent metrics.
- Research: OI/PCR, IV/skew, contract history and OI/straddle history.
- Screener/portfolio: screening loaded contracts and recalculating a selected saved study with a 2% reference change.
- Simulator: buy call, five-minute repricing, fixed entry price, scenario date/spot adjustment with unchanged recorded cursor, Greeks, recorded P&L and trade log.
- Storage: sixth saved study, selected-study reopen, migration to shared compact storage and reopen after migration.
- Backward replay: later entry blocks trading; Branch here preserves the original path and permits a new path.
- Futures: paper buy, target rule and a 30-minute jump exiting at the first intermediate qualifying recorded quote.
- Symbol switch: BANKNIFTY recorded contracts, matching reference and historical 30-unit lot size at the observed October 2026 record.
- Responsive: document width equals scroll width at narrow mobile (364 CSS px) and tablet (748 CSS px). Desktop light and dark themes checked. This is browser viewport testing, not certification on every physical device.

Independent code review found no concrete correctness or data-loss regressions in the scoped changes. It reviewed the source/diff but did not independently rerun browser tests.

## Data and modelling limits

Daily archives support daily closes only. Five-minute historical P&L requires timestamped intraday option/futures and matching underlying observations. The included five-minute practice dataset remains explicitly synthetic. Missing quotes stay missing. Forward replay means later observations already in the selected data; future scenario means a pricing model, never a prediction or a future observed quote.

GitHub Pages cannot run the local archive API. Public preview users can use included data, labelled practice, or import their own recorded CSV/JSON. The connected local preview can load the on-disk archive library. Margin, broker execution, statutory charges and physical settlement are not reproduced.

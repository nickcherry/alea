# Dashboards

This is the design contract for the standalone HTML pages we drop into
`alea/tmp/` from CLI commands like `latency:capture`,
`reliability:capture`, and `dashboards:build`. Pages built by
`dashboards:build` ship to the alea Cloudflare Worker when invoked
with `--deploy`; everything else is operator-local. The contract below
exists so each new page slots into the same visual language without
bikeshedding.

## What "temp dashboard" means

- A single `.html` file written to `alea/tmp/`, with a sibling
  `<basename>.assets/` folder carrying the CSS+JS the page references.
  The folder is a frozen-in-time snapshot of the assets at generation
  time, so a year-old report still renders even after the source assets
  have evolved.
- One companion `.json` file written next to the HTML, with the raw
  payload the page renders. The JSON is the source of truth; the HTML
  is a view.
- All assets ship from a public CDN (uPlot only) or from the local
  sibling assets folder. No build step, no asset pipeline.
- Auto-opened on macOS via `open <path>` unless `--no-open` is passed.
- Written in the **Alea dark theme** — see "Visual identity" below. The
  dark felt-green panels with antique-gold accents are the shared
  brand identity across every Alea report.

## On-disk layout

```
tmp/
  latency_2026-05-06T17-58-31-143Z.html
  latency_2026-05-06T17-58-31-143Z.json
  latency_2026-05-06T17-58-31-143Z.assets/
    alea.css                      ← shared design system
    latency.css                   ← page-specific layout
    latency.js                    ← page-specific behavior
```

The HTML uses **relative** `<link>` and `<script>` hrefs into the
sibling assets folder, so the file is portable: drag the `.html` and
its `.assets/` folder anywhere together and it still renders. Different
builds get different assets folders, so the past is never invalidated
when we change a CSS rule.

## Stack

- **Alea design system**: source CSS lives in
  [`src/assets/web/alea.css`](../src/assets/web/alea.css). Tokens, base
  layout, cards, tabs, tables, tooltip, legend, section rule, top-nav,
  metric/badge/bar/mono utilities. Every page links it. The
  TypeScript-side helper module
  [`src/lib/ui/aleaDesignSystem.ts`](../src/lib/ui/aleaDesignSystem.ts)
  exposes:
  - `aleaDesignSystemHead({ stylesheets })` — emits the font preconnect
    and `<link>` tags for the page's stylesheet bundle.
  - `aleaBrandMark()` — dice + `Alea` wordmark for the header.
  - `aleaChartTokens` — axis/grid/reference-line colors uPlot reads, so
    chart chrome stays in lockstep with the page palette.
- **`copyDashboardAssets`**:
  [`src/lib/ui/copyDashboardAssets.ts`](../src/lib/ui/copyDashboardAssets.ts).
  Each `write*Artifacts` calls this with the page's asset filenames. It
  copies `alea.css` plus the page assets into the sibling
  `<basename>.assets/` folder and returns relative hrefs the renderer
  pipes into `aleaDesignSystemHead` and `<script src=...>`.
- **uPlot 1.6**: charting. Same version pinned across pages. Loaded
  from a public CDN.
- **No JS framework**. Plain DOM, plain `<script>` tags, plain event
  listeners.
- **No CSS preprocessor**. The shared sheet is plain CSS authored as a
  file. Page CSS is plain CSS authored as a file.

## Config references must read the actual constant

Any setting, threshold, or config knob surfaced on a dashboard page —
training thresholds, vote floors, hydrate counts, supported periods, the
trade-decision period, etc. — must come from the same exported
constant the rest of the codebase reads, not a hard-coded literal in the
renderer or loader. The loader threads the value onto the payload, the
renderer reads it from the payload, and the test asserts the rendered
output reflects the live constant. If you change the constant, the
dashboard updates with no second edit. Examples:

- [`TRAINING_OUTCOME_MIN_ABS_MOVE_PCT`](../src/constants/training.ts)
  → `payload.trainingThresholdPct` on the proxy accuracy page and
  `selectionConfig.trainingOutcomeMinAbsMovePct` on the trade committee
  page.
- [`TRADE_DECISION_PRIMARY_PERIOD`](../src/constants/tradeDecision.ts) and
  [`TRADE_DECISION_SUPPORTED_PERIODS`](../src/constants/tradeDecision.ts)
  → `decisionConfig.period` and `decisionConfig.supportedPeriods` on the
  dry-run page. The page-level period toggle reads `supportedPeriods` so
  the option set matches the schema's `dry_run_period` CHECK constraint;
  the dry-run process defaults to
  [`TRADE_DECISION_DEFAULT_PERIODS`](../src/constants/tradeDecision.ts).

If a value appears on a page and there is no constant for it, add the
constant under `src/constants/` first; do not inline it into the
renderer.

## No marketing chrome

These pages exist to surface data the operator can act on. They are not
product marketing surfaces. When you author or edit a page, **do not**
add:

- Hero / summary metric cards above the real content. The big-number
  tile-row at the top of a SaaS landing page is exactly what we do not
  want. Numbers belong inside the tables and charts that contextualize
  them, not floating in a decorative strip.
- Editorial blurbs or narrative descriptions under section headers
  ("This card shows X, which helps you Y…"). The section heading plus
  the data is enough. If a number needs a one-line clarification, use
  the existing tooltip pattern (`infoTip`) on the column header — not a
  paragraph.
- "About this dashboard" copy, subtitle prose beyond the timestamp +
  sample count, or any other framing text.
- Tooltip text that just restates the column name.

Default new copy to **off**. If a description seems necessary, the bar
is "could a literate operator not figure this out from the column name
and the number." Most of the time the answer is yes; skip it.

## Authoring a new dashboard page

1. Add `src/assets/web/<page>.css` for page-specific layout.
2. Add `src/assets/web/<page>.js` for page-specific behavior (optional;
   skip if the page is server-rendered with no interactivity).
3. Author the renderer as a pure function `(payload, assets) → string`.
   Use `aleaDesignSystemHead({ stylesheets: assets.stylesheets })` in
   `<head>`. End the body with the page's data payload as
   `<script type="application/json" id="<page>-payload">…</script>`,
   then emit a `<script src>` tag for each entry in `assets.scripts`.
4. The `write*Artifacts` wrapper calls `copyDashboardAssets({ htmlPath,
pageAssets: ["<page>.css", "<page>.js"] })`, then passes the
   returned hrefs into the renderer.
5. The page-side JS reads bootstrap data from
   `document.getElementById("<page>-payload").textContent`. Don't
   string-interpolate JS values into the inline script — keep the JS
   purely static and let the JSON tag carry the dynamic data.

## Visual identity

The look is "modern analytics dashboard + Monte Carlo casino table."
Dark felt-green panels, thin antique-gold rules, ivory text, classical
serif for titles and numerics, Inter for everything else. The theme
should come from restraint — gold is an accent for borders, dividers,
active states, headings, and aggregate-line emphasis, not a fill color
for everything.

### One source of truth for shared chrome

The page-level backdrop (the gold + green ambient glow over the deep
felt-green base) is defined **once**, on `body` in `alea.css`, with
`background-attachment: fixed` so the gradients pin to the viewport
instead of resizing with the body's content height. Every dashboard
must use this body backdrop unchanged.

**Do not** add per-page `body { background: … }` overrides. Different
content lengths must never produce different-looking pages. If you
need to change the backdrop, change it in `alea.css` and it propagates
everywhere. Same rule applies to any other foundational chrome
(shell, header, top-nav, page-controls strip, section rules, panels,
cards, tables, pill tabs): edit the shared rule, not the dashboard.
Page CSS exists for layout that's genuinely page-specific (a chart's
aspect ratio, a table's column widths), not to override defaults that
should stay uniform.

Reusable components and utilities live in `alea.css`. Reach for these
before authoring page-local CSS:

- **Scaffolding**: `.alea-shell`, `.alea-header` (with auto gold
  hairline rule), `.alea-main`, `.alea-brand-row`, `.alea-title`
  (Cormorant Garamond ~28px), `.alea-subtitle` (muted, separator via
  `<span class="sep">·</span>`).
- **Top-level page nav**: `.alea-topnav`, `.alea-topnav-link` (with
  `.active` and `.disabled` modifiers), `.alea-topnav-soon` for
  placeholder slots.
- **Cards**: `.alea-card` with optional `.with-corners` for the
  CSS-only L-bracket flourishes. `.alea-card-header`,
  `.alea-card-title`, `.alea-card-meta`.
- **Tabs**: `.alea-tabs` + `.alea-tab` (with `.active`).
- **Tables**: `.alea-table-wrap` + `.alea-table` (gold uppercase
  headers, hairline gold row borders, hover row highlight).
- **Tooltips**: `.alea-tooltip` (with `.visible`), `.alea-tooltip-head`,
  `.alea-tooltip-row` (`.name` + `.value`).
- **Legend**: `.alea-legend`, `.alea-legend-item` (with `.muted`),
  `.alea-legend-swatch` (with `.dashed` modifier for aggregate lines).
- **Section rule**: `.alea-section-rule` for in-card section headings
  in gold uppercase with a trailing gradient rule.
- **Metric grid**: `.alea-summary-grid` (default 3 cols, add `.cols-4`
  for four), `.alea-metric`, `.alea-metric-label`, `.alea-metric-value`
  (with `.positive` / `.negative` tone variants), `.alea-metric-sub`.
- **Bar (proportion indicator)**: `.alea-bar-track`, `.alea-bar-fill`.
- **Badge**: `.alea-badge` with `.ok`, `.warn`, `.bad` / `.diff`,
  `.muted` / `.miss` variants.
- **Utilities**: `.alea-mono`, `.alea-num-positive`, `.alea-num-negative`,
  `.alea-nowrap`, `.alea-muted`.

## Brand colors

Series colors are tuned for the dark Alea palette. Each venue keeps its
brand identity (Coinbase blue, Binance amber, etc.) but is brightened
where necessary so the line stays readable on a felt-green panel. The
canonical palette lives in
[renderPriceChartHtml.ts](../src/lib/exchangePrices/renderPriceChartHtml.ts)
under `colorByExchange`:

| Color                  | Hex       | Reserved for                                   |
| ---------------------- | --------- | ---------------------------------------------- |
| Coinbase spot          | `#2a8bff` | Coinbase spot venues                           |
| Coinbase perp          | `#5fa8ff` | Coinbase perp venues                           |
| Binance spot           | `#f0b90b` | Binance spot venues                            |
| Binance perp           | `#d99d2c` | Binance perp venues                            |
| Bybit spot             | `#ff8533` | Bybit spot venues                              |
| Bybit perp             | `#ffa75e` | Bybit perp venues                              |
| OKX spot               | `#cbd5e1` | OKX spot venues                                |
| OKX swap               | `#94a3b8` | OKX perp/swap venues                           |
| Bitstamp               | `#27d18e` | Bitstamp                                       |
| Gemini                 | `#34d2d4` | Gemini                                         |
| Polymarket / Chainlink | `#ff5470` | Settlement-feed line; emphasized in both modes |
| Spot VWAP (marble)     | `#e8dec4` | Volume-weighted spot consensus, dashed         |
| Perp VWAP (gold)       | `#d7aa45` | Volume-weighted perp consensus, dashed         |

For non-venue series (e.g. consensus vs. Chainlink on the reliability
chart), use the chart accents from
[`aleaChartTokens`](../src/lib/ui/aleaDesignSystem.ts):
`bodyColor` (`#5b95ff`, "the move") and `wickColor` (`#ffa566`, "the
envelope"). Pick two complementary colors from this set so adjacent
dashboards feel like the same product.

## Data flow

1. CLI command calls into `src/lib/<domain>/`.
2. The domain layer returns a structured payload (a typed object).
3. The CLI hands the payload to `write<Page>Artifacts`, which:
   a. Calls `copyDashboardAssets` to lay down the sibling `.assets/`
   folder.
   b. Renders the HTML via `render<Page>Html({ payload, assets })`.
   c. Writes the HTML and JSON sidecar.
4. The HTML is auto-opened on macOS.

The renderer is a pure function: `(payload, assets) → html string`. It
does not touch the filesystem, the database, or the network. This
makes the renderer trivially testable and lets a `*:chart` companion
command re-render an older JSON without re-running the analysis. The
asset-copy is the only side effect; it lives in the `write*Artifacts`
wrapper, not in the renderer.

## Deployed pages

The alea Cloudflare Worker at `https://alea.nickcherryjiggz.workers.dev`
serves a single multi-page dashboard. Each page is still a standalone
static HTML asset following the contract above; the worker just
arranges them under one host and one shared top nav.

The dashboard sequence is a research-to-production funnel, not a set
of interchangeable reports:

| Phase                 | Page               | Decision it supports                                                                                           |
| --------------------- | ------------------ | -------------------------------------------------------------------------------------------------------------- |
| Proxy calibration     | Proxy accuracy     | Whether Pyth is good enough as the historical proxy for Polymarket settlement.                                 |
| Market microstructure | Price paths        | How quickly Polymarket prices leave the 50c area, informing realistic order timing.                            |
| Candidate research    | Filter exploration | Which filter/config candidates look predictive, redundant, or worth pruning.                                   |
| Roster construction   | Trade committee    | Which candidates were selected per regime and whether selection thresholds are calibrated.                     |
| Committee holdout     | Backtest           | Planned: replay committee predictions over the post-training holdout without Polymarket order-book simulation. |
| Live-like rehearsal   | Dry run            | Validate the live decision path plus quote observation and fill simulation without placing orders.             |
| Production            | Live trading PnL   | Track realized results from actual order placement.                                                            |

| Route           | Page               | Source                                                                                              |
| --------------- | ------------------ | --------------------------------------------------------------------------------------------------- |
| `/`             | Live trading PnL   | [`renderTradingPerformanceHtml.ts`](../src/lib/trading/performance/renderTradingPerformanceHtml.ts) |
| `/proxy/`       | Proxy accuracy     | [`renderProxyAccuracyHtml.ts`](../src/lib/polymarket/dashboard/renderProxyAccuracyHtml.ts)          |
| `/price-paths/` | Price paths        | [`renderPricePathsHtml.ts`](../src/lib/polymarket/dashboard/renderPricePathsHtml.ts)                |
| `/exploration/` | Filter exploration | [`renderExplorationHtml.ts`](../src/lib/exploration/renderExplorationHtml.ts)                       |
| `/committee/`   | Trade committee    | [`renderTradeCommitteeHtml.ts`](../src/lib/committee/dashboard/renderTradeCommitteeHtml.ts)         |
| `/dryrun/`      | Dry-run committee  | [`renderDryRunHtml.ts`](../src/lib/dryRun/dashboard/renderDryRunHtml.ts)                            |

The shared top nav lives in
[`src/lib/ui/topNav.ts`](../src/lib/ui/topNav.ts) and is rendered by
each page's HTML so the deployed site feels like one app even though
every page is a self-contained asset bundle.

## Build & deploy

The deployed site is built in one shot by
[`dashboards:build`](../src/bin/dashboards/build.ts):

```
bun alea dashboards:build           # build only — writes tmp/web/
bun alea dashboards:build --deploy  # build + bunx wrangler deploy
```

The command lays the on-disk tree out in the routing shape Wrangler
expects:

```
tmp/web/
  index.html               ← live trading PnL (served at /)
  index.assets/            ← its frozen CSS+JS
  data.json                ← raw payload for the trading page
  proxy/
    index.html             ← proxy accuracy (served at /proxy/)
    index.assets/
    data.json
  price-paths/
    index.html             ← price-path calibration (served at /price-paths/)
    index.assets/
    data.json
  exploration/
    index.html             ← filter exploration (served at /exploration/)
    index.assets/
    data.json
  committee/
    index.html             ← trade committee (served at /committee/)
    index.assets/
    data.json
  dryrun/
    index.html             ← dry-run committee (served at /dryrun/)
    index.assets/
    data.json
```

Wrangler config lives at [`wrangler.toml`](../wrangler.toml) and
points its `[assets].directory` at `tmp/web/`. The trading page
needs Polymarket auth (`POLYMARKET_PRIVATE_KEY` +
`POLYMARKET_FUNDER_ADDRESS`); when those aren't set the build skips
it with a warning so the rest of the site can still rebuild. The
price-path page builds from `polymarket_price_samples`, the proxy page builds
from `polymarket_resolutions` + Pyth candles, the exploration page builds from
`filter_runs` + `bar_regimes`, the trade committee page builds from
`committee_selections`, and the dry-run page builds from `dry_run_decisions`
plus the shared trade-decision constants shown on the page — all five work
without trading creds.

The actual `wrangler deploy` shellout lives in
[`runWranglerDeploy.ts`](../src/lib/dashboards/runWranglerDeploy.ts);
`dashboards:build --deploy` is the only caller.

## File-naming convention

`tmp/<command>_<UTC-iso>.html` plus `tmp/<command>_<UTC-iso>.json` plus
`tmp/<command>_<UTC-iso>.assets/`. The prefix matches the CLI verb
(`latency_*`, `reliability_*`) so a `ls tmp/` listing groups runs by
analysis. The timestamp uses the standard
`Date#toISOString().replace(/[:.]/g, "-")` form so it sorts lexically.

## When something doesn't fit

If a page needs functionality that doesn't fit cleanly into this
contract (a real build step, a JS framework, a backend, a light-mode
toggle, more than a handful of asset files), it has outgrown "temp
dashboard" — promote it to a real product surface and document it
under its own doc.

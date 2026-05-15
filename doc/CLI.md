# CLI

The CLI is the operator-facing contract for Alea.

Everything that matters is reachable through one non-interactive entrypoint:

`bun alea`

(or, when the `bin` is on PATH, just `alea`).

## Core Rules

- Use one entrypoint: `bun alea`.
- Operator workflows belong under `bun alea <command>`, not ad hoc package scripts.
- `package.json` scripts are for repo maintenance only: typecheck, test, lint, format, and the `alea` wrapper.
- Commands must stay non-interactive by default.
- Help output must be enough for a human or agent to understand side effects before running the command.
- Parsing and validation belong in the command definition (Zod schemas on every option/positional), not in downstream business logic.
- Shared CLI mechanics live in `src/lib/cli/`.
- Domain logic lives outside command files; command files should stay thin glue between input parsing and library code.

## Active Command Families

- `db:*`
  `db:migrate`
- `candles:*`
  `candles:sync` — backfills canonical candles for one ingestion timeframe. Supported storage timeframes are `1m`, `5m`, `15m`, and `1h`; the default is `5m`. Hourly candles are data-only today and do not make `dry:run` or Polymarket resolution sync trade hourly markets.
  `candles:fill-gaps` — refetches missing bars for one stored candle timeframe.
  `candles:chart` — fetches candles directly from a configured source/product/asset/timeframe and renders a TradingView Lightweight Charts PNG with SMA 20/50 overlays, RSI-divergence markers, and sparse sweep-rejection markers. Defaults to recent Pyth spot BTC `5m`; use `--start`/`--end` for an explicit time range.
- `predict:*`
  `predict:chart` — sends a rendered chart image to OpenAI's Responses API for a Zod-validated next-candle green/red prediction. Requires `OPENAI_API_KEY`.
- `dry:*`
  `dry:run` — long-running process that refreshes Pyth candles at decision time, synthesizes the active Pyth bar from the latest Pyth price, renders a chart with the price line/top info hidden, asks OpenAI for a next-candle prediction, persists the inverse of every returned green/red prediction to `dry_run_decisions`, and tracks the configured simulated Polymarket order fill status. See [DRY_RUN.md](./DRY_RUN.md).
- `dashboards:*`
  `dashboards:build` — generates the static `/`, `/proxy/`, `/price-paths/`, and `/dryrun/` pages under `tmp/web/`; with `--deploy`, ships them to the alea Cloudflare Worker.
- `data:*`
  `data:capture`
  `data:ingest-pending`
- `latency:*`
  `latency:capture`
  `latency:chart`
- `reliability:*`
  `reliability:capture`
  `reliability:chart`
- `say:*`
  `say:text` — speaks the given text aloud via the built-in macOS `say` binary. Defaults to the `Fred` voice. See [SAY.md](./SAY.md).
- `telegram:*`
  `telegram:test`
- `polymarket:*`
  `polymarket:auth-check`
  `polymarket:price-sample` — long-running sampler that records compact live 5m/15m Polymarket UP price paths into `polymarket_price_samples`, feeding the `/price-paths/` dashboard's 50c calibration views.
  `polymarket:resolutions-sync` — backfills settled Polymarket up/down crypto market outcomes into `polymarket_resolutions`. Pair with Pyth candles to drive the proxy-accuracy dashboard. See [PROXY.md](./PROXY.md).
- `trading:*`
  `trading:run` — long-running live trader. Uses the same inverse OpenAI chart-decision path as dry-run, pre-discovers/pre-subscribes next Polymarket markets, and places real GTD post-only maker orders on the opposite side of every returned green/red prediction. Defaults to the full BTC/ETH/SOL/XRP/DOGE `5m` + `15m` market set; use `--assets` / `--periods` to override. See [LIVE_TRADING.md](./LIVE_TRADING.md).
  `trading:hydrate-lifetime-pnl` — operator escape hatch to refresh the on-disk Polymarket lifetime-PnL checkpoint.
  `trading:performance` — print the latest lifetime PnL summary scanned from Polymarket data-api.
- `help`
  Built-in. `alea help <command>` prints detailed help; `alea help` is equivalent to `alea` with no arguments.

Update this section whenever a new family or command is registered in `src/bin/index.ts`.

## Candle Chart Images

Use `candles:chart` when you want a TradingView-style market chart as a
PNG without depending on local candle sync state. The command fetches
directly from the requested source/product/asset/timeframe and renders
the image with TradingView Lightweight Charts through local Chrome.

Recent-window mode is the default. Trading timeframes use the same
history window sent to OpenAI: `5m` charts render the most recent 2 days
of completed candles, and `15m` charts render the most recent 4 days.
Use `--bars` only when you need to override that default:

```sh
bun alea candles:chart --asset btc --timeframe 5m
bun alea candles:chart --asset btc --timeframe 15m
bun alea candles:chart --asset btc --timeframe 5m --bars 288
```

Explicit range mode uses `--start` and optional `--end`. Both values are
floored to the selected timeframe boundary, and `--end` is an exclusive
cutoff: a `5m` chart with `--end 2026-05-15T13:30:00Z` shows the candle
that opened at `13:25:00Z`, not the candle that opens at `13:30:00Z`. If
`--end` is omitted, the range runs through the latest completed candle.
Ranges are capped at 2,000 bars.

```sh
bun alea candles:chart --asset btc --timeframe 5m \
  --start 2026-05-15T09:30:00Z \
  --end 2026-05-15T13:30:00Z \
  --out tmp/charts/btc-pyth-5m.png
```

By default, chart images include the indicator bundle used by OpenAI:
`SMA 20`, `SMA 50`, RSI-divergence markers (`Bull div`, `H bull`,
`Bear div`, `H bear`), and sparse sweep-rejection markers (`High sweep`,
`Low sweep`). Use `--no-indicators` for a plain candlestick + volume
chart.

For visual replay, use `--no-price-line` to hide the latest
price horizontal line and right-edge last-value label, and use
`--no-top-info` to hide the OHLC/change/range block at the top:

```sh
bun alea candles:chart --asset btc --timeframe 5m \
  --start 2026-05-15T09:30:00Z \
  --end 2026-05-15T13:30:00Z \
  --no-price-line \
  --no-top-info
```

The default chart is Pyth spot BTC `5m`, matching Alea's canonical
price/outcome source. Pyth does not publish venue volume, so the volume
pane is omitted; pass `--source coinbase` when you want Coinbase trade
volume. Use `--source`, `--product`, `--asset`, and `--timeframe` to
change the market, and `--browser-path` or `ALEA_CHART_BROWSER_PATH` if
Chrome is installed outside the standard macOS/Linux paths.

Use `predict:chart` to predict the next candle from an already-rendered
chart image. The command sends the image through the OpenAI Responses API,
requires the model to return `{ direction, reasoning }`, and validates
that response with Zod before printing it. It defaults to
`OPENAI_CHART_MODEL` or `gpt-5.4`.
Each request appends a JSONL audit row to
`OPENAI_CHART_PROMPT_LOG_PATH`, defaulting to
`tmp/openai-chart-prompts.jsonl`.

```sh
bun alea predict:chart tmp/charts/btc-pyth-5m.png
```

Set `OPENAI_API_KEY` in the environment before running it.

## Adding A Command

1. Decide the family and pick a name like `family:verb`.
2. Create the command file under `src/bin/<family>/<verb>.ts`. Export a single named `<family><Verb>Command` value built with `defineCommand({ ... })`.
3. Express every input as a Zod schema on a `defineValueOption` / `defineFlagOption` / `definePositional`. The schema controls coercion, defaulting, and required-vs-optional semantics — there should be no manual argv parsing in the command body.
4. Fill `summary`, `description`, `examples`, `output`, and `sideEffects`. These are part of the public CLI surface.
5. Implement `run({ io, options, positionals })` so it calls into `src/lib/<domain>/` for the actual work and writes results via `io.writeStdout`.
6. Register the new command in the `commands` array passed to `createCli` in `src/bin/index.ts`.
7. Update this doc's "Active Command Families" section.

## Output Style

CLI output is a product surface — humans (and human-like agents) read it. Aim for output that is **clean, nicely organized, and friendly to read**.

- Lead with the most important fact (what happened, what changed) and put numeric or tabular detail underneath.
- Group related lines and use blank lines as section separators rather than ASCII rules.
- Prefer compact, aligned columns over flowing prose for repeated rows. Pad with `String.padStart` / `padEnd` rather than ad-hoc spaces.
- Use units consistently within a single command (always ms vs always s, always rows vs always candles).
- Plain `info` lines do not need color. Reserve color for genuine signal:
  - **green** — successful completion or a positive metric.
  - **yellow** — warning, dry-run, or skipped work.
  - **red** — error or sharply negative metric.
  - **dim/gray** — secondary information (timestamps, file paths, hints).
- Use **[picocolors](https://github.com/alexeyraspopov/picocolors)** for ANSI styling. It is the only color dependency. Import as `import pc from "picocolors"` and call `pc.green(...)`, `pc.dim(...)`, etc. Picocolors auto-disables when the stream is not a TTY, so you do not need to gate calls manually.
- Do not write color escape codes by hand. Do not pull in `chalk`, `kleur`, `ansis`, or similar — picocolors covers our needs.
- Errors must still be readable when color is disabled (`NO_COLOR=1` or piped output): rely on the wording to carry meaning, with color only as emphasis.

## Help Output

- `bun alea` and `bun alea help` print the top-level command list.
- `bun alea <command> --help`, `bun alea <command> -h`, and `bun alea help <command>` all print detailed help for one command.
- Detailed help shows summary, usage, description, arguments, options (with descriptions pulled from each input's Zod `.describe(...)` text), examples, output description, and side effects.

## Error Handling

- `CliUsageError` (unknown command, missing required option, invalid value, etc.) prints `error: <msg>` and a `usage:` line to stderr, then exits 1.
- Zod validation failures from option schemas are translated into `CliUsageError` before bubbling out.
- Any other thrown error is printed to stderr with its stack and exit code 1.

## Library Layout

- `src/lib/cli/types.ts` — public command/option/positional types.
- `src/lib/cli/defineCommand.ts`, `defineValueOption.ts`, `defineFlagOption.ts`, `definePositional.ts` — identity helpers that anchor TypeScript inference for command authors.
- `src/lib/cli/parser/` — argv → typed `{ options, positionals }` via Zod.
- `src/lib/cli/render/` — top-level help, per-command help, usage strings.
- `src/lib/cli/createCli.ts` — wires the app definition to a runner with built-in `help` and an error boundary.
- `src/lib/cli/CliUsageError.ts` — usage error class.

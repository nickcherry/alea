# Filters

A **filter** is the unit of prediction the rest of the system is
built around: a tiny, deterministic function that looks at recent
bars and emits `"up"`, `"down"`, or `null` (abstain). Everything
else — the backtest, the regime classifier, the committee — orbits
the filter contract.

The framework lives in [`src/lib/filters/`](../src/lib/filters/).
Individual filter implementations sit in the same folder; this doc
is about the framework, not any specific filter.

## Contract

A registered filter exports four things:

```ts
type Filter<TConfig> = {
  readonly id: string; // snake_case, stable
  readonly version: number; // bump on logic change
  readonly description: string; // lay-readable
  readonly family: FilterFamily; // strategy family tag
  readonly configSchema: z.ZodType<TConfig>;
  readonly requiredBars: (config: TConfig) => number;
  readonly predict: (
    config: TConfig,
    bars: readonly FilterBar[],
  ) => "up" | "down" | null;
};
```

Plus a `defaultConfigs()` array of configs the backtest walks. The
framework guarantees:

1. `predict` is called with `bars` of length exactly
   `requiredBars(config)`, ordered ascending by `openTimeMs`. The
   most recent **closed** bar is `bars[bars.length - 1]`. The
   prediction subject (the next bar) is **not** in the array — see
   "No-leak invariant" in [BACKTEST.md](./BACKTEST.md).
2. `configSchema.parse(config)` is the only way the framework hands
   the filter a config. Defaults declared in the schema apply.
3. The cache key for a `(filter, config)` pair is the candidate hash
   over `(id, version, configCanon)`. Bumping `version` invalidates
   every cached result for the filter.

`null` is an abstention — the filter saw no signal. Abstentions
don't contribute to win rate and aren't recorded in
`filter_engagements`. Filters are encouraged to abstain liberally;
the committee's job is to combine signals, not to demand one from
every candidate on every bar.

## Filter `family` tag

Every filter declares one of:

```
band_reversion        // bollinger / z-score / channel pierces
oscillator_reversion  // RSI / Stoch / CCI / %R extremes
velocity_fade         // fade recent magnitude / streak
ma_position           // close vs SMA / EMA / HMA / DI
pattern               // single- or multi-bar candle shape
divergence            // indicator vs price disagreement
```

This is the **filter family** — the kind of signal the filter is
testing. It's metadata for the exploration dashboard and for an
operator scanning the registry. **It is not a market regime.** Market
regime is a separate concept; see [REGIMES.md](./REGIMES.md).

## Bar windows + the no-leak rule

Every filter consumes a `FilterBar[]` (`openTimeMs`, `open`, `high`,
`low`, `close`, `volume`). The backtest walker enforces no-leak by
slicing the window before `predict` runs and only touching the next
bar after the prediction is locked in. See [BACKTEST.md](./BACKTEST.md)
for the exact mechanics.

A filter must not reach outside its `bars` argument. That includes:

- `Date.now()`, `Math.random()`, env variables — make filters
  non-deterministic and cache-breaking.
- External imports that read the database or filesystem.
- Stateful module-level variables.

The framework only checks the window length; deterministic purity
is a code-review obligation.

## Training outcome threshold

Filters never see the target candle directly. After a prediction is
locked in, the backtest labels that next candle from its Pyth
open-to-close move. If the absolute move is less than or equal to
`TRAINING_OUTCOME_MIN_ABS_MOVE_PCT` in
[`src/constants/training.ts`](../src/constants/training.ts), the
outcome is ambiguous and does not contribute a win or loss. The walker
applies this when deciding whether to write `filter_engagements`.

## Registry

[`src/lib/filters/registry.ts`](../src/lib/filters/registry.ts) is
the in-process directory of registered filters. Each filter file
calls `registerFilter({ filter, defaultConfigs })` at module
top-level; [`src/lib/filters/all.ts`](../src/lib/filters/all.ts) is
the single import that loads the whole registry. Any entry point
that uses the committee or runs the backtest imports
`@alea/lib/filters/all` for side effects.

`allCandidates()` returns the flat `(filter, config)` list across
every registered filter, in deterministic order
`(filterId asc, defaultConfigs array order)`. The committee
evaluator reads this; the backtest walker reads this. Adding or
removing a registration changes the candidate set on the next
process start — no migration needed.

## Adding a filter

1. Create `src/lib/filters/<id>.ts`:
   - Export the `Filter` value (no default exports).
   - Provide `defaultConfigs(): TConfig[]`. These are the configs
     the backtest will walk — keep the list to the cuts you actually
     want measured, not a sweep.
   - Call `registerFilter({ filter, defaultConfigs })` at module
     top-level.
2. Import the new file from
   [`src/lib/filters/all.ts`](../src/lib/filters/all.ts).
3. Run `bun alea backtest:run`. The new candidates appear in
   `filter_runs` + the exploration dashboard.
4. Run `bun alea committee:select` if you want the new candidates
   eligible for the live committee. Otherwise the dry-run keeps the
   previous roster.

If `predict` logic changes after the filter is registered, bump
`version`. The version is part of the cache key, so cached runs are
invalidated and the next `backtest:run` recomputes.

## Pruning

`defaultConfigs()` is the operator's job — there's no auto-sweep.
After exploring a wide config grid for a new filter, edit the array
down to the configs worth keeping (typically the top 5 by aggregate
WR + some intuition about which knob values are robust). The
committee selector then ranks among those.

Filters that fail to clear the committee's eligibility bar in **any**
regime (see [COMMITTEE.md](./COMMITTEE.md)) are dead weight in the
exploration dashboard but harmless — they cost a small amount of
backtest CPU on the next `backtest:run` and otherwise don't engage.
Delete the file (and its `all.ts` import) when you're sure it
doesn't pay rent.

## Files

- [`src/lib/filters/types.ts`](../src/lib/filters/types.ts) — `Filter`,
  `Candidate`, `FilterFamily`.
- [`src/lib/filters/registry.ts`](../src/lib/filters/registry.ts) —
  registration + lookup + `allCandidates`.
- [`src/lib/filters/hash.ts`](../src/lib/filters/hash.ts) — the
  `(id, version, configCanon)` candidate hash used as the
  `filter_runs.run_hash` cache key.
- [`src/lib/filters/all.ts`](../src/lib/filters/all.ts) — the single
  import that populates the registry.
- [`src/lib/indicators/`](../src/lib/indicators/) — pure numeric
  primitives (RSI / SMA / EMA / Bollinger / etc.) the filters
  compose on top of.

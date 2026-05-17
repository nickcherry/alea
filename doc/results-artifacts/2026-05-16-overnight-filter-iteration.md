# Overnight Filter Iteration Notes

Local-only research run. Do not deploy. Do not commit unless explicitly asked.

## Objective

Find one or a few handcrafted candidates per asset/period that are strong enough
to trust directly when they fire. This is not a committee/voting pass. The goal
is a small set of high-conviction filters from RSI divergence derivatives,
momentum continuation/exhaustion, and support/resistance rejection or bounce
families.

Target quality bar:

- Minimum: `>= 60%` win rate.
- Dream: `>= 70%` win rate.
- Avoid tiny overfit results. Prefer many hundreds of decisions per candidate,
  or at least low-hundreds per asset when quarter consistency is strong.
- Prefer candidates that are positive across all or nearly all quarters.
- Treat nearby successful configs as stronger evidence than one isolated spike.
- If a candidate is asset-specific, keep that scoping in the registry, not in
  the filter config.

## Current Best RSI-Derivative Candidate

`15m` RSI Divergence + Exhaustion Stretch:

- Config: RSI `14`, regular divergences only, pivot `5/5`, range `5..60`,
  max signal age `15`, SMA `100`, min stretch `150` bps, prior trend `12` bars,
  min prior trend `75` bps, `4/4` opposite candles, max move since pivot `0` bps.
- Registered assets: BTC, ETH, SOL.
- Excluded asset: DOGE.
- Full-window aggregate across registered assets: `552` decisions, `336` wins,
  `216` losses, `60.87%`.
- Asset breakdown: BTC `120` decisions at `60.00%`, ETH `160` at `61.88%`,
  SOL `272` at `60.66%`.
- Quarter breakdown: all quarters above `50%`, but 2025 Q1-Q4 are only
  low-to-mid `50%`. This is promising, not solved.

The current candidate clears the minimum aggregate bar, but it does not yet
meet the desired per-asset fire frequency. Continue looking for stronger
families and variants.

Follow-up age analysis found the same `15m` BTC/ETH/SOL exhaustion setup was
stronger when the divergence was older but still unrepaired:

- Added candidate config: `minSignalAgeBars: 8`, `maxSignalAgeBars: 15`.
- Persisted aggregate after rerunning `backtest:run`: `319` decisions, `211`
  wins, `108` losses, `66.14%`.
- Asset breakdown: BTC `78` at `62.82%`, ETH `94` at `65.96%`, SOL `147` at
  `68.03%`.
- Quarter breakdown: every quarter positive, from `54.55%` to `86.05%`.
- This is lower frequency than ideal, but it is not a tiny sample and it is a
  useful adjacent high-confidence variant for live evaluation.

Chart inspection around weak 2025 Q4 samples suggested repeated fires from the
same divergence cluster are a meaningful failure mode. The aged variant tests
the opposite idea: only fire once the exhaustion setup has stayed unrepaired for
long enough to be more informative.

Follow-up exact-evaluation grid:

- Artifact:
  `doc/results-artifacts/2026-05-17T03-40-54-449Z-rsi-exhaustion-grid.json`.
- Age probe confirmed this is a stable neighborhood, not a single isolated
  config: `8..14` scored `276` decisions at `66.67%`, `8..15` scored `319` at
  `66.14%`, `7..15` scored `342` at `64.33%`, and `6..15` scored `369` at
  `63.14%`.
- Best balanced aggregate grid result: age `8..15`, SMA `200`, stretch `125`
  bps, prior trend `12/75`, `4/4` opposite candles, max move since pivot `25`
  bps. It scored `316` decisions at `67.41%`, with all `9/9` quarters positive
  and minimum quarter win rate `53.49%`.
- Nearby SMA200 configs were also strong: stretch `100`, `125`, `150`, `175`,
  and `200` with the same age/trend/opposite-candle shape all clustered around
  `67%`, which is encouraging.
- Promoted the SMA200/stretch125/maxMove25 aged config in the registry for
  `15m` BTC/ETH/SOL, replacing the older aged SMA100/stretch150/maxMove0
  variant rather than adding another near-duplicate.
- Persisted backtest after promotion matched the grid: `316` decisions, `213`
  wins, `103` losses, `67.41%`. Asset breakdown: BTC `74` at `66.22%`, ETH
  `97` at `67.01%`, SOL `145` at `68.28%`. Every quarter was positive, with
  the weakest quarter at `53.49%`.
- SOL has especially high asset-specific variants in this family, including
  age `8..15`, SMA `50`, stretch `200`, trend `6/50`, `4/4` opposite candles,
  max move `25`, at `108` decisions and `75.93%`. This is promising but still
  too few fires to promote as a standalone asset-specific candidate without
  more support.
- Rendered chart checks:
  - `tmp/charts/rsi-exhaustion-sma200-loss-btc-2025-10-01-wide.png`
  - `tmp/charts/rsi-exhaustion-sma200-win-btc-2025-10-03-wide.png`
  - `tmp/charts/rsi-exhaustion-sma200-mixed-sol-2025-10-08-wide.png`
- Visual read: the BTC loss cluster is a bearish-divergence setup where price
  kept accelerating upward after the divergence. The BTC win has similar
  stretched-up context but gets real rejection before continuation resumes.
  The SOL mixed cluster shows early bullish bottom-catching losses followed by
  a better low-sweep/bull-divergence reversal. This points toward testing a
  "divergence plus sweep/rejection confirmation" gate, but earlier standalone
  support/rejection filters were not strong enough by themselves.
- Updated chart overlays to show SMA `100` and SMA `200` as well as SMA `20`
  and SMA `50`, so future visual checks include the level used by the promoted
  RSI exhaustion candidate.

Heartbeat 2026-05-17 03:47 UTC:

- Tested the chart-inspired branch "RSI exhaustion plus same-direction
  sweep/rejection confirmation" in
  `tmp/rsi_exhaustion_sweep_grid.ts`.
- Artifact:
  `doc/results-artifacts/2026-05-17T03-50-19-766Z-rsi-exhaustion-sweep-grid.json`.
- Result: this improves headline precision but cuts volume too much. The best
  aggregate rows were around `70.2%` to `70.8%`, with `137` to `146` total
  fires across BTC/ETH/SOL and all `9/9` quarters positive.
- Best current promoted-base config with sweep gate: SMA `200`, stretch `125`,
  age `8..15`, prior trend `12/75`, max move `25`, plus a same-direction
  sweep in the last `5` bars using sweep lookback `48` and min wick/range
  `0.25`. It scored `140` decisions at `70.71%`, all quarters positive, but
  this is below the desired fire count.
- SOL-specific sweep-gated variants reached about `78.95%`, but with only
  `57` decisions. That is too thin to promote without more supporting variants
  or a broader sibling config that keeps materially more trades.
- Decision: do not register the sweep-confirmed variant yet. Keep it as a
  promising overlay concept and next try to recover volume, either by a softer
  rejection-context feature or by using the sweep as an invalidation/weighting
  clue rather than a hard gate.

Heartbeat 2026-05-17 04:17 UTC:

- Tested a softer context pass in `tmp/rsi_exhaustion_context_grid.ts`.
- Artifact:
  `doc/results-artifacts/2026-05-17T04-20-53-147Z-rsi-exhaustion-context-grid.json`.
- Policies tested included same-direction sweep, same-direction sweep OR a
  small reversal/turn candle, no recent opposite sweep, and same-direction
  sweep OR no adverse impulse.
- Best count-preserving result was not a distinct improvement: SMA `50`,
  stretch `175`, age `8..15`, trend `12/75`, max move `25`, plus no opposite
  sweep in the last `5` bars scored `250` decisions at `68.40%`, all `9/9`
  quarters positive, min quarter `54.90%`. The underlying base sibling without
  that policy was already `255` decisions at `68.24%`.
- The currently promoted SMA200/stretch125 candidate remains a better live
  default on the volume/quality tradeoff: `316` decisions at `67.41%`.
- Decision: do not register the softer context variant yet. The useful finding
  is that the SMA50/stretch175 sibling is a real nearby RSI-exhaustion shape,
  but it does not clearly beat the promoted config once fire count is weighted.

Heartbeat 2026-05-17 04:47 UTC:

- Ran a narrowed RSI-exhaustion parameter grid in
  `tmp/rsi_exhaustion_param_grid.ts`, after stopping a too-broad first pass.
- Artifact:
  `doc/results-artifacts/2026-05-17T04-57-48-995Z-rsi-exhaustion-param-grid.json`.
- Search varied RSI length `10/14/21`, pivot width `3/5/8`, strong older age
  windows, and the SMA/stretch/trend shapes that survived earlier grids.
- The shared cross-asset neighborhood did not improve beyond the already known
  RSI `14`, pivot `5`, age `8..15` family. Top all-asset rows stayed clustered
  around `67%` to `68%`; the promoted SMA200/stretch125 candidate remains the
  best volume/quality tradeoff at `316` decisions and `67.41%`.
- ETH now has a credible >=100-fire asset-specific variant: RSI `10`, pivot
  `5`, age `8..15`, SMA `200`, stretch `125`, trend `12/75`, `4/4` opposite
  candles, max move `25`. It scored `102` decisions at `66.67%`, `9/9`
  quarters positive, min quarter `57.14%`.
- SOL is the clearest asset-specific opportunity. Multiple nearby configs are
  above `70%` with >=100 fires and all quarters positive. Top examples:
  - RSI `14`, pivot `5`, age `8..15`, SMA `50`, stretch `200`, trend `6/50`,
    `4/4`, max move `25`: `108` decisions at `75.93%`, min quarter `57.14%`.
  - Same shape with max move `0`: `107` decisions at `75.70%`.
  - SMA `50`, stretch `175`, trend `24/50`, max move `25`: `149` decisions at
    `71.81%`, min quarter `58.33%`.
- BTC still lacks a clean asset-specific breakthrough. Best >=100-fire rows are
  around `66%` to `68%` but have weaker quarter floors, so do not promote a BTC
  asset-specific variant yet.
- Important implementation note: `evaluateCandidateTradeDecision` currently
  votes across every registered candidate. Adding a SOL-only candidate on top
  of the broad active RSI sweeps would make it another vote in a committee-like
  system, not a direct artisanal trigger. Before promoting SOL-specific winners,
  we should prune the active registry/runtime surface toward curated candidates
  or change the runtime to treat selected candidates as direct triggers.

Heartbeat 2026-05-17 05:17 UTC:

- Split the registry into a broad research/backtest set and a curated
  dry-run/live trade set. Backtests still use
  `registeredCandidatesForMarket`; runtime decisions now use
  `tradeCandidatesForMarket`.
- Changed runtime semantics away from majority voting. A curated candidate can
  trade directly when it fires; conflicting up/down curated triggers return
  `neutral`.
- Promoted the credible asset-specific `15m` RSI-exhaustion variants into the
  curated trade set:
  - ETH: RSI `10`, pivot `5`, age `8..15`, SMA `200`, stretch `125`, trend
    `12/75`, `4/4`, max move `25`: persisted `102` decisions, `66.67%`,
    `9/9` positive quarters, min quarter `57.14%`.
  - SOL: RSI `14`, pivot `5`, age `8..15`, SMA `50`, stretch `175`, trend
    `24/50`, `4/4`, max move `25`: persisted `149` decisions, `71.81%`,
    `9/9` positive quarters, min quarter `58.33%`.
- Did not promote BTC despite the shared candidate's all-asset strength. Its
  isolated persisted result was only `74` decisions, `66.22%`, `6/9` positive
  quarters, and a `40.00%` weakest quarter, which is not enough evidence under
  the current standard.
- DOGE remains empty in the curated trade set.
- Incremental `15m` ETH/SOL backtest after registering the new candidates took
  `6.71s` wall time, generating `160` rows and using `1,136` cached rows.
- Validation so far: `bun test src/lib/filters/registry.test.ts` and
  `bun run typecheck` pass.

Heartbeat 2026-05-17 05:47 UTC:

- Checked persisted `5m` candidate rows before sweeping more. The best
  existing `5m` candidates with at least `250` decisions are still below the
  promotion bar: mostly `54%` to `58%`, with weak quarter floors. Do not
  promote a `5m` RSI candidate yet.
- Re-ran the richer RSI divergence feature search in
  `tmp/rsi_derivative_search.ts` (`119.35s` wall time). This searches base RSI
  divergence events with predicates around age, move since pivot, opposite
  candle count, SMA stretch, trend, wick shape, and horizontal rejection.
- Result: not promotable as a full-window strategy. The best broad predicate
  combinations have high 2026-only test rates, but full-window rates remain
  around `54%` to `57.5%`. The strongest full-window families are still the
  same exhaustion ingredients already represented in code:
  `moveSincePivotBps <= 0`, `oppositeCount4 >= 4`,
  `priorTrend12 >= 75`, and SMA stretch. This validates the current direction
  but does not justify a new filter family.
- The search also showed why we should avoid leaning on recent-only splits:
  several combinations reached `63%` to `65%` in 2026 samples while staying
  below `58%` full-window. Treat that as regime drift or overfit until it
  survives all quarters.
- Rendered another rejected BTC setup:
  `tmp/charts/rsi-exhaustion-rejected-btc-loss-2024-07-10.png`.
  Visual read: a bearish divergence fired inside a compressed range just before
  a violent upside breakout. There was no clear rejection yet; price had enough
  unresolved breakout pressure that the divergence was too early. This supports
  testing a BTC-specific "rejection confirmation after divergence" rule, but
  earlier hard sweep gates had too few decisions and poor quarter floors.
- Checked cached `15m` BTC rows with a minimum-quarter floor of at least `50%`.
  The only candidates that pass that floor are broad mean-reversion stretch
  variants around `53%` to `55%` with many decisions. That is stable but not
  nearly strong enough to promote; BTC still needs a different filter idea, not
  a small RSI parameter tweak.

Heartbeat 2026-05-17 06:17 UTC:

- Added and ran `tmp/price_action_advanced_search.ts` to test non-RSI
  15-minute price-action families:
  breakout acceptance/continuation, failed-breakout reversal, trend pullback
  continuation, and run-exhaustion reversal.
- Artifact:
  `doc/results-artifacts/2026-05-17T06-23-08-364Z-price-action-advanced-search.json`.
- Runtime was `81.03s`, scoring `257,652` synthetic decision records across
  `712` policies.
- Result: no promotion. The best market-specific row with at least `100`
  decisions was only `57.24%` (`15m/doge` trend pullback), and the best
  `15m/btc` rows were around `54%` to `56.5%` with weak quarter floors. The
  best all-asset rows were failed-breakout reversal variants around `53%`.
- Interpretation: simple standalone price-action filters are not enough. They
  may be useful as context gates later, but they do not solve the direct-trade
  problem by themselves.
- Next useful direction: evaluate curated direct-trigger unions for nearby
  high-performing RSI-exhaustion variants, especially SOL. The current runtime
  semantics now support "if any curated trigger fires, trade it" without a
  committee vote, so the right question is whether a tiny union of robust
  variants increases decisions while preserving the `70%+` SOL win rate.

Heartbeat 2026-05-17 06:47 UTC:

- Added and ran `tmp/rsi_exhaustion_union_search.ts` against the strongest
  asset-specific rows from
  `doc/results-artifacts/2026-05-17T04-57-48-995Z-rsi-exhaustion-param-grid.json`.
- Artifact:
  `doc/results-artifacts/2026-05-17T06-50-52-577Z-rsi-exhaustion-union-search.json`.
- Runtime was `37.11s`.
- Promoted curated direct-trigger neighborhoods into the runtime registry:
  - BTC `15m`: two RSI-exhaustion siblings. Union result: `148` decisions,
    `97` wins / `51` losses, `65.54%`, `9/9` positive quarters, weakest
    quarter `54.17%`.
  - ETH `15m`: two RSI-exhaustion siblings. Union result: `159` decisions,
    `107` wins / `52` losses, `67.30%`, `9/9` positive quarters, weakest
    quarter `51.85%`.
  - SOL `15m`: three RSI-exhaustion siblings. Union result: `141` decisions,
    `106` wins / `35` losses, `75.18%`, `9/9` positive quarters, weakest
    quarter `57.14%`.
- These are not a majority-vote committee. The runtime evaluates the small
  curated set directly: if any candidate fires in one direction and none fire
  in the opposite direction, it trades; any up/down conflict is neutral. The
  union search found zero conflicts for the promoted neighborhoods.
- Incremental backtest after registration:
  `bun alea backtest:run --periods 15m --assets btc,eth,sol` took `10.64s`,
  generated `269` rows, used `1,720` cached rows, and persisted individual
  candidate rows for the newly registered configs.
- Rebuilt `/Users/nickcherry/src/alea/tmp/web/backtest/index.html`; the
  dashboard now has `570` active individual candidate rows. The union-level
  runtime result is documented in the artifact above rather than represented as
  a separate database row.

Heartbeat 2026-05-17 07:17 UTC:

- Pressure-tested the promoted direct-trigger neighborhoods from
  `doc/results-artifacts/2026-05-17T06-50-52-577Z-rsi-exhaustion-union-search.json`
  for slightly broader sets with better decision counts or quarter floors.
- Updated the curated runtime registry to favor those broader sets:
  - BTC `15m`: three RSI-exhaustion triggers, `160` union decisions,
    `103` wins / `57` losses, `64.38%`, `9/9` positive quarters, weakest
    quarter `54.17%`.
  - ETH `15m`: three RSI-exhaustion triggers, `175` union decisions,
    `116` wins / `59` losses, `66.29%`, `9/9` positive quarters, weakest
    quarter `55.56%`.
  - SOL `15m`: four RSI-exhaustion triggers, `147` union decisions,
    `109` wins / `38` losses, `74.15%`, `9/9` positive quarters, weakest
    quarter `58.33%`.
- This is still a tiny direct-trigger surface, not committee voting. The trade
  runtime will take a signal when any curated candidate fires in one direction
  and no curated candidate fires in the opposite direction.
- Incremental backtest after broadening the curated sets:
  `bun alea backtest:run --periods 15m --assets btc,eth,sol` took `11.98s`,
  generated `272` rows, used `1,744` cached rows, and persisted individual
  candidate rows for the newly registered configs.
- Rebuilt `/Users/nickcherry/src/alea/tmp/web/backtest/index.html`; the
  dashboard now has `573` active individual candidate rows.
- Verified the current persisted direct-trigger union from database rows:
  BTC `160` / `64.38%` / `9/9`, ETH `175` / `66.29%` / `9/9`, SOL `147` /
  `74.15%` / `9/9`, all with zero up/down conflicts.

Heartbeat 2026-05-17 07:47 UTC:

- Added and ran `tmp/rsi_exhaustion_context_gate_search.ts` to test context
  gates on top RSI-exhaustion candidates instead of scoring standalone
  price-action rules. Gates covered current-candle confirmation, failed
  breakout confirmation, moving-average touches, horizontal levels,
  opposite-impulse rejection, upper bounds on prior trend, and upper bounds on
  stretch.
- Artifact:
  `doc/results-artifacts/2026-05-17T07-54-04-792Z-rsi-exhaustion-context-gate-search.json`.
- Runtime was `83.09s`, with `1,122` context gates tested against `28` BTC,
  `30` ETH, and `30` SOL candidate configs from the RSI-exhaustion param grid.
- Best count/floor rows with at least `100` decisions:
  - BTC: `105` decisions, `72` wins / `33` losses, `68.57%`, `8/9` positive
    quarters, `50.00%` weakest quarter. This was the existing BTC
    `a232fd...` candidate plus a current opposite-breakout guard
    (`lookback=48`, `body>=0.5`, `close location>=0.75`).
  - ETH: `101` decisions, `68` wins / `33` losses, `67.33%`, `8/9` positive
    quarters, `50.00%` weakest quarter. This was mostly a prior-trend cap, not
    a support/resistance confirmation.
  - SOL: `104` decisions, `81` wins / `23` losses, `77.88%`, `9/9` positive
    quarters, `62.50%` weakest quarter. This was the current strongest SOL
    candidate plus an upper cap of `650` bps on `priorTrendBps`.
- Interpretation: support/resistance and moving-average confirmation did not
  produce the strongest rows; they mostly reduced count too aggressively. The
  useful refinement is "do not fade a steamroller": keep old unrepaired
  divergence exhaustion, but avoid cases where the prior move is already
  unusually violent or where the active candle is an unresolved breakout
  against the signal.
- Chart checks:
  - `tmp/charts/rsi-exhaustion-gate-sol-steamroller-2025-03-03.png` shows the
    removed SOL losses: bullish RSI-exhaustion signals fired into a sharp
    red cascade with `priorTrendBps` around `664` to `702` and stretch near
    `876` to `968` bps. The trend cap correctly removes three losses and one
    win from that cluster.
  - `tmp/charts/rsi-exhaustion-gate-sol-kept-loss-2024-07-04.png` shows a
    surviving SOL loss where the selloff was strong but below the steamroller
    cap; price continued lower after a weak pause. This suggests a second gate
    should look for actual reclaim/acceptance after the cascade, but the naive
    SMA/horizontal reclaim gates were too sparse.
  - `tmp/charts/rsi-exhaustion-gate-btc-kept-loss-2024-07-10.png` shows a BTC
    bearish loss after a large upside impulse. The current-candle guard helps,
    but BTC likely needs a recent-impulse cooldown that looks back several
    bars, not only at the synthetic active candle.
- No registry promotion yet. The SOL prior-trend cap is promising enough to
  test as a real candidate family, but BTC/ETH still need a stronger
  refinement before adding more runtime surface.

Heartbeat 2026-05-17 08:17 UTC:

- Promoted the prior-trend cap into the real
  `rsi_divergence_exhaustion_stretch` config as optional
  `maxPriorTrendBps`. Existing configs without the field keep the previous
  behavior; capped configs get distinct candidate hashes.
- First SOL backtest with only the precision trigger capped at `650` bps
  improved that individual trigger to `104` decisions, `81` wins / `23`
  losses, `77.88%`, `9/9` positive quarters, and `62.50%` weakest quarter.
  The four-trigger union was unchanged because companion triggers still fired
  on the removed timestamps.
- Ran a small SOL union neighborhood over caps on the four runtime triggers.
  Best practical set:
  `precision=650`, `fresh=650`, `trend=400`, `long=900`, yielding `143`
  union decisions, `109` wins / `34` losses, `76.22%`, `9/9` positive
  quarters, `61.90%` weakest quarter, and zero conflicts. Compared with the
  previous SOL union (`147`, `109` / `38`, `74.15%`), this removes four
  losing decisions without losing wins.
- Updated the local SOL `15m` runtime registry to use those four caps. BTC and
  ETH were left unchanged.
- Incremental SOL backtest after registration:
  `bun alea backtest:run --periods 15m --assets sol` took `4.32s`, generated
  `100` rows, used `584` cached rows, and persisted the newly capped SOL
  candidate configs.
- Rebuilt `/Users/nickcherry/src/alea/tmp/web/backtest/index.html`; the
  dashboard still has `573` active individual candidate rows because the capped
  SOL candidates replaced older active SOL configs rather than expanding the
  runtime surface.
- Verified the persisted SOL direct-trigger union from database rows:
  `143` decisions, `109` wins / `34` losses, `76.22%`, `9/9` positive
  quarters, weakest quarter `61.90%`, zero conflicts.

Heartbeat 2026-05-17 08:47 UTC:

- Added and ran `tmp/rsi_exhaustion_recent_impulse_search.ts` to test whether
  BTC/ETH should cool down after a recent multi-bar impulse against the RSI
  signal. The search tested recent opposite-move caps, opposite-run cooldowns,
  and recent opposite breakout impulse cooldowns across the top RSI-exhaustion
  configs plus the current runtime candidates.
- Artifact:
  `doc/results-artifacts/2026-05-17T08-52-10-701Z-rsi-exhaustion-recent-impulse-search.json`.
- Runtime was `82.46s`, with `334` gates over `35` BTC candidate configs and
  `37` ETH candidate configs.
- BTC result:
  - Best individual row with at least `100` decisions was the existing
    `a232fd...` candidate plus a recent-opposite-impulse cooldown:
    `108` decisions, `74` wins / `34` losses, `68.52%`, `9/9` positive
    quarters, weakest quarter `60.00%`.
  - Best shared gate over the current three-trigger runtime union was
    `122` decisions, `81` wins / `41` losses, `66.39%`, `9/9` positive
    quarters, weakest quarter `55.56%`.
- ETH result:
  - Best shared gate over the current three-trigger runtime union was
    `112` decisions, `77` wins / `35` losses, `68.75%`, `9/9` positive
    quarters, weakest quarter `53.33%`.
  - The healthier-count shared gate was `171` decisions, `115` wins / `56`
    losses, `67.25%`, `9/9` positive quarters, weakest quarter `56.00%`.
- Interpretation: recent-impulse cooldown is real but not strong enough to
  promote yet. BTC gets a cleaner low-hundreds individual candidate, but the
  runtime union improvement is small and still below `70%`. ETH's higher
  win-rate version gives up too many decisions, while the high-count version
  only improves the current union by about one point. Do not add this runtime
  knob until a second, independent acceptance/reversal condition makes the
  lift larger.

Heartbeat 2026-05-17 09:17 UTC:

- Added and ran `tmp/rsi_exhaustion_acceptance_reversal_search.ts` to test
  whether RSI exhaustion should require confirmation from the synthetic candle
  itself. The search covered current signal-direction candles, reclaiming the
  prior candle, failed sweep/reversal patterns, and recent turns. It also
  tested conditional versions that only require confirmation after a recent
  adverse impulse, preserving untouched divergence events.
- Artifact:
  `doc/results-artifacts/2026-05-17T09-23-10-393Z-rsi-exhaustion-acceptance-reversal-search.json`.
- Runtime was `73.79s`, with `138` gates over `35` BTC candidate configs and
  `37` ETH candidate configs.
- BTC result:
  - Best individual rows with at least `100` decisions were all baseline
    configs with no acceptance gate. The top row was `111` decisions, `75`
    wins / `36` losses, `67.57%`, but only `7/9` positive quarters and a
    `25.00%` weakest quarter.
  - The current three-trigger runtime union stayed best with no gate:
    `160` decisions, `103` wins / `57` losses, `64.38%`, `9/9` positive
    quarters, weakest quarter `54.17%`.
  - The best conditional confirmation over the current runtime union fell to
    `111` decisions, `69` wins / `42` losses, `62.16%`, and `8/9` positive
    quarters.
- ETH result:
  - Best individual rows with at least `100` decisions were also all baseline
    configs. The top row was `102` decisions, `68` wins / `34` losses,
    `66.67%`, `9/9` positive quarters, weakest quarter `57.14%`.
  - The current three-trigger runtime union had no qualifying acceptance-gated
    improvement. Baseline remains `175` decisions, `116` wins / `59` losses,
    `66.29%`, `9/9` positive quarters, weakest quarter `55.56%`.
- Interpretation: synthetic-candle acceptance/reversal is not additive to the
  current RSI exhaustion family. It mostly removes valid early reversals rather
  than isolating bad stale divergences, so do not promote an acceptance gate.

Heartbeat 2026-05-17 09:47 UTC:

- Moved to a standalone support/rejection pass instead of another RSI
  derivative gate. Added `tmp/support_rejection_standalone_search.ts` to test
  horizontal failed-break/reclaim patterns and SMA/EMA rejection/bounce
  patterns using the same Pyth 15m synthetic-candle timing as backtests.
- The first brute-force version had `5,832` configs per asset and was stopped
  after BTC had not completed in about `30s`. A narrowed `768`-config version
  was still too slow until the script was changed to precompute per-record
  horizontal levels, level-touch counts, and moving averages once per target
  timestamp.
- Artifact:
  `doc/results-artifacts/2026-05-17T09-56-21-163Z-support-rejection-standalone-search.json`.
- Runtime was `38.43s` after feature caching.
- There were zero `strongRows` under the current bar:
  at least `100` decisions, at least `60%` win rate, at least `8/9` positive
  quarters, and weakest quarter at least `50%`.
- BTC top row:
  `185` decisions, `110` wins / `75` losses, `59.46%`, `7/9` positive
  quarters, weakest quarter `22.22%`. It used a 192-bar extreme horizontal
  level with three prior touches, a small pierce, and close reclaim.
- ETH top row:
  `853` decisions, `465` wins / `388` losses, `54.51%`, `8/9` positive
  quarters, weakest quarter `42.17%`.
- SOL top row:
  `145` decisions, `81` wins / `64` losses, `55.86%`, `7/9` positive
  quarters, weakest quarter `33.33%`.
- Rendered representative BTC loss:
  `/Users/nickcherry/src/alea/tmp/charts/support-rejection-btc-loss-2024-05-10.png`.
  The chart shows the filter trying to call a low sweep during an active selloff
  after a sharp intraday breakdown. The setup was not a clean range bounce; it
  was catching a falling move. That failure mode suggests standalone horizontal
  rejection is too blunt unless paired with trend-velocity exhaustion or a
  stronger post-sweep acceptance requirement, but the pure acceptance pass
  already looked weak. Do not promote this standalone family.

Heartbeat 2026-05-17 10:17 UTC:

- Added and ran `tmp/momentum_continuation_exhaustion_search.ts` to test two
  standalone momentum families:
  - `momentum_continuation`: follow a clean directional run into the next
    candle.
  - `momentum_exhaustion_fade`: fade a directional run when the synthetic
    candle shows a reversal or rejection.
- Artifact:
  `doc/results-artifacts/2026-05-17T10-21-26-777Z-momentum-continuation-exhaustion-search.json`.
- Runtime was `20.70s` over `768` configs per asset on `15m` BTC/ETH/SOL.
- There were zero `strongRows` under the current bar:
  at least `100` decisions, at least `60%` win rate, at least `8/9` positive
  quarters, and weakest quarter at least `50%`.
- BTC had the only superficially interesting result. Best row with at least
  `100` decisions was an exhaustion fade after six same-direction candles:
  `107` decisions, `68` wins / `39` losses, `63.55%`, but only `6/9` positive
  quarters and a `33.33%` weakest quarter. Quarter distribution is not stable:
  `2024 Q3` was `37.50%` and `2026 Q2` was `33.33%`.
- ETH's best at the same count threshold was also `107` decisions and
  `63.55%`, but only `7/9` positive quarters and a `28.57%` weakest quarter.
- SOL was weak: best row with at least `100` decisions was `327` decisions,
  `176` wins / `151` losses, `53.82%`.
- Momentum continuation itself is not promising in this first pass. In the
  printed BTC high-count rows it was below `50%`, which suggests blind
  continuation after a run is often the wrong side for next-candle Polymarket
  timing.
- Rendered representative BTC exhaustion-fade loss:
  `/Users/nickcherry/src/alea/tmp/charts/momentum-exhaustion-btc-loss-2024-05-08.png`.
  Visual read: the filter was trying to catch a bounce inside an active
  selloff. The full 15m candle continued lower after the synthetic partial
  candle briefly looked like reversal. This is the same broad failure mode as
  support/rejection: early bottom/top catching in an unresolved impulse.
  Do not promote standalone momentum yet.

Heartbeat 2026-05-17 10:47 UTC:

- Added and ran
  `tmp/rsi_exhaustion_failed_signal_continuation_search.ts` to test the current
  RSI-exhaustion runtime candidates under anti-impulse contexts. The pass
  tested two interpretations of adverse context:
  - `reject`: abstain when the RSI exhaustion event is accompanied by a hard
    adverse partial candle, a recent adverse run, an adverse breakout, or a
    too-violent prior trend.
  - `invert`: treat the failing RSI exhaustion event as a continuation signal
    and trade the opposite side.
- Artifact:
  `doc/results-artifacts/2026-05-17T10-53-08-169Z-rsi-exhaustion-failed-signal-continuation-search.json`.
- Runtime was `133.73s`, with `148` failure-context rules over the RSI
  exhaustion candidate pool and current runtime union for BTC/ETH/SOL.
- Inversion is definitively bad. Best current-union inversion rows:
  - BTC: `74` decisions, `29` wins / `45` losses, `39.19%`, `1/9` positive
    quarters.
  - ETH: `123` decisions, `46` wins / `77` losses, `37.40%`, `1/9` positive
    quarters.
  - SOL: `72` decisions, `19` wins / `53` losses, `26.39%`, `0/9` positive
    quarters.
  The RSI-exhaustion signal remains directionally meaningful even when context
  looks adverse; the context is for abstention, not reversal.
- BTC reject gates gave a modest improvement but not a breakthrough:
  best robust row was recent adverse run over six bars with `200` bps move,
  leaving `125` decisions, `82` wins / `43` losses, `65.60%`, `8/9` positive
  quarters, weakest quarter `50.00%`. This improves the current BTC union
  (`160` decisions, `64.38%`) but sacrifices `35` decisions for only about
  `1.2` points.
- ETH reject gates are cleaner:
  - Current adverse synthetic candle gate (`move=30`, close-location `0.75`)
    leaves `118` decisions, `80` wins / `38` losses, `67.80%`, `9/9` positive
    quarters, weakest quarter `56.25%`.
  - Adverse breakout gate (`lookback=48`, `break=15`, close-location `0.55`)
    leaves `121` decisions, `82` wins / `39` losses, `67.77%`, `9/9` positive
    quarters, weakest quarter `60.00%`.
  This is a real quality/floor improvement over the current ETH union
  (`175` decisions, `66.29%`) but still below the `70%` dream and gives up a
  third of the fires.
- SOL already had prior-trend caps promoted. Additional anti-impulse gates are
  mostly lateral:
  - Best recent-adverse-run reject leaves `121` decisions, `93` wins / `28`
    losses, `76.86%`, `9/9` positive quarters, weakest quarter `59.09%`.
  - Current promoted SOL union remains `143` decisions, `109` wins / `34`
    losses, `76.22%`, `9/9` positive quarters, weakest quarter `61.90%`.
  The extra gate is not worth the lost count.
- Decision: do not promote a new failed-signal continuation family. Consider an
  ETH-only adverse-breakout abstention gate later if the next pass cannot find
  a higher-count improvement, but it is not enough to justify code bloat right
  now.

## Current Infrastructure State

- Candidate registry is asset+period-aware via
  `registeredCandidatesForMarket({ asset, period })`.
- Backtests use the broad asset+period registry. Dry-run/live evaluation uses a
  separate curated asset+period registry with direct-trigger semantics.
- Backtest dashboard has period tabs and asset tabs; each asset table is sorted
  independently.
- Backtest results are disposable during this local research. It is acceptable
  to truncate or delete stale candidate rows when pruning obvious losers.

## Overnight Search Directions

1. RSI divergence derivatives:
   - Keep exploring exhaustion/stretch variants, but do not just nuke decisions.
   - Inspect losses around the current `15m` BTC/ETH/SOL candidate. Look for
     failure modes such as trend acceleration, post-pivot repair, chop, or
     insufficient support/resistance context.
   - Try adding support/resistance proximity to the divergence setup.

2. Momentum continuation:
   - Look for runs where candles share direction and body/range severity is
     increasing.
   - Test whether continuation works until a clear reversal condition appears.
   - Check both `5m` and `15m`, and do per-asset results first.

3. Support/resistance rejection:
   - Use SMA/EMA levels such as 20/50/100/200.
   - Add recent horizontal support/resistance from repeated local highs/lows.
   - Test bounce/rejection only after price touches or pierces a level and then
     closes back in the expected direction.
   - Try combining with RSI divergence once standalone behavior is understood.

4. Chart inspection:
   - Periodically render charts around representative wins and losses.
   - Look at candle context at decision time, not just post-hoc full candles.
   - Document observed failure modes and candidate changes here.

5. Dashboard organization:
   - If several filter families become credible, update `/backtest/` to group
     or section rows by filter family, at least for the top five families.
   - Keep the existing asset+period toggles; family grouping should make it
     easier to compare nearby configs within a family.

## Validation Loop

For any promoted candidate:

- Register only the strongest asset+period scopes.
- Run `bun alea backtest:run`.
- Rebuild `bun alea dashboards:build --only backtest`.
- Query total, per-asset, and per-quarter stats.
- Run focused tests plus `bun run lint`, `bun run typecheck`, `bun test`, and
  `git diff --check` before calling a code state good.

## 2026-05-17 11:17 UTC - RSI Exhaustion Trade-Set Combo Search

- Ran a direct-trigger union combo search over the top RSI-exhaustion candidates
  from `2026-05-17T04-57-48-995Z-rsi-exhaustion-param-grid.json`.
- Artifact:
  `doc/results-artifacts/2026-05-17T11-22-08-153Z-rsi-exhaustion-trade-set-combo-search.json`.
- Runtime was `109831 ms` for combinations up to four candidates per asset.
- BTC:
  - Current direct set remains `160` decisions, `103` wins / `57` losses,
    `64.38%`, `9/9` positive quarters, weakest quarter `54.17%`.
  - Best robust-looking combo reached `171` decisions, `115` wins / `56`
    losses, `67.25%`, but only `8/9` positive quarters with weakest quarter
    `50.00%`.
  - Best headline count>=150 combo reached `153` decisions at `67.97%`, but
    fell to `7/9` positive quarters and a `37.50%` weakest quarter.
  - Decision: leave BTC unchanged. The extra win rate is not worth losing the
    all-quarter-positive property.
- ETH:
  - Prior direct set was `175` decisions, `116` wins / `59` losses, `66.29%`,
    `9/9` positive quarters, weakest quarter `55.56%`.
  - Promoted nearby four-candidate set gives `177` decisions, `118` wins / `59`
    losses, `66.67%`, `9/9` positive quarters, weakest quarter `57.69%`.
  - Decision: update ETH 15m direct-trade registry to the four-candidate set
    because it adds two wins, no extra losses, and a slightly stronger floor.
- SOL:
  - Current direct set remains `143` decisions, `109` wins / `34` losses,
    `76.22%`, `9/9` positive quarters, weakest quarter `61.90%`.
  - A single candidate reached `104` decisions at `77.88%`, and a three-candidate
    set reached `138` decisions at `76.81%`, but both give up more count than
    the win-rate gain justifies.
  - Decision: leave SOL unchanged.
- Validation after the ETH registry change:
  - `bun test src/lib/filters/registry.test.ts`
  - `bun run typecheck`
  - `bun run lint`
  - `/usr/bin/time -p bun alea backtest:run --periods 15m --assets eth`
    generated `82` quarter-result rows, reused `584` cached rows, and finished
    in `3.57s`.
  - `/usr/bin/time -p bun alea dashboards:build --only backtest` wrote
    `tmp/web/backtest/index.html` in `0.32s`.
  - `git diff --check`

## 2026-05-17 11:47 UTC - Dashboard Default + RSI Structure Gates

- Made Backtest the default dashboard page locally:
  - `/` now renders the backtest dashboard.
  - `/backtest/` remains a backtest alias.
  - Live trading moved to `/live/`.
  - Updated the shared top nav plus `doc/DASHBOARDS.md` and `doc/CLI.md`.
- Rebuilt with `/usr/bin/time -p bun alea dashboards:build --only backtest`.
  It wrote both `tmp/web/index.html` and `tmp/web/backtest/index.html` in
  `0.35s`.
- Browser smoke test via temporary `127.0.0.1:8765` static server confirmed:
  - root page rendered the Backtest title
  - active nav item `Backtest`
  - `Live trading` nav href `/live/`
- Ran current-direct-set RSI-exhaustion structure gates over `15m` BTC/ETH/SOL.
  Artifact:
  `doc/results-artifacts/2026-05-17T11-56-34-056Z-rsi-exhaustion-structure-gate-search.json`.
- Runtime was `9166 ms` for `2592` gates. The gates tested horizontal
  support/resistance proximity, rejection, failed breaks, and prior-extreme
  hold constraints on top of the current curated direct-trade sets.
- Baselines from the current direct sets:
  - BTC: `160` decisions, `103` wins / `57` losses, `64.38%`, `9/9`, weakest
    quarter `54.17%`.
  - ETH: `177` decisions, `118` wins / `59` losses, `66.67%`, `9/9`, weakest
    quarter `57.69%`.
  - SOL: `143` decisions, `109` wins / `34` losses, `76.22%`, `9/9`, weakest
    quarter `61.90%`.
- Results:
  - BTC best count>=100 gate reached `129` decisions at `65.89%`, but only
    `7/9` positive quarters and a `47.37%` weakest quarter. Not a promotion.
  - ETH best gate reached `100` decisions at `69.00%`, `9/9`, weakest quarter
    `53.85%`; a higher-count gate reached `132` decisions at `67.42%`, `9/9`,
    weakest quarter `63.16%`. Useful context, but still too much count loss
    for too little win-rate lift.
  - SOL best gate reached `110` decisions at `77.27%`, `9/9`, weakest quarter
    `57.14%`; current SOL keeps `33` more decisions and a stronger weakest
    quarter. Not a promotion.
- Decision: do not add structure gates yet. The support/resistance context is
  directionally plausible for ETH/SOL, but it does not solve BTC and does not
  improve the current promoted sets enough to justify code.
- Validation:
  - `bun run typecheck`
  - `bun run lint`
  - `git diff --check`

## 2026-05-17 12:30 UTC - Registry Reset Direction

- Decided to clear the exploratory filter registry and local candidate backtest
  data rather than keep accumulating marginal variants.
- The retained first-pass production-local idea is one RSI divergence candidate:
  - TradingView-style RSI divergence matching.
  - `includeHidden: true`, so regular and hidden bullish/bearish divergences
    are both eligible.
  - `maxSignalAgeBars: 20`, so a divergence can fire if it was confirmed on the
    current synthetic candle or within the prior 20 candles.
  - Bullish divergences vote `up`; bearish divergences vote `down`.
- Trend-break invalidation should not mean any single opposite candle. The
  initial concrete definition is:
  - Opposite impulse: a large opposite-direction candle versus recent average
    body size, closing near its extreme, and breaking the recent range.
  - Micro-trend flip: several recent candles walking against the divergence
    direction with a minimum net move.
- The goal of this reset is to make the baseline easy to reason about before
  tuning the trend-break definition further.

## 2026-05-17 12:49 UTC - Reset Implemented and Baseline Backtest

- Collapsed the active registry to one `RSI Divergence` candidate for every
  local asset+period market.
- Candidate config:
  - `rsiLength: 14`
  - `includeHidden: true`
  - `leftBars: 5`
  - `rightBars: 5`
  - `rangeLower: 5`
  - `rangeUpper: 60`
  - `maxSignalAgeBars: 20`
  - trend-break invalidation using opposite impulse plus micro-trend flip
- Set the default candidate backtest start to `2025-01-01T00:00:00.000Z`.
- Cleared local `candidate_backtest_quarter_results` from `14987` rows to `0`.
- Ran `/usr/bin/time -p bun alea backtest:run`.
  - Runtime: `19.55s`.
  - Persisted `42` quarter rows.
  - Total non-neutral decisions: `131869`.
  - Overall result: `64434` wins / `67435` losses, `48.86%`.
- By market:
  - BTC `5m`: `33655` decisions, `49.15%`.
  - ETH `5m`: `30411` decisions, `48.45%`.
  - SOL `5m`: `30928` decisions, `48.94%`.
  - DOGE `5m`: `840` decisions, `47.74%` because local DOGE `5m` history is
    much shorter.
  - BTC `15m`: `10430` decisions, `48.74%`.
  - ETH `15m`: `10131` decisions, `48.66%`.
  - SOL `15m`: `10310` decisions, `49.00%`.
  - DOGE `15m`: `5164` decisions, `49.46%`.
- Rebuilt `/` and `/backtest/` with
  `/usr/bin/time -p bun alea dashboards:build --only backtest` in `0.27s`.
- Validation after the reset:
  - `bun test src/lib/filters/registry.test.ts src/lib/filters/rsiDivergence.test.ts src/lib/filters/rsiDivergenceInvalidation.test.ts`
  - `bun run typecheck`
  - `bun run lint`
  - `bun test`
  - `git diff --check`
- Finding: this first trend-break definition is much too broad. It creates a
  clean, auditable baseline and a high decision count, but it does not produce
  edge as currently configured.

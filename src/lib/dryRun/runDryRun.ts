import "@alea/lib/filters/all";

import {
  evaluateCommittee,
  listCommitteeCandidates,
} from "@alea/lib/committee/runCommittee";
import {
  candidateRosterKey,
  type CommitteeRoster,
  loadCommitteeRoster,
  rosterBucketKey,
} from "@alea/lib/committee/selection/loadCommitteeRoster";
import type { DatabaseClient } from "@alea/lib/db/types";
import { loadRecentBars } from "@alea/lib/dryRun/loadRecentBars";
import type { DryRunAssetState } from "@alea/lib/dryRun/types";
import type { Candidate, FilterBar } from "@alea/lib/filters/types";
import { streamPythHermes } from "@alea/lib/livePrices/pyth/streamPythHermes";
import { classifyMarketRegime } from "@alea/lib/regime/classify";
import type { MarketRegime } from "@alea/lib/regime/types";
import type { Asset } from "@alea/types/assets";

const FIVE_MIN_MS = 5 * 60 * 1000;
const PERIOD_LABEL = "5m";
/**
 * How many seconds before the next 5m boundary we snapshot the
 * Pyth price as the synthetic close. The user picked 5 seconds —
 * close enough to the true close that the synthetic ≈ actual, but
 * far enough that an order placed on Polymarket has time to
 * actually sit on the book.
 */
const LEAD_TIME_MS = 5 * 1000;
/**
 * Bar-history depth hydrated from the candles table at startup.
 * Big enough to cover the longest filter's requiredBars (~100 at
 * 5m) plus headroom for any future filter additions.
 */
const HYDRATE_DEPTH = 150;

export type DryRunHandle = {
  readonly stop: () => Promise<void>;
};

export type DryRunOptions = {
  readonly db: DatabaseClient;
  readonly assets: readonly Asset[];
  readonly log: (event: DryRunLogEvent) => void;
};

export type DryRunLogEvent =
  | {
      readonly kind: "hydrated";
      readonly asset: Asset;
      readonly barCount: number;
    }
  | { readonly kind: "connected" }
  | { readonly kind: "disconnected"; readonly reason: string }
  | {
      readonly kind: "roster";
      readonly bucketCount: number;
      readonly totalCandidates: number;
      readonly selectedAtMs: number | null;
    }
  | {
      readonly kind: "decision";
      readonly asset: Asset;
      readonly tsMs: number;
      readonly prediction: "u" | "d" | null;
      readonly synthClose: number;
      readonly marketRegime: MarketRegime | null;
      readonly rosterSize: number;
      readonly up: number;
      readonly down: number;
      readonly abstain: number;
    }
  | {
      readonly kind: "outcome";
      readonly asset: Asset;
      readonly tsMs: number;
      readonly prediction: "u" | "d";
      readonly actualClose: number;
      readonly actualOpen: number;
      readonly won: boolean;
    }
  | { readonly kind: "error"; readonly message: string };

/**
 * Starts the dry-run loop. Returns a handle whose `.stop()` cleanly
 * unsubscribes the Pyth stream and stops the scheduler.
 *
 * Operations:
 *   1. Hydrate per-asset bar buffer from `candles` (most recent
 *      HYDRATE_DEPTH closed 5m bars per asset).
 *   2. Subscribe to Pyth Hermes for the requested assets. Each
 *      tick updates the current-bar accumulator; tick boundary
 *      transitions finalize the just-closed bar AND score any
 *      pending decisions whose target was that bar.
 *   3. Schedule a tick that fires `LEAD_TIME_MS` before each 5m
 *      boundary: snapshot the current Pyth price as the synthetic
 *      close of the about-to-finalize bar, build a synthetic bar
 *      object, run the committee, and persist the decision if it's
 *      not an abstain.
 *
 * The dry-run loop is single-threaded by design — all state lives
 * in the closure, no locking required. Persistence is the only
 * external side-effect.
 */
export async function runDryRun({
  db,
  assets,
  log,
}: DryRunOptions): Promise<DryRunHandle> {
  const states = new Map<Asset, DryRunAssetState>();
  // Hydrate.
  for (const asset of assets) {
    const bars = await loadRecentBars({ db, asset, limit: HYDRATE_DEPTH });
    states.set(asset, {
      asset,
      bars,
      currentBar: null,
      lastPredictedBoundary: 0,
      lastFinalizedBoundary: 0,
    });
    log({ kind: "hydrated", asset, barCount: bars.length });
  }
  const candidates = listCommitteeCandidates();
  const roster = await loadCommitteeRoster({ db });
  {
    let total = 0;
    for (const set of roster.byKey.values()) {
      total += set.size;
    }
    log({
      kind: "roster",
      bucketCount: roster.byKey.size,
      totalCandidates: total,
      selectedAtMs: roster.selectedAtMs,
    });
  }
  // Index candidates by roster key for O(1) lookup at decision time.
  const candidatesByKey = new Map<string, Candidate>();
  for (const cand of candidates) {
    candidatesByKey.set(
      candidateRosterKey({
        filterId: cand.filterId,
        filterVersion: cand.version,
        configCanon: cand.configCanon,
      }),
      cand,
    );
  }

  let running = true;
  // Track which decision rows are pending scoring. Map asset → ts_ms (target bar open) → decision id.
  const pendingByAsset = new Map<Asset, Map<number, string>>();
  for (const asset of assets) {
    pendingByAsset.set(asset, new Map());
  }

  const handle = streamPythHermes({
    assets: [...assets],
    onTick: (tick) => {
      const state = states.get(tick.asset);
      if (state === undefined) {
        return;
      }
      // Boundary the tick belongs to.
      const boundary =
        Math.floor(tick.publishTimeMs / FIVE_MIN_MS) * FIVE_MIN_MS;
      if (state.currentBar === null) {
        state.currentBar = {
          openTimeMs: boundary,
          open: tick.price,
          high: tick.price,
          low: tick.price,
          close: tick.price,
        };
        return;
      }
      if (state.currentBar.openTimeMs !== boundary) {
        // Bar boundary crossed → finalize the just-closed bar.
        finalizeAndScore({
          db,
          state,
          closedBar: { ...state.currentBar, volume: 0 },
          pendingByAsset,
          log,
        }).catch((e) =>
          log({
            kind: "error",
            message: `finalize/score failed: ${String(e)}`,
          }),
        );
        state.currentBar = {
          openTimeMs: boundary,
          open: tick.price,
          high: tick.price,
          low: tick.price,
          close: tick.price,
        };
        return;
      }
      // In-progress bar — update HL + latest close.
      if (tick.price > state.currentBar.high) {
        state.currentBar.high = tick.price;
      }
      if (tick.price < state.currentBar.low) {
        state.currentBar.low = tick.price;
      }
      state.currentBar.close = tick.price;
    },
    onConnect: () => log({ kind: "connected" }),
    onDisconnect: (reason) => log({ kind: "disconnected", reason }),
    onError: (err) => log({ kind: "error", message: err.message }),
  });

  // Scheduler loop — checks roughly every second whether we've
  // crossed into the predict-now window.
  const tick = async (): Promise<void> => {
    while (running) {
      try {
        const now = Date.now();
        const nextBoundary = Math.ceil(now / FIVE_MIN_MS) * FIVE_MIN_MS;
        const fireTime = nextBoundary - LEAD_TIME_MS;
        if (now >= fireTime) {
          for (const state of states.values()) {
            if (state.lastPredictedBoundary >= nextBoundary) {
              continue;
            }
            state.lastPredictedBoundary = nextBoundary;
            await makePrediction({
              db,
              state,
              targetTsMs: nextBoundary,
              roster,
              candidatesByKey,
              pendingByAsset,
              log,
            });
          }
        }
        const sleepMs = Math.max(250, Math.min(fireTime - now + 1, 1000));
        await new Promise((resolve) => setTimeout(resolve, sleepMs));
      } catch (e) {
        log({ kind: "error", message: `scheduler: ${String(e)}` });
        await new Promise((resolve) => setTimeout(resolve, 1000));
      }
    }
  };
  void tick();

  return {
    async stop(): Promise<void> {
      running = false;
      await handle.stop();
    },
  };
}

async function makePrediction({
  db,
  state,
  targetTsMs,
  roster,
  candidatesByKey,
  pendingByAsset,
  log,
}: {
  readonly db: DatabaseClient;
  readonly state: DryRunAssetState;
  readonly targetTsMs: number;
  readonly roster: CommitteeRoster;
  readonly candidatesByKey: ReadonlyMap<string, Candidate>;
  readonly pendingByAsset: Map<Asset, Map<number, string>>;
  readonly log: (event: DryRunLogEvent) => void;
}): Promise<void> {
  // Build a synthetic CLOSED bar for the bar that's about to end.
  // We take the current bar accumulator and treat its latest close
  // as the bar's close — this is the "5s before" snapshot.
  const cur = state.currentBar;
  if (cur === null) {
    // No live ticks yet; we can't synthesise a bar. Skip.
    return;
  }
  const synthBar: FilterBar = {
    openTimeMs: cur.openTimeMs,
    open: cur.open,
    high: cur.high,
    low: cur.low,
    close: cur.close,
    volume: 0,
  };
  const bars: readonly FilterBar[] = [...state.bars, synthBar];
  const marketRegime = classifyMarketRegime({ bars });
  // Regime-scoped voter set: only candidates whose backtest record
  // qualified for THIS regime get to vote on this bar. If the
  // classifier can't decide a regime (early-history, can't happen
  // post-hydration in practice) we abstain entirely — no decision,
  // no DB row.
  const rosterCandidates: Candidate[] = [];
  if (marketRegime !== null) {
    const bucket = roster.byKey.get(
      rosterBucketKey({ marketRegime, period: PERIOD_LABEL }),
    );
    if (bucket !== undefined) {
      for (const key of bucket) {
        const cand = candidatesByKey.get(key);
        if (cand !== undefined) {
          rosterCandidates.push(cand);
        }
      }
    }
  }
  const { decision } =
    rosterCandidates.length === 0
      ? { decision: { prediction: null, up: 0, down: 0, abstain: 0 } as const }
      : evaluateCommittee({ bars, candidates: rosterCandidates });
  log({
    kind: "decision",
    asset: state.asset,
    tsMs: targetTsMs,
    prediction:
      decision.prediction === null
        ? null
        : decision.prediction === "up"
          ? "u"
          : "d",
    synthClose: cur.close,
    marketRegime,
    rosterSize: rosterCandidates.length,
    up: decision.up,
    down: decision.down,
    abstain: decision.abstain,
  });
  if (decision.prediction === null) {
    return;
  }
  const prediction = decision.prediction === "up" ? "u" : "d";
  // Persist. The target bar's open = targetTsMs (i.e. the upcoming
  // 5m boundary). Its open price is approximately the current Pyth
  // price (close of the bar we just synthesised). We persist that
  // as `synth_open` because it's both the synthetic close of the
  // prior bar AND the open we're betting the next bar moves away
  // from.
  //
  // `regime_votes` keeps its legacy column name but now stores the
  // flat candidate tally — `{up, down, abstain}` — since the
  // committee no longer groups by filter family. Old rows from
  // before this change still hold the array-shaped per-family
  // breakdown; the dashboard loader handles both formats.
  const inserted = await db
    .insertInto("dry_run_decisions")
    .values({
      ts_ms: targetTsMs,
      decided_at_ms: Date.now(),
      asset: state.asset,
      period: PERIOD_LABEL,
      prediction,
      synth_open: cur.close,
      regime_votes: JSON.stringify({
        up: decision.up,
        down: decision.down,
        abstain: decision.abstain,
      }),
      market_regime: marketRegime,
    })
    .returning("id")
    .executeTakeFirstOrThrow();
  const pending = pendingByAsset.get(state.asset);
  if (pending !== undefined) {
    pending.set(targetTsMs, String(inserted.id));
  }
}

async function finalizeAndScore({
  db,
  state,
  closedBar,
  pendingByAsset,
  log,
}: {
  readonly db: DatabaseClient;
  readonly state: DryRunAssetState;
  readonly closedBar: FilterBar;
  readonly pendingByAsset: Map<Asset, Map<number, string>>;
  readonly log: (event: DryRunLogEvent) => void;
}): Promise<void> {
  // Append the bar to the rolling buffer; trim to avoid unbounded
  // growth.
  state.bars.push(closedBar);
  if (state.bars.length > HYDRATE_DEPTH * 2) {
    state.bars = state.bars.slice(-HYDRATE_DEPTH);
  }
  // Score any pending decisions whose target was THIS bar.
  const pending = pendingByAsset.get(state.asset);
  if (pending === undefined) {
    return;
  }
  const decisionId = pending.get(closedBar.openTimeMs);
  if (decisionId === undefined) {
    return;
  }
  pending.delete(closedBar.openTimeMs);
  // Tie handling matches the backtest: close == open ⇒ "up".
  const actualUp = closedBar.close >= closedBar.open;
  // Look up the prediction so we know how to score.
  const row = await db
    .selectFrom("dry_run_decisions")
    .select(["prediction"])
    .where("id", "=", decisionId)
    .executeTakeFirstOrThrow();
  const predictedUp = row.prediction === "u";
  const won = actualUp === predictedUp ? 1 : 0;
  await db
    .updateTable("dry_run_decisions")
    .set({
      actual_close: closedBar.close,
      won,
    })
    .where("id", "=", decisionId)
    .execute();
  log({
    kind: "outcome",
    asset: state.asset,
    tsMs: closedBar.openTimeMs,
    prediction: row.prediction,
    actualClose: closedBar.close,
    actualOpen: closedBar.open,
    won: won === 1,
  });
}

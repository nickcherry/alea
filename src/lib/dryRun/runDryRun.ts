import "@alea/lib/filters/all";

import { DRY_RUN_MARKET_DISCOVERY_LEAD_MS } from "@alea/constants/dryRun";
import {
  TRADE_DECISION_DEFAULT_PERIODS,
  TRADE_DECISION_HYDRATE_BARS,
  TRADE_DECISION_LEAD_TIME_MS,
  type TradeDecisionPeriod,
} from "@alea/constants/tradeDecision";
import { selectEffectiveCommitteeVotes } from "@alea/lib/committee/aggregate";
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
import type { CommitteeCandidate } from "@alea/lib/committee/types";
import type { DatabaseClient } from "@alea/lib/db/types";
import { loadRecentBars } from "@alea/lib/dryRun/loadRecentBars";
import {
  averageWinningVoteConfidence,
  createDryRunOrderSimulator,
  type DryRunOrderLogEvent,
} from "@alea/lib/dryRun/orderSimulation";
import type { DryRunAssetState } from "@alea/lib/dryRun/types";
import type { Candidate, FilterBar } from "@alea/lib/filters/types";
import { streamPythHermes } from "@alea/lib/livePrices/pyth/streamPythHermes";
import { resolutionTimeframeStepMs } from "@alea/lib/polymarket/enumerateWindowStarts";
import { classifyMarketRegime } from "@alea/lib/regime/classify";
import type { MarketRegime } from "@alea/lib/regime/types";
import { createPolymarketMarketDiscoveryCache } from "@alea/lib/trading/vendor/polymarket/marketDiscoveryCache";
import type { Asset } from "@alea/types/assets";

export type DryRunHandle = {
  readonly stop: () => Promise<void>;
};

export type DryRunOptions = {
  readonly db: DatabaseClient;
  readonly assets: readonly Asset[];
  readonly periods?: readonly TradeDecisionPeriod[];
  readonly log: (event: DryRunLogEvent) => void;
};

export type DryRunLogEvent =
  | {
      readonly kind: "hydrated";
      readonly asset: Asset;
      readonly period: TradeDecisionPeriod;
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
      readonly period: TradeDecisionPeriod;
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
      readonly period: TradeDecisionPeriod;
      readonly tsMs: number;
      readonly prediction: "u" | "d";
      readonly actualClose: number;
      readonly actualOpen: number;
      readonly won: boolean;
    }
  | DryRunOrderLogEvent
  | { readonly kind: "error"; readonly message: string };

/**
 * Starts the dry-run loop. Returns a handle whose `.stop()` cleanly
 * unsubscribes the Pyth stream and stops the scheduler.
 *
 * Operations:
 *   1. Hydrate per-asset/per-period bar buffers from `candles` (most
 *      recent trade-decision history bars).
 *   2. Subscribe to Pyth Hermes for the requested assets. Each
 *      tick updates every configured period's current-bar accumulator;
 *      tick boundary transitions finalize the just-closed bar AND
 *      score any pending decisions whose target was that bar.
 *   3. Schedule a tick that fires before each configured boundary:
 *      snapshot the current Pyth price as the synthetic close of the
 *      about-to-finalize bar, build a synthetic bar object, run the
 *      committee, and persist the decision if it's not an abstain.
 *   4. For non-abstain decisions, simulate the configured post-open
 *      Polymarket order and track whether it fills before expiry.
 *
 * The dry-run loop is single-threaded by design — all state lives
 * in the closure, no locking required. Persistence is the only
 * external side-effect.
 */
export async function runDryRun({
  db,
  assets,
  periods = TRADE_DECISION_DEFAULT_PERIODS,
  log,
}: DryRunOptions): Promise<DryRunHandle> {
  const selectedPeriods: TradeDecisionPeriod[] =
    periods.length === 0
      ? [...TRADE_DECISION_DEFAULT_PERIODS]
      : Array.from(new Set(periods));
  const states = new Map<string, DryRunAssetState>();
  const statesByAsset = new Map<Asset, DryRunAssetState[]>();
  const statesByPeriod = new Map<TradeDecisionPeriod, DryRunAssetState[]>();
  for (const asset of assets) {
    statesByAsset.set(asset, []);
  }
  for (const period of selectedPeriods) {
    statesByPeriod.set(period, []);
  }
  // Hydrate.
  for (const asset of assets) {
    for (const period of selectedPeriods) {
      const bars = await loadRecentBars({
        db,
        asset,
        period,
        limit: TRADE_DECISION_HYDRATE_BARS,
      });
      const state: DryRunAssetState = {
        asset,
        period,
        periodMs: resolutionTimeframeStepMs({ timeframe: period }),
        bars,
        currentBar: null,
        lastPredictedBoundary: 0,
      };
      states.set(dryRunStateKey({ asset, period }), state);
      statesByAsset.get(asset)?.push(state);
      statesByPeriod.get(period)?.push(state);
      log({ kind: "hydrated", asset, period, barCount: bars.length });
    }
  }
  const candidates = listCommitteeCandidates();
  const roster = await loadCommitteeRoster({ db });
  {
    let total = 0;
    for (const bucket of roster.byBucket.values()) {
      total += bucket.length;
    }
    log({
      kind: "roster",
      bucketCount: roster.byBucket.size,
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
  // Track decision rows pending scoring by asset/period state, then target bar open.
  const pendingByState = new Map<string, Map<number, string>>();
  for (const state of states.values()) {
    pendingByState.set(
      dryRunStateKey({ asset: state.asset, period: state.period }),
      new Map(),
    );
  }
  const marketDiscovery = createPolymarketMarketDiscoveryCache();
  const orderSimulator = createDryRunOrderSimulator({
    db,
    marketDiscovery,
    log: (event) => log(event),
  });

  const handle = streamPythHermes({
    assets: [...assets],
    onTick: (tick) => {
      const assetStates = statesByAsset.get(tick.asset);
      if (assetStates === undefined) {
        return;
      }
      for (const state of assetStates) {
        // Boundary the tick belongs to for this period.
        const boundary =
          Math.floor(tick.publishTimeMs / state.periodMs) * state.periodMs;
        if (state.currentBar === null) {
          state.currentBar = {
            openTimeMs: boundary,
            open: tick.price,
            high: tick.price,
            low: tick.price,
            close: tick.price,
          };
          continue;
        }
        if (state.currentBar.openTimeMs !== boundary) {
          // Bar boundary crossed: finalize the just-closed bar.
          finalizeAndScore({
            db,
            state,
            closedBar: { ...state.currentBar, volume: 0 },
            pendingByState,
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
          continue;
        }
        // In-progress bar: update HL + latest close.
        if (tick.price > state.currentBar.high) {
          state.currentBar.high = tick.price;
        }
        if (tick.price < state.currentBar.low) {
          state.currentBar.low = tick.price;
        }
        state.currentBar.close = tick.price;
      }
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
        marketDiscovery.warm({
          assets,
          timeframes: selectedPeriods,
          nowMs: now,
          discoveryLeadMs: DRY_RUN_MARKET_DISCOVERY_LEAD_MS,
        });
        await orderSimulator.tick({ nowMs: now });
        let nextFireTime = now + 1000;
        for (const period of selectedPeriods) {
          const periodMs = resolutionTimeframeStepMs({ timeframe: period });
          const nextBoundary = Math.ceil(now / periodMs) * periodMs;
          const fireTime = nextBoundary - TRADE_DECISION_LEAD_TIME_MS;
          nextFireTime = Math.min(nextFireTime, fireTime);
          if (now >= fireTime) {
            for (const state of statesByPeriod.get(period) ?? []) {
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
                pendingByState,
                orderSimulator,
                log,
              });
            }
          }
        }
        const sleepMs = Math.max(250, Math.min(nextFireTime - now + 1, 1000));
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
      await orderSimulator.stop();
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
  pendingByState,
  orderSimulator,
  log,
}: {
  readonly db: DatabaseClient;
  readonly state: DryRunAssetState;
  readonly targetTsMs: number;
  readonly roster: CommitteeRoster;
  readonly candidatesByKey: ReadonlyMap<string, Candidate>;
  readonly pendingByState: Map<string, Map<number, string>>;
  readonly orderSimulator: ReturnType<typeof createDryRunOrderSimulator>;
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
  // Regime-scoped voter set: only candidates whose training record
  // qualified for THIS regime get to vote on this bar. If the
  // classifier can't decide a regime (early-history, can't happen
  // post-hydration in practice) we abstain entirely — no decision,
  // no DB row.
  const rosterCandidates: CommitteeCandidate[] = [];
  if (marketRegime !== null) {
    const bucket = roster.byBucket.get(
      rosterBucketKey({ marketRegime, period: state.period }),
    );
    if (bucket !== undefined) {
      for (const member of bucket) {
        const cand = candidatesByKey.get(member.key);
        if (cand !== undefined) {
          rosterCandidates.push({
            candidate: cand,
            selection: {
              winRate: member.winRate,
              nEngagements: member.nEngagements,
              rank: member.rank,
            },
          });
        }
      }
    }
  }
  const { decision, votes } =
    rosterCandidates.length === 0
      ? {
          decision: { prediction: null, up: 0, down: 0, abstain: 0 } as const,
          votes: [],
        }
      : evaluateCommittee({ bars, candidates: rosterCandidates });
  const effectiveVotes = selectEffectiveCommitteeVotes({ votes });
  const orderConfidence = averageWinningVoteConfidence({
    prediction: decision.prediction,
    winRates: effectiveVotes
      .filter((vote) => vote.prediction === decision.prediction)
      .map((vote) => vote.selection.winRate),
  });
  log({
    kind: "decision",
    asset: state.asset,
    period: state.period,
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
  // period boundary). Its open price is approximately the current
  // Pyth price (close of the bar we just synthesised). We persist
  // that as `synth_open` because it's both the synthetic close of
  // the prior bar AND the open we're betting the next bar moves away
  // from.
  //
  // `regime_votes` keeps its legacy column name but stores the
  // filter-collapsed decision tally — `{up, down, abstain}`. Old
  // rows from before this change still hold the array-shaped
  // per-family breakdown; the dashboard loader handles both formats.
  const inserted = await db
    .insertInto("dry_run_decisions")
    .values({
      ts_ms: targetTsMs,
      decided_at_ms: Date.now(),
      asset: state.asset,
      period: state.period,
      prediction,
      synth_open: cur.close,
      regime_votes: JSON.stringify({
        up: decision.up,
        down: decision.down,
        abstain: decision.abstain,
        avgWinningVoteConfidence: orderConfidence,
      }),
      market_regime: marketRegime,
    })
    .returning("id")
    .executeTakeFirstOrThrow();
  const pending = pendingByState.get(
    dryRunStateKey({ asset: state.asset, period: state.period }),
  );
  if (pending !== undefined) {
    pending.set(targetTsMs, String(inserted.id));
  }
  await orderSimulator.scheduleOrder({
    decisionId: String(inserted.id),
    asset: state.asset,
    period: state.period,
    prediction,
    targetTsMs,
    confidence: orderConfidence,
  });
}

async function finalizeAndScore({
  db,
  state,
  closedBar,
  pendingByState,
  log,
}: {
  readonly db: DatabaseClient;
  readonly state: DryRunAssetState;
  readonly closedBar: FilterBar;
  readonly pendingByState: Map<string, Map<number, string>>;
  readonly log: (event: DryRunLogEvent) => void;
}): Promise<void> {
  // Append the bar to the rolling buffer; trim to avoid unbounded
  // growth.
  state.bars.push(closedBar);
  if (state.bars.length > TRADE_DECISION_HYDRATE_BARS * 2) {
    state.bars = state.bars.slice(-TRADE_DECISION_HYDRATE_BARS);
  }
  // Score any pending decisions whose target was THIS bar.
  const pending = pendingByState.get(
    dryRunStateKey({ asset: state.asset, period: state.period }),
  );
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
    period: state.period,
    tsMs: closedBar.openTimeMs,
    prediction: row.prediction,
    actualClose: closedBar.close,
    actualOpen: closedBar.open,
    won: won === 1,
  });
}

function dryRunStateKey({
  asset,
  period,
}: {
  readonly asset: Asset;
  readonly period: TradeDecisionPeriod;
}): string {
  return `${period}:${asset}`;
}

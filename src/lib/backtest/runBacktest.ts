import { TRAINING_PROFILE_ID } from "@alea/constants/training";
import {
  type AlignedBarSeries,
  selectFilterWindow,
} from "@alea/lib/filters/barSeries";
import { runHash } from "@alea/lib/filters/hash";
import { getFilter } from "@alea/lib/filters/registry";
import type { Candidate } from "@alea/lib/filters/types";
import { resolveTrainingOutcomeDirection } from "@alea/lib/training/resolveTrainingOutcomeDirection";
import type { Asset } from "@alea/types/assets";
import type { CandleTimeframe } from "@alea/types/candles";
import type { DatabaseClient } from "@alea/lib/db/types";

export type BacktestStats = {
  readonly nBars: number;
  readonly nEngagementsUp: number;
  readonly nWinsUp: number;
  readonly nEngagementsDown: number;
  readonly nWinsDown: number;
};

/**
 * One row to insert into `filter_engagements`. Kept separate from
 * the aggregate counts so we can chunk these into the DB.
 *
 * `tsMs` is the open-time of the candle being PREDICTED (bar i+1),
 * NOT the candle the filter last saw. `direction` is the vote;
 * `won` is 1 iff the realised training direction matched. Tiny
 * open-to-close moves inside the configured ambiguity band do not
 * produce engagement rows.
 */
export type BacktestEngagement = {
  readonly tsMs: number;
  readonly direction: "u" | "d";
  readonly won: 0 | 1;
};

export type RunBacktestResult = {
  readonly runHash: string;
  readonly candidateHash: string;
  readonly filterId: string;
  readonly version: number;
  readonly config: unknown;
  readonly configCanon: string;
  readonly period: CandleTimeframe;
  readonly asset: Asset;
  readonly rangeFirstMs: number;
  readonly rangeLastMs: number;
  readonly stats: BacktestStats;
  readonly fromCache: boolean;
};

// Postgres caps each statement at 65535 bind parameters. Four
// columns per engagement row leaves a hard ceiling at 16383 rows
// per INSERT; 5000 is a safe round number that keeps each
// statement small enough to be canceled cheaply if needed.
const ENGAGEMENT_INSERT_CHUNK = 5000;

/**
 * Walks a series of CLOSED bars and asks one candidate's filter to
 * predict at each bar boundary. At bar `i` (after it has closed),
 * the filter sees `bars[i - N + 1 .. i]` (length N = requiredBars)
 * and predicts the direction of `bars[i + 1]`'s open→close move.
 *
 * **No data leakage**: the prediction window is sliced *exclusive*
 * of `bars[i + 1]`, and the outcome (next bar's close vs open) is
 * only read AFTER the prediction is locked in. Filters never see
 * the bar they're voting on.
 *
 * **Ambiguous outcomes**: Pyth is not the Polymarket settlement feed,
 * so target bars whose open-to-close move is inside the configured
 * training threshold are ignored. The prediction still happened, but
 * it does not contribute a win or loss to the training stats.
 *
 * The last bar in the series can't be a prediction subject (no
 * next bar to score against), so the loop stops at
 * `bars.length - 1`.
 *
 * Caching: the row in `filter_runs` keyed by `runHash` is the
 * authoritative cache only when its stored range exactly matches the
 * requested bounded training window and its profile is active. Otherwise
 * it recomputes from scratch and replaces both the aggregate row and the
 * per-engagement rows in `filter_engagements` atomically (per-run).
 */
export async function runBacktestForCandidate({
  db,
  candidate,
  period,
  asset,
  series,
}: {
  readonly db: DatabaseClient;
  readonly candidate: Candidate;
  readonly period: CandleTimeframe;
  readonly asset: Asset;
  readonly series: AlignedBarSeries;
}): Promise<RunBacktestResult> {
  if (series.pyth.length < 2) {
    throw new Error(
      `training pass needs at least 2 bars, got ${series.pyth.length} for ${candidate.filterId}/${period}/${asset}`,
    );
  }
  const rangeFirstMs = series.pyth[0]!.openTimeMs;
  const rangeLastMs = series.pyth[series.pyth.length - 1]!.openTimeMs;
  const rh = runHash({
    candidateHash: candidate.candidateHash,
    period,
    asset,
  });

  // Cache check. `filter_runs` is the authority when it exactly matches
  // the requested range and was produced by the active training profile.
  // If either changes, the write path below atomically replaces the
  // aggregate row and its `filter_engagements`.
  const existing = await db
    .selectFrom("filter_runs")
    .selectAll()
    .where("run_hash", "=", rh)
    .executeTakeFirst();
  if (
    existing !== undefined &&
    isUsableTrainingCache({ existing, rangeFirstMs, rangeLastMs })
  ) {
    return {
      runHash: rh,
      candidateHash: candidate.candidateHash,
      filterId: candidate.filterId,
      version: candidate.version,
      config: candidate.config,
      configCanon: candidate.configCanon,
      period,
      asset,
      rangeFirstMs: Number(existing.range_first_ms),
      rangeLastMs: Number(existing.range_last_ms),
      stats: {
        nBars: existing.n_bars,
        nEngagementsUp: existing.n_engagements_up,
        nWinsUp: existing.n_wins_up,
        nEngagementsDown: existing.n_engagements_down,
        nWinsDown: existing.n_wins_down,
      },
      fromCache: true,
    };
  }

  // Compute fresh.
  const entry = getFilter(candidate.filterId);
  if (entry === undefined) {
    throw new Error(`unknown filter id ${candidate.filterId}`);
  }
  const requiredBars = entry.filter.requiredBars(candidate.config);
  const { stats, engagements } = walkSeries({
    series,
    requiredBars,
    selectWindow: (endInclusive) =>
      selectFilterWindow({
        series,
        filter: entry.filter,
        endInclusive,
        requiredBars,
      }),
    predict: (window) => entry.filter.predict(candidate.config, window),
  });

  // Replace the engagement set + upsert the aggregate row inside a
  // single transaction so a reader never sees the "old aggregates +
  // new engagements" or vice versa.
  await db.transaction().execute(async (trx) => {
    await trx
      .deleteFrom("filter_engagements")
      .where("run_hash", "=", rh)
      .execute();

    if (engagements.length > 0) {
      for (
        let offset = 0;
        offset < engagements.length;
        offset += ENGAGEMENT_INSERT_CHUNK
      ) {
        const chunk = engagements.slice(
          offset,
          offset + ENGAGEMENT_INSERT_CHUNK,
        );
        await trx
          .insertInto("filter_engagements")
          .values(
            chunk.map((e) => ({
              run_hash: rh,
              ts_ms: e.tsMs,
              direction: e.direction,
              won: e.won,
            })),
          )
          .execute();
      }
    }

    await trx
      .insertInto("filter_runs")
      .values({
        run_hash: rh,
        filter_id: candidate.filterId,
        filter_version: candidate.version,
        training_profile: TRAINING_PROFILE_ID,
        config: candidate.config as never,
        config_canon: candidate.configCanon,
        period,
        asset,
        range_first_ms: rangeFirstMs,
        range_last_ms: rangeLastMs,
        n_bars: stats.nBars,
        n_engagements_up: stats.nEngagementsUp,
        n_wins_up: stats.nWinsUp,
        n_engagements_down: stats.nEngagementsDown,
        n_wins_down: stats.nWinsDown,
        computed_at_ms: Date.now(),
      })
      .onConflict((oc) =>
        oc.column("run_hash").doUpdateSet({
          config: candidate.config as never,
          training_profile: TRAINING_PROFILE_ID,
          config_canon: candidate.configCanon,
          range_first_ms: rangeFirstMs,
          range_last_ms: rangeLastMs,
          n_bars: stats.nBars,
          n_engagements_up: stats.nEngagementsUp,
          n_wins_up: stats.nWinsUp,
          n_engagements_down: stats.nEngagementsDown,
          n_wins_down: stats.nWinsDown,
          computed_at_ms: Date.now(),
        }),
      )
      .execute();
  });

  return {
    runHash: rh,
    candidateHash: candidate.candidateHash,
    filterId: candidate.filterId,
    version: candidate.version,
    config: candidate.config,
    configCanon: candidate.configCanon,
    period,
    asset,
    rangeFirstMs,
    rangeLastMs,
    stats,
    fromCache: false,
  };
}

export type TrainingCacheRange = {
  readonly range_first_ms: string | number | bigint;
  readonly range_last_ms: string | number | bigint;
  readonly training_profile: string;
};

export function isUsableTrainingCache({
  existing,
  rangeFirstMs,
  rangeLastMs,
  trainingProfileId = TRAINING_PROFILE_ID,
}: {
  readonly existing: TrainingCacheRange;
  readonly rangeFirstMs: number;
  readonly rangeLastMs: number;
  readonly trainingProfileId?: string;
}): boolean {
  return (
    Number(existing.range_first_ms) === rangeFirstMs &&
    Number(existing.range_last_ms) === rangeLastMs &&
    existing.training_profile === trainingProfileId
  );
}

/**
 * Pure walker. Iterates the canonical Pyth timeline from index
 * `requiredBars - 1` to `pyth.length - 2` (each step needs a "next
 * bar" to score against), asks `selectWindow` for the trailing
 * window in the filter's declared source, and runs `predict` on it.
 *
 * If `selectWindow` returns `null` (e.g. a Coinbase gap for a volume
 * filter) the bar is skipped — same effect as the filter abstaining.
 *
 * Outcome labeling ALWAYS reads from `series.pyth[i + 1]`, regardless
 * of the filter's input source. Pyth is the Polymarket-aligned
 * outcome proxy; we judge every filter against the same outcome
 * series so price-only and volume filters are directly comparable.
 *
 * Target bars whose close is inside the configured percent threshold
 * around open are treated as ambiguous and skipped.
 */
function walkSeries({
  series,
  requiredBars,
  selectWindow,
  predict,
}: {
  readonly series: AlignedBarSeries;
  readonly requiredBars: number;
  readonly selectWindow: (
    endInclusive: number,
  ) => readonly import("@alea/lib/filters/types").FilterBar[] | null;
  readonly predict: (
    window: readonly import("@alea/lib/filters/types").FilterBar[],
  ) => "up" | "down" | null;
}): {
  readonly stats: BacktestStats;
  readonly engagements: readonly BacktestEngagement[];
} {
  let nEngagementsUp = 0;
  let nWinsUp = 0;
  let nEngagementsDown = 0;
  let nWinsDown = 0;
  const engagements: BacktestEngagement[] = [];
  const pyth = series.pyth;
  const start = Math.max(requiredBars - 1, 0);
  const end = pyth.length - 2; // need bar[i+1] for outcome
  for (let i = start; i <= end; i += 1) {
    const window = selectWindow(i);
    if (window === null) {
      continue;
    }
    const pred = predict(window);
    if (pred === null) {
      continue;
    }
    const next = pyth[i + 1]!;
    const actual = resolveTrainingOutcomeDirection({
      open: next.open,
      close: next.close,
    });
    if (actual === null) {
      continue;
    }
    const won: 0 | 1 = pred === actual ? 1 : 0;
    engagements.push({
      tsMs: next.openTimeMs,
      direction: pred === "up" ? "u" : "d",
      won,
    });
    if (pred === "up") {
      nEngagementsUp += 1;
      if (won === 1) {
        nWinsUp += 1;
      }
    } else {
      nEngagementsDown += 1;
      if (won === 1) {
        nWinsDown += 1;
      }
    }
  }
  return {
    stats: {
      nBars: pyth.length,
      nEngagementsUp,
      nWinsUp,
      nEngagementsDown,
      nWinsDown,
    },
    engagements,
  };
}

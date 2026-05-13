import type { DryRunOrderStatus } from "@alea/constants/dryRun";
import type { CandleTimeframe } from "@alea/types/candles";
import type { Product } from "@alea/types/products";
import type { CandleSource } from "@alea/types/sources";
import type { ColumnType, Generated, Kysely } from "kysely";

export type DatabaseTimestamp = ColumnType<Date, Date | string, Date | string>;

/**
 * Canonical candle row persisted in PostgreSQL. Sources can disagree on the
 * same `(asset, product, timeframe, timestamp)` so source is part of the
 * primary key. Product distinguishes the spot vs perp market on the same
 * asset (which trade at a small funding-rate basis to each other).
 */
export interface CandleTable {
  readonly source: CandleSource;
  readonly asset: string;
  readonly product: Product;
  readonly timeframe: CandleTimeframe;
  readonly timestamp: DatabaseTimestamp;
  readonly open: number;
  readonly high: number;
  readonly low: number;
  readonly close: number;
  readonly volume: number;
}

/**
 * Append-only market-data tape. See migration
 * `202605051400_create_market_event.ts` for the rationale; in short,
 * one row per WS-emitted event with the level/trade payload as JSONB
 * so book updates aren't normalised into a row-per-level explosion.
 *
 * Column names are snake_case to match the Kysely setup (no
 * camel-case conversion plugin is installed). `bigint` columns
 * (`ts_ms`, `received_ms`) come back from `pg` as strings by default —
 * `ColumnType` lets us declare the read-side as `string` and the
 * write-side as `string | number | bigint` so callers can pass
 * `Date.now()` directly without manual coercion.
 */
export interface MarketEventTable {
  readonly id: Generated<string>;
  readonly ts_ms: ColumnType<string, string | number | bigint, never>;
  readonly received_ms: ColumnType<string, string | number | bigint, never>;
  readonly source: string;
  readonly asset: string | null;
  readonly kind: string;
  readonly market_ref: string | null;
  readonly payload: unknown;
}

/**
 * Aggregate cache for filter training artifacts: one row per
 * (filter_id, filter_version, config_canon, period, asset). See
 * migration `202605110000_create_filter_runs.ts` for the original
 * rationale. Per-prediction detail lives in the relational
 * `filter_engagements` table.
 * The columns left here exist purely to support fast leaderboard
 * queries without scanning engagements. `training_profile` identifies
 * the outcome-labeling rule and research window used to produce the
 * derived row.
 */
export interface FilterRunTable {
  readonly run_hash: string;
  readonly filter_id: string;
  readonly filter_version: number;
  readonly training_profile: string;
  readonly config: unknown;
  readonly config_canon: string;
  readonly period: string;
  readonly asset: string;
  readonly range_first_ms: ColumnType<
    string,
    string | number | bigint,
    string | number | bigint
  >;
  readonly range_last_ms: ColumnType<
    string,
    string | number | bigint,
    string | number | bigint
  >;
  readonly n_bars: number;
  readonly n_engagements_up: number;
  readonly n_wins_up: number;
  readonly n_engagements_down: number;
  readonly n_wins_down: number;
  readonly computed_at_ms: ColumnType<
    string,
    string | number | bigint,
    string | number | bigint
  >;
}

/**
 * Append-only per-prediction tape. One row per non-abstain engagement
 * of any candidate. `run_hash` joins to `filter_runs`; `ts_ms` is the
 * open-time of the candle being predicted (NOT the candle the filter
 * last saw). `direction` is the filter's vote ('u' or 'd'); `won` is
 * 1 iff the realised direction matched.
 *
 * Quarter buckets are derived from `ts_ms` at query time
 * (`extract(quarter from to_timestamp(ts_ms / 1000.0))`); there's no
 * separate `quarter` column to keep the table narrow.
 */
export interface FilterEngagementTable {
  readonly run_hash: string;
  readonly ts_ms: ColumnType<
    string,
    string | number | bigint,
    string | number | bigint
  >;
  readonly direction: "u" | "d";
  readonly won: number;
}

/**
 * One row per committee decision made by the dry-run runner. The
 * vote tally stored in `regime_votes` is after the shared
 * one-vote-per-filter policy. See
 * migration `202605120100_create_dry_run_decisions.ts` for the
 * column-by-column rationale. `actual_open` / `actual_close` / `won`
 * start null and get filled in once the target bar settles.
 */
export interface DryRunDecisionTable {
  readonly id: Generated<string>;
  readonly ts_ms: ColumnType<
    string,
    string | number | bigint,
    string | number | bigint
  >;
  readonly decided_at_ms: ColumnType<
    string,
    string | number | bigint,
    string | number | bigint
  >;
  readonly asset: string;
  readonly period: string;
  readonly prediction: "u" | "d";
  readonly synth_open: number;
  readonly regime_votes: unknown;
  readonly actual_open: number | null;
  readonly actual_close: number | null;
  readonly won: number | null;
  readonly market_regime: string | null;
  readonly decision_started_at_ms: ColumnType<
    string | null,
    string | number | bigint | null,
    string | number | bigint | null
  >;
  readonly decision_completed_at_ms: ColumnType<
    string | null,
    string | number | bigint | null,
    string | number | bigint | null
  >;
  readonly decision_duration_ms: number | null;
  readonly order_status: Generated<DryRunOrderStatus>;
  readonly order_placed_at_ms: ColumnType<
    string | null,
    string | number | bigint | null,
    string | number | bigint | null
  >;
  readonly order_observed_price: number | null;
  readonly order_limit_price: number | null;
  readonly order_confidence: number | null;
  readonly order_filled_at_ms: ColumnType<
    string | null,
    string | number | bigint | null,
    string | number | bigint | null
  >;
  readonly order_fill_price: number | null;
  readonly order_fill_latency_ms: number | null;
  readonly order_expires_at_ms: ColumnType<
    string | null,
    string | number | bigint | null,
    string | number | bigint | null
  >;
}

export interface DryRunDecisionAttemptTable {
  readonly id: Generated<string>;
  readonly ts_ms: ColumnType<
    string,
    string | number | bigint,
    string | number | bigint
  >;
  readonly asset: string;
  readonly period: string;
  readonly decision_started_at_ms: ColumnType<
    string,
    string | number | bigint,
    string | number | bigint
  >;
  readonly decision_completed_at_ms: ColumnType<
    string,
    string | number | bigint,
    string | number | bigint
  >;
  readonly decision_duration_ms: number;
  readonly prediction: "u" | "d" | null;
  readonly market_regime: string | null;
  readonly roster_size: number;
  readonly up_votes: number;
  readonly down_votes: number;
  readonly abstain_votes: number;
  readonly dry_run_decision_id: ColumnType<
    string | null,
    string | number | bigint | null,
    string | number | bigint | null
  >;
}

export interface BarRegimeTable {
  readonly asset: string;
  readonly period: string;
  readonly ts_ms: ColumnType<
    string,
    string | number | bigint,
    string | number | bigint
  >;
  readonly market_regime: string | null;
}

/**
 * One row per resolved Polymarket up/down market we've fetched from the
 * gamma-api. The (asset, timeframe, window_start_ts_ms) key is the same
 * shape Alea uses for slug discovery, so a missing row means "haven't
 * looked yet" and a stored row is the venue's final say. See migration
 * `202605120700_create_polymarket_resolutions.ts`.
 */
export interface PolymarketResolutionTable {
  readonly asset: string;
  readonly timeframe: "5m" | "15m";
  readonly window_start_ts_ms: ColumnType<
    string,
    string | number | bigint,
    string | number | bigint
  >;
  readonly condition_id: string;
  readonly outcome: "up" | "down" | "void";
  readonly uma_status: string;
  readonly resolved_at_ms: ColumnType<
    string | null,
    string | number | bigint | null,
    string | number | bigint | null
  >;
  readonly fetched_at_ms: ColumnType<
    string,
    string | number | bigint,
    string | number | bigint
  >;
}

/**
 * One compact price path per completed live Polymarket up/down market.
 * `samples` is JSONB containing tuples of:
 *
 *   [offset_ms, up_price_bps, quality_code]
 *
 * The timestamp for each sample is `window_start_ts_ms + offset_ms`, and
 * `up_price_bps / 10000` recovers the 0..1 UP contract price.
 */
export interface PolymarketPriceSampleTable {
  readonly asset: string;
  readonly timeframe: "5m" | "15m";
  readonly window_start_ts_ms: ColumnType<
    string,
    string | number | bigint,
    string | number | bigint
  >;
  readonly window_end_ts_ms: ColumnType<
    string,
    string | number | bigint,
    string | number | bigint
  >;
  readonly condition_id: string;
  readonly up_token_id: string;
  readonly down_token_id: string;
  readonly schema_version: number;
  readonly sample_interval_ms: number;
  readonly first_sample_ts_ms: ColumnType<
    string | null,
    string | number | bigint | null,
    string | number | bigint | null
  >;
  readonly last_sample_ts_ms: ColumnType<
    string | null,
    string | number | bigint | null,
    string | number | bigint | null
  >;
  readonly finalized_at_ms: ColumnType<
    string,
    string | number | bigint,
    string | number | bigint
  >;
  readonly sample_count: number;
  readonly missing_sample_count: number;
  readonly samples: unknown;
}

export interface CommitteeSelectionTable {
  readonly training_profile: string;
  readonly asset: string;
  readonly market_regime: string;
  readonly period: string;
  readonly filter_id: string;
  readonly filter_version: number;
  readonly config_canon: string;
  readonly rank: number;
  readonly n_engagements: number;
  readonly n_wins: number;
  readonly win_rate: number;
  readonly wilson_low: number;
  readonly worst_quarter_wr: number | null;
  readonly selected_at_ms: ColumnType<
    string,
    string | number | bigint,
    string | number | bigint
  >;
}

export interface CommitteeBacktestRunTable {
  readonly id: Generated<string>;
  readonly run_profile: string;
  readonly training_profile: string;
  readonly selected_at_ms: ColumnType<
    string | null,
    string | number | bigint | null,
    string | number | bigint | null
  >;
  readonly window_start_ms: ColumnType<
    string,
    string | number | bigint,
    string | number | bigint
  >;
  readonly window_end_exclusive_ms: ColumnType<
    string,
    string | number | bigint,
    string | number | bigint
  >;
  readonly started_at_ms: ColumnType<
    string,
    string | number | bigint,
    string | number | bigint
  >;
  readonly completed_at_ms: ColumnType<
    string,
    string | number | bigint,
    string | number | bigint
  >;
  readonly duration_ms: number;
  readonly summary_json: unknown;
}

export interface ExplorationPayloadCacheTable {
  readonly training_profile: string;
  readonly schema_version: number;
  readonly active_candidate_fingerprint: string;
  readonly filter_runs_fingerprint: string;
  readonly bar_regimes_fingerprint: string;
  readonly payload: unknown;
  readonly computed_at_ms: ColumnType<
    string,
    string | number | bigint,
    string | number | bigint
  >;
}

export interface Database {
  readonly candles: CandleTable;
  readonly market_event: MarketEventTable;
  readonly filter_runs: FilterRunTable;
  readonly filter_engagements: FilterEngagementTable;
  readonly dry_run_decisions: DryRunDecisionTable;
  readonly dry_run_decision_attempts: DryRunDecisionAttemptTable;
  readonly bar_regimes: BarRegimeTable;
  readonly committee_selections: CommitteeSelectionTable;
  readonly committee_backtest_runs: CommitteeBacktestRunTable;
  readonly exploration_payload_cache: ExplorationPayloadCacheTable;
  readonly polymarket_resolutions: PolymarketResolutionTable;
  readonly polymarket_price_samples: PolymarketPriceSampleTable;
}

export type DatabaseClient = Kysely<Database>;

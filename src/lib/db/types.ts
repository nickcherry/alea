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
 * One row per OpenAI chart decision made by the dry-run runner. See
 * migration `202605120100_create_dry_run_decisions.ts` for the
 * column-by-column rationale. `actual_close` / `won` start null
 * and get filled in once the target bar settles.
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
  readonly decision_audit: unknown;
  readonly actual_open: number | null;
  readonly actual_close: number | null;
  readonly won: number | null;
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
  readonly order_market_ref: string | null;
  readonly order_up_token_ref: string | null;
  readonly order_down_token_ref: string | null;
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
  readonly source_count: number;
  readonly up_votes: number;
  readonly down_votes: number;
  readonly abstain_votes: number;
  readonly openai_model: string | null;
  readonly openai_direction: string | null;
  readonly openai_confidence: number | null;
  readonly openai_min_confidence: number | null;
  readonly openai_reasoning: string | null;
  readonly dry_run_decision_id: ColumnType<
    string | null,
    string | number | bigint | null,
    string | number | bigint | null
  >;
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
  readonly samples: Buffer;
}

export interface ProxyAccuracyPayloadCacheTable {
  readonly cache_key: string;
  readonly schema_version: number;
  readonly resolutions_fingerprint: string;
  readonly pyth_candle_fingerprint: string;
  readonly outcome_threshold_pct: number;
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
  readonly dry_run_decisions: DryRunDecisionTable;
  readonly dry_run_decision_attempts: DryRunDecisionAttemptTable;
  readonly proxy_accuracy_payload_cache: ProxyAccuracyPayloadCacheTable;
  readonly polymarket_resolutions: PolymarketResolutionTable;
  readonly polymarket_price_samples: PolymarketPriceSampleTable;
}

export type DatabaseClient = Kysely<Database>;

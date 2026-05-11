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
 * Aggregate cache for the filter-committee backtest: one row per
 * (filter_id, filter_version, config_canon, period, asset). See
 * migration `202605110000_create_filter_runs.ts` for the original
 * rationale. The per-fire detail used to live here as a JSONB
 * `fires` blob; migration `202605120000_create_filter_engagements.ts`
 * pulled that out into a relational `filter_engagements` table.
 * The columns left here exist purely to support fast leaderboard
 * queries without scanning engagements.
 */
export interface FilterRunTable {
  readonly run_hash: string;
  readonly filter_id: string;
  readonly filter_version: number;
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
  readonly n_fires_up: number;
  readonly n_wins_up: number;
  readonly n_fires_down: number;
  readonly n_wins_down: number;
  readonly computed_at_ms: ColumnType<
    string,
    string | number | bigint,
    string | number | bigint
  >;
}

/**
 * Append-only per-prediction tape. One row per non-abstain fire of
 * any candidate. `run_hash` joins to `filter_runs`; `ts_ms` is the
 * open-time of the candle being predicted (NOT the candle the filter
 * last saw). `direction` is the filter's vote ('u' or 'd'); `won`
 * is 1 iff the realised direction matched.
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
 * One row per committee decision made by the dry-run runner. See
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
  readonly regime_votes: unknown;
  readonly actual_close: number | null;
  readonly won: number | null;
  readonly market_regime: string | null;
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

export interface CommitteeSelectionTable {
  readonly market_regime: string;
  readonly period: string;
  readonly filter_id: string;
  readonly filter_version: number;
  readonly config_canon: string;
  readonly rank: number;
  readonly n_fires: number;
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

export interface Database {
  readonly candles: CandleTable;
  readonly market_event: MarketEventTable;
  readonly filter_runs: FilterRunTable;
  readonly filter_engagements: FilterEngagementTable;
  readonly dry_run_decisions: DryRunDecisionTable;
  readonly bar_regimes: BarRegimeTable;
  readonly committee_selections: CommitteeSelectionTable;
}

export type DatabaseClient = Kysely<Database>;

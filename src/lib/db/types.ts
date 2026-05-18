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

export interface CandidateBacktestQuarterResultTable {
  readonly id: Generated<string>;
  readonly candidate_id: string;
  readonly filter_id: string;
  readonly filter_name: string;
  readonly filter_version: number;
  readonly cache_hash: string;
  readonly config_canon: string;
  readonly config_hash: string;
  readonly config_json: unknown;
  readonly asset: string;
  readonly timeframe: "1h";
  readonly source: "pyth";
  readonly quarter_start_ms: ColumnType<
    string,
    string | number | bigint,
    string | number | bigint
  >;
  readonly quarter_label: string;
  readonly window_start_ms: ColumnType<
    string,
    string | number | bigint,
    string | number | bigint
  >;
  readonly window_end_ms: ColumnType<
    string,
    string | number | bigint,
    string | number | bigint
  >;
  readonly evaluated_count: number;
  readonly decision_count: number;
  readonly win_count: number;
  readonly loss_count: number;
  readonly neutral_count: number;
  readonly decision_schema_version: number;
  readonly decisions: unknown;
  readonly generated_at_ms: ColumnType<
    string,
    string | number | bigint,
    string | number | bigint
  >;
}

export interface Database {
  readonly candles: CandleTable;
  readonly candidate_backtest_quarter_results: CandidateBacktestQuarterResultTable;
}

export type DatabaseClient = Kysely<Database>;

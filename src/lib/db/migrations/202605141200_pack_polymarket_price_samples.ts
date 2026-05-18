import type { Database } from "@alea/lib/db/types";
import { type Kysely, sql } from "kysely";

/**
 * Repack `polymarket_price_samples` to store packed-tick bytea instead
 * of a JSONB tuple array. Each tick is now 8 bytes (uint32 offsetMs,
 * uint16 up_bps, uint16 down_bps) preceded by an 8-byte header.
 *
 * Old JSONB rows store only the UP price — incompatible with the new
 * both-sides layout — so the table is truncated. Fresh capture starts
 * from the next sampler boot.
 */
export async function up(db: Kysely<Database>): Promise<void> {
  await sql`truncate table polymarket_price_samples`.execute(db);
  await sql`
    alter table polymarket_price_samples drop column samples
  `.execute(db);
  await sql`
    alter table polymarket_price_samples add column samples bytea not null
  `.execute(db);
}

export async function down(db: Kysely<Database>): Promise<void> {
  await sql`truncate table polymarket_price_samples`.execute(db);
  await sql`
    alter table polymarket_price_samples drop column samples
  `.execute(db);
  await sql`
    alter table polymarket_price_samples add column samples jsonb not null
  `.execute(db);
}

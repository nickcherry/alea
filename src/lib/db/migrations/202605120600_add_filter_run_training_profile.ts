import type { Database } from "@alea/lib/db/types";
import { type Kysely, sql } from "kysely";

const LEGACY_TRAINING_PROFILE = "legacy-open-close-tie-up-v0";

/**
 * Tag derived training rows with the training outcome profile that
 * produced them. Existing rows used the old open/close direction rule,
 * so they are explicitly marked legacy and ignored by current readers
 * until `training:run` recomputes them.
 */
export async function up(db: Kysely<Database>): Promise<void> {
  await sql`
    alter table filter_runs
    add column if not exists training_profile text
  `.execute(db);

  await sql`
    update filter_runs
    set training_profile = ${LEGACY_TRAINING_PROFILE}
    where training_profile is null
  `.execute(db);

  await sql`
    alter table filter_runs
    alter column training_profile set not null
  `.execute(db);

  await sql`
    create index if not exists filter_runs_by_training_profile
    on filter_runs (training_profile)
  `.execute(db);
}

export async function down(db: Kysely<Database>): Promise<void> {
  await sql`drop index if exists filter_runs_by_training_profile`.execute(db);
  await sql`
    alter table filter_runs
    drop column if exists training_profile
  `.execute(db);
}

import type { Database } from "@alea/lib/db/types";
import { type Kysely, sql } from "kysely";

const LEGACY_COMMITTEE_SELECTION_PROFILE = "legacy-committee-selection-v0";

/**
 * Committee rosters are derived from training artifacts. Tag them with the
 * active training profile so dry-run/live loaders can ignore stale rosters
 * after outcome-label or research-window changes.
 */
export async function up(db: Kysely<Database>): Promise<void> {
  await sql`
    alter table committee_selections
    add column if not exists training_profile text
  `.execute(db);

  await sql`
    update committee_selections
    set training_profile = ${LEGACY_COMMITTEE_SELECTION_PROFILE}
    where training_profile is null
  `.execute(db);

  await sql`
    alter table committee_selections
    alter column training_profile set not null
  `.execute(db);
}

export async function down(db: Kysely<Database>): Promise<void> {
  await sql`
    alter table committee_selections
    drop column if exists training_profile
  `.execute(db);
}

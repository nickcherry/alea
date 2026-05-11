import type { DatabaseClient } from "@alea/lib/db/types";
import type { SelectedCandidate } from "@alea/lib/committee/selection/types";

/**
 * Wipes `committee_selections` and rewrites it with the supplied
 * snapshot inside a single transaction. Selection is a single point
 * in time — old rows are not history we keep, they're a stale
 * roster we want gone.
 *
 * `selectedAtMs` is stamped on every row so an operator can see how
 * fresh the live voter roster is.
 */
export async function persistCommitteeSelections({
  db,
  selections,
  selectedAtMs,
}: {
  readonly db: DatabaseClient;
  readonly selections: readonly SelectedCandidate[];
  readonly selectedAtMs: number;
}): Promise<void> {
  await db.transaction().execute(async (tx) => {
    await tx.deleteFrom("committee_selections").execute();
    if (selections.length === 0) return;
    await tx
      .insertInto("committee_selections")
      .values(
        selections.map((s) => ({
          market_regime: s.marketRegime,
          period: s.period,
          filter_id: s.filterId,
          filter_version: s.filterVersion,
          config_canon: s.configCanon,
          rank: s.rank,
          n_fires: s.nFires,
          n_wins: s.nWins,
          win_rate: s.winRate,
          wilson_low: s.wilsonLow,
          worst_quarter_wr: s.worstQuarterWinRate,
          selected_at_ms: selectedAtMs,
        })),
      )
      .execute();
  });
}

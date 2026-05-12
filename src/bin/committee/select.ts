import { defineCommand } from "@alea/lib/cli/defineCommand";
import { loadCandidateRegimeStats } from "@alea/lib/committee/selection/loadCandidateRegimeStats";
import { persistCommitteeSelections } from "@alea/lib/committee/selection/persistSelections";
import { selectCommitteeCandidates } from "@alea/lib/committee/selection/selectCandidates";
import { DEFAULT_COMMITTEE_SELECTION_RULES } from "@alea/lib/committee/selection/types";
import { createDatabase } from "@alea/lib/db/createDatabase";
import { destroyDatabase } from "@alea/lib/db/destroyDatabase";
import pc from "picocolors";

/**
 * Rebuilds the asset/regime-scoped voter roster in `committee_selections`.
 *
 * Reads the asset/regime-stratified training stats from
 * `filter_engagements ⋈ bar_regimes`, applies the eligibility +
 * top-N rules in `lib/committee/selection/`, and writes the result
 * in one transaction. The dry-run loop (and live trading, when it
 * exists) loads this table at startup and only lets a candidate
 * vote when the classifier's current-bar regime matches the row.
 *
 * Manual command — operator runs it after a fresh `training:run`
 * pass (which feeds new `filter_engagements`) or after
 * `regimes:backfill` (which feeds new `bar_regimes` tags).
 *
 * No CLI flags yet — the thresholds in
 * `DEFAULT_COMMITTEE_SELECTION_RULES` are the contract. If we ever
 * need per-asset/regime overrides, surface them as flags here so the
 * library stays pure.
 */
export const committeeSelectCommand = defineCommand({
  name: "committee:select",
  summary:
    "Pick the top-N candidates per asset/regime and write committee_selections",
  description:
    "Scans asset/regime-stratified training stats (filter_engagements ⋈ bar_regimes), applies the eligibility rules (min engagements, aggregate WR floor, worst-quarter WR floor), ranks the qualifiers by Wilson lower bound desc, takes the top N per (asset, market_regime, period), and rewrites committee_selections.",
  options: [],
  examples: ["bun alea committee:select"],
  output:
    "Per-regime selection summary (count selected, top filter, last-ranked score).",
  sideEffects:
    "Truncates and rewrites the `committee_selections` table inside a single transaction.",
  async run({ io }) {
    io.writeStdout(`${pc.bold("committee:select")}\n\n`);
    const rules = DEFAULT_COMMITTEE_SELECTION_RULES;
    io.writeStdout(
      `${pc.dim("rules:")} minEngagements=${rules.minEngagements} ` +
        `aggWR>=${(rules.minAggregateWinRate * 100).toFixed(1)}% ` +
        `worstQ WR>=${(rules.minWorstQuarterWinRate * 100).toFixed(1)}% ` +
        `(q>=${rules.worstQuarterMinEngagements} engagements) ` +
        `top=${rules.topN}\n\n`,
    );
    const db = createDatabase();
    try {
      const stats = await loadCandidateRegimeStats({
        db,
        worstQuarterMinEngagements: rules.worstQuarterMinEngagements,
      });
      const selections = selectCommitteeCandidates({ stats, rules });
      const selectedAtMs = Date.now();
      await persistCommitteeSelections({ db, selections, selectedAtMs });

      // Per-(asset, period, regime) breakdown of what landed on the
      // roster. Bullet line per group with the strongest entry
      // and the marginal entry so the operator can eyeball
      // whether the bar is well calibrated.
      const byKey = new Map<string, (typeof selections)[number][]>();
      for (const s of selections) {
        const key = `${s.asset}|${s.period}|${s.marketRegime}`;
        const list = byKey.get(key) ?? [];
        list.push(s);
        byKey.set(key, list);
      }
      const keys = [...byKey.keys()].sort();
      for (const key of keys) {
        const list = byKey.get(key)!;
        const [asset, period, regime] = key.split("|");
        const top = list[0]!;
        const last = list[list.length - 1]!;
        io.writeStdout(
          `  ${pc.bold((asset ?? "?").toUpperCase().padEnd(5))} ` +
            `${pc.bold((period ?? "?").padEnd(4))} ${pc.dim(regime ?? "?")} ` +
            `${pc.green(`selected=${list.length}`)} ` +
            `${pc.dim("top=")}${(top.winRate * 100).toFixed(1)}% ${top.filterId} ` +
            `${pc.dim(`(${top.nEngagements.toLocaleString()} engagements)`)} ` +
            `${pc.dim(`last=${(last.winRate * 100).toFixed(1)}%`)}\n`,
        );
      }
      io.writeStdout(
        `\n${pc.green("wrote")} ${selections.length.toLocaleString()} rows to ${pc.dim("committee_selections")}\n`,
      );
    } finally {
      await destroyDatabase(db);
    }
  },
});

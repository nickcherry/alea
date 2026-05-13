import "@alea/lib/filters/all";

import { loadCandidateRegimeStats } from "@alea/lib/committee/selection/loadCandidateRegimeStats";
import { selectCommitteeCandidates } from "@alea/lib/committee/selection/selectCandidates";
import { DEFAULT_COMMITTEE_SELECTION_PROFILE } from "@alea/lib/committee/selection/types";
import { createDatabase } from "@alea/lib/db/createDatabase";
import { destroyDatabase } from "@alea/lib/db/destroyDatabase";

const NEW_FILTERS = new Set([
  "high_volume_failed_breakout_fade",
  "volume_compression_breakout_follow",
  "volume_gradient_trend_follow",
  "volume_taper_exhaustion_fade",
  "signed_volume_imbalance_fade",
  "price_volume_disagreement_fade",
  "rolling_vwap_cross_follow",
  "volume_profile_value_area_edge_fade",
  "low_volume_node_traverse_follow",
  "relvol_context_markov_direction",
]);

async function main(): Promise<void> {
  const profile = DEFAULT_COMMITTEE_SELECTION_PROFILE;
  const rules = profile.baseRules;
  const db = createDatabase();
  try {
    const stats = await loadCandidateRegimeStats({
      db,
      worstQuarterMinEngagements: rules.worstQuarterMinEngagements,
    });
    const selected = selectCommitteeCandidates({ stats, rules, profile });

    // 1. Per-bucket new-filter seat counts
    type SeatRow = {
      asset: string;
      period: string;
      regime: string;
      newSeats: { filterId: string; configCanon: string; rank: number; winRate: number; n: number }[];
      totalSeats: number;
    };
    const byBucket = new Map<string, SeatRow>();
    for (const s of selected) {
      const key = `${s.asset}|${s.period}|${s.marketRegime}`;
      let row = byBucket.get(key);
      if (row === undefined) {
        row = {
          asset: s.asset,
          period: s.period,
          regime: s.marketRegime,
          newSeats: [],
          totalSeats: 0,
        };
        byBucket.set(key, row);
      }
      row.totalSeats += 1;
      if (NEW_FILTERS.has(s.filterId)) {
        row.newSeats.push({
          filterId: s.filterId,
          configCanon: s.configCanon,
          rank: s.rank,
          winRate: s.winRate,
          n: s.nEngagements,
        });
      }
    }

    // 2. Aggregate by filter
    const byFilter = new Map<
      string,
      {
        seats: number;
        buckets: { asset: string; period: string; regime: string; rank: number; wr: number; n: number; configCanon: string }[];
      }
    >();
    for (const s of selected) {
      if (!NEW_FILTERS.has(s.filterId)) {
        continue;
      }
      let agg = byFilter.get(s.filterId);
      if (agg === undefined) {
        agg = { seats: 0, buckets: [] };
        byFilter.set(s.filterId, agg);
      }
      agg.seats += 1;
      agg.buckets.push({
        asset: s.asset,
        period: s.period,
        regime: s.marketRegime,
        rank: s.rank,
        wr: s.winRate,
        n: s.nEngagements,
        configCanon: s.configCanon,
      });
    }

    // 3. Per-filter eligibility scan (across all buckets, even if not selected)
    type FilterScan = {
      buckets: number;
      eligible: number;
      seats: number;
      best: { wr: number; n: number; asset: string; period: string; regime: string } | null;
    };
    const scanByFilter = new Map<string, FilterScan>();
    for (const id of NEW_FILTERS) {
      scanByFilter.set(id, { buckets: 0, eligible: 0, seats: 0, best: null });
    }
    for (const s of stats) {
      if (!NEW_FILTERS.has(s.filterId)) {
        continue;
      }
      const scan = scanByFilter.get(s.filterId)!;
      scan.buckets += 1;
      // Determine override rules in effect for this bucket.
      const effRules = effectiveRules({ profile, asset: s.asset, period: s.period });
      const eligible =
        s.nEngagements >= effRules.minEngagements &&
        s.winRate >= effRules.minAggregateWinRate &&
        (s.worstQuarterWinRate === null ||
          s.worstQuarterWinRate >= effRules.minWorstQuarterWinRate);
      if (eligible) {
        scan.eligible += 1;
      }
      if (scan.best === null || s.winRate > scan.best.wr) {
        scan.best = {
          wr: s.winRate,
          n: s.nEngagements,
          asset: s.asset,
          period: s.period,
          regime: s.marketRegime,
        };
      }
    }
    for (const [filterId, agg] of byFilter.entries()) {
      scanByFilter.get(filterId)!.seats = agg.seats;
    }

    // Print
    console.log("# New volume filters — committee gatekeeping simulation");
    console.log();
    console.log("Rules:");
    console.log(`  minEngagements ≥ ${rules.minEngagements}`);
    console.log(`  aggregate WR ≥ ${(rules.minAggregateWinRate * 100).toFixed(1)}% (BTC/ETH override: ${(0.55 * 100).toFixed(1)}%, weak-asset 5m override: 58.0%)`);
    console.log(`  worst-quarter WR ≥ ${(rules.minWorstQuarterWinRate * 100).toFixed(1)}% (when a quarter clears ${rules.worstQuarterMinEngagements} engagements)`);
    console.log(`  topN ≤ ${rules.topN} (BTC/ETH: 8, weak-asset 5m: 4)`);
    console.log();

    console.log("## Per-filter summary");
    console.log();
    console.log("filter | eligible buckets / total | seats won | best (asset/period/regime, WR, n)");
    console.log("--- | --- | --- | ---");
    const sortedScan = [...scanByFilter.entries()].sort(
      (a, b) => b[1].seats - a[1].seats,
    );
    for (const [filterId, scan] of sortedScan) {
      const best =
        scan.best === null
          ? "—"
          : `${scan.best.asset}/${scan.best.period}/${scan.best.regime} ${(scan.best.wr * 100).toFixed(1)}% n=${scan.best.n}`;
      console.log(
        `${filterId} | ${scan.eligible}/${scan.buckets} | ${scan.seats} | ${best}`,
      );
    }
    console.log();

    console.log("## Seats by (asset/period/regime) for new filters");
    console.log();
    const bucketKeys = [...byBucket.keys()]
      .filter((k) => (byBucket.get(k)?.newSeats.length ?? 0) > 0)
      .sort();
    for (const key of bucketKeys) {
      const row = byBucket.get(key)!;
      const seats = row.newSeats
        .sort((a, b) => a.rank - b.rank)
        .map(
          (s) =>
            `#${s.rank} ${s.filterId} (${(s.winRate * 100).toFixed(1)}% n=${s.n})`,
        )
        .join("; ");
      console.log(
        `- **${row.asset}/${row.period}/${row.regime}** — ${row.newSeats.length}/${row.totalSeats} seats new: ${seats}`,
      );
    }

    // Totals
    const totalNewSeats = [...byFilter.values()].reduce(
      (sum, agg) => sum + agg.seats,
      0,
    );
    const totalSeats = selected.length;
    console.log();
    console.log(
      `## Totals: ${totalNewSeats} new-filter seats out of ${totalSeats} total roster slots (${((100 * totalNewSeats) / totalSeats).toFixed(1)}%).`,
    );
  } finally {
    await destroyDatabase(db);
  }
}

function effectiveRules({
  profile,
  asset,
  period,
}: {
  readonly profile: typeof DEFAULT_COMMITTEE_SELECTION_PROFILE;
  readonly asset: string;
  readonly period: string;
}): {
  minEngagements: number;
  minAggregateWinRate: number;
  minWorstQuarterWinRate: number;
  topN: number;
} {
  let out = {
    minEngagements: profile.baseRules.minEngagements,
    minAggregateWinRate: profile.baseRules.minAggregateWinRate,
    minWorstQuarterWinRate: profile.baseRules.minWorstQuarterWinRate,
    topN: profile.baseRules.topN,
  };
  for (const override of profile.ruleOverrides) {
    const assetOK = override.assets === undefined || override.assets.includes(asset);
    const periodOK = override.periods === undefined || override.periods.includes(period);
    if (assetOK && periodOK) {
      out = {
        minEngagements: override.minEngagements ?? out.minEngagements,
        minAggregateWinRate:
          override.minAggregateWinRate ?? out.minAggregateWinRate,
        minWorstQuarterWinRate:
          override.minWorstQuarterWinRate ?? out.minWorstQuarterWinRate,
        topN: override.topN ?? out.topN,
      };
    }
  }
  return out;
}

void main();

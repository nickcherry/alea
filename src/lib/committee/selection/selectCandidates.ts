import type {
  CandidateRegimeStats,
  CommitteeSelectionRules,
  SelectedCandidate,
} from "@alea/lib/committee/selection/types";

/**
 * Apply the eligibility + ranking rules to a flat list of
 * `(candidate, regime)` stats and return the selected top-N per
 * `(regime, period)`. Pure function — no DB, no IO — so the unit
 * tests can pin behavior without a Postgres dependency.
 *
 * Eligibility (per regime):
 *   - `nFires ≥ minFires`
 *   - `winRate ≥ minAggregateWinRate`
 *   - `worstQuarterWinRate ≥ minWorstQuarterWinRate` when not null.
 *     A `null` worst-quarter score (no quarter cleared the sample
 *     gate) skips this check rather than disqualifies — sparse
 *     candidates with high aggregate WR should still be eligible.
 *
 * Ranking: Wilson 95% lower bound desc, with `nFires` desc as
 * tie-break. Wilson LB punishes small samples in the ordering even
 * when they cleared the absolute eligibility bar, so a 20-fire 80%
 * candidate gets in but ranks below a 500-fire 60% candidate.
 */
export function selectCommitteeCandidates({
  stats,
  rules,
}: {
  readonly stats: readonly CandidateRegimeStats[];
  readonly rules: CommitteeSelectionRules;
}): readonly SelectedCandidate[] {
  const eligible = stats.filter((s) => isEligible({ stats: s, rules }));
  const byKey = new Map<string, CandidateRegimeStats[]>();
  for (const s of eligible) {
    const key = `${s.period}|${s.marketRegime}`;
    let list = byKey.get(key);
    if (list === undefined) {
      list = [];
      byKey.set(key, list);
    }
    list.push(s);
  }
  const out: SelectedCandidate[] = [];
  for (const list of byKey.values()) {
    list.sort((a, b) => {
      if (b.wilsonLow !== a.wilsonLow) {
        return b.wilsonLow - a.wilsonLow;
      }
      return b.nFires - a.nFires;
    });
    const top = list.slice(0, rules.topN);
    for (let i = 0; i < top.length; i++) {
      out.push({ ...top[i]!, rank: i + 1 });
    }
  }
  return out;
}

function isEligible({
  stats,
  rules,
}: {
  readonly stats: CandidateRegimeStats;
  readonly rules: CommitteeSelectionRules;
}): boolean {
  if (stats.nFires < rules.minFires) {
    return false;
  }
  if (stats.winRate < rules.minAggregateWinRate) {
    return false;
  }
  if (
    stats.worstQuarterWinRate !== null &&
    stats.worstQuarterWinRate < rules.minWorstQuarterWinRate
  ) {
    return false;
  }
  return true;
}

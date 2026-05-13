import type {
  CandidateRegimeStats,
  CommitteeSelectionProfile,
  CommitteeSelectionRuleOverride,
  CommitteeSelectionRules,
  SelectedCandidate,
} from "@alea/lib/committee/selection/types";

/**
 * Apply the eligibility + ranking rules to a flat list of
 * `(candidate, asset, regime)` stats and return the selected top-N distinct
 * filters per `(asset, regime, period)`. Pure function — no DB, no IO — so the
 * unit tests can pin behavior without a Postgres dependency.
 *
 * Eligibility (per asset/regime):
 *   - `nEngagements ≥ minEngagements`
 *   - `winRate ≥ minAggregateWinRate`
 *   - `worstQuarterWinRate ≥ minWorstQuarterWinRate` when not null.
 *     A `null` worst-quarter score (no quarter cleared the sample
 *     gate) skips this check rather than disqualifies — sparse
 *     candidates with high aggregate WR should still be eligible.
 *
 * Ranking: Wilson 95% lower bound desc, with `nEngagements` desc as
 * tie-break. Wilson LB punishes small samples in the ordering even
 * when they cleared the absolute eligibility bar, so a 90-engagement
 * 80% candidate gets in but ranks below a 500-engagement 60% candidate.
 */
export function selectCommitteeCandidates({
  stats,
  rules,
  profile = {
    baseRules: rules,
    ruleOverrides: [],
  },
}: {
  readonly stats: readonly CandidateRegimeStats[];
  readonly rules: CommitteeSelectionRules;
  readonly profile?: CommitteeSelectionProfile;
}): readonly SelectedCandidate[] {
  const eligible = stats.filter((s) =>
    isEligible({
      stats: s,
      rules: rulesForStats({ stats: s, profile }),
    }),
  );
  const byKey = new Map<string, CandidateRegimeStats[]>();
  for (const s of eligible) {
    const key = `${s.asset}|${s.period}|${s.marketRegime}`;
    let list = byKey.get(key);
    if (list === undefined) {
      list = [];
      byKey.set(key, list);
    }
    list.push(s);
  }
  const out: SelectedCandidate[] = [];
  for (const list of byKey.values()) {
    list.sort(compareCandidateStats);
    const first = list[0];
    if (first === undefined) {
      continue;
    }
    const bucketRules = rulesForStats({ stats: first, profile });
    const top = keepBestConfigPerFilter({ sorted: list }).slice(
      0,
      bucketRules.topN,
    );
    for (let i = 0; i < top.length; i++) {
      out.push({ ...top[i]!, rank: i + 1 });
    }
  }
  return out;
}

function rulesForStats({
  stats,
  profile,
}: {
  readonly stats: CandidateRegimeStats;
  readonly profile: CommitteeSelectionProfile;
}): CommitteeSelectionRules {
  let out = profile.baseRules;
  for (const override of profile.ruleOverrides) {
    if (matchesOverride({ stats, override })) {
      out = applyOverride({ rules: out, override });
    }
  }
  return out;
}

function matchesOverride({
  stats,
  override,
}: {
  readonly stats: CandidateRegimeStats;
  readonly override: CommitteeSelectionRuleOverride;
}): boolean {
  return (
    matchesOptionalList({ value: stats.asset, list: override.assets }) &&
    matchesOptionalList({ value: stats.period, list: override.periods }) &&
    matchesOptionalList({
      value: stats.marketRegime,
      list: override.marketRegimes,
    })
  );
}

function matchesOptionalList({
  value,
  list,
}: {
  readonly value: string;
  readonly list?: readonly string[];
}): boolean {
  return list === undefined || list.includes(value);
}

function applyOverride({
  rules,
  override,
}: {
  readonly rules: CommitteeSelectionRules;
  readonly override: CommitteeSelectionRuleOverride;
}): CommitteeSelectionRules {
  return {
    ...rules,
    minEngagements: override.minEngagements ?? rules.minEngagements,
    minAggregateWinRate:
      override.minAggregateWinRate ?? rules.minAggregateWinRate,
    minWorstQuarterWinRate:
      override.minWorstQuarterWinRate ?? rules.minWorstQuarterWinRate,
    topN: override.topN ?? rules.topN,
  };
}

function compareCandidateStats(
  a: CandidateRegimeStats,
  b: CandidateRegimeStats,
): number {
  if (b.wilsonLow !== a.wilsonLow) {
    return b.wilsonLow - a.wilsonLow;
  }
  return b.nEngagements - a.nEngagements;
}

function keepBestConfigPerFilter({
  sorted,
}: {
  readonly sorted: readonly CandidateRegimeStats[];
}): readonly CandidateRegimeStats[] {
  const seen = new Set<string>();
  const out: CandidateRegimeStats[] = [];
  for (const s of sorted) {
    if (seen.has(s.filterId)) {
      continue;
    }
    seen.add(s.filterId);
    out.push(s);
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
  if (stats.nEngagements < rules.minEngagements) {
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

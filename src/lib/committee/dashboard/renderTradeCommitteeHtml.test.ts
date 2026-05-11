import { renderTradeCommitteeHtml } from "@alea/lib/committee/dashboard/renderTradeCommitteeHtml";
import type { TradeCommitteePayload } from "@alea/lib/committee/dashboard/types";
import { describe, expect, it } from "bun:test";

describe("renderTradeCommitteeHtml", () => {
  it("renders the roster table, filters, nav link, and selection config", () => {
    const html = renderTradeCommitteeHtml({
      payload: payloadFixture(),
      assets: { stylesheets: [], scripts: [] },
    });

    expect(html).toContain("Trade Committee");
    expect(html).toContain('href="/committee/" aria-current="page"');
    expect(html).toContain("low vol ranging");
    expect(html).toContain("rsi_mean_rev");
    expect(html).toContain('data-period="15m"');
    expect(html).toContain("Median WR");
    expect(html).not.toContain("Active Buckets");
    expect(html).toContain("Bucket Cap");
    expect(html).toContain("Aggregate WR Floor");
    expect(html).toContain("Wilson low desc");
    expect(html).toContain("pyth-open-close-min-abs-move-pct-v1:0.01");
  });
});

function payloadFixture(): TradeCommitteePayload {
  return {
    generatedAtMs: 1_777_900_600_000,
    selectedAtMs: 1_777_900_500_000,
    rowCount: 1,
    uniqueFilterCount: 1,
    activeBucketCount: 1,
    selectionConfig: {
      minEngagements: 20,
      minAggregateWinRate: 0.53,
      minWorstQuarterWinRate: 0.5,
      worstQuarterMinEngagements: 10,
      topN: 10,
      trainingOutcomeProfileId: "pyth-open-close-min-abs-move-pct-v1:0.01",
      trainingOutcomeMinAbsMovePct: 0.01,
      rankingMetric: "wilson_low_desc",
      tieBreak: "n_engagements_desc",
    },
    rows: [
      {
        id: "5m|low_vol_ranging|rsi_mean_rev|1|{}",
        marketRegime: "low_vol_ranging",
        period: "5m",
        filterId: "rsi_mean_rev",
        filterVersion: 1,
        filterFamily: "oscillator_reversion",
        filterDescription: "RSI mean reversion.",
        configCanon: '{"length":14,"low":30,"high":70}',
        rank: 1,
        nEngagements: 120,
        nWins: 68,
        winRate: 68 / 120,
        wilsonLow: 0.477,
        worstQuarterWinRate: 0.52,
        selectedAtMs: 1_777_900_500_000,
      },
    ],
    buckets: [
      {
        marketRegime: "low_vol_ranging",
        period: "5m",
        candidateCount: 1,
        topFilterId: "rsi_mean_rev",
        topWinRate: 68 / 120,
        selectedAtMs: 1_777_900_500_000,
      },
    ],
  };
}

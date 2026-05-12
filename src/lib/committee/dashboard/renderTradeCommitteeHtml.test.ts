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
    // Regime label appears in the tab-button row, not in the body —
    // the table body is JS-hydrated from the embedded JSON payload.
    expect(html).toContain("Low vol ranging");
    expect(html).toContain(
      'data-regime="low_vol_ranging" aria-selected="true"',
    );
    expect(html).not.toContain('data-regime="all"');
    // The JSON payload script tag carries the row data verbatim.
    expect(html).toContain("rsi_mean_rev");
    expect(html).toContain('data-period="15m"');
    // Top metric cards + the bucket-tile overview were removed — period
    // toggle is the page-level control and the roster derives its
    // period from it.
    expect(html).not.toContain("Median WR");
    expect(html).not.toContain("Roster Fill");
    expect(html).not.toContain("Selected At");
    expect(html).not.toContain("Active Buckets");
    expect(html).not.toContain("committee-bucket-tile");
    expect(html).toContain("Bucket Cap");
    expect(html).toContain("Aggregate WR Floor");
    expect(html).toContain("Wilson low desc");
    expect(html).toContain("pyth-open-close-min-abs-move-pct-v1:0.02");
    expect(html).toContain("earliest candle -&gt; 2026-03-31");
    expect(html).toContain("train-earliest-through-2026-q1");
  });
});

function payloadFixture(): TradeCommitteePayload {
  return {
    generatedAtMs: 1_777_900_600_000,
    selectedAtMs: 1_777_900_500_000,
    rowCount: 1,
    uniqueFilterCount: 1,
    selectionConfig: {
      minEngagements: 20,
      minAggregateWinRate: 0.53,
      minWorstQuarterWinRate: 0.5,
      worstQuarterMinEngagements: 10,
      topN: 10,
      trainingProfileId:
        "pyth-open-close-min-abs-move-pct-v1:0.02|train-earliest-through-2026-q1__backtest-2026-q2-through-yesterday-v1",
      trainingOutcomeProfileId: "pyth-open-close-min-abs-move-pct-v1:0.02",
      trainingOutcomeMinAbsMovePct: 0.02,
      trainingWindowStartPolicy: "earliest_available_candle",
      trainingWindowEndInclusiveMs: Date.parse("2026-03-31T23:59:59.999Z"),
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
  };
}

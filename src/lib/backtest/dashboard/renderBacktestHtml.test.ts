import { renderBacktestHtml } from "@alea/lib/backtest/dashboard/renderBacktestHtml";
import type { BacktestDashboardPayload } from "@alea/lib/backtest/dashboard/types";
import { describe, expect, it } from "bun:test";

function payloadFixture(): BacktestDashboardPayload {
  return {
    generatedAtMs: Date.UTC(2026, 4, 12, 12),
    trainingProfileId: "profile-v1",
    supportedPeriods: ["5m", "15m"],
    assets: ["btc", "eth"],
    stakeUsd: 20,
    summary: {
      activeCandidateCount: 1,
      activeFilterCount: 1,
      expectedRunCount: 2,
      runCount: 2,
      missingRunCount: 0,
      ignoredInactiveRunCount: 0,
      nBars: 200,
      nEngagements: 10,
      nWins: 6,
      winRate: 0.6,
      nEngagementsUp: 4,
      nWinsUp: 2,
      upWinRate: 0.5,
      nEngagementsDown: 6,
      nWinsDown: 4,
      downWinRate: 2 / 3,
      rangeFirstMs: Date.UTC(2026, 3, 1),
      rangeLastMs: Date.UTC(2026, 3, 2),
      computedAtMinMs: Date.UTC(2026, 4, 12, 11),
      computedAtMaxMs: Date.UTC(2026, 4, 12, 12),
    },
    byPeriod: [],
    byAsset: [],
    topCandidates: [],
    pnlSeries: [],
  };
}

describe("renderBacktestHtml", () => {
  it("renders shell, period toggle, trade activity, and chart", () => {
    const html = renderBacktestHtml({
      payload: payloadFixture(),
      assets: {
        stylesheets: ["alea.css", "backtest.css"],
        scripts: ["backtest.js"],
      },
    });

    expect(html).toContain("Alea &middot; Backtest");
    expect(html).toContain("backtest-period-tab");
    expect(html).toContain("backtest-pnl-chart");
    expect(html).toContain("Trade activity");
    expect(html).toContain('data-backtest-activity-row="all"');
    expect(html).toContain('data-backtest-activity-row="btc"');
    expect(html).toContain('data-backtest-activity-row="eth"');
    expect(html).toContain("alea-collapsible");
    expect(html).toContain("profile-v1");
  });

  it("omits the removed asset selector and assets section", () => {
    const html = renderBacktestHtml({
      payload: payloadFixture(),
      assets: { stylesheets: [], scripts: [] },
    });
    expect(html).not.toContain("backtest-asset-select");
    expect(html).not.toContain(">Assets<");
    expect(html).not.toContain(">Period / Asset<");
  });

  it("renders profile collapsed by default", () => {
    const html = renderBacktestHtml({
      payload: payloadFixture(),
      assets: { stylesheets: [], scripts: [] },
    });
    expect(html).not.toMatch(/<details[^>]*\bopen\b[^>]*backtest-profile/);
  });
});

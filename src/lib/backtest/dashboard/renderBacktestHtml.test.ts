import { renderBacktestHtml } from "@alea/lib/backtest/dashboard/renderBacktestHtml";
import type { BacktestDashboardPayload } from "@alea/lib/backtest/dashboard/types";
import { describe, expect, it } from "bun:test";

describe("renderBacktestHtml", () => {
  it("renders the backtest dashboard shell, period toggle, asset selector, and chart", () => {
    const payload: BacktestDashboardPayload = {
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
        nBarsMax: 100,
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
      topCandidatesByAsset: [],
      pnlSeries: [],
    };

    const html = renderBacktestHtml({
      payload,
      assets: {
        stylesheets: ["alea.css", "backtest.css"],
        scripts: ["backtest.js"],
      },
    });

    expect(html).toContain("Alea &middot; Backtest");
    expect(html).toContain("Backtest");
    expect(html).toContain("/dryrun/");
    expect(html).not.toContain("latest ");
    expect(html).not.toContain("runs");
    expect(html).toContain("backtest-period-tab");
    expect(html).toContain("backtest-pnl-chart");
    expect(html).toContain("backtest-asset-select");
    expect(html).toContain('value="all"');
    expect(html).toContain("BTC");
    expect(html).toContain("ETH");
    expect(html).toContain("alea-collapsible");
    expect(html).toContain("profile-v1");
  });

  it("renders profile collapsed by default (no open attribute on details)", () => {
    const payload: BacktestDashboardPayload = {
      generatedAtMs: Date.UTC(2026, 4, 12, 12),
      trainingProfileId: "profile-v1",
      supportedPeriods: ["5m"],
      assets: ["btc"],
      stakeUsd: 20,
      summary: {
        activeCandidateCount: 1,
        activeFilterCount: 1,
        expectedRunCount: 1,
        runCount: 1,
        missingRunCount: 0,
        ignoredInactiveRunCount: 0,
        nBarsMax: 100,
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
      topCandidatesByAsset: [],
      pnlSeries: [],
    };
    const html = renderBacktestHtml({
      payload,
      assets: { stylesheets: [], scripts: [] },
    });
    expect(html).not.toMatch(/<details[^>]*\bopen\b[^>]*backtest-profile/);
  });
});

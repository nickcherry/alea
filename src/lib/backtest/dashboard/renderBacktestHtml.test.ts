import { renderBacktestHtml } from "@alea/lib/backtest/dashboard/renderBacktestHtml";
import type { BacktestDashboardPayload } from "@alea/lib/backtest/dashboard/types";
import { describe, expect, it } from "bun:test";

describe("renderBacktestHtml", () => {
  it("renders the backtest dashboard shell, period toggle, and chart", () => {
    const payload: BacktestDashboardPayload = {
      generatedAtMs: Date.UTC(2026, 4, 12, 12),
      trainingProfileId: "profile-v1",
      supportedPeriods: ["5m", "15m"],
      assets: ["btc", "eth"],
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
    expect(html).toContain("profile-v1");
  });
});

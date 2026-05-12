import { renderBacktestHtml } from "@alea/lib/backtest/dashboard/renderBacktestHtml";
import type { BacktestDashboardPayload } from "@alea/lib/backtest/dashboard/types";
import { describe, expect, it } from "bun:test";

function bucket({
  key,
  label,
}: {
  readonly key: string;
  readonly label: string;
}) {
  return {
    key,
    label,
    decisionMoments: 100,
    committeeDecisions: 40,
    scoredTrades: 30,
    wins: 18,
    losses: 12,
    ambiguousTrades: 10,
    noRegimeMoments: 1,
    emptyRosterMoments: 0,
    abstainMoments: 59,
    winRate: 0.6,
    tradeRate: 0.4,
    pnlUsd: 120,
  };
}

function payloadFixture(): BacktestDashboardPayload {
  const period = bucket({ key: "5m", label: "5m" });
  return {
    generatedAtMs: Date.UTC(2026, 4, 12, 12),
    latestRun: {
      id: "42",
      schemaVersion: 2,
      runProfile: "committee-replay-v1",
      trainingProfile: "profile-v1",
      generatedAtMs: Date.UTC(2026, 4, 12, 12),
      startedAtMs: Date.UTC(2026, 4, 12, 12),
      completedAtMs: Date.UTC(2026, 4, 12, 12, 0, 4),
      durationMs: 4000,
      windowStartMs: Date.UTC(2026, 3, 1),
      windowEndExclusiveMs: Date.UTC(2026, 4, 12),
      stakeUsd: 20,
      periods: ["5m", "15m"],
      assets: ["btc", "eth"],
      tradeDecisionConfig: {
        hydrateBars: 150,
        maxVotesPerFilter: 1,
        minVotesToTrade: 1,
        minConsensusFraction: 0.5,
      },
      roster: {
        selectedAtMs: Date.UTC(2026, 4, 12, 11),
        bucketCount: 8,
        candidateCount: 160,
      },
      totals: bucket({ key: "all", label: "All" }),
      byPeriod: [period],
      byAsset: [bucket({ key: "btc", label: "BTC" })],
      byRegime: [bucket({ key: "low_vol_ranging", label: "low_vol_ranging" })],
      byPeriodAsset: [bucket({ key: "5m|btc", label: "5m BTC" })],
      equityCurve: [
        {
          date: "2026-04-01",
          timestampMs: Date.UTC(2026, 3, 1),
          scoredTrades: 10,
          wins: 6,
          losses: 4,
          winRate: 0.6,
          pnlUsd: 40,
          cumulativePnlUsd: 40,
        },
        {
          date: "2026-04-02",
          timestampMs: Date.UTC(2026, 3, 2),
          scoredTrades: 20,
          wins: 12,
          losses: 8,
          winRate: 0.6,
          pnlUsd: 80,
          cumulativePnlUsd: 120,
        },
      ],
    },
  };
}

describe("renderBacktestHtml", () => {
  it("renders latest committee-backtest results", () => {
    const html = renderBacktestHtml({
      payload: payloadFixture(),
      assets: {
        stylesheets: ["alea.css", "backtest.css"],
        scripts: [],
      },
    });

    expect(html).toContain("Alea &middot; Backtest");
    expect(html).toContain("Latest Run");
    expect(html).toContain("Notional order size");
    expect(html).toContain("$20");
    expect(html).toContain("PnL Over Time");
    expect(html).toContain("backtest-equity-chart");
    expect(html).toContain("Committee decisions");
    expect(html).toContain("Scored trades");
    expect(html).toContain("By Period");
    expect(html).toContain("By Regime");
    expect(html).toContain("profile-v1");
  });

  it("renders an empty state when no backtest has been persisted", () => {
    const html = renderBacktestHtml({
      payload: { generatedAtMs: Date.UTC(2026, 4, 12), latestRun: null },
      assets: { stylesheets: [], scripts: [] },
    });
    expect(html).toContain("No Backtest Run");
    expect(html).toContain("bun alea backtest:run");
  });

  it("renders replay config collapsed by default", () => {
    const html = renderBacktestHtml({
      payload: payloadFixture(),
      assets: { stylesheets: [], scripts: [] },
    });
    expect(html).not.toMatch(/<details[^>]*\bopen\b[^>]*backtest-profile/);
  });
});

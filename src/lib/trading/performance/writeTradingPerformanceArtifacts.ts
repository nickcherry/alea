import { writeFile } from "node:fs/promises";

import { renderTradingPerformanceHtml } from "@alea/lib/trading/performance/renderTradingPerformanceHtml";
import type { TradingPerformancePayload } from "@alea/lib/trading/performance/types";
import { copyDashboardAssets } from "@alea/lib/ui/copyDashboardAssets";

export async function writeTradingPerformanceArtifacts({
  payload,
  htmlPath,
  jsonPath,
}: {
  readonly payload: TradingPerformancePayload;
  readonly htmlPath: string;
  readonly jsonPath: string;
}): Promise<void> {
  const assets = await copyDashboardAssets({
    htmlPath,
    pageAssets: ["trading-performance.css", "trading-performance.js"],
  });
  const html = renderTradingPerformanceHtml({ payload, assets });
  await Promise.all([
    writeFile(htmlPath, html),
    writeFile(jsonPath, JSON.stringify(payload, null, 2)),
  ]);
}

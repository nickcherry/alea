import { writeFile } from "node:fs/promises";

import { renderBacktestHtml } from "@alea/lib/backtest/dashboard/renderBacktestHtml";
import type { BacktestDashboardPayload } from "@alea/lib/backtest/dashboard/types";
import { copyDashboardAssets } from "@alea/lib/ui/copyDashboardAssets";

export async function writeBacktestArtifacts({
  payload,
  htmlPath,
  jsonPath,
}: {
  readonly payload: BacktestDashboardPayload;
  readonly htmlPath: string;
  readonly jsonPath: string;
}): Promise<void> {
  const assets = await copyDashboardAssets({
    htmlPath,
    pageAssets: ["backtest.css", "backtest.js"],
  });
  const html = renderBacktestHtml({ payload, assets });
  await Promise.all([
    writeFile(htmlPath, html),
    writeFile(jsonPath, JSON.stringify(payload)),
  ]);
}

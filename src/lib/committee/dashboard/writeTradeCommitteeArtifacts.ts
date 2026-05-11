import { writeFile } from "node:fs/promises";

import { renderTradeCommitteeHtml } from "@alea/lib/committee/dashboard/renderTradeCommitteeHtml";
import type { TradeCommitteePayload } from "@alea/lib/committee/dashboard/types";
import { copyDashboardAssets } from "@alea/lib/ui/copyDashboardAssets";

export async function writeTradeCommitteeArtifacts({
  payload,
  htmlPath,
  jsonPath,
}: {
  readonly payload: TradeCommitteePayload;
  readonly htmlPath: string;
  readonly jsonPath: string;
}): Promise<void> {
  const assets = await copyDashboardAssets({
    htmlPath,
    pageAssets: ["trade-committee.css", "trade-committee.js"],
  });
  const html = renderTradeCommitteeHtml({ payload, assets });
  await Promise.all([
    writeFile(htmlPath, html),
    writeFile(jsonPath, JSON.stringify(payload)),
  ]);
}

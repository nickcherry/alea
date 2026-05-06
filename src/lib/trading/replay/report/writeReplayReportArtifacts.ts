import { writeFile } from "node:fs/promises";

import { renderReplayReportHtml } from "@alea/lib/trading/replay/report/renderReplayReportHtml";
import type { ReplayReportPayload } from "@alea/lib/trading/replay/report/types";
import { copyDashboardAssets } from "@alea/lib/ui/copyDashboardAssets";

export async function writeReplayReportArtifacts({
  payload,
  htmlPath,
  jsonPath,
}: {
  readonly payload: ReplayReportPayload;
  readonly htmlPath: string;
  readonly jsonPath: string;
}): Promise<void> {
  const assets = await copyDashboardAssets({
    htmlPath,
    pageAssets: ["replay-report.css"],
  });
  await Promise.all([
    writeFile(
      htmlPath,
      renderReplayReportHtml({ payload, assets }),
      "utf8",
    ),
    writeFile(jsonPath, JSON.stringify(payload, null, 2), "utf8"),
  ]);
}

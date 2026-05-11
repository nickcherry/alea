import { writeFile } from "node:fs/promises";

import { renderDryRunHtml } from "@alea/lib/dryRun/dashboard/renderDryRunHtml";
import type { DryRunDashboardPayload } from "@alea/lib/dryRun/dashboard/types";
import { copyDashboardAssets } from "@alea/lib/ui/copyDashboardAssets";

export async function writeDryRunArtifacts({
  payload,
  htmlPath,
  jsonPath,
}: {
  readonly payload: DryRunDashboardPayload;
  readonly htmlPath: string;
  readonly jsonPath: string;
}): Promise<void> {
  const assets = await copyDashboardAssets({
    htmlPath,
    pageAssets: ["dry-run.css", "dry-run.js"],
  });
  const html = renderDryRunHtml({ payload, assets });
  await Promise.all([
    writeFile(htmlPath, html),
    writeFile(jsonPath, JSON.stringify(payload)),
  ]);
}

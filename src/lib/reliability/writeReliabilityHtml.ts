import { writeFile } from "node:fs/promises";

import { renderReliabilityHtml } from "@alea/lib/reliability/renderReliabilityHtml";
import type { ReliabilityCapturePayload } from "@alea/lib/reliability/types";
import { copyDashboardAssets } from "@alea/lib/ui/copyDashboardAssets";

export async function writeReliabilityHtml({
  payload,
  htmlPath,
}: {
  readonly payload: ReliabilityCapturePayload;
  readonly htmlPath: string;
}): Promise<void> {
  const assets = await copyDashboardAssets({
    htmlPath,
    pageAssets: ["reliability.css"],
  });
  await writeFile(htmlPath, renderReliabilityHtml({ payload, assets }), "utf8");
}

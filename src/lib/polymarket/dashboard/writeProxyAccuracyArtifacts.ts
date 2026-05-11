import { writeFile } from "node:fs/promises";

import { renderProxyAccuracyHtml } from "@alea/lib/polymarket/dashboard/renderProxyAccuracyHtml";
import type { ProxyAccuracyPayload } from "@alea/lib/polymarket/dashboard/types";
import { copyDashboardAssets } from "@alea/lib/ui/copyDashboardAssets";

export async function writeProxyAccuracyArtifacts({
  payload,
  htmlPath,
  jsonPath,
}: {
  readonly payload: ProxyAccuracyPayload;
  readonly htmlPath: string;
  readonly jsonPath: string;
}): Promise<void> {
  const assets = await copyDashboardAssets({
    htmlPath,
    pageAssets: ["proxy-accuracy.css", "proxy-accuracy.js"],
  });
  const html = renderProxyAccuracyHtml({ payload, assets });
  await Promise.all([
    writeFile(htmlPath, html),
    writeFile(jsonPath, JSON.stringify(payload)),
  ]);
}

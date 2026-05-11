import { writeFile } from "node:fs/promises";

import { renderPricePathsHtml } from "@alea/lib/polymarket/dashboard/renderPricePathsHtml";
import type { PricePathsPayload } from "@alea/lib/polymarket/dashboard/types";
import { copyDashboardAssets } from "@alea/lib/ui/copyDashboardAssets";

export async function writePricePathsArtifacts({
  payload,
  htmlPath,
  jsonPath,
}: {
  readonly payload: PricePathsPayload;
  readonly htmlPath: string;
  readonly jsonPath: string;
}): Promise<void> {
  const assets = await copyDashboardAssets({
    htmlPath,
    pageAssets: ["price-paths.css", "price-paths.js"],
  });
  const html = renderPricePathsHtml({ payload, assets });
  await Promise.all([
    writeFile(htmlPath, html),
    writeFile(jsonPath, JSON.stringify(payload)),
  ]);
}

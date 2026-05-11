import { writeFile } from "node:fs/promises";

import { renderExplorationHtml } from "@alea/lib/exploration/renderExplorationHtml";
import type { ExplorationPayload } from "@alea/lib/exploration/types";
import { copyDashboardAssets } from "@alea/lib/ui/copyDashboardAssets";

export async function writeExplorationArtifacts({
  payload,
  htmlPath,
  jsonPath,
}: {
  readonly payload: ExplorationPayload;
  readonly htmlPath: string;
  readonly jsonPath: string;
}): Promise<void> {
  const assets = await copyDashboardAssets({
    htmlPath,
    pageAssets: ["exploration.css", "exploration.js"],
  });
  const html = renderExplorationHtml({ payload, assets });
  await Promise.all([
    writeFile(htmlPath, html),
    // Compact JSON: the live trading page's data.json hit Cloudflare's
    // 25 MB asset cap when pretty-printed; not a risk here yet but
    // pointless to spend bytes on whitespace.
    writeFile(jsonPath, JSON.stringify(payload)),
  ]);
}

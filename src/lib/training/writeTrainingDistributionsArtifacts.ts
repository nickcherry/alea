import { writeFile } from "node:fs/promises";

import { renderTrainingDistributionsHtml } from "@alea/lib/training/renderTrainingDistributionsHtml";
import type { TrainingDistributionsPayload } from "@alea/lib/training/types";
import { copyDashboardAssets } from "@alea/lib/ui/copyDashboardAssets";

/**
 * Writes the dashboard HTML, the raw-data JSON sidecar, and a frozen-
 * in-time copy of the CSS+JS assets the HTML depends on. The sibling
 * `.assets/` folder carries `alea.css` (shared design system) plus the
 * page's own CSS+JS, so old reports keep rendering even after the
 * source assets evolve.
 *
 * The JSON carries everything (including the per-year breakdown that
 * the HTML intentionally hides) so it can be re-rendered later or
 * queried directly without re-running the analysis.
 */
export async function writeTrainingDistributionsArtifacts({
  payload,
  htmlPath,
  jsonPath,
}: {
  readonly payload: TrainingDistributionsPayload;
  readonly htmlPath: string;
  readonly jsonPath: string;
}): Promise<void> {
  const assets = await copyDashboardAssets({
    htmlPath,
    pageAssets: ["training-distributions.css", "training-distributions.js"],
  });
  const html = renderTrainingDistributionsHtml({ payload, assets });
  // Compact JSON (no pretty-printing). The dashboard HTML inlines a
  // compact copy of the same payload via the `training-payload`
  // <script>; pretty-printing the sidecar tripled-or-quadrupled the
  // file size for no functional benefit, and pushed past Cloudflare
  // Workers Assets' 25 MiB per-file cap once the cross-product
  // regime variants started landing in the registry.
  await Promise.all([
    writeFile(htmlPath, html),
    writeFile(jsonPath, JSON.stringify(payload)),
  ]);
}

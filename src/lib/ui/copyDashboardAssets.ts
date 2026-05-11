import { copyFile, mkdir } from "node:fs/promises";
import { basename, dirname, extname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Source-of-truth directory for versioned dashboard assets. Each `.css`
 * and `.js` here is checked into git and copied into the report's
 * `<page>_<ts>.assets/` folder at generation time, so reports stay
 * self-contained and old reports keep rendering even after the source
 * assets evolve.
 */
const ASSET_SOURCE_DIR = resolve(
  fileURLToPath(import.meta.url),
  "../../../assets/web",
);

/**
 * Copies the shared design-system CSS/JS plus a page's own assets into
 * a sibling `<htmlPath without extension>.assets/` folder, and returns
 * the relative hrefs the HTML should reference (in the order given).
 *
 * The shared `alea.css` is always copied first, before any page assets,
 * so its tokens and base styles cascade beneath page overrides. The
 * shared `alea-utils.js` (formatting helpers + `window.alea` namespace)
 * and `alea-info-tooltips.js` (overlay behavior) are copied before page
 * scripts so every dashboard gets the same helpers and overlay.
 *
 * @example
 *   const { stylesheets, scripts } = await copyDashboardAssets({
 *     htmlPath: "/.../tmp/web/exploration/index.html",
 *     pageAssets: ["exploration.css", "exploration.js"],
 *   });
 *   // stylesheets = ["index.assets/alea.css", "index.assets/exploration.css"]
 *   // scripts     = ["index.assets/alea-utils.js", "index.assets/alea-info-tooltips.js", "index.assets/exploration.js"]
 */
export async function copyDashboardAssets({
  htmlPath,
  pageAssets,
}: {
  /** Absolute path to the rendered HTML — used to derive the sibling assets dir. */
  readonly htmlPath: string;
  /**
   * Names of page-specific asset files (relative to `src/assets/web/`).
   * Order matters: stylesheets cascade in the order listed, after `alea.css`.
   */
  readonly pageAssets: readonly string[];
}): Promise<{
  readonly stylesheets: readonly string[];
  readonly scripts: readonly string[];
}> {
  const assetsDir = assetsDirFor(htmlPath);
  await mkdir(assetsDir, { recursive: true });

  const allAssets = [
    "alea.css",
    "alea-utils.js",
    "alea-info-tooltips.js",
    ...pageAssets,
  ];
  await Promise.all(
    allAssets.map((name) =>
      copyFile(resolve(ASSET_SOURCE_DIR, name), resolve(assetsDir, name)),
    ),
  );

  const htmlDir = dirname(htmlPath);
  const stylesheets: string[] = [];
  const scripts: string[] = [];
  for (const name of allAssets) {
    const href = relative(htmlDir, resolve(assetsDir, name));
    const ext = extname(name).toLowerCase();
    if (ext === ".css") {
      stylesheets.push(href);
    } else if (ext === ".js") {
      scripts.push(href);
    }
  }
  return { stylesheets, scripts };
}

/** Sibling directory that holds a single build's frozen-in-time assets. */
export function assetsDirFor(htmlPath: string): string {
  const ext = extname(htmlPath);
  const base = basename(htmlPath, ext);
  return resolve(dirname(htmlPath), `${base}.assets`);
}

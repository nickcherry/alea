import type { ExplorationPayload } from "@alea/lib/exploration/types";
import {
  aleaBrandMark,
  aleaDesignSystemHead,
} from "@alea/lib/ui/aleaDesignSystem";
import {
  escapeJsonForHtml,
  formatDateTime,
} from "@alea/lib/ui/aleaFormat";
import { renderTopNav } from "@alea/lib/ui/topNav";

/**
 * Renders the exploration dashboard. The chrome (header, top nav,
 * period + regime tabs, empty stack container) is the only thing
 * server-rendered; the filter cards themselves are produced
 * client-side by `exploration.js` from the embedded JSON payload.
 * Keeping all row markup in the JS path removes the locked-in-step
 * SSR/JS duplication that used to live in this file.
 *
 * Group order: average win rate across the group's configs, descending.
 * A filter idea wins by being broadly robust — a single 60% outlier
 * beside three 49% siblings shouldn't beat a family that's 55% across
 * the board.
 */

export function renderExplorationHtml({
  payload,
  assets,
}: {
  readonly payload: ExplorationPayload;
  readonly assets: {
    readonly stylesheets: readonly string[];
    readonly scripts: readonly string[];
  };
}): string {
  const subtitle = [
    `generated ${formatDateTime({ ms: payload.generatedAtMs })}`,
    `${payload.rowCount.toLocaleString()} candidates`,
  ].join('<span class="sep">&middot;</span>');

  const payloadJson = escapeJsonForHtml({ value: JSON.stringify(payload) });

  return `<!doctype html>
<html lang="en" data-theme="dark">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Alea &middot; Filter Exploration</title>
  ${aleaDesignSystemHead({ stylesheets: assets.stylesheets })}
</head>
<body>
  <div class="alea-shell">
    <header class="alea-header">
      <div class="alea-brand-row">${aleaBrandMark()}</div>
      <h1 class="alea-title">Filter Exploration</h1>
      <p class="alea-subtitle">${subtitle}</p>
    </header>
    ${renderTopNav({ activeId: "exploration" })}
    <main class="alea-main">
      <div class="exploration-filters">
        <div class="alea-pill-tabs" role="tablist" aria-label="Candle period">
          <button class="alea-pill-tab is-prominent period-tab" role="tab" data-period="5m" aria-selected="true">5m</button>
          <button class="alea-pill-tab is-prominent period-tab" role="tab" data-period="15m" aria-selected="false">15m</button>
        </div>
        <div class="alea-pill-tabs" role="tablist" aria-label="Market regime">
          <button class="alea-pill-tab regime-tab" role="tab" data-regime="all" aria-selected="true">All</button>
          <button class="alea-pill-tab regime-tab" role="tab" data-regime="low_vol_ranging" aria-selected="false">Low vol ranging</button>
          <button class="alea-pill-tab regime-tab" role="tab" data-regime="low_vol_trending" aria-selected="false">Low vol trending</button>
          <button class="alea-pill-tab regime-tab" role="tab" data-regime="high_vol_ranging" aria-selected="false">High vol ranging</button>
          <button class="alea-pill-tab regime-tab" role="tab" data-regime="high_vol_trending" aria-selected="false">High vol trending</button>
        </div>
      </div>
      <div id="filter-stack" class="filter-stack" aria-live="polite"></div>
    </main>
  </div>
  <script id="exploration-payload" type="application/json">${payloadJson}</script>
  ${assets.scripts.map((src) => `<script src="${src}"></script>`).join("\n  ")}
</body>
</html>`;
}



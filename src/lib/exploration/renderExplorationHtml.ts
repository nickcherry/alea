import type {
  ExplorationCandidateRow,
  ExplorationPayload,
  ExplorationQuarter,
} from "@alea/lib/exploration/types";
import type { FilterFamily } from "@alea/lib/filters/types";
import {
  aleaBrandMark,
  aleaDesignSystemHead,
} from "@alea/lib/ui/aleaDesignSystem";
import { renderTopNav } from "@alea/lib/ui/topNav";

/**
 * Renders the exploration dashboard. Each filter family (`rsi_meanrev`,
 * `bollinger_reversion`, etc.) gets its own card; inside, the
 * candidates are listed in WR-desc order. Cards themselves are
 * stacked top-to-bottom by group average WR.
 *
 * The card model replaced an earlier single-table layout where the
 * filter name sat in a colspan'd "section header" row inside the
 * Config column — visually it read as "filter name is a config",
 * which it isn't. Cards make the hierarchy explicit: family on top,
 * configs below.
 *
 * Group order: average win rate across the group's configs, descending.
 * A filter idea wins by being broadly robust — a single 60% outlier
 * beside three 49% siblings shouldn't beat a family that's 55% across
 * the board.
 *
 * The full payload is embedded as a `<script type="application/json">`
 * blob and the client script re-renders on period-tab clicks. No
 * fetch, no build pipeline.
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
  // SSR the 5m view so the first paint matches the default tab state.
  const ssrStack = renderFilterStack({
    rows: payload.rows.filter((r) => r.period === "5m"),
  });

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
        <div class="exploration-period-tabs" role="tablist" aria-label="Candle period">
          <button class="period-tab" role="tab" data-period="5m" aria-selected="true">5m</button>
          <button class="period-tab" role="tab" data-period="15m" aria-selected="false">15m</button>
        </div>
        <div class="exploration-regime-tabs" role="tablist" aria-label="Market regime">
          <button class="regime-tab" role="tab" data-regime="all" aria-selected="true">All</button>
          <button class="regime-tab" role="tab" data-regime="low_vol_ranging" aria-selected="false">Low vol ranging</button>
          <button class="regime-tab" role="tab" data-regime="low_vol_trending" aria-selected="false">Low vol trending</button>
          <button class="regime-tab" role="tab" data-regime="high_vol_ranging" aria-selected="false">High vol ranging</button>
          <button class="regime-tab" role="tab" data-regime="high_vol_trending" aria-selected="false">High vol trending</button>
        </div>
      </div>
      <div id="filter-stack" class="filter-stack">${ssrStack}</div>
    </main>
  </div>
  <script id="exploration-payload" type="application/json">${payloadJson}</script>
  ${assets.scripts.map((src) => `<script src="${src}"></script>`).join("\n  ")}
</body>
</html>`;
}

/**
 * Single flat stack of filter cards sorted by group avg WR. Each
 * filter's family is shown as a small tag in its card header (still
 * structured data for future committee tooling), but the dashboard
 * doesn't break the stack into loud family sections.
 */
function renderFilterStack({
  rows,
}: {
  readonly rows: readonly ExplorationCandidateRow[];
}): string {
  const groups = groupRowsByFilter({ rows });
  return groups.map((g) => renderFilterCard({ group: g })).join("");
}

function familyLabel({ family }: { readonly family: FilterFamily }): string {
  switch (family) {
    case "band_reversion":
      return "band reversion";
    case "oscillator_reversion":
      return "oscillator reversion";
    case "velocity_fade":
      return "velocity fade";
    case "ma_position":
      return "ma position";
    case "pattern":
      return "pattern";
    case "divergence":
      return "divergence";
  }
}

type FilterGroup = {
  readonly filterId: string;
  readonly family: FilterFamily;
  readonly rows: readonly ExplorationCandidateRow[];
  readonly avgWinRate: number | null;
  readonly totalEngagements: number;
};

/**
 * Group a flat row list by `filterId`, compute per-group aggregates,
 * and sort the groups by `avgWinRate` descending. `avgWinRate` is
 * the engagement-weighted total WR across the family's configs
 * (`sumWins / sumEngagements`), not the mean of per-config WRs — the latter
 * is sensitive to small-sample configs (e.g. a config with 33 engagements
 * at 97 % WR drags the simple mean up even though the family's actual
 * performance is dominated by configs with thousands of engagements).
 *
 * Within each group, rows are sorted by individual win rate
 * descending so the best-tuned variant surfaces at the top of its
 * family.
 */
function groupRowsByFilter({
  rows,
}: {
  readonly rows: readonly ExplorationCandidateRow[];
}): readonly FilterGroup[] {
  const byFilter = new Map<string, ExplorationCandidateRow[]>();
  for (const r of rows) {
    let list = byFilter.get(r.filterId);
    if (list === undefined) {
      list = [];
      byFilter.set(r.filterId, list);
    }
    list.push(r);
  }
  const groups: FilterGroup[] = [];
  for (const [filterId, list] of byFilter.entries()) {
    const totalEngagements = list.reduce((s, r) => s + r.nEngagements, 0);
    const totalWins = list.reduce((s, r) => s + r.nWins, 0);
    const avgWinRate =
      totalEngagements === 0 ? null : totalWins / totalEngagements;
    const sorted = [...list].sort((a, b) => {
      const aRate = a.winRate ?? -1;
      const bRate = b.winRate ?? -1;
      if (bRate !== aRate) {
        return bRate - aRate;
      }
      return b.nEngagements - a.nEngagements;
    });
    const first = sorted[0]!;
    groups.push({
      filterId,
      family: first.family,
      rows: sorted,
      avgWinRate,
      totalEngagements,
    });
  }
  groups.sort((a, b) => {
    const aAvg = a.avgWinRate ?? -1;
    const bAvg = b.avgWinRate ?? -1;
    if (bAvg !== aAvg) {
      return bAvg - aAvg;
    }
    return b.totalEngagements - a.totalEngagements;
  });
  return groups;
}

function renderFilterCard({ group }: { readonly group: FilterGroup }): string {
  const avg =
    group.avgWinRate === null
      ? "—"
      : formatPercent({ value: group.avgWinRate });
  const tone = toneForWr({ value: group.avgWinRate });
  const toneClass =
    tone === "positive"
      ? " alea-num-positive"
      : tone === "negative"
        ? " alea-num-negative"
        : "";
  return `
    <section class="filter-card" data-filter-id="${escapeHtml({ value: group.filterId })}">
      <header class="filter-card-header" role="button" tabindex="0" aria-expanded="true">
        <div class="filter-card-id-row">
          <h2 class="filter-card-id">${escapeHtml({ value: group.filterId })}</h2>
          <span class="filter-card-family">${escapeHtml({ value: familyLabel({ family: group.family }) })}</span>
        </div>
        <div class="filter-card-right-group">
          <div class="filter-card-meta">
            <span class="filter-card-meta-item is-avg">
              <span class="filter-card-meta-label">avg${infoTip({ text: TIPS.familyAvg })}</span>
              <span class="filter-card-meta-value${toneClass}">${avg}</span>
            </span>
            <span class="filter-card-meta-item is-configs">
              <span class="filter-card-meta-label">configs${infoTip({ text: TIPS.familyConfigs })}</span>
              <span class="filter-card-meta-value">${group.rows.length}</span>
            </span>
            <span class="filter-card-meta-item is-engagements">
              <span class="filter-card-meta-label">engagements${infoTip({ text: TIPS.familyEngagements })}</span>
              <span class="filter-card-meta-value">${group.totalEngagements.toLocaleString()}</span>
            </span>
          </div>
          <span class="filter-card-chevron" aria-hidden="true">▸</span>
        </div>
      </header>
      <div class="filter-card-table-wrap">
        <table class="filter-card-table">
          <colgroup>
            <col style="width: 28%" />
            <col style="width: 11%" />
            <col style="width: 17%" />
            <col style="width: 11%" />
            <col style="width: 11%" />
            <col style="width: 22%" />
          </colgroup>
          <thead>
            <tr>
              <th class="config-col">Config${infoTip({ text: TIPS.config })}</th>
              <th class="num-col">Engagements${infoTip({ text: TIPS.engagements })}</th>
              <th class="wr-col">Win Rate${infoTip({ text: TIPS.winRate })}</th>
              <th class="num-col">Min Q WR${infoTip({ text: TIPS.minQwr })}</th>
              <th class="num-col">Max Q WR${infoTip({ text: TIPS.maxQwr })}</th>
              <th class="quarters-col">Quarters${infoTip({ text: TIPS.quarters })}</th>
            </tr>
          </thead>
          <tbody>
            ${group.rows.map((row) => renderSubRow({ row })).join("")}
          </tbody>
        </table>
      </div>
    </section>
  `;
}

function renderSubRow({
  row,
}: {
  readonly row: ExplorationCandidateRow;
}): string {
  const minCell =
    row.quarterWinRateMin === null
      ? '<span class="alea-muted">—</span>'
      : `<span class="alea-mono${minMaxTone({ value: row.quarterWinRateMin })}">${formatPercent({ value: row.quarterWinRateMin })}</span>`;
  const maxCell =
    row.quarterWinRateMax === null
      ? '<span class="alea-muted">—</span>'
      : `<span class="alea-mono${minMaxTone({ value: row.quarterWinRateMax })}">${formatPercent({ value: row.quarterWinRateMax })}</span>`;
  return `
    <tr>
      <td class="config-col"><span class="alea-mono config-text">${escapeHtml({ value: row.configCanon })}</span></td>
      <td class="num-col alea-mono">${row.nEngagements.toLocaleString()}</td>
      <td class="wr-col">${renderWrCell({ row })}</td>
      <td class="num-col">${minCell}</td>
      <td class="num-col">${maxCell}</td>
      <td class="quarters-col">${renderQuarterStrip({ quarters: row.quarters })}</td>
    </tr>
  `;
}

function minMaxTone({ value }: { readonly value: number }): string {
  if (value >= 0.52) {
    return " alea-num-positive";
  }
  if (value < 0.48) {
    return " alea-num-negative";
  }
  return "";
}

/**
 * Mini bar chart, one vertical bar per quarter, oldest left to
 * newest right. Bars grow UP from a 50% baseline when WR > 50%
 * (green) and DOWN when WR < 50% (red); height encodes magnitude.
 * Quarters with zero engagements render as an empty slot so timeline
 * alignment stays correct.
 *
 * Magnitude scaling: 10 percentage points of deviation = full
 * 12 px bar height. Realistic WR variation lives within ±15 pp
 * for these filters, so very few bars clip — and when one does,
 * the hover-title still carries the exact number.
 */
function renderQuarterStrip({
  quarters,
}: {
  readonly quarters: readonly ExplorationQuarter[];
}): string {
  if (quarters.length === 0) {
    return '<span class="alea-muted">—</span>';
  }
  const bars = quarters.map((q) => renderQuarterBar({ q })).join("");
  return `<div class="q-strip-wrap"><div class="q-strip" role="img" aria-label="Per-quarter win rate">${bars}</div></div>`;
}

function renderQuarterBar({ q }: { readonly q: ExplorationQuarter }): string {
  const wrLabel =
    q.winRate === null ? "—" : formatPercent({ value: q.winRate });
  const title = `${q.label}: ${wrLabel} (${q.nWins.toLocaleString()}/${q.nEngagements.toLocaleString()})`;
  const titleAttr = escapeHtml({ value: title });
  if (q.winRate === null || q.nEngagements === 0) {
    return `<span class="q-bar" title="${titleAttr}"></span>`;
  }
  // ±10pp WR deviation maps to the full 12px bar height. Floor
  // height to 1px so a meaningful-but-tiny edge (e.g. 50.6%)
  // still shows a visible mark instead of disappearing.
  const deviation = q.winRate - 0.5;
  const absDev = Math.abs(deviation);
  if (absDev < 0.005) {
    return `<span class="q-bar" title="${titleAttr}"><span class="q-bar-fill q-bar-fill-flat"></span></span>`;
  }
  const height = Math.max(1, Math.min(12, absDev * 120));
  const cls = deviation > 0 ? "q-bar-fill-pos" : "q-bar-fill-neg";
  return `<span class="q-bar" title="${titleAttr}"><span class="q-bar-fill ${cls}" style="height:${height.toFixed(1)}px"></span></span>`;
}

/**
 * Win-rate cell:
 *
 *   57.8%   ▲ 58.2  ▼ 57.5
 *   55.5 – 60.2%
 *
 * Top line: aggregate WR (carries the `%` since the rest of the cell
 * inherits its scale) and a small, muted per-direction breakdown
 * (▲ up, ▼ down) with the percent signs dropped to cut redundancy.
 * Bottom line: 95% Wilson CI — only the upper bound keeps the `%`
 * for the same reason.
 */
function renderWrCell({
  row,
}: {
  readonly row: ExplorationCandidateRow;
}): string {
  if (row.winRate === null || row.nEngagements === 0) {
    return '<span class="alea-muted">—</span>';
  }
  const wrPct = formatPercent({ value: row.winRate });
  const tone = toneForWr({ value: row.winRate });
  const toneClass =
    tone === "positive"
      ? " alea-num-positive"
      : tone === "negative"
        ? " alea-num-negative"
        : "";
  const up = formatBare({ value: row.winRateUp });
  const down = formatBare({ value: row.winRateDown });
  return `
    <div class="wr-cell">
      <span class="wr-value${toneClass}">${wrPct}</span>
      <span class="wr-dir"><span class="wr-dir-leg">▲ ${up}</span><span class="wr-dir-leg">▼ ${down}</span></span>
    </div>
  `;
}

function formatBare({ value }: { readonly value: number | null }): string {
  return value === null ? "—" : (value * 100).toFixed(1);
}

function toneForWr({
  value,
}: {
  readonly value: number | null;
}): "positive" | "negative" | "neutral" {
  if (value === null) {
    return "neutral";
  }
  // Bands are eyeballed: 52%+ is "edge", under 48% is "anti-edge",
  // and the dead zone in between is neutral so we don't put a
  // misleading green tint on a 50.4% candidate.
  if (value >= 0.52) {
    return "positive";
  }
  if (value < 0.48) {
    return "negative";
  }
  return "neutral";
}

function formatPercent({ value }: { readonly value: number }): string {
  return `${(value * 100).toFixed(1)}%`;
}

function formatDateTime({ ms }: { readonly ms: number }): string {
  if (!Number.isFinite(ms) || ms <= 0) {
    return "unknown";
  }
  return new Date(ms).toLocaleString("en-US", {
    year: "numeric",
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function escapeHtml({ value }: { readonly value: string }): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function escapeJsonForHtml({ value }: { readonly value: string }): string {
  return value.replaceAll("<", "\\u003c");
}

/**
 * Plain-English column / metric explanations. Surfaced via the
 * `.alea-info-tip` ⓘ icon on every column header and family-card
 * meta label. Kept short — they're tooltips, not docs.
 */
const TIPS = {
  familyAvg:
    "Overall win rate for this filter family in the current scope, weighted by how often each config fired.",
  familyConfigs: "How many knob combinations were tested for this filter.",
  familyEngagements: "Total times this filter family made an UP or DOWN call.",
  config: "Exact knob values for this candidate.",
  engagements: "How many times this config made a call.",
  winRate:
    "How often this config's call matched the next bar. ▲ = UP calls, ▼ = DOWN calls.",
  minQwr:
    "Worst quarterly win rate. Helps spot edges that only worked briefly.",
  maxQwr: "Best quarterly win rate.",
  quarters:
    "Quarter-by-quarter win rate, oldest to newest. Green is above 50%, red below 50%.",
};

function infoTip({ text }: { readonly text: string }): string {
  return ` <span class="alea-info-tip" tabindex="0" data-tip="${escapeHtml({ value: text })}" aria-label="${escapeHtml({ value: text })}"></span>`;
}

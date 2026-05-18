import type {
  BacktestDashboardCandidateRow,
  BacktestDashboardPayload,
} from "@alea/lib/backtest/dashboard/types";
import {
  aleaBrandMark,
  aleaDesignSystemHead,
} from "@alea/lib/ui/aleaDesignSystem";
import {
  escapeHtml,
  escapeJsonForHtml,
  formatDateTime,
  formatPercent,
  infoTip,
  winRateToneClass,
} from "@alea/lib/ui/aleaFormat";
import { renderTopNav } from "@alea/lib/ui/topNav";

const TABLE_LIMIT = 20;

export function renderBacktestHtml({
  payload,
  assets,
}: {
  readonly payload: BacktestDashboardPayload;
  readonly assets: {
    readonly stylesheets: readonly string[];
    readonly scripts: readonly string[];
  };
}): string {
  const payloadJson = escapeJsonForHtml({ value: JSON.stringify(payload) });
  const initialPeriod = payload.defaultPeriod;
  const initialPeriodSlice =
    payload.byPeriod[initialPeriod] ??
    payload.byPeriod[payload.supportedPeriods[0] ?? "1h"]!;
  const initialAsset =
    initialPeriodSlice.byAsset[payload.defaultAsset] === undefined
      ? initialPeriodSlice.defaultAsset
      : payload.defaultAsset;
  const initialSlice =
    initialPeriodSlice.byAsset[initialAsset] ??
    Object.values(initialPeriodSlice.byAsset)[0]!;
  const initialLayoutRowCount = layoutRowCountForPeriod({
    periodSlice: initialPeriodSlice,
  });
  return `<!doctype html>
<html lang="en" data-theme="dark">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Alea &middot; Backtest</title>
  ${aleaDesignSystemHead({ stylesheets: assets.stylesheets })}
</head>
<body>
  <div class="alea-shell">
    <header class="alea-header">
      <div class="alea-brand-row">${aleaBrandMark()}</div>
      <h1 class="alea-title">Backtest</h1>
      <p class="alea-subtitle">generated ${formatDateTime({ ms: payload.generatedAtMs })}</p>
    </header>
    ${renderTopNav({ activeId: "backtest" })}
    <main class="alea-main">
      <div class="alea-page-controls">
        <div class="alea-pill-tabs" role="tablist" aria-label="Candle period">
          ${payload.supportedPeriods
            .map(
              (period) =>
                `<button class="alea-pill-tab is-prominent backtest-period-tab" role="tab" data-period="${escapeHtml({ value: period })}" aria-selected="${period === initialPeriod ? "true" : "false"}">${escapeHtml({ value: period })}</button>`,
            )
            .join("\n          ")}
        </div>
        <div class="alea-pill-tabs" role="tablist" aria-label="Asset">
          ${payload.supportedAssets
            .map(
              (asset) =>
                `<button class="alea-pill-tab backtest-asset-tab" role="tab" data-asset="${escapeHtml({ value: asset })}" aria-selected="${asset === initialAsset ? "true" : "false"}">${escapeHtml({ value: asset.toUpperCase() })}</button>`,
            )
            .join("\n          ")}
        </div>
      </div>

      <section class="backtest-section">
        <div class="alea-section-rule"><h2>Candidates</h2></div>
        <div class="alea-table-wrap">
          <table class="alea-table backtest-table">
            <thead id="backtest-head">
              ${renderTableHead({ quarters: initialSlice.quarters })}
            </thead>
            <tbody id="backtest-body">
              ${renderRows({ rows: initialSlice.rows, quarters: initialSlice.quarters, layoutRowCount: initialLayoutRowCount })}
            </tbody>
          </table>
        </div>
      </section>
    </main>
  </div>
  <script id="backtest-payload" type="application/json">${payloadJson}</script>
  ${assets.scripts.map((src) => `<script src="${src}"></script>`).join("\n  ")}
</body>
</html>`;
}

function renderTableHead({
  quarters,
}: {
  readonly quarters: readonly string[];
}): string {
  return `<tr>
    <th>Filter${infoTip({ text: "Filter name and version. Rows are sorted by overall win rate for the active asset and period." })}</th>
    <th>Config${infoTip({ text: "Exact configuration values evaluated for this candidate." })}</th>
    <th class="num-col">WR${infoTip({ text: "Wins divided by non-neutral decisions for the active asset and period." })}</th>
    <th class="num-col">Decisions${infoTip({ text: "Non-neutral historical decisions stored in the quarterly blobs." })}</th>
    ${quarters.map((quarter) => `<th class="num-col quarter-col">${escapeHtml({ value: quarter })}</th>`).join("")}
  </tr>`;
}

function renderRows({
  rows,
  quarters,
  layoutRowCount,
}: {
  readonly rows: readonly BacktestDashboardCandidateRow[];
  readonly quarters: readonly string[];
  readonly layoutRowCount: number;
}): string {
  const shown = rows.slice(0, TABLE_LIMIT);
  if (shown.length === 0) {
    return [
      `<tr><td colspan="${4 + quarters.length}"><span class="alea-muted">No backtest rows yet.</span></td></tr>`,
      renderFillerRows({
        count: Math.max(0, layoutRowCount - 1),
        colspan: 4 + quarters.length,
      }),
    ].join("");
  }
  return [
    shown
      .map((row) => {
        const wr =
          row.winRate === null
            ? '<span class="alea-muted">—</span>'
            : formatPercent({ value: row.winRate });
        const quarterByLabel = new Map(row.quarters.map((q) => [q.label, q]));
        return `<tr>
        <td>
          <div class="backtest-filter-name">${escapeHtml({ value: row.filterName })} <span class="alea-muted">v${row.filterVersion}</span></div>
        </td>
        <td class="backtest-config-cell">
          ${renderConfig({ value: row.config })}
        </td>
        <td class="num-col alea-mono${winRateToneClass({ value: row.winRate })}">${wr}</td>
        <td class="num-col alea-mono">${row.decisionCount.toLocaleString()}</td>
        ${quarters
          .map((quarter) => renderQuarterCell(quarterByLabel.get(quarter)))
          .join("")}
      </tr>`;
      })
      .join(""),
    renderFillerRows({
      count: Math.max(0, layoutRowCount - shown.length),
      colspan: 4 + quarters.length,
    }),
  ].join("");
}

function renderQuarterCell(
  cell: BacktestDashboardCandidateRow["quarters"][number] | undefined,
): string {
  if (cell === undefined || cell.winRate === null) {
    return '<td class="num-col alea-muted">—</td>';
  }
  return `<td class="num-col alea-mono${winRateToneClass({ value: cell.winRate })}">${formatPercent({ value: cell.winRate })}<span class="backtest-cell-count">${cell.decisionCount.toLocaleString()}</span></td>`;
}

function renderConfig({ value }: { readonly value: unknown }): string {
  const entries = configEntries({ value });
  if (entries.length === 0) {
    return '<div class="backtest-config"><span class="alea-muted">{}</span></div>';
  }
  return `<dl class="backtest-config">${entries
    .map(
      (entry) =>
        `<div class="backtest-config-row"><dt>${escapeHtml({ value: `${entry.key}:` })}</dt><dd>${escapeHtml({ value: entry.value })}</dd></div>`,
    )
    .join("")}</dl>`;
}

function configEntries({
  value,
  prefix,
}: {
  readonly value: unknown;
  readonly prefix?: string;
}): readonly { readonly key: string; readonly value: string }[] {
  if (value === null || typeof value !== "object") {
    return prefix === undefined
      ? []
      : [{ key: prefix, value: formatValue(value) }];
  }
  if (Array.isArray(value)) {
    return prefix === undefined
      ? []
      : [{ key: prefix, value: JSON.stringify(value) }];
  }
  const entries = Object.entries(value as Record<string, unknown>).sort(
    ([a], [b]) => a.localeCompare(b),
  );
  return entries.flatMap(([key, child]) => {
    const childKey = prefix === undefined ? key : `${prefix}.${key}`;
    if (isPlainConfigObject(child)) {
      const nested = configEntries({ value: child, prefix: childKey });
      return nested.length === 0
        ? [{ key: childKey, value: "{}" }]
        : nested;
    }
    return [{ key: childKey, value: formatValue(child) }];
  });
}

function isPlainConfigObject(value: unknown): boolean {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function formatValue(value: unknown): string {
  if (typeof value === "string") {
    return value;
  }
  if (
    typeof value === "number" ||
    typeof value === "boolean" ||
    value === null
  ) {
    return String(value);
  }
  return JSON.stringify(value);
}

function renderFillerRows({
  count,
  colspan,
}: {
  readonly count: number;
  readonly colspan: number;
}): string {
  return Array.from(
    { length: count },
    () =>
      `<tr class="backtest-filler-row" aria-hidden="true"><td colspan="${colspan}">&nbsp;</td></tr>`,
  ).join("");
}

function layoutRowCountForPeriod({
  periodSlice,
}: {
  readonly periodSlice: BacktestDashboardPayload["byPeriod"][string];
}): number {
  return Math.max(
    1,
    ...Object.values(periodSlice.byAsset).map((slice) =>
      Math.min(TABLE_LIMIT, slice.rows.length),
    ),
  );
}

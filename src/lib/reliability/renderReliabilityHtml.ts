import {
  baselineReliabilitySource,
  comparableReliabilitySourceValues,
  type DirectionalOutcome,
  type ReliabilityAssetWindow,
  type ReliabilityCapturePayload,
  type ReliabilitySource,
  type ReliabilitySourceCell,
} from "@alea/lib/reliability/types";
import {
  aleaBrandMark,
  aleaDesignSystemHead,
} from "@alea/lib/ui/aleaDesignSystem";

export function renderReliabilityHtml({
  payload,
  assets,
}: {
  readonly payload: ReliabilityCapturePayload;
  readonly assets: {
    readonly stylesheets: readonly string[];
    readonly scripts: readonly string[];
  };
}): string {
  const subtitle = [
    `${payload.assets.map((asset) => asset.toUpperCase()).join(", ")}`,
    `started ${formatDateTime({ ms: payload.startedAtMs })}`,
    payload.requestedDurationMs === 0
      ? "indefinite"
      : `${formatDuration({ ms: payload.requestedDurationMs })} requested`,
    `${payload.completedWindows.length} asset-windows`,
  ].join('<span class="sep">·</span>');

  return `<!doctype html>
<html lang="en" data-theme="dark">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Alea · Directional Agreement</title>
  ${aleaDesignSystemHead({ stylesheets: assets.stylesheets })}
</head>
<body>
  <div class="alea-shell">
    <header class="alea-header">
      <div class="alea-brand-row">${aleaBrandMark()}</div>
      <h1 class="alea-title">Directional Agreement</h1>
      <p class="alea-subtitle">${subtitle}</p>
    </header>
    <main class="alea-main">
      <section class="alea-summary-grid">
        ${renderMetric({
          label: "Comparable windows",
          value: payload.summary.sources
            .reduce((acc, item) => acc + item.comparableWindows, 0)
            .toLocaleString(),
          tip: REL_TIPS.comparableWindows,
        })}
        ${renderMetric({
          label: "Agreement rate",
          value: formatPercent({
            value: weightedAgreementRate({ payload }),
          }),
          tip: REL_TIPS.agreementRate,
        })}
        ${renderMetric({
          label: "Disagreements",
          value: payload.summary.sources
            .reduce((acc, item) => acc + item.disagreements, 0)
            .toLocaleString(),
          tip: REL_TIPS.disagreements,
        })}
      </section>

      <section class="alea-card with-corners">
        <div class="alea-section-rule"><h2>Source Agreement</h2></div>
        <div class="alea-table-wrap">
          <table class="alea-table">
            <thead>
              <tr>
                <th>Source${infoTip({ text: REL_TIPS.source })}</th>
                <th>Agreement${infoTip({ text: REL_TIPS.agreement })}</th>
                <th>Comparable${infoTip({ text: REL_TIPS.comparable })}</th>
                <th>OK${infoTip({ text: REL_TIPS.ok })}</th>
                <th>Diff${infoTip({ text: REL_TIPS.diff })}</th>
                <th>Unavailable${infoTip({ text: REL_TIPS.unavailable })}</th>
                <th>Near-zero diff${infoTip({ text: REL_TIPS.nearZeroDiff })}</th>
              </tr>
            </thead>
            <tbody>${payload.summary.sources.map(renderSourceSummaryRow).join("")}</tbody>
          </table>
        </div>
      </section>

      <section class="alea-card with-corners">
        <div class="alea-section-rule"><h2>Asset Breakdown</h2></div>
        <div class="alea-table-wrap">
          <table class="alea-table">
            <thead>
              <tr>
                <th>Asset / Source${infoTip({ text: REL_TIPS.assetSource })}</th>
                <th>Agreement${infoTip({ text: REL_TIPS.agreement })}</th>
                <th>Comparable${infoTip({ text: REL_TIPS.comparable })}</th>
                <th>OK${infoTip({ text: REL_TIPS.ok })}</th>
                <th>Diff${infoTip({ text: REL_TIPS.diff })}</th>
                <th>Unavailable${infoTip({ text: REL_TIPS.unavailable })}</th>
              </tr>
            </thead>
            <tbody>${payload.summary.byAsset.map(renderAssetSummaryRow).join("")}</tbody>
          </table>
        </div>
      </section>

      <section class="alea-card with-corners">
        <div class="alea-section-rule"><h2>Source Health</h2></div>
        <div class="alea-table-wrap">
          <table class="alea-table">
            <thead>
              <tr>
                <th>Source${infoTip({ text: REL_TIPS.healthSource })}</th>
                <th>Status${infoTip({ text: REL_TIPS.status })}</th>
                <th>Ticks${infoTip({ text: REL_TIPS.ticks })}</th>
                <th>Connects${infoTip({ text: REL_TIPS.connects })}</th>
                <th>Disconnects${infoTip({ text: REL_TIPS.disconnects })}</th>
                <th>Errors${infoTip({ text: REL_TIPS.errors })}</th>
                <th>Last Tick${infoTip({ text: REL_TIPS.lastTick })}</th>
              </tr>
            </thead>
            <tbody>${payload.sourceHealth.map(renderHealthRow).join("")}</tbody>
          </table>
        </div>
      </section>

      <section class="alea-card with-corners">
        <div class="alea-section-rule"><h2>Window Ledger</h2></div>
        <div class="alea-table-wrap">
          <table class="alea-table">
            <thead>
              <tr>
                <th>Window${infoTip({ text: REL_TIPS.window })}</th>
                <th>Asset${infoTip({ text: REL_TIPS.asset })}</th>
                <th>Polymarket${infoTip({ text: REL_TIPS.polymarket })}</th>
                <th>Coinbase spot${infoTip({ text: REL_TIPS.coinbaseSpot })}</th>
                <th>Coinbase perp${infoTip({ text: REL_TIPS.coinbasePerp })}</th>
                <th>Binance spot${infoTip({ text: REL_TIPS.binanceSpot })}</th>
                <th>Binance perp${infoTip({ text: REL_TIPS.binancePerp })}</th>
              </tr>
            </thead>
            <tbody>${payload.completedWindows
              .map((window) =>
                renderLedgerRow({
                  window,
                  nearZeroThresholdBp: payload.nearZeroThresholdBp,
                }),
              )
              .join("")}</tbody>
          </table>
        </div>
      </section>
    </main>
  </div>
  ${assets.scripts.map((src) => `<script src="${src}"></script>`).join("\n  ")}
</body>
</html>`;
}

function renderMetric({
  label,
  value,
  tip,
}: {
  readonly label: string;
  readonly value: string;
  readonly tip?: string;
}): string {
  return `<div class="alea-metric"><p class="alea-metric-label">${escapeHtml(label)}${tip === undefined ? "" : infoTip({ text: tip })}</p><p class="alea-metric-value">${escapeHtml(value)}</p></div>`;
}

function renderSourceSummaryRow(
  item: ReliabilityCapturePayload["summary"]["sources"][number],
): string {
  return `<tr>
    <th>${sourceLabel({ source: item.source })}</th>
    <td>${renderAgreementBar({ rate: item.agreementRate })}</td>
    <td>${item.comparableWindows.toLocaleString()}</td>
    <td>${item.agreements.toLocaleString()}</td>
    <td>${item.disagreements.toLocaleString()}</td>
    <td>${item.unavailable.toLocaleString()}</td>
    <td>${item.nearZeroDisagreements.toLocaleString()} / ${item.nearZeroComparable.toLocaleString()}</td>
  </tr>`;
}

function renderAssetSummaryRow(
  item: ReliabilityCapturePayload["summary"]["byAsset"][number],
): string {
  return `<tr>
    <th>${escapeHtml(item.asset.toUpperCase())} ${sourceLabel({ source: item.source })}</th>
    <td>${renderAgreementBar({ rate: item.agreementRate })}</td>
    <td>${item.comparableWindows.toLocaleString()}</td>
    <td>${item.agreements.toLocaleString()}</td>
    <td>${item.disagreements.toLocaleString()}</td>
    <td>${item.unavailable.toLocaleString()}</td>
  </tr>`;
}

function renderHealthRow(
  item: ReliabilityCapturePayload["sourceHealth"][number],
): string {
  return `<tr>
    <th>${sourceLabel({ source: item.source })}</th>
    <td>${item.connected ? '<span class="alea-badge ok">open</span>' : '<span class="alea-badge miss">closed</span>'}</td>
    <td>${item.ticks.toLocaleString()}</td>
    <td>${item.connectCount.toLocaleString()}</td>
    <td>${item.disconnectCount.toLocaleString()}</td>
    <td>${item.errorCount.toLocaleString()}</td>
    <td>${item.lastTickAtMs === null ? "—" : formatTime({ ms: item.lastTickAtMs })}</td>
  </tr>`;
}

function renderLedgerRow({
  window,
  nearZeroThresholdBp,
}: {
  readonly window: ReliabilityAssetWindow;
  readonly nearZeroThresholdBp: number;
}): string {
  const hasDiff = comparableReliabilitySourceValues.some(
    (source) => window.sources[source].agreesWithPolymarket === false,
  );
  const baseline = window.sources[baselineReliabilitySource];
  const nearZero =
    baseline.deltaBp !== null &&
    Math.abs(baseline.deltaBp) <= nearZeroThresholdBp &&
    baseline.status === "complete";
  return `<tr class="ledger-row${hasDiff ? " diff" : ""}${nearZero ? " near-zero" : ""}">
    <th><span class="alea-mono">${formatTime({ ms: window.windowStartMs })}</span></th>
    <td>${escapeHtml(window.asset.toUpperCase())}</td>
    <td>${renderBaselineCell({
      cell: baseline,
      nearZero,
      nearZeroThresholdBp,
    })}</td>
    ${comparableReliabilitySourceValues
      .map(
        (source) =>
          `<td>${renderComparableCell({ cell: window.sources[source] })}</td>`,
      )
      .join("")}
  </tr>`;
}

function renderBaselineCell({
  cell,
  nearZero,
  nearZeroThresholdBp,
}: {
  readonly cell: ReliabilitySourceCell;
  readonly nearZero: boolean;
  readonly nearZeroThresholdBp: number;
}): string {
  if (cell.status !== "complete") {
    return `<span class="alea-badge miss ledger-status" title="${escapeHtml(cell.status)}">${escapeHtml(statusLabel({ status: cell.status }))}</span>`;
  }
  return `<div class="ledger-price-cell baseline"><span class="ledger-outcome">${renderOutcome({ outcome: cell.outcome })}</span><span class="alea-mono ledger-delta">${formatDelta({ cell })}</span>${nearZero ? `<span class="near-zero-chip" title="Polymarket Chainlink moved no more than ${nearZeroThresholdBp} bp">near 0</span>` : ""}</div>`;
}

function renderComparableCell({
  cell,
}: {
  readonly cell: ReliabilitySourceCell;
}): string {
  const badge =
    cell.agreesWithPolymarket === true
      ? '<span class="alea-badge ok ledger-status">OK</span>'
      : cell.agreesWithPolymarket === false
        ? '<span class="alea-badge diff ledger-status">DIFF</span>'
        : `<span class="alea-badge miss ledger-status" title="${escapeHtml(cell.status)}">${escapeHtml(statusLabel({ status: cell.status }))}</span>`;
  return `<div class="ledger-price-cell">${badge}<span class="ledger-outcome">${renderOutcome({ outcome: cell.outcome })}</span><span class="alea-mono ledger-delta">${formatDelta({ cell })}</span></div>`;
}

function statusLabel({
  status,
}: {
  readonly status: ReliabilitySourceCell["status"];
}): string {
  switch (status) {
    case "complete":
      return "OK";
    case "missing-start":
    case "missing-end":
      return "MISS";
    case "stale-start":
    case "stale-end":
      return "STALE";
    case "no-market":
      return "NOMKT";
    case "pending":
      return "PEND";
  }
}

function renderAgreementBar({
  rate,
}: {
  readonly rate: number | null;
}): string {
  const pct = rate === null ? 0 : Math.max(0, Math.min(100, rate * 100));
  return `<div class="alea-bar-track"><div class="alea-bar-fill" style="width:${pct.toFixed(2)}%"></div></div><span class="alea-mono">${formatPercent({ value: rate })}</span>`;
}

function weightedAgreementRate({
  payload,
}: {
  readonly payload: ReliabilityCapturePayload;
}): number | null {
  const comparable = payload.summary.sources.reduce(
    (acc, item) => acc + item.comparableWindows,
    0,
  );
  if (comparable === 0) {
    return null;
  }
  const agreements = payload.summary.sources.reduce(
    (acc, item) => acc + item.agreements,
    0,
  );
  return agreements / comparable;
}

function sourceLabel({
  source,
}: {
  readonly source: ReliabilitySource;
}): string {
  return `<span class="source-name"><span class="source-dot" style="background:${sourceColor({ source })}"></span>${escapeHtml(source)}</span>`;
}

function sourceColor({
  source,
}: {
  readonly source: ReliabilitySource;
}): string {
  switch (source) {
    case "polymarket-chainlink":
      return "#ff5470";
    case "coinbase-spot":
      return "#2a8bff";
    case "coinbase-perp":
      return "#5fa8ff";
    case "binance-spot":
      return "#f0b90b";
    case "binance-perp":
      return "#d99d2c";
  }
}

function renderOutcome({
  outcome,
}: {
  readonly outcome: DirectionalOutcome | null;
}): string {
  if (outcome === null) {
    return "—";
  }
  return outcome === "up" ? "UP" : "DOWN";
}

function formatDelta({
  cell,
}: {
  readonly cell: ReliabilitySourceCell;
}): string {
  if (cell.deltaBp === null) {
    return "";
  }
  const sign = cell.deltaBp >= 0 ? "+" : "";
  return `${sign}${cell.deltaBp.toFixed(2)} bp`;
}

function formatPercent({ value }: { readonly value: number | null }): string {
  if (value === null) {
    return "—";
  }
  return `${(value * 100).toFixed(1)}%`;
}

function formatTime({ ms }: { readonly ms: number }): string {
  return new Date(ms).toISOString().slice(11, 16);
}

function formatDateTime({ ms }: { readonly ms: number }): string {
  return new Date(ms).toISOString().replace("T", " ").slice(0, 19);
}

function formatDuration({ ms }: { readonly ms: number }): string {
  const minutes = Math.round(ms / 60_000);
  if (minutes >= 60 && minutes % 60 === 0) {
    return `${minutes / 60}h`;
  }
  return `${minutes}m`;
}

const REL_TIPS = {
  comparableWindows:
    "Windows where Polymarket and at least one other source both had enough data to compare.",
  agreementRate:
    "Share of comparable windows where another source matched Polymarket's direction.",
  disagreements:
    "Comparable windows where another source moved the opposite way from Polymarket.",
  source: "Feed or exchange being checked against Polymarket Chainlink.",
  agreement:
    "Percent of comparable windows that matched Polymarket's direction.",
  comparable: "Windows where both sources had enough data to compare.",
  ok: "Comparable windows that matched Polymarket's direction.",
  diff: "Comparable windows that disagreed with Polymarket.",
  unavailable: "Windows missing enough data from this source.",
  nearZeroDiff:
    "Disagreements where Polymarket barely moved, so the call is less meaningful.",
  assetSource: "Asset plus feed being summarized.",
  healthSource: "Feed connection being monitored.",
  status: "Whether the WebSocket is currently open.",
  ticks: "Price updates received during the capture.",
  connects: "Successful WebSocket connects.",
  disconnects: "WebSocket closes or reconnects.",
  errors: "Errors seen from this feed.",
  lastTick: "Most recent price update time.",
  window: "Start time of the 1h market window.",
  asset: "Crypto asset for the window.",
  polymarket: "Polymarket Chainlink direction and move. This is the baseline.",
  coinbaseSpot: "Coinbase spot direction and move, compared with Polymarket.",
  coinbasePerp:
    "Coinbase perpetual direction and move, compared with Polymarket.",
  binanceSpot: "Binance spot direction and move, compared with Polymarket.",
  binancePerp:
    "Binance perpetual direction and move, compared with Polymarket.",
};

function infoTip({ text }: { readonly text: string }): string {
  return ` <span class="alea-info-tip" tabindex="0" data-tip="${escapeHtml(
    text,
  )}" aria-label="${escapeHtml(text)}"></span>`;
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

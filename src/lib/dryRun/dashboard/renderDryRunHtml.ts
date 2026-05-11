import type {
  DryRunDashboardPayload,
  DryRunDashboardRecentRow,
} from "@alea/lib/dryRun/dashboard/types";
import {
  aleaBrandMark,
  aleaDesignSystemHead,
} from "@alea/lib/ui/aleaDesignSystem";
import { renderTopNav } from "@alea/lib/ui/topNav";

function formatMarketRegime(value: string | null): string {
  if (value === null) return "—";
  return value.replaceAll("_", " ");
}

const RECENT_TABLE_LIMIT = 50;

export function renderDryRunHtml({
  payload,
  assets,
}: {
  readonly payload: DryRunDashboardPayload;
  readonly assets: {
    readonly stylesheets: readonly string[];
    readonly scripts: readonly string[];
  };
}): string {
  const summary = payload.summary;
  const wr =
    summary.winRate === null ? "—" : `${(summary.winRate * 100).toFixed(1)}%`;
  const subtitle = `generated ${formatDateTime({ ms: payload.generatedAtMs })}`;
  const tone = toneClass(summary.winRate);
  const wrToneClass =
    tone === "positive"
      ? " alea-num-positive"
      : tone === "negative"
        ? " alea-num-negative"
        : "";
  const recentRows = payload.recent.slice(0, RECENT_TABLE_LIMIT);
  const payloadJson = escapeJsonForHtml({ value: JSON.stringify(payload) });

  return `<!doctype html>
<html lang="en" data-theme="dark">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Alea &middot; Dry Run</title>
  ${aleaDesignSystemHead({ stylesheets: assets.stylesheets })}
</head>
<body>
  <div class="alea-shell">
    <header class="alea-header">
      <div class="alea-brand-row">${aleaBrandMark()}</div>
      <h1 class="alea-title">Dry Run</h1>
      <p class="alea-subtitle">${subtitle}</p>
    </header>
    ${renderTopNav({ activeId: "dryrun" })}
    <main class="alea-main">
      <section class="alea-summary-grid cols-4">
        ${renderMetric({
          label: "Win Rate",
          value: wr,
          sub: `${summary.totalWins.toLocaleString()} of ${summary.settledDecisions.toLocaleString()} settled`,
          toneClass: wrToneClass,
          tip: DR_TIPS.winRate,
        })}
        ${renderMetric({
          label: "Decisions",
          value: summary.totalDecisions.toLocaleString(),
          sub: `${summary.pendingDecisions.toLocaleString()} pending settlement`,
          tip: DR_TIPS.decisions,
        })}
        ${renderMetric({
          label: "Committee Candidates",
          value: summary.candidateCount.toLocaleString(),
          sub: "registered (filter, config) entries",
          tip: DR_TIPS.candidates,
        })}
        ${renderMetric({
          label: "Avg Engagement / Trade",
          value:
            summary.avgEngagement === null
              ? "—"
              : summary.avgEngagement.toLocaleString(undefined, {
                  maximumFractionDigits: 1,
                }),
          sub: "candidates voting up or down per fired decision",
          tip: DR_TIPS.avgEngagement,
        })}
      </section>

      <section class="alea-card with-corners">
        <div class="alea-section-rule"><h2>Cumulative Win Rate</h2></div>
        <div class="dry-run-chart" id="dry-run-chart">
          ${
            payload.cumulative.length === 0
              ? '<div class="dry-run-empty">No settled decisions yet — the chart will populate as the dry-run loop finalizes bars.</div>'
              : renderInlineSparkline({ cumulative: payload.cumulative })
          }
        </div>
      </section>

      <section class="alea-card with-corners">
        <div class="alea-section-rule"><h2>Per Market Regime</h2></div>
        <div class="alea-table-wrap">
          <table class="alea-table dry-run-table">
            <thead>
              <tr>
                <th>Regime${infoTip({ text: DR_TIPS.regimeName })}</th>
                <th class="num-col">Calls${infoTip({ text: DR_TIPS.callsRegime })}</th>
                <th class="num-col">Win Rate${infoTip({ text: DR_TIPS.callsWr })}</th>
              </tr>
            </thead>
            <tbody>
              ${
                payload.perRegime.length === 0
                  ? `<tr><td colspan="3"><span class="alea-muted">No regime-tagged decisions yet.</span></td></tr>`
                  : payload.perRegime
                      .map((r) => {
                        const wrStr =
                          r.winRate === null
                            ? '<span class="alea-muted">—</span>'
                            : `${(r.winRate * 100).toFixed(1)}%`;
                        const wrTone = toneClass(r.winRate);
                        const cls =
                          wrTone === "positive"
                            ? " alea-num-positive"
                            : wrTone === "negative"
                              ? " alea-num-negative"
                              : "";
                        return `
                          <tr>
                            <td><span class="asset-pill">${escapeHtml({ value: formatMarketRegime(r.marketRegime) })}</span></td>
                            <td class="num-col alea-mono">${r.calls.toLocaleString()}</td>
                            <td class="num-col alea-mono${cls}">${wrStr}</td>
                          </tr>`;
                      })
                      .join("")
              }
            </tbody>
          </table>
        </div>
      </section>

      <section class="alea-card with-corners">
        <div class="alea-section-rule"><h2>Per Asset</h2></div>
        <div class="alea-table-wrap">
          <table class="alea-table dry-run-table">
            <thead>
              <tr>
                <th>Asset${infoTip({ text: DR_TIPS.recentAsset })}</th>
                <th class="num-col">Calls${infoTip({ text: DR_TIPS.callsAsset })}</th>
                <th class="num-col">Win Rate${infoTip({ text: DR_TIPS.callsWr })}</th>
              </tr>
            </thead>
            <tbody>
              ${payload.perAsset
                .map((r) => {
                  const wrStr =
                    r.winRate === null
                      ? '<span class="alea-muted">—</span>'
                      : `${(r.winRate * 100).toFixed(1)}%`;
                  const wrTone = toneClass(r.winRate);
                  const cls =
                    wrTone === "positive"
                      ? " alea-num-positive"
                      : wrTone === "negative"
                        ? " alea-num-negative"
                        : "";
                  return `
                <tr>
                  <td><span class="asset-pill">${escapeHtml({ value: r.asset })}</span></td>
                  <td class="num-col alea-mono">${r.settled.toLocaleString()}</td>
                  <td class="num-col alea-mono${cls}">${wrStr}</td>
                </tr>
              `;
                })
                .join("")}
            </tbody>
          </table>
        </div>
      </section>

      <section class="alea-card with-corners">
        <div class="alea-section-rule"><h2>Recent Decisions</h2></div>
        <p class="dry-run-recent-meta">Showing the latest ${recentRows.length} of ${payload.recent.length.toLocaleString()} decisions (most recent first).</p>
        <div class="alea-table-wrap">
          <table class="alea-table dry-run-recent-table">
            <thead>
              <tr>
                <th>Time${infoTip({ text: DR_TIPS.recentTime })}</th>
                <th>Asset${infoTip({ text: DR_TIPS.recentAsset })}</th>
                <th>Prediction${infoTip({ text: DR_TIPS.recentPrediction })}</th>
                <th>Market Regime${infoTip({ text: DR_TIPS.recentRegime })}</th>
                <th class="num-col">Synth Open${infoTip({ text: DR_TIPS.recentSynthOpen })}</th>
                <th class="num-col">Actual Close${infoTip({ text: DR_TIPS.recentActualClose })}</th>
                <th>Outcome${infoTip({ text: DR_TIPS.recentOutcome })}</th>
              </tr>
            </thead>
            <tbody>
              ${recentRows.map(renderRecentRow).join("")}
            </tbody>
          </table>
        </div>
      </section>
    </main>
  </div>
  <script id="dry-run-payload" type="application/json">${payloadJson}</script>
  ${assets.scripts.map((src) => `<script src="${src}"></script>`).join("\n  ")}
</body>
</html>`;
}

function renderRecentRow(row: DryRunDashboardRecentRow): string {
  const ts = new Date(row.tsMs).toISOString().slice(0, 16).replace("T", " ");
  const tag =
    row.prediction === "u"
      ? '<span class="alea-num-positive">UP</span>'
      : '<span class="alea-num-negative">DOWN</span>';
  const close =
    row.actualClose === null
      ? '<span class="alea-muted">pending</span>'
      : row.actualClose.toFixed(2);
  let outcome: string;
  if (row.won === null) {
    outcome = '<span class="alea-muted">—</span>';
  } else if (row.won === 1) {
    outcome = '<span class="dry-run-outcome win">WIN</span>';
  } else {
    outcome = '<span class="dry-run-outcome loss">LOSS</span>';
  }
  const regimeCell =
    row.marketRegime === null
      ? '<span class="alea-muted">—</span>'
      : `<span class="asset-pill">${escapeHtml({ value: formatMarketRegime(row.marketRegime) })}</span>`;
  return `
    <tr>
      <td class="alea-mono">${escapeHtml({ value: ts })}</td>
      <td><span class="asset-pill">${escapeHtml({ value: row.asset })}</span></td>
      <td>${tag}</td>
      <td>${regimeCell}</td>
      <td class="num-col alea-mono">${row.synthOpen.toFixed(2)}</td>
      <td class="num-col alea-mono">${close}</td>
      <td>${outcome}</td>
    </tr>
  `;
}

/**
 * Tiny inline SVG sparkline of the cumulative win-rate series.
 * Self-contained — no chart library, no uPlot. Renders a polyline
 * normalised to the data's range with a horizontal 50 % reference.
 */
function renderInlineSparkline({
  cumulative,
}: {
  readonly cumulative: ReadonlyArray<{ readonly tsMs: number; readonly cumWinRate: number; readonly settled: number }>;
}): string {
  if (cumulative.length === 0) return "";
  const w = 800;
  const h = 200;
  const padX = 16;
  const padY = 14;
  const xs = cumulative.map((d) => d.tsMs);
  const ys = cumulative.map((d) => d.cumWinRate);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(0.35, ...ys);
  const maxY = Math.max(0.65, ...ys);
  const xOf = (x: number): number =>
    padX + ((x - minX) / Math.max(1, maxX - minX)) * (w - padX * 2);
  const yOf = (y: number): number =>
    h - padY - ((y - minY) / Math.max(0.01, maxY - minY)) * (h - padY * 2);
  const pts = cumulative.map((d) => `${xOf(d.tsMs).toFixed(1)},${yOf(d.cumWinRate).toFixed(1)}`).join(" ");
  const baselineY = yOf(0.5).toFixed(1);
  const lastWr = ys[ys.length - 1]!;
  const lastTone =
    lastWr >= 0.52
      ? "var(--alea-green)"
      : lastWr < 0.48
        ? "var(--alea-red)"
        : "var(--alea-gold)";
  return `
    <svg viewBox="0 0 ${w} ${h}" xmlns="http://www.w3.org/2000/svg" class="dry-run-svg">
      <line x1="${padX}" x2="${w - padX}" y1="${baselineY}" y2="${baselineY}" stroke="rgba(215,170,69,0.35)" stroke-dasharray="3 3" />
      <polyline fill="none" stroke="${lastTone}" stroke-width="1.5" points="${pts}" />
      <text x="${w - padX}" y="${padY + 4}" fill="${lastTone}" font-family="ui-monospace" font-size="11" text-anchor="end">
        ${(lastWr * 100).toFixed(1)}% (n=${cumulative.length})
      </text>
    </svg>
  `;
}

function renderMetric({
  label,
  value,
  sub,
  toneClass = "",
  tip = "",
}: {
  readonly label: string;
  readonly value: string;
  readonly sub: string;
  readonly toneClass?: string;
  readonly tip?: string;
}): string {
  return `
    <div class="alea-metric">
      <p class="alea-metric-label">${escapeHtml({ value: label })}${tip === "" ? "" : infoTip({ text: tip })}</p>
      <p class="alea-metric-value${toneClass}">${escapeHtml({ value })}</p>
      <p class="alea-metric-sub">${escapeHtml({ value: sub })}</p>
    </div>
  `;
}

/**
 * Plain-English tooltips for the dry-run dashboard. Surface every
 * table column header and metric label so a non-author landing on
 * the page can read what each number means without spelunking the
 * code.
 */
const DR_TIPS = {
  winRate:
    "Of the bars whose outcome we know, how often the committee's UP/DOWN call matched the actual move. Higher = the bot is winning more than losing.",
  decisions:
    "Total committee decisions made since the dry-run loop started (settled + still pending). Pending = the target bar hasn't closed yet.",
  candidates:
    "How many (filter, config) entries are registered in the committee. Each one independently votes UP, DOWN, or abstain on every bar.",
  avgEngagement:
    "Across decisions where the committee fired, the average number of candidates that didn't abstain (i.e. actually voted UP or DOWN). Higher = broader agreement.",
  regimeName:
    "Classified market state at decision time: vol level (low/high) × directionality (trending/ranging).",
  callsRegime:
    "Settled committee decisions made while the market was in this regime.",
  callsAsset:
    "Settled committee decisions on this crypto.",
  callsWr:
    "Win rate of the settled committee decisions in this row.",
  recentTime:
    "Time the bar opened (the bar the committee was predicting). UTC.",
  recentAsset:
    "Which crypto the committee was predicting.",
  recentPrediction:
    "Direction the committee predicted for the next 5-minute bar.",
  recentRegime:
    "Market regime classified at the moment the committee decided.",
  recentSynthOpen:
    "Pyth spot price snapshotted ~5 s before the boundary. Used as the bar's synthetic open in the absence of real market data.",
  recentActualClose:
    "Actual closing price of the bar once it finished.",
  recentOutcome:
    "WIN if the committee's prediction matched the bar's actual direction; LOSS otherwise. Ties (open = close) settle UP.",
};

function infoTip({ text }: { readonly text: string }): string {
  return ` <span class="alea-info-tip" tabindex="0" data-tip="${escapeHtml({ value: text })}" aria-label="${escapeHtml({ value: text })}"></span>`;
}

function toneClass(
  wr: number | null,
): "positive" | "negative" | "neutral" {
  if (wr === null) return "neutral";
  if (wr >= 0.52) return "positive";
  if (wr < 0.48) return "negative";
  return "neutral";
}

function formatDateTime({ ms }: { readonly ms: number }): string {
  if (!Number.isFinite(ms) || ms <= 0) return "unknown";
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

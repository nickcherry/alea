/* eslint-disable */
/*
 * Client-side logic for the Polymarket Trading Performance report.
 * Reads the trade payload from <script id="performance-payload">,
 * the chart tokens from <script id="performance-tokens">. Renders
 * the cumulative-PnL line chart with a hover tooltip.
 */
(function () {
  const payloadEl = document.getElementById("performance-payload");
  const tokensEl = document.getElementById("performance-tokens");
  if (!payloadEl || !tokensEl) {
    console.error("trading-performance: missing payload or tokens script tag");
    return;
  }
  const payload = JSON.parse(payloadEl.textContent);
  const tokens = JSON.parse(tokensEl.textContent);

  const host = document.getElementById("pnl-chart");
  const empty = document.getElementById("pnl-empty");
  const tooltip = document.getElementById("pnl-tooltip");
  let plot = null;

  function formatUsd(value) {
    const sign = value > 0 ? "+" : value < 0 ? "-" : "";
    return sign + "$" + Math.abs(value).toLocaleString(undefined, {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });
  }

  function buildSeries() {
    const points = payload.chart;
    if (points.length === 0) {
      return null;
    }
    const xs = points.map((point) => point.settledAtMs / 1000);
    const ys = points.map((point) => point.cumulativePnlUsd);
    if (points.length === 1) {
      xs.unshift(xs[0] - 1);
      ys.unshift(0);
    }
    return { points, xs, ys };
  }

  function renderChart() {
    const series = buildSeries();
    if (plot !== null) {
      plot.destroy();
      plot = null;
    }
    host.innerHTML = "";
    if (series === null) {
      empty.style.display = "flex";
      return;
    }
    empty.style.display = "none";
    const width = Math.max(320, Math.floor(host.getBoundingClientRect().width));
    const height = Math.max(260, Math.floor(host.getBoundingClientRect().height));
    plot = new uPlot(
      {
        width,
        height,
        cursor: { drag: { x: true, y: false } },
        scales: { x: { time: true } },
        series: [
          {},
          {
            label: "Cumulative PnL",
            stroke: "#d7aa45",
            width: 3,
            value: (_self, raw) => raw == null ? "--" : formatUsd(raw),
          },
        ],
        axes: [
          {
            stroke: tokens.axisStroke,
            grid: { stroke: tokens.gridStroke, width: 1 },
            ticks: { stroke: tokens.axisTickStroke, width: 1 },
            font: tokens.axisFont,
          },
          {
            stroke: tokens.axisStroke,
            grid: { stroke: tokens.gridStroke, width: 1 },
            ticks: { stroke: tokens.axisTickStroke, width: 1 },
            font: tokens.axisFont,
            values: (_self, vals) => vals.map((value) => formatUsd(value)),
          },
        ],
        hooks: {
          setCursor: [
            (self) => {
              const index = self.cursor.idx;
              if (index == null) {
                tooltip.classList.remove("visible");
                return;
              }
              const syntheticOffset = series.xs.length - series.points.length;
              const point = series.points[index - syntheticOffset];
              if (!point) {
                tooltip.classList.remove("visible");
                return;
              }
              tooltip.innerHTML =
                '<div class="alea-tooltip-head">' + new Date(point.settledAtMs).toLocaleString() + '</div>' +
                '<div class="alea-tooltip-row"><span></span><span class="name">Market</span><span class="value">' + point.symbol + '</span></div>' +
                '<div class="alea-tooltip-row"><span></span><span class="name">Market PnL</span><span class="value">' + formatUsd(point.marketPnlUsd) + '</span></div>' +
                '<div class="alea-tooltip-row"><span></span><span class="name">Total PnL</span><span class="value">' + formatUsd(point.cumulativePnlUsd) + '</span></div>';
              const rect = host.getBoundingClientRect();
              tooltip.style.left = Math.min(rect.width - 230, Math.max(8, self.cursor.left + 12)) + "px";
              tooltip.style.top = Math.max(8, self.cursor.top + 12) + "px";
              tooltip.classList.add("visible");
            },
          ],
        },
      },
      [series.xs, series.ys],
      host,
    );
  }

  renderChart();
  window.addEventListener("resize", () => {
    window.clearTimeout(window.__aleaPnlResize);
    window.__aleaPnlResize = window.setTimeout(renderChart, 120);
  });
})();

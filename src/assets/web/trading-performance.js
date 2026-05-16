/* eslint-disable */
/*
 * Client-side logic for the Polymarket Trading Performance report.
 * Reads the trade payload from <script id="performance-payload">,
 * the chart tokens from <script id="performance-tokens">. Renders
 * the cumulative-realized-PnL line chart with a hover tooltip.
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

  function formatUsd(value, opts) {
    const fractionDigits = opts && opts.fractionDigits != null ? opts.fractionDigits : 2;
    const sign = value > 0 ? "+" : value < 0 ? "-" : "";
    return sign + "$" + Math.abs(value).toLocaleString(undefined, {
      minimumFractionDigits: fractionDigits,
      maximumFractionDigits: fractionDigits,
    });
  }

  function formatTradeTime(ms) {
    if (!(ms > 0)) {
      return "Open position";
    }
    return new Date(ms).toLocaleString(undefined, {
      month: "short",
      day: "numeric",
      year: "numeric",
      hour: "numeric",
      minute: "2-digit",
      timeZoneName: "short",
    });
  }

  function buildSeries() {
    const points = payload.chart;
    if (points.length === 0) {
      return null;
    }
    // Even spacing along x: ignore the settlement clock so flat
    // gaps where no markets settled don't dominate the plot. Each
    // event gets the next integer index, starting at 0 (a synthetic
    // "before any trades" zero baseline).
    const xs = [0];
    const ys = [0];
    for (let i = 0; i < points.length; i += 1) {
      xs.push(i + 1);
      ys.push(points[i].cumulativePnlUsd);
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
        // x-axis is event index, not time — uPlot's default linear
        // scale is exactly what we want here.
        series: [
          {},
          {
            label: "Cumulative Realized PnL",
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
            // Hide x-axis labels: the index has no meaning to the
            // operator; the curve's shape is the signal.
            values: () => [],
          },
          {
            stroke: tokens.axisStroke,
            grid: { stroke: tokens.gridStroke, width: 1 },
            ticks: { stroke: tokens.axisTickStroke, width: 1, size: 5 },
            font: tokens.axisFont,
            size: 72,
            values: (_self, vals) => vals.map((value) => formatUsd(value, { fractionDigits: 0 })),
          },
        ],
        hooks: {
          setCursor: [
            (self) => {
              const index = self.cursor.idx;
              // Index 0 is the synthetic baseline (no settled trade);
              // only hover-points 1..N correspond to realized events.
              if (index == null || index < 1) {
                tooltip.classList.remove("visible");
                return;
              }
              const point = series.points[index - 1];
              if (!point) {
                tooltip.classList.remove("visible");
                return;
              }
              const head = formatTradeTime(point.orderedAtMs);
              tooltip.innerHTML =
                '<div class="alea-tooltip-head">' + head + '</div>' +
                '<div class="alea-tooltip-row"><span></span><span class="name">Market</span><span class="value">' + point.symbol + ' · ' + point.title + '</span></div>' +
                '<div class="alea-tooltip-row"><span></span><span class="name">Market Realized</span><span class="value">' + formatUsd(point.marketPnlUsd) + '</span></div>' +
                '<div class="alea-tooltip-row"><span></span><span class="name">Total Realized</span><span class="value">' + formatUsd(point.cumulativePnlUsd) + '</span></div>';
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

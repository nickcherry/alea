/* eslint-disable */
/*
 * Client-side logic for the Dry Run dashboard. Reads the payload
 * from `<script id="dry-run-payload">` and the chart-color tokens
 * from `<script id="dry-run-tokens">`, then renders the cumulative
 * win-rate line chart with a hover tooltip. Replaces the inline
 * SVG sparkline this page used to ship with — same data shape, but
 * now it shares uPlot with the trading-performance dashboard.
 */
(function () {
  var payloadEl = document.getElementById("dry-run-payload");
  var tokensEl = document.getElementById("dry-run-tokens");
  if (!payloadEl || !tokensEl) {
    return;
  }
  var payload = JSON.parse(payloadEl.textContent || "{}");
  var tokens = JSON.parse(tokensEl.textContent || "{}");
  var cumulative = (payload && payload.cumulative) || [];

  var host = document.getElementById("dry-run-chart");
  var empty = document.getElementById("dry-run-chart-empty");
  var tooltip = document.getElementById("dry-run-tooltip");
  var plot = null;

  function render() {
    if (!host) return;
    if (plot !== null) {
      plot.destroy();
      plot = null;
    }
    host.innerHTML = "";

    if (cumulative.length === 0) {
      if (empty) empty.style.display = "flex";
      return;
    }
    if (empty) empty.style.display = "none";

    var xs = cumulative.map(function (d) {
      return Math.floor(d.tsMs / 1000);
    });
    var ys = cumulative.map(function (d) {
      return d.cumWinRate;
    });
    var lastWr = ys[ys.length - 1];
    var stroke =
      lastWr >= 0.52
        ? "#46c37b"
        : lastWr < 0.48
          ? "#d85a4f"
          : tokens.bodyColor || "#d7aa45";

    var rect = host.getBoundingClientRect();
    var width = Math.max(320, Math.floor(rect.width));
    var height = Math.max(220, Math.floor(rect.height || 240));

    plot = new uPlot(
      {
        width: width,
        height: height,
        cursor: { drag: { x: true, y: false } },
        series: [
          {},
          {
            label: "Cumulative WR",
            stroke: stroke,
            width: 2,
            value: function (_self, raw) {
              return raw == null ? "--" : (raw * 100).toFixed(1) + "%";
            },
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
            size: 56,
            values: function (_self, vals) {
              return vals.map(function (v) {
                return (v * 100).toFixed(0) + "%";
              });
            },
          },
        ],
        hooks: {
          setCursor: [
            function (self) {
              if (!tooltip) return;
              var idx = self.cursor.idx;
              if (idx == null || idx < 0 || idx >= cumulative.length) {
                tooltip.classList.remove("visible");
                return;
              }
              var d = cumulative[idx];
              var when = new Date(d.tsMs).toUTCString().replace("GMT", "UTC");
              tooltip.innerHTML =
                '<div class="alea-tooltip-head">' +
                window.alea.escapeHtml(when) +
                "</div>" +
                '<div class="alea-tooltip-row"><span></span><span class="name">Cum WR</span><span class="value">' +
                window.alea.formatPercent(d.cumWinRate) +
                "</span></div>" +
                '<div class="alea-tooltip-row"><span></span><span class="name">Settled</span><span class="value">' +
                Number(d.settled).toLocaleString() +
                "</span></div>" +
                '<div class="alea-tooltip-row"><span></span><span class="name">Wins</span><span class="value">' +
                Number(d.wins).toLocaleString() +
                "</span></div>";
              var hostRect = host.getBoundingClientRect();
              tooltip.style.left =
                Math.min(hostRect.width - 240, Math.max(8, self.cursor.left + 12)) +
                "px";
              tooltip.style.top =
                Math.max(8, self.cursor.top + 12) + "px";
              tooltip.classList.add("visible");
            },
          ],
        },
      },
      [xs, ys],
      host,
    );
  }

  render();
  window.addEventListener("resize", function () {
    window.clearTimeout(window.__aleaDryRunResize);
    window.__aleaDryRunResize = window.setTimeout(render, 120);
  });
})();

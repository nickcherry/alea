/* eslint-disable */
(function () {
  "use strict";

  var payloadEl = document.getElementById("backtest-payload");
  var tokensEl = document.getElementById("backtest-tokens");
  if (!payloadEl || !tokensEl) return;

  var payload = JSON.parse(payloadEl.textContent || "{}");
  var tokens = JSON.parse(tokensEl.textContent || "{}");
  var alea = window.alea || {};
  var tabs = document.querySelectorAll(".backtest-period-tab");
  var periodRows = document.querySelectorAll("[data-backtest-period]");
  var candidateEmpty = document.getElementById("backtest-candidate-empty");
  var host = document.getElementById("backtest-pnl-chart");
  var empty = document.getElementById("backtest-pnl-empty");
  var tooltip = document.getElementById("backtest-pnl-tooltip");
  var plot = null;
  var currentPeriod = initialPeriod();

  Array.prototype.forEach.call(tabs, function (tab) {
    tab.addEventListener("click", function () {
      currentPeriod = tab.dataset.period || currentPeriod;
      Array.prototype.forEach.call(tabs, function (t) {
        t.setAttribute("aria-selected", t === tab ? "true" : "false");
      });
      renderAll();
    });
  });

  renderAll();

  window.addEventListener("resize", function () {
    window.clearTimeout(window.__aleaBacktestResize);
    window.__aleaBacktestResize = window.setTimeout(renderChart, 120);
  });

  function initialPeriod() {
    var selected = "5m";
    Array.prototype.forEach.call(tabs, function (tab) {
      if (tab.getAttribute("aria-selected") === "true") {
        selected = tab.dataset.period || selected;
      }
    });
    return selected;
  }

  function renderAll() {
    renderPeriodRows();
    renderProfile();
    renderChart();
  }

  function renderPeriodRows() {
    var visibleCandidates = 0;
    Array.prototype.forEach.call(periodRows, function (row) {
      var visible = row.dataset.backtestPeriod === currentPeriod;
      row.hidden = !visible;
      if (visible && row.closest("#backtest-candidate-body")) {
        visibleCandidates += 1;
      }
    });
    if (candidateEmpty) {
      candidateEmpty.hidden = visibleCandidates > 0;
    }
  }

  function renderProfile() {
    var row = periodSummary();
    setText("backtest-profile-period", currentPeriod);
    setText(
      "backtest-profile-coverage",
      row ? formatCoverage(row.runCount, row.expectedRunCount) : "0 / 0",
    );
    setText(
      "backtest-profile-win-rate",
      row && row.winRate !== null ? alea.formatPercent(row.winRate) : "—",
    );
    setText(
      "backtest-profile-engagements",
      Number(row ? row.nEngagements : 0).toLocaleString(),
    );
    setText(
      "backtest-profile-latest",
      row && row.computedAtMaxMs !== null
        ? new Date(row.computedAtMaxMs).toLocaleString()
        : "—",
    );
    setText(
      "backtest-profile-candle-range",
      row
        ? formatDate(row.rangeFirstMs) + " to " + formatDate(row.rangeLastMs)
        : "— to —",
    );
  }

  function renderChart() {
    if (!host || !empty || typeof uPlot === "undefined") return;
    if (plot !== null) {
      plot.destroy();
      plot = null;
    }
    host.innerHTML = "";

    var points = (payload.pnlSeries || []).filter(function (point) {
      return point.period === currentPeriod;
    });
    if (points.length === 0) {
      empty.style.display = "flex";
      return;
    }
    empty.style.display = "none";

    var xs = points.map(function (point) {
      return point.tsMs / 1000;
    });
    var ys = points.map(function (point) {
      return point.cumulativePnlUnits;
    });
    plot = new uPlot(
      {
        width: Math.max(320, Math.floor(host.getBoundingClientRect().width)),
        height: Math.max(260, Math.floor(host.getBoundingClientRect().height)),
        cursor: { drag: { x: true, y: false } },
        series: [
          {},
          {
            label: "Cumulative PnL",
            stroke: "#d7aa45",
            width: 3,
            value: function (_self, raw) {
              return raw == null ? "--" : formatUnits(raw);
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
            ticks: { stroke: tokens.axisTickStroke, width: 1, size: 5 },
            font: tokens.axisFont,
            size: 74,
            values: function (_self, vals) {
              return vals.map(formatUnits);
            },
          },
        ],
        hooks: {
          setCursor: [
            function (self) {
              var index = self.cursor.idx;
              if (index == null || !points[index] || !tooltip) {
                hideTooltip();
                return;
              }
              var point = points[index];
              tooltip.innerHTML =
                '<div class="alea-tooltip-head">' +
                new Date(point.tsMs).toISOString().slice(0, 10) +
                "</div>" +
                '<div class="alea-tooltip-row"><span></span><span class="name">PnL</span><span class="value">' +
                formatUnits(point.cumulativePnlUnits) +
                "</span></div>" +
                '<div class="alea-tooltip-row"><span></span><span class="name">Wins / Losses</span><span class="value">' +
                Number(point.nWins).toLocaleString() +
                " / " +
                Number(point.nLosses).toLocaleString() +
                "</span></div>";
              tooltip.style.left =
                Math.min(
                  host.getBoundingClientRect().width - 230,
                  Math.max(8, self.cursor.left + 12),
                ) + "px";
              tooltip.style.top = Math.max(8, self.cursor.top + 12) + "px";
              tooltip.classList.add("visible");
            },
          ],
        },
      },
      [xs, ys],
      host,
    );
  }

  function hideTooltip() {
    if (tooltip) tooltip.classList.remove("visible");
  }

  function periodSummary() {
    var rows = payload.byPeriod || [];
    for (var i = 0; i < rows.length; i += 1) {
      if (rows[i].period === currentPeriod) return rows[i];
    }
    return null;
  }

  function setText(id, value) {
    var el = document.getElementById(id);
    if (el) el.textContent = value;
  }

  function formatCoverage(runCount, expectedRunCount) {
    if (Number(expectedRunCount) === 0) return "0 / 0";
    return (
      Number(runCount).toLocaleString() +
      " / " +
      Number(expectedRunCount).toLocaleString()
    );
  }

  function formatDate(ms) {
    return ms === null || ms === undefined
      ? "—"
      : new Date(ms).toISOString().slice(0, 10);
  }

  function formatUnits(value) {
    if (value === 0) return "0";
    return (value > 0 ? "+" : "") + Number(value).toLocaleString();
  }
})();

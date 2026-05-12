/* eslint-disable */
(function () {
  "use strict";

  var payloadEl = document.getElementById("backtest-payload");
  var tokensEl = document.getElementById("backtest-tokens");
  if (!payloadEl || !tokensEl) return;

  var payload = JSON.parse(payloadEl.textContent || "{}");
  var tokens = JSON.parse(tokensEl.textContent || "{}");
  var alea = window.alea || {};
  var stakeUsd = Number(payload.stakeUsd || 20);
  var activeCandidateCount = Number(
    (payload.summary && payload.summary.activeCandidateCount) || 1,
  );

  var periodTabs = document.querySelectorAll(".backtest-period-tab");
  var periodRows = document.querySelectorAll("[data-backtest-period]");
  var assetSelect = document.getElementById("backtest-asset-select");
  var candidateEmpty = document.getElementById("backtest-candidate-empty");
  var candidateBody = document.getElementById("backtest-candidate-body");
  var host = document.getElementById("backtest-pnl-chart");
  var empty = document.getElementById("backtest-pnl-empty");
  var tooltip = document.getElementById("backtest-pnl-tooltip");
  var stakeBadge = document.getElementById("backtest-stake-usd");
  if (stakeBadge) stakeBadge.textContent = formatStake(stakeUsd);

  var plot = null;
  var currentPeriod = initialPeriod();
  var currentAsset = initialAsset();

  Array.prototype.forEach.call(periodTabs, function (tab) {
    tab.addEventListener("click", function () {
      currentPeriod = tab.dataset.period || currentPeriod;
      Array.prototype.forEach.call(periodTabs, function (t) {
        t.setAttribute("aria-selected", t === tab ? "true" : "false");
      });
      renderAll();
    });
  });

  if (assetSelect) {
    assetSelect.addEventListener("change", function () {
      currentAsset = assetSelect.value || "all";
      renderAll();
    });
  }

  renderAll();

  window.addEventListener("resize", function () {
    window.clearTimeout(window.__aleaBacktestResize);
    window.__aleaBacktestResize = window.setTimeout(renderChart, 120);
  });

  function initialPeriod() {
    var selected = "5m";
    Array.prototype.forEach.call(periodTabs, function (tab) {
      if (tab.getAttribute("aria-selected") === "true") {
        selected = tab.dataset.period || selected;
      }
    });
    return selected;
  }

  function initialAsset() {
    if (assetSelect) return assetSelect.value || "all";
    return "all";
  }

  function renderAll() {
    renderPeriodRows();
    renderAssetRows();
    renderCandidates();
    renderProfile();
    renderActivity();
    renderSectionContext();
    renderChart();
  }

  function renderPeriodRows() {
    Array.prototype.forEach.call(periodRows, function (row) {
      if (row.id === "backtest-candidate-empty") return;
      if (row.closest && row.closest("#backtest-candidate-body")) return;
      var visible = row.dataset.backtestPeriod === currentPeriod;
      row.hidden = !visible;
    });
  }

  function renderAssetRows() {
    var assetRows = document.querySelectorAll("[data-backtest-asset]");
    Array.prototype.forEach.call(assetRows, function (row) {
      var periodOk = row.dataset.backtestPeriod === currentPeriod;
      var assetOk =
        currentAsset === "all" || row.dataset.backtestAsset === currentAsset;
      row.hidden = !(periodOk && assetOk);
    });
  }

  function renderCandidates() {
    if (!candidateBody) return;
    var source =
      currentAsset === "all"
        ? payload.topCandidates || []
        : (payload.topCandidatesByAsset || []).filter(function (row) {
            return row.asset === currentAsset;
          });
    var matched = source.filter(function (row) {
      return row.period === currentPeriod;
    });
    candidateBody.innerHTML = matched.length
      ? matched.map(renderCandidateRow).join("")
      : '<tr><td colspan="9"><span class="alea-muted">No active-profile backtest rows for this view.</span></td></tr>';
    if (candidateEmpty) candidateEmpty.hidden = true;
  }

  function renderCandidateRow(row) {
    var family = row.filterFamily === null || row.filterFamily === undefined
      ? "unknown"
      : familyLabel(row.filterFamily);
    return (
      '<tr data-backtest-period="' +
      escapeHtml(row.period) +
      '">' +
      '<th><span class="backtest-filter-id">' +
      escapeHtml(row.filterId) +
      '</span><span class="backtest-filter-version">v' +
      Number(row.filterVersion).toLocaleString() +
      "</span></th>" +
      "<td>" +
      escapeHtml(row.period) +
      "</td>" +
      "<td>" +
      escapeHtml(family) +
      "</td>" +
      "<td>" +
      Number(row.assetCount).toLocaleString() +
      "</td>" +
      "<td>" +
      Number(row.nEngagements).toLocaleString() +
      "</td>" +
      '<td class="' +
      wrCellClass(row.winRate) +
      '">' +
      formatPercent(row.winRate) +
      "</td>" +
      '<td class="' +
      wrCellClass(row.upWinRate) +
      '">' +
      formatPercent(row.upWinRate) +
      "</td>" +
      '<td class="' +
      wrCellClass(row.downWinRate) +
      '">' +
      formatPercent(row.downWinRate) +
      "</td>" +
      '<td class="backtest-config">' +
      escapeHtml(row.configCanon) +
      "</td>" +
      "</tr>"
    );
  }

  function renderProfile() {
    var stats = profileStats();
    setText("backtest-profile-period", currentPeriod);
    setText("backtest-profile-asset", assetLabel(currentAsset));
    setText(
      "backtest-profile-coverage",
      formatCoverage(stats.runCount, stats.expectedRunCount),
    );
    setText("backtest-profile-win-rate", formatPercent(stats.winRate));
    setText(
      "backtest-profile-engagements",
      Number(stats.nEngagements).toLocaleString(),
    );
    setText(
      "backtest-profile-latest",
      stats.computedAtMaxMs !== null
        ? new Date(stats.computedAtMaxMs).toLocaleString()
        : "—",
    );
    setText(
      "backtest-profile-candle-range",
      formatDate(stats.rangeFirstMs) + " to " + formatDate(stats.rangeLastMs),
    );
  }

  function renderSectionContext() {
    var label = assetLabel(currentAsset).toLowerCase();
    setText("backtest-pnl-context", "/ " + label);
    setText("backtest-profile-context", "/ " + label);
    setText("backtest-candidates-context", "/ " + label);
    setText("backtest-activity-context", "/ " + label);
  }

  function renderActivity() {
    var stats = profileStats();
    var trades = Number(stats.nEngagements || 0);
    var bars = Number(stats.nBarsMax || 0);
    var runs = Number(stats.runCount || 0);
    var possible = bars * runs;
    var tradeRate = possible === 0 ? null : trades / possible;
    setText("backtest-activity-trades", trades.toLocaleString());
    setText(
      "backtest-activity-possible",
      possible > 0 ? possible.toLocaleString() : "—",
    );
    setText("backtest-activity-trade-rate", formatPercent(tradeRate));
    setText("backtest-activity-win-rate", formatPercent(stats.winRate));
    var wrCell = document.getElementById("backtest-activity-win-rate");
    if (wrCell) {
      wrCell.className =
        wrCellClass(stats.winRate) + " backtest-activity-num";
    }
  }

  function profileStats() {
    if (currentAsset === "all") {
      var periodRow = (payload.byPeriod || []).find(function (row) {
        return row.period === currentPeriod;
      });
      if (periodRow) return periodRow;
      return emptyStats();
    }
    var assetRow = (payload.byAsset || []).find(function (row) {
      return row.period === currentPeriod && row.asset === currentAsset;
    });
    if (!assetRow) return emptyStats();
    return {
      runCount: assetRow.runCount,
      expectedRunCount: assetRow.expectedRunCount,
      nEngagements: assetRow.nEngagements,
      nBarsMax: assetRow.nBarsMax,
      nWins: assetRow.nWins,
      winRate: assetRow.winRate,
      computedAtMaxMs: assetRow.computedAtMaxMs,
      rangeFirstMs: null,
      rangeLastMs: null,
    };
  }

  function emptyStats() {
    return {
      runCount: 0,
      expectedRunCount: 0,
      nEngagements: 0,
      nBarsMax: 0,
      nWins: 0,
      winRate: null,
      computedAtMaxMs: null,
      rangeFirstMs: null,
      rangeLastMs: null,
    };
  }

  function renderChart() {
    if (!host || !empty || typeof uPlot === "undefined") return;
    if (plot !== null) {
      plot.destroy();
      plot = null;
    }
    host.innerHTML = "";

    var dailyMap = new Map();
    (payload.pnlSeries || []).forEach(function (point) {
      if (point.period !== currentPeriod) return;
      if (currentAsset !== "all" && point.asset !== currentAsset) return;
      var existing = dailyMap.get(point.tsMs);
      if (existing) {
        existing.nWins += point.nWins;
        existing.nLosses += point.nLosses;
        existing.nEngagements += point.nEngagements;
      } else {
        dailyMap.set(point.tsMs, {
          tsMs: point.tsMs,
          nWins: point.nWins,
          nLosses: point.nLosses,
          nEngagements: point.nEngagements,
        });
      }
    });

    var points = Array.from(dailyMap.values()).sort(function (a, b) {
      return a.tsMs - b.tsMs;
    });
    if (points.length === 0) {
      empty.style.display = "flex";
      return;
    }
    empty.style.display = "none";

    var dollarPerUnit = stakeUsd / Math.max(activeCandidateCount, 1);
    var cumulative = 0;
    points.forEach(function (point) {
      cumulative += (point.nWins - point.nLosses) * dollarPerUnit;
      point.cumulativePnlUsd = cumulative;
    });

    var xs = points.map(function (point) {
      return point.tsMs / 1000;
    });
    var ys = points.map(function (point) {
      return point.cumulativePnlUsd;
    });
    plot = new uPlot(
      {
        width: Math.max(320, Math.floor(host.getBoundingClientRect().width)),
        height: Math.max(260, Math.floor(host.getBoundingClientRect().height)),
        cursor: { drag: { x: true, y: false } },
        series: [
          {},
          {
            label: "Cumulative PnL ($)",
            stroke: "#d7aa45",
            width: 3,
            value: function (_self, raw) {
              return raw == null ? "--" : formatUsd(raw);
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
              return vals.map(formatUsd);
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
                formatUsd(point.cumulativePnlUsd) +
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

  function formatPercent(value) {
    if (value === null || value === undefined) return "—";
    if (alea.formatPercent) return alea.formatPercent(value);
    return (value * 100).toFixed(1) + "%";
  }

  function formatUsd(value) {
    if (value === null || value === undefined) return "—";
    var sign = value < 0 ? "-" : value > 0 ? "+" : "";
    var abs = Math.abs(value);
    var formatted;
    if (abs >= 1000) {
      formatted = "$" + Math.round(abs).toLocaleString();
    } else if (abs >= 10) {
      formatted = "$" + abs.toFixed(0);
    } else {
      formatted = "$" + abs.toFixed(2);
    }
    return sign + formatted;
  }

  function formatStake(value) {
    var n = Number(value);
    if (!isFinite(n)) return "20";
    return n.toLocaleString();
  }

  function assetLabel(asset) {
    if (asset === "all") return "All assets";
    return String(asset).toUpperCase();
  }

  function familyLabel(family) {
    if (!family) return "unknown";
    return String(family).replace(/_/g, " ");
  }

  function wrCellClass(value) {
    var base = "alea-mono";
    if (value === null || value === undefined) return base;
    if (value >= 0.55) return base + " alea-tone-pos";
    if (value < 0.5) return base + " alea-tone-neg";
    return base;
  }

  function escapeHtml(value) {
    return String(value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }
})();

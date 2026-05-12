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
  var candidateEmpty = document.getElementById("backtest-candidate-empty");
  var candidateBody = document.getElementById("backtest-candidate-body");
  var host = document.getElementById("backtest-pnl-chart");
  var empty = document.getElementById("backtest-pnl-empty");
  var tooltip = document.getElementById("backtest-pnl-tooltip");
  var stakeBadge = document.getElementById("backtest-stake-usd");
  if (stakeBadge) stakeBadge.textContent = formatStake(stakeUsd);

  var plot = null;
  var currentPeriod = initialPeriod();

  Array.prototype.forEach.call(periodTabs, function (tab) {
    tab.addEventListener("click", function () {
      currentPeriod = tab.dataset.period || currentPeriod;
      Array.prototype.forEach.call(periodTabs, function (t) {
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
    Array.prototype.forEach.call(periodTabs, function (tab) {
      if (tab.getAttribute("aria-selected") === "true") {
        selected = tab.dataset.period || selected;
      }
    });
    return selected;
  }

  function renderAll() {
    renderPeriodRows();
    renderCandidates();
    renderProfile();
    renderActivity();
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

  function renderCandidates() {
    if (!candidateBody) return;
    var matched = (payload.topCandidates || []).filter(function (row) {
      return row.period === currentPeriod;
    });
    candidateBody.innerHTML = matched.length
      ? matched.map(renderCandidateRow).join("")
      : '<tr><td colspan="8"><span class="alea-muted">No active-profile backtest rows for this period.</span></td></tr>';
    if (candidateEmpty) candidateEmpty.hidden = true;
  }

  function renderCandidateRow(row) {
    var family =
      row.filterFamily === null || row.filterFamily === undefined
        ? "unknown"
        : familyLabel(row.filterFamily);
    var nBars = Number(row.nBars || 0);
    var nEngagements = Number(row.nEngagements || 0);
    var tradeRate = nBars === 0 ? null : nEngagements / nBars;
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
      escapeHtml(family) +
      "</td>" +
      "<td>" +
      nEngagements.toLocaleString() +
      "</td>" +
      '<td class="alea-mono">' +
      formatPercent(tradeRate) +
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
    var row = periodStats();
    setText("backtest-profile-period", currentPeriod);
    setText(
      "backtest-profile-win-rate",
      formatPercent(row ? row.winRate : null),
    );
    setText(
      "backtest-profile-engagements",
      Number(row ? row.nEngagements : 0).toLocaleString(),
    );
    setText(
      "backtest-profile-latest",
      row && row.computedAtMaxMs !== null && row.computedAtMaxMs !== undefined
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

  function renderActivity() {
    var allRow = periodStats();
    updateActivityRow("all", {
      nEngagements: allRow ? allRow.nEngagements : 0,
      nBars: allRow ? allRow.nBars : 0,
      winRate: allRow ? allRow.winRate : null,
    });
    (payload.assets || []).forEach(function (asset) {
      var row = (payload.byAsset || []).find(function (r) {
        return r.period === currentPeriod && r.asset === asset;
      });
      updateActivityRow(asset, {
        nEngagements: row ? row.nEngagements : 0,
        nBars: row ? row.nBars : 0,
        winRate: row ? row.winRate : null,
      });
    });
  }

  function updateActivityRow(key, stats) {
    var tr = document.querySelector(
      '[data-backtest-activity-row="' + cssEscape(key) + '"]',
    );
    if (!tr) return;
    var trades = Number(stats.nEngagements || 0);
    var possible = Number(stats.nBars || 0);
    var tradeRate = possible === 0 ? null : trades / possible;
    setCellText(tr, "trades", trades.toLocaleString());
    setCellText(tr, "possible", possible > 0 ? possible.toLocaleString() : "—");
    setCellText(tr, "trade-rate", formatPercent(tradeRate));
    setCellText(tr, "win-rate", formatPercent(stats.winRate));
    var wrCell = tr.querySelector('[data-cell="win-rate"]');
    if (wrCell) {
      wrCell.className =
        wrCellClass(stats.winRate) + " backtest-activity-num";
    }
  }

  function setCellText(tr, cellKey, value) {
    var cell = tr.querySelector('[data-cell="' + cellKey + '"]');
    if (cell) cell.textContent = value;
  }

  function periodStats() {
    var rows = payload.byPeriod || [];
    for (var i = 0; i < rows.length; i += 1) {
      if (rows[i].period === currentPeriod) return rows[i];
    }
    return null;
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

  function cssEscape(value) {
    if (window.CSS && CSS.escape) return CSS.escape(value);
    return String(value).replace(/["\\]/g, "\\$&");
  }
})();

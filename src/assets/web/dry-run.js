/* eslint-disable */
/*
 * Client-side logic for the Dry Run dashboard. Reads the payload
 * from `<script id="dry-run-payload">` and the chart-color tokens
 * from `<script id="dry-run-tokens">`. Owns three pieces of state:
 *
 *   1. The page-level 5m/15m period toggle. Switching periods swaps
 *      the summary metrics, the per-regime + per-asset tables, the
 *      "Recent Decisions" feed, and the uPlot chart series — every
 *      number on the page comes from `payload.byPeriod[currentPeriod]`
 *      so the page is internally consistent for the active period.
 *   2. The cumulative win-rate uPlot chart, re-instantiated on period
 *      switch and window resize.
 *   3. The hover tooltip that decorates the chart.
 *
 * The SSR pass renders the page already scoped to `decisionConfig.period`,
 * so first paint is the same code path the client takes on hydration.
 */
(function () {
  var payloadEl = document.getElementById("dry-run-payload");
  var tokensEl = document.getElementById("dry-run-tokens");
  if (!payloadEl || !tokensEl) {
    return;
  }
  var payload = JSON.parse(payloadEl.textContent || "{}");
  var tokens = JSON.parse(tokensEl.textContent || "{}");
  var byPeriod = (payload && payload.byPeriod) || {};
  var recentAll = (payload && payload.recent) || [];
  var decisionConfig = (payload && payload.decisionConfig) || {};
  var supportedPeriods = decisionConfig.supportedPeriods || ["5m"];

  var RECENT_TABLE_LIMIT = 50;

  var alea = window.alea;
  var escapeHtml = alea.escapeHtml;
  var percent = alea.formatPercent;
  var toneClass = alea.winRateToneClass;
  var formatMarketRegime = function (value) {
    if (value === null || value === undefined) return "—";
    return alea.formatMarketRegime(value);
  };

  var currentPeriod = decisionConfig.period || supportedPeriods[0] || "5m";

  var summaryGrid = document.getElementById("dry-run-summary-grid");
  var regimeBody = document.getElementById("dry-run-regime-body");
  var assetBody = document.getElementById("dry-run-asset-body");
  var recentBody = document.getElementById("dry-run-recent-body");
  var recentMeta = document.getElementById("dry-run-recent-meta");
  var host = document.getElementById("dry-run-chart");
  var empty = document.getElementById("dry-run-chart-empty");
  var tooltip = document.getElementById("dry-run-tooltip");
  var tabs = document.querySelectorAll(".dry-run-period-tab");

  var plot = null;

  Array.prototype.forEach.call(tabs, function (tab) {
    tab.addEventListener("click", function () {
      currentPeriod = tab.dataset.period;
      Array.prototype.forEach.call(tabs, function (t) {
        t.setAttribute("aria-selected", t === tab ? "true" : "false");
      });
      renderAll();
    });
  });

  renderAll();

  window.addEventListener("resize", function () {
    window.clearTimeout(window.__aleaDryRunResize);
    window.__aleaDryRunResize = window.setTimeout(renderChart, 120);
  });

  function activeSlice() {
    return (
      byPeriod[currentPeriod] || {
        summary: emptySummary(),
        perAsset: [],
        perRegime: [],
        cumulative: [],
      }
    );
  }

  function emptySummary() {
    return {
      totalDecisions: 0,
      settledDecisions: 0,
      pendingDecisions: 0,
      totalWins: 0,
      winRate: null,
      upDecisions: 0,
      downDecisions: 0,
      upWins: 0,
      downWins: 0,
      firstDecisionAtMs: null,
      lastDecisionAtMs: null,
      candidateCount: 0,
      avgEngagement: null,
    };
  }

  function renderAll() {
    var slice = activeSlice();
    renderSummary(slice.summary);
    renderRegime(slice.perRegime);
    renderAssets(slice.perAsset);
    renderRecent();
    renderChart();
  }

  function renderSummary(summary) {
    if (!summaryGrid) return;
    var wr = summary.winRate === null ? "—" : percent(summary.winRate);
    var wrCls = toneClass(summary.winRate);
    summaryGrid.innerHTML =
      metric({
        label: "Win Rate",
        value: wr,
        sub:
          summary.totalWins.toLocaleString() +
          " of " +
          summary.settledDecisions.toLocaleString() +
          " settled · " +
          summary.upDecisions.toLocaleString() +
          "↑ / " +
          summary.downDecisions.toLocaleString() +
          "↓",
        toneClass: wrCls,
      }) +
      metric({
        label: "Decisions",
        value: summary.totalDecisions.toLocaleString(),
        sub: summary.pendingDecisions.toLocaleString() + " pending settlement",
      }) +
      metric({
        label: "Committee Candidates",
        value: summary.candidateCount.toLocaleString(),
        sub: "registered (filter, config) entries",
      }) +
      metric({
        label: "Avg Engagement / Trade",
        value:
          summary.avgEngagement === null
            ? "—"
            : Number(summary.avgEngagement).toLocaleString(undefined, {
                maximumFractionDigits: 1,
              }),
        sub: "filter-collapsed votes per actionable decision",
      });
  }

  function metric(opts) {
    var tone = opts.toneClass || "";
    return (
      '<div class="alea-metric">' +
      '<p class="alea-metric-label">' +
      escapeHtml(opts.label) +
      "</p>" +
      '<p class="alea-metric-value' +
      tone +
      '">' +
      escapeHtml(String(opts.value)) +
      "</p>" +
      '<p class="alea-metric-sub">' +
      escapeHtml(opts.sub) +
      "</p>" +
      "</div>"
    );
  }

  function renderRegime(rows) {
    if (!regimeBody) return;
    if (rows.length === 0) {
      regimeBody.innerHTML =
        '<tr><td colspan="4"><span class="alea-muted">No regime-tagged decisions yet.</span></td></tr>';
      return;
    }
    regimeBody.innerHTML = rows
      .map(function (r) {
        var wrStr =
          r.winRate === null
            ? '<span class="alea-muted">—</span>'
            : percent(r.winRate);
        var cls = toneClass(r.winRate);
        return (
          "<tr>" +
          '<td><span class="asset-pill">' +
          escapeHtml(formatMarketRegime(r.marketRegime)) +
          "</span></td>" +
          '<td class="num-col alea-mono">' +
          Number(r.calls).toLocaleString() +
          "</td>" +
          '<td class="num-col alea-mono' +
          cls +
          '">' +
          wrStr +
          "</td>" +
          '<td class="num-col alea-mono">' +
          directionSplit(r.upSettled, r.downSettled) +
          "</td>" +
          "</tr>"
        );
      })
      .join("");
  }

  function renderAssets(rows) {
    if (!assetBody) return;
    if (rows.length === 0) {
      assetBody.innerHTML =
        '<tr><td colspan="4"><span class="alea-muted">No decisions yet for this period.</span></td></tr>';
      return;
    }
    assetBody.innerHTML = rows
      .map(function (r) {
        var wrStr =
          r.winRate === null
            ? '<span class="alea-muted">—</span>'
            : percent(r.winRate);
        var cls = toneClass(r.winRate);
        return (
          "<tr>" +
          '<td><span class="asset-pill">' +
          escapeHtml(r.asset) +
          "</span></td>" +
          '<td class="num-col alea-mono">' +
          Number(r.settled).toLocaleString() +
          "</td>" +
          '<td class="num-col alea-mono' +
          cls +
          '">' +
          wrStr +
          "</td>" +
          '<td class="num-col alea-mono">' +
          directionSplit(r.upSettled, r.downSettled) +
          "</td>" +
          "</tr>"
        );
      })
      .join("");
  }

  function directionSplit(up, down) {
    if (up + down === 0) {
      return '<span class="alea-muted">—</span>';
    }
    var upCls = up >= down ? "" : "alea-muted";
    var downCls = down > up ? "" : "alea-muted";
    return (
      '<span class="alea-mono"><span class="' +
      upCls +
      '">↑' +
      Number(up).toLocaleString() +
      '</span> / <span class="' +
      downCls +
      '">↓' +
      Number(down).toLocaleString() +
      "</span></span>"
    );
  }

  function renderRecent() {
    if (!recentBody) return;
    var rowsForPeriod = recentAll.filter(function (r) {
      return r.period === currentPeriod;
    });
    var rows = rowsForPeriod.slice(0, RECENT_TABLE_LIMIT);
    if (recentMeta) {
      recentMeta.textContent =
        "Showing the latest " +
        rows.length +
        " of " +
        rowsForPeriod.length.toLocaleString() +
        " decisions (most recent first).";
    }
    if (rows.length === 0) {
      recentBody.innerHTML =
        '<tr><td colspan="8"><span class="alea-muted">No decisions yet for this period.</span></td></tr>';
      return;
    }
    recentBody.innerHTML = rows.map(renderRecentRow).join("");
  }

  function renderRecentRow(row) {
    var ts = new Date(row.tsMs).toISOString().slice(0, 16).replace("T", " ");
    var tag =
      row.prediction === "u"
        ? '<span class="alea-num-positive">UP</span>'
        : '<span class="alea-num-negative">DOWN</span>';
    var close =
      row.actualClose === null
        ? '<span class="alea-muted">pending</span>'
        : Number(row.actualClose).toFixed(2);
    var outcome;
    if (row.won === null) {
      outcome = '<span class="alea-muted">—</span>';
    } else if (row.won === 1) {
      outcome = '<span class="dry-run-outcome win">WIN</span>';
    } else {
      outcome = '<span class="dry-run-outcome loss">LOSS</span>';
    }
    var regimeCell =
      row.marketRegime === null || row.marketRegime === undefined
        ? '<span class="alea-muted">—</span>'
        : '<span class="asset-pill">' +
          escapeHtml(formatMarketRegime(row.marketRegime)) +
          "</span>";
    var moveCell = renderMoveCell(row.synthOpen, row.actualClose);
    return (
      "<tr>" +
      '<td class="alea-mono">' +
      escapeHtml(ts) +
      "</td>" +
      '<td><span class="asset-pill">' +
      escapeHtml(row.asset) +
      "</span></td>" +
      "<td>" +
      tag +
      "</td>" +
      "<td>" +
      regimeCell +
      "</td>" +
      '<td class="num-col alea-mono">' +
      Number(row.synthOpen).toFixed(2) +
      "</td>" +
      '<td class="num-col alea-mono">' +
      close +
      "</td>" +
      '<td class="num-col">' +
      moveCell +
      "</td>" +
      "<td>" +
      outcome +
      "</td>" +
      "</tr>"
    );
  }

  function renderMoveCell(synthOpen, actualClose) {
    if (actualClose === null || actualClose === undefined || !synthOpen) {
      return '<span class="alea-muted">—</span>';
    }
    var pct = ((actualClose - synthOpen) / synthOpen) * 100;
    var sign = pct > 0 ? "+" : pct < 0 ? "" : "";
    var cls =
      pct > 0
        ? " alea-num-positive"
        : pct < 0
          ? " alea-num-negative"
          : " alea-muted";
    return (
      '<span class="alea-mono' + cls + '">' + sign + pct.toFixed(2) + "%</span>"
    );
  }

  function renderChart() {
    if (!host) return;
    if (plot !== null) {
      plot.destroy();
      plot = null;
    }
    host.innerHTML = "";

    var cumulative = activeSlice().cumulative || [];
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
                escapeHtml(when) +
                "</div>" +
                '<div class="alea-tooltip-row"><span></span><span class="name">Cum WR</span><span class="value">' +
                percent(d.cumWinRate) +
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
})();

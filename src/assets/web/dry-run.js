/* eslint-disable */
/*
 * Client-side logic for the Dry Run dashboard. Reads the payload
 * from `<script id="dry-run-payload">` and the chart-color tokens
 * from `<script id="dry-run-tokens">`. Owns three pieces of state:
 *
 *   1. The page-level 5m/15m period toggle. Switching periods swaps
 *      the summary metrics, the per-asset table, the
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

  var currentPeriod = decisionConfig.period || supportedPeriods[0] || "5m";

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
        perAsset: [],
        cumulative: [],
      }
    );
  }

  function renderAll() {
    var slice = activeSlice();
    renderAssets(slice.perAsset);
    renderRecent();
    renderChart();
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
        "latest " +
        rows.length.toLocaleString() +
        " of " +
        rowsForPeriod.length.toLocaleString();
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
      outcome = '<span class="alea-muted">pending</span>';
    } else if (row.won === 1) {
      outcome = '<span class="dry-run-outcome win">WIN</span>';
    } else {
      outcome = '<span class="dry-run-outcome loss">LOSS</span>';
    }
    var displayOpen =
      row.actualOpen !== null && row.actualOpen !== undefined
        ? row.actualOpen
        : row.synthOpen;
    var moveCell = renderMoveCell(displayOpen, row.actualClose);
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
      '<td class="num-col alea-mono">' +
      Number(displayOpen).toFixed(2) +
      "</td>" +
      '<td class="num-col alea-mono">' +
      close +
      "</td>" +
      '<td class="num-col">' +
      moveCell +
      "</td>" +
      "<td>" +
      renderOrderCell(row) +
      "</td>" +
      "<td>" +
      outcome +
      "</td>" +
      "</tr>"
    );
  }

  function renderOrderCell(row) {
    var status = row.orderStatus || "untracked";
    var label = formatOrderStatus(status);
    var cls = "dry-run-order";
    if (status === "filled") cls += " filled";
    else if (status === "unfilled") cls += " unfilled";
    else if (status === "placed" || status === "pending_placement")
      cls += " pending";
    else if (status.indexOf("skipped") === 0) cls += " skipped";
    else return '<span class="alea-muted">' + escapeHtml(label) + "</span>";
    return (
      '<span class="' +
      cls +
      '">' +
      escapeHtml(label.toUpperCase()) +
      "</span>" +
      renderOrderPriceBits(row)
    );
  }

  function renderOrderPriceBits(row) {
    var bits = [];
    if (row.orderLimitPrice !== null && row.orderLimitPrice !== undefined) {
      bits.push("limit " + formatCents(row.orderLimitPrice));
    }
    if (row.orderFillPrice !== null && row.orderFillPrice !== undefined) {
      bits.push("fill " + formatCents(row.orderFillPrice));
    }
    if (row.orderConfidence !== null && row.orderConfidence !== undefined) {
      bits.push("conf " + Number(row.orderConfidence).toFixed(2));
    }
    return bits.length === 0
      ? ""
      : '<span class="dry-run-order-detail">' +
          escapeHtml(bits.join(" · ")) +
          "</span>";
  }

  function formatOrderStatus(status) {
    if (status === "pending_placement") return "pending";
    if (status === "skipped_no_market") return "skip no market";
    if (status === "skipped_no_price") return "skip no price";
    if (status === "skipped_price_window") return "skip price";
    if (status === "skipped_confidence") return "skip edge";
    return String(status).replace(/_/g, " ");
  }

  function formatCents(value) {
    return (Number(value) * 100).toFixed(1) + "c";
  }

  function renderMoveCell(open, actualClose) {
    if (actualClose === null || actualClose === undefined || !open) {
      return '<span class="alea-muted">—</span>';
    }
    var pct = ((actualClose - open) / open) * 100;
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

    // Use event order on the x-axis. Live decisions often share the
    // same target candle timestamp across assets; a wall-clock axis with
    // duplicate/tiny ranges produces unreadable future-year ticks. The
    // hover tooltip still shows the actual target time.
    var xs = cumulative.map(function (_d, idx) {
      return idx + 1;
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
            space: 70,
            values: function (_self, vals) {
              return vals.map(function (v) {
                var idx = Math.round(v);
                return Math.abs(v - idx) < 0.001 && idx >= 1 ? "#" + idx : "";
              });
            },
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
                Math.min(
                  hostRect.width - 240,
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
})();

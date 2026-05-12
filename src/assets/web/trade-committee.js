/*
 * Trade Committee dashboard - client-side period/regime scoping plus
 * the firings raster heatmap that renders at the bottom. The chart
 * shows each selected candidate as a row of daily-bucketed cells over
 * the training window; cell color encodes direction (green = up,
 * red = down, gold = split) and opacity encodes count.
 */
(function () {
  "use strict";

  var payloadNode = document.getElementById("trade-committee-payload");
  if (!payloadNode) {
    return;
  }
  var payload;
  try {
    payload = JSON.parse(payloadNode.textContent || "{}");
  } catch (err) {
    return;
  }

  var rows = (payload && payload.rows) || [];
  var firings = (payload && payload.firings) || [];
  var firingsRange = (payload && payload.firingsRangeMs) || null;
  var tbody = document.getElementById("committee-rows");
  var periodTabs = document.querySelectorAll(".committee-period-tab");
  var regimeTabs = document.querySelectorAll(".committee-regime-tab");

  // Firings raster heatmap constants + DOM hooks. Declared up front so
  // the initial render() below has them in scope (var hoisting would
  // otherwise leave them undefined).
  var DAY_MS = 86400000;
  var ROW_HEIGHT = 18;
  var ROW_GAP = 2;
  var CELL_MIN_ALPHA = 0.16;
  var COLOR_UP = { r: 70, g: 195, b: 123 };
  var COLOR_DOWN = { r: 216, g: 90, b: 79 };
  var COLOR_SPLIT = { r: 215, g: 170, b: 69 };
  var BG_ROW_EVEN = "rgba(215, 170, 69, 0.03)";
  var BG_ROW_ODD = "rgba(215, 170, 69, 0.06)";

  var canvas = document.getElementById("committee-firings-canvas");
  var labelsEl = document.getElementById("committee-firings-labels");
  var axisEl = document.getElementById("committee-firings-axis");
  var emptyEl = document.getElementById("committee-firings-empty");
  var firingsTooltip = document.getElementById("committee-firings-tooltip");
  var hoverState = { cells: null, totalDays: 0, firstMs: 0 };

  if (canvas) {
    canvas.addEventListener("mousemove", onCanvasMove);
    canvas.addEventListener("mouseleave", function () {
      if (firingsTooltip) firingsTooltip.classList.remove("visible");
    });
  }

  var currentPeriod = "5m";
  var currentRegime = "low_vol_ranging";

  var alea = window.alea;
  var escapeHtml = alea.escapeHtml;
  var percent = alea.formatPercent;
  var marketRegime = function (v) {
    return alea.formatMarketRegime(v);
  };
  var toneClass = alea.winRateToneClass;
  var familyLabelFor = alea.familyLabel;

  Array.prototype.forEach.call(periodTabs, function (tab) {
    tab.addEventListener("click", function () {
      currentPeriod = tab.dataset.period;
      Array.prototype.forEach.call(periodTabs, function (t) {
        t.setAttribute("aria-selected", t === tab ? "true" : "false");
      });
      render();
    });
  });

  Array.prototype.forEach.call(regimeTabs, function (tab) {
    tab.addEventListener("click", function () {
      currentRegime = tab.dataset.regime;
      Array.prototype.forEach.call(regimeTabs, function (t) {
        t.setAttribute("aria-selected", t === tab ? "true" : "false");
      });
      render();
    });
  });

  render();

  window.addEventListener("resize", function () {
    window.clearTimeout(window.__aleaCommitteeFiringsResize);
    window.__aleaCommitteeFiringsResize = window.setTimeout(
      renderFiringsChart,
      120,
    );
  });

  function render() {
    if (tbody) {
      var visible = rows.filter(function (r) {
        return r.period === currentPeriod && r.marketRegime === currentRegime;
      });
      tbody.innerHTML = renderRows(visible);
    }
    renderFiringsChart();
  }

  function renderRows(visible) {
    if (visible.length === 0) {
      return '<tr><td colspan="8"><span class="alea-muted">No candidates in this scope.</span></td></tr>';
    }
    return visible.map(renderRow).join("");
  }

  function renderRow(row) {
    var family = row.filterFamily
      ? familyLabelFor(row.filterFamily)
      : "unregistered";
    var worst =
      row.worstQuarterWinRate === null
        ? '<span class="alea-muted">&mdash;</span>'
        : '<span class="alea-mono' +
          toneClass(row.worstQuarterWinRate) +
          '">' +
          percent(row.worstQuarterWinRate) +
          "</span>";
    return (
      "<tr>" +
      '<td class="num-col"><span class="committee-rank-pill">#' +
      Number(row.rank).toLocaleString() +
      "</span></td>" +
      '<td><span class="committee-bucket-pill">' +
      escapeHtml(marketRegime(row.marketRegime)) +
      "</span></td>" +
      "<td>" +
      '<div class="committee-filter-cell">' +
      '<span class="committee-filter-id alea-mono">' +
      escapeHtml(row.filterId) +
      "</span>" +
      '<span class="committee-filter-family">' +
      escapeHtml(family) +
      "</span>" +
      "</div>" +
      "</td>" +
      '<td><span class="alea-mono committee-config-text" title="' +
      escapeHtml(row.configCanon) +
      '">' +
      escapeHtml(row.configCanon) +
      "</span></td>" +
      '<td class="num-col alea-mono">' +
      Number(row.nEngagements).toLocaleString() +
      "</td>" +
      '<td class="num-col">' +
      renderWinRateCell(row) +
      "</td>" +
      '<td class="num-col alea-mono' +
      toneClass(row.wilsonLow) +
      '">' +
      percent(row.wilsonLow) +
      "</td>" +
      '<td class="num-col">' +
      worst +
      "</td>" +
      "</tr>"
    );
  }

  function renderWinRateCell(row) {
    return (
      '<div class="committee-wr-cell">' +
      '<span class="committee-wr-value' +
      toneClass(row.winRate) +
      '">' +
      percent(row.winRate) +
      "</span>" +
      '<span class="committee-wr-sub">' +
      Number(row.nWins).toLocaleString() +
      "/" +
      Number(row.nEngagements).toLocaleString() +
      "</span>" +
      "</div>"
    );
  }

  // ---------------------------------------------------------------
  // Firings raster heatmap
  // ---------------------------------------------------------------

  function renderFiringsChart() {
    if (!canvas || !labelsEl || !axisEl) return;
    var visibleSeries = firings
      .filter(function (s) {
        return s.period === currentPeriod && s.marketRegime === currentRegime;
      })
      .slice()
      .sort(function (a, b) {
        return a.rank - b.rank;
      });

    var hasData =
      visibleSeries.length > 0 &&
      visibleSeries.some(function (s) {
        return s.buckets && s.buckets.length > 0;
      }) &&
      firingsRange !== null;

    if (emptyEl) emptyEl.hidden = hasData;
    if (!hasData) {
      labelsEl.innerHTML = "";
      axisEl.innerHTML = "";
      var ctx0 = canvas.getContext("2d");
      if (ctx0) ctx0.clearRect(0, 0, canvas.width, canvas.height);
      return;
    }

    var firstMs =
      Math.floor(firingsRange.firstMs / DAY_MS) * DAY_MS;
    var lastMs = Math.floor(firingsRange.lastMs / DAY_MS) * DAY_MS;
    var totalDays = Math.max(1, Math.round((lastMs - firstMs) / DAY_MS) + 1);

    labelsEl.innerHTML = visibleSeries
      .map(function (s, idx) {
        var isLast = idx === visibleSeries.length - 1;
        var style =
          "height: " +
          ROW_HEIGHT +
          "px;" +
          (isLast ? "" : "margin-bottom: " + ROW_GAP + "px;");
        return (
          '<div class="committee-firings-label" style="' +
          style +
          '"><span class="rank">#' +
          Number(s.rank).toLocaleString() +
          "</span>" +
          escapeHtml(s.filterId) +
          "</div>"
        );
      })
      .join("");

    var dpr = window.devicePixelRatio || 1;
    var wrap = canvas.parentNode;
    var rect = wrap.getBoundingClientRect();
    var cssWidth = Math.max(200, Math.floor(rect.width));
    var cssHeight = visibleSeries.length * (ROW_HEIGHT + ROW_GAP) - ROW_GAP;
    if (cssHeight < ROW_HEIGHT) cssHeight = ROW_HEIGHT;
    canvas.style.width = cssWidth + "px";
    canvas.style.height = cssHeight + "px";
    canvas.width = Math.floor(cssWidth * dpr);
    canvas.height = Math.floor(cssHeight * dpr);

    var ctx = canvas.getContext("2d");
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, cssWidth, cssHeight);

    // Precompute per-row cells + the max count across the visible grid
    // (used to normalize cell opacity).
    var rowsToDraw = [];
    var maxCount = 1;
    for (var i = 0; i < visibleSeries.length; i++) {
      var series = visibleSeries[i];
      var buckets = series.buckets || [];
      var cells = [];
      for (var j = 0; j < buckets.length; j++) {
        var bk = buckets[j];
        var total = (bk.u || 0) + (bk.d || 0);
        if (total === 0) continue;
        if (total > maxCount) maxCount = total;
        cells.push({
          dayIdx: Math.round((bk.t - firstMs) / DAY_MS),
          u: bk.u || 0,
          d: bk.d || 0,
          t: bk.t,
        });
      }
      rowsToDraw.push({ series: series, cells: cells });
    }

    var pxPerDay = cssWidth / totalDays;
    // Each cell paints at least one CSS pixel wide.
    var cellPxWidth = Math.max(1, pxPerDay);

    for (var r = 0; r < rowsToDraw.length; r++) {
      var yTop = r * (ROW_HEIGHT + ROW_GAP);
      ctx.fillStyle = r % 2 === 0 ? BG_ROW_EVEN : BG_ROW_ODD;
      ctx.fillRect(0, yTop, cssWidth, ROW_HEIGHT);
      var rowCells = rowsToDraw[r].cells;
      for (var c = 0; c < rowCells.length; c++) {
        var cell = rowCells[c];
        var x = cell.dayIdx * pxPerDay;
        var color = cellColor(cell, maxCount);
        ctx.fillStyle = color;
        ctx.fillRect(x, yTop, cellPxWidth, ROW_HEIGHT);
      }
    }

    axisEl.innerHTML = renderAxisTicks(firstMs, lastMs);

    hoverState.cells = rowsToDraw;
    hoverState.totalDays = totalDays;
    hoverState.firstMs = firstMs;
    hoverState.cssWidth = cssWidth;
    hoverState.cssHeight = cssHeight;
  }

  function cellColor(cell, maxCount) {
    var total = cell.u + cell.d;
    if (total === 0) return "rgba(0,0,0,0)";
    // Net direction in [-1, 1]: +1 all up, -1 all down.
    var net = (cell.u - cell.d) / total;
    var blend;
    if (net >= 0) {
      // Blend split (gold) -> up (green) as net moves from 0 -> 1.
      blend = mixColor(COLOR_SPLIT, COLOR_UP, net);
    } else {
      // Blend split (gold) -> down (red) as net moves 0 -> -1.
      blend = mixColor(COLOR_SPLIT, COLOR_DOWN, -net);
    }
    // Log-scale the saturation: even single-fire days are visible, but
    // dense days are visually distinct.
    var t = Math.log(1 + total) / Math.log(1 + maxCount);
    var alpha = CELL_MIN_ALPHA + (1 - CELL_MIN_ALPHA) * Math.min(1, t);
    return "rgba(" + blend.r + "," + blend.g + "," + blend.b + "," + alpha.toFixed(3) + ")";
  }

  function mixColor(a, b, t) {
    return {
      r: Math.round(a.r + (b.r - a.r) * t),
      g: Math.round(a.g + (b.g - a.g) * t),
      b: Math.round(a.b + (b.b - a.b) * t),
    };
  }

  function renderAxisTicks(firstMs, lastMs) {
    // Pick ~6 evenly-spaced labels along the time axis.
    var labels = [];
    var firstYear = new Date(firstMs).getUTCFullYear();
    var lastYear = new Date(lastMs).getUTCFullYear();
    if (lastYear - firstYear <= 4) {
      // Year-quarter ticks across the range.
      for (var y = firstYear; y <= lastYear; y++) {
        labels.push({ ms: Date.UTC(y, 0, 1), label: String(y) });
      }
    } else {
      for (var yr = firstYear; yr <= lastYear; yr += 1) {
        labels.push({ ms: Date.UTC(yr, 0, 1), label: String(yr) });
      }
    }
    return labels
      .map(function (t) {
        return '<span class="tick">' + escapeHtml(t.label) + "</span>";
      })
      .join("");
  }

  function onCanvasMove(ev) {
    if (!hoverState.cells || !firingsTooltip) return;
    var rect = canvas.getBoundingClientRect();
    var x = ev.clientX - rect.left;
    var y = ev.clientY - rect.top;
    var rowIdx = Math.floor(y / (ROW_HEIGHT + ROW_GAP));
    if (rowIdx < 0 || rowIdx >= hoverState.cells.length) {
      firingsTooltip.classList.remove("visible");
      return;
    }
    var pxPerDay = hoverState.cssWidth / hoverState.totalDays;
    var dayIdx = Math.floor(x / pxPerDay);
    var row = hoverState.cells[rowIdx];
    var hit = null;
    // O(cells) per row but each row only has the days with fires.
    for (var i = 0; i < row.cells.length; i++) {
      if (row.cells[i].dayIdx === dayIdx) {
        hit = row.cells[i];
        break;
      }
    }
    if (hit === null) {
      firingsTooltip.classList.remove("visible");
      return;
    }
    var when = new Date(hit.t).toISOString().slice(0, 10);
    var total = hit.u + hit.d;
    firingsTooltip.innerHTML =
      '<div class="alea-tooltip-head">' +
      escapeHtml(row.series.filterId) +
      " &middot; rank #" +
      Number(row.series.rank).toLocaleString() +
      "</div>" +
      '<div class="alea-tooltip-row"><span></span><span class="name">Day</span><span class="value">' +
      escapeHtml(when) +
      "</span></div>" +
      '<div class="alea-tooltip-row"><span></span><span class="name">Up</span><span class="value">' +
      Number(hit.u).toLocaleString() +
      "</span></div>" +
      '<div class="alea-tooltip-row"><span></span><span class="name">Down</span><span class="value">' +
      Number(hit.d).toLocaleString() +
      "</span></div>" +
      '<div class="alea-tooltip-row"><span></span><span class="name">Total</span><span class="value">' +
      Number(total).toLocaleString() +
      "</span></div>";
    var hostRect = canvas.parentNode.getBoundingClientRect();
    var tipLeft = Math.min(hostRect.width - 220, Math.max(8, x + 12));
    var tipTop = Math.max(8, y + 12);
    firingsTooltip.style.left = tipLeft + "px";
    firingsTooltip.style.top = tipTop + "px";
    firingsTooltip.classList.add("visible");
  }

})();

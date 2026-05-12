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

  // Firings clustering chart constants + DOM hooks. Declared up front
  // so the initial render() below has them in scope (var hoisting
  // would otherwise leave them undefined).
  var WEEK_MS = 7 * 86400000;
  var CHART_HEIGHT = 220;
  var CHART_PAD_TOP = 12;
  var CHART_PAD_BOTTOM = 8;
  var COLOR_UP = "#46c37b";
  var COLOR_DOWN = "#d85a4f";
  var COLOR_AXIS = "rgba(215, 170, 69, 0.35)";
  var COLOR_AXIS_TEXT = "#b8aa8a";

  var canvas = document.getElementById("committee-firings-canvas");
  var axisEl = document.getElementById("committee-firings-axis");
  var emptyEl = document.getElementById("committee-firings-empty");
  var firingsTooltip = document.getElementById("committee-firings-tooltip");
  var hoverState = { bars: null, cssWidth: 0, cssHeight: 0 };

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
    if (!canvas || !axisEl) return;
    var visibleSeries = firings.filter(function (s) {
      return s.period === currentPeriod && s.marketRegime === currentRegime;
    });

    var hasData =
      visibleSeries.length > 0 &&
      visibleSeries.some(function (s) {
        return s.buckets && s.buckets.length > 0;
      }) &&
      firingsRange !== null;

    if (emptyEl) emptyEl.hidden = hasData;
    if (!hasData) {
      axisEl.innerHTML = "";
      var ctx0 = canvas.getContext("2d");
      if (ctx0) ctx0.clearRect(0, 0, canvas.width, canvas.height);
      return;
    }

    // Aggregate across selected candidates per weekly bucket. For each
    // (filter, bucket) we classify the filter's vote as up-dominant,
    // down-dominant, or balanced; the bar at that bucket then counts
    // distinct filters per class. Bar above 0 = filters that voted up,
    // below 0 = filters that voted down. Symmetric bars = disagreement,
    // one-sided bars = consensus.
    var firstBucket =
      Math.floor(firingsRange.firstMs / WEEK_MS) * WEEK_MS;
    var lastBucket = Math.floor(firingsRange.lastMs / WEEK_MS) * WEEK_MS;
    var nBuckets = Math.round((lastBucket - firstBucket) / WEEK_MS) + 1;

    // bars[i] = { up: { count, votes }, down: { count, votes },
    //             upFilters: [...], downFilters: [...] }
    var bars = new Array(nBuckets);
    for (var b = 0; b < nBuckets; b++) {
      bars[b] = {
        up: 0,
        down: 0,
        upFilters: [],
        downFilters: [],
        upVotes: 0,
        downVotes: 0,
      };
    }
    for (var i = 0; i < visibleSeries.length; i++) {
      var s = visibleSeries[i];
      var bucketsArr = s.buckets || [];
      for (var j = 0; j < bucketsArr.length; j++) {
        var bk = bucketsArr[j];
        var idx = Math.round((bk.t - firstBucket) / WEEK_MS);
        if (idx < 0 || idx >= nBuckets) continue;
        var bar = bars[idx];
        var u = bk.u || 0;
        var d = bk.d || 0;
        bar.upVotes += u;
        bar.downVotes += d;
        if (u > d) {
          bar.up += 1;
          bar.upFilters.push({ id: s.filterId, rank: s.rank, u: u, d: d });
        } else if (d > u) {
          bar.down += 1;
          bar.downFilters.push({ id: s.filterId, rank: s.rank, u: u, d: d });
        }
        // Ties (u === d) don't contribute to either side — rare and
        // ambiguous; we just drop them rather than picking a side.
      }
    }

    var maxStack = 1;
    for (var k = 0; k < bars.length; k++) {
      if (bars[k].up > maxStack) maxStack = bars[k].up;
      if (bars[k].down > maxStack) maxStack = bars[k].down;
    }

    var dpr = window.devicePixelRatio || 1;
    var wrap = canvas.parentNode;
    var rect = wrap.getBoundingClientRect();
    var cssWidth = Math.max(200, Math.floor(rect.width));
    var cssHeight = CHART_HEIGHT;
    canvas.style.width = cssWidth + "px";
    canvas.style.height = cssHeight + "px";
    canvas.width = Math.floor(cssWidth * dpr);
    canvas.height = Math.floor(cssHeight * dpr);

    var ctx = canvas.getContext("2d");
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, cssWidth, cssHeight);

    var midY = (cssHeight - CHART_PAD_BOTTOM + CHART_PAD_TOP) / 2;
    var half = midY - CHART_PAD_TOP;
    var pxPerBucket = cssWidth / nBuckets;
    var barPxWidth = Math.max(1, pxPerBucket - 0.5);

    // Zero baseline.
    ctx.fillStyle = COLOR_AXIS;
    ctx.fillRect(0, midY, cssWidth, 1);

    for (var bi = 0; bi < bars.length; bi++) {
      var info = bars[bi];
      var x = bi * pxPerBucket;
      if (info.up > 0) {
        var hUp = (info.up / maxStack) * half;
        ctx.fillStyle = COLOR_UP;
        ctx.fillRect(x, midY - hUp, barPxWidth, hUp);
      }
      if (info.down > 0) {
        var hDown = (info.down / maxStack) * half;
        ctx.fillStyle = COLOR_DOWN;
        ctx.fillRect(x, midY + 1, barPxWidth, hDown);
      }
    }

    // Y-axis ticks: 0, max/2, max on both sides.
    ctx.fillStyle = COLOR_AXIS_TEXT;
    ctx.font = "11px Inter, ui-sans-serif, system-ui, sans-serif";
    ctx.textBaseline = "middle";
    ctx.textAlign = "right";
    ctx.fillText(String(maxStack), cssWidth - 2, midY - half + 6);
    ctx.fillText(String(maxStack), cssWidth - 2, midY + half - 6);
    ctx.fillText("0", cssWidth - 2, midY);

    axisEl.innerHTML = renderAxisTicks(firstBucket, lastBucket);

    hoverState.bars = bars;
    hoverState.firstBucket = firstBucket;
    hoverState.pxPerBucket = pxPerBucket;
    hoverState.cssWidth = cssWidth;
    hoverState.cssHeight = cssHeight;
    hoverState.midY = midY;
    hoverState.half = half;
    hoverState.maxStack = maxStack;
  }

  function renderAxisTicks(firstMs, lastMs) {
    var labels = [];
    var firstYear = new Date(firstMs).getUTCFullYear();
    var lastYear = new Date(lastMs).getUTCFullYear();
    for (var y = firstYear; y <= lastYear; y++) {
      labels.push({ ms: Date.UTC(y, 0, 1), label: String(y) });
    }
    return labels
      .map(function (t) {
        return '<span class="tick">' + escapeHtml(t.label) + "</span>";
      })
      .join("");
  }

  function onCanvasMove(ev) {
    if (!hoverState.bars || !firingsTooltip) return;
    var rect = canvas.getBoundingClientRect();
    var x = ev.clientX - rect.left;
    var y = ev.clientY - rect.top;
    var idx = Math.floor(x / hoverState.pxPerBucket);
    if (idx < 0 || idx >= hoverState.bars.length) {
      firingsTooltip.classList.remove("visible");
      return;
    }
    var info = hoverState.bars[idx];
    if (info.up === 0 && info.down === 0) {
      firingsTooltip.classList.remove("visible");
      return;
    }
    var weekStart = new Date(hoverState.firstBucket + idx * WEEK_MS);
    var weekStr = weekStart.toISOString().slice(0, 10);
    var upList = info.upFilters
      .slice()
      .sort(function (a, b) {
        return a.rank - b.rank;
      })
      .map(function (f) {
        return "#" + f.rank + " " + f.id;
      })
      .join(", ");
    var downList = info.downFilters
      .slice()
      .sort(function (a, b) {
        return a.rank - b.rank;
      })
      .map(function (f) {
        return "#" + f.rank + " " + f.id;
      })
      .join(", ");
    firingsTooltip.innerHTML =
      '<div class="alea-tooltip-head">Week of ' +
      escapeHtml(weekStr) +
      "</div>" +
      '<div class="alea-tooltip-row"><span></span><span class="name">Up</span><span class="value">' +
      Number(info.up).toLocaleString() +
      " filters &middot; " +
      Number(info.upVotes).toLocaleString() +
      " votes</span></div>" +
      (upList === ""
        ? ""
        : '<div class="committee-firings-tooltip-list">' +
          escapeHtml(upList) +
          "</div>") +
      '<div class="alea-tooltip-row"><span></span><span class="name">Down</span><span class="value">' +
      Number(info.down).toLocaleString() +
      " filters &middot; " +
      Number(info.downVotes).toLocaleString() +
      " votes</span></div>" +
      (downList === ""
        ? ""
        : '<div class="committee-firings-tooltip-list">' +
          escapeHtml(downList) +
          "</div>");
    var hostRect = canvas.parentNode.getBoundingClientRect();
    var tipLeft = Math.min(hostRect.width - 280, Math.max(8, x + 12));
    var tipTop = Math.max(8, y + 12);
    firingsTooltip.style.left = tipLeft + "px";
    firingsTooltip.style.top = tipTop + "px";
    firingsTooltip.classList.add("visible");
  }

})();

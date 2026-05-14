/* eslint-disable */
/*
 * Price Paths dashboard. Draws the 50c calibration views from the
 * pre-aggregated payload: a canvas heatmap, band-decay SVG, a crossings
 * chart, and the crossings marker table.
 */
(function () {
  "use strict";

  var payloadEl = document.getElementById("price-paths-payload");
  if (!payloadEl) {
    return;
  }

  var payload;
  try {
    payload = JSON.parse(payloadEl.textContent || "{}");
  } catch (err) {
    return;
  }

  var alea = window.alea || {};
  var escapeHtml = alea.escapeHtml || fallbackEscapeHtml;

  var tabs = document.querySelectorAll(".price-path-period-tab");
  var assetSelect = document.getElementById("price-path-asset-select");
  var canvas = document.getElementById("price-path-heatmap");
  var tooltip = document.getElementById("price-path-tooltip");
  var empty = document.getElementById("price-path-empty");
  var bandHost = document.getElementById("price-path-band-chart");
  var bandTooltip = document.getElementById("price-path-band-tooltip");
  var crossingsChartHost = document.getElementById(
    "price-path-crossings-chart",
  );
  var crossingsTooltip = document.getElementById("price-path-crossings-tooltip");
  var driftSharesHost = document.getElementById(
    "price-path-drift-shares-chart",
  );
  var driftSharesTooltip = document.getElementById(
    "price-path-drift-shares-tooltip",
  );
  var flipShareHost = document.getElementById("price-path-flip-share-chart");
  var flipShareTooltip = document.getElementById(
    "price-path-flip-share-tooltip",
  );
  var driftEmpty = document.getElementById("price-path-drift-empty");

  var state = {
    timeframe: initialTimeframe(),
    asset: "all",
    slice: null,
    heatmapLayout: null,
    bandLayout: null,
    crossingsLayout: null,
    driftSharesLayout: null,
    flipShareLayout: null,
  };

  Array.prototype.forEach.call(tabs, function (tab) {
    tab.addEventListener("click", function () {
      state.timeframe = tab.dataset.period || state.timeframe;
      state.asset = "all";
      Array.prototype.forEach.call(tabs, function (t) {
        t.setAttribute("aria-selected", t === tab ? "true" : "false");
      });
      renderAll();
    });
  });

  if (assetSelect) {
    assetSelect.addEventListener("change", function () {
      state.asset = assetSelect.value || "all";
      renderAll();
    });
  }

  if (canvas) {
    canvas.addEventListener("mousemove", handleHeatmapMove);
    canvas.addEventListener("mouseleave", hideTooltip);
  }

  if (bandHost) {
    bandHost.addEventListener("mousemove", handleBandMove);
    bandHost.addEventListener("mouseleave", hideBandHover);
  }

  if (crossingsChartHost) {
    crossingsChartHost.addEventListener("mousemove", handleCrossingsMove);
    crossingsChartHost.addEventListener("mouseleave", hideCrossingsHover);
  }

  if (driftSharesHost) {
    driftSharesHost.addEventListener("mousemove", handleDriftSharesMove);
    driftSharesHost.addEventListener("mouseleave", hideDriftSharesHover);
  }
  if (flipShareHost) {
    flipShareHost.addEventListener("mousemove", handleFlipShareMove);
    flipShareHost.addEventListener("mouseleave", hideFlipShareHover);
  }

  window.addEventListener("resize", function () {
    window.clearTimeout(window.__aleaPricePathsResize);
    window.__aleaPricePathsResize = window.setTimeout(function () {
      renderHeatmap();
      renderBandChart();
      renderCrossingsChart();
      renderDriftSharesChart();
      renderFlipShareChart();
    }, 120);
  });

  renderAll();

  function initialTimeframe() {
    var selected = "5m";
    Array.prototype.forEach.call(tabs, function (tab) {
      if (tab.getAttribute("aria-selected") === "true") {
        selected = tab.dataset.period || selected;
      }
    });
    return selected;
  }

  function renderAll() {
    var breakdown = activeBreakdown();
    renderAssetSelect(breakdown);
    state.slice = activeSlice(breakdown);
    renderHeatmap();
    renderBandChart();
    renderCrossingsChart();
    renderDriftSharesChart();
    renderFlipShareChart();
  }

  function activeBreakdown() {
    var breakdowns = (payload && payload.breakdowns) || [];
    return (
      breakdowns.filter(function (b) {
        return b.timeframe === state.timeframe;
      })[0] ||
      breakdowns[0] ||
      null
    );
  }

  function activeSlice(breakdown) {
    if (!breakdown || !breakdown.slices || breakdown.slices.length === 0) {
      return null;
    }
    return (
      breakdown.slices.filter(function (s) {
        return (s.asset || "all") === state.asset;
      })[0] || breakdown.slices[0]
    );
  }

  function renderAssetSelect(breakdown) {
    if (!assetSelect || !breakdown) return;
    var options = (breakdown.slices || [])
      .map(function (slice) {
        var value = slice.asset || "all";
        return (
          '<option value="' +
          escapeHtml(value) +
          '"' +
          (value === state.asset ? " selected" : "") +
          ">" +
          escapeHtml(slice.label) +
          "</option>"
        );
      })
      .join("");
    assetSelect.innerHTML =
      options || '<option value="all">All assets</option>';
    if (!assetSelect.value) {
      assetSelect.value = "all";
    }
  }

  function renderHeatmap() {
    if (!canvas) return;
    var slice = state.slice;
    var ctx = canvas.getContext("2d");
    if (!ctx) return;

    var rect = canvas.getBoundingClientRect();
    var width = Math.max(320, Math.floor(rect.width || 900));
    var height = Math.max(320, Math.floor(rect.height || 430));
    var dpr = window.devicePixelRatio || 1;
    canvas.width = Math.floor(width * dpr);
    canvas.height = Math.floor(height * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, width, height);

    var pad = { left: 50, right: 18, top: 20, bottom: 38 };
    var plotW = width - pad.left - pad.right;
    var plotH = height - pad.top - pad.bottom;
    state.heatmapLayout = {
      width: width,
      height: height,
      pad: pad,
      plotW: plotW,
      plotH: plotH,
    };

    drawPanel(ctx, width, height);
    drawHeatmapAxes(ctx, slice, pad, plotW, plotH);

    if (!slice || !slice.sampleCount) {
      drawNoData(ctx, width, height);
      if (empty) empty.removeAttribute("hidden");
      return;
    }
    if (empty) empty.setAttribute("hidden", "hidden");

    var columns = (slice.heatmap && slice.heatmap.columns) || [];
    var buckets = (slice.heatmap && slice.heatmap.priceBucketsCents) || [];
    var maxShare = slice.heatmap.maxColumnShare || 1;
    var cellW = plotW / Math.max(1, columns.length);
    var cellH = plotH / Math.max(1, buckets.length);

    for (var c = 0; c < columns.length; c += 1) {
      var column = columns[c];
      if (!column || !column.sampleCount) continue;
      for (var price = 0; price <= 100; price += 1) {
        var count = Number(column.counts[price] || 0);
        if (count === 0) continue;
        var share = count / column.sampleCount;
        var intensity = Math.sqrt(Math.min(1, share / maxShare));
        ctx.fillStyle = heatColor(intensity);
        ctx.fillRect(
          pad.left + c * cellW,
          pad.top + (100 - price) * cellH,
          Math.ceil(cellW) + 0.5,
          Math.ceil(cellH) + 0.5,
        );
      }
    }

    drawFiftyLine(ctx, pad, plotW, plotH);
    drawHeatmapAxes(ctx, slice, pad, plotW, plotH);
  }

  function drawPanel(ctx, width, height) {
    ctx.fillStyle = "#08100c";
    ctx.fillRect(0, 0, width, height);
  }

  function drawNoData(ctx, width, height) {
    ctx.fillStyle = "#b8aa8a";
    ctx.font = "13px Inter, ui-sans-serif, system-ui, sans-serif";
    ctx.textAlign = "center";
    ctx.fillText("No price samples yet", width / 2, height / 2);
  }

  function drawHeatmapAxes(ctx, slice, pad, plotW, plotH) {
    ctx.save();
    ctx.strokeStyle = "rgba(215, 170, 69, 0.22)";
    ctx.lineWidth = 1;
    ctx.strokeRect(pad.left, pad.top, plotW, plotH);
    ctx.font = "11px Inter, ui-sans-serif, system-ui, sans-serif";
    ctx.fillStyle = "#7f745f";
    ctx.textAlign = "right";
    ctx.textBaseline = "middle";
    [0, 25, 50, 75, 100].forEach(function (price) {
      var y = priceToY(price, pad, plotH);
      ctx.fillText(price + "c", pad.left - 8, y);
      ctx.strokeStyle =
        price === 50 ? "rgba(215, 170, 69, 0.55)" : "rgba(215, 170, 69, 0.09)";
      ctx.beginPath();
      ctx.moveTo(pad.left, y);
      ctx.lineTo(pad.left + plotW, y);
      ctx.stroke();
    });

    var breakdown = activeBreakdown();
    if (!breakdown) {
      ctx.restore();
      return;
    }
    var ticks = niceAxisTicks(
      breakdown.leftEdgeOffsetMs || 0,
      breakdown.durationMs,
    );
    ctx.textAlign = "center";
    ctx.textBaseline = "top";
    ticks.forEach(function (tick) {
      var x = pad.left + tick.fractionX * plotW;
      ctx.fillText(tick.label, x, pad.top + plotH + 10);
    });

    if ((breakdown.leftEdgeOffsetMs || 0) < 0) {
      drawOpenDividerCanvas(ctx, breakdown, pad, plotW, plotH);
    }
    ctx.restore();
  }

  function drawOpenDividerCanvas(ctx, breakdown, pad, plotW, plotH) {
    var leftEdge = breakdown.leftEdgeOffsetMs || 0;
    var span = breakdown.durationMs - leftEdge;
    if (span <= 0) return;
    var fraction = (0 - leftEdge) / span;
    if (fraction < 0 || fraction > 1) return;
    var x = pad.left + fraction * plotW;
    ctx.save();
    ctx.strokeStyle = "rgba(215, 170, 69, 0.75)";
    ctx.lineWidth = 1.25;
    ctx.setLineDash([4, 3]);
    ctx.beginPath();
    ctx.moveTo(x, pad.top);
    ctx.lineTo(x, pad.top + plotH);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = "rgba(215, 170, 69, 0.9)";
    ctx.font = "10px Inter, ui-sans-serif, system-ui, sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "bottom";
    ctx.fillText("OPEN", x, pad.top - 4);
    ctx.restore();
  }

  function drawFiftyLine(ctx, pad, plotW, plotH) {
    var y = priceToY(50, pad, plotH);
    ctx.save();
    ctx.strokeStyle = "rgba(215, 170, 69, 0.95)";
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(pad.left, y);
    ctx.lineTo(pad.left + plotW, y);
    ctx.stroke();
    ctx.restore();
  }

  function priceToY(price, pad, plotH) {
    return pad.top + (100 - price) * (plotH / 100);
  }

  function heatColor(t) {
    var x = Math.max(0, Math.min(1, t));
    var r = Math.round(91 + (215 - 91) * x);
    var g = Math.round(149 + (170 - 149) * x);
    var b = Math.round(255 + (69 - 255) * x);
    var a = 0.12 + 0.78 * x;
    return "rgba(" + r + "," + g + "," + b + "," + a.toFixed(3) + ")";
  }

  function handleHeatmapMove(event) {
    if (!tooltip || !canvas || !state.slice || !state.heatmapLayout) return;
    var layout = state.heatmapLayout;
    var rect = canvas.getBoundingClientRect();
    var x = event.clientX - rect.left;
    var y = event.clientY - rect.top;
    var columns = state.slice.heatmap.columns || [];
    if (
      x < layout.pad.left ||
      x > layout.pad.left + layout.plotW ||
      y < layout.pad.top ||
      y > layout.pad.top + layout.plotH ||
      columns.length === 0
    ) {
      hideTooltip();
      return;
    }
    var colIndex = Math.max(
      0,
      Math.min(
        columns.length - 1,
        Math.floor(((x - layout.pad.left) / layout.plotW) * columns.length),
      ),
    );
    var price = Math.max(
      0,
      Math.min(
        100,
        Math.round(100 - ((y - layout.pad.top) / layout.plotH) * 100),
      ),
    );
    var column = columns[colIndex];
    var count = Number((column.counts && column.counts[price]) || 0);
    var share = column.sampleCount ? count / column.sampleCount : null;
    tooltip.innerHTML =
      '<div class="alea-tooltip-head">' +
      escapeHtml(
        formatRemaining(column.timeRemainingMs) + " / " + price + "c",
      ) +
      "</div>" +
      tooltipRow("Samples", count.toLocaleString()) +
      tooltipRow("Column share", share === null ? "--" : formatShare(share)) +
      tooltipRow(
        "Column total",
        Number(column.sampleCount || 0).toLocaleString(),
      );
    tooltip.style.left = Math.min(layout.width - 220, x + 14) + "px";
    tooltip.style.top = Math.max(8, y - 24) + "px";
    tooltip.classList.add("visible");
  }

  function tooltipRow(name, value) {
    return (
      '<div class="alea-tooltip-row"><span></span><span class="name">' +
      escapeHtml(name) +
      '</span><span class="value">' +
      escapeHtml(value) +
      "</span></div>"
    );
  }

  function hideTooltip() {
    if (tooltip) tooltip.classList.remove("visible");
  }

  /**
   * Map a clientX over a chart host to the index of the closest data
   * point. `layout.svgWidth` + `layout.pad` define the SVG viewBox
   * coordinate system; the chart host's bounding rect scales those
   * viewBox units to pixel space.
   */
  function bucketIndexFor(host, clientX, layout, count) {
    var rect = host.getBoundingClientRect();
    if (rect.width === 0 || count === 0) return -1;
    var svgX = ((clientX - rect.left) / rect.width) * layout.svgWidth;
    var t = (svgX - layout.pad.left) / layout.plotW;
    if (t < 0 || t > 1) return -1;
    var idx = Math.round(t * (count - 1));
    if (idx < 0) idx = 0;
    if (idx > count - 1) idx = count - 1;
    return idx;
  }

  function pointToSvgX(point, layout) {
    var leftEdge = layout.leftEdgeOffsetMs || 0;
    var span = layout.duration - leftEdge;
    var offset = layout.duration - Number(point.timeRemainingMs || 0);
    return layout.pad.left + ((offset - leftEdge) / span) * layout.plotW;
  }

  /**
   * Picks tick offsets aligned to a nice minute boundary anchored on
   * the candle open. Always includes T-0:00 at the right edge so the
   * chart reads cleanly through the close.
   */
  function niceAxisTicks(leftEdgeMs, durationMs) {
    var span = durationMs - leftEdgeMs;
    if (span <= 0) return [{ offsetMs: durationMs, label: "T-0:00", fractionX: 1 }];
    var stepCandidates = [
      10_000, 30_000, 60_000, 120_000, 300_000, 600_000, 1_800_000,
    ];
    var maxTicks = 6;
    var step = stepCandidates[stepCandidates.length - 1];
    for (var i = 0; i < stepCandidates.length; i += 1) {
      if (span / stepCandidates[i] <= maxTicks) {
        step = stepCandidates[i];
        break;
      }
    }
    var firstOffset = Math.ceil(leftEdgeMs / step) * step;
    var ticks = [];
    for (var offset = firstOffset; offset < durationMs; offset += step) {
      var timeRemaining = durationMs - offset;
      ticks.push({
        offsetMs: offset,
        label: formatRemaining(timeRemaining),
        fractionX: (offset - leftEdgeMs) / span,
      });
    }
    ticks.push({
      offsetMs: durationMs,
      label: "T-0:00",
      fractionX: 1,
    });
    return ticks;
  }

  function shareToSvgY(value, layout, scaleMax) {
    var max = scaleMax || 1;
    return layout.pad.top + (1 - value / max) * layout.plotH;
  }

  function handleBandMove(event) {
    var layout = state.bandLayout;
    if (!bandHost || !bandTooltip || !layout) return;
    var points = layout.points || [];
    var idx = bucketIndexFor(bandHost, event.clientX, layout, points.length);
    if (idx < 0) {
      hideBandHover();
      return;
    }
    var point = points[idx];
    if (!point) {
      hideBandHover();
      return;
    }
    var svg = bandHost.querySelector("svg");
    if (!svg) return;
    var x = pointToSvgX(point, layout);
    var hoverLine = svg.querySelector('[data-hover="band-line"]');
    if (hoverLine) {
      hoverLine.setAttribute("x1", x.toFixed(1));
      hoverLine.setAttribute("x2", x.toFixed(1));
      hoverLine.style.display = "";
    }
    [
      { key: "withinOneCentShare", cls: "band-one" },
      { key: "withinTwoCentShare", cls: "band-two" },
      { key: "withinFiveCentShare", cls: "band-five" },
    ].forEach(function (band) {
      var dot = svg.querySelector('[data-hover="' + band.cls + '"]');
      if (!dot) return;
      var value = point[band.key];
      if (value === null || value === undefined || !point.sampleCount) {
        dot.style.display = "none";
        return;
      }
      dot.setAttribute("cx", x.toFixed(1));
      dot.setAttribute("cy", shareToSvgY(value, layout, 1).toFixed(1));
      dot.style.display = "";
    });

    bandTooltip.innerHTML =
      '<div class="alea-tooltip-head">' +
      escapeHtml(formatRemaining(point.timeRemainingMs)) +
      "</div>" +
      bandTooltipRow("band-one", "49-51", point.withinOneCentShare) +
      bandTooltipRow("band-two", "48-52", point.withinTwoCentShare) +
      bandTooltipRow("band-five", "45-55", point.withinFiveCentShare) +
      tooltipRow("Samples", Number(point.sampleCount || 0).toLocaleString());
    positionTooltip(bandTooltip, bandHost, event);
    bandTooltip.classList.add("visible");
  }

  function hideBandHover() {
    if (!bandHost) return;
    if (bandTooltip) bandTooltip.classList.remove("visible");
    var svg = bandHost.querySelector("svg");
    if (!svg) return;
    svg
      .querySelectorAll("[data-hover]")
      .forEach(function (el) {
        el.style.display = "none";
      });
  }

  function handleCrossingsMove(event) {
    var layout = state.crossingsLayout;
    if (!crossingsChartHost || !crossingsTooltip || !layout) return;
    var buckets = layout.buckets || [];
    var idx = bucketIndexFor(
      crossingsChartHost,
      event.clientX,
      layout,
      buckets.length,
    );
    if (idx < 0) {
      hideCrossingsHover();
      return;
    }
    var bucket = buckets[idx];
    if (!bucket) {
      hideCrossingsHover();
      return;
    }
    var svg = crossingsChartHost.querySelector("svg");
    if (!svg) return;
    var x = pointToSvgX(bucket, layout);
    var obs = Number(bucket.windowsObserved || 0);
    var share = obs > 0 ? Number(bucket.windowsWithCrossing || 0) / obs : null;

    var hoverLine = svg.querySelector('[data-hover="crossings-line"]');
    if (hoverLine) {
      hoverLine.setAttribute("x1", x.toFixed(1));
      hoverLine.setAttribute("x2", x.toFixed(1));
      hoverLine.style.display = "";
    }
    var dot = svg.querySelector('[data-hover="crossings-dot"]');
    if (dot) {
      if (share === null) {
        dot.style.display = "none";
      } else {
        dot.setAttribute("cx", x.toFixed(1));
        dot.setAttribute(
          "cy",
          shareToSvgY(share, layout, layout.yMax || 1).toFixed(1),
        );
        dot.style.display = "";
      }
    }

    crossingsTooltip.innerHTML =
      '<div class="alea-tooltip-head">' +
      escapeHtml(formatRemaining(bucket.timeRemainingMs)) +
      "</div>" +
      tooltipRow("Windows", obs.toLocaleString()) +
      tooltipRow(
        "Crossings",
        Number(bucket.crossingCount || 0).toLocaleString(),
      ) +
      tooltipRow("Share", formatShare(share));
    positionTooltip(crossingsTooltip, crossingsChartHost, event);
    crossingsTooltip.classList.add("visible");
  }

  function hideCrossingsHover() {
    if (!crossingsChartHost) return;
    if (crossingsTooltip) crossingsTooltip.classList.remove("visible");
    var svg = crossingsChartHost.querySelector("svg");
    if (!svg) return;
    svg
      .querySelectorAll("[data-hover]")
      .forEach(function (el) {
        el.style.display = "none";
      });
  }

  function bandTooltipRow(swatchCls, label, value) {
    return (
      '<div class="alea-tooltip-row"><span class="price-path-band-swatch ' +
      swatchCls +
      '"></span><span class="name">' +
      escapeHtml(label) +
      '</span><span class="value">' +
      escapeHtml(formatShare(value)) +
      "</span></div>"
    );
  }

  function positionTooltip(el, host, event) {
    var rect = host.getBoundingClientRect();
    var x = event.clientX - rect.left;
    var y = event.clientY - rect.top;
    var maxX = Math.max(0, rect.width - 220);
    el.style.left = Math.min(maxX, x + 14) + "px";
    el.style.top = Math.max(8, y - 24) + "px";
  }

  function renderBandChart() {
    if (!bandHost) return;
    state.bandLayout = null;
    var slice = state.slice;
    if (!slice || !slice.sampleCount) {
      bandHost.innerHTML =
        '<p class="price-path-empty">No band-decay data for this slice yet.</p>';
      return;
    }
    var breakdown = activeBreakdown();
    if (!breakdown) {
      return;
    }
    var points = slice.bandSeries || [];
    var width = 900;
    var height = 320;
    var pad = { left: 48, right: 22, top: 24, bottom: 42 };
    var plotW = width - pad.left - pad.right;
    var plotH = height - pad.top - pad.bottom;
    var duration = breakdown.durationMs || 1;

    var svg =
      '<div class="price-path-band-legend">' +
      key("band-one", "49-51") +
      key("band-two", "48-52") +
      key("band-five", "45-55") +
      "</div>" +
      '<svg class="price-path-band-svg" viewBox="0 0 ' +
      width +
      " " +
      height +
      '" role="img" aria-label="50c band decay chart">';

    [0, 0.25, 0.5, 0.75, 1].forEach(function (v) {
      var y = pad.top + (1 - v) * plotH;
      svg +=
        '<line class="price-path-band-grid" x1="' +
        pad.left +
        '" x2="' +
        (pad.left + plotW) +
        '" y1="' +
        y +
        '" y2="' +
        y +
        '"></line>' +
        '<text class="price-path-band-label" x="' +
        (pad.left - 8) +
        '" y="' +
        (y + 4) +
        '" text-anchor="end">' +
        Math.round(v * 100) +
        "%</text>";
    });

    var leftEdge = breakdown.leftEdgeOffsetMs || 0;
    svg += xAxisSvgFor(leftEdge, duration, pad, plotW, plotH);
    svg += openDividerSvg(leftEdge, duration, pad, plotW, plotH);

    svg +=
      pathFor(
        points,
        "withinOneCentShare",
        "band-one",
        leftEdge,
        duration,
        pad,
        plotW,
        plotH,
      ) +
      pathFor(
        points,
        "withinTwoCentShare",
        "band-two",
        leftEdge,
        duration,
        pad,
        plotW,
        plotH,
      ) +
      pathFor(
        points,
        "withinFiveCentShare",
        "band-five",
        leftEdge,
        duration,
        pad,
        plotW,
        plotH,
      ) +
      // Hover-only overlay: vertical hairline + one dot per band line,
      // hidden until the mousemove handler positions them.
      '<line class="price-path-hover-line" data-hover="band-line"' +
      ' x1="0" x2="0" y1="' +
      pad.top +
      '" y2="' +
      (pad.top + plotH) +
      '" style="display:none"></line>' +
      '<circle class="price-path-hover-dot band-one" data-hover="band-one" r="3.5" cx="0" cy="0" style="display:none"></circle>' +
      '<circle class="price-path-hover-dot band-two" data-hover="band-two" r="3.5" cx="0" cy="0" style="display:none"></circle>' +
      '<circle class="price-path-hover-dot band-five" data-hover="band-five" r="3.5" cx="0" cy="0" style="display:none"></circle>' +
      "</svg>";
    bandHost.innerHTML = svg;

    state.bandLayout = {
      svgWidth: width,
      svgHeight: height,
      pad: pad,
      plotW: plotW,
      plotH: plotH,
      duration: duration,
      leftEdgeOffsetMs: leftEdge,
      points: points,
    };
  }

  function key(cls, label) {
    return (
      '<span class="price-path-band-key"><span class="price-path-band-swatch ' +
      cls +
      '"></span>' +
      escapeHtml(label) +
      "</span>"
    );
  }

  function pathFor(points, field, cls, leftEdge, duration, pad, plotW, plotH) {
    var span = duration - leftEdge;
    if (span <= 0) return "";
    var d = "";
    points.forEach(function (point) {
      var value = point[field];
      if (value === null || value === undefined || !point.sampleCount) {
        return;
      }
      var offset = duration - point.timeRemainingMs;
      var x = pad.left + ((offset - leftEdge) / span) * plotW;
      var y = pad.top + (1 - value) * plotH;
      d += (d ? "L" : "M") + x.toFixed(1) + "," + y.toFixed(1);
    });
    if (!d) return "";
    return (
      '<path class="price-path-band-line ' + cls + '" d="' + d + '"></path>'
    );
  }

  function xAxisSvgFor(leftEdge, duration, pad, plotW, plotH) {
    var ticks = niceAxisTicks(leftEdge, duration);
    var out = "";
    ticks.forEach(function (tick) {
      var x = pad.left + tick.fractionX * plotW;
      out +=
        '<line class="price-path-band-grid" x1="' +
        x +
        '" x2="' +
        x +
        '" y1="' +
        pad.top +
        '" y2="' +
        (pad.top + plotH) +
        '"></line>' +
        '<text class="price-path-band-label" x="' +
        x +
        '" y="' +
        (pad.top + plotH + 22) +
        '" text-anchor="middle">' +
        escapeHtml(tick.label) +
        "</text>";
    });
    return out;
  }

  function openDividerSvg(leftEdge, duration, pad, plotW, plotH) {
    if (leftEdge >= 0) return "";
    var span = duration - leftEdge;
    if (span <= 0) return "";
    var fraction = (0 - leftEdge) / span;
    if (fraction < 0 || fraction > 1) return "";
    var x = pad.left + fraction * plotW;
    return (
      '<line class="price-path-open-divider" x1="' +
      x.toFixed(1) +
      '" x2="' +
      x.toFixed(1) +
      '" y1="' +
      pad.top +
      '" y2="' +
      (pad.top + plotH) +
      '"></line>' +
      '<text class="price-path-open-label" x="' +
      x.toFixed(1) +
      '" y="' +
      (pad.top - 4) +
      '" text-anchor="middle">OPEN</text>'
    );
  }

  /**
   * 50c crossings chart. Each bucket = a time-remaining slice; the line
   * is "share of windows that had a crossing in this slice", computed
   * as windowsWithCrossing / windowsObserved. Empty buckets are
   * skipped so the line doesn't dip to zero on sparse columns.
   */
  function renderCrossingsChart() {
    if (!crossingsChartHost) return;
    state.crossingsLayout = null;
    var slice = state.slice;
    var breakdown = activeBreakdown();
    if (!breakdown || !slice || !slice.crossings) {
      crossingsChartHost.innerHTML =
        '<p class="price-path-empty">No crossings data for this slice yet.</p>';
      return;
    }
    var buckets = slice.crossings.buckets || [];
    var hasData = buckets.some(function (b) {
      return Number(b.windowsObserved || 0) > 0;
    });
    if (!hasData) {
      crossingsChartHost.innerHTML =
        '<p class="price-path-empty">No crossings data for this slice yet.</p>';
      return;
    }
    var width = 900;
    var height = 280;
    var pad = { left: 48, right: 22, top: 24, bottom: 42 };
    var plotW = width - pad.left - pad.right;
    var plotH = height - pad.top - pad.bottom;
    var duration = breakdown.durationMs || 1;

    var shares = buckets.map(function (b) {
      var obs = Number(b.windowsObserved || 0);
      return obs > 0 ? Number(b.windowsWithCrossing || 0) / obs : null;
    });
    var maxShare = 0;
    shares.forEach(function (s) {
      if (s !== null && s > maxShare) {
        maxShare = s;
      }
    });
    var yMax = Math.max(0.05, Math.ceil(maxShare * 20) / 20);

    var svg =
      '<svg class="price-path-crossings-svg" viewBox="0 0 ' +
      width +
      " " +
      height +
      '" role="img" aria-label="50c crossings by time remaining">';

    var yTicks = [0, 0.25, 0.5, 0.75, 1];
    yTicks.forEach(function (v) {
      var y = pad.top + (1 - v) * plotH;
      svg +=
        '<line class="price-path-band-grid" x1="' +
        pad.left +
        '" x2="' +
        (pad.left + plotW) +
        '" y1="' +
        y +
        '" y2="' +
        y +
        '"></line>' +
        '<text class="price-path-band-label" x="' +
        (pad.left - 8) +
        '" y="' +
        (y + 4) +
        '" text-anchor="end">' +
        Math.round(v * yMax * 100) +
        "%</text>";
    });

    var leftEdge = breakdown.leftEdgeOffsetMs || 0;
    svg += xAxisSvgFor(leftEdge, duration, pad, plotW, plotH);
    svg += openDividerSvg(leftEdge, duration, pad, plotW, plotH);

    var span = duration - leftEdge;
    var d = "";
    buckets.forEach(function (bucket, i) {
      var s = shares[i];
      if (s === null) return;
      var offset = duration - Number(bucket.timeRemainingMs || 0);
      var x = pad.left + ((offset - leftEdge) / span) * plotW;
      var y = pad.top + (1 - s / yMax) * plotH;
      d += (d ? "L" : "M") + x.toFixed(1) + "," + y.toFixed(1);
    });
    if (d) {
      svg +=
        '<path class="price-path-crossings-line" d="' + d + '"></path>';
    }

    // Hover-only overlay: vertical hairline + one dot, hidden until
    // the mousemove handler positions them.
    svg +=
      '<line class="price-path-hover-line" data-hover="crossings-line"' +
      ' x1="0" x2="0" y1="' +
      pad.top +
      '" y2="' +
      (pad.top + plotH) +
      '" style="display:none"></line>' +
      '<circle class="price-path-hover-dot band-one" data-hover="crossings-dot" r="3.5" cx="0" cy="0" style="display:none"></circle>';

    svg += "</svg>";
    crossingsChartHost.innerHTML = svg;

    state.crossingsLayout = {
      svgWidth: width,
      svgHeight: height,
      pad: pad,
      plotW: plotW,
      plotH: plotH,
      duration: duration,
      leftEdgeOffsetMs: leftEdge,
      buckets: buckets,
      yMax: yMax,
    };
  }

  function formatShare(value) {
    if (value === null || value === undefined) {
      return "--";
    }
    return (Number(value) * 100).toFixed(1) + "%";
  }

  function formatRemaining(ms) {
    var seconds = Math.max(0, Math.round(Number(ms || 0) / 1000));
    var minutes = Math.floor(seconds / 60);
    var rest = seconds % 60;
    return "T-" + minutes + ":" + String(rest).padStart(2, "0");
  }

  function fallbackEscapeHtml(value) {
    return String(value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function driftSliceForState() {
    var drift = payload && payload.leadTimeDrift;
    if (!drift || !drift.breakdowns) return null;
    var breakdown = drift.breakdowns.filter(function (b) {
      return b.timeframe === state.timeframe;
    })[0];
    if (!breakdown) return null;
    var asset = state.asset || "all";
    var slice = breakdown.slices.filter(function (s) {
      return (s.asset || "all") === asset;
    })[0];
    if (!slice) {
      slice = breakdown.slices[0] || null;
    }
    return { breakdown: breakdown, slice: slice, drift: drift };
  }

  function renderDriftSharesChart() {
    if (!driftSharesHost) return;
    state.driftSharesLayout = null;
    var ctx = driftSliceForState();
    var drift = payload && payload.leadTimeDrift;
    var hasOneMin = Boolean(drift && drift.hasOneMinuteCandles);
    if (driftEmpty) {
      if (hasOneMin) {
        driftEmpty.setAttribute("hidden", "hidden");
      } else {
        driftEmpty.removeAttribute("hidden");
      }
    }
    if (!ctx || !ctx.slice || !ctx.slice.leads || !ctx.slice.leads.length) {
      driftSharesHost.innerHTML =
        '<p class="price-path-empty">No drift data for this slice yet.</p>';
      return;
    }
    var thresholds = (ctx.drift && ctx.drift.thresholdsBps) || [];
    var leads = ctx.slice.leads;
    var hasAnyShare = leads.some(function (lead) {
      return (lead.thresholdShares || []).some(function (s) {
        return s !== null && s !== undefined;
      });
    });
    if (!hasAnyShare) {
      driftSharesHost.innerHTML =
        '<p class="price-path-empty">No drift shares for this slice yet.</p>';
      return;
    }
    var lineDefs = thresholds.map(function (threshold, idx) {
      return {
        idx: idx,
        threshold: threshold,
        label: "≤ " + threshold + " bps",
        cls: "drift-share-" + threshold,
      };
    });

    var width = 900;
    var height = 280;
    var pad = { left: 56, right: 22, top: 24, bottom: 44 };
    var plotW = width - pad.left - pad.right;
    var plotH = height - pad.top - pad.bottom;

    var svg =
      '<div class="price-path-band-legend">' +
      lineDefs
        .map(function (line) {
          return key(line.cls, line.label);
        })
        .join("") +
      "</div>" +
      '<svg class="price-path-band-svg" viewBox="0 0 ' +
      width +
      " " +
      height +
      '" role="img" aria-label="Share of candles within drift band by lead minutes">';

    [0, 0.25, 0.5, 0.75, 1].forEach(function (v) {
      var y = pad.top + (1 - v) * plotH;
      svg +=
        '<line class="price-path-band-grid" x1="' +
        pad.left +
        '" x2="' +
        (pad.left + plotW) +
        '" y1="' +
        y +
        '" y2="' +
        y +
        '"></line>' +
        '<text class="price-path-band-label" x="' +
        (pad.left - 8) +
        '" y="' +
        (y + 4) +
        '" text-anchor="end">' +
        Math.round(v * 100) +
        "%</text>";
    });

    leads.forEach(function (lead, i) {
      var x = pad.left + xFractionForIndex(i, leads.length) * plotW;
      svg +=
        '<line class="price-path-band-grid" x1="' +
        x +
        '" x2="' +
        x +
        '" y1="' +
        pad.top +
        '" y2="' +
        (pad.top + plotH) +
        '"></line>' +
        '<text class="price-path-band-label" x="' +
        x +
        '" y="' +
        (pad.top + plotH + 22) +
        '" text-anchor="middle">' +
        escapeHtml(formatLeadMinutes(lead.leadMinutes)) +
        "</text>";
    });

    lineDefs.forEach(function (line) {
      var d = "";
      leads.forEach(function (lead, i) {
        var s = (lead.thresholdShares || [])[line.idx];
        if (s === null || s === undefined) return;
        var x = pad.left + xFractionForIndex(i, leads.length) * plotW;
        var y = pad.top + (1 - s) * plotH;
        d += (d ? "L" : "M") + x.toFixed(1) + "," + y.toFixed(1);
      });
      if (d) {
        svg +=
          '<path class="price-path-band-line ' +
          line.cls +
          '" d="' +
          d +
          '"></path>';
      }
    });

    svg +=
      '<line class="price-path-hover-line" data-hover="drift-shares-line" x1="0" x2="0" y1="' +
      pad.top +
      '" y2="' +
      (pad.top + plotH) +
      '" style="display:none"></line>';
    lineDefs.forEach(function (line) {
      svg +=
        '<circle class="price-path-hover-dot ' +
        line.cls +
        '" data-hover="' +
        line.cls +
        '-dot" r="3.5" cx="0" cy="0" style="display:none"></circle>';
    });
    svg += "</svg>";

    driftSharesHost.innerHTML = svg;
    state.driftSharesLayout = {
      svgWidth: width,
      svgHeight: height,
      pad: pad,
      plotW: plotW,
      plotH: plotH,
      leads: leads,
      thresholds: thresholds,
      lineDefs: lineDefs,
    };
  }

  function xFractionForIndex(i, n) {
    if (n <= 1) return 0;
    return i / (n - 1);
  }

  function handleDriftSharesMove(event) {
    var layout = state.driftSharesLayout;
    if (!driftSharesHost || !driftSharesTooltip || !layout) return;
    var leads = layout.leads || [];
    var idx = bucketIndexFor(
      driftSharesHost,
      event.clientX,
      layout,
      leads.length,
    );
    if (idx < 0) {
      hideDriftSharesHover();
      return;
    }
    var lead = leads[idx];
    if (!lead) {
      hideDriftSharesHover();
      return;
    }
    var svg = driftSharesHost.querySelector("svg");
    if (!svg) return;
    var x =
      layout.pad.left + xFractionForIndex(idx, leads.length) * layout.plotW;
    var hoverLine = svg.querySelector('[data-hover="drift-shares-line"]');
    if (hoverLine) {
      hoverLine.setAttribute("x1", x.toFixed(1));
      hoverLine.setAttribute("x2", x.toFixed(1));
      hoverLine.style.display = "";
    }
    (layout.lineDefs || []).forEach(function (line) {
      var dot = svg.querySelector('[data-hover="' + line.cls + '-dot"]');
      if (!dot) return;
      var share = (lead.thresholdShares || [])[line.idx];
      if (share === null || share === undefined) {
        dot.style.display = "none";
        return;
      }
      dot.setAttribute("cx", x.toFixed(1));
      dot.setAttribute(
        "cy",
        (layout.pad.top + (1 - share) * layout.plotH).toFixed(1),
      );
      dot.style.display = "";
    });

    driftSharesTooltip.innerHTML =
      '<div class="alea-tooltip-head">' +
      escapeHtml(formatLeadMinutes(lead.leadMinutes) + " from close") +
      "</div>" +
      (layout.lineDefs || [])
        .map(function (line) {
          var share = (lead.thresholdShares || [])[line.idx];
          return bandTooltipRowLabeled(
            line.cls,
            line.label,
            formatShare(share),
          );
        })
        .join("") +
      tooltipRow(
        "Samples",
        Number(lead.sampleCount || 0).toLocaleString(),
      );
    positionTooltip(driftSharesTooltip, driftSharesHost, event);
    driftSharesTooltip.classList.add("visible");
  }

  function hideDriftSharesHover() {
    if (!driftSharesHost) return;
    if (driftSharesTooltip) {
      driftSharesTooltip.classList.remove("visible");
    }
    var svg = driftSharesHost.querySelector("svg");
    if (!svg) return;
    svg.querySelectorAll("[data-hover]").forEach(function (el) {
      el.style.display = "none";
    });
  }

  function renderFlipShareChart() {
    if (!flipShareHost) return;
    state.flipShareLayout = null;
    var ctx = driftSliceForState();
    if (!ctx || !ctx.slice || !ctx.slice.leads || !ctx.slice.leads.length) {
      flipShareHost.innerHTML =
        '<p class="price-path-empty">No flip data for this slice yet.</p>';
      return;
    }
    var leads = ctx.slice.leads;
    var hasAnyShare = leads.some(function (lead) {
      return lead.flippedShare !== null && lead.flippedShare !== undefined;
    });
    if (!hasAnyShare) {
      flipShareHost.innerHTML =
        '<p class="price-path-empty">No flip data for this slice yet.</p>';
      return;
    }
    var maxShare = 0;
    leads.forEach(function (lead) {
      var s = Number(lead.flippedShare);
      if (Number.isFinite(s) && s > maxShare) maxShare = s;
    });
    var yMax = Math.max(0.05, Math.ceil(maxShare * 20) / 20);

    var width = 900;
    var height = 280;
    var pad = { left: 56, right: 22, top: 24, bottom: 44 };
    var plotW = width - pad.left - pad.right;
    var plotH = height - pad.top - pad.bottom;

    var svg =
      '<div class="price-path-band-legend">' +
      key("flip-share", "Direction flipped vs close") +
      "</div>" +
      '<svg class="price-path-band-svg" viewBox="0 0 ' +
      width +
      " " +
      height +
      '" role="img" aria-label="Share of candles whose direction flipped between lead and close">';

    [0, 0.25, 0.5, 0.75, 1].forEach(function (v) {
      var y = pad.top + (1 - v) * plotH;
      svg +=
        '<line class="price-path-band-grid" x1="' +
        pad.left +
        '" x2="' +
        (pad.left + plotW) +
        '" y1="' +
        y +
        '" y2="' +
        y +
        '"></line>' +
        '<text class="price-path-band-label" x="' +
        (pad.left - 8) +
        '" y="' +
        (y + 4) +
        '" text-anchor="end">' +
        Math.round(v * yMax * 100) +
        "%</text>";
    });

    leads.forEach(function (lead, i) {
      var x = pad.left + xFractionForIndex(i, leads.length) * plotW;
      svg +=
        '<line class="price-path-band-grid" x1="' +
        x +
        '" x2="' +
        x +
        '" y1="' +
        pad.top +
        '" y2="' +
        (pad.top + plotH) +
        '"></line>' +
        '<text class="price-path-band-label" x="' +
        x +
        '" y="' +
        (pad.top + plotH + 22) +
        '" text-anchor="middle">' +
        escapeHtml(formatLeadMinutes(lead.leadMinutes)) +
        "</text>";
    });

    var d = "";
    leads.forEach(function (lead, i) {
      var s = Number(lead.flippedShare);
      if (!Number.isFinite(s)) return;
      var x = pad.left + xFractionForIndex(i, leads.length) * plotW;
      var y = pad.top + (1 - s / yMax) * plotH;
      d += (d ? "L" : "M") + x.toFixed(1) + "," + y.toFixed(1);
    });
    if (d) {
      svg +=
        '<path class="price-path-band-line flip-share" d="' + d + '"></path>';
    }

    svg +=
      '<line class="price-path-hover-line" data-hover="flip-share-line" x1="0" x2="0" y1="' +
      pad.top +
      '" y2="' +
      (pad.top + plotH) +
      '" style="display:none"></line>' +
      '<circle class="price-path-hover-dot flip-share" data-hover="flip-share-dot" r="3.5" cx="0" cy="0" style="display:none"></circle>';
    svg += "</svg>";

    flipShareHost.innerHTML = svg;
    state.flipShareLayout = {
      svgWidth: width,
      svgHeight: height,
      pad: pad,
      plotW: plotW,
      plotH: plotH,
      yMax: yMax,
      leads: leads,
    };
  }

  function handleFlipShareMove(event) {
    var layout = state.flipShareLayout;
    if (!flipShareHost || !flipShareTooltip || !layout) return;
    var leads = layout.leads || [];
    var idx = bucketIndexFor(flipShareHost, event.clientX, layout, leads.length);
    if (idx < 0) {
      hideFlipShareHover();
      return;
    }
    var lead = leads[idx];
    if (!lead) {
      hideFlipShareHover();
      return;
    }
    var svg = flipShareHost.querySelector("svg");
    if (!svg) return;
    var x =
      layout.pad.left + xFractionForIndex(idx, leads.length) * layout.plotW;
    var hoverLine = svg.querySelector('[data-hover="flip-share-line"]');
    if (hoverLine) {
      hoverLine.setAttribute("x1", x.toFixed(1));
      hoverLine.setAttribute("x2", x.toFixed(1));
      hoverLine.style.display = "";
    }
    var dot = svg.querySelector('[data-hover="flip-share-dot"]');
    var share = Number(lead.flippedShare);
    if (dot) {
      if (!Number.isFinite(share)) {
        dot.style.display = "none";
      } else {
        dot.setAttribute("cx", x.toFixed(1));
        dot.setAttribute(
          "cy",
          (layout.pad.top + (1 - share / layout.yMax) * layout.plotH).toFixed(1),
        );
        dot.style.display = "";
      }
    }
    flipShareTooltip.innerHTML =
      '<div class="alea-tooltip-head">' +
      escapeHtml(formatLeadMinutes(lead.leadMinutes) + " from close") +
      "</div>" +
      bandTooltipRowLabeled(
        "flip-share",
        "Flipped",
        formatShare(Number.isFinite(share) ? share : null),
      ) +
      tooltipRow(
        "Directional candles",
        Number(lead.directionalCount || 0).toLocaleString(),
      );
    positionTooltip(flipShareTooltip, flipShareHost, event);
    flipShareTooltip.classList.add("visible");
  }

  function hideFlipShareHover() {
    if (!flipShareHost) return;
    if (flipShareTooltip) flipShareTooltip.classList.remove("visible");
    var svg = flipShareHost.querySelector("svg");
    if (!svg) return;
    svg.querySelectorAll("[data-hover]").forEach(function (el) {
      el.style.display = "none";
    });
  }

  function bandTooltipRowLabeled(swatchCls, label, value) {
    return (
      '<div class="alea-tooltip-row"><span class="price-path-band-swatch ' +
      swatchCls +
      '"></span><span class="name">' +
      escapeHtml(label) +
      '</span><span class="value">' +
      escapeHtml(value) +
      "</span></div>"
    );
  }

  function formatLeadMinutes(leadMinutes) {
    return "T-" + leadMinutes + "m";
  }

})();

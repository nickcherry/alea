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
  var crossingsTableHost = document.getElementById(
    "price-path-crossings-table-host",
  );

  var state = {
    timeframe: initialTimeframe(),
    asset: "all",
    slice: null,
    heatmapLayout: null,
    bandLayout: null,
    crossingsLayout: null,
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

  window.addEventListener("resize", function () {
    window.clearTimeout(window.__aleaPricePathsResize);
    window.__aleaPricePathsResize = window.setTimeout(function () {
      renderHeatmap();
      renderBandChart();
      renderCrossingsChart();
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
    renderCrossingsTable();
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

    var columns = slice && slice.heatmap ? slice.heatmap.columns || [] : [];
    var tickCount = Math.min(6, columns.length);
    ctx.textAlign = "center";
    ctx.textBaseline = "top";
    for (var i = 0; i < tickCount; i += 1) {
      var rawIndex =
        tickCount === 1
          ? 0
          : Math.round((i / (tickCount - 1)) * (columns.length - 1));
      var column = columns[rawIndex];
      if (!column) continue;
      var x = pad.left + (rawIndex / Math.max(1, columns.length - 1)) * plotW;
      ctx.fillText(
        formatRemaining(column.timeRemainingMs),
        x,
        pad.top + plotH + 10,
      );
    }
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
    return (
      layout.pad.left +
      ((layout.duration - Number(point.timeRemainingMs || 0)) /
        layout.duration) *
        layout.plotW
    );
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

    var xTicks = [0, 0.25, 0.5, 0.75, 1];
    xTicks.forEach(function (v) {
      var x = pad.left + v * plotW;
      var remaining = duration * (1 - v);
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
        escapeHtml(formatRemaining(remaining)) +
        "</text>";
    });

    svg +=
      pathFor(
        points,
        "withinOneCentShare",
        "band-one",
        duration,
        pad,
        plotW,
        plotH,
      ) +
      pathFor(
        points,
        "withinTwoCentShare",
        "band-two",
        duration,
        pad,
        plotW,
        plotH,
      ) +
      pathFor(
        points,
        "withinFiveCentShare",
        "band-five",
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

  function pathFor(points, field, cls, duration, pad, plotW, plotH) {
    var d = "";
    points.forEach(function (point) {
      var value = point[field];
      if (value === null || value === undefined || !point.sampleCount) {
        return;
      }
      var x =
        pad.left + ((duration - point.timeRemainingMs) / duration) * plotW;
      var y = pad.top + (1 - value) * plotH;
      d += (d ? "L" : "M") + x.toFixed(1) + "," + y.toFixed(1);
    });
    if (!d) return "";
    return (
      '<path class="price-path-band-line ' + cls + '" d="' + d + '"></path>'
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

    var xTicks = [0, 0.25, 0.5, 0.75, 1];
    xTicks.forEach(function (v) {
      var x = pad.left + v * plotW;
      var remaining = duration * (1 - v);
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
        escapeHtml(formatRemaining(remaining)) +
        "</text>";
    });

    var d = "";
    buckets.forEach(function (bucket, i) {
      var s = shares[i];
      if (s === null) return;
      var x =
        pad.left +
        ((duration - Number(bucket.timeRemainingMs || 0)) / duration) * plotW;
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
      buckets: buckets,
      yMax: yMax,
    };
  }

  /**
   * Crossings table. One row per time bucket (10 seconds each) showing
   * the window denominator, crossing count, and share at that slice.
   * Iterates the full `buckets` array so the operator sees crossings
   * at every 10-second slice instead of a sparse marker subset.
   */
  function renderCrossingsTable() {
    if (!crossingsTableHost) return;
    var slice = state.slice;
    if (!slice || !slice.crossings) {
      crossingsTableHost.innerHTML = "";
      return;
    }
    var buckets = slice.crossings.buckets || [];
    if (buckets.length === 0) {
      crossingsTableHost.innerHTML = "";
      return;
    }
    crossingsTableHost.innerHTML =
      '<div class="alea-table-wrap price-path-crossings-table-wrap">' +
      '<table class="alea-table price-path-crossings-table">' +
      "<thead><tr>" +
      "<th>Time remaining</th>" +
      '<th class="num-col">Windows</th>' +
      '<th class="num-col">Crossings</th>' +
      '<th class="num-col">Share</th>' +
      "</tr></thead><tbody>" +
      buckets.map(renderCrossingsRow).join("") +
      "</tbody></table></div>";
  }

  function renderCrossingsRow(bucket) {
    var obs = Number(bucket.windowsObserved || 0);
    var withC = Number(bucket.windowsWithCrossing || 0);
    var share = obs > 0 ? withC / obs : null;
    return (
      "<tr>" +
      '<td class="alea-mono">' +
      escapeHtml(formatRemaining(bucket.timeRemainingMs)) +
      "</td>" +
      '<td class="num-col alea-mono">' +
      obs.toLocaleString() +
      "</td>" +
      '<td class="num-col alea-mono">' +
      Number(bucket.crossingCount || 0).toLocaleString() +
      "</td>" +
      '<td class="num-col alea-mono">' +
      formatShare(share) +
      "</td>" +
      "</tr>"
    );
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
})();

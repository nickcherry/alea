/* eslint-disable */
/*
 * Client-side logic for the Exchange Price Latency report. Reads its
 * bootstrap data from a sibling <script type="application/json"
 * id="price-chart-payload"> tag.
 */
(function () {
  const payloadEl = document.getElementById("price-chart-payload");
  if (!payloadEl) {
    console.error("price-chart: no #price-chart-payload script tag found");
    return;
  }
  const payload = JSON.parse(payloadEl.textContent);
  const spotPanel = payload.spotPanel;
  const perpPanel = payload.perpPanel;
  const xs = payload.xs;
  const tickCountsByLabel = payload.tickCountsByLabel;
  const tickCountBars = payload.tickCountBars;
  const chartTokens = payload.chartTokens;

  const priceFormatter = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const priceFormatterCompact = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 0, maximumFractionDigits: 0 });
  const tooltipTimeFormatter = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
  const formatTime = (msUnix) => {
    const d = new Date(msUnix * 1000);
    const hms = tooltipTimeFormatter.format(d);
    const ms = String(d.getUTCMilliseconds()).padStart(3, "0");
    return hms + "." + ms + " ET";
  };

  const panelsEl = document.querySelector(".panels");
  const tooltipEl = document.getElementById("tooltip");
  const legendEl = document.getElementById("legend");
  const spotHost = document.getElementById("chart-spot");
  const perpHost = document.getElementById("chart-perp");
  const muted = new Set();

  function buildSeriesConfig(meta) {
    return [{}].concat(meta.map((m) => ({
      label: m.label,
      stroke: m.stroke,
      width: m.width,
      dash: m.dash ? [8, 4] : undefined,
      alpha: m.alpha != null ? m.alpha : 1,
      points: { show: false },
      spanGaps: false,
    })));
  }

  const easternHmsFormatter = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
  const easternHmFormatter = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });

  function makeAxes(showXLabels) {
    return [
      {
        stroke: chartTokens.axisStroke,
        font: chartTokens.axisFont,
        grid: { stroke: chartTokens.gridStroke, width: 1 },
        ticks: { stroke: chartTokens.axisTickStroke, width: 1, size: 5 },
        show: showXLabels,
        // Minimum pixel gap between x-axis ticks. uPlot picks a tick
        // density that keeps adjacent labels at least this far apart, so
        // longer captures naturally end up with fewer (less cramped)
        // labels rather than crammed HH:MM:SS strings on top of each
        // other. uPlot doesn't natively rotate labels.
        space: 110,
        values: (u, splits) => {
          // If ticks are at least a minute apart, drop the seconds —
          // "13:55" reads cleaner than "13:55:00" at lower density.
          const incr = splits.length > 1
            ? splits[1] - splits[0]
            : Number.POSITIVE_INFINITY;
          const formatter = incr >= 60
            ? easternHmFormatter
            : easternHmsFormatter;
          return splits.map((s) => formatter.format(new Date(s * 1000)));
        },
      },
      {
        stroke: chartTokens.axisStroke,
        font: chartTokens.axisFont,
        grid: { stroke: chartTokens.gridStroke, width: 1 },
        ticks: { stroke: chartTokens.axisTickStroke, width: 1, size: 5 },
        values: (u, splits) => splits.map((v) => priceFormatterCompact.format(v)),
        size: 92,
      },
    ];
  }

  const spotData = [xs].concat(spotPanel.ys);
  const perpData = [xs].concat(perpPanel.ys);
  const syncKey = "alea-prices";

  const spotOpts = {
    width: spotHost.clientWidth,
    height: spotHost.clientHeight,
    padding: [22, 26, 6, 12],
    cursor: {
      points: { show: false },
      drag: { setScale: false, x: false, y: false },
      focus: { prox: 1e9 },
      sync: { key: syncKey },
    },
    legend: { show: false },
    series: buildSeriesConfig(spotPanel.meta),
    axes: makeAxes(false),
    hooks: { setCursor: [onCursor("spot")] },
  };
  const perpOpts = {
    width: perpHost.clientWidth,
    height: perpHost.clientHeight,
    padding: [12, 26, 8, 12],
    cursor: {
      points: { show: false },
      drag: { setScale: false, x: false, y: false },
      focus: { prox: 1e9 },
      sync: { key: syncKey },
    },
    legend: { show: false },
    series: buildSeriesConfig(perpPanel.meta),
    axes: makeAxes(true),
    hooks: { setCursor: [onCursor("perp")] },
  };

  const spotChart = new uPlot(spotOpts, spotData, spotHost);
  const perpChart = new uPlot(perpOpts, perpData, perpHost);

  function onCursor(which) {
    return function (u) {
      const idx = u.cursor.idx;
      if (idx == null) {
        tooltipEl.classList.remove("visible");
        return;
      }
      const xVal = u.data[0][idx];
      const allMeta = spotPanel.meta.concat(perpPanel.meta);
      const allSeriesData = [];
      for (let i = 0; i < spotPanel.ys.length; i += 1) allSeriesData.push(spotPanel.ys[i]);
      for (let i = 0; i < perpPanel.ys.length; i += 1) allSeriesData.push(perpPanel.ys[i]);
      const rows = [];
      for (let i = 0; i < allMeta.length; i += 1) {
        const m = allMeta[i];
        if (muted.has(m.label)) continue;
        const y = allSeriesData[i][idx];
        if (y == null) continue;
        const swatchClass = m.dash ? "alea-legend-swatch dashed" : "alea-legend-swatch";
        const swatchStyle = m.dash ? "color:" + m.stroke : "background:" + m.stroke;
        rows.push({
          priority: m.priority,
          price: y,
          html: '<div class="alea-tooltip-row">'
            + '<span class="' + swatchClass + '" style="' + swatchStyle + '"></span>'
            + '<span class="name">' + m.label + '</span>'
            + '<span class="value">' + priceFormatter.format(y) + '</span>'
            + '</div>',
        });
      }
      rows.sort((a, b) => (b.priority - a.priority) || (b.price - a.price));
      tooltipEl.innerHTML = '<div class="alea-tooltip-head">' + formatTime(xVal) + '</div>' + rows.map((r) => r.html).join("");

      // Pin the tooltip to whichever side is opposite the cursor so it
      // never overlaps the data region the user is examining. Vertical
      // pin to top of the panels container.
      const host = which === "spot" ? spotHost : perpHost;
      const hostRect = host.getBoundingClientRect();
      const wrapRect = panelsEl.getBoundingClientRect();
      const cursorXInWrap = (hostRect.left - wrapRect.left) + u.cursor.left;
      const halfwayX = wrapRect.width / 2;
      const ttW = tooltipEl.offsetWidth;
      const margin = 14;
      const left = cursorXInWrap < halfwayX
        ? wrapRect.width - ttW - margin
        : margin;
      tooltipEl.style.left = left + "px";
      tooltipEl.style.top = margin + "px";
      tooltipEl.classList.add("visible");
    };
  }

  // VWAPs first, then everything else descending by tick count.
  const allMeta = spotPanel.meta.concat(perpPanel.meta);
  const aggregateLabels = new Set(["spot vwap", "perp vwap"]);
  const orderedMeta = [
    ...allMeta.filter((m) => aggregateLabels.has(m.label))
      .sort((a, b) => a.label.localeCompare(b.label)),
    ...allMeta.filter((m) => !aggregateLabels.has(m.label))
      .sort((a, b) => (tickCountsByLabel[b.label] ?? 0) - (tickCountsByLabel[a.label] ?? 0)),
  ];

  function renderLegend() {
    legendEl.innerHTML = orderedMeta.map((m) => {
      const muteClass = muted.has(m.label) ? " muted" : "";
      const swatchClass = m.dash ? "alea-legend-swatch dashed" : "alea-legend-swatch";
      const swatchStyle = m.dash ? "color:" + m.stroke : "background:" + m.stroke;
      return '<span class="alea-legend-item' + muteClass + '" data-label="' + m.label + '">'
        + '<span class="' + swatchClass + '" style="' + swatchStyle + '"></span>'
        + m.label
        + '</span>';
    }).join("");
  }
  renderLegend();

  function renderBars() {
    const barsEl = document.getElementById("bars");
    if (!barsEl) return;
    const max = tickCountBars.reduce((m, b) => Math.max(m, b.count), 0) || 1;
    barsEl.innerHTML = tickCountBars.map((b) => {
      const widthPct = (b.count / max) * 100;
      return '<div class="bar-row">'
        + '<span class="bar-label">' + b.label + '</span>'
        + '<div class="bar-track"><div class="bar-fill" style="width:' + widthPct.toFixed(2) + '%;background:linear-gradient(90deg,' + b.stroke + 'cc,' + b.stroke + ')"></div></div>'
        + '<span class="bar-value">' + b.count.toLocaleString() + '</span>'
        + '</div>';
    }).join("");
  }
  renderBars();
  legendEl.addEventListener("click", (e) => {
    const target = e.target.closest(".alea-legend-item");
    if (!target) return;
    const label = target.getAttribute("data-label");
    const findIdx = (meta) => meta.findIndex((m) => m.label === label) + 1;
    const spotIdx = findIdx(spotPanel.meta);
    const perpIdx = findIdx(perpPanel.meta);
    if (muted.has(label)) {
      muted.delete(label);
      if (spotIdx > 0) spotChart.setSeries(spotIdx, { show: true });
      if (perpIdx > 0) perpChart.setSeries(perpIdx, { show: true });
    } else {
      muted.add(label);
      if (spotIdx > 0) spotChart.setSeries(spotIdx, { show: false });
      if (perpIdx > 0) perpChart.setSeries(perpIdx, { show: false });
    }
    renderLegend();
  });

  function resize() {
    spotChart.setSize({ width: spotHost.clientWidth, height: spotHost.clientHeight });
    perpChart.setSize({ width: perpHost.clientWidth, height: perpHost.clientHeight });
  }
  window.addEventListener("resize", resize);
  panelsEl.addEventListener("mouseleave", () => tooltipEl.classList.remove("visible"));
})();

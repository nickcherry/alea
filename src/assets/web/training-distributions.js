/* eslint-disable */
/*
 * Client-side logic for the Hold-rate by distance, time, and regime
 * dashboard. Reads its bootstrap data from a sibling
 * <script type="application/json" id="training-payload"> tag; everything
 * else (slices, chart tokens, color schemes, thresholds) flows from there
 * so this file can stay static and be reused across rebuilds.
 */
(function () {
  const payloadEl = document.getElementById("training-payload");
  if (!payloadEl) {
    console.error("training-distributions: no #training-payload script tag found");
    return;
  }
  const payload = JSON.parse(payloadEl.textContent);
  const slices = payload.slices;
  const chartTokens = payload.chartTokens;
  const survivalRemainingOrder = payload.survivalRemainingOrder;
  const survivalRemainingColors = payload.survivalRemainingColors;
  const regimeCellMinSamples = payload.regimeCellMinSamples;
  const minActionableDistanceBp = payload.minActionableDistanceBp;
  const survivalXAxisPadBp = payload.survivalXAxisPadBp;
  const liveTradingAlgoIds = payload.liveTradingAlgoIds;
  const leadingRegimeMinLeadPp = payload.leadingRegimeMinLeadPp;
  const filterColors = payload.filterColors;
  const deltaColors = payload.deltaColors;

  // Auto-fit the y-axis to actual data range, clamped to [0, 100] for
  // the % charts. The hard-coded [0, 100] was wasting most of the
  // chart's vertical real estate because survival rates rarely touch
  // either extreme — cropping to (min - pad, max + pad) makes the
  // mid-section actually readable. Pads are floored so charts with a
  // tight range still get some breathing room.
  function autoFitPercentYRange({ yArrays, includeReferenceFifty }) {
    let lo = Infinity;
    let hi = -Infinity;
    for (const ys of yArrays) {
      for (const v of ys) {
        if (v == null || !Number.isFinite(v)) continue;
        if (v < lo) lo = v;
        if (v > hi) hi = v;
      }
    }
    if (!Number.isFinite(lo) || !Number.isFinite(hi)) return [0, 100];
    // Keep the 50% reference visible when it's near (or just outside)
    // the data range, so the chart can show the coin-flip line for
    // intuition; skip when the data is way above 50% to stop wasting
    // height showing the line in isolation.
    if (includeReferenceFifty && lo > 50 && lo - 50 < 10) lo = 50;
    const span = Math.max(5, hi - lo);
    const pad = Math.max(2, span * 0.08);
    return [Math.max(0, lo - pad), Math.min(100, hi + pad)];
  }

  // Largest distance bucket index where any of the given y arrays still
  // has a (finite) value. Returns the matching bp + a small pad so the
  // rightmost line stays a few bp away from the axis. Falls back to
  // the original axis cap if no point qualifies — keeps the chart
  // sane on empty data.
  function autoFitMaxBp({ xs, yArrays }) {
    let maxIdx = -1;
    for (const ys of yArrays) {
      for (let i = ys.length - 1; i > maxIdx; i--) {
        const v = ys[i];
        if (v != null && Number.isFinite(v)) {
          maxIdx = i;
          break;
        }
      }
    }
    if (maxIdx < 0) {
      return xs[xs.length - 1] != null ? xs[xs.length - 1] : 1;
    }
    const lastBp = xs[maxIdx] != null ? xs[maxIdx] : maxIdx;
    const padded = lastBp + survivalXAxisPadBp;
    const cap = xs[xs.length - 1] != null ? xs[xs.length - 1] + 1 : padded;
    return Math.min(padded, cap);
  }

  const tabsEl = document.getElementById("tabs");
  const titleEl = document.getElementById("asset-title");
  const metaEl = document.getElementById("asset-meta");
  const countEl = document.getElementById("asset-count");

  const survivalSectionEl = document.getElementById("survival-section");
  const survivalMetaEl = document.getElementById("survival-meta");
  const survivalChartHost = document.getElementById("survival-chart");
  const survivalTooltipEl = document.getElementById("survival-tooltip");
  const survivalChartFrame = survivalChartHost.parentElement;
  let survivalChart = null;

  // ----------------------------------------------------------------
  // Survival section: a second chart + table inside the same panel.
  // The chart shows current-side hold rate as a function of distance
  // from the 5m line, one series per remaining-minutes bucket. The
  // table inverts the question: how much distance does each remaining
  // bucket need to historically reach a given hold-rate target?
  // ----------------------------------------------------------------

  const formatBp = (v) => {
    if (v == null || !Number.isFinite(v)) return "—";
    return Math.round(v).toLocaleString() + " bp";
  };

  function survivalChartHostError(msg) {
    survivalChartHost.innerHTML = '<pre class="chart-error">' + msg + '</pre>';
  }

  function renderSurvivalEmpty(message) {
    if (survivalChart) { survivalChart.destroy(); survivalChart = null; }
    survivalChartHost.innerHTML = '<div class="chart-loading">' + message + '</div>';
    if (survivalMetaEl) survivalMetaEl.textContent = "";
  }

  function renderSurvivalChart(survival) {
    if (survivalChart) { survivalChart.destroy(); survivalChart = null; }
    survivalChartHost.innerHTML = "";
    if (typeof uPlot === "undefined") {
      survivalChartHostError("uPlot global is undefined — CDN failed to load?");
      return;
    }
    const w = survivalChartHost.clientWidth || survivalChartHost.getBoundingClientRect().width || 800;
    const h = survivalChartHost.clientHeight || 380;
    if (w === 0 || h === 0) {
      survivalChartHostError("chart host has zero size: " + w + "x" + h);
      return;
    }
    // Shared x-axis is every integer bp across the display range; each
    // remaining-minutes series is a parallel y array (null for sparse
    // buckets, which uPlot draws as gaps).
    const xs = survival.distancesBp.slice();
    const yArrays = survivalRemainingOrder.map(
      (rem) => survival.byRemaining[rem].winRate.slice(),
    );
    const sampleArrays = survivalRemainingOrder.map(
      (rem) => survival.byRemaining[rem].sampleCount.slice(),
    );
    // Auto-fit the x-axis to where data actually ends. The fixed-cap
    // version left a ton of empty space on the right when even the
    // longest line died out at ~30 bp.
    const xMax = autoFitMaxBp({ xs: xs, yArrays: yArrays });
    const data = [xs].concat(yArrays);
    const series = [{}].concat(
      survivalRemainingOrder.map((rem) => ({
        label: rem + "m left",
        stroke: survivalRemainingColors[rem],
        width: 2,
        spanGaps: false,
        points: { show: false },
      })),
    );
    const updateTooltip = (u) => {
      const idx = u.cursor.idx;
      if (idx == null || idx < 0 || idx >= xs.length) {
        survivalTooltipEl.classList.remove("visible");
        return;
      }
      const x = xs[idx];
      let rows = '';
      for (let i = 0; i < survivalRemainingOrder.length; i++) {
        const rem = survivalRemainingOrder[i];
        const wr = yArrays[i][idx];
        const n = sampleArrays[i][idx];
        const value = wr == null
          ? '<span class="value" style="color: var(--alea-text-subtle)">n=' + n.toLocaleString() + '</span>'
          : '<span class="value">' + wr.toFixed(1) + '% <span style="color: var(--alea-text-subtle); font-weight: 400; margin-left: 6px">n=' + n.toLocaleString() + '</span></span>';
        rows +=
          '<div class="alea-tooltip-row"><span class="alea-legend-swatch" style="background:' + survivalRemainingColors[rem] + '"></span><span class="name">' + rem + 'm left</span>' + value + '</div>';
      }
      survivalTooltipEl.innerHTML =
        '<div class="alea-tooltip-head">' + formatBp(x) + ' from line</div>' + rows;
      const cursorLeft = u.cursor.left;
      const frameW = survivalChartFrame.getBoundingClientRect().width;
      const tooltipW = survivalTooltipEl.offsetWidth || 240;
      const margin = 14;
      const placeRight = cursorLeft + margin + tooltipW <= frameW;
      const left = placeRight ? cursorLeft + margin : cursorLeft - margin - tooltipW;
      survivalTooltipEl.style.left = Math.max(margin, Math.min(left, frameW - tooltipW - margin)) + "px";
      survivalTooltipEl.style.top = "14px";
      survivalTooltipEl.classList.add("visible");
    };
    const opts = {
      width: w,
      height: h,
      legend: { show: false },
      padding: [16, 18, 8, 8],
      scales: (() => {
        const yRange = autoFitPercentYRange({
          yArrays: yArrays,
          includeReferenceFifty: true,
        });
        return {
          x: { time: false, range: [0, xMax] },
          y: { range: yRange },
        };
      })(),
      cursor: {
        points: { show: false },
        drag: { setScale: false, x: false, y: false },
      },
      series: series,
      axes: [
        {
          stroke: chartTokens.axisStroke,
          font: chartTokens.axisFont,
          labelFont: chartTokens.axisFont,
          label: "distance from price line (bp)",
          labelSize: 28,
          grid: { stroke: chartTokens.gridStroke, width: 1 },
          ticks: { stroke: chartTokens.axisTickStroke, width: 1, size: 5 },
          values: (u, splits) => splits.map((v) => Math.round(v).toLocaleString()),
        },
        {
          stroke: chartTokens.axisStroke,
          font: chartTokens.axisFont,
          labelFont: chartTokens.axisFont,
          label: "hold rate %",
          labelSize: 28,
          grid: { stroke: chartTokens.gridStroke, width: 1 },
          ticks: { stroke: chartTokens.axisTickStroke, width: 1, size: 5 },
          values: (u, splits) => splits.map((v) => Math.round(v) + "%"),
          size: 60,
        },
      ],
      hooks: {
        setCursor: [updateTooltip],
        // Faint horizontal reference at 50% (coin-flip baseline). Drawn
        // behind the curves via drawAxes, same pattern as the body/wick
        // chart's p50 line.
        drawAxes: [
          (u) => {
            const yPos = u.valToPos(50, "y", true);
            const ctx = u.ctx;
            ctx.save();
            ctx.strokeStyle = chartTokens.referenceLine;
            ctx.lineWidth = 1;
            ctx.setLineDash([4, 4]);
            ctx.beginPath();
            ctx.moveTo(u.bbox.left, yPos);
            ctx.lineTo(u.bbox.left + u.bbox.width, yPos);
            ctx.stroke();
            ctx.restore();
          },
        ],
      },
    };
    try {
      survivalChart = new uPlot(opts, data, survivalChartHost);
      survivalChartHost.addEventListener("mouseleave", () => survivalTooltipEl.classList.remove("visible"));
    } catch (err) {
      survivalChartHostError("uPlot threw: " + (err && err.message ? err.message : String(err)));
    }
  }

  function renderSurvival(slice) {
    const survival = slice.survival;
    if (!survival) {
      renderSurvivalEmpty("No 1m candle data yet for " + slice.assetUpper + ".");
      return;
    }
    if (survivalMetaEl) {
      survivalMetaEl.textContent = "";
    }
    renderSurvivalChart(survival);
  }

  // ----------------------------------------------------------------
  // Filter sections: one per binary filter. Each section renders a
  // single full-size chart at one remaining-minutes bucket, with a
  // tab row above it for switching buckets. The default tab is the
  // bucket where the filter most strongly tightens the point of no
  // return. Tab badges show the per-bucket best improvement so the
  // operator sees at a glance where the filter helps before clicking.
  // ----------------------------------------------------------------

  const filterSectionsHost = document.getElementById("filter-sections-host");
  // Track every filter-chart uPlot instance so the ResizeObserver and
  // window resize handler can poke them all when the viewport changes.
  // Each entry also carries the filter slice + currently-selected
  // remaining-minutes bucket so the tab click handler can replace the
  // chart in place.
  const filterCharts = [];

  function clearFilterSections() {
    for (const entry of filterCharts) {
      try { entry.chart.destroy(); } catch (e) { /* ignore */ }
    }
    filterCharts.length = 0;
    if (filterSectionsHost) filterSectionsHost.innerHTML = "";
  }

  function formatPercent(v) {
    if (v == null || !Number.isFinite(v)) return "—";
    const pct = v * 100;
    return pct < 10 ? pct.toFixed(1) + "%" : Math.round(pct) + "%";
  }

  // Calibration score formatter. The raw value is "average nats
  // saved per population-snapshot vs no-filter baseline." For the
  // headline display we render it as a percentage of baseline
  // log-loss (~ln 2 ≈ 0.693 nats for a binary outcome): a 0.005
  // raw score → 0.7%. That gives the operator an immediately
  // interpretable scale ("how much better than nothing"). The raw
  // value is in the tooltip for sorting precision.
  var BASELINE_LOG_LOSS_NATS = 0.6931471805599453;

  // Headline pair: side-by-side "pop X% / sweet Y% [a-b bp]" so the
  // operator sees the two key calibration numbers at the same level
  // of visual prominence. The sweet-spot column carries the bp range
  // as its sublabel since that's what live trading would gate on; the
  // pop column carries the "vs no-filter" caption since pop is the
  // population-wide average.
  function formatHeadlinePair(summary) {
    const popScore = summary.calibrationScore;
    const popPct = (popScore === null || popScore === undefined ||
      !Number.isFinite(popScore))
      ? null
      : (popScore / BASELINE_LOG_LOSS_NATS) * 100;
    const popClass = (popPct === null || popPct < 0.05)
      ? 'filter-summary-headline pop faint'
      : 'filter-summary-headline pop';
    const popValueText = popPct === null ? '—' : popPct.toFixed(2) + '%';
    const popTooltip = popPct === null
      ? 'No comparable buckets.'
      : 'Population calibration: ' + popScore.toFixed(6) +
        ' nats/snapshot vs no-filter (' + popPct.toFixed(2) + '% of baseline log-loss). Whole-data average.';

    const ss = summary.sweetSpot;
    let sweetCellHtml;
    if (ss === null || ss === undefined) {
      sweetCellHtml =
        '<div class="filter-summary-headline sweet faint" title="No positive info gain — filter has no actionable bp range.">' +
          '<span class="headline-value">—</span>' +
          '<span class="headline-label">no sweet spot</span>' +
        '</div>';
    } else {
      const sweetPct = (ss.calibrationScore / BASELINE_LOG_LOSS_NATS) * 100;
      const sweetTooltip = (
        'Sweet-spot calibration: ' + sweetPct.toFixed(2) +
        '% on snapshots in [' + ss.startBp + '–' + ss.endBp + '] bp ' +
        '(coverage = ' + (ss.coverageFraction * 100).toFixed(1) + '%). ' +
        'This is the range the live trader acts on for this filter.'
      );
      sweetCellHtml =
        '<div class="filter-summary-headline sweet" title="' + sweetTooltip + '">' +
          '<span class="headline-value">' + sweetPct.toFixed(2) + '%</span>' +
          '<span class="headline-label">sweet [' + ss.startBp + '–' + ss.endBp + ' bp]</span>' +
        '</div>';
    }

    return (
      '<div class="filter-summary-headlines">' +
        '<div class="' + popClass + '" title="' + popTooltip + '">' +
          '<span class="headline-value">' + popValueText + '</span>' +
          '<span class="headline-label">pop</span>' +
        '</div>' +
        '<div class="headline-divider"></div>' +
        sweetCellHtml +
      '</div>'
    );
  }

  // Per-(remaining, half) detail metrics. Two side-by-side cards,
  // one per half. Each card has the half label as a heading with a
  // signed-score headline (since the two halves are sign-opposed by
  // construction at any given remaining), and an aligned label/value
  // grid below for the diagnostic metrics.
  function formatCellGridRow(label, value, klass) {
    const valClass = 'cell-grid-value' + (klass ? ' ' + klass : '');
    const valHtml = (value === null || value === undefined)
      ? '<span class="cell-grid-value cell-grid-value-faint">—</span>'
      : '<span class="' + valClass + '">' + value + '</span>';
    return (
      '<span class="cell-grid-label">' + label + '</span>' +
      valHtml
    );
  }
  function formatCellHalfCard(score, halfLabel) {
    if (!score || score.coverageBp === 0) {
      return (
        '<div class="cell-half">' +
          '<div class="cell-half-header">' +
            '<span class="cell-half-name">' + halfLabel + '</span>' +
            '<span class="cell-half-headline cell-half-headline-faint">—</span>' +
          '</div>' +
          '<div class="cell-half-empty">no comparable buckets</div>' +
        '</div>'
      );
    }
    const headlineClass = score.score >= 0
      ? 'cell-half-headline-good'
      : 'cell-half-headline-bad';
    const headlineSign = score.score >= 0 ? '+' : '−';
    const headlineText = headlineSign + Math.abs(score.score).toFixed(1);
    const meanFmt = score.meanDeltaPp === null
      ? null
      : (score.meanDeltaPp >= 0 ? '+' : '−') +
        Math.abs(score.meanDeltaPp).toFixed(2) + ' pp';
    const meanKlass = score.meanDeltaPp === null
      ? null
      : (score.meanDeltaPp >= 0 ? 'cell-grid-value-good' : 'cell-grid-value-bad');
    const sharpeFmt = score.sharpe === null ? null : score.sharpe.toFixed(2);
    const sharpeKlass = score.sharpe === null
      ? null
      : (score.sharpe >= 0 ? 'cell-grid-value-good' : 'cell-grid-value-bad');
    const logLossFmt = score.logLossImprovementNats === null
      ? null
      : score.logLossImprovementNats.toFixed(5);
    return (
      '<div class="cell-half">' +
        '<div class="cell-half-header">' +
          '<span class="cell-half-name">' + halfLabel + '</span>' +
          '<span class="cell-half-headline ' + headlineClass + '">' + headlineText + '</span>' +
        '</div>' +
        '<div class="cell-grid">' +
          formatCellGridRow('mean Δ', meanFmt, meanKlass) +
          formatCellGridRow('sharpe', sharpeFmt, sharpeKlass) +
          formatCellGridRow('logLoss', logLossFmt) +
          formatCellGridRow('coverage', score.coverageBp + ' bp') +
        '</div>' +
      '</div>'
    );
  }
  function formatCellMetrics(args) {
    const filter = args.filter;
    const remaining = args.remaining;
    const cell = filter.summary.scoresByRemaining[remaining];
    if (!cell) return '';
    return (
      formatCellHalfCard(cell.true, filter.trueLabel) +
      formatCellHalfCard(cell.false, filter.falseLabel)
    );
  }

  // Tab badges show this rem's calibration contribution in % terms.
  // Same metric and same sign-based color as the per-rem header
  // pills, so the operator can scan one consistent number across
  // both surfaces.
  function formatTabBadge(filterSummary, rem) {
    const remScore = filterSummary.calibrationScoreByRemaining[rem];
    if (remScore === null || remScore === undefined || !Number.isFinite(remScore)) {
      return "";
    }
    const pct = (remScore / BASELINE_LOG_LOSS_NATS) * 100;
    const klass = pct === 0
      ? ''
      : (pct > 0 ? 'filter-tab-delta-good' : 'filter-tab-delta-bad');
    return ' <span class="filter-tab-delta ' + klass + '">' + pct.toFixed(2) + '%</span>';
  }

  function buildFilterChart({ host, filter, remaining }) {
    if (typeof uPlot === "undefined") {
      host.innerHTML = '<pre class="chart-error">uPlot global is undefined — CDN failed to load?</pre>';
      return null;
    }
    const w = host.clientWidth || host.getBoundingClientRect().width || 800;
    const h = host.clientHeight || 380;
    if (w === 0 || h === 0) {
      host.innerHTML = '<pre class="chart-error">chart host has zero size: ' + w + 'x' + h + '</pre>';
      return null;
    }
    const xs = filter.distancesBp.slice();
    const baselineY = filter.baseline[remaining].winRate.slice();
    const trueY = filter.whenTrue[remaining].winRate.slice();
    const falseY = filter.whenFalse[remaining].winRate.slice();
    const xMax = autoFitMaxBp({ xs: xs, yArrays: [baselineY, trueY, falseY] });
    const data = [xs, baselineY, trueY, falseY];
    const opts = {
      width: w,
      height: h,
      legend: { show: false },
      padding: [16, 18, 8, 8],
      scales: {
        x: { time: false, range: [0, xMax] },
        y: {
          range: autoFitPercentYRange({
            yArrays: [baselineY, trueY, falseY],
            includeReferenceFifty: true,
          }),
        },
      },
      cursor: { points: { show: false }, drag: { setScale: false, x: false, y: false } },
      series: [
        {},
        { label: "baseline", stroke: filterColors.baseline, width: 1.5, spanGaps: false, points: { show: false } },
        { label: filter.trueLabel, stroke: filterColors.whenTrue, width: 2.25, spanGaps: false, points: { show: false } },
        { label: filter.falseLabel, stroke: filterColors.whenFalse, width: 2.25, spanGaps: false, points: { show: false } },
      ],
      axes: [
        {
          stroke: chartTokens.axisStroke,
          font: chartTokens.axisFont,
          labelFont: chartTokens.axisFont,
          label: "distance from price line (bp)",
          labelSize: 28,
          grid: { stroke: chartTokens.gridStroke, width: 1 },
          ticks: { stroke: chartTokens.axisTickStroke, width: 1, size: 5 },
          values: (u, splits) => splits.map((v) => Math.round(v).toLocaleString()),
        },
        {
          stroke: chartTokens.axisStroke,
          font: chartTokens.axisFont,
          labelFont: chartTokens.axisFont,
          label: "hold rate %",
          labelSize: 28,
          grid: { stroke: chartTokens.gridStroke, width: 1 },
          ticks: { stroke: chartTokens.axisTickStroke, width: 1, size: 5 },
          values: (u, splits) => splits.map((v) => Math.round(v) + '%'),
          size: 60,
        },
      ],
      hooks: {
        drawAxes: [
          (u) => {
            const yPos = u.valToPos(50, "y", true);
            const ctx = u.ctx;
            ctx.save();
            ctx.strokeStyle = chartTokens.referenceLine;
            ctx.lineWidth = 1;
            ctx.setLineDash([4, 4]);
            ctx.beginPath();
            ctx.moveTo(u.bbox.left, yPos);
            ctx.lineTo(u.bbox.left + u.bbox.width, yPos);
            ctx.stroke();
            ctx.restore();
          },
        ],
      },
    };
    try {
      return new uPlot(opts, data, host);
    } catch (err) {
      host.innerHTML = '<pre class="chart-error">uPlot threw: ' + (err && err.message ? err.message : String(err)) + '</pre>';
      return null;
    }
  }

  // ----------------------------------------------------------------
  // Delta chart: same x-axis as the main chart but the y-axis is
  // (filter_winRate − baseline_winRate) in pp. Two lines (true/false)
  // — no baseline line drawn (baseline = the y=0 axis). Per-slice
  // density fills under each line, green where the slice is above
  // baseline and red where below; opacity scales with the bucket's
  // sample count so sparse slices look faint and trustworthy ones
  // look bold.
  // ----------------------------------------------------------------

  // Build the per-line "(filter delta in pp, sample count)" arrays for
  // a given remaining-minutes bucket. A delta value is null when
  // either side (filter half or baseline) lacks a usable bucket at
  // that bp.
  function buildDeltaLine({ filter, half, remaining }) {
    const baselineEntry = filter.baseline[remaining];
    const halfEntry = filter[half === "true" ? "whenTrue" : "whenFalse"][remaining];
    const xs = filter.distancesBp;
    const deltas = [];
    const counts = [];
    for (let i = 0; i < xs.length; i++) {
      const baseV = baselineEntry.winRate[i];
      const halfV = halfEntry.winRate[i];
      if (baseV == null || halfV == null) {
        deltas.push(null);
      } else {
        deltas.push(halfV - baseV);
      }
      counts.push(halfEntry.sampleCount[i] || 0);
    }
    return { deltas: deltas, counts: counts };
  }

  function buildDeltaChart({ host, filter, remaining }) {
    if (typeof uPlot === "undefined") {
      host.innerHTML = '<pre class="chart-error">uPlot global is undefined</pre>';
      return null;
    }
    const w = host.clientWidth || host.getBoundingClientRect().width || 800;
    const h = host.clientHeight || 260;
    if (w === 0 || h === 0) {
      host.innerHTML = '<pre class="chart-error">chart host has zero size: ' + w + 'x' + h + '</pre>';
      return null;
    }
    const xs = filter.distancesBp.slice();
    const trueLine = buildDeltaLine({ filter: filter, half: "true", remaining: remaining });
    const falseLine = buildDeltaLine({ filter: filter, half: "false", remaining: remaining });
    const xMax = autoFitMaxBp({ xs: xs, yArrays: [trueLine.deltas, falseLine.deltas] });

    // Y-axis bounds: symmetric around 0 with a small pad. We don't
    // want it to drift to wildly asymmetric ranges that visually
    // distort which side is bigger.
    let extreme = 0;
    for (const a of [trueLine.deltas, falseLine.deltas]) {
      for (const v of a) {
        if (v != null && Number.isFinite(v) && Math.abs(v) > extreme) {
          extreme = Math.abs(v);
        }
      }
    }
    const yPad = Math.max(2, extreme * 0.15);
    const yMax = extreme === 0 ? 5 : extreme + yPad;

    // Densest slice across both halves; per-slice opacity is
    // count / maxCount, with a small floor so non-empty slices remain
    // visible.
    let maxCount = 0;
    for (const a of [trueLine.counts, falseLine.counts]) {
      for (const v of a) {
        if (v > maxCount) maxCount = v;
      }
    }
    const fillOpacityFor = (count) => {
      if (maxCount === 0 || count === 0) return 0;
      const ratio = count / maxCount;
      // Floor + cap tuned upward from the original (0.06–0.55) since
      // the dark green panel background was washing out faint slices.
      // Floor at 0.18 so even a barely-above-floor slice has visible
      // tint; cap at 0.85 so dense slices read as solid color without
      // completely hiding the line on top.
      return Math.max(0.18, Math.min(0.85, ratio * 0.85));
    };

    // Draw a per-bin trapezoid from the line down to y=0, colored by
    // the average sign of the bin's two endpoints, with opacity from
    // the bin's average sample count. Done in a uPlot draw hook so
    // we can do per-slice opacity (uPlot's built-in fill is uniform).
    const drawDensityFill = (u, deltas, counts) => {
      const ctx = u.ctx;
      const yZeroPx = u.valToPos(0, "y", true);
      for (let i = 0; i < xs.length - 1; i++) {
        const v0 = deltas[i];
        const v1 = deltas[i + 1];
        if (v0 == null || v1 == null) continue;
        const c0 = counts[i] || 0;
        const c1 = counts[i + 1] || 0;
        const avgCount = (c0 + c1) / 2;
        const opacity = fillOpacityFor(avgCount);
        if (opacity <= 0) continue;
        const x0Px = u.valToPos(xs[i], "x", true);
        const x1Px = u.valToPos(xs[i + 1], "x", true);
        const y0Px = u.valToPos(v0, "y", true);
        const y1Px = u.valToPos(v1, "y", true);
        // Color decision: average sign of v0 and v1. If both above 0,
        // green. Both below, red. Crossing zero, split into two
        // sub-trapezoids at the zero crossing.
        const drawTrap = (xa, ya, xb, yb, color) => {
          ctx.fillStyle = 'rgba(' + color.r + ',' + color.g + ',' + color.b + ',' + opacity + ')';
          ctx.beginPath();
          ctx.moveTo(xa, yZeroPx);
          ctx.lineTo(xa, ya);
          ctx.lineTo(xb, yb);
          ctx.lineTo(xb, yZeroPx);
          ctx.closePath();
          ctx.fill();
        };
        const sameSign = (v0 >= 0 && v1 >= 0) || (v0 <= 0 && v1 <= 0);
        if (sameSign) {
          const color = (v0 + v1) / 2 >= 0 ? deltaColors.fillAbove : deltaColors.fillBelow;
          drawTrap(x0Px, y0Px, x1Px, y1Px, color);
        } else {
          // Find the zero crossing's x position via linear interp.
          const t = v0 / (v0 - v1);
          const xCrossVal = xs[i] + t * (xs[i + 1] - xs[i]);
          const xCrossPx = u.valToPos(xCrossVal, "x", true);
          const firstColor = v0 >= 0 ? deltaColors.fillAbove : deltaColors.fillBelow;
          const secondColor = v1 >= 0 ? deltaColors.fillAbove : deltaColors.fillBelow;
          drawTrap(x0Px, y0Px, xCrossPx, yZeroPx, firstColor);
          drawTrap(xCrossPx, yZeroPx, x1Px, y1Px, secondColor);
        }
      }
    };

    const data = [xs, trueLine.deltas.slice(), falseLine.deltas.slice()];
    const opts = {
      width: w,
      height: h,
      legend: { show: false },
      padding: [12, 18, 8, 8],
      scales: { x: { time: false, range: [0, xMax] }, y: { range: [-yMax, yMax] } },
      cursor: { points: { show: false }, drag: { setScale: false, x: false, y: false } },
      series: [
        {},
        { label: filter.trueLabel, stroke: deltaColors.trueLine, width: 2, spanGaps: false, points: { show: false } },
        { label: filter.falseLabel, stroke: deltaColors.falseLine, width: 2, spanGaps: false, points: { show: false } },
      ],
      axes: [
        {
          stroke: chartTokens.axisStroke,
          font: chartTokens.axisFont,
          labelFont: chartTokens.axisFont,
          label: "distance from price line (bp)",
          labelSize: 28,
          grid: { stroke: chartTokens.gridStroke, width: 1 },
          ticks: { stroke: chartTokens.axisTickStroke, width: 1, size: 5 },
          values: (u, splits) => splits.map((v) => Math.round(v).toLocaleString()),
        },
        {
          stroke: chartTokens.axisStroke,
          font: chartTokens.axisFont,
          labelFont: chartTokens.axisFont,
          label: "vs baseline (Δ%)",
          labelSize: 28,
          grid: { stroke: chartTokens.gridStroke, width: 1 },
          ticks: { stroke: chartTokens.axisTickStroke, width: 1, size: 5 },
          values: (u, splits) => splits.map((v) => (v > 0 ? "+" : "") + Math.round(v)),
          size: 60,
        },
      ],
      hooks: {
        // Density fills first (under the lines), then the zero rule,
        // then uPlot draws the line strokes on top.
        drawClear: [
          (u) => {
            drawDensityFill(u, trueLine.deltas, trueLine.counts);
            drawDensityFill(u, falseLine.deltas, falseLine.counts);
          },
        ],
        drawAxes: [
          (u) => {
            const yPos = u.valToPos(0, "y", true);
            const ctx = u.ctx;
            ctx.save();
            ctx.strokeStyle = deltaColors.zeroRule;
            ctx.lineWidth = 1;
            ctx.setLineDash([4, 4]);
            ctx.beginPath();
            ctx.moveTo(u.bbox.left, yPos);
            ctx.lineTo(u.bbox.left + u.bbox.width, yPos);
            ctx.stroke();
            ctx.restore();
          },
        ],
      },
    };
    try {
      return new uPlot(opts, data, host);
    } catch (err) {
      host.innerHTML = '<pre class="chart-error">uPlot threw: ' + (err && err.message ? err.message : String(err)) + '</pre>';
      return null;
    }
  }

  function renderFilterSection(filter, expanded) {
    const summary = filter.summary;
    const legendHtml =
      '<span class="alea-legend-item"><span class="alea-legend-swatch" style="background:' + filterColors.baseline + '"></span>baseline</span>' +
      '<span class="alea-legend-item"><span class="alea-legend-swatch" style="background:' + filterColors.whenTrue + '"></span>' + filter.trueLabel + '</span>' +
      '<span class="alea-legend-item"><span class="alea-legend-swatch" style="background:' + filterColors.whenFalse + '"></span>' + filter.falseLabel + '</span>';

    // Tabs render in fixed 4m → 1m order so the operator can compare
    // the same column across filters at a glance. The strongest
    // signal still gets the default-selected highlight (via
    // filter.defaultRemaining), but the order itself stays put.
    const tabsHtml = survivalRemainingOrder.map((rem) => {
      const isActive = rem === filter.defaultRemaining;
      const badge = formatTabBadge(summary, rem);
      return (
        '<button type="button" class="filter-tab' + (isActive ? ' active' : '') +
        '" data-filter-id="' + filter.id + '" data-remaining="' + rem + '">' +
        rem + 'm left' + badge + '</button>'
      );
    }).join("");
    // Per-rem pills shown in the section header — each rem's
    // contribution to the headline calibration score in % terms.
    // Same 4m → 1m order as the tabs and chart legend. Visible in
    // both collapsed and expanded states so the header layout
    // doesn't shift when toggled.
    const summaryScoresHtml = survivalRemainingOrder.map((rem) => {
      const remScore = filter.summary.calibrationScoreByRemaining[rem];
      const remPct = (typeof remScore === 'number' && Number.isFinite(remScore))
        ? (remScore / BASELINE_LOG_LOSS_NATS) * 100
        : null;
      // Sign-based color: green for positive, red for negative.
      // calibrationScoreByRemaining is non-negative by construction
      // (per-bucket halfRate is the MLE on its own snapshots, so it
      // can't underperform the global rate in expectation), but we
      // honour the sign rule generically in case a future metric
      // change exposes signed values here.
      const valueClass = remPct === null || remPct === 0
        ? ''
        : (remPct > 0 ? ' score-value-good' : ' score-value-bad');
      const valueText = remPct === null ? '—' : remPct.toFixed(2) + '%';
      const tooltip = remPct === null
        ? 'No comparable buckets at this remaining.'
        : (rem + 'm contributes ' + remPct.toFixed(3) +
           '% of the headline calibration score.');
      return (
        '<span class="filter-summary-score" title="' + tooltip + '">' +
          '<span class="score-rem">' + rem + 'm</span>' +
          '<span class="score-value' + valueClass + '">' + valueText + '</span>' +
        '</span>'
      );
    }).join("");

    // <details> defaults to collapsed; the top-ranked filter for
    // the asset is rendered with the open attribute so its chart is
    // visible without a click. Charts are NOT built here — they're
    // lazy-built on first expand by the toggle listener so we don't
    // render uPlot into a 0-size host.
    const openAttr = expanded ? ' open' : '';
    const chevronText = expanded ? 'collapse ▴' : 'expand ▾';
    const headlinesHtml = formatHeadlinePair(summary);
    const liveBadgeHtml = liveTradingAlgoIds.indexOf(filter.id) >= 0
      ? '<span class="filter-summary-live" title="This is the filter the live trader currently uses (see computeAssetProbabilities.ts)">LIVE</span>'
      : '';
    const cellMetricsHtml = formatCellMetrics({
      filter: filter,
      remaining: filter.defaultRemaining,
    });
    const sectionHtml =
      '<details class="filter-section" data-filter-id="' + filter.id + '"' + openAttr + '>' +
        '<summary>' +
          '<h2 class="filter-summary-title">' + filter.displayName + liveBadgeHtml + '</h2>' +
          headlinesHtml +
          '<div class="filter-summary-scores">' + summaryScoresHtml + '</div>' +
          '<span class="filter-summary-chevron">' + chevronText + '</span>' +
        '</summary>' +
        '<div class="filter-section-body">' +
          '<p class="survival-helper">' + filter.description + '</p>' +
          '<div class="filter-tabs" role="tablist">' + tabsHtml + '</div>' +
          '<div class="filter-cell-metrics" data-filter-id="' + filter.id + '">' + cellMetricsHtml + '</div>' +
          '<div class="alea-legend">' + legendHtml + '</div>' +
          '<div class="chart-frame">' +
            '<div class="chart-host filter-chart-host" data-filter-id="' + filter.id + '"></div>' +
          '</div>' +
          '<div class="filter-delta-frame">' +
            '<div class="filter-delta-host" data-filter-id="' + filter.id + '"></div>' +
          '</div>' +
        '</div>' +
      '</details>';
    if (!filterSectionsHost) return;
    filterSectionsHost.insertAdjacentHTML('beforeend', sectionHtml);
    const detailsEl = filterSectionsHost.querySelector('details.filter-section[data-filter-id="' + filter.id + '"]');
    if (!detailsEl) return;
    // Lazy chart construction: only when first opened. Subsequent
    // tab clicks update the existing charts; subsequent open/close
    // doesn't rebuild anything. We also trigger this immediately
    // for sections rendered with the open attribute (the auto-
    // expanded top filter), since the open attribute on details
    // does not fire a toggle event on initial mount.
    const buildIfNeeded = () => {
      if (!detailsEl.open || detailsEl.dataset.built === '1') return;
      detailsEl.dataset.built = '1';
      const chevron = detailsEl.querySelector('.filter-summary-chevron');
      if (chevron) chevron.textContent = 'collapse ▴';
      const host = detailsEl.querySelector('.filter-chart-host');
      const deltaHost = detailsEl.querySelector('.filter-delta-host');
      if (!host || !deltaHost) return;
      const chart = buildFilterChart({ host: host, filter: filter, remaining: filter.defaultRemaining });
      const deltaChart = buildDeltaChart({ host: deltaHost, filter: filter, remaining: filter.defaultRemaining });
      if (chart) {
        filterCharts.push({
          chart: chart,
          deltaChart: deltaChart,
          host: host,
          deltaHost: deltaHost,
          filter: filter,
          remaining: filter.defaultRemaining,
        });
      }
    };
    detailsEl.addEventListener('toggle', buildIfNeeded);
    if (expanded) {
      buildIfNeeded();
    }
    // Update chevron text when the user collapses again.
    detailsEl.addEventListener('toggle', () => {
      const chevron = detailsEl.querySelector('.filter-summary-chevron');
      if (chevron) chevron.textContent = detailsEl.open ? 'collapse ▴' : 'expand ▾';
    });
    // Allow text selection on the title without toggling the section.
    // We listen on the summary's click and suppress the default
    // toggle whenever the user is mid-drag on the title, so a click-
    // and-drag inside the title selects text instead of opening or
    // closing the section. A bare click anywhere else on the summary
    // (including the title without a drag) still toggles.
    const summaryEl = detailsEl.querySelector('summary');
    const titleEl = detailsEl.querySelector('.filter-summary-title');
    if (summaryEl && titleEl) {
      let titleMousedownAt = null;
      titleEl.addEventListener('mousedown', (e) => {
        titleMousedownAt = { x: e.clientX, y: e.clientY };
      });
      summaryEl.addEventListener('click', (e) => {
        // If the user has an active selection inside the title at
        // click time, suppress the toggle. Otherwise allow it.
        const sel = window.getSelection();
        const titleHasSelection =
          sel && sel.toString().length > 0 &&
          titleEl.contains(sel.anchorNode);
        const startedOnTitle =
          titleMousedownAt !== null &&
          (e.target instanceof Node) &&
          titleEl.contains(e.target);
        const draggedAfterMousedown =
          titleMousedownAt !== null &&
          (Math.abs(e.clientX - titleMousedownAt.x) > 2 ||
            Math.abs(e.clientY - titleMousedownAt.y) > 2);
        if (titleHasSelection || (startedOnTitle && draggedAfterMousedown)) {
          e.preventDefault();
        }
        titleMousedownAt = null;
      });
    }
  }

  function setFilterRemaining({ filterId, remaining }) {
    const entryIdx = filterCharts.findIndex((e) => e.filter.id === filterId);
    if (entryIdx < 0) return;
    const entry = filterCharts[entryIdx];
    try { entry.chart.destroy(); } catch (e) { /* ignore */ }
    try { if (entry.deltaChart) entry.deltaChart.destroy(); } catch (e) { /* ignore */ }
    const newChart = buildFilterChart({ host: entry.host, filter: entry.filter, remaining: remaining });
    const newDeltaChart = buildDeltaChart({ host: entry.deltaHost, filter: entry.filter, remaining: remaining });
    if (newChart) {
      filterCharts[entryIdx] = {
        chart: newChart,
        deltaChart: newDeltaChart,
        host: entry.host,
        deltaHost: entry.deltaHost,
        filter: entry.filter,
        remaining: remaining,
      };
    }
    // Sync tab active state.
    const tabs = filterSectionsHost.querySelectorAll('.filter-tab[data-filter-id="' + filterId + '"]');
    tabs.forEach((tab) => {
      const tabRem = Number(tab.getAttribute('data-remaining'));
      tab.classList.toggle('active', tabRem === remaining);
    });
    // Sync per-cell metrics row for the new selection.
    const metricsHost = filterSectionsHost.querySelector(
      '.filter-cell-metrics[data-filter-id="' + filterId + '"]',
    );
    if (metricsHost) {
      metricsHost.innerHTML = formatCellMetrics({
        filter: entry.filter,
        remaining: remaining,
      });
    }
  }

  function renderFilters(slice) {
    clearFilterSections();
    if (!filterSectionsHost) return;
    if (!slice.filters || slice.filters.length === 0) {
      filterSectionsHost.innerHTML = '<div class="survival-empty">No filter overlays available — needs 1m candle data.</div>';
      return;
    }
    // Sort by calibration score: average nats saved per population-
    // snapshot vs the global (no-filter) baseline. Higher = more
    // useful in production. Auto-expand the top filter so the user
    // sees its chart on first paint.
    const ranked = slice.filters.slice().sort((a, b) =>
      b.summary.calibrationScore - a.summary.calibrationScore,
    );
    ranked.forEach((filter, idx) => {
      renderFilterSection(filter, idx === 0);
    });
  }

  // ----------------------------------------------------------------
  // Regime sections: one per algo per asset. Server-rendered as
  // static HTML on tab switch — the per-(regime, remaining) win-rate
  // table doesn't change interactively (no chart, no tab row), so
  // there's nothing for the client to lazy-build.
  // ----------------------------------------------------------------

  const regimeSectionsHost = document.getElementById("regime-sections-host");

  // Categorical palette for regime lines. 8 colors covers any algo we
  // currently ship (max 6 regimes). Picked for distinguishability on
  // the dark theme — one each from blue/amber/green/red families plus
  // violet/teal/orange/grey for the more granular algos.
  const REGIME_COLORS = [
    "#5b95ff", "#46c37b", "#d7aa45", "#d75a4f",
    "#a16eef", "#5fc8d8", "#f08a3c", "#9eaeb8",
  ];
  const REGIME_BASELINE_COLOR = "#cdd2c8";

  // Per-(asset, algo, remaining) chart instance tracking so the
  // ResizeObserver and tab clicks can update the right chart.
  const regimeCharts = [];

  function clearRegimeSections() {
    for (const entry of regimeCharts) {
      try { entry.chart.destroy(); } catch (e) { /* ignore */ }
    }
    regimeCharts.length = 0;
    if (regimeSectionsHost) regimeSectionsHost.innerHTML = "";
  }

  function escapeHtmlClient(s) {
    if (s == null) return '';
    return String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  // Plain-English label for one regime id. Falls through to the raw
  // id (snake_case prettified) for any regime not in the explicit
  // map. Keep the map terse — operator scans the chart legend, not
  // the explanation.
  const REGIME_LABEL_MAP = {
    low_vol: "Low vol",
    mid_vol: "Mid vol",
    high_vol: "High vol",
    vol_q1_lowest: "Q1 (lowest vol)",
    vol_q2: "Q2",
    vol_q3: "Q3",
    vol_q4_highest: "Q4 (highest vol)",
    no_trend: "No trend",
    with_trend: "With trend",
    against_trend: "Against trend",
    weak_trend: "Weak trend",
    strong_trend: "Strong trend",
    no_trend_low_vol: "No trend · low vol",
    no_trend_high_vol: "No trend · high vol",
    with_trend_low_vol: "With trend · low vol",
    with_trend_high_vol: "With trend · high vol",
    against_trend_low_vol: "Against trend · low vol",
    against_trend_high_vol: "Against trend · high vol",
    oversold: "Oversold (RSI ≤ 30)",
    neutral: "Neutral RSI",
    overbought: "Overbought (RSI ≥ 70)",
    with_carry: "With carry (matches prev bar)",
    against_carry: "Against carry (fights prev bar)",
  };
  function prettyRegime(id) {
    if (id == null) return '';
    const explicit = REGIME_LABEL_MAP[id];
    if (explicit) return explicit;
    return id.replace(/_/g, ' ');
  }

  // Map a win-rate % into a CSS background color. Centered at 50% =
  // baseline-neutral; greener as we go higher, redder as we go lower.
  // The amplitude is clamped so a 100% cell is bold green and a 0%
  // cell is bold red, with a gentle linear ramp in between.
  function winRateCellStyle(winRate) {
    if (winRate == null || !Number.isFinite(winRate)) return '';
    const t = Math.max(-1, Math.min(1, (winRate - 65) / 25));
    // Below 65 → red; above 65 → green. 65% picked because the
    // baseline curves on these assets cluster around 65–75% in the
    // sweet-spot range, so this anchors the center on what the
    // operator would consider "average."
    const alpha = Math.min(0.42, Math.abs(t) * 0.42);
    const r = t > 0 ? "70, 195, 123" : "216, 90, 79";
    return 'background: rgba(' + r + ', ' + alpha.toFixed(3) + ');';
  }

  function renderRegimeSection(algo, expanded) {
    const algoIsLiveSection = liveTradingAlgoIds.indexOf(algo.id) >= 0;
    // Count regimes whose avgLeadPp clears the leading floor — i.e.
    // the ones that make it into the live probability table for
    // this algo. The LIVE pill shows the count so the operator
    // sees at a glance how many of an algo's buckets are
    // contributing to live trading.
    const leadingCount = !algoIsLiveSection ? 0 : algo.buckets.reduce((acc, b) => {
      const v = (b.avgLeadPp == null || !Number.isFinite(b.avgLeadPp)) ? null : b.avgLeadPp;
      return v !== null && v >= leadingRegimeMinLeadPp ? acc + 1 : acc;
    }, 0);
    // Only show the LIVE pill if at least one regime from this algo
    // actually feeds the live probability table. An algo whose
    // inputs are available but whose regimes don't clear the
    // leading-pp floor is technically eligible but contributes
    // nothing — showing "0 LIVE" was confusing.
    const liveBadge = algoIsLiveSection && leadingCount > 0
      ? '<span class="regime-summary-live" title="' + leadingCount + ' regime' + (leadingCount === 1 ? '' : 's') + ' from this algo are in the live probability table.">' + leadingCount + ' LIVE</span>'
      : '';
    const bucketCount = algo.buckets.length;
    const titleHtml =
      '<span class="algo-title-name">' + escapeHtmlClient(algo.displayName) + '</span>' +
      '<span class="algo-title-buckets">[' + bucketCount + ' bucket' + (bucketCount === 1 ? '' : 's') + ']</span>';
    // Headline = max regime lead vs baseline. Single decision-aligned
    // number: how much the best regime in this algo outpaces the
    // unconditional model on average across (remaining, distance)
    // cells. + = leads, - = lags.
    const maxLead = (algo.maxLeadPp == null || !Number.isFinite(algo.maxLeadPp))
      ? null
      : algo.maxLeadPp;
    const maxLeadStr = maxLead === null
      ? '—'
      : (maxLead >= 0 ? '+' : '') + maxLead.toFixed(1) + 'pp';
    const maxLeadClass = maxLead === null
      ? 'lead-flat'
      : (maxLead > 0 ? 'lead-up' : 'lead-down');
    const headlinesHtml =
      '<span class="regime-summary-lead ' + maxLeadClass + '" title="Best regime in this algo, average pp lead over baseline across (remaining, distance) cells. + = the regime sits above baseline more often than not.">' +
        '<span class="key">max lead</span>' +
        '<span class="val">' + maxLeadStr + '</span>' +
      '</span>';
    const paramsHtml = Object.entries(algo.params || {})
      .map(([k, v]) => '<span class="param">' + escapeHtmlClient(k) + '=' + v + '</span>')
      .join('');

    // Per-regime stat row under the chart: regime name + share + avg
    // lead vs baseline. The chart shows the curves visually; this row
    // quantifies what the eye sees.
    const algoIsLive = liveTradingAlgoIds.indexOf(algo.id) >= 0;
    const regimeStatsHtml = algo.buckets.map((b, idx) => {
      const color = REGIME_COLORS[idx % REGIME_COLORS.length];
      const lead = (b.avgLeadPp == null || !Number.isFinite(b.avgLeadPp)) ? null : b.avgLeadPp;
      const leadStr = lead === null
        ? '—'
        : (lead >= 0 ? '+' : '') + lead.toFixed(1) + 'pp';
      const leadCls = lead === null ? 'lead-flat' : (lead > 0 ? 'lead-up' : 'lead-down');
      const sharePct = (b.windowShare * 100).toFixed(0) + '%';
      // Leading-regime pill: shown when (a) the algo is in
      // LIVE_TRADING_REGIME_ALGOS AND (b) this regime's avgLeadPp
      // clears LEADING_REGIME_MIN_LEAD_PP. Means the live trader's
      // probability table includes a surface for this (algo,
      // regime) pair and decisions can fire on it.
      const isLeading = algoIsLive && lead !== null && lead >= leadingRegimeMinLeadPp;
      // Always render the live-pill column so the grid stays
      // aligned even when this regime isn't leading. Empty span =
      // empty cell.
      const leadingPill = isLeading
        ? '<span class="regime-stat-leading-slot"><span class="regime-stat-leading" title="In production: probability table includes a surface for this regime — live decisions can fire on it.">live</span></span>'
        : '<span class="regime-stat-leading-slot"></span>';
      return (
        '<div class="regime-stat">' +
          '<span class="regime-swatch" style="background:' + color + '"></span>' +
          '<span class="regime-stat-name">' + escapeHtmlClient(prettyRegime(b.regime)) + '</span>' +
          '<span class="regime-stat-share">' + sharePct + '</span>' +
          '<span class="regime-stat-lead ' + leadCls + '">' + leadStr + '</span>' +
          leadingPill +
        '</div>'
      );
    }).join('');

    // Tab row for switching the chart's remaining-minutes bucket.
    // Default to 4m so every algo opens to the same column for
    // consistent cross-algo scanning.
    const defaultRemaining = 4;
    const tabsHtml = survivalRemainingOrder.map((rem) =>
      '<button type="button" class="regime-tab' +
        (rem === defaultRemaining ? ' active' : '') +
        '" data-algo-id="' + escapeHtmlClient(algo.id) +
        '" data-remaining="' + rem + '">' + rem + 'm left</button>'
    ).join('');

    const openAttr = expanded ? ' open' : '';
    const chevronGlyph = expanded ? '▴' : '▾';
    const sectionHtml =
      '<details class="regime-section" data-algo-id="' + escapeHtmlClient(algo.id) + '"' + openAttr + '>' +
        '<summary>' +
          '<h2 class="regime-summary-title">' + titleHtml + liveBadge + '</h2>' +
          '<div class="regime-summary-headlines">' + headlinesHtml + '</div>' +
          '<span class="regime-summary-chevron">' + chevronGlyph + '</span>' +
        '</summary>' +
        '<div class="regime-section-body">' +
          '<p class="regime-helper">' + escapeHtmlClient(algo.description) + '</p>' +
          (paramsHtml ? '<div class="regime-params">' + paramsHtml + '</div>' : '') +
          '<div class="regime-tabs" role="tablist">' + tabsHtml + '</div>' +
          '<div class="chart-frame">' +
            '<div class="chart-host regime-chart-host" data-algo-id="' + escapeHtmlClient(algo.id) + '"></div>' +
          '</div>' +
          '<div class="regime-stats-row" title="Each regime: share of all training windows and average pp lead/lag vs the unconditional baseline.">' + regimeStatsHtml + '</div>' +
        '</div>' +
      '</details>';
    if (!regimeSectionsHost) return;
    regimeSectionsHost.insertAdjacentHTML('beforeend', sectionHtml);
    const detailsEl = regimeSectionsHost.querySelector('details.regime-section[data-algo-id="' + algo.id + '"]');
    if (!detailsEl) return;
    const chartHost = detailsEl.querySelector('.regime-chart-host');
    const buildIfNeeded = () => {
      if (!detailsEl.open || detailsEl.dataset.built === '1') return;
      detailsEl.dataset.built = '1';
      const chevron = detailsEl.querySelector('.regime-summary-chevron');
      if (chevron) chevron.textContent = '▴';
      if (!chartHost) return;
      const chart = buildRegimeChart({ host: chartHost, algo: algo, remaining: defaultRemaining });
      if (chart) {
        regimeCharts.push({ chart: chart, host: chartHost, algo: algo, remaining: defaultRemaining });
      }
    };
    detailsEl.addEventListener('toggle', () => {
      const chevron = detailsEl.querySelector('.regime-summary-chevron');
      if (chevron) chevron.textContent = detailsEl.open ? '▴' : '▾';
      buildIfNeeded();
    });
    if (expanded) buildIfNeeded();
  }

  function buildRegimeChart({ host, algo, remaining }) {
    if (typeof uPlot === "undefined") {
      host.innerHTML = '<pre class="chart-error">uPlot global is undefined</pre>';
      return null;
    }
    const w = host.clientWidth || host.getBoundingClientRect().width || 800;
    const h = host.clientHeight || 380;
    if (w === 0 || h === 0) {
      host.innerHTML = '<pre class="chart-error">chart host has zero size: ' + w + 'x' + h + '</pre>';
      return null;
    }
    const xs = algo.distancesBp.slice();
    const baselineY = algo.baseline[remaining].winRate.slice();
    const regimeYArrays = algo.buckets.map((b) => b.surface[remaining].winRate.slice());
    const allY = [baselineY].concat(regimeYArrays);
    const xMax = autoFitMaxBp({ xs: xs, yArrays: allY });
    const data = [xs, baselineY].concat(regimeYArrays);
    const series = [
      {},
      { label: "baseline", stroke: REGIME_BASELINE_COLOR, width: 1.25, dash: [4, 3], spanGaps: false, points: { show: false } },
    ];
    for (let i = 0; i < algo.buckets.length; i++) {
      const color = REGIME_COLORS[i % REGIME_COLORS.length];
      series.push({
        label: prettyRegime(algo.buckets[i].regime),
        stroke: color,
        width: 2,
        spanGaps: false,
        points: { show: false },
      });
    }
    const opts = {
      width: w,
      height: h,
      legend: { show: false },
      padding: [16, 18, 8, 8],
      scales: {
        x: { time: false, range: [0, xMax] },
        y: {
          range: autoFitPercentYRange({
            yArrays: allY,
            includeReferenceFifty: true,
          }),
        },
      },
      cursor: { points: { show: false }, drag: { setScale: false, x: false, y: false } },
      series: series,
      axes: [
        {
          stroke: chartTokens.axisStroke,
          font: chartTokens.axisFont,
          labelFont: chartTokens.axisFont,
          label: "distance from price line (bp)",
          labelSize: 28,
          grid: { stroke: chartTokens.gridStroke, width: 1 },
          ticks: { stroke: chartTokens.axisTickStroke, width: 1, size: 5 },
          values: (u, splits) => splits.map((v) => Math.round(v).toLocaleString()),
        },
        {
          stroke: chartTokens.axisStroke,
          font: chartTokens.axisFont,
          labelFont: chartTokens.axisFont,
          label: "hold rate %",
          labelSize: 28,
          grid: { stroke: chartTokens.gridStroke, width: 1 },
          ticks: { stroke: chartTokens.axisTickStroke, width: 1, size: 5 },
          values: (u, splits) => splits.map((v) => Math.round(v) + '%'),
          size: 60,
        },
      ],
      hooks: {
        drawAxes: [
          (u) => {
            // 50% coin-flip reference line (subtle, dashed).
            const yPos50 = u.valToPos(50, "y", true);
            const ctx = u.ctx;
            ctx.save();
            ctx.strokeStyle = chartTokens.referenceLine;
            ctx.lineWidth = 1;
            ctx.setLineDash([4, 4]);
            ctx.beginPath();
            ctx.moveTo(u.bbox.left, yPos50);
            ctx.lineTo(u.bbox.left + u.bbox.width, yPos50);
            ctx.stroke();
            ctx.restore();
          },
        ],
      },
    };
    try {
      return new uPlot(opts, data, host);
    } catch (err) {
      host.innerHTML = '<pre class="chart-error">uPlot threw: ' + (err && err.message ? err.message : String(err)) + '</pre>';
      return null;
    }
  }

  function setRegimeRemaining({ algoId, remaining }) {
    const idx = regimeCharts.findIndex((e) => e.algo.id === algoId);
    if (idx < 0) return;
    const entry = regimeCharts[idx];
    try { entry.chart.destroy(); } catch (e) { /* ignore */ }
    const newChart = buildRegimeChart({ host: entry.host, algo: entry.algo, remaining: remaining });
    if (newChart) {
      regimeCharts[idx] = { chart: newChart, host: entry.host, algo: entry.algo, remaining: remaining };
    }
    const tabs = regimeSectionsHost.querySelectorAll('.regime-tab[data-algo-id="' + algoId + '"]');
    tabs.forEach((tab) => {
      const tabRem = Number(tab.getAttribute('data-remaining'));
      tab.classList.toggle('active', tabRem === remaining);
    });
  }

  if (regimeSectionsHost) {
    regimeSectionsHost.addEventListener('click', (e) => {
      const target = e.target instanceof HTMLElement ? e.target : null;
      if (!target) return;
      const remTab = target.closest('.regime-tab');
      if (remTab instanceof HTMLElement) {
        const algoId = remTab.getAttribute('data-algo-id');
        const remaining = Number(remTab.getAttribute('data-remaining'));
        if (algoId && Number.isFinite(remaining)) {
          setRegimeRemaining({ algoId: algoId, remaining: remaining });
          remTab.blur();
        }
      }
    });
  }

  function renderRegimes(slice) {
    clearRegimeSections();
    if (!regimeSectionsHost) return;
    if (!slice.regimes || slice.regimes.length === 0) {
      regimeSectionsHost.innerHTML = '<div class="survival-empty">No regime algos computed — needs 1m candle data.</div>';
      return;
    }
    // Sort all algo sections by max lead pp descending — best
    // regime first regardless of live status. The LIVE pill on the
    // header makes live algos visually distinguishable; we don't
    // need them anchored to the top.
    const ordered = slice.regimes.slice().sort(
      (a, b) => (b.maxLeadPp ?? -Infinity) - (a.maxLeadPp ?? -Infinity),
    );
    ordered.forEach((algo) => {
      // Auto-expand only sections whose algo has at least one
      // leading regime in the live probability table — same
      // condition as the LIVE pill. Algos without live regimes
      // collapse so the operator's eye lands on what's actually
      // trading.
      const algoIsLive = liveTradingAlgoIds.indexOf(algo.id) >= 0;
      const leadingCount = !algoIsLive ? 0 : algo.buckets.reduce((acc, b) => {
        const v = (b.avgLeadPp == null || !Number.isFinite(b.avgLeadPp)) ? null : b.avgLeadPp;
        return v !== null && v >= leadingRegimeMinLeadPp ? acc + 1 : acc;
      }, 0);
      renderRegimeSection(algo, leadingCount > 0);
    });
  }

  if (filterSectionsHost) {
    filterSectionsHost.addEventListener('click', (e) => {
      const target = e.target instanceof HTMLElement ? e.target : null;
      if (!target) return;
      const tab = target.closest('.filter-tab');
      if (!(tab instanceof HTMLElement)) return;
      const filterId = tab.getAttribute('data-filter-id');
      const remaining = Number(tab.getAttribute('data-remaining'));
      if (!filterId || !Number.isFinite(remaining)) return;
      setFilterRemaining({ filterId: filterId, remaining: remaining });
      tab.blur();
    });
  }

  function activate(asset) {
    const slice = slices.find((s) => s.asset === asset);
    if (!slice) return;
    for (const btn of tabsEl.querySelectorAll(".alea-tab")) {
      btn.classList.toggle("active", btn.getAttribute("data-asset") === asset);
    }
    titleEl.textContent = slice.assetUpper;
    metaEl.textContent = slice.yearRange ?? "";
    countEl.textContent = slice.candleCount.toLocaleString() + " candles";
    renderSurvival(slice);
    renderRegimes(slice);
    renderFilters(slice);
  }

  tabsEl.addEventListener("click", (e) => {
    const target = e.target;
    if (!(target instanceof HTMLElement)) return;
    const btn = target.closest(".alea-tab");
    if (!(btn instanceof HTMLElement)) return;
    const asset = btn.getAttribute("data-asset");
    if (!asset) return;
    activate(asset);
    btn.blur();
  });

  // Use a ResizeObserver so the chart tracks its container even when
  // window size is unchanged (e.g. flex-layout reflow on first paint).
  if (typeof ResizeObserver !== "undefined") {
    const survivalRo = new ResizeObserver(() => {
      if (!survivalChart) return;
      const w = survivalChartHost.clientWidth;
      const h = survivalChartHost.clientHeight;
      if (w > 0 && h > 0) survivalChart.setSize({ width: w, height: h });
    });
    survivalRo.observe(survivalChartHost);
    // Single ResizeObserver covers both the main chart hosts and the
    // delta-chart hosts; the entry list lets us only resize what
    // actually moved.
    const filterRo = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const host = entry.target;
        const match = filterCharts.find((fc) =>
          fc.host === host || fc.deltaHost === host,
        );
        if (!match) continue;
        const w = host.clientWidth;
        const h = host.clientHeight;
        if (w <= 0 || h <= 0) continue;
        if (host === match.host) {
          match.chart.setSize({ width: w, height: h });
        } else if (host === match.deltaHost && match.deltaChart) {
          match.deltaChart.setSize({ width: w, height: h });
        }
      }
    });
    // Attach a MutationObserver so that as new chart hosts appear
    // (when the user switches asset tabs and we re-render), we begin
    // observing them too.
    if (filterSectionsHost) {
      const mo = new MutationObserver(() => {
        const mainHosts = filterSectionsHost.querySelectorAll('.filter-chart-host');
        mainHosts.forEach((h) => filterRo.observe(h));
        const deltaHosts = filterSectionsHost.querySelectorAll('.filter-delta-host');
        deltaHosts.forEach((h) => filterRo.observe(h));
      });
      mo.observe(filterSectionsHost, { childList: true, subtree: true });
    }
    // Same machinery for regime-chart hosts.
    const regimeRo = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const host = entry.target;
        const match = regimeCharts.find((rc) => rc.host === host);
        if (!match) continue;
        const w = host.clientWidth;
        const h = host.clientHeight;
        if (w > 0 && h > 0) match.chart.setSize({ width: w, height: h });
      }
    });
    if (regimeSectionsHost) {
      const regimeMo = new MutationObserver(() => {
        const hosts = regimeSectionsHost.querySelectorAll('.regime-chart-host');
        hosts.forEach((h) => regimeRo.observe(h));
      });
      regimeMo.observe(regimeSectionsHost, { childList: true, subtree: true });
    }
  }
  window.addEventListener("resize", () => {
    if (survivalChart) survivalChart.setSize({ width: survivalChartHost.clientWidth, height: survivalChartHost.clientHeight });
    for (const entry of regimeCharts) {
      const w = entry.host.clientWidth;
      const h = entry.host.clientHeight;
      if (w > 0 && h > 0) entry.chart.setSize({ width: w, height: h });
    }
    for (const entry of filterCharts) {
      const w = entry.host.clientWidth;
      const h = entry.host.clientHeight;
      if (w > 0 && h > 0) entry.chart.setSize({ width: w, height: h });
      if (entry.deltaChart) {
        const dw = entry.deltaHost.clientWidth;
        const dh = entry.deltaHost.clientHeight;
        if (dw > 0 && dh > 0) entry.deltaChart.setSize({ width: dw, height: dh });
      }
    }
  });

  if (slices.length > 0) activate(slices[0].asset);
})();

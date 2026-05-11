/*
 * Filter Exploration dashboard — client script.
 *
 * Reads the JSON payload embedded as `#exploration-payload` and
 * re-renders the filter stack when the user clicks a period tab.
 * Each filter family is its own card; cards stack vertically sorted
 * by group average WR descending. Within a card, configs are sorted
 * by individual WR descending.
 *
 * The client mirrors the server-side renderer in
 * `src/lib/exploration/renderExplorationHtml.ts` — keep them in lock
 * step so SSR first paint matches the post-hydration view.
 */
(function () {
  "use strict";

  var payloadNode = document.getElementById("exploration-payload");
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

  var stack = document.getElementById("filter-stack");
  var periodTabs = document.querySelectorAll(".period-tab");
  var regimeTabs = document.querySelectorAll(".regime-tab");

  // Default period is 5m — the higher-volume timeframe most filters
  // were originally designed around. Tabs let the user swap to 15m
  // without leaving the page.
  var currentPeriod = "5m";
  // Regime filter: "all" shows the all-bars aggregate (the default
  // numbers from filter_runs); any other value swaps each row's
  // fires/wins/winRate/ci to the `byRegime[regime]` view so the
  // user can see "how does this filter perform when the market is
  // ...".
  var currentRegime = "all";

  // Declared BEFORE the initial `render()` call below: `var` hoists
  // the declaration but not the assignment, and renderFilterCard
  // reads this object at call time. Having the initial render() run
  // before the assignment line caused a silent TypeError that left
  // every subsequent tab click as a no-op (the SSR'd HTML never got
  // replaced).
  var FAMILY_LABELS = {
    band_reversion: "band reversion",
    oscillator_reversion: "oscillator reversion",
    velocity_fade: "velocity fade",
    ma_position: "ma position",
    pattern: "pattern",
    divergence: "divergence",
  };

  // Plain-English column / metric explanations surfaced via the
  // .alea-info-tip ⓘ icon. Keep in sync with TIPS in
  // renderExplorationHtml.ts (SSR) so server + client tooltips match.
  var TIPS = {
    familyAvg:
      "Win rate across all of this filter's configs in the current period and regime, weighted by engagement count. Higher = the filter idea works.",
    familyConfigs:
      "Number of distinct parameter settings (knob values) we backtested for this filter family.",
    familyEngagements:
      "Total times any config in this filter family triggered an UP or DOWN prediction. Big numbers = lots of opportunities to verify the edge.",
    config:
      "The specific parameter values for this row of the family — the exact knobs that produced the win rate to the right.",
    engagements:
      "How many times this exact config triggered a prediction across the backtest history.",
    winRate:
      "Percent of triggers where the predicted direction matched the next bar's actual move. ▲ N is the win rate on UP calls, ▼ N on DOWN calls.",
    minQwr:
      "The worst quarter this config had — a robustness floor. Low = the edge collapsed in at least one quarter.",
    maxQwr: "The best quarter this config had — a robustness ceiling.",
    quarters:
      "Quarter-by-quarter win rate, oldest left to newest right. Bars above the midline = winning quarter (green), below = losing (red); taller = bigger deviation from 50 %. Hover a bar for the exact number.",
  };

  function infoTip(text) {
    var safe = escapeHtml(text);
    return (
      ' <span class="alea-info-tip" tabindex="0" data-tip="' +
      safe +
      '" aria-label="' +
      safe +
      '"></span>'
    );
  }

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

  // Per-filterId open/closed flag. Persisted across renders so that
  // switching tabs doesn't blow away the user's expand/collapse
  // state. Defaults to "expanded" — each click toggles. Declared
  // BEFORE the initial render() call below to avoid the var-hoisting
  // trap (see the FAMILY_LABELS note above).
  var collapsed = Object.create(null);

  // Initial re-render: the SSR markup already shows the 5m view, but
  // re-rendering on hydration makes the client and server views
  // structurally identical and routes future state changes through a
  // single code path.
  render();

  function render() {
    if (!stack) return;
    var filtered = rows.filter(function (r) {
      return r.period === currentPeriod;
    });
    if (currentRegime !== "all") {
      filtered = filtered.map(function (r) {
        return projectRegime(r, currentRegime);
      });
    }
    var groups = groupByFilter(filtered);
    stack.innerHTML = groups.map(renderFilterCard).join("");
  }

  // Returns a shallow-copied row where every fire/win field comes
  // from `byRegime[regime]` — totals, up/down split, quarter strip,
  // CI bounds. The all-bars row is preserved untouched so the user
  // can flip back to "all" without re-fetching.
  function projectRegime(r, regime) {
    var by = (r.byRegime && r.byRegime[regime]) || null;
    if (by === null) {
      return Object.assign({}, r, {
        nFires: 0,
        nWins: 0,
        winRate: null,
        ciLow: 0,
        ciHigh: 0,
        nFiresUp: 0,
        nWinsUp: 0,
        winRateUp: null,
        nFiresDown: 0,
        nWinsDown: 0,
        winRateDown: null,
        quarters: [],
        quarterWinRateMin: null,
        quarterWinRateMax: null,
      });
    }
    return Object.assign({}, r, {
      nFires: by.nFires,
      nWins: by.nWins,
      winRate: by.winRate,
      ciLow: by.ciLow,
      ciHigh: by.ciHigh,
      nFiresUp: by.nFiresUp,
      nWinsUp: by.nWinsUp,
      winRateUp: by.winRateUp,
      nFiresDown: by.nFiresDown,
      nWinsDown: by.nWinsDown,
      winRateDown: by.winRateDown,
      quarters: by.quarters || [],
      quarterWinRateMin:
        by.quarterWinRateMin === undefined ? null : by.quarterWinRateMin,
      quarterWinRateMax:
        by.quarterWinRateMax === undefined ? null : by.quarterWinRateMax,
    });
  }

  // Delegated click handler — the card markup is rebuilt on every
  // tab switch, so attaching listeners per-card would leak across
  // renders. Delegating on the stack lets one listener handle every
  // header.
  function toggleCardForHeader(header) {
    var card = header.parentElement;
    if (!card || !card.classList.contains("filter-card")) return;
    var id = card.getAttribute("data-filter-id");
    if (!id) return;
    collapsed[id] = !collapsed[id];
    card.classList.toggle("is-collapsed", !!collapsed[id]);
    header.setAttribute("aria-expanded", collapsed[id] ? "false" : "true");
  }
  if (stack) {
    stack.addEventListener("click", function (e) {
      var header =
        e.target &&
        (e.target.closest ? e.target.closest(".filter-card-header") : null);
      if (!header) return;
      toggleCardForHeader(header);
    });
    stack.addEventListener("keydown", function (e) {
      if (e.key !== "Enter" && e.key !== " ") return;
      var header =
        e.target &&
        (e.target.closest ? e.target.closest(".filter-card-header") : null);
      if (!header) return;
      e.preventDefault();
      toggleCardForHeader(header);
    });
  }

  // Family-card aggregate. We use fire-weighted total WR
  // (`sumWins / sumFires` across the family's configs), NOT the
  // mean of per-config WRs. The mean-of-WRs is sensitive to
  // small-sample configs — in a regime-scoped view a config with
  // 33 fires at 97% WR drags the simple mean way up even though the
  // family's actual performance is dominated by configs with
  // thousands of fires. The fire-weighted number is the "this
  // filter wins X% of the time" stat the user expects to sort by.
  function groupByFilter(list) {
    var byId = Object.create(null);
    var order = [];
    for (var i = 0; i < list.length; i += 1) {
      var r = list[i];
      if (!byId[r.filterId]) {
        byId[r.filterId] = {
          filterId: r.filterId,
          family: r.family,
          rows: [],
        };
        order.push(r.filterId);
      }
      byId[r.filterId].rows.push(r);
    }
    var groups = order.map(function (id) {
      var g = byId[id];
      g.totalFires = g.rows.reduce(function (s, r) {
        return s + r.nFires;
      }, 0);
      g.totalWins = g.rows.reduce(function (s, r) {
        return s + r.nWins;
      }, 0);
      g.avgWinRate = g.totalFires === 0 ? null : g.totalWins / g.totalFires;
      g.rows = g.rows.slice().sort(function (a, b) {
        var aRate = a.winRate === null ? -1 : a.winRate;
        var bRate = b.winRate === null ? -1 : b.winRate;
        if (bRate !== aRate) return bRate - aRate;
        return b.nFires - a.nFires;
      });
      return g;
    });
    groups.sort(function (a, b) {
      var aAvg = a.avgWinRate === null ? -1 : a.avgWinRate;
      var bAvg = b.avgWinRate === null ? -1 : b.avgWinRate;
      if (bAvg !== aAvg) return bAvg - aAvg;
      return b.totalFires - a.totalFires;
    });
    return groups;
  }

  function renderFilterCard(g) {
    var avg = g.avgWinRate === null ? "&mdash;" : percent(g.avgWinRate);
    var tone = toneClass(g.avgWinRate);
    var body = g.rows.map(renderSubRow).join("");
    var familyLabel = FAMILY_LABELS[g.family] || g.family;
    var isCollapsed = !!collapsed[g.filterId];
    var collapsedCls = isCollapsed ? " is-collapsed" : "";
    var ariaExpanded = isCollapsed ? "false" : "true";
    return (
      '<section class="filter-card' +
      collapsedCls +
      '" data-filter-id="' +
      escapeHtml(g.filterId) +
      '">' +
      '<header class="filter-card-header" role="button" tabindex="0" aria-expanded="' +
      ariaExpanded +
      '">' +
      '<div class="filter-card-id-row">' +
      '<h2 class="filter-card-id">' +
      escapeHtml(g.filterId) +
      "</h2>" +
      '<span class="filter-card-family">' +
      escapeHtml(familyLabel) +
      "</span>" +
      "</div>" +
      '<div class="filter-card-right-group">' +
      '<div class="filter-card-meta">' +
      '<span class="filter-card-meta-item is-avg">' +
      '<span class="filter-card-meta-label">avg' +
      infoTip(TIPS.familyAvg) +
      "</span>" +
      '<span class="filter-card-meta-value' +
      tone +
      '">' +
      avg +
      "</span>" +
      "</span>" +
      '<span class="filter-card-meta-item is-configs">' +
      '<span class="filter-card-meta-label">configs' +
      infoTip(TIPS.familyConfigs) +
      "</span>" +
      '<span class="filter-card-meta-value">' +
      g.rows.length +
      "</span>" +
      "</span>" +
      '<span class="filter-card-meta-item is-fires">' +
      '<span class="filter-card-meta-label">engagements' +
      infoTip(TIPS.familyEngagements) +
      "</span>" +
      '<span class="filter-card-meta-value">' +
      g.totalFires.toLocaleString() +
      "</span>" +
      "</span>" +
      "</div>" +
      '<span class="filter-card-chevron" aria-hidden="true">▸</span>' +
      "</div>" +
      "</header>" +
      '<div class="filter-card-table-wrap">' +
      '<table class="filter-card-table">' +
      "<colgroup>" +
      '<col style="width: 28%" />' +
      '<col style="width: 11%" />' +
      '<col style="width: 17%" />' +
      '<col style="width: 11%" />' +
      '<col style="width: 11%" />' +
      '<col style="width: 22%" />' +
      "</colgroup>" +
      "<thead>" +
      "<tr>" +
      '<th class="config-col">Config' +
      infoTip(TIPS.config) +
      "</th>" +
      '<th class="num-col">Engagements' +
      infoTip(TIPS.engagements) +
      "</th>" +
      '<th class="wr-col">Win Rate' +
      infoTip(TIPS.winRate) +
      "</th>" +
      '<th class="num-col">Min Q WR' +
      infoTip(TIPS.minQwr) +
      "</th>" +
      '<th class="num-col">Max Q WR' +
      infoTip(TIPS.maxQwr) +
      "</th>" +
      '<th class="quarters-col">Quarters' +
      infoTip(TIPS.quarters) +
      "</th>" +
      "</tr>" +
      "</thead>" +
      "<tbody>" +
      body +
      "</tbody>" +
      "</table>" +
      "</div>" +
      "</section>"
    );
  }

  function renderSubRow(r) {
    return (
      "<tr>" +
      '<td class="config-col"><span class="alea-mono config-text" title="' +
      escapeHtml(r.configCanon) +
      '">' +
      escapeHtml(r.configCanon) +
      "</span></td>" +
      '<td class="num-col alea-mono">' +
      r.nFires.toLocaleString() +
      "</td>" +
      '<td class="wr-col">' +
      renderWrCell(r) +
      "</td>" +
      '<td class="num-col">' +
      renderMinMaxCell(r.quarterWinRateMin) +
      "</td>" +
      '<td class="num-col">' +
      renderMinMaxCell(r.quarterWinRateMax) +
      "</td>" +
      '<td class="quarters-col">' +
      renderQuarterStrip(r) +
      "</td>" +
      "</tr>"
    );
  }

  function renderMinMaxCell(v) {
    if (v === null || v === undefined) {
      return '<span class="alea-muted">&mdash;</span>';
    }
    return (
      '<span class="alea-mono' + toneClass(v) + '">' + percent(v) + "</span>"
    );
  }

  function renderQuarterStrip(r) {
    var qs = r.quarters || [];
    if (qs.length === 0) {
      return '<span class="alea-muted">&mdash;</span>';
    }
    var bars = qs.map(renderQuarterBar).join("");
    return (
      '<div class="q-strip-wrap"><div class="q-strip" role="img" aria-label="Per-quarter win rate">' +
      bars +
      "</div></div>"
    );
  }

  function renderQuarterBar(q) {
    var wrLabel = q.winRate === null ? "—" : percent(q.winRate);
    var title =
      q.label +
      ": " +
      wrLabel +
      " (" +
      q.nWins.toLocaleString() +
      "/" +
      q.nFires.toLocaleString() +
      ")";
    var titleAttr = escapeHtml(title);
    if (q.winRate === null || q.nFires === 0) {
      return '<span class="q-bar" title="' + titleAttr + '"></span>';
    }
    var deviation = q.winRate - 0.5;
    var absDev = Math.abs(deviation);
    if (absDev < 0.005) {
      return (
        '<span class="q-bar" title="' +
        titleAttr +
        '"><span class="q-bar-fill q-bar-fill-flat"></span></span>'
      );
    }
    var height = Math.max(1, Math.min(12, absDev * 120));
    var cls = deviation > 0 ? "q-bar-fill-pos" : "q-bar-fill-neg";
    return (
      '<span class="q-bar" title="' +
      titleAttr +
      '"><span class="q-bar-fill ' +
      cls +
      '" style="height:' +
      height.toFixed(1) +
      'px"></span></span>'
    );
  }

  function renderWrCell(r) {
    if (r.winRate === null || r.nFires === 0) {
      return '<span class="alea-muted">&mdash;</span>';
    }
    var tone = toneClass(r.winRate);
    var up = bare(r.winRateUp);
    var down = bare(r.winRateDown);
    return (
      '<div class="wr-cell">' +
      '<span class="wr-value' +
      tone +
      '">' +
      percent(r.winRate) +
      "</span>" +
      '<span class="wr-dir">' +
      '<span class="wr-dir-leg">▲ ' +
      up +
      "</span>" +
      '<span class="wr-dir-leg">▼ ' +
      down +
      "</span>" +
      "</span>" +
      "</div>"
    );
  }

  function bare(v) {
    return v === null ? "&mdash;" : (v * 100).toFixed(1);
  }

  function toneClass(wr) {
    if (wr === null) return "";
    if (wr >= 0.52) return " alea-num-positive";
    if (wr < 0.48) return " alea-num-negative";
    return "";
  }

  function percent(v) {
    return (v * 100).toFixed(1) + "%";
  }

  function escapeHtml(s) {
    return String(s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }
})();

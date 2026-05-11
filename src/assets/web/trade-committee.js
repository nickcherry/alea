/*
 * Trade Committee dashboard - client-side period/regime scoping.
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
  var tbody = document.getElementById("committee-rows");
  var meta = document.getElementById("committee-roster-meta");
  var periodTabs = document.querySelectorAll(".committee-period-tab");
  var regimeTabs = document.querySelectorAll(".committee-regime-tab");

  var currentPeriod = "5m";
  var currentRegime = "all";

  var FAMILY_LABELS = {
    band_reversion: "band reversion",
    oscillator_reversion: "oscillator reversion",
    velocity_fade: "velocity fade",
    ma_position: "ma position",
    pattern: "pattern",
    divergence: "divergence",
  };

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

  function render() {
    if (!tbody) return;
    var visible = rows.filter(function (r) {
      return (
        r.period === currentPeriod &&
        (currentRegime === "all" || r.marketRegime === currentRegime)
      );
    });
    tbody.innerHTML = renderRows(visible);
    if (meta) {
      meta.textContent = rosterMeta(visible);
    }
  }

  function rosterMeta(visible) {
    var regimeLabel =
      currentRegime === "all" ? "all regimes" : marketRegime(currentRegime);
    return (
      "Showing " +
      visible.length.toLocaleString() +
      " " +
      currentPeriod +
      " candidates in " +
      regimeLabel +
      "."
    );
  }

  function renderRows(visible) {
    if (visible.length === 0) {
      return '<tr><td colspan="8"><span class="alea-muted">No candidates in this scope.</span></td></tr>';
    }
    return visible.map(renderRow).join("");
  }

  function renderRow(row) {
    var family = row.filterFamily
      ? FAMILY_LABELS[row.filterFamily] || row.filterFamily
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

  function marketRegime(value) {
    return String(value).replace(/_/g, " ");
  }

  function toneClass(wr) {
    if (wr >= 0.52) return " alea-num-positive";
    if (wr < 0.48) return " alea-num-negative";
    return "";
  }

  function percent(value) {
    return (Number(value) * 100).toFixed(1) + "%";
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

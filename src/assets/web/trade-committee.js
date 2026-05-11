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
  var bucketTiles = document.querySelectorAll(".committee-bucket-tile");

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
      Array.prototype.forEach.call(bucketTiles, function (tile) {
        if (tile.dataset.period === currentPeriod) {
          tile.removeAttribute("hidden");
        } else {
          tile.setAttribute("hidden", "hidden");
        }
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
      return r.period === currentPeriod && r.marketRegime === currentRegime;
    });
    tbody.innerHTML = renderRows(visible);
    if (meta) {
      meta.textContent = rosterMeta(visible);
    }
  }

  function rosterMeta(visible) {
    return (
      "Showing " +
      visible.length.toLocaleString() +
      " " +
      currentPeriod +
      " candidates in " +
      marketRegime(currentRegime) +
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

})();

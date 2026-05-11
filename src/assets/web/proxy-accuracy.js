/*
 * Proxy Accuracy dashboard — client-side period toggle.
 *
 * Shows one of the pre-rendered .proxy-timeframe-section elements at a
 * time and re-renders the "Top Disagreements" table from the embedded
 * payload, restricted to the chosen timeframe. The server pre-renders
 * the initial timeframe so first paint is correct without JS.
 */
(function () {
  "use strict";

  var payloadNode = document.getElementById("proxy-accuracy-payload");
  if (!payloadNode) {
    return;
  }
  var payload;
  try {
    payload = JSON.parse(payloadNode.textContent || "{}");
  } catch (err) {
    return;
  }

  var extremes = (payload && payload.extremeDisagreements) || [];
  var sections = document.querySelectorAll(".proxy-timeframe-section");
  var tabs = document.querySelectorAll(".proxy-period-tab");
  var extremeHost = document.getElementById("proxy-extreme-host");

  var alea = window.alea;
  var escapeHtml = alea.escapeHtml;

  var initial = "5m";
  Array.prototype.forEach.call(tabs, function (t) {
    if (t.getAttribute("aria-selected") === "true") {
      initial = t.dataset.period || initial;
    }
  });

  Array.prototype.forEach.call(tabs, function (tab) {
    tab.addEventListener("click", function () {
      var period = tab.dataset.period;
      Array.prototype.forEach.call(tabs, function (t) {
        t.setAttribute("aria-selected", t === tab ? "true" : "false");
      });
      Array.prototype.forEach.call(sections, function (s) {
        if (s.dataset.period === period) {
          s.removeAttribute("hidden");
        } else {
          s.setAttribute("hidden", "hidden");
        }
      });
      renderExtremes(period);
    });
  });

  // Re-render extremes on first paint so SSR and JS share one code path.
  renderExtremes(initial);

  function renderExtremes(period) {
    if (!extremeHost) return;
    var rows = extremes.filter(function (r) {
      return r.timeframe === period;
    });
    if (rows.length === 0) {
      extremeHost.innerHTML = '<p class="proxy-muted">No disagreements yet.</p>';
      return;
    }
    extremeHost.innerHTML =
      '<div class="alea-table-wrap">' +
      '<table class="alea-table proxy-extreme-table">' +
      "<thead><tr>" +
      "<th>Time</th>" +
      "<th>Asset</th>" +
      "<th>Polymarket</th>" +
      "<th>Pyth</th>" +
      '<th class="num-col">Open</th>' +
      '<th class="num-col">Close</th>' +
      '<th class="num-col">|move%|</th>' +
      "</tr></thead>" +
      "<tbody>" +
      rows.map(renderExtremeRow).join("") +
      "</tbody></table></div>";
  }

  function renderExtremeRow(row) {
    var when = new Date(row.windowStartTsMs)
      .toISOString()
      .slice(0, 16)
      .replace("T", " ");
    return (
      "<tr>" +
      '<td class="alea-mono">' +
      escapeHtml(when) +
      "</td>" +
      '<td><span class="asset-pill">' +
      escapeHtml(row.asset) +
      "</span></td>" +
      "<td>" +
      outcomeBadge(row.polyOutcome) +
      "</td>" +
      "<td>" +
      outcomeBadge(row.pythOutcome) +
      "</td>" +
      '<td class="num-col alea-mono">' +
      Number(row.pythOpen).toFixed(4) +
      "</td>" +
      '<td class="num-col alea-mono">' +
      Number(row.pythClose).toFixed(4) +
      "</td>" +
      '<td class="num-col alea-mono">' +
      formatBp(row.absMovePct) +
      "</td>" +
      "</tr>"
    );
  }

  function outcomeBadge(outcome) {
    if (outcome === "up") {
      return '<span class="alea-num-positive">UP</span>';
    }
    return '<span class="alea-num-negative">DOWN</span>';
  }

  function formatBp(pct) {
    if (pct === null || pct === undefined) {
      return "—";
    }
    var bp = Number(pct) * 100;
    if (bp >= 100) {
      return (bp / 100).toFixed(2) + "%";
    }
    if (bp >= 10) {
      return bp.toFixed(1) + " bp";
    }
    return bp.toFixed(2) + " bp";
  }
})();

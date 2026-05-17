/* eslint-disable */
(function () {
  var payloadEl = document.getElementById("backtest-payload");
  if (!payloadEl) return;

  var payload = JSON.parse(payloadEl.textContent || "{}");
  var byPeriod = payload.byPeriod || {};
  var supportedPeriods = payload.supportedPeriods || ["5m"];
  var currentPeriod = payload.defaultPeriod || supportedPeriods[0] || "5m";
  var TABLE_LIMIT = 20;
  var alea = window.alea;
  var escapeHtml = alea.escapeHtml;
  var percent = alea.formatPercent;
  var toneClass = alea.winRateToneClass;

  var head = document.getElementById("backtest-head");
  var body = document.getElementById("backtest-body");
  var tabs = document.querySelectorAll(".backtest-period-tab");

  Array.prototype.forEach.call(tabs, function (tab) {
    tab.addEventListener("click", function () {
      currentPeriod = tab.dataset.period;
      Array.prototype.forEach.call(tabs, function (t) {
        t.setAttribute("aria-selected", t === tab ? "true" : "false");
      });
      renderTable(activeSlice());
    });
  });

  renderTable(activeSlice());

  function activeSlice() {
    return byPeriod[currentPeriod] || { quarters: [], rows: [] };
  }

  function renderTable(slice) {
    if (!head || !body) return;
    var quarters = slice.quarters || [];
    var rows = slice.rows || [];
    head.innerHTML = renderHead(quarters);
    body.innerHTML = renderRows(rows, quarters);
  }

  function renderHead(quarters) {
    return (
      "<tr>" +
      "<th>Filter</th>" +
      "<th>Config</th>" +
      '<th class="num-col">WR</th>' +
      '<th class="num-col">Decisions</th>' +
      quarters
        .map(function (q) {
          return '<th class="num-col quarter-col">' + escapeHtml(q) + "</th>";
        })
        .join("") +
      "</tr>"
    );
  }

  function renderRows(rows, quarters) {
    var shown = rows.slice(0, TABLE_LIMIT);
    if (shown.length === 0) {
      return (
        '<tr><td colspan="' +
        (4 + quarters.length) +
        '"><span class="alea-muted">No backtest rows yet.</span></td></tr>'
      );
    }
    return shown
      .map(function (row) {
        var wr =
          row.winRate === null
            ? '<span class="alea-muted">—</span>'
            : percent(row.winRate);
        var qByLabel = {};
        (row.quarters || []).forEach(function (q) {
          qByLabel[q.label] = q;
        });
        return (
          "<tr>" +
          "<td>" +
          '<div class="backtest-filter-name">' +
          escapeHtml(row.filterName) +
          ' <span class="alea-muted">v' +
          Number(row.filterVersion).toLocaleString() +
          "</span></div>" +
          "</td>" +
          '<td class="backtest-config-cell">' +
          '<div class="backtest-config">' +
          escapeHtml(JSON.stringify(row.config || {})) +
          "</div>" +
          "</td>" +
          '<td class="num-col alea-mono' +
          toneClass(row.winRate) +
          '">' +
          wr +
          "</td>" +
          '<td class="num-col alea-mono">' +
          Number(row.decisionCount).toLocaleString() +
          "</td>" +
          quarters
            .map(function (q) {
              return renderQuarterCell(qByLabel[q]);
            })
            .join("") +
          "</tr>"
        );
      })
      .join("");
  }

  function renderQuarterCell(cell) {
    if (!cell || cell.winRate === null) {
      return '<td class="num-col alea-muted">—</td>';
    }
    return (
      '<td class="num-col alea-mono' +
      toneClass(cell.winRate) +
      '">' +
      percent(cell.winRate) +
      '<span class="backtest-cell-count">' +
      Number(cell.decisionCount).toLocaleString() +
      "</span></td>"
    );
  }
})();

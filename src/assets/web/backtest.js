/* eslint-disable */
(function () {
  var payloadEl = document.getElementById("backtest-payload");
  var tokensEl = document.getElementById("backtest-tokens");
  if (!payloadEl || !tokensEl) return;

  var payload = JSON.parse(payloadEl.textContent || "{}");
  var tokens = JSON.parse(tokensEl.textContent || "{}");
  var byPeriod = payload.byPeriod || {};
  var supportedPeriods = payload.supportedPeriods || ["5m"];
  var currentPeriod = payload.defaultPeriod || supportedPeriods[0] || "5m";
  var TABLE_LIMIT = 80;
  var alea = window.alea;
  var escapeHtml = alea.escapeHtml;
  var percent = alea.formatPercent;
  var toneClass = alea.winRateToneClass;

  var head = document.getElementById("backtest-head");
  var body = document.getElementById("backtest-body");
  var meta = document.getElementById("backtest-meta");
  var host = document.getElementById("backtest-chart");
  var empty = document.getElementById("backtest-chart-empty");
  var tooltip = document.getElementById("backtest-tooltip");
  var tabs = document.querySelectorAll(".backtest-period-tab");
  var plot = null;

  Array.prototype.forEach.call(tabs, function (tab) {
    tab.addEventListener("click", function () {
      currentPeriod = tab.dataset.period;
      Array.prototype.forEach.call(tabs, function (t) {
        t.setAttribute("aria-selected", t === tab ? "true" : "false");
      });
      renderAll();
    });
  });

  renderAll();

  window.addEventListener("resize", function () {
    window.clearTimeout(window.__aleaBacktestResize);
    window.__aleaBacktestResize = window.setTimeout(renderChart, 120);
  });

  function activeSlice() {
    return byPeriod[currentPeriod] || { quarters: [], rows: [] };
  }

  function renderAll() {
    var slice = activeSlice();
    renderTable(slice);
    renderChart();
  }

  function renderTable(slice) {
    if (!head || !body) return;
    var quarters = slice.quarters || [];
    var rows = slice.rows || [];
    head.innerHTML = renderHead(quarters);
    body.innerHTML = renderRows(rows, quarters);
    if (meta) {
      meta.textContent =
        "showing " +
        Math.min(TABLE_LIMIT, rows.length).toLocaleString() +
        " of " +
        rows.length.toLocaleString();
    }
  }

  function renderHead(quarters) {
    return (
      "<tr>" +
      "<th>Candidate</th>" +
      '<th class="num-col">WR</th>' +
      '<th class="num-col">Decisions</th>' +
      '<th class="num-col">Assets</th>' +
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
          '<div class="backtest-candidate-name">' +
          escapeHtml(row.filterName) +
          ' <span class="alea-muted">v' +
          Number(row.filterVersion).toLocaleString() +
          "</span></div>" +
          '<div class="backtest-candidate-config">' +
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
          '<td class="num-col alea-mono">' +
          Number(row.assetCount).toLocaleString() +
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

  function renderChart() {
    if (!host) return;
    if (plot !== null) {
      plot.destroy();
      plot = null;
    }
    host.innerHTML = "";
    var slice = activeSlice();
    var quarters = slice.quarters || [];
    var rows = (slice.rows || []).filter(function (row) {
      return row.decisionCount > 0;
    });
    if (quarters.length === 0 || rows.length === 0) {
      if (empty) empty.style.display = "flex";
      return;
    }
    if (empty) empty.style.display = "none";
    var topRows = rows.slice(0, 6);
    var xs = quarters.map(function (_q, idx) {
      return idx + 1;
    });
    var data = [xs];
    topRows.forEach(function (row) {
      var qByLabel = {};
      (row.quarters || []).forEach(function (q) {
        qByLabel[q.label] = q;
      });
      data.push(
        quarters.map(function (q) {
          var cell = qByLabel[q];
          return cell && cell.winRate !== null ? cell.winRate * 100 : null;
        }),
      );
    });
    var palette = [
      tokens.green || "#46c37b",
      tokens.blue || "#5b95ff",
      tokens.gold || "#d7aa45",
      tokens.orange || "#ffa566",
      tokens.red || "#d85a4f",
      tokens.marble || "#e8dec4",
    ];
    plot = new uPlot(
      {
        width: host.clientWidth || 900,
        height: 260,
        padding: [10, 12, 0, 0],
        scales: { x: { time: false }, y: { range: [35, 65] } },
        axes: [
          {
            stroke: tokens.muted,
            grid: { stroke: tokens.grid },
            values: function (_u, vals) {
              return vals.map(function (v) {
                return quarters[Math.max(0, Math.round(v) - 1)] || "";
              });
            },
          },
          {
            stroke: tokens.muted,
            grid: { stroke: tokens.grid },
            values: function (_u, vals) {
              return vals.map(function (v) {
                return v.toFixed(0) + "%";
              });
            },
          },
        ],
        series: [
          {},
          ...topRows.map(function (row, idx) {
            return {
              label: row.filterName,
              stroke: palette[idx % palette.length],
              width: 2,
              points: { show: true, size: 5 },
            };
          }),
        ],
        cursor: { drag: { x: false, y: false } },
        hooks: {
          setCursor: [
            function (u) {
              if (!tooltip) return;
              var idx = u.cursor.idx;
              if (idx == null || idx < 0) {
                tooltip.style.display = "none";
                return;
              }
              var lines = [
                "<strong>" + escapeHtml(quarters[idx] || "") + "</strong>",
              ];
              topRows.forEach(function (row, seriesIdx) {
                var value = data[seriesIdx + 1][idx];
                if (value !== null && value !== undefined) {
                  lines.push(
                    escapeHtml(row.filterName) + ": " + value.toFixed(1) + "%",
                  );
                }
              });
              tooltip.innerHTML = lines.join("<br>");
              tooltip.style.display = "block";
              tooltip.style.left =
                Math.min(u.cursor.left + 18, host.clientWidth - 220) + "px";
              tooltip.style.top = Math.max(12, u.cursor.top - 12) + "px";
            },
          ],
        },
      },
      data,
      host,
    );
  }
})();

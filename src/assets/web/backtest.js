/* eslint-disable */
(function () {
  var payloadEl = document.getElementById("backtest-payload");
  if (!payloadEl) return;

  var payload = JSON.parse(payloadEl.textContent || "{}");
  var byPeriod = payload.byPeriod || {};
  var supportedPeriods = payload.supportedPeriods || ["1h"];
  var supportedAssets = payload.supportedAssets || ["btc"];
  var currentPeriod = payload.defaultPeriod || supportedPeriods[0] || "1h";
  var currentAsset = payload.defaultAsset || supportedAssets[0] || "btc";
  var TABLE_LIMIT = 20;
  var alea = window.alea;
  var escapeHtml = alea.escapeHtml;
  var percent = alea.formatPercent;
  var toneClass = alea.winRateToneClass;

  var head = document.getElementById("backtest-head");
  var body = document.getElementById("backtest-body");
  var periodTabs = document.querySelectorAll(".backtest-period-tab");
  var assetTabs = document.querySelectorAll(".backtest-asset-tab");

  Array.prototype.forEach.call(periodTabs, function (tab) {
    tab.addEventListener("click", function () {
      currentPeriod = tab.dataset.period;
      var periodSlice = byPeriod[currentPeriod] || {};
      if (!activeAssetSlice(periodSlice, currentAsset)) {
        currentAsset = periodSlice.defaultAsset || supportedAssets[0] || "btc";
      }
      Array.prototype.forEach.call(periodTabs, function (t) {
        t.setAttribute("aria-selected", t === tab ? "true" : "false");
      });
      syncAssetTabs();
      renderTable(activeSlice());
    });
  });

  Array.prototype.forEach.call(assetTabs, function (tab) {
    tab.addEventListener("click", function () {
      currentAsset = tab.dataset.asset;
      syncAssetTabs();
      renderTable(activeSlice());
    });
  });

  renderTable(activeSlice());

  function activeSlice() {
    var periodSlice = byPeriod[currentPeriod] || {};
    return (
      activeAssetSlice(periodSlice, currentAsset) || {
        quarters: [],
        rows: [],
      }
    );
  }

  function activeAssetSlice(periodSlice, asset) {
    var byAsset = periodSlice.byAsset || {};
    return byAsset[asset] || null;
  }

  function syncAssetTabs() {
    Array.prototype.forEach.call(assetTabs, function (tab) {
      tab.setAttribute(
        "aria-selected",
        tab.dataset.asset === currentAsset ? "true" : "false",
      );
    });
  }

  function renderTable(slice) {
    if (!head || !body) return;
    var quarters = slice.quarters || [];
    var rows = slice.rows || [];
    head.innerHTML = renderHead(quarters);
    body.innerHTML = renderRows(rows, quarters, layoutRowCountForPeriod());
  }

  function renderHead(quarters) {
    return (
      "<tr>" +
      "<th>Filter</th>" +
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

  function renderRows(rows, quarters, layoutRowCount) {
    var shown = rows.slice(0, TABLE_LIMIT);
    if (shown.length === 0) {
      return (
        '<tr><td colspan="' +
        (3 + quarters.length) +
        '"><span class="alea-muted">No backtest rows yet.</span></td></tr>' +
        renderFillerRows(Math.max(0, layoutRowCount - 1), 3 + quarters.length)
      );
    }
    return (
      shown
        .map(function (row) {
          var wr =
            row.winRate === null
              ? '<span class="alea-muted">—</span>'
              : percent(row.winRate);
          var qByLabel = {};
          (row.quarters || []).forEach(function (q) {
            qByLabel[q.label] = q;
          });
          var description = row.filterDescription
            ? '<div class="backtest-filter-description">' +
              escapeHtml(row.filterDescription) +
              "</div>"
            : "";
          return (
            "<tr>" +
            '<td class="backtest-filter-cell">' +
            '<div class="backtest-filter-name">' +
            escapeHtml(row.filterName) +
            ' <span class="alea-muted">v' +
            Number(row.filterVersion).toLocaleString() +
            "</span></div>" +
            description +
            renderTradeProfile(row.takeProfitPct, row.stopLossPct) +
            renderConfig(row.config || {}) +
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
        .join("") +
      renderFillerRows(
        Math.max(0, layoutRowCount - shown.length),
        3 + quarters.length,
      )
    );
  }

  function renderQuarterCell(cell) {
    if (!cell || cell.winRate === null) {
      return '<td class="num-col quarter-col alea-muted">—</td>';
    }
    return (
      '<td class="num-col quarter-col alea-mono' +
      toneClass(cell.winRate) +
      '">' +
      percent(cell.winRate) +
      '<span class="backtest-cell-count">' +
      Number(cell.decisionCount).toLocaleString() +
      "</span></td>"
    );
  }

  function renderTradeProfile(takeProfitPct, stopLossPct) {
    function fmt(pct) {
      if (pct === null || pct === undefined || !isFinite(pct)) return "—";
      return (
        Number(pct * 100)
          .toFixed(2)
          .replace(/\.?0+$/, "") + "%"
      );
    }
    return (
      '<dl class="backtest-trade-profile">' +
      '<div class="backtest-trade-profile-row"><dt>TP</dt><dd>' +
      escapeHtml(fmt(takeProfitPct)) +
      "</dd></div>" +
      '<div class="backtest-trade-profile-row"><dt>SL</dt><dd>' +
      escapeHtml(fmt(stopLossPct)) +
      "</dd></div>" +
      "</dl>"
    );
  }

  function renderConfig(value) {
    var entries = configEntries(value);
    if (entries.length === 0) {
      return '<div class="backtest-config"><span class="alea-muted">{}</span></div>';
    }
    return (
      '<dl class="backtest-config">' +
      entries
        .map(function (entry) {
          return (
            '<div class="backtest-config-row"><dt>' +
            escapeHtml(entry.key + ":") +
            "</dt><dd>" +
            escapeHtml(entry.value) +
            "</dd></div>"
          );
        })
        .join("") +
      "</dl>"
    );
  }

  function configEntries(value, prefix) {
    if (value === null || typeof value !== "object") {
      return prefix === undefined
        ? []
        : [{ key: prefix, value: formatConfigValue(value) }];
    }
    if (Array.isArray(value)) {
      return prefix === undefined
        ? []
        : [{ key: prefix, value: JSON.stringify(value) }];
    }
    return Object.keys(value)
      .sort()
      .reduce(function (out, key) {
        var child = value[key];
        var childKey = prefix === undefined ? key : prefix + "." + key;
        if (isPlainConfigObject(child)) {
          var nested = configEntries(child, childKey);
          return out.concat(
            nested.length === 0 ? [{ key: childKey, value: "{}" }] : nested,
          );
        }
        return out.concat([{ key: childKey, value: formatConfigValue(child) }]);
      }, []);
  }

  function isPlainConfigObject(value) {
    return value !== null && typeof value === "object" && !Array.isArray(value);
  }

  function formatConfigValue(value) {
    if (typeof value === "string") {
      return value;
    }
    if (
      typeof value === "number" ||
      typeof value === "boolean" ||
      value === null
    ) {
      return String(value);
    }
    return JSON.stringify(value);
  }

  function layoutRowCountForPeriod() {
    var periodSlice = byPeriod[currentPeriod] || {};
    var byAsset = periodSlice.byAsset || {};
    return Math.max.apply(
      null,
      [1].concat(
        Object.keys(byAsset).map(function (asset) {
          return Math.min(TABLE_LIMIT, (byAsset[asset].rows || []).length);
        }),
      ),
    );
  }

  function renderFillerRows(count, colspan) {
    return Array.from({ length: count }, function () {
      return (
        '<tr class="backtest-filler-row" aria-hidden="true"><td colspan="' +
        colspan +
        '">&nbsp;</td></tr>'
      );
    }).join("");
  }
})();

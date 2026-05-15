/*
 * Shared browser-side helpers for Alea dashboards. Mirrors the
 * server-side helpers in `src/lib/ui/aleaFormat.ts` so client-side
 * rerenders produce HTML byte-equivalent to the SSR output.
 *
 * Loaded before every page script by `copyDashboardAssets`, alongside
 * `alea-info-tooltips.js`. Exposes `window.alea` with the common
 * formatting + tone helpers.
 */
(function () {
  "use strict";

  var WR_POSITIVE_MIN = 0.52;
  var WR_NEGATIVE_MAX = 0.48;

  function escapeHtml(value) {
    return String(value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function formatPercent(value) {
    return (Number(value) * 100).toFixed(1) + "%";
  }

  function winRateToneClass(wr) {
    if (wr === null || wr === undefined) {
      return "";
    }
    if (wr >= WR_POSITIVE_MIN) {
      return " alea-num-positive";
    }
    if (wr < WR_NEGATIVE_MAX) {
      return " alea-num-negative";
    }
    return "";
  }

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

  window.alea = {
    escapeHtml: escapeHtml,
    formatPercent: formatPercent,
    winRateToneClass: winRateToneClass,
    infoTip: infoTip,
    WR_POSITIVE_MIN: WR_POSITIVE_MIN,
    WR_NEGATIVE_MAX: WR_NEGATIVE_MAX,
  };
})();

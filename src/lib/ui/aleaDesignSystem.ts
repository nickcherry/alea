/**
 * Shared visual identity for Alea's HTML reports and dashboards. Tokens,
 * base layout, and reusable component styles
 * live in `src/assets/web/alea.css` — copied into each report's
 * `<page>_<ts>.assets/` folder at generation time so reports stay
 * self-contained and frozen-in-time.
 *
 * This module exposes the small inline pieces that don't belong in the
 * shared stylesheet: the brand mark SVG, the chart-color tokens (used by
 * uPlot configs in TS), and an <head>-fragment helper that emits the font
 * preconnect plus <link> tags for the report's stylesheet bundle.
 *
 * Vibe: dark, intelligent, probability-driven, Roman casino without the
 * tackiness. Antique gold accents on deep felt-green panels, warm ivory
 * text, classical serif for titles, Inter for everything else.
 */

/**
 * Inline SVG dice mark used in the report header. Single antique-gold
 * fill, sized via the wrapper element's `width`/`height` attrs.
 */
export const aleaDiceMarkSvg = `
<svg viewBox="0 0 32 32" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
  <rect x="4.5" y="4.5" width="23" height="23" rx="4.5" ry="4.5"
    fill="none" stroke="currentColor" stroke-width="1.4"/>
  <circle cx="11" cy="11" r="1.6" fill="currentColor"/>
  <circle cx="21" cy="11" r="1.6" fill="currentColor"/>
  <circle cx="16" cy="16" r="1.6" fill="currentColor"/>
  <circle cx="11" cy="21" r="1.6" fill="currentColor"/>
  <circle cx="21" cy="21" r="1.6" fill="currentColor"/>
</svg>
`.trim();

/**
 * Chart colors keyed against the design tokens. uPlot configs read these
 * directly so axis/grid colors stay in lockstep with the page palette.
 */
export const aleaChartTokens = {
  axisStroke: "#b8aa8a",
  axisTickStroke: "#6f5320",
  axisFont: "12px Inter, ui-sans-serif, system-ui, sans-serif",
  gridStroke: "rgba(215, 170, 69, 0.12)",
  referenceLine: "rgba(215, 170, 69, 0.45)",
  bodyColor: "#5b95ff",
  wickColor: "#ffa566",
  errorColor: "#d85a4f",
  tooltipBg: "#0f150e",
  tooltipBorder: "rgba(215, 170, 69, 0.45)",
  tooltipText: "#f3ead2",
  tooltipMutedText: "#b8aa8a",
} as const;

/**
 * Markup for the Alea wordmark + dice — shared across reports so brand
 * presentation stays consistent. Use inside `.alea-brand-row`.
 */
export function aleaBrandMark(): string {
  return `
    <span class="alea-mark" aria-hidden="true">${aleaDiceMarkSvg}</span>
    <span class="alea-wordmark">Alea</span>
  `;
}

/**
 * <head>-time payload: external font links + <link rel="stylesheet"> tags
 * for each stylesheet in `stylesheets` (in order). The stylesheets are
 * the relative hrefs returned by `copyDashboardAssets` — typically
 * `[<...>/alea.css, <...>/<page>.css]`.
 */
export function aleaDesignSystemHead({
  stylesheets,
}: {
  readonly stylesheets: readonly string[];
}): string {
  const links = stylesheets
    .map((href) => `<link rel="stylesheet" href="${href}" />`)
    .join("\n");
  return `
<link rel="preconnect" href="https://fonts.googleapis.com" />
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
<link href="https://fonts.googleapis.com/css2?family=Cormorant+Garamond:wght@500;600;700&family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet" />
${links}
`.trim();
}

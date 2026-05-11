/**
 * Top-level page navigation shared by every static dashboard. Each
 * report renders the same horizontal bar of links with a different
 * `activeId`, so the navigation feels persistent across pages even
 * though each page is a standalone HTML asset served by Wrangler.
 *
 * Hrefs target the layout produced by `dashboards:build`: trading
 * performance is the worker's index (`/`); the research and runtime
 * dashboards live under their own route folders.
 */

type TopNavPage = {
  readonly id: string;
  readonly label: string;
  readonly href: string;
};

const TOP_NAV_PAGES: readonly TopNavPage[] = [
  { id: "exploration", label: "Exploration", href: "/exploration/" },
  { id: "committee", label: "Trade committee", href: "/committee/" },
  { id: "dryrun", label: "Dry run", href: "/dryrun/" },
  { id: "live", label: "Live trading", href: "/" },
];

export function renderTopNav({
  activeId,
}: {
  readonly activeId: string;
}): string {
  const items = TOP_NAV_PAGES.map((page) => {
    const isActive = page.id === activeId;
    const cls = isActive ? "alea-topnav-link active" : "alea-topnav-link";
    const ariaCurrent = isActive ? ' aria-current="page"' : "";
    return `<a class="${cls}" href="${escapeHtml(page.href)}"${ariaCurrent}>${escapeHtml(page.label)}</a>`;
  }).join("");
  return `<nav class="alea-topnav" aria-label="Dashboards">${items}</nav>`;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

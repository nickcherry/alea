import { renderExplorationHtml } from "@alea/lib/exploration/renderExplorationHtml";
import type { ExplorationPayload } from "@alea/lib/exploration/types";
import { describe, expect, it } from "bun:test";

describe("renderExplorationHtml", () => {
  it("renders an empty state for an empty payload instead of a blank route", () => {
    const html = renderExplorationHtml({
      payload: emptyPayload(),
      assets: { stylesheets: [], scripts: [] },
    });

    expect(html).toContain('href="/exploration/" aria-current="page"');
    expect(html).toContain('id="filter-stack"');
    expect(html).toContain("No Exploration Rows");
    expect(html).toContain("No filter-run rows exist");
    expect(html).toContain('"rowCount":0');
  });
});

function emptyPayload(): ExplorationPayload {
  return {
    generatedAtMs: 1_778_517_600_000,
    rowCount: 0,
    rows: [],
  };
}

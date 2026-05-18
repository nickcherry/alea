import { fetchPolymarketResolution } from "@alea/lib/polymarket/fetchResolution";
import { afterEach, beforeEach, describe, expect, it, mock } from "bun:test";

/**
 * Unit tests for the gamma-api response parser. Exercise the
 * outcome-derivation branches (up / down / void / pending) and the
 * missing-slug + timestamp parsing edge cases by stubbing global
 * `fetch`.
 */

const originalFetch = globalThis.fetch;

function mockJsonResponse(body: unknown): typeof originalFetch {
  return mock(
    async () =>
      new Response(JSON.stringify(body), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
  ) as unknown as typeof originalFetch;
}

describe("fetchPolymarketResolution", () => {
  beforeEach(() => {
    globalThis.fetch = originalFetch;
  });
  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("returns missing when the slug response is empty", async () => {
    globalThis.fetch = mockJsonResponse([]);
    const result = await fetchPolymarketResolution({
      asset: "btc",
      timeframe: "1h",
      windowStartTsMs: 1_700_000_000_000,
    });
    expect(result.kind).toBe("missing");
  });

  it("returns resolved up when outcomePrices is [1, 0]", async () => {
    globalThis.fetch = mockJsonResponse([
      {
        slug: "bitcoin-up-or-down-nov-14-2023-10pm-et",
        markets: [
          {
            conditionId: "0xCOND",
            outcomePrices: '["1", "0"]',
            umaResolutionStatus: "resolved",
            closedTime: "2026-05-10 17:35:17+00",
          },
        ],
      },
    ]);
    const result = await fetchPolymarketResolution({
      asset: "btc",
      timeframe: "1h",
      windowStartTsMs: 1_700_000_000_000,
    });
    expect(result.kind).toBe("resolved");
    if (result.kind !== "resolved") {
      return;
    }
    expect(result.resolution.outcome).toBe("up");
    expect(result.resolution.conditionId).toBe("0xCOND");
    expect(result.resolution.umaStatus).toBe("resolved");
    expect(result.resolution.resolvedAtMs).toBe(
      Date.parse("2026-05-10 17:35:17+00"),
    );
  });

  it("returns resolved down when outcomePrices is [0, 1]", async () => {
    globalThis.fetch = mockJsonResponse([
      {
        slug: "bitcoin-up-or-down-nov-14-2023-10pm-et",
        markets: [
          {
            conditionId: "0xCOND",
            outcomePrices: '["0", "1"]',
            umaResolutionStatus: "resolved",
            umaEndDate: "2026-05-10T17:35:17Z",
          },
        ],
      },
    ]);
    const result = await fetchPolymarketResolution({
      asset: "btc",
      timeframe: "1h",
      windowStartTsMs: 1_700_000_000_000,
    });
    expect(result.kind).toBe("resolved");
    if (result.kind !== "resolved") {
      return;
    }
    expect(result.resolution.outcome).toBe("down");
    expect(result.resolution.resolvedAtMs).toBe(
      Date.parse("2026-05-10T17:35:17Z"),
    );
  });

  it("returns resolved void when both legs are 0", async () => {
    globalThis.fetch = mockJsonResponse([
      {
        slug: "bitcoin-up-or-down-nov-14-2023-10pm-et",
        markets: [
          {
            conditionId: "0xCOND",
            outcomePrices: '["0", "0"]',
            umaResolutionStatus: "disputed",
          },
        ],
      },
    ]);
    const result = await fetchPolymarketResolution({
      asset: "btc",
      timeframe: "1h",
      windowStartTsMs: 1_700_000_000_000,
    });
    expect(result.kind).toBe("resolved");
    if (result.kind !== "resolved") {
      return;
    }
    expect(result.resolution.outcome).toBe("void");
    expect(result.resolution.umaStatus).toBe("disputed");
  });

  it("returns pending when outcomePrices is absent", async () => {
    globalThis.fetch = mockJsonResponse([
      {
        slug: "bitcoin-up-or-down-nov-14-2023-10pm-et",
        markets: [
          {
            conditionId: "0xCOND",
            umaResolutionStatus: "pending",
          },
        ],
      },
    ]);
    const result = await fetchPolymarketResolution({
      asset: "btc",
      timeframe: "1h",
      windowStartTsMs: 1_700_000_000_000,
    });
    expect(result.kind).toBe("pending");
  });

  it("builds hourly slugs in the venue's ET slug family", async () => {
    let capturedUrl = "";
    globalThis.fetch = mock(async (input: string | URL | Request) => {
      capturedUrl =
        typeof input === "string"
          ? input
          : input instanceof URL
            ? input.toString()
            : input.url;
      return new Response(JSON.stringify([]), { status: 200 });
    }) as unknown as typeof originalFetch;
    await fetchPolymarketResolution({
      asset: "doge",
      timeframe: "1h",
      windowStartTsMs: 1_779_048_000_000,
    });
    expect(capturedUrl).toContain("dogecoin-up-or-down-may-17-2026-4pm-et");
  });
});

import { describe, expect, test } from "bun:test";

import { wilsonInterval95 } from "@alea/lib/exploration/wilsonInterval";

describe("wilsonInterval95", () => {
  test("returns [0, 1] for zero samples (no information)", () => {
    expect(wilsonInterval95({ wins: 0, n: 0 })).toEqual({ low: 0, high: 1 });
  });

  test("centers near 50% for a large balanced sample", () => {
    // 5000 / 10000 → CI should be tight around 0.5
    const ci = wilsonInterval95({ wins: 5000, n: 10000 });
    expect(ci.low).toBeGreaterThan(0.49);
    expect(ci.low).toBeLessThan(0.5);
    expect(ci.high).toBeGreaterThan(0.5);
    expect(ci.high).toBeLessThan(0.51);
  });

  test("widens dramatically at small n", () => {
    // 3 / 5 — CI should span most of the [0, 1] range
    const ci = wilsonInterval95({ wins: 3, n: 5 });
    expect(ci.high - ci.low).toBeGreaterThan(0.5);
  });

  test("clamps to [0, 1]", () => {
    const ci = wilsonInterval95({ wins: 0, n: 10 });
    expect(ci.low).toBe(0);
    expect(ci.high).toBeGreaterThan(0);
    expect(ci.high).toBeLessThan(1);
  });

  test("matches a known textbook value (10/10 → upper bound near 1)", () => {
    const ci = wilsonInterval95({ wins: 10, n: 10 });
    // Wilson upper bound for 10/10 at z=1.96 is 1, lower ~0.722
    expect(ci.high).toBe(1);
    expect(ci.low).toBeGreaterThan(0.7);
    expect(ci.low).toBeLessThan(0.75);
  });
});

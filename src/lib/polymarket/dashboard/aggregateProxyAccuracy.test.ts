import {
  aggregateProxyAccuracy,
  histogramByMovePct,
  type ProxyAccuracyEntry,
} from "@alea/lib/polymarket/dashboard/aggregateProxyAccuracy";
import { describe, expect, it } from "bun:test";

const CLEAR_PCT = 0.01;

describe("aggregateProxyAccuracy", () => {
  it("returns zeros for empty input", () => {
    const agg = aggregateProxyAccuracy({
      entries: [],
      clearMovePct: CLEAR_PCT,
    });
    expect(agg.total).toBe(0);
    expect(agg.agreed).toBe(0);
    expect(agg.disagreed).toBe(0);
    expect(agg.agreementRate).toBeNull();
    expect(agg.disagreeMeanMovePct).toBeNull();
    expect(agg.disagreeBelowClearShare).toBeNull();
  });

  it("counts agreements and disagreements separately", () => {
    const entries: readonly ProxyAccuracyEntry[] = [
      { polyOutcome: "up", pythOutcome: "up", absMovePct: 0.5 },
      { polyOutcome: "down", pythOutcome: "down", absMovePct: 0.2 },
      { polyOutcome: "down", pythOutcome: "up", absMovePct: 0.001 },
    ];
    const agg = aggregateProxyAccuracy({ entries, clearMovePct: CLEAR_PCT });
    expect(agg.total).toBe(3);
    expect(agg.agreed).toBe(2);
    expect(agg.disagreed).toBe(1);
    expect(agg.agreementRate).toBeCloseTo(2 / 3);
  });

  it("classifies disagreements as below-clear vs. clear-move", () => {
    const entries: readonly ProxyAccuracyEntry[] = [
      // Sub-bp disagreement → below clear threshold
      { polyOutcome: "down", pythOutcome: "up", absMovePct: 0.005 },
      // 5 bp disagreement → clear-move disagreement
      { polyOutcome: "up", pythOutcome: "down", absMovePct: 0.05 },
    ];
    const agg = aggregateProxyAccuracy({ entries, clearMovePct: CLEAR_PCT });
    expect(agg.disagreed).toBe(2);
    expect(agg.clearDisagreements).toBe(1);
    expect(agg.disagreeBelowClearShare).toBeCloseTo(0.5);
  });

  it("computes mean and median over disagreement moves only", () => {
    const entries: readonly ProxyAccuracyEntry[] = [
      // Agreements contribute large moves that must NOT pollute the
      // disagreement statistics.
      { polyOutcome: "up", pythOutcome: "up", absMovePct: 5.0 },
      { polyOutcome: "down", pythOutcome: "down", absMovePct: 5.0 },
      // Disagreement moves: 0.01, 0.05, 0.1 → mean ≈ 0.0533, median = 0.05
      { polyOutcome: "down", pythOutcome: "up", absMovePct: 0.01 },
      { polyOutcome: "up", pythOutcome: "down", absMovePct: 0.05 },
      { polyOutcome: "down", pythOutcome: "up", absMovePct: 0.1 },
    ];
    const agg = aggregateProxyAccuracy({ entries, clearMovePct: CLEAR_PCT });
    expect(agg.disagreed).toBe(3);
    expect(agg.disagreeMeanMovePct).toBeCloseTo((0.01 + 0.05 + 0.1) / 3);
    expect(agg.disagreeMedianMovePct).toBeCloseTo(0.05);
  });
});

describe("histogramByMovePct", () => {
  it("bucketizes by move size with the canonical boundaries", () => {
    const moves = [
      0.001, // < 1 bp
      0.005, // < 1 bp
      0.015, // 1–2 bp
      0.03, //  2–5 bp
      0.08, //  5–10 bp
      0.6, //  ≥ 50 bp
    ];
    const buckets = histogramByMovePct({ moves });
    expect(buckets).toHaveLength(7);
    expect(buckets[0]?.count).toBe(2); // < 1 bp
    expect(buckets[1]?.count).toBe(1); // 1–2 bp
    expect(buckets[2]?.count).toBe(1); // 2–5 bp
    expect(buckets[3]?.count).toBe(1); // 5–10 bp
    expect(buckets[4]?.count).toBe(0); // 10–20 bp
    expect(buckets[5]?.count).toBe(0); // 20–50 bp
    expect(buckets[6]?.count).toBe(1); // ≥ 50 bp
  });

  it("labels boundary buckets with bp units", () => {
    const buckets = histogramByMovePct({ moves: [] });
    expect(buckets[0]?.label).toBe("< 1 bp");
    expect(buckets[1]?.label).toBe("1 bp–2 bp");
    expect(buckets[6]?.label).toBe("≥ 50 bp");
  });
});

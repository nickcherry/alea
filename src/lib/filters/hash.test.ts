import { candidateHash, canonicalJson, runHash } from "@alea/lib/filters/hash";
import { describe, expect, it } from "bun:test";

describe("canonicalJson", () => {
  it("handles primitives", () => {
    expect(canonicalJson(null)).toBe("null");
    expect(canonicalJson(true)).toBe("true");
    expect(canonicalJson(42)).toBe("42");
    expect(canonicalJson("hi")).toBe('"hi"');
  });

  it("sorts object keys deterministically", () => {
    expect(canonicalJson({ b: 1, a: 2 })).toBe(canonicalJson({ a: 2, b: 1 }));
    expect(canonicalJson({ a: 2, b: 1 })).toBe('{"a":2,"b":1}');
  });

  it("preserves array order", () => {
    expect(canonicalJson([3, 1, 2])).toBe("[3,1,2]");
    expect(canonicalJson([3, 1, 2])).not.toBe(canonicalJson([1, 2, 3]));
  });

  it("recurses through nested objects + arrays", () => {
    const a = { x: { b: 2, a: 1 }, y: [{ q: 9, p: 8 }] };
    const b = { y: [{ p: 8, q: 9 }], x: { a: 1, b: 2 } };
    expect(canonicalJson(a)).toBe(canonicalJson(b));
  });
});

describe("candidateHash", () => {
  it("is deterministic", () => {
    const args = { filterId: "rsi", version: 1, configCanon: '{"len":14}' };
    expect(candidateHash(args)).toBe(candidateHash(args));
  });

  it("changes when filter id changes", () => {
    const a = candidateHash({
      filterId: "rsi",
      version: 1,
      configCanon: '{"len":14}',
    });
    const b = candidateHash({
      filterId: "sma",
      version: 1,
      configCanon: '{"len":14}',
    });
    expect(a).not.toBe(b);
  });

  it("changes when version changes (cache-bust)", () => {
    const a = candidateHash({
      filterId: "rsi",
      version: 1,
      configCanon: '{"len":14}',
    });
    const b = candidateHash({
      filterId: "rsi",
      version: 2,
      configCanon: '{"len":14}',
    });
    expect(a).not.toBe(b);
  });

  it("changes when config changes", () => {
    const a = candidateHash({
      filterId: "rsi",
      version: 1,
      configCanon: '{"len":14}',
    });
    const b = candidateHash({
      filterId: "rsi",
      version: 1,
      configCanon: '{"len":21}',
    });
    expect(a).not.toBe(b);
  });
});

describe("runHash", () => {
  it("differs across (period, asset)", () => {
    const ch = candidateHash({
      filterId: "rsi",
      version: 1,
      configCanon: '{"len":14}',
    });
    const a = runHash({ candidateHash: ch, period: "5m", asset: "btc" });
    const b = runHash({ candidateHash: ch, period: "15m", asset: "btc" });
    const c = runHash({ candidateHash: ch, period: "5m", asset: "eth" });
    expect(new Set([a, b, c]).size).toBe(3);
  });
});

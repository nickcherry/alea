import {
  sessionForWindow,
  windowStartFor,
} from "@alea/lib/marketCapture/session";
import { describe, expect, it } from "bun:test";

describe("windowStartFor", () => {
  it("floors to the most recent hourly UTC boundary", () => {
    const inWindow = Date.parse("2026-05-05T12:34:56.789Z");
    const expected = Date.parse("2026-05-05T12:00:00.000Z");
    expect(windowStartFor({ nowMs: inWindow })).toBe(expected);
  });

  it("returns the boundary itself when nowMs is already aligned", () => {
    const aligned = Date.parse("2026-05-05T12:00:00.000Z");
    expect(windowStartFor({ nowMs: aligned })).toBe(aligned);
  });
});

describe("sessionForWindow", () => {
  it("renders a UTC date subdir, window key, and matching filenames", () => {
    const session = sessionForWindow({
      windowStartMs: Date.parse("2026-05-05T12:00:00.000Z"),
    });
    expect(session.relativeDir).toBe("2026-05-05");
    expect(session.windowKey).toBe("2026-05-05T12-00");
    expect(session.fileName).toBe("2026-05-05T12-00.jsonl");
    expect(session.completeFileName).toBe("2026-05-05T12-00.jsonl.complete");
  });

  it("zero-pads single-digit components", () => {
    const session = sessionForWindow({
      windowStartMs: Date.parse("2026-01-02T03:00:00.000Z"),
    });
    expect(session.relativeDir).toBe("2026-01-02");
    expect(session.windowKey).toBe("2026-01-02T03-00");
  });
});

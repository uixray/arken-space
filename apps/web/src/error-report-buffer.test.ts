import { describe, expect, it } from "vitest";
import {
  MAX_BUFFERED_REPORTS,
  computeErrorSignature,
  enqueueErrorReport,
  loadReports,
  parseStackFrames,
  pruneReports,
  removeReport,
  saveReports,
  toWirePayload,
  type BufferedErrorReport,
} from "./error-report-buffer";

function memoryStorage() {
  const backing = new Map<string, string>();
  return {
    getItem: (key: string) => backing.get(key) ?? null,
    setItem: (key: string, value: string) => {
      backing.set(key, value);
    },
  };
}

const V8_STACK = [
  "TypeError: Cannot read properties of undefined (reading 'x')",
  "    at handleClick (http://localhost/assets/index-BK6doIJ2.js:1:12345)",
  "    at HTMLButtonElement.onClick (http://localhost/assets/index-BK6doIJ2.js:1:9999)",
  "    at new Constructor (http://localhost/assets/index-BK6doIJ2.js:1:1)",
].join("\n");

describe("parseStackFrames", () => {
  it("extracts structural frames from a V8 stack, skipping the message line", () => {
    const frames = parseStackFrames(V8_STACK);
    expect(frames).toHaveLength(3);
    expect(frames[0]).toEqual({
      function: "handleClick",
      file: "http://localhost/assets/index-BK6doIJ2.js",
      line: 1,
      column: 12345,
    });
    expect(frames[2]!.function).toBe("new Constructor");
  });

  it("bounds frame count and per-field length", () => {
    const longFn = "f".repeat(500);
    const manyLines = Array.from(
      { length: 50 },
      (_, i) => `    at ${longFn} (file.js:${i}:1)`,
    ).join("\n");
    const frames = parseStackFrames(manyLines, 10);
    expect(frames).toHaveLength(10);
    for (const frame of frames)
      expect(frame.function!.length).toBeLessThanOrEqual(200);
  });

  it("returns an empty array for missing or unparseable stacks", () => {
    expect(parseStackFrames(undefined)).toEqual([]);
    expect(parseStackFrames("not a stack trace")).toEqual([]);
  });
});

describe("computeErrorSignature", () => {
  it("is stable for the same error shape regardless of message", () => {
    const frames = parseStackFrames(V8_STACK);
    const a = computeErrorSignature({
      errorName: "TypeError",
      event: "window.error",
      stackFrames: frames,
    });
    const b = computeErrorSignature({
      errorName: "TypeError",
      event: "window.error",
      stackFrames: frames,
    });
    expect(a).toBe(b);
  });

  it("differs for a different error class or location", () => {
    const frames = parseStackFrames(V8_STACK);
    const base = computeErrorSignature({
      errorName: "TypeError",
      event: "window.error",
      stackFrames: frames,
    });
    const otherClass = computeErrorSignature({
      errorName: "RangeError",
      event: "window.error",
      stackFrames: frames,
    });
    const otherFrames = computeErrorSignature({
      errorName: "TypeError",
      event: "window.error",
      stackFrames: [{ file: "other.js", line: 1, column: 1 }],
    });
    expect(otherClass).not.toBe(base);
    expect(otherFrames).not.toBe(base);
  });
});

describe("enqueueErrorReport dedup", () => {
  it("collapses N identical errors into one record with occurrenceCount N", () => {
    let reports: BufferedErrorReport[] = [];
    for (let i = 0; i < 5; i += 1)
      reports = enqueueErrorReport(reports, {
        level: "error",
        event: "window.error",
        errorName: "TypeError",
        stack: V8_STACK,
        message: `unrelated message ${i}`,
      });
    expect(reports).toHaveLength(1);
    expect(reports[0]!.occurrenceCount).toBe(5);
  });

  it("keeps distinct signatures as separate records", () => {
    let reports: BufferedErrorReport[] = [];
    reports = enqueueErrorReport(reports, {
      level: "error",
      event: "window.error",
      errorName: "TypeError",
      stack: V8_STACK,
    });
    reports = enqueueErrorReport(reports, {
      level: "error",
      event: "window.error",
      errorName: "RangeError",
      stack: V8_STACK,
    });
    expect(reports).toHaveLength(2);
  });
});

describe("pruneReports bounds", () => {
  function report(
    overrides: Partial<BufferedErrorReport>,
  ): BufferedErrorReport {
    return {
      id: overrides.id ?? Math.random().toString(36),
      level: "error",
      event: "window.error",
      stackFrames: [],
      signature: overrides.id ?? Math.random().toString(36),
      occurrenceCount: 1,
      firstAt: "2026-08-10T00:00:00.000Z",
      lastAt: "2026-08-10T00:00:00.000Z",
      ...overrides,
    };
  }

  it("drops entries older than the age bound", () => {
    const now = "2026-08-10T12:00:00.000Z";
    const fresh = report({
      id: "fresh",
      signature: "fresh",
      lastAt: "2026-08-10T11:00:00.000Z",
    });
    const stale = report({
      id: "stale",
      signature: "stale",
      lastAt: "2026-08-08T00:00:00.000Z",
    });
    const result = pruneReports([fresh, stale], now);
    expect(result.map((r) => r.id)).toEqual(["fresh"]);
  });

  it("drops oldest-first once past the count bound", () => {
    const now = "2026-08-10T12:00:00.000Z";
    const many = Array.from({ length: MAX_BUFFERED_REPORTS + 5 }, (_, i) =>
      report({
        id: `r${i}`,
        signature: `r${i}`,
        lastAt: new Date(
          Date.parse(now) - (MAX_BUFFERED_REPORTS + 5 - i) * 1000,
        ).toISOString(),
      }),
    );
    const result = pruneReports(many, now);
    expect(result).toHaveLength(MAX_BUFFERED_REPORTS);
    // The oldest entries (r0..r4) should have been dropped; the newest kept.
    expect(result.some((r) => r.id === "r0")).toBe(false);
    expect(result.some((r) => r.id === `r${MAX_BUFFERED_REPORTS + 4}`)).toBe(
      true,
    );
  });
});

describe("durable storage", () => {
  it("survives a simulated reload via localStorage-like persistence", () => {
    const storage = memoryStorage();
    let reports = enqueueErrorReport([], {
      level: "error",
      event: "window.error",
      errorName: "TypeError",
      stack: V8_STACK,
    });
    saveReports(reports, storage);

    // Simulate a fresh page load reading the buffer back from storage.
    const reloaded = loadReports(storage);
    expect(reloaded).toHaveLength(1);
    expect(reloaded[0]!.occurrenceCount).toBe(1);

    reports = removeReport(reloaded, reloaded[0]!.id);
    saveReports(reports, storage);
    expect(loadReports(storage)).toHaveLength(0);
  });

  it("ignores corrupted persisted data instead of throwing", () => {
    const storage = memoryStorage();
    storage.setItem("arken.client-error-buffer.v1", "{not json");
    expect(loadReports(storage)).toEqual([]);
  });
});

describe("privacy: free-form content never reaches the wire payload's structural fields", () => {
  it("keeps user content confined to `message`, which the server already discards", () => {
    const privateContent =
      "Эльрис: секретная заметка ГМа про игрока — не показывать";
    const reports = enqueueErrorReport([], {
      level: "error",
      event: "window.error",
      message: privateContent,
      errorName: "TypeError",
      stack: `TypeError: ${privateContent}\n    at handleClick (file.js:1:1)`,
    });
    const payload = toWirePayload(reports[0]!);

    // The structural fields the server actually persists/derives from must
    // never contain the private text, even though it was thrown right next
    // to it in the Error message.
    expect(JSON.stringify(payload.stack)).not.toContain("Эльрис");
    expect(JSON.stringify(payload.stack)).not.toContain("секретная");
    expect(payload.errorName).toBe("TypeError");
    expect(payload.occurrenceCount).toBe(1);
  });
});

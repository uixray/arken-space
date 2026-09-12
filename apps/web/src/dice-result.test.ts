import { describe, expect, it } from "vitest";
import { formatDiceBreakdown, normalizeClientDiceResult } from "./dice-result";

const valid = {
  formula: "1d20",
  resolvedFormula: "1d20",
  terms: [{ notation: "1d20", rolls: [12], subtotal: 12 }],
  modifiers: [],
  total: 12,
};

describe("normalizeClientDiceResult", () => {
  it("keeps a bounded complete result", () => {
    expect(normalizeClientDiceResult(valid)).toEqual(valid);
  });

  it("rejects malformed or unbounded client payloads", () => {
    expect(normalizeClientDiceResult({ total: 20 })).toBeNull();
    expect(normalizeClientDiceResult({ ...valid, terms: {} })).toBeNull();
    expect(normalizeClientDiceResult({ ...valid, total: Infinity })).toBeNull();
    expect(
      normalizeClientDiceResult({
        ...valid,
        terms: [{ ...valid.terms[0], rolls: Array(101).fill(1) }],
      }),
    ).toBeNull();
  });

  it("distinguishes legacy absence from invalid present semantic metadata", () => {
    expect(normalizeClientDiceResult(valid)).toEqual(valid);
    expect(
      normalizeClientDiceResult({
        ...valid,
        semanticOutcome: { kind: "CRITICAL_SUCCESS", keptNaturalD20: 1 },
      }),
    ).toBeNull();
    expect(
      normalizeClientDiceResult({
        ...valid,
        semanticOutcome: { kind: "20", keptNaturalD20: 20 },
      }),
    ).toBeNull();
  });

  it("canonicalizes semantic and matching frame metadata without mutating input", () => {
    const input = {
      ...valid,
      semanticOutcome: {
        kind: "CRITICAL_SUCCESS",
        keptNaturalD20: 20,
        total: 20,
      },
      frame: {
        setKey: "ARKEN_CRITICAL_V1",
        frameKey: "critical-success",
        url: "https://untrusted.invalid/frame.png",
      },
    };
    const before = structuredClone(input);
    expect(normalizeClientDiceResult(input)).toEqual({
      ...valid,
      semanticOutcome: {
        kind: "CRITICAL_SUCCESS",
        keptNaturalD20: 20,
      },
      frame: {
        setKey: "ARKEN_CRITICAL_V1",
        frameKey: "critical-success",
      },
    });
    expect(input).toEqual(before);
  });

  it("preserves absent frame and sanitizes every present invalid frame to null", () => {
    const semanticOutcome = { kind: "NORMAL", keptNaturalD20: 20 };
    const absent = normalizeClientDiceResult({ ...valid, semanticOutcome });
    expect(absent).not.toHaveProperty("frame");
    expect(
      normalizeClientDiceResult({ ...valid, semanticOutcome, frame: null }),
    ).toMatchObject({ frame: null });
    expect(
      normalizeClientDiceResult({
        ...valid,
        semanticOutcome,
        frame: {
          setKey: "ARKEN_CRITICAL_V1",
          frameKey: "critical-success",
        },
      }),
    ).toMatchObject({ total: 12, semanticOutcome, frame: null });
  });

  it("keeps legacy non-d20 results and does not infer semantic metadata", () => {
    const legacy = {
      ...valid,
      formula: "1d8",
      resolvedFormula: "1d8",
      terms: [{ notation: "1d8", rolls: [1], subtotal: 1 }],
      total: 1,
    };
    expect(normalizeClientDiceResult(legacy)).toEqual(legacy);
  });
});

describe("formatDiceBreakdown", () => {
  it("shows both advantage pools and the selected result", () => {
    expect(
      formatDiceBreakdown({
        ...valid,
        total: 16,
        terms: [{ notation: "1d20", rolls: [16], subtotal: 16 }],
        rollMode: "ADVANTAGE",
        poolTotals: [7, 16],
        selectedPool: 1,
      }),
    ).toBe("1d20 (16) · Выпало: 7 и 16 → выбран 16");
  });

  it("still formats a valid roll when decorative frame metadata is invalid", () => {
    expect(
      formatDiceBreakdown({
        ...valid,
        frame: {
          setKey: "UNKNOWN",
          frameKey: "https://untrusted.invalid/frame.png",
        },
      }),
    ).toBe("1d20 (12)");
  });
});

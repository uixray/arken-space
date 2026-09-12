import { describe, expect, it } from "vitest";
import {
  normalizeDiceFrameReference,
  parseDiceSemanticOutcome,
} from "./dice-outcome";

describe("parseDiceSemanticOutcome", () => {
  it.each([
    [{ kind: "CRITICAL_FAILURE", keptNaturalD20: 1 }, "CRITICAL_FAILURE", 1],
    [{ kind: "CRITICAL_SUCCESS", keptNaturalD20: 20 }, "CRITICAL_SUCCESS", 20],
    [{ kind: "NORMAL", keptNaturalD20: null }, "NORMAL", null],
    [{ kind: "NORMAL", keptNaturalD20: 1 }, "NORMAL", 1],
    [{ kind: "NORMAL", keptNaturalD20: 12 }, "NORMAL", 12],
    [{ kind: "NORMAL", keptNaturalD20: 20 }, "NORMAL", 20],
  ] as const)("canonicalizes %j", (input, kind, keptNaturalD20) => {
    expect(parseDiceSemanticOutcome(input)).toEqual({ kind, keptNaturalD20 });
  });

  it.each([
    null,
    "CRITICAL_SUCCESS",
    { kind: "CRITICAL_FAILURE", keptNaturalD20: 20 },
    { kind: "CRITICAL_SUCCESS", keptNaturalD20: 1 },
    { kind: "NORMAL", keptNaturalD20: 0 },
    { kind: "NORMAL", keptNaturalD20: 21 },
    { kind: "NORMAL", keptNaturalD20: 1.5 },
    { kind: "NORMAL", keptNaturalD20: "20" },
    { kind: { toString: () => "NORMAL" }, keptNaturalD20: 12 },
    { kind: "UNKNOWN", keptNaturalD20: 12 },
    { kind: "NORMAL" },
  ])("rejects invalid semantic %j", (input) => {
    expect(parseDiceSemanticOutcome(input)).toBeNull();
  });

  it("rejects arrays even when they carry otherwise valid properties", () => {
    expect(parseDiceSemanticOutcome([])).toBeNull();
    expect(
      parseDiceSemanticOutcome(
        Object.assign([], {
          kind: "CRITICAL_SUCCESS",
          keptNaturalD20: 20,
        }),
      ),
    ).toBeNull();
  });

  it("does not mutate input and drops extra fields", () => {
    const input = {
      kind: "CRITICAL_SUCCESS",
      keptNaturalD20: 20,
      assetId: "private-asset",
    };
    const before = structuredClone(input);
    expect(parseDiceSemanticOutcome(input)).toEqual({
      kind: "CRITICAL_SUCCESS",
      keptNaturalD20: 20,
    });
    expect(input).toEqual(before);
  });
});

describe("normalizeDiceFrameReference", () => {
  const failure = { kind: "CRITICAL_FAILURE", keptNaturalD20: 1 } as const;
  const success = { kind: "CRITICAL_SUCCESS", keptNaturalD20: 20 } as const;

  it("keeps only a canonical frame matching a valid critical outcome", () => {
    expect(
      normalizeDiceFrameReference(
        {
          setKey: "ARKEN_CRITICAL_V1",
          frameKey: "critical-success",
          url: "https://untrusted.invalid/frame.png",
          assetId: "private-asset",
        },
        success,
      ),
    ).toEqual({
      setKey: "ARKEN_CRITICAL_V1",
      frameKey: "critical-success",
    });
    expect(
      normalizeDiceFrameReference(
        { setKey: "ARKEN_CRITICAL_V1", frameKey: "critical-failure" },
        failure,
      ),
    ).toEqual({
      setKey: "ARKEN_CRITICAL_V1",
      frameKey: "critical-failure",
    });
  });

  it.each([
    [undefined, success],
    [null, success],
    [[], success],
    [{ setKey: "UNKNOWN", frameKey: "critical-success" }, success],
    [{ setKey: "ARKEN_CRITICAL_V1", frameKey: "unknown" }, success],
    [{ setKey: "ARKEN_CRITICAL_V1", frameKey: "critical-failure" }, success],
    [{ setKey: "ARKEN_CRITICAL_V1", frameKey: "critical-success" }, failure],
    [{ setKey: "ARKEN_CRITICAL_V1", frameKey: "critical-success" }, null],
    [
      { setKey: "ARKEN_CRITICAL_V1", frameKey: "critical-success" },
      { kind: "NORMAL", keptNaturalD20: 20 },
    ],
    [
      { setKey: "ARKEN_CRITICAL_V1", frameKey: "critical-success" },
      { kind: "CRITICAL_SUCCESS", keptNaturalD20: 1 },
    ],
  ])(
    "drops invalid, orphan, opposite, or normal frame %#",
    (frame, outcome) => {
      expect(
        normalizeDiceFrameReference(
          frame,
          outcome as Parameters<typeof normalizeDiceFrameReference>[1],
        ),
      ).toBeNull();
    },
  );
});

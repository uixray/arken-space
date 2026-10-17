import { describe, expect, it } from "vitest";
import { shareStructure } from "./structural-sharing";

describe("shareStructure", () => {
  it("keeps unchanged slices and replaces only the changed path", () => {
    const previous = {
      tokens: [
        { id: "a", x: 1 },
        { id: "b", x: 2 },
      ],
      scenes: [{ id: "s", grid: { size: 64 } }],
      messages: [{ id: "m1" }],
      snapshotVersion: 1,
    };
    const next = structuredClone(previous);
    next.messages.push({ id: "m2" });
    next.snapshotVersion = 2;
    const shared = shareStructure(previous, next);
    expect(shared).toEqual(next);
    expect(shared).not.toBe(previous);
    expect(shared.tokens).toBe(previous.tokens);
    expect(shared.scenes).toBe(previous.scenes);
    expect(shared.messages).not.toBe(previous.messages);
    expect(shared.messages[0]).toBe(previous.messages[0]);
  });

  it("keeps unchanged siblings when one item of a list changes", () => {
    const previous = {
      tokens: [
        { id: "a", x: 1 },
        { id: "b", x: 2 },
      ],
    };
    const next = {
      tokens: [
        { id: "a", x: 1 },
        { id: "b", x: 3 },
      ],
    };
    const shared = shareStructure(previous, next);
    expect(shared.tokens).not.toBe(previous.tokens);
    expect(shared.tokens[0]).toBe(previous.tokens[0]);
    expect(shared.tokens[1]).toEqual({ id: "b", x: 3 });
  });

  it("returns the previous value for a deep-equal snapshot", () => {
    const previous = { a: [1, { b: null }], c: "x" };
    expect(shareStructure(previous, structuredClone(previous))).toBe(previous);
  });

  it("detects removed keys, shorter lists and type changes", () => {
    expect(shareStructure({ a: 1, b: 2 }, { a: 1 })).toEqual({ a: 1 });
    expect(shareStructure([1, 2], [1])).toEqual([1]);
    expect(shareStructure({ a: [1] }, { a: { 0: 1 } })).toEqual({
      a: { 0: 1 },
    });
    const date = new Date(0);
    expect(shareStructure({ d: new Date(0) }, { d: date }).d).toBe(date);
  });
});

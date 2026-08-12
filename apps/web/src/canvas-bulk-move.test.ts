import { describe, expect, it } from "vitest";
import { applyBulkMoveResult } from "./canvas-bulk-move";

const token = (id: string, x: number, y: number, revision: number) => ({
  id,
  x,
  y,
  revision,
});

describe("applyBulkMoveResult", () => {
  it("applies the delta and the server's revision to moved items", () => {
    const untouched = token("b", 0, 0, 7);
    const result = applyBulkMoveResult(
      [token("a", 10, 20, 3), untouched],
      { a: 4 },
      { x: 5, y: -2 },
    );
    expect(result[0]).toEqual({ id: "a", x: 15, y: 18, revision: 4 });
    // Items outside the move keep their object identity, so anything
    // memoized on them is not needlessly invalidated.
    expect(result[1]).toBe(untouched);
  });

  it("takes the revision from the server rather than incrementing locally", () => {
    // The server may skip numbers (another write landed in between). Guessing
    // revision+1 would send a stale value on the next mutation, which is the
    // whole failure this fixes.
    const [moved] = applyBulkMoveResult(
      [token("a", 0, 0, 3)],
      { a: 9 },
      {
        x: 0,
        y: 0,
      },
    );
    expect(moved?.revision).toBe(9);
  });

  it("lets a second immediate move send a fresh revision", () => {
    // The regression in one test: drag, then drag again before any broadcast.
    let tokens: readonly {
      id: string;
      x: number;
      y: number;
      revision: number;
    }[] = [token("a", 0, 0, 1)];
    tokens = applyBulkMoveResult(tokens, { a: 2 }, { x: 10, y: 0 });
    const revisionSentBySecondDrag = tokens[0]!.revision;
    expect(revisionSentBySecondDrag).toBe(2);
    tokens = applyBulkMoveResult(tokens, { a: 3 }, { x: 10, y: 0 });
    expect(tokens[0]).toEqual({ id: "a", x: 20, y: 0, revision: 3 });
  });

  it("returns the same array when nothing it holds was moved", () => {
    // Keeps an unrelated bulk move from re-rendering this collection.
    const tokens = [token("a", 1, 1, 1)];
    expect(applyBulkMoveResult(tokens, { other: 2 }, { x: 5, y: 5 })).toBe(
      tokens,
    );
    expect(applyBulkMoveResult(tokens, {}, { x: 5, y: 5 })).toBe(tokens);
    expect(applyBulkMoveResult(tokens, undefined, { x: 5, y: 5 })).toBe(tokens);
  });

  it("handles a zero delta without disturbing coordinates", () => {
    const [moved] = applyBulkMoveResult(
      [token("a", 4, 6, 1)],
      { a: 2 },
      {
        x: 0,
        y: 0,
      },
    );
    expect(moved).toEqual({ id: "a", x: 4, y: 6, revision: 2 });
  });
});

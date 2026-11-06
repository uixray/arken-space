import type { GameSnapshot, TokenDto } from "@arken/contracts";
import { describe, expect, it } from "vitest";
import {
  applyTokenPointEvent,
  applyTokenPreview,
  recordTokenRemovals,
} from "./token-point-events";

const token = (id: string, revision: number, sceneId = "scene-a", x = 0) =>
  ({ id, revision, sceneId, x, y: 0 }) as TokenDto;
const snapshot = (tokens: TokenDto[], snapshotVersion = 0) =>
  ({
    campaign: { id: "campaign" },
    me: { id: "gm" },
    tokens,
    snapshotVersion,
  }) as GameSnapshot;

describe("token realtime events", () => {
  it("applies a newer token revision even if another event advanced the global sequence", () => {
    const old = snapshot([token("a", 3), token("b", 1)], 120);
    const next = applyTokenPointEvent(
      old,
      { sequence: 119, data: token("a", 4, "scene-a", 80) },
      new Map(),
    );
    expect(next.tokens[0]).toMatchObject({ revision: 4, x: 80 });
    expect(next.snapshotVersion).toBe(120);
  });
  it("rejects older or duplicate committed moves and stale drag previews", () => {
    const current = snapshot([token("a", 5, "scene-a", 100)], 30);
    expect(
      applyTokenPointEvent(
        current,
        { sequence: 31, data: token("a", 4, "scene-a", 10) },
        new Map(),
      ),
    ).toBe(current);
    expect(
      applyTokenPointEvent(
        current,
        { sequence: 31, data: token("a", 5, "scene-a", 10) },
        new Map(),
      ),
    ).toBe(current);
    expect(
      applyTokenPreview(
        current,
        { tokenId: "a", revision: 4, x: 10, y: 10 },
        new Map(),
      ),
    ).toBe(current);
    expect(
      applyTokenPreview(
        current,
        { tokenId: "a", revision: 5, x: 15, y: 20 },
        new Map(),
      ).tokens[0],
    ).toMatchObject({ x: 15, y: 20, revision: 5 });
  });
  it("never recreates a deleted token; reused IDs reject events predating deletion", () => {
    const cursors = new Map<string, number>();
    const original = snapshot([token("a", 5)], 40);
    const deleted = snapshot([], 45);
    recordTokenRemovals(original, deleted, cursors);
    expect(
      applyTokenPointEvent(
        deleted,
        { sequence: 44, data: token("a", 6) },
        cursors,
      ),
    ).toBe(deleted);
    const recreated = snapshot([token("a", 0)], 50);
    expect(
      applyTokenPointEvent(
        recreated,
        { sequence: 44, data: token("a", 6) },
        cursors,
      ),
    ).toBe(recreated);
    expect(
      applyTokenPreview(
        recreated,
        { tokenId: "a", revision: 0, x: 8, y: 9 },
        cursors,
      ),
    ).toBe(recreated);
    expect(applyTokenPreview(recreated, { tokenId: "a", revision: 0, x: 99, y: 0, sceneId: "scene-a", snapshotVersion: 44 }, cursors)).toBe(recreated);
    expect(applyTokenPreview(recreated, { tokenId: "a", revision: 0, x: 8, y: 9, sceneId: "scene-a", snapshotVersion: 50 }, cursors).tokens[0]).toMatchObject({ x: 8, y: 9 });
    expect(applyTokenPreview(recreated, { tokenId: "a", revision: 0, x: 99, y: 0, sceneId: "scene-b", snapshotVersion: 50 }, cursors)).toBe(recreated);
    expect(
      applyTokenPointEvent(
        recreated,
        { sequence: 51, data: token("a", 1, "scene-a", 70) },
        cursors,
      ).tokens[0],
    ).toMatchObject({ revision: 1, x: 70 });
  });
  it("does not apply an old scene event after switching scenes", () => {
    const current = snapshot([token("a", 1, "scene-b", 9)], 70);
    expect(
      applyTokenPointEvent(
        current,
        { sequence: 69, data: token("a", 9, "scene-a", 80) },
        new Map(),
      ),
    ).toBe(current);
  });
  it("preserves token:updated's equal-revision projection while rejecting older revisions", () => {
    const current = snapshot([token("a", 4)], 80);
    expect(
      applyTokenPointEvent(
        current,
        { sequence: 79, data: token("a", 4, "scene-a", 5) },
        new Map(),
        true,
      ).tokens[0]?.x,
    ).toBe(5);
    expect(
      applyTokenPointEvent(
        current,
        { sequence: 81, data: token("a", 3) },
        new Map(),
        true,
      ),
    ).toBe(current);
  });
});

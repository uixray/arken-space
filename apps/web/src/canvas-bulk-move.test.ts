import { describe, expect, it } from "vitest";
import {
  acknowledgeBulkMoveIntent,
  appendBulkMoveIntent,
  projectBulkMoveIntents,
  reconcileBulkMoveIntents,
  rejectBulkMoveIntent,
  retainBulkMoveIntentsForScene,
  type CanvasBulkMoveIntent,
} from "./canvas-bulk-move";

const token = (id: string, x: number, revision: number, sceneId = "scene") => ({
  id,
  sceneId,
  x,
  y: 20,
  revision,
  name: `Token ${id}`,
});
const drawing = (
  id: string,
  x: number,
  revision: number,
  sceneId = "scene",
) => ({ id, sceneId, x, y: 40, revision, points: [0, 0, 4, 4] });
const mixedIntent = (): CanvasBulkMoveIntent => ({
  actionId: "move-1",
  sceneId: "scene",
  targets: [
    { targetType: "TOKEN", targetId: "t1", revision: 1 },
    { targetType: "DRAWING", targetId: "d1", revision: 4 },
  ],
  delta: { x: 64, y: -8 },
});
const ack = { tokens: { t1: 2 }, drawings: { d1: 5 } };

describe("bulk move optimistic projection", () => {
  it("shows a mixed intent immediately and keeps rich entity fields", () => {
    const intents = appendBulkMoveIntent([], mixedIntent());
    expect(
      projectBulkMoveIntents([token("t1", 10, 1)], "TOKEN", intents),
    ).toEqual([{ ...token("t1", 10, 1), x: 74, y: 12 }]);
    expect(
      projectBulkMoveIntents([drawing("d1", 30, 4)], "DRAWING", intents),
    ).toEqual([{ ...drawing("d1", 30, 4), x: 94, y: 32 }]);
  });

  it("keeps the overlay after an ack until the matching snapshot arrives", () => {
    let intents = acknowledgeBulkMoveIntent([mixedIntent()], "move-1", ack);
    expect(
      projectBulkMoveIntents([token("t1", 10, 1)], "TOKEN", intents)[0],
    ).toMatchObject({ x: 74, revision: 2 });

    const canonicalTokens = [token("t1", 74, 2)];
    const canonicalDrawings = [drawing("d1", 94, 5)];
    expect(projectBulkMoveIntents(canonicalTokens, "TOKEN", intents)).toBe(
      canonicalTokens,
    );
    intents = reconcileBulkMoveIntents(
      intents,
      canonicalTokens,
      canonicalDrawings,
    );
    expect(intents).toEqual([]);
  });

  it("does not apply the delta twice when the snapshot beats the ack", () => {
    const canonicalTokens = [token("t1", 74, 2)];
    const canonicalDrawings = [drawing("d1", 94, 5)];
    let intents: readonly CanvasBulkMoveIntent[] = [mixedIntent()];
    expect(projectBulkMoveIntents(canonicalTokens, "TOKEN", intents)).toBe(
      canonicalTokens,
    );
    intents = acknowledgeBulkMoveIntent(intents, "move-1", ack);
    expect(projectBulkMoveIntents(canonicalTokens, "TOKEN", intents)).toBe(
      canonicalTokens,
    );
    expect(projectBulkMoveIntents(canonicalDrawings, "DRAWING", intents)).toBe(
      canonicalDrawings,
    );
  });

  it("rolls back exactly the rejected request to canonical coordinates", () => {
    const canonical = [token("t1", 10, 1)];
    const optimistic = [mixedIntent()];
    expect(projectBulkMoveIntents(canonical, "TOKEN", optimistic)[0]?.x).toBe(
      74,
    );
    const rolledBack = rejectBulkMoveIntent(optimistic, "move-1");
    expect(projectBulkMoveIntents(canonical, "TOKEN", rolledBack)).toBe(
      canonical,
    );
  });

  it("stacks serialized moves on acknowledgement revisions", () => {
    const first = acknowledgeBulkMoveIntent([mixedIntent()], "move-1", ack);
    const second: CanvasBulkMoveIntent = {
      actionId: "move-2",
      sceneId: "scene",
      targets: [{ targetType: "TOKEN", targetId: "t1", revision: 2 }],
      delta: { x: 10, y: 3 },
    };
    const projected = projectBulkMoveIntents(
      [token("t1", 10, 1)],
      "TOKEN",
      appendBulkMoveIntent(first, second),
    );
    expect(projected[0]).toMatchObject({ x: 84, y: 15, revision: 2 });
  });

  it("preserves an accepted move when a later queued move is rejected", () => {
    const first = acknowledgeBulkMoveIntent([mixedIntent()], "move-1", ack);
    const second: CanvasBulkMoveIntent = {
      ...mixedIntent(),
      actionId: "move-2",
      targets: [{ targetType: "TOKEN", targetId: "t1", revision: 2 }],
    };
    const remaining = rejectBulkMoveIntent(
      appendBulkMoveIntent(first, second),
      "move-2",
    );
    expect(
      projectBulkMoveIntents([token("t1", 10, 1)], "TOKEN", remaining)[0],
    ).toMatchObject({ x: 74, y: 12, revision: 2 });
    expect(remaining).toEqual(first);
  });

  it("does not leak an old scene or selection into the current projection", () => {
    const otherSelection = [token("t2", 5, 1)];
    expect(
      projectBulkMoveIntents(otherSelection, "TOKEN", [mixedIntent()]),
    ).toBe(otherSelection);
    expect(
      retainBulkMoveIntentsForScene([mixedIntent()], "other-scene"),
    ).toEqual([]);
  });

  it("never resurrects deletion or overwrites a newer revision", () => {
    const intents = acknowledgeBulkMoveIntent([mixedIntent()], "move-1", ack);
    const deleted: ReturnType<typeof token>[] = [];
    expect(projectBulkMoveIntents(deleted, "TOKEN", intents)).toBe(deleted);

    const newer = [token("t1", 900, 7)];
    expect(projectBulkMoveIntents(newer, "TOKEN", intents)).toBe(newer);
    expect(reconcileBulkMoveIntents(intents, newer, [])).toEqual([]);
  });
});

import { describe, expect, it } from "vitest";
import {
  createEntityFormState,
  entityFormReducer,
  isEntityFormDirty,
} from "./entity-form-state";

describe("entity form state", () => {
  it("tracks dirty changes and resets without losing the original value", () => {
    const initial = createEntityFormState({
      name: "Первая сцена",
      revision: 1,
    });
    const changed = entityFormReducer(initial, {
      type: "change",
      patch: { name: "Подземелье" },
    });
    expect(isEntityFormDirty(changed)).toBe(true);
    expect(entityFormReducer(changed, { type: "reset" }).draft).toEqual(
      initial.initial,
    );
  });

  it("commits the authoritative saved value", () => {
    const initial = createEntityFormState({ size: 64, revision: 1 });
    const saved = entityFormReducer(initial, {
      type: "saved",
      value: { size: 96, revision: 2 },
    });
    expect(saved.initial).toEqual({ size: 96, revision: 2 });
    expect(isEntityFormDirty(saved)).toBe(false);
  });

  it("keeps the local draft and captures the server value on conflict", () => {
    const changed = entityFormReducer(
      createEntityFormState({ volume: 20, revision: 1 }),
      {
        type: "change",
        patch: { volume: 30 },
      },
    );
    const conflicted = entityFormReducer(changed, {
      type: "conflict",
      message: "Версия изменилась",
      serverValue: { volume: 25, revision: 2 },
    });
    expect(conflicted.draft.volume).toBe(30);
    expect(conflicted.serverValue?.volume).toBe(25);
    expect(conflicted.status).toBe("conflict");
  });
});

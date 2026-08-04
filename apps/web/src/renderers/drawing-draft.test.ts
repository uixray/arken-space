import { describe, expect, it, vi } from "vitest";
import {
  clearDrawingDraftIfCurrent,
  persistDrawingDraft,
  releaseDrawingDraft,
} from "./drawing-draft";

describe("persistDrawingDraft", () => {
  it("keeps the local stroke until the persisted drawing is reconciled", async () => {
    let resolvePersistence: (() => void) | undefined;
    const persist = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          resolvePersistence = resolve;
        }),
    );
    const clearDraft = vi.fn();

    const pending = persistDrawingDraft(
      { points: [1, 2, 3, 4] },
      persist,
      clearDraft,
    );

    expect(persist).toHaveBeenCalledOnce();
    expect(clearDraft).not.toHaveBeenCalled();

    resolvePersistence?.();
    await pending;
    expect(clearDraft).toHaveBeenCalledOnce();
  });

  it("clears a failed draft after persistence settles", async () => {
    const clearDraft = vi.fn();

    await expect(
      persistDrawingDraft(
        {},
        async () => {
          throw new Error("offline");
        },
        clearDraft,
      ),
    ).rejects.toThrow("offline");
    expect(clearDraft).toHaveBeenCalledOnce();
  });

  it("does not clear a newer overlapping stroke when an older save resolves", async () => {
    const older = [1, 2, 3, 4];
    const newer = [5, 6, 7, 8];
    const draftRef = { current: older };
    const clearDraft = vi.fn();
    let resolveOlder: (() => void) | undefined;

    const pendingOlder = persistDrawingDraft(
      older,
      () =>
        new Promise<void>((resolve) => {
          resolveOlder = resolve;
        }),
      () => clearDrawingDraftIfCurrent(draftRef, older, clearDraft),
    );

    draftRef.current = newer;
    resolveOlder?.();
    await pendingOlder;

    expect(draftRef.current).toBe(newer);
    expect(clearDraft).not.toHaveBeenCalled();
    expect(clearDrawingDraftIfCurrent(draftRef, newer, clearDraft)).toBe(true);
    expect(clearDraft).toHaveBeenCalledOnce();
  });
});

describe("releaseDrawingDraft", () => {
  it("hides the completed stroke synchronously and returns it for persistence", () => {
    const completed = [1, 2, 3, 4];
    const ref = { current: completed };
    const clear = vi.fn();
    expect(releaseDrawingDraft(ref, [], clear)).toBe(completed);
    expect(ref.current).toEqual([]);
    expect(clear).toHaveBeenCalledOnce();
  });
});

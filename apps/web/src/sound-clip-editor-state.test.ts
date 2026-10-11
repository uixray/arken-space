import { describe, expect, it, vi } from "vitest";
import {
  createClipEditorState,
  currentReadyCandidate,
  ensurePreviewActionId,
  ensureSaveActionId,
  validateClipRange,
  withAnalysis,
  withCandidate,
  withRange,
  withSource,
} from "./sound-clip-editor-state.js";

const analysis = {
  sourceAssetId: "a",
  sourceVersion: "v1",
  durationMs: 12_000,
};
const readyCandidate = {
  candidateId: "candidate-1",
  status: "READY",
  previewUrl: null,
  range: null,
  expiresAt: "2099-10-10T12:00:00.000Z",
};

describe("sound clip editor intent state", () => {
  it("retains a preview action id across retries until the source/range intent changes", () => {
    const id = vi.fn(() => "action-1");
    let state = withAnalysis(createClipEditorState("a"), analysis);
    state = ensurePreviewActionId(state, id);
    state = ensurePreviewActionId(state, id);
    expect(state.previewActionId).toBe("action-1");
    expect(id).toHaveBeenCalledOnce();
    state = withRange(state, { startMs: 100, endMs: 1000 });
    expect(state.previewActionId).toBeNull();
    expect(state.candidate).toBeNull();
  });

  it("keeps the action id while the same clip request is still processing", () => {
    let state = withAnalysis(createClipEditorState("a"), analysis);
    state = ensurePreviewActionId(state, () => "action-1");
    state = withCandidate(state, {
      candidateId: "pending",
      status: "PROCESSING",
      previewUrl: null,
      expiresAt: "2099-10-10T12:00:00.000Z",
      range: null,
    });
    expect(state.previewActionId).toBe("action-1");
    expect(currentReadyCandidate(state)).toBeNull();
  });

  it("only treats the ready candidate for the current exact range as savable", () => {
    let state = withAnalysis(createClipEditorState("a"), analysis);
    state = withCandidate(state, readyCandidate);
    expect(currentReadyCandidate(state)).toMatchObject({
      candidateId: "candidate-1",
    });
    state = withRange(state, { startMs: 100, endMs: 1000 });
    expect(currentReadyCandidate(state)).toBeNull();
    expect(state.candidate).toBeNull();
  });

  it("retains save action id only while the exact save intent is unchanged", () => {
    const createId = vi
      .fn()
      .mockReturnValueOnce("save-1")
      .mockReturnValueOnce("save-2");
    let state = createClipEditorState("a");
    state = ensureSaveActionId(state, "candidate-1:wind", createId);
    state = ensureSaveActionId(state, "candidate-1:wind", createId);
    expect(state.saveActionId).toBe("save-1");
    state = ensureSaveActionId(state, "candidate-1:rain", createId);
    expect(state.saveActionId).toBe("save-2");
  });

  it("invalidates old candidates on a source version change", () => {
    let state = withAnalysis(createClipEditorState("a"), analysis);
    state = withCandidate(state, readyCandidate);
    state = withAnalysis(state, { ...analysis, sourceVersion: "v2" });
    expect(state.candidate).toBeNull();
    expect(state.sourceAssetId).toBe("a");
  });

  it("enforces integer milliseconds, duration and the ten-second cap without inventing a minimum", () => {
    expect(validateClipRange(0, 1, 100)).toBeNull();
    expect(validateClipRange(0.5, 100, 1000)).toMatch(/целые миллисекунды/);
    expect(validateClipRange(0, 10001, 20000)).toMatch(/10 секунд/);
    expect(validateClipRange(0, 1001, 1000)).toMatch(/границы/);
  });

  it("drops all source-bound state when the chosen source changes", () => {
    let state = withAnalysis(createClipEditorState("a"), analysis);
    state = withCandidate(state, readyCandidate);
    state = withSource(state, "b");
    expect(state).toMatchObject({
      sourceAssetId: "b",
      sourceVersion: null,
      candidate: null,
      range: { startMs: 0, endMs: 0 },
    });
  });
});

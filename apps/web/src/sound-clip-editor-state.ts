export type ClipRange = { startMs: number; endMs: number };

export type ClipEditorState = {
  sourceAssetId: string;
  sourceVersion: string | null;
  durationMs: number | null;
  range: ClipRange;
  candidate: {
    candidateId: string;
    status: string;
    previewUrl: string | null;
    expiresAt: string;
    range: {
      actualStartMs: number;
      actualEndMs: number;
      actualStartFrame: number;
      actualEndFrame: number;
      sampleRate: number;
    } | null;
    intentKey: string;
  } | null;
  previewActionId: string | null;
  saveActionId: string | null;
  saveIntentKey: string | null;
};

export function createClipEditorState(sourceAssetId: string): ClipEditorState {
  return {
    sourceAssetId,
    sourceVersion: null,
    durationMs: null,
    range: { startMs: 0, endMs: 0 },
    candidate: null,
    previewActionId: null,
    saveActionId: null,
    saveIntentKey: null,
  };
}

export function rangeIntentKey(state: ClipEditorState): string | null {
  if (!state.sourceVersion) return null;
  return `${state.sourceAssetId}:${state.sourceVersion}:${state.range.startMs}:${state.range.endMs}`;
}

export function withAnalysis(
  state: ClipEditorState,
  analysis: {
    sourceAssetId: string;
    sourceVersion: string;
    durationMs: number;
  },
): ClipEditorState {
  if (analysis.sourceAssetId !== state.sourceAssetId) return state;
  const sameVersion = state.sourceVersion === analysis.sourceVersion;
  return {
    ...state,
    sourceVersion: analysis.sourceVersion,
    durationMs: analysis.durationMs,
    range:
      sameVersion && state.range.endMs > 0
        ? {
            startMs: Math.min(state.range.startMs, analysis.durationMs),
            endMs: Math.min(state.range.endMs, analysis.durationMs),
          }
        : {
            startMs: 0,
            endMs: Math.min(Math.floor(analysis.durationMs), 10_000),
          },
    candidate: sameVersion ? state.candidate : null,
    previewActionId: sameVersion ? state.previewActionId : null,
    saveActionId: sameVersion ? state.saveActionId : null,
    saveIntentKey: sameVersion ? state.saveIntentKey : null,
  };
}

export function withRange(
  state: ClipEditorState,
  range: ClipRange,
): ClipEditorState {
  if (
    range.startMs === state.range.startMs &&
    range.endMs === state.range.endMs
  )
    return state;
  return {
    ...state,
    range,
    candidate: null,
    previewActionId: null,
    saveActionId: null,
    saveIntentKey: null,
  };
}

export function withSource(
  state: ClipEditorState,
  sourceAssetId: string,
): ClipEditorState {
  return sourceAssetId === state.sourceAssetId
    ? state
    : createClipEditorState(sourceAssetId);
}

export function ensurePreviewActionId(
  state: ClipEditorState,
  createId: () => string,
): ClipEditorState {
  return state.previewActionId
    ? state
    : { ...state, previewActionId: createId() };
}

export function withCandidate(
  state: ClipEditorState,
  candidate: {
    candidateId: string;
    status: string;
    previewUrl: string | null;
    expiresAt: string;
    range: {
      actualStartMs: number;
      actualEndMs: number;
      actualStartFrame: number;
      actualEndFrame: number;
      sampleRate: number;
    } | null;
  },
): ClipEditorState {
  const intentKey = rangeIntentKey(state);
  if (!intentKey) return state;
  return {
    ...state,
    candidate: { ...candidate, intentKey },
    previewActionId:
      candidate.status === "PROCESSING" ? state.previewActionId : null,
    saveActionId: null,
    saveIntentKey: null,
  };
}

export function currentReadyCandidate(state: ClipEditorState) {
  const intentKey = rangeIntentKey(state);
  return state.candidate?.status === "READY" &&
    Date.parse(state.candidate.expiresAt) > Date.now() &&
    state.candidate.intentKey === intentKey
    ? state.candidate
    : null;
}

export function ensureSaveActionId(
  state: ClipEditorState,
  intentKey: string,
  createId: () => string,
): ClipEditorState {
  return state.saveIntentKey === intentKey && state.saveActionId
    ? state
    : { ...state, saveIntentKey: intentKey, saveActionId: createId() };
}

export function validateClipRange(
  startMs: number,
  endMs: number,
  durationMs: number | null,
): string | null {
  if (durationMs === null) return "Анализ источника ещё не готов.";
  if (!Number.isInteger(startMs) || !Number.isInteger(endMs))
    return "Укажите целые миллисекунды.";
  if (startMs < 0 || endMs <= startMs || endMs > durationMs)
    return "Проверьте границы отрезка.";
  if (endMs - startMs > 10_000) return "Отрезок не должен превышать 10 секунд.";
  return null;
}

export function clampClipRange(
  range: ClipRange,
  durationMs: number,
  endpoint: "startMs" | "endMs",
  value: number,
): ClipRange {
  const bounded = Math.max(
    0,
    Math.min(Math.floor(durationMs), Math.round(value)),
  );
  if (endpoint === "startMs") {
    return { startMs: Math.min(bounded, range.endMs - 1), endMs: range.endMs };
  }
  return {
    startMs: range.startMs,
    endMs: Math.max(range.startMs + 1, bounded),
  };
}
export function withoutCandidate(state: ClipEditorState): ClipEditorState {
  return {
    ...state,
    candidate: null,
    previewActionId: null,
    saveActionId: null,
    saveIntentKey: null,
  };
}

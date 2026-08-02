/**
 * Persists a detached drawing snapshot and always runs caller-owned cleanup.
 * Visibility timing is controlled separately by releaseDrawingDraft.
 */
export async function persistDrawingDraft<T>(
  drawing: T,
  persist: (drawing: T) => Promise<unknown>,
  clearDraft: () => void,
) {
  try {
    await persist(drawing);
  } finally {
    clearDraft();
  }
}

/** Detaches the completed stroke from the visible draft before persistence. */
export function releaseDrawingDraft<T>(
  draftRef: { current: T },
  emptyDraft: T,
  clearDraft: () => void,
) {
  const completedDraft = draftRef.current;
  draftRef.current = emptyDraft;
  clearDraft();
  return completedDraft;
}

/** Clears only the stroke that initiated the completed persistence command. */
export function clearDrawingDraftIfCurrent<T>(
  draftRef: { current: T },
  completedDraft: T,
  clearDraft: () => void,
) {
  if (draftRef.current !== completedDraft) return false;
  draftRef.current = [] as T;
  clearDraft();
  return true;
}

/**
 * Keeps an optimistic canvas draft mounted until persistence has settled.
 * The caller reconciles the saved object into its snapshot before resolving.
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

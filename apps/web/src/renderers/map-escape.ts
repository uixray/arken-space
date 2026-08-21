export type MapEscapeIntent =
  "ignore" | "close-object-list" | "clear-map-state";

/**
 * Keeps the renderer's local selection state aligned with the interaction
 * reducer's layered Escape semantics. An open object list consumes the first
 * Escape; only a later Escape may clear the selected map object and drafts.
 */
export function resolveMapEscapeIntent(input: {
  key: string;
  objectListOpen: boolean;
}): MapEscapeIntent {
  if (input.key !== "Escape") return "ignore";
  return input.objectListOpen ? "close-object-list" : "clear-map-state";
}

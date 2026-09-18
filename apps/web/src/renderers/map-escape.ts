export type MapEscapeIntent =
  "ignore" | "close-token-menu" | "close-object-list" | "clear-map-state";

/**
 * Keeps the renderer's local selection state aligned with the interaction
 * reducer's layered Escape semantics. The token context menu precedes the object
 * list; each open layer consumes its own
 * Escape; only a later Escape may clear the selected map object and drafts.
 */
export function resolveMapEscapeIntent(input: {
  key: string;
  objectListOpen: boolean;
  tokenMenuOpen?: boolean;
}): MapEscapeIntent {
  if (input.key !== "Escape") return "ignore";
  if (input.tokenMenuOpen) return "close-token-menu";
  return input.objectListOpen ? "close-object-list" : "clear-map-state";
}

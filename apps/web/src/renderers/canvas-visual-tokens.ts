/**
 * Stable visual values shared by the React-Konva scene layers.
 *
 * Keep geometry that belongs to a scene object close to its renderer. Values
 * here describe canvas chrome only: selection, editing, fog, and presence UI.
 */
type CanvasColor = `#${string}`;

type CanvasVisualTokens = {
  color: {
    fog: CanvasColor;
    fogCover: CanvasColor;
    fogDraft: CanvasColor;
    mapBackdrop: CanvasColor;
    edit: CanvasColor;
    editHighlight: CanvasColor;
    selection: CanvasColor;
    selectionOutline: CanvasColor;
    attention: CanvasColor;
    drawingAlternate: CanvasColor;
    tokenFrameDefault: CanvasColor;
    tokenLabel: CanvasColor;
    tokenName: CanvasColor;
  };
  opacity: {
    fogDraft: number;
    marqueeFill: number;
  };
  stroke: {
    grid: number;
  };
};

export const CANVAS_VISUAL_TOKENS = {
  color: {
    fog: "#080807",
    // A COVER operation must reconstruct the same fog surface as the base
    // layer. Even a small RGB difference becomes visible at GM opacity.
    fogCover: "#080807",
    fogDraft: "#d9c07e",
    mapBackdrop: "#282824",
    edit: "#f0c75e",
    editHighlight: "#f2dfaa",
    selection: "#7ee0ff",
    selectionOutline: "#102027",
    attention: "#ffcc66",
    drawingAlternate: "#5ecbf0",
    tokenFrameDefault: "#e2d4b4",
    tokenLabel: "#f0e7d4",
    tokenName: "#eee6d5",
  },
  opacity: {
    fogDraft: 0.35,
    marqueeFill: 0.12,
  },
  stroke: {
    grid: 1,
  },
} satisfies CanvasVisualTokens;

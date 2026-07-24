export const TOKEN_FRAME_PRESETS = [
  "NONE",
  "BRONZE",
  "SILVER",
  "OBSIDIAN",
] as const;

export type TokenFramePreset = (typeof TOKEN_FRAME_PRESETS)[number];

export type TokenImageTransform = {
  zoom: number;
  /** Normalized center of the square crop, as required by the generation API. */
  cropX: number;
  cropY: number;
  frame: TokenFramePreset;
};

export const DEFAULT_TOKEN_IMAGE_TRANSFORM: TokenImageTransform = {
  zoom: 1,
  cropX: 0.5,
  cropY: 0.5,
  frame: "NONE",
};

const MIN_ZOOM = 1;
const MAX_ZOOM = 8;

export function clampTokenImageTransform(
  transform: TokenImageTransform,
): TokenImageTransform {
  const zoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, transform.zoom));
  // Keep enough source image on every side to fill the full square preview.
  const edge = 0.5 / zoom;
  return {
    zoom,
    cropX: Math.min(1 - edge, Math.max(edge, transform.cropX)),
    cropY: Math.min(1 - edge, Math.max(edge, transform.cropY)),
    frame: transform.frame,
  };
}

export function nudgeTokenImageTransform(
  transform: TokenImageTransform,
  dx: number,
  dy: number,
  amount = 0.01,
): TokenImageTransform {
  return clampTokenImageTransform({
    ...transform,
    cropX: transform.cropX + dx * amount,
    cropY: transform.cropY + dy * amount,
  });
}

/** Keyboard semantics stay outside React so they can be tested and reused. */
export function tokenImageTransformForKey(
  transform: TokenImageTransform,
  key: string,
  shiftKey = false,
): TokenImageTransform | null {
  const amount = shiftKey ? 0.1 : 0.01;
  switch (key) {
    case "ArrowLeft":
      return nudgeTokenImageTransform(transform, -1, 0, amount);
    case "ArrowRight":
      return nudgeTokenImageTransform(transform, 1, 0, amount);
    case "ArrowUp":
      return nudgeTokenImageTransform(transform, 0, -1, amount);
    case "ArrowDown":
      return nudgeTokenImageTransform(transform, 0, 1, amount);
    case "Home":
    case "r":
    case "R":
      return { ...DEFAULT_TOKEN_IMAGE_TRANSFORM };
    default:
      return null;
  }
}

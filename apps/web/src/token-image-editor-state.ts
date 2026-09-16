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

export type TokenImageSourceDimensions = {
  width: number;
  height: number;
};

function validDimension(value: number | undefined) {
  return typeof value === "number" && Number.isFinite(value) && value > 0
    ? value
    : 1;
}

/** Matches the server/preview's integer square crop size. */
export function tokenImageCropSize(
  source: TokenImageSourceDimensions | undefined,
  zoom: number,
) {
  const width = validDimension(source?.width);
  const height = validDimension(source?.height);
  return Math.max(1, Math.floor(Math.min(width, height) / zoom));
}

function cropBounds(
  source: TokenImageSourceDimensions | undefined,
  zoom: number,
) {
  // Preserve the public helper's historical square-source behavior for
  // callers that do not have source metadata yet. A real 1x1 source still
  // takes the geometry branch below and is (correctly) immovable at zoom 1.
  if (!source) {
    const edge = 0.5 / zoom;
    return { minX: edge, maxX: 1 - edge, minY: edge, maxY: 1 - edge };
  }
  const width = validDimension(source?.width);
  const height = validDimension(source?.height);
  const size = tokenImageCropSize({ width, height }, zoom);
  return {
    minX: size / (2 * width),
    maxX: 1 - size / (2 * width),
    minY: size / (2 * height),
    maxY: 1 - size / (2 * height),
  };
}

export function clampTokenImageTransform(
  transform: TokenImageTransform,
  source?: TokenImageSourceDimensions,
): TokenImageTransform {
  const zoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, transform.zoom));
  // The crop is a square sized from the shorter source axis. Its allowable
  // center therefore differs for a landscape's X axis and a portrait's Y.
  // Keep this integer math aligned with preview/server storage cropping.
  const bounds = cropBounds(source, zoom);
  return {
    zoom,
    cropX: Math.min(bounds.maxX, Math.max(bounds.minX, transform.cropX)),
    cropY: Math.min(bounds.maxY, Math.max(bounds.minY, transform.cropY)),
    frame: transform.frame,
  };
}

export function nudgeTokenImageTransform(
  transform: TokenImageTransform,
  dx: number,
  dy: number,
  amount = 0.01,
  source?: TokenImageSourceDimensions,
): TokenImageTransform {
  return clampTokenImageTransform(
    {
      ...transform,
      cropX: transform.cropX + dx * amount,
      cropY: transform.cropY + dy * amount,
    },
    source,
  );
}

/** Keyboard semantics stay outside React so they can be tested and reused. */
export function tokenImageTransformForKey(
  transform: TokenImageTransform,
  key: string,
  shiftKey = false,
  source?: TokenImageSourceDimensions,
): TokenImageTransform | null {
  const amount = shiftKey ? 0.1 : 0.01;
  switch (key) {
    case "ArrowLeft":
      return nudgeTokenImageTransform(transform, -1, 0, amount, source);
    case "ArrowRight":
      return nudgeTokenImageTransform(transform, 1, 0, amount, source);
    case "ArrowUp":
      return nudgeTokenImageTransform(transform, 0, -1, amount, source);
    case "ArrowDown":
      return nudgeTokenImageTransform(transform, 0, 1, amount, source);
    case "Home":
    case "r":
    case "R":
      return { ...DEFAULT_TOKEN_IMAGE_TRANSFORM };
    default:
      return null;
  }
}

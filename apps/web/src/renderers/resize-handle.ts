export interface ResizeHandleGeometry {
  x: number;
  y: number;
  width: number;
  height: number;
}
export interface ResizeHandleDraft {
  width: number;
  height: number;
}
export interface ResizeHandlePosition {
  x: number;
  y: number;
}
export type ResizeHandleDataAttributes = {
  "data-resize-handle-x": number;
  "data-resize-handle-y": number;
};

const roundCssCoordinate = (value: number) => {
  const rounded = Math.round(value * 100) / 100;
  return Object.is(rounded, -0) ? 0 : rounded;
};

export function resolveResizeHandleDataAttributes({
  enabled,
  token,
  resizeDraft,
  dragPosition,
  stagePosition,
  scale,
}: {
  enabled: boolean;
  token: ResizeHandleGeometry | null;
  resizeDraft?: ResizeHandleDraft;
  dragPosition?: ResizeHandlePosition;
  stagePosition: ResizeHandlePosition;
  scale: number;
}): ResizeHandleDataAttributes | null {
  if (!enabled || !token) return null;
  const x = dragPosition?.x ?? token.x;
  const y = dragPosition?.y ?? token.y;
  const width = resizeDraft?.width ?? token.width;
  const height = resizeDraft?.height ?? token.height;
  const values = [x, y, width, height, stagePosition.x, stagePosition.y, scale];
  if (values.some((value) => !Number.isFinite(value))) return null;
  const localX = stagePosition.x + (x + width) * scale;
  const localY = stagePosition.y + (y + height) * scale;
  if (!Number.isFinite(localX) || !Number.isFinite(localY)) return null;
  return {
    "data-resize-handle-x": roundCssCoordinate(localX),
    "data-resize-handle-y": roundCssCoordinate(localY),
  };
}

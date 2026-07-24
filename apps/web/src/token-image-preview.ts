export type TokenImagePreviewCropInput = {
  width: number;
  height: number;
  cropX: number;
  cropY: number;
  zoom: number;
};

export type TokenImagePreviewCrop = {
  cropSize: number;
  left: number;
  top: number;
  imageWidthPercent: number;
  imageHeightPercent: number;
  imageLeftPercent: number;
  imageTopPercent: number;
};

function clamp(value: number, minimum: number, maximum: number) {
  return Math.min(maximum, Math.max(minimum, value));
}

/** Mirrors the server's resolveTokenCrop math for an accurate local preview. */
export function resolveTokenImagePreviewCrop({
  width,
  height,
  cropX,
  cropY,
  zoom,
}: TokenImagePreviewCropInput): TokenImagePreviewCrop {
  const cropSize = Math.min(width, height) / zoom;
  const left = clamp(cropX * width - cropSize / 2, 0, width - cropSize);
  const top = clamp(cropY * height - cropSize / 2, 0, height - cropSize);
  return {
    cropSize,
    left,
    top,
    imageWidthPercent: (width / cropSize) * 100,
    imageHeightPercent: (height / cropSize) * 100,
    imageLeftPercent: left === 0 ? 0 : (-left / cropSize) * 100,
    imageTopPercent: top === 0 ? 0 : (-top / cropSize) * 100,
  };
}

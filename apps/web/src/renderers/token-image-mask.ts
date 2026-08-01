export interface TokenImageMask {
  centerX: number;
  centerY: number;
  radius: number;
}

/**
 * Keeps the token's persisted bounds unchanged while describing the circular
 * viewport used for its artwork and frame.
 */
export function getTokenImageMask(
  width: number,
  height: number,
): TokenImageMask {
  return {
    centerX: width / 2,
    centerY: height / 2,
    radius: Math.min(width, height) / 2,
  };
}

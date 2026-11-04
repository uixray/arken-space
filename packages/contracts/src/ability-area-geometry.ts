/** Shared world-coordinate preview/apply geometry. No visibility or ACL logic. */
export function abilityAreaCircle(
  token: { x: number; y: number; width: number; height: number },
  radiusMeters: number,
  grid: { size: number; metersPerCell?: number | null },
) {
  if (
    ![
      token.x,
      token.y,
      token.width,
      token.height,
      radiusMeters,
      grid.size,
      grid.metersPerCell,
    ].every((value) => typeof value === "number" && Number.isFinite(value)) ||
    token.width <= 0 ||
    token.height <= 0 ||
    radiusMeters <= 0 ||
    grid.size <= 0 ||
    !grid.metersPerCell ||
    grid.metersPerCell <= 0
  )
    return null;
  const radius = (radiusMeters / grid.metersPerCell) * grid.size;
  const x = token.x + token.width / 2;
  const y = token.y + token.height / 2;
  return Number.isFinite(radius) &&
    radius > 0 &&
    Number.isFinite(x) &&
    Number.isFinite(y)
    ? { x, y, radius }
    : null;
}

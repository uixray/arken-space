type Point = { x: number; y: number };
type Rect = Point & { width: number; height: number };

export function isPointRevealed(point: Point, reveals: readonly Rect[]) {
  return reveals.some(
    (reveal) =>
      point.x >= reveal.x &&
      point.x <= reveal.x + reveal.width &&
      point.y >= reveal.y &&
      point.y <= reveal.y + reveal.height,
  );
}

export function isRectFullyRevealed(rect: Rect, reveals: readonly Rect[]) {
  return reveals.some(
    (reveal) =>
      rect.x >= reveal.x &&
      rect.x + rect.width <= reveal.x + reveal.width &&
      rect.y >= reveal.y &&
      rect.y + rect.height <= reveal.y + reveal.height,
  );
}

export function fogOpacity(role: "GM" | "PLAYER") {
  return role === "GM" ? 0.35 : 1;
}

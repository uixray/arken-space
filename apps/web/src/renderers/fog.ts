type Point = { x: number; y: number };
type Rect = Point & { width: number; height: number };

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

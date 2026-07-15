type Point = { x: number; y: number };
type Rect = Point & {
  width: number;
  height: number;
  operation?: "REVEAL" | "COVER";
};

export function isRectFullyRevealed(rect: Rect, reveals: readonly Rect[]) {
  let visible = false;
  for (const reveal of reveals) {
    if (
      rect.x >= reveal.x &&
      rect.x + rect.width <= reveal.x + reveal.width &&
      rect.y >= reveal.y &&
      rect.y + rect.height <= reveal.y + reveal.height
    )
      visible = reveal.operation !== "COVER";
  }
  return visible;
}

export function fogOpacity(role: "GM" | "PLAYER") {
  return role === "GM" ? 0.35 : 1;
}

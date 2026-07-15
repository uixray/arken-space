type Point = { x: number; y: number };
type Rect = Point & {
  width: number;
  height: number;
  operation?: "REVEAL" | "COVER";
};

export function isRectFullyRevealed(rect: Rect, reveals: readonly Rect[]) {
  if (rect.width <= 0 || rect.height <= 0) return false;
  const right = rect.x + rect.width;
  const bottom = rect.y + rect.height;
  const intersecting = reveals.filter(
    (operation) =>
      operation.x < right &&
      operation.x + operation.width > rect.x &&
      operation.y < bottom &&
      operation.y + operation.height > rect.y,
  );
  const xs = new Set([rect.x, right]);
  const ys = new Set([rect.y, bottom]);
  for (const operation of intersecting) {
    xs.add(Math.max(rect.x, operation.x));
    xs.add(Math.min(right, operation.x + operation.width));
    ys.add(Math.max(rect.y, operation.y));
    ys.add(Math.min(bottom, operation.y + operation.height));
  }
  const xCuts = [...xs].sort((a, b) => a - b);
  const yCuts = [...ys].sort((a, b) => a - b);
  for (let xIndex = 0; xIndex < xCuts.length - 1; xIndex++) {
    for (let yIndex = 0; yIndex < yCuts.length - 1; yIndex++) {
      const x = (xCuts[xIndex]! + xCuts[xIndex + 1]!) / 2;
      const y = (yCuts[yIndex]! + yCuts[yIndex + 1]!) / 2;
      let visible = false;
      for (const operation of intersecting) {
        if (
          x >= operation.x &&
          x < operation.x + operation.width &&
          y >= operation.y &&
          y < operation.y + operation.height
        )
          visible = operation.operation !== "COVER";
      }
      if (!visible) return false;
    }
  }
  return true;
}

export function fogOpacity(role: "GM" | "PLAYER") {
  return role === "GM" ? 0.35 : 1;
}

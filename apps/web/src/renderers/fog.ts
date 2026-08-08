import type { FogGeometry } from "@arken/contracts";
import { fogGeometryContains } from "@arken/contracts";

type Point = { x: number; y: number };
type Rect = Point & {
  width: number;
  height: number;
};
export type FogOperation = Rect & {
  operation?: "REVEAL" | "COVER";
  geometry?: FogGeometry;
};

// Every fog row (server-computed) carries x/y/width/height as its bbox, even
// for CIRCLE/POLYGON/BRUSH shapes -- so when `geometry` is absent (legacy
// fixtures, pre-migration rows) a RECT built from the bbox fields is an
// equivalent stand-in for point-membership testing.
function operationGeometry(operation: FogOperation): FogGeometry {
  return (
    operation.geometry ?? {
      type: "RECT",
      x: operation.x,
      y: operation.y,
      width: operation.width,
      height: operation.height,
    }
  );
}

/**
 * A query rect counts as "fully revealed" only when every point inside it is
 * under an active REVEAL once every intersecting fog operation is applied in
 * order (later operations in `reveals` override earlier ones at a given
 * point, matching the durable REVEAL/COVER journal semantics).
 *
 * This decomposes the query rect into a grid of cells cut along each
 * intersecting operation's bbox edges (exact for RECT-vs-RECT, since a
 * rectangle's membership never changes within such a cell) and samples the
 * midpoint of every cell against the ordered operations using
 * `fogGeometryContains`, so CIRCLE/POLYGON/BRUSH shapes are evaluated with
 * the same point-in-shape test the server and contracts package already use
 * elsewhere. Non-rectangular boundaries that cut through the interior of a
 * single cell are approximated by that cell's midpoint sample, same
 * trade-off the original RECT-only cell decomposition already made.
 */
export function isRectFullyRevealed(rect: Rect, reveals: readonly FogOperation[]) {
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
        if (fogGeometryContains(operationGeometry(operation), { x, y }))
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

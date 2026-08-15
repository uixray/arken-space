import type { FogGeometry } from "./fog-geometry.js";
import { fogGeometryContains } from "./fog-geometry.js";

/**
 * UIX-449 — кого туман скрывает.
 *
 * Правило живёт в контракте, потому что спрашивают о нём с обеих сторон:
 * клиент — чтобы не рисовать, сервер — чтобы не рассылать. Пока оно было
 * только на клиенте, туман скрывал токен на экране, а координаты уходили
 * игроку целиком: открывший devtools видел, где стоит засада.
 *
 * Это тот же урок, что в UIX-403 про курсор мастера — «не должен
 * рассылаться», а не «не должен рисоваться», — и то же лекарство, что в
 * UIX-424 для `formulaReferencesStatKey`: одно правило, а не две копии,
 * которые разойдутся ровно там, где это дороже всего.
 */

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
 * Samples the query rect and reports whether any point in it is `target`.
 *
 * The rect is decomposed into a grid of cells cut along each intersecting
 * operation's bbox edges (exact for RECT-vs-RECT, since a rectangle's
 * membership never changes within such a cell) and the midpoint of every cell
 * is tested against the ordered operations using `fogGeometryContains`, so
 * CIRCLE/POLYGON/BRUSH shapes are evaluated with the same point-in-shape test
 * the server and contracts package already use elsewhere. Non-rectangular
 * boundaries that cut through the interior of a single cell are approximated
 * by that cell's midpoint sample, the same trade-off the original RECT-only
 * decomposition already made.
 *
 * Later operations in `reveals` override earlier ones at a given point,
 * matching the durable REVEAL/COVER journal semantics.
 *
 * Both public questions below reduce to this one scan, asking about opposite
 * targets — which is the point of sharing it: "fully revealed" and "fully
 * hidden" are not each other's negation (a partially revealed rect is
 * neither), so they have to come from the same sampling or they will disagree
 * at the edges.
 */
function containsPointWhere(
  rect: Rect,
  reveals: readonly FogOperation[],
  target: boolean,
): boolean {
  const right = rect.x + rect.width;
  const bottom = rect.y + rect.height;
  const intersecting = reveals.filter(
    (operation) =>
      operation.x < right &&
      operation.x + operation.width > rect.x &&
      operation.y < bottom &&
      operation.y + operation.height > rect.y,
  );
  // Nothing intersects, so every point is unrevealed: fog is the default
  // state and REVEAL operations are what open it. Same answer the loops below
  // would reach, without building any cut lists.
  if (intersecting.length === 0) return target === false;
  // Resolve each operation's geometry once. `operationGeometry` allocates a
  // fresh RECT for legacy rows, and the sampling loops run it
  // O(cells x operations) times -- hoisting it out of the hot path avoids
  // millions of short-lived allocations per frame on a busy scene.
  const resolved = intersecting.map((operation) => ({
    box: operation,
    geometry: operationGeometry(operation),
    revealing: operation.operation !== "COVER",
  }));
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
      // Later operations win at a given point, so scanning back-to-front and
      // stopping at the first hit gives the same answer as scanning
      // front-to-back and letting later hits overwrite -- but normally stops
      // after one or two tests instead of always probing every operation.
      for (let index = resolved.length - 1; index >= 0; index--) {
        const candidate = resolved[index]!;
        const box = candidate.box;
        // Every shape lies entirely inside its own stored bbox (the server
        // derives x/y/width/height from `fogGeometryBounds`, which pads by
        // the radius for CIRCLE/BRUSH), so a point outside the bbox can never
        // be inside the shape. Skipping the per-shape test here matters most
        // for BRUSH, whose containment check walks up to 256 stroke segments.
        if (
          x < box.x ||
          x > box.x + box.width ||
          y < box.y ||
          y > box.y + box.height
        )
          continue;
        if (!fogGeometryContains(candidate.geometry, { x, y })) continue;
        visible = candidate.revealing;
        break;
      }
      if (visible === target) return true;
    }
  }
  return false;
}

/**
 * True only when every point inside the rect is revealed.
 *
 * Used for drawings, which stay hidden until the area they occupy is fully
 * open. Deliberately *not* the rule for tokens — see `isRectFullyHidden`.
 */
export function isRectFullyRevealed(
  rect: Rect,
  reveals: readonly FogOperation[],
) {
  if (rect.width <= 0 || rect.height <= 0) return false;
  return !containsPointWhere(rect, reveals, false);
}

/**
 * True only when no point inside the rect is revealed.
 *
 * UIX-399: this is the rule for hiding a token. The previous one hid a token
 * that was not *fully* revealed, so a single pixel of overlap made it vanish
 * from the players' view entirely — reported from the 09.08 session, and the
 * opposite of what a partially lit figure should look like.
 *
 * A degenerate rect has no interior to reveal, so it counts as hidden; that
 * keeps this total rather than leaving a case where a token is neither
 * revealed nor hidden.
 */
export function isRectFullyHidden(
  rect: Rect,
  reveals: readonly FogOperation[],
) {
  if (rect.width <= 0 || rect.height <= 0) return true;
  return !containsPointWhere(rect, reveals, true);
}

/**
 * Which tokens fog hides from this viewer.
 *
 * Lives here rather than inline in the renderer so the *decision* is testable,
 * not just the geometry underneath it. Both are needed: the predicates being
 * correct says nothing about which one the caller reaches for, and picking the
 * wrong one is exactly the defect UIX-399 was.
 */
export function fogHiddenTokenIds(
  tokens: readonly (Rect & {
    id: string;
    controllerMembershipIds: readonly string[];
  })[],
  reveals: readonly FogOperation[],
  viewer: { role: "GM" | "PLAYER"; membershipId: string },
): Set<string> {
  const hidden = new Set<string>();
  // The GM is never fog-limited, so the probe is skipped entirely.
  if (viewer.role === "GM") return hidden;
  for (const token of tokens) {
    // You always see what you control, wherever it has wandered off to.
    if (token.controllerMembershipIds.includes(viewer.membershipId)) continue;
    if (isRectFullyHidden(token, reveals)) hidden.add(token.id);
  }
  return hidden;
}

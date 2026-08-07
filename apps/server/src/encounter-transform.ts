/**
 * UIX-311 relative-position transform.
 *
 * When a GM starts a LINKED_SCENE encounter, each participant token's
 * position on the source scene is expressed as a fraction of the source
 * scene's width/height, then mapped onto the same fraction of the
 * destination scene's bounds (e.g. a token at 30%-across, 60%-down on the
 * source scene lands at 30%-across, 60%-down on the destination scene).
 *
 * This is deliberately a pure, dependency-free function so it can be unit
 * tested in isolation from the database/transaction logic in encounters.ts.
 */

export interface SceneBounds {
  width: number;
  height: number;
}

export interface Point {
  x: number;
  y: number;
}

/**
 * Maps `point` (in source-scene world coordinates) onto the equivalent
 * relative position in destination-scene world coordinates.
 *
 * Total function: a degenerate source dimension (<= 0) yields a 0 fraction
 * on that axis instead of NaN/Infinity. Scenes always have positive
 * width/height in practice (schema defaults + validation), but the function
 * stays safe for any input.
 */
export function transferRelativePosition(
  source: SceneBounds,
  destination: SceneBounds,
  point: Point,
): Point {
  const fractionX = source.width > 0 ? point.x / source.width : 0;
  const fractionY = source.height > 0 ? point.y / source.height : 0;
  return {
    x: fractionX * destination.width,
    y: fractionY * destination.height,
  };
}

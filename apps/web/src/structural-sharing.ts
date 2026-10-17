/**
 * Returns `next`, reusing every part of `previous` that is deep-equal to it.
 *
 * Each socket snapshot is freshly parsed JSON, so before this every slice —
 * tokens, drawings, scenes — got a new identity on every broadcast, even when a
 * chat message was the only change. Memoised consumers (the map renderer
 * above all) then re-rendered the whole scene. With shared structure an
 * unchanged slice keeps its identity and `memo`/`useMemo` can skip work.
 *
 * Plain JSON data only (objects, arrays, primitives); anything else is
 * returned from `next` as is.
 */
export function shareStructure<T>(previous: unknown, next: T): T {
  if (Object.is(previous, next)) return next;
  if (Array.isArray(next)) {
    if (!Array.isArray(previous)) return next;
    let same = previous.length === next.length;
    const merged = next.map((item, index) => {
      const shared = shareStructure(previous[index], item);
      if (!Object.is(shared, previous[index])) same = false;
      return shared;
    });
    return (same ? previous : merged) as T;
  }
  if (!isPlainObject(next) || !isPlainObject(previous)) return next;
  const nextKeys = Object.keys(next);
  let same = nextKeys.length === Object.keys(previous).length;
  const merged: Record<string, unknown> = {};
  for (const key of nextKeys) {
    const shared = shareStructure(previous[key], next[key]);
    merged[key] = shared;
    if (!same) continue;
    if (!Object.prototype.hasOwnProperty.call(previous, key)) same = false;
    else if (!Object.is(shared, previous[key])) same = false;
  }
  return (same ? previous : merged) as T;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== "object") return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

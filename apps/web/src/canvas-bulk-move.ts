/**
 * Optimistic projection for serialized canvas bulk moves.
 *
 * The server snapshot remains canonical. A move intent is rendered on top of
 * it only while the canonical entity is still at the exact revision that the
 * request was based on. This exact-revision guard is important: an HTTP ack
 * and a socket snapshot can arrive in either order, and blindly applying the
 * delta to whichever position happens to be current would move the object a
 * second time or overwrite a newer server edit.
 */

export interface MovableCanvasItem {
  id: string;
  sceneId: string;
  x: number;
  y: number;
  revision: number;
}

export interface CanvasDelta {
  x: number;
  y: number;
}

export type CanvasBulkMoveTarget = {
  targetType: "TOKEN" | "DRAWING";
  targetId: string;
  revision: number;
};

export type CanvasBulkMoveRevisions = {
  tokens: Record<string, number>;
  drawings: Record<string, number>;
};

export type CanvasBulkMoveIntent = {
  actionId: string;
  sceneId: string;
  targets: readonly CanvasBulkMoveTarget[];
  delta: CanvasDelta;
  acknowledgement?: CanvasBulkMoveRevisions;
};

export function appendBulkMoveIntent(
  intents: readonly CanvasBulkMoveIntent[],
  intent: CanvasBulkMoveIntent,
): readonly CanvasBulkMoveIntent[] {
  return [
    ...intents.filter((item) => item.actionId !== intent.actionId),
    intent,
  ];
}

export function acknowledgeBulkMoveIntent(
  intents: readonly CanvasBulkMoveIntent[],
  actionId: string,
  revisions: CanvasBulkMoveRevisions,
): readonly CanvasBulkMoveIntent[] {
  let matched = false;
  const next = intents.map((intent) => {
    if (intent.actionId !== actionId) return intent;
    matched = true;
    return { ...intent, acknowledgement: revisions };
  });
  return matched ? next : intents;
}

export function rejectBulkMoveIntent(
  intents: readonly CanvasBulkMoveIntent[],
  actionId: string,
): readonly CanvasBulkMoveIntent[] {
  const next = intents.filter((intent) => intent.actionId !== actionId);
  return next.length === intents.length ? intents : next;
}

function acknowledgedRevision(
  intent: CanvasBulkMoveIntent,
  target: CanvasBulkMoveTarget,
) {
  const revisions = intent.acknowledgement;
  if (!revisions) return undefined;
  return target.targetType === "TOKEN"
    ? revisions.tokens[target.targetId]
    : revisions.drawings[target.targetId];
}

/**
 * Projects every still-applicable intent in request order.
 *
 * Applying an acknowledged revision to the projection lets the next queued
 * request (whose baseline is that revision) stack on it. A canonical item at
 * any other revision is left untouched: it is either already the matching
 * socket result, has been superseded by a newer edit, or is an older snapshot
 * that must not be used as a mutation base.
 */
export function projectBulkMoveIntents<T extends MovableCanvasItem>(
  items: readonly T[],
  itemType: CanvasBulkMoveTarget["targetType"],
  intents: readonly CanvasBulkMoveIntent[],
): readonly T[] {
  let projected = items;
  for (const intent of intents) {
    const targets = intent.targets.filter(
      (target) => target.targetType === itemType,
    );
    if (!targets.length) continue;
    const byId = new Map(targets.map((target) => [target.targetId, target]));
    if (
      !projected.some(
        (item) => item.sceneId === intent.sceneId && byId.has(item.id),
      )
    )
      continue;

    let changed = false;
    const next = projected.map((item) => {
      const target = byId.get(item.id);
      if (
        !target ||
        item.sceneId !== intent.sceneId ||
        item.revision !== target.revision
      )
        return item;
      const revision = acknowledgedRevision(intent, target);
      // A response omitting this entity is not permission to keep a local
      // move forever. Pending intents have no acknowledgement at all; once an
      // acknowledgement exists, only explicitly acknowledged targets remain.
      if (intent.acknowledgement && revision === undefined) return item;
      changed = true;
      return {
        ...item,
        x: item.x + intent.delta.x,
        y: item.y + intent.delta.y,
        revision: revision ?? item.revision,
      };
    });
    if (changed) projected = next;
  }
  return projected;
}

/**
 * Drops acknowledged intents once every target is either present at that ack
 * revision (or newer), deleted, or no longer belongs to the request's scene.
 * Pending requests are retained until their own ack/rejection settles; even
 * when a newer socket revision temporarily suppresses their projection, an
 * eventual rejection must still be able to remove that exact intent.
 */
export function reconcileBulkMoveIntents(
  intents: readonly CanvasBulkMoveIntent[],
  tokens: readonly MovableCanvasItem[],
  drawings: readonly MovableCanvasItem[],
): readonly CanvasBulkMoveIntent[] {
  const tokenById = new Map(tokens.map((item) => [item.id, item]));
  const drawingById = new Map(drawings.map((item) => [item.id, item]));
  const next = intents.filter((intent) => {
    if (!intent.acknowledgement) return true;
    return intent.targets.some((target) => {
      const revision = acknowledgedRevision(intent, target);
      if (revision === undefined) return false;
      const item =
        target.targetType === "TOKEN"
          ? tokenById.get(target.targetId)
          : drawingById.get(target.targetId);
      return (
        item !== undefined &&
        item.sceneId === intent.sceneId &&
        item.revision < revision
      );
    });
  });
  return next.length === intents.length ? intents : next;
}

export function retainBulkMoveIntentsForScene(
  intents: readonly CanvasBulkMoveIntent[],
  sceneId: string | undefined,
): readonly CanvasBulkMoveIntent[] {
  const next = sceneId
    ? intents.filter((intent) => intent.sceneId === sceneId)
    : [];
  return next.length === intents.length ? intents : next;
}

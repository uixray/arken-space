/**
 * Konva drag events bubble from draggable resize handles to their token Group.
 * Only a drag whose target is the Group itself may update the token position.
 */
export function isDirectTokenDrag(
  target: unknown,
  currentTarget: unknown,
): boolean {
  return target === currentTarget;
}

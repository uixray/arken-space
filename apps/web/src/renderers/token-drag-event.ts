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

type PointerIntent = Readonly<{ button: number; ctrlKey: boolean }>;

/** Reserve the primary Ctrl gesture (and PING tool) for the stage ping handler. */
export function runNonPingPointerAction(
  tool: string,
  event: PointerIntent,
  action: () => void,
): void {
  if (tool === "PING" || event.button !== 0 || event.ctrlKey) return;
  action();
}

type DragNode = {
  x(): number;
  y(): number;
  position(point: { x: number; y: number }): unknown;
  stopDrag(event?: unknown): void;
};
type TokenDragEvent = {
  target: DragNode;
  currentTarget: DragNode;
  evt?: Partial<PointerIntent>;
};

/** One ledger per renderer, not per render: stopDrag can synchronously fire dragend. */
export function createTokenDragGuard() {
  const presses = new WeakMap<
    DragNode,
    {
      origin: { x: number; y: number };
      blocked: boolean;
      cancelled: boolean;
      started: boolean;
    }
  >();
  const recordPointerDown = (node: DragNode, event: PointerIntent) => {
    presses.set(node, {
      origin: { x: node.x(), y: node.y() },
      blocked: event.ctrlKey || event.button !== 0,
      cancelled: false,
      started: false,
    });
  };
  const accept = (
    event: TokenDragEvent,
    onCancel?: (origin: { x: number; y: number }) => void,
  ) => {
    if (!isDirectTokenDrag(event.target, event.currentTarget)) return false;
    const node = event.currentTarget;
    const press = presses.get(node);
    if (press?.cancelled) return false;
    if (press?.blocked || event.evt?.ctrlKey) {
      const origin = press?.origin ?? { x: node.x(), y: node.y() };
      // Mark first: stopDrag emits dragend before returning. Keep the veto until
      // a new gesture starts, even if Ctrl has been released by pointer-up.
      presses.set(node, {
        origin,
        blocked: true,
        cancelled: true,
        started: true,
      });
      node.position(origin);
      onCancel?.(origin);
      node.stopDrag(event.evt);
      return false;
    }
    return true;
  };
  return {
    recordPointerDown,
    recordTouchStart(node: DragNode, event: Readonly<{ ctrlKey?: boolean }>) {
      recordPointerDown(node, { button: 0, ctrlKey: Boolean(event.ctrlKey) });
    },
    begin(event: TokenDragEvent) {
      if (!isDirectTokenDrag(event.target, event.currentTarget)) return;
      const node = event.currentTarget;
      const press = presses.get(node);
      // Repeated programmatic drags also get a fresh ledger entry. Native
      // mouse/touch gestures record their origin before dragstart.
      if (!press || press.started)
        recordPointerDown(node, {
          button: event.evt?.button ?? 0,
          ctrlKey: event.evt?.ctrlKey ?? false,
        });
      const current = presses.get(node)!;
      current.started = true;
      accept(event);
    },
    run(
      event: TokenDragEvent,
      action: () => void,
      onCancel?: (origin: { x: number; y: number }) => void,
    ) {
      if (accept(event, onCancel)) action();
    },
  };
}

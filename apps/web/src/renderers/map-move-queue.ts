export type MapMoveTarget = {
  targetType: "TOKEN" | "DRAWING";
  targetId: string;
  revision: number;
};

export type MapMoveDelta = { x: number; y: number };
export type MapMoveAck = {
  revisions: {
    tokens: Record<string, number>;
    drawings: Record<string, number>;
  };
};
export type MapMoveRequest = {
  intentId: string;
  targets: MapMoveTarget[];
  delta: MapMoveDelta;
};
export type MapMoveExecutor = (request: MapMoveRequest) => Promise<MapMoveAck>;
export type MapMoveFailureHandler = (
  reason: unknown,
  request: MapMoveRequest,
) => void | Promise<void>;
export type MapMovePreviewHandler = (request: MapMoveRequest) => void;
export type MapMoveDiscardHandler = (intentIds: readonly string[]) => void;

const selectionKey = (targets: readonly MapMoveTarget[]) =>
  [...targets]
    .map((target) => `${target.targetType}:${target.targetId}`)
    .sort()
    .join("|");

let nextMapMoveQueueId = 0;

/** Serializes optimistic bulk moves so every request uses the previous ack revision. */
export class MapMoveQueue {
  private readonly queueId = ++nextMapMoveQueueId;
  private generation = 0;
  private nextIntentId = 0;
  private scope = "";
  private inFlight = false;
  private pending: MapMoveRequest | null = null;
  private revisions = new Map<string, number>();
  private latestScopeRevisions = new Map<string, number>();

  constructor(
    private execute: MapMoveExecutor,
    private onFailure?: MapMoveFailureHandler,
    private onPreview?: MapMovePreviewHandler,
    private onDiscard?: MapMoveDiscardHandler,
  ) {}

  setExecutor(execute: MapMoveExecutor) {
    this.execute = execute;
  }

  setFailureHandler(onFailure?: MapMoveFailureHandler) {
    this.onFailure = onFailure;
  }

  setPreviewHandler(onPreview?: MapMovePreviewHandler) {
    this.onPreview = onPreview;
  }

  setDiscardHandler(onDiscard?: MapMoveDiscardHandler) {
    this.onDiscard = onDiscard;
  }

  reset(scope: string, targets: readonly MapMoveTarget[]) {
    const incoming = new Map(
      targets.map((target) => [
        `${target.targetType}:${target.targetId}`,
        target.revision,
      ]),
    );
    this.latestScopeRevisions = incoming;
    if (scope === this.scope) {
      if (!this.inFlight) this.revisions = new Map(incoming);
      return;
    }
    this.scope = scope;
    this.generation += 1;
    if (this.pending) this.onDiscard?.([this.pending.intentId]);
    this.pending = null;
    this.revisions = new Map(incoming);
  }

  enqueue(targets: readonly MapMoveTarget[], delta: MapMoveDelta) {
    if (!targets.length || (!delta.x && !delta.y)) return;
    const hydrated = targets.map((target) => ({
      ...target,
      revision:
        this.revisions.get(`${target.targetType}:${target.targetId}`) ??
        target.revision,
    }));
    if (
      this.pending &&
      selectionKey(this.pending.targets) === selectionKey(hydrated)
    ) {
      this.pending.delta.x += delta.x;
      this.pending.delta.y += delta.y;
    } else {
      this.pending = {
        intentId: `${this.queueId}:${this.generation}:${++this.nextIntentId}`,
        targets: hydrated,
        delta: { ...delta },
      };
    }
    // This is deliberately an enqueue-side signal. A second gesture can wait
    // behind an in-flight request, but the whole selected group still needs to
    // move together immediately rather than only when that request is sent.
    this.onPreview?.({
      ...this.pending,
      targets: this.pending.targets.map((target) => ({ ...target })),
      delta: { ...this.pending.delta },
    });
    void this.drain(this.generation);
  }

  private async drain(generation: number) {
    if (this.inFlight || !this.pending) return;
    const request = this.pending;
    this.pending = null;
    this.inFlight = true;
    try {
      const ack = await this.execute(request);
      if (generation !== this.generation) return;
      for (const [id, revision] of Object.entries(ack.revisions.tokens))
        this.revisions.set(`TOKEN:${id}`, revision);
      for (const [id, revision] of Object.entries(ack.revisions.drawings))
        this.revisions.set(`DRAWING:${id}`, revision);
      const pending = this.pending as MapMoveRequest | null;
      if (pending) {
        pending.targets = pending.targets.map((target: MapMoveTarget) => ({
          ...target,
          revision:
            this.revisions.get(`${target.targetType}:${target.targetId}`) ??
            target.revision,
        }));
        // Replace the pending preview with the baseline it will actually send.
        // This lets it stack on the acknowledged projection without guessing
        // a revision in App.
        this.onPreview?.({
          ...pending,
          targets: pending.targets.map((target) => ({ ...target })),
          delta: { ...pending.delta },
        });
      }
    } catch (reason) {
      // Conflicts and other failures are terminal for this gesture: never retry.
      if (generation === this.generation) {
        const pending = this.pending as MapMoveRequest | null;
        if (pending) this.onDiscard?.([pending.intentId]);
        this.pending = null;
        this.revisions = new Map(this.latestScopeRevisions);
        await this.onFailure?.(reason, request);
      }
    } finally {
      this.inFlight = false;
      if (this.pending) void this.drain(this.generation);
    }
  }
}

export function mapMoveSelectionKey(
  sceneId: string,
  targets: readonly MapMoveTarget[],
) {
  return `${sceneId}:${selectionKey(targets)}`;
}

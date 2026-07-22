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
export type MapMoveRequest = { targets: MapMoveTarget[]; delta: MapMoveDelta };
export type MapMoveExecutor = (request: MapMoveRequest) => Promise<MapMoveAck>;

const selectionKey = (targets: readonly MapMoveTarget[]) =>
  [...targets]
    .map((target) => `${target.targetType}:${target.targetId}`)
    .sort()
    .join("|");

/** Serializes optimistic bulk moves so every request uses the previous ack revision. */
export class MapMoveQueue {
  private generation = 0;
  private scope = "";
  private inFlight = false;
  private pending: MapMoveRequest | null = null;
  private revisions = new Map<string, number>();
  private latestScopeRevisions = new Map<string, number>();

  constructor(private execute: MapMoveExecutor) {}

  setExecutor(execute: MapMoveExecutor) {
    this.execute = execute;
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
    const request = { targets: hydrated, delta: { ...delta } };
    if (
      this.pending &&
      selectionKey(this.pending.targets) === selectionKey(hydrated)
    ) {
      this.pending.delta.x += delta.x;
      this.pending.delta.y += delta.y;
    } else {
      this.pending = request;
    }
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
      if (pending)
        pending.targets = pending.targets.map((target: MapMoveTarget) => ({
          ...target,
          revision:
            this.revisions.get(`${target.targetType}:${target.targetId}`) ??
            target.revision,
        }));
    } catch {
      // Conflicts and other failures are terminal for this gesture: never retry.
      if (generation === this.generation) {
        this.pending = null;
        this.revisions = new Map(this.latestScopeRevisions);
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

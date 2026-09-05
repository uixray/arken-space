import type { GameSnapshot, TokenCondition, TokenDto } from "@arken/contracts";

export type TokenPlacementRequest = {
  path: string;
  body: Record<string, unknown>;
};

/** Build the visible draft from local metadata, not a speculative server ID. */
export function optimisticPlacementToken(
  snapshot: GameSnapshot,
  request: TokenPlacementRequest,
): TokenDto | undefined {
  const body = request.body;
  const scene = snapshot.scenes.find((item) => item.id === body.sceneId);
  if (!scene) return;
  const definition = snapshot.tokenDefinitions?.find(
    (item) => item.id === body.definitionId,
  );
  const character = snapshot.characters.find(
    (item) => item.id === (body.characterId ?? definition?.characterId),
  );
  const width = Number(
    body.width ?? definition?.defaultWidth ?? scene.grid.size,
  );
  const height = Number(
    body.height ?? definition?.defaultHeight ?? scene.grid.size,
  );
  const snap = (value: number, offset: number) =>
    scene.grid.enabled
      ? Math.round((value - offset) / scene.grid.size) * scene.grid.size +
        offset
      : value;
  return {
    id: `pending:${String(body.actionId)}`,
    definitionId: definition?.id ?? `pending:${String(body.actionId)}`,
    definitionRevision: definition?.revision ?? 0,
    controllerMembershipIds:
      (body.controllerMembershipIds as string[] | undefined) ??
      definition?.controllerMembershipIds ??
      character?.controllerMembershipIds ??
      [],
    sceneId: scene.id,
    characterId: character?.id ?? null,
    ownerMembershipId: character?.ownerMembershipId ?? null,
    assetId:
      (body.assetId as string | null | undefined) ??
      definition?.defaultAssetId ??
      character?.portraitAssetId ??
      null,
    name:
      (body.name as string | undefined) ??
      definition?.name ??
      character?.name ??
      "Токен",
    x: snap(Number(body.x ?? scene.width / 2 - width / 2), scene.grid.offsetX),
    y: snap(
      Number(body.y ?? scene.height / 2 - height / 2),
      scene.grid.offsetY,
    ),
    width,
    height,
    z: 0,
    levelId: null,
    rotation: 0,
    visible: true,
    locked: true,
    baseColor: "#ffffff",
    frameColor: null,
    layer: "PLAYER",
    conditions: [],
    revision: 0,
  };
}

type ConditionIntent = { condition: TokenCondition; enabled: boolean };
type PendingConditions = { base: TokenDto; intents: ConditionIntent[] };

/** Local intent overlays never replace the authoritative websocket snapshot. */
export class OptimisticTokenMutations {
  private placements = new Map<string, TokenDto>();
  private conditions = new Map<string, PendingConditions>();
  private version = 0;
  private generation = 0;
  private listeners = new Set<() => void>();

  constructor(
    private dependencies: {
      readToken: (id: string) => TokenDto | undefined;
      acceptToken: (token: TokenDto) => void;
      sendConditions: (
        token: TokenDto,
        conditions: TokenCondition[],
      ) => Promise<Partial<TokenDto> & { revision: number }>;
      reloadToken: (id: string) => Promise<TokenDto | undefined>;
      onError: (reason: unknown) => void;
    },
  ) {}

  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  getVersion = () => this.version;
  /** Call on logout, campaign switch and unmount. Old replies become inert. */
  reset = () => {
    this.generation++;
    this.placements.clear();
    this.conditions.clear();
    this.changed();
  };
  private changed() {
    this.version++;
    this.listeners.forEach((listener) => listener());
  }

  project(tokens: TokenDto[]): TokenDto[] {
    const result = tokens.map((token) => {
      const pending = this.conditions.get(token.id);
      return pending
        ? {
            ...token,
            conditions: applyIntents(token.conditions, pending.intents),
          }
        : token;
    });
    for (const token of this.placements.values()) {
      const placementId = token.id.startsWith("pending:")
        ? token.id.slice("pending:".length)
        : token.id;
      if (
        !result.some((item) => item.id === token.id || item.id === placementId)
      )
        result.push(token);
    }
    return result;
  }

  /** Independent placements start immediately, with no shared request queue. */
  place(
    temporary: TokenDto,
    send: () => Promise<Partial<TokenDto> & { id: string; revision: number }>,
  ): void {
    const generation = this.generation;
    this.placements.set(temporary.id, temporary);
    this.changed();
    void Promise.resolve()
      .then(() => (generation === this.generation ? send() : undefined))
      .then((response) => {
        if (generation !== this.generation || !response) return;
        this.dependencies.acceptToken({ ...temporary, ...response });
      })
      .catch((reason) => {
        if (generation === this.generation) this.dependencies.onError(reason);
      })
      .finally(() => {
        if (generation !== this.generation) return;
        this.placements.delete(temporary.id);
        this.changed();
      });
  }

  setConditions(id: string, next: TokenCondition[]): void {
    const token = this.dependencies.readToken(id);
    if (!token) return;
    const pending = this.conditions.get(id);
    const current = applyIntents(token.conditions, pending?.intents ?? []);
    const changed = [...new Set([...current, ...next])].filter(
      (condition) => current.includes(condition) !== next.includes(condition),
    );
    if (!changed.length) return;
    const state = pending ?? { base: token, intents: [] };
    state.intents.push(
      ...changed.map((condition) => ({
        condition,
        enabled: next.includes(condition),
      })),
    );
    this.conditions.set(id, state);
    this.changed();
    if (!pending) void this.flush(id, state);
  }

  private async flush(id: string, state: PendingConditions) {
    const generation = this.generation;
    try {
      while (state.intents.length) {
        const batch = state.intents.slice();
        const live = this.dependencies.readToken(id);
        let base =
          live && live.revision > state.base.revision ? live : state.base;
        let response: Partial<TokenDto> & { revision: number };
        try {
          response = await this.dependencies.sendConditions(
            base,
            applyIntents(base.conditions, batch),
          );
        } catch (reason) {
          if (generation !== this.generation) return;
          if (!(
            typeof reason === "object" &&
            reason !== null &&
            "status" in reason &&
            reason.status === 409
          ))
            throw reason;
          const refreshed = await this.dependencies.reloadToken(id);
          if (generation !== this.generation) return;
          if (!refreshed) throw reason;
          base = refreshed;
          response = await this.dependencies.sendConditions(
            base,
            applyIntents(base.conditions, batch),
          );
        }
        if (generation !== this.generation) return;
        state.base = { ...base, ...response };
        state.intents.splice(0, batch.length);
        this.dependencies.acceptToken(state.base);
        this.changed();
      }
    } catch (reason) {
      if (generation !== this.generation) return;
      this.dependencies.onError(reason);
      // Roll back only this token's speculative intent, never other entities.
      try {
        const canonical = await this.dependencies.reloadToken(id);
        if (generation !== this.generation) return;
        if (canonical) this.dependencies.acceptToken(canonical);
      } catch {
        /* Preserve the last confirmed state when offline. */
      }
    } finally {
      if (generation === this.generation) {
        this.conditions.delete(id);
        this.changed();
      }
    }
  }
}

function applyIntents(
  base: TokenCondition[],
  intents: ConditionIntent[],
): TokenCondition[] {
  const result = new Set(base);
  for (const { condition, enabled } of intents) {
    if (enabled) result.add(condition);
    else result.delete(condition);
  }
  return [...result];
}

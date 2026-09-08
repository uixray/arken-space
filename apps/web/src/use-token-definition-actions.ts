import { useMemo, type MutableRefObject } from "react";
import type { GameSnapshot, SceneDto } from "@arken/contracts";
import { api } from "./api";
import { characterTokenPlacementRequest } from "./token-placement";
import type { OptimisticTokenPlacer } from "./optimistic-token-placement";
import type { MutationRunners } from "./use-mutation-runners";

/**
 * UIX-398 — token-definition commands.
 *
 * Second of the ref-domains. Two of these read state derived during render
 * rather than held in `useState`: placing a definition needs the scene it
 * lands on, and creating a character's token needs both the scene and the
 * snapshot to work out where it goes. Depending on either directly would
 * rebuild every handler here whenever the active scene changes or any game
 * event arrives, so both arrive as refs (see `use-latest-ref.ts`).
 *
 * This domain is why `activeScene` is now derived above `App.tsx`'s auth and
 * loading guards: the Rules of Hooks forbid calling a hook after a
 * conditional return, so a value a stable handler must read has to exist
 * before them.
 *
 * The refs are read only inside handlers, which run from user events — never
 * during render, where a latest-ref may legitimately lag a frame.
 */
export interface TokenDefinitionActions {
  /**
   * Places a definition on the active scene, letting the server pick the
   * square. The canvas has its own drag-and-drop placement that also carries
   * a point — a genuinely different operation, still owned by App.
   */
  onPlaceTokenDefinition: (definitionId: string) => Promise<void>;
  onDeleteTokenDefinition: (
    definitionId: string,
    revision: number,
  ) => Promise<void>;
  onPatchTokenDefinition: (
    definitionId: string,
    revision: number,
    patch: {
      /** UIX-400: `null` — «зовусь как мой персонаж», отсутствие — не трогать. */
      name?: string | null;
      defaultAssetId?: string | null;
      characterId?: string | null;
      defaultWidth?: number;
      defaultHeight?: number;
    },
  ) => Promise<void>;
  onCreateTokenDefinition: (input: {
    /** UIX-400: `null` — «зовусь как мой персонаж». */
    name: string | null;
    characterId: string | null;
    defaultAssetId: string | null;
    defaultWidth: number;
    defaultHeight: number;
    controllerMembershipIds: string[];
  }) => Promise<void>;
  onCreateAndPlaceTokenDefinition: (
    input: Parameters<TokenDefinitionActions["onCreateTokenDefinition"]>[0],
  ) => Promise<void>;
  onReplaceTokenControllers: (
    definitionId: string,
    revision: number,
    controllerMembershipIds: string[],
  ) => Promise<void>;
  onCreateToken: (characterId: string) => Promise<void>;
}

const withAction = (body: Record<string, unknown> = {}) =>
  JSON.stringify({ ...body, actionId: crypto.randomUUID() });

export function useTokenDefinitionActions(dependencies: {
  /** Stable — see `use-mutation-runners.ts`. */
  run: MutationRunners["run"];
  snapshotRef: MutableRefObject<GameSnapshot | null>;
  activeSceneRef: MutableRefObject<SceneDto | undefined>;
  /** Paints immediately; only create-and-place awaits its commit outcome. */
  placeOptimistically?: OptimisticTokenPlacer;
}): TokenDefinitionActions {
  const { run, snapshotRef, activeSceneRef, placeOptimistically } =
    dependencies;

  return useMemo<TokenDefinitionActions>(
    () => ({
      onPlaceTokenDefinition: (definitionId) => {
        if (placeOptimistically) {
          void placeOptimistically({
            path: `/api/token-definitions/${definitionId}/placements`,
            body: {
              actionId: crypto.randomUUID(),
              definitionId,
              sceneId: activeSceneRef.current?.id,
            },
          });
          return Promise.resolve();
        }
        return run(() =>
          api(`/api/token-definitions/${definitionId}/placements`, {
            method: "POST",
            body: withAction({
              definitionId,
              sceneId: activeSceneRef.current?.id,
            }),
          }),
        );
      },

      onDeleteTokenDefinition: (definitionId, revision) =>
        run(() =>
          api(`/api/token-definitions/${definitionId}`, {
            method: "DELETE",
            body: withAction({ revision }),
          }),
        ),

      onPatchTokenDefinition: (definitionId, revision, patch) =>
        run(() =>
          api(`/api/token-definitions/${definitionId}`, {
            method: "PATCH",
            body: withAction({ ...patch, revision }),
          }),
        ),

      // These two refetch the snapshot and then discard the result: callers
      // type them as Promise<void>, so returning `run`'s value would change
      // the contract rather than preserve it.
      onCreateTokenDefinition: (input) =>
        run(
          () =>
            api("/api/token-definitions", {
              method: "POST",
              body: withAction(input),
            }),
          true,
        ).then(() => undefined),

      onCreateAndPlaceTokenDefinition: async (input) => {
        const scene = activeSceneRef.current;
        if (!scene)
          throw new Error(
            "Активная сцена недоступна. Выберите сцену и повторите попытку.",
          );
        if (placeOptimistically) {
          const outcome = await placeOptimistically(
            {
              path: "/api/tokens",
              body: {
                actionId: crypto.randomUUID(),
                sceneId: scene.id,
                characterId: input.characterId,
                assetId: input.defaultAssetId,
                name: input.name ?? undefined,
                x: scene.width / 2 - input.defaultWidth / 2,
                y: scene.height / 2 - input.defaultHeight / 2,
                width: input.defaultWidth,
                height: input.defaultHeight,
                controllerMembershipIds: input.controllerMembershipIds,
              },
            },
            { errorOwner: "caller" },
          );
          if (outcome.status === "failed") throw outcome.reason;
          if (outcome.status === "cancelled")
            throw new Error("Сессия изменилась. Создайте токен заново.");
          if (outcome.status === "skipped") {
            const messages = {
              "not-ready": "Данные кампании ещё не загружены.",
              paused:
                "Игра приостановлена. Продолжите игру перед размещением токена.",
              "missing-scene":
                "Активная сцена недоступна. Выберите сцену и повторите попытку.",
            };
            throw new Error(messages[outcome.reason]);
          }
          return;
        }
        await run(
          () =>
            api("/api/tokens", {
              method: "POST",
              body: withAction({
                sceneId: scene.id,
                characterId: input.characterId,
                assetId: input.defaultAssetId,
                name: input.name ?? undefined,
                x: scene.width / 2 - input.defaultWidth / 2,
                y: scene.height / 2 - input.defaultHeight / 2,
                width: input.defaultWidth,
                height: input.defaultHeight,
                controllerMembershipIds: input.controllerMembershipIds,
              }),
            }),
          true,
          { errorOwner: "caller" },
        );
      },

      onReplaceTokenControllers: (
        definitionId,
        revision,
        controllerMembershipIds,
      ) =>
        run(
          () =>
            api(`/api/token-definitions/${definitionId}/controllers`, {
              method: "PUT",
              body: withAction({ revision, controllerMembershipIds }),
            }),
          true,
        ).then(() => undefined),

      onCreateToken: async (characterId) => {
        const activeScene = activeSceneRef.current;
        const snapshot = snapshotRef.current;
        if (!activeScene || !snapshot) return;
        // Placement is worked out client-side (a free square at the
        // character's token size), so no request means there is nowhere to
        // put it — not a failure worth surfacing.
        const request = characterTokenPlacementRequest(
          snapshot,
          characterId,
          activeScene,
          crypto.randomUUID(),
        );
        if (!request) return;
        if (placeOptimistically) {
          void placeOptimistically(request);
          return;
        }
        await run(
          () =>
            api(request.path, {
              method: "POST",
              body: JSON.stringify(request.body),
            }),
          true,
        );
      },
    }),
    [run, snapshotRef, activeSceneRef, placeOptimistically],
  );
}

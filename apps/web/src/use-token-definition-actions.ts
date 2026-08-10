import { useMemo, type MutableRefObject } from "react";
import type { GameSnapshot, SceneDto } from "@arken/contracts";
import { api } from "./api";
import { characterTokenPlacementRequest } from "./token-placement";

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
      name?: string;
      defaultAssetId?: string | null;
      characterId?: string | null;
      defaultWidth?: number;
      defaultHeight?: number;
    },
  ) => Promise<void>;
  onCreateTokenDefinition: (input: {
    name: string;
    characterId: string | null;
    defaultAssetId: string | null;
    defaultWidth: number;
    defaultHeight: number;
    controllerMembershipIds: string[];
  }) => Promise<void>;
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
  run: (action: () => Promise<unknown>, refresh?: boolean) => Promise<void>;
  snapshotRef: MutableRefObject<GameSnapshot | null>;
  activeSceneRef: MutableRefObject<SceneDto | undefined>;
}): TokenDefinitionActions {
  const { run, snapshotRef, activeSceneRef } = dependencies;

  return useMemo<TokenDefinitionActions>(
    () => ({
      onPlaceTokenDefinition: (definitionId) =>
        run(() =>
          api(`/api/token-definitions/${definitionId}/placements`, {
            method: "POST",
            body: withAction({
              definitionId,
              sceneId: activeSceneRef.current?.id,
            }),
          }),
        ),

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
    [run, snapshotRef, activeSceneRef],
  );
}

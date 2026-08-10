import { useMemo } from "react";
import type { GameSnapshot, SceneDto } from "@arken/contracts";
import { api } from "./api";
import type { SceneDraft } from "./ui/SceneManagerDialog";

/**
 * UIX-398 step A1 — scene commands, extracted from `App.tsx` as the pilot
 * domain (six handlers, no overlap with other domains).
 *
 * Worth recording, because it changes what the remaining domains need: the
 * plan assumed handlers would have to read live values through a
 * "ref to latest" indirection, since a `useCallback` depending on `snapshot`
 * would be rebuilt on every game event — precisely when stability matters
 * most. These six turned out to close over nothing render-scoped at all:
 * only `run` (stable since step A0), a `useState` setter, and the module's
 * `api`. So no ref is needed here, and adding one would have been machinery
 * for its own sake. Domains that do read `snapshot` will need it; this one
 * does not, and each should be checked rather than assumed.
 */
export interface SceneActions {
  onViewScene: (sceneId: string) => void;
  onSaveScene: (
    scene: GameSnapshot["scenes"][number] | null,
    draft: SceneDraft,
  ) => Promise<void>;
  /** @deprecated SceneManagerDialog owns scene editing. */
  onCreateScene: (name: string) => Promise<void>;
  onActivateScene: (sceneId: string) => Promise<void>;
  /** @deprecated SceneManagerDialog owns scene editing. */
  onAssignMap: (sceneId: string, assetId: string | null) => Promise<void>;
  /** @deprecated SceneManagerDialog owns scene editing. */
  onRenameScene: (
    sceneId: string,
    revision: number,
    name: string,
  ) => Promise<void>;
}

const sceneGrid = (draft: SceneDraft) => ({
  enabled: draft.gridEnabled,
  size: draft.gridSize,
  offsetX: draft.gridOffsetX,
  offsetY: draft.gridOffsetY,
  color: draft.gridColor,
  opacity: draft.gridOpacity,
});

const sceneFrame = (draft: SceneDraft) => ({
  x: draft.frameX,
  y: draft.frameY,
  width: draft.frameWidth,
  height: draft.frameHeight,
});

export function useSceneActions(dependencies: {
  /** Stable — see `use-mutation-runners.ts`. */
  run: (action: () => Promise<unknown>, refresh?: boolean) => Promise<void>;
  /** A `useState` setter, stable by React's contract. */
  setViewedSceneId: (sceneId: string) => void;
}): SceneActions {
  const { run, setViewedSceneId } = dependencies;

  // Both dependencies are stable for the component's lifetime, so this object
  // and every handler on it keep their identity — which is the entire point:
  // an unstable action object would defeat React.memo just as thoroughly as
  // the inline arrows it replaces.
  return useMemo<SceneActions>(
    () => ({
      onViewScene: (sceneId) => setViewedSceneId(sceneId),

      onSaveScene: async (scene, draft) => {
        if (!scene) {
          await run(async () => {
            const created = await api<SceneDto>("/api/scenes", {
              method: "POST",
              body: JSON.stringify({
                actionId: crypto.randomUUID(),
                name: draft.name,
                mapAssetId: draft.mapAssetId,
                width: draft.width,
                height: draft.height,
                grid: sceneGrid(draft),
                backgroundFrame: sceneFrame(draft),
              }),
            });
            setViewedSceneId(created.id);
          }, true);
          return;
        }
        await run(
          () =>
            api(`/api/scenes/${scene.id}/canvas`, {
              method: "PATCH",
              body: JSON.stringify({
                actionId: crypto.randomUUID(),
                revision: scene.revision ?? 0,
                name: draft.name,
                mapAssetId: draft.mapAssetId,
                world: { width: draft.width, height: draft.height },
                grid: sceneGrid(draft),
                backgroundFrame: sceneFrame(draft),
              }),
            }),
          true,
        );
      },

      onCreateScene: (name) =>
        run(
          () =>
            api("/api/scenes", {
              method: "POST",
              body: JSON.stringify({ name, actionId: crypto.randomUUID() }),
            }),
          true,
        ),

      onActivateScene: (sceneId) =>
        run(() =>
          api("/api/scenes/activate", {
            method: "POST",
            body: JSON.stringify({ sceneId, actionId: crypto.randomUUID() }),
          }),
        ),

      onAssignMap: (sceneId, mapAssetId) =>
        run(
          () =>
            api(`/api/scenes/${sceneId}`, {
              method: "PATCH",
              body: JSON.stringify({
                mapAssetId,
                actionId: crypto.randomUUID(),
              }),
            }),
          true,
        ),

      onRenameScene: (sceneId, revision, name) =>
        run(() =>
          api(`/api/scenes/${sceneId}`, {
            method: "PATCH",
            body: JSON.stringify({
              actionId: crypto.randomUUID(),
              revision,
              name,
            }),
          }),
        ),
    }),
    [run, setViewedSceneId],
  );
}

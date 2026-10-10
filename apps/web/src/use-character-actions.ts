import {
  useMemo,
  type Dispatch,
  type MutableRefObject,
  type SetStateAction,
} from "react";
import type { CharacterDto, GameSnapshot } from "@arken/contracts";
import { ApiError, api } from "./api";
import {
  buildCharacterCounterPatch,
  isCharacterCounterPatchNoop,
  shouldRetryCharacterCounterConflict,
  type CharacterCounterMutationIntent,
  type CharacterCounterPatch,
} from "./character-counter-mutation";
import {
  applyCharacterMutationToSnapshot,
  mergeCharacterMutationResponse,
  reconcileGameSnapshot,
} from "./character-mutation";

export interface CharacterActions {
  replaceCharacterControllers: (
    characterId: string,
    revision: number,
    controllerMembershipIds: string[],
  ) => Promise<void>;
  patchCharacter: (id: string, patch: Partial<CharacterDto>) => Promise<void>;
  updateCharacterCounters: (
    characterId: string,
    requestedRevision: number,
    patch: CharacterCounterPatch,
    intent?: CharacterCounterMutationIntent,
  ) => Promise<void>;
}

/** Character writes share a per-character queue so patches and counters rebase
 * on the last canonical revision. Keep queue/recovery policy private here. */
export function useCharacterActions(dependencies: {
  snapshotRef: MutableRefObject<GameSnapshot | null>;
  queuesRef: MutableRefObject<Map<string, Promise<CharacterDto | undefined>>>;
  setSnapshot: Dispatch<SetStateAction<GameSnapshot | null>>;
  setError: (message: string) => void;
}): CharacterActions {
  const { snapshotRef, queuesRef, setSnapshot, setError } = dependencies;
  return useMemo(() => {
    const replaceCharacterControllers: CharacterActions["replaceCharacterControllers"] =
      async (characterId, revision, controllerMembershipIds) => {
        try {
          const response = await api<{
            ok: true;
            controllerMembershipIds: string[];
            revision: number;
          }>(`/api/characters/${characterId}/controllers`, {
            method: "PUT",
            body: JSON.stringify({
              actionId: crypto.randomUUID(),
              revision,
              controllerMembershipIds,
            }),
          });
          setSnapshot((current) =>
            current
              ? {
                  ...current,
                  characters: current.characters.map((character) =>
                    character.id === characterId &&
                    character.revision <= response.revision
                      ? {
                          ...character,
                          controllerMembershipIds:
                            response.controllerMembershipIds,
                          revision: response.revision,
                        }
                      : character,
                  ),
                }
              : current,
          );
        } catch (reason) {
          const canonical = await api<GameSnapshot>("/api/bootstrap");
          setSnapshot((current) => reconcileGameSnapshot(current, canonical));
          throw reason;
        }
      };

    const patchCharacter: CharacterActions["patchCharacter"] = (id, patch) => {
      const requestedRevision =
        patch.revision ??
        snapshotRef.current?.characters.find((character) => character.id === id)
          ?.revision;
      setSnapshot((current) =>
        current
          ? {
              ...current,
              characters: current.characters.map((character) =>
                character.id === id
                  ? {
                      ...character,
                      ...patch,
                      stats: patch.stats
                        ? { ...character.stats, ...patch.stats }
                        : character.stats,
                    }
                  : character,
              ),
            }
          : current,
      );
      const previousQueue = queuesRef.current.get(id);
      const previous = previousQueue ?? Promise.resolve(undefined);
      const operation = previous.then(async (previousCharacter) => {
        const { revision: _revision, ...updates } = patch;
        const base = previousQueue
          ? previousCharacter
          : snapshotRef.current?.characters.find(
              (character) => character.id === id,
            );
        if (!base)
          throw new Error(
            "Персонаж больше недоступен. Обновите список персонажей.",
          );
        const response = await api<unknown>(`/api/characters/${id}`, {
          method: "PATCH",
          body: JSON.stringify({
            ...updates,
            actionId: crypto.randomUUID(),
            revision: base.revision ?? requestedRevision,
          }),
        });
        let updated = mergeCharacterMutationResponse(base, response);
        if (!updated) {
          const refreshed = await api<GameSnapshot>("/api/bootstrap");
          setSnapshot((current) => reconcileGameSnapshot(current, refreshed));
          updated =
            refreshed.characters.find((character) => character.id === id) ??
            null;
        }
        if (!updated)
          throw new Error(
            "Персонаж больше недоступен. Обновите список персонажей.",
          );
        setSnapshot((current) =>
          applyCharacterMutationToSnapshot(current, updated),
        );
        return updated;
      });
      const queueTail = operation
        .catch(async (reason) => {
          setError(
            reason instanceof Error
              ? reason.message
              : "Не удалось сохранить персонажа",
          );
          const canonical = await api<GameSnapshot>("/api/bootstrap");
          setSnapshot(canonical);
          return canonical.characters.find((character) => character.id === id);
        })
        .finally(() => {
          if (queuesRef.current.get(id) === queueTail)
            queuesRef.current.delete(id);
        });
      queuesRef.current.set(id, queueTail);
      return operation
        .then(() => undefined)
        .catch(async (reason) => {
          await queueTail;
          throw reason;
        });
    };

    const updateCharacterCounters: CharacterActions["updateCharacterCounters"] =
      (characterId, requestedRevision, patch, intent) => {
        const previous =
          queuesRef.current.get(characterId) ??
          Promise.resolve(
            snapshotRef.current?.characters.find(
              (character) => character.id === characterId,
            ),
          );
        const operation = previous.then(async (queuedCharacter) => {
          let canonical = queuedCharacter;
          const submit = async (base: CharacterDto) => {
            const nextPatch = buildCharacterCounterPatch(base, patch, intent);
            if (isCharacterCounterPatchNoop(base, nextPatch)) return base;
            const response = await api<unknown>(
              `/api/characters/${characterId}/counters`,
              {
                method: "PATCH",
                body: JSON.stringify({
                  ...nextPatch,
                  actionId: crypto.randomUUID(),
                  revision: base.revision,
                }),
              },
            );
            const updated = mergeCharacterMutationResponse(base, response);
            if (updated) return updated;
            const refreshed = await api<GameSnapshot>("/api/bootstrap");
            setSnapshot((current) => reconcileGameSnapshot(current, refreshed));
            const replayed = refreshed.characters.find(
              (character) => character.id === characterId,
            );
            if (!replayed)
              throw new Error(
                "Персонаж больше не доступен. Обновите страницу.",
              );
            return replayed;
          };
          if (!canonical) {
            const refreshed = await api<GameSnapshot>("/api/bootstrap");
            setSnapshot((current) => reconcileGameSnapshot(current, refreshed));
            canonical = refreshed.characters.find(
              (character) => character.id === characterId,
            );
          }
          if (!canonical)
            throw new Error("Персонаж больше не доступен. Обновите страницу.");
          try {
            const updated = await submit({
              ...canonical,
              revision: canonical.revision ?? requestedRevision,
            });
            setSnapshot((current) =>
              applyCharacterMutationToSnapshot(current, updated),
            );
            return updated;
          } catch (reason) {
            if (
              !(reason instanceof ApiError) ||
              reason.code !== "CHARACTER_CONFLICT"
            )
              throw reason;
            const refreshed = await api<GameSnapshot>("/api/bootstrap");
            setSnapshot((current) => reconcileGameSnapshot(current, refreshed));
            const freshCharacter = refreshed.characters.find(
              (character) => character.id === characterId,
            );
            if (!freshCharacter) throw reason;
            const freshPatch = buildCharacterCounterPatch(
              freshCharacter,
              patch,
              intent,
            );
            if (isCharacterCounterPatchNoop(freshCharacter, freshPatch))
              return freshCharacter;
            if (!shouldRetryCharacterCounterConflict(intent, patch))
              throw reason;
            const updated = await submit(freshCharacter);
            setSnapshot((current) =>
              applyCharacterMutationToSnapshot(current, updated),
            );
            return updated;
          }
        });
        const queueTail = operation
          .catch(async () => {
            const refreshed = await api<GameSnapshot>("/api/bootstrap");
            setSnapshot((current) => reconcileGameSnapshot(current, refreshed));
            return refreshed.characters.find(
              (character) => character.id === characterId,
            );
          })
          .finally(() => {
            if (queuesRef.current.get(characterId) === queueTail)
              queuesRef.current.delete(characterId);
          });
        queuesRef.current.set(characterId, queueTail);
        return operation
          .then(() => undefined)
          .catch(async (reason) => {
            await queueTail;
            throw reason;
          });
      };

    return {
      replaceCharacterControllers,
      patchCharacter,
      updateCharacterCounters,
    };
  }, [snapshotRef, queuesRef, setSnapshot, setError]);
}

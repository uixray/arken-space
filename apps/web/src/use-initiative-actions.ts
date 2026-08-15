import { useMemo } from "react";
import type { InitiativeParticipantDto } from "@arken/contracts";
import { api } from "./api";

/**
 * UIX-431 — правка очереди ходов.
 *
 * Очередь уходит целиком и под ревизией кампании, как раскладка характеристик:
 * она общая на кампанию, и две одновременные правки обязаны разойтись
 * конфликтом, а не слиться в порядок, которого никто не задумывал.
 *
 * На сервер едет только то, что там хранится: собственное имя (а не показанное),
 * ссылка на токен и бросок. Отправив показанное имя, панель молча превратила бы
 * наследование в копию — тот же урок, что в UIX-400.
 */
export interface InitiativeActions {
  onUpdateInitiative: (
    participants: InitiativeParticipantDto[],
    revision: number,
  ) => Promise<void>;
}

export function useInitiativeActions(dependencies: {
  /** Stable — `useCallback` with an empty dependency list in App. */
  load: () => Promise<void>;
}): InitiativeActions {
  const { load } = dependencies;
  return useMemo<InitiativeActions>(
    () => ({
      onUpdateInitiative: async (participants, revision) => {
        await api("/api/campaign/initiative", {
          method: "PATCH",
          body: JSON.stringify({
            actionId: crypto.randomUUID(),
            revision,
            participants: participants.map((participant) => ({
              id: participant.id,
              tokenId: participant.tokenId,
              name: participant.ownName,
              initiative: participant.initiative,
            })),
          }),
        });
        await load();
      },
    }),
    [load],
  );
}

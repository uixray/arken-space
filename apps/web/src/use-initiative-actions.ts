import { useMemo } from "react";
import type { InitiativeParticipantDto } from "@arken/contracts";
import { api } from "./api";
import { initiativeRollFormula, initiativeRollLabel } from "./initiative-roll";

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
  /**
   * UIX-466 — «поставить своей строке значение».
   *
   * Отдельно от правки очереди целиком, потому что игрок видит её
   * отфильтрованной: строк противников у него нет, и отправить полный состав он
   * не может физически — сервер увидел бы, что участники исчезли. Так и вышло с
   * первой попыткой дать игроку общий маршрут.
   */
  onSetOwnInitiative: (
    participantId: string,
    initiative: number | null,
    revision: number,
  ) => Promise<void>;
  /**
   * UIX-466 — бросить инициативу за участника и записать результат в его строку.
   *
   * Раньше бросок и запись были разными действиями: кубик кидали, а число
   * переносили в очередь руками. Здесь результат берётся из ответа `/api/dice` и
   * тем же движением уходит в строку — мастеру общей правкой, игроку узкой.
   *
   * Ревизию кампании бросок не двигает (он пишет сообщение, а не кампанию),
   * поэтому переданная `revision` остаётся годной для записи следом.
   */
  onRollInitiative: (
    participants: readonly InitiativeParticipantDto[],
    participant: InitiativeParticipantDto,
    revision: number,
    isGm: boolean,
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
      onSetOwnInitiative: async (participantId, initiative, revision) => {
        await api("/api/campaign/initiative/self", {
          method: "PATCH",
          body: JSON.stringify({
            actionId: crypto.randomUUID(),
            revision,
            participantId,
            initiative,
          }),
        });
        await load();
      },
      onRollInitiative: async (participants, participant, revision, isGm) => {
        const rolled = await api<{ dice?: { total?: number } | null }>(
          "/api/dice",
          {
            method: "POST",
            body: JSON.stringify({
              actionId: crypto.randomUUID(),
              formula: initiativeRollFormula(participant.initiativeBonus ?? 0),
              label: initiativeRollLabel(participant.name),
              visibility: "PUBLIC",
              characterId: null,
              rollMode: "NORMAL",
            }),
          },
        );
        const total = rolled?.dice?.total;
        // Бросок уже в ленте: если итога в ответе нет, молчать нельзя, но и
        // записывать в очередь нечего — строка останется пустой, и её видно.
        if (typeof total !== "number") {
          await load();
          return;
        }
        if (isGm)
          await api("/api/campaign/initiative", {
            method: "PATCH",
            body: JSON.stringify({
              actionId: crypto.randomUUID(),
              revision,
              participants: participants.map((row) => ({
                id: row.id,
                tokenId: row.tokenId,
                name: row.ownName,
                initiative: row.id === participant.id ? total : row.initiative,
              })),
            }),
          });
        else
          await api("/api/campaign/initiative/self", {
            method: "PATCH",
            body: JSON.stringify({
              actionId: crypto.randomUUID(),
              revision,
              participantId: participant.id,
              initiative: total,
            }),
          });
        await load();
      },
    }),
    [load],
  );
}

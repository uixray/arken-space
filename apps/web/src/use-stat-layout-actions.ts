import { useMemo, useRef } from "react";
import type { StatLayout } from "@arken/contracts";
import { api } from "./api";

/**
 * UIX-424 — правка раскладки характеристик кампании.
 *
 * Отдельный домен, а не часть `catalog`: раскладка принадлежит кампании и
 * меняется под её ревизией, тогда как записи каталога — самостоятельные
 * сущности со своими.
 *
 * Ошибку сюда не глотаем: вызывающая форма показывает её рядом с полем, где
 * мастер вводил подпись, а `run` увёл бы её в общую полосу наверху — далеко от
 * того, что не получилось.
 */
export interface StatLayoutActions {
  onUpdateStatLayout: (layout: StatLayout, revision: number) => Promise<void>;
  onUpdateCharacterStatLayout: (
    characterId: string,
    layout: StatLayout,
    revision: number,
  ) => Promise<void>;
}

export function useStatLayoutActions(dependencies: {
  /** Stable — `useCallback` with an empty dependency list in App. */
  load: () => Promise<void>;
}): StatLayoutActions {
  const { load } = dependencies;
  const retryRef = useRef<{ fingerprint: string; actionId: string } | null>(
    null,
  );
  return useMemo<StatLayoutActions>(
    () => ({
      onUpdateStatLayout: async (layout, revision) => {
        await api("/api/campaign/stat-layout", {
          method: "PATCH",
          body: JSON.stringify({
            actionId: crypto.randomUUID(),
            revision,
            layout,
          }),
        });
        await load();
      },
      onUpdateCharacterStatLayout: async (characterId, layout, revision) => {
        const fingerprint = JSON.stringify([characterId, revision, layout]);
        const actionId =
          retryRef.current?.fingerprint === fingerprint
            ? retryRef.current.actionId
            : crypto.randomUUID();
        retryRef.current = { fingerprint, actionId };
        await api(
          `/api/characters/${encodeURIComponent(characterId)}/stat-layout`,
          {
            method: "PATCH",
            body: JSON.stringify({ actionId, revision, layout }),
          },
        );
        await load();
        if (retryRef.current?.actionId === actionId) retryRef.current = null;
      },
    }),
    [load],
  );
}

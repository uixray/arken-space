import { useMemo } from "react";
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
}

export function useStatLayoutActions(dependencies: {
  /** Stable — `useCallback` with an empty dependency list in App. */
  load: () => Promise<void>;
}): StatLayoutActions {
  const { load } = dependencies;
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
    }),
    [load],
  );
}

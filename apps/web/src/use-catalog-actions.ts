import { useMemo } from "react";
import type { CatalogEntryDto } from "@arken/contracts";
import { api, formatApiError } from "./api";
import type { Props as SidebarProps } from "./Sidebar";

/**
 * UIX-398 — the shared skill/ability catalog and its per-character
 * assignments, which are the same entity seen from two sides: a catalog entry
 * is the reusable template, a character entry is one character's copy of it.
 * They are grouped here because splitting them would put four endpoints under
 * `/api/characters/:id/catalog` in a different module from the four under
 * `/api/catalog` that define what they are.
 *
 * Nothing reads render-scoped state, so no ref is needed.
 */
export type CatalogActions = Pick<
  SidebarProps,
  | "onCreateCatalogEntry"
  | "onUpdateCatalogEntry"
  | "onDeleteCatalogEntry"
  | "onAssignCatalogEntry"
  | "onUpdateCharacterEntry"
  | "onDeleteCharacterEntry"
  | "onRollEntry"
  | "onRechargeEntry"
>;

const withAction = (body: Record<string, unknown> = {}) =>
  JSON.stringify({ ...body, actionId: crypto.randomUUID() });

export function useCatalogActions(dependencies: {
  /** Stable — see `use-mutation-runners.ts`. */
  run: (action: () => Promise<unknown>, refresh?: boolean) => Promise<void>;
  /** Stable — `useCallback` with an empty dependency list in App. */
  load: () => Promise<void>;
  setError: (message: string) => void;
}): CatalogActions {
  const { run, load, setError } = dependencies;

  return useMemo<CatalogActions>(
    () => ({
      // Hand-rolled rather than routed through `run`, because the caller needs
      // the created entry back — UIX-391's in-sheet picker creates an entry and
      // immediately assigns it — and `run` resolves to nothing.
      onCreateCatalogEntry: async (input) => {
        try {
          setError("");
          const entry = await api<CatalogEntryDto>("/api/catalog", {
            method: "POST",
            body: withAction({ ...input, data: input.data ?? {} }),
          });
          await load();
          return entry;
        } catch (reason) {
          setError(formatApiError(reason));
          throw reason;
        }
      },

      onUpdateCatalogEntry: (id, patch) =>
        run(
          () =>
            api(`/api/catalog/${id}`, {
              method: "PATCH",
              body: withAction(patch),
            }),
          true,
        ),

      onDeleteCatalogEntry: (id, revision) =>
        run(
          () =>
            api(`/api/catalog/${id}`, {
              method: "DELETE",
              body: withAction({ revision }),
            }),
          true,
        ),

      onAssignCatalogEntry: (characterId, catalogEntryId) =>
        run(
          () =>
            api(`/api/characters/${characterId}/catalog`, {
              method: "POST",
              body: withAction({ catalogEntryId }),
            }),
          true,
        ),

      onUpdateCharacterEntry: (characterId, id, patch) =>
        run(
          () =>
            api(`/api/characters/${characterId}/catalog/${id}`, {
              method: "PATCH",
              body: withAction(patch),
            }),
          true,
        ),

      onDeleteCharacterEntry: (characterId, id, revision) =>
        run(
          () =>
            api(`/api/characters/${characterId}/catalog/${id}`, {
              method: "DELETE",
              body: withAction({ revision }),
            }),
          true,
        ),

      onRollEntry: (characterId, entryId, input) => {
        const { mode, ...request } = input;
        return run(
          () =>
            api(`/api/characters/${characterId}/catalog/${entryId}/roll`, {
              method: "POST",
              body: withAction({
                ...request,
                // SHARE posts the card without rolling; anything else executes
                // the roll, and the server rejects an unknown mode rather than
                // guessing, so only SHARE is forwarded.
                ...(mode === "SHARE" ? { mode } : {}),
                visibility: "PUBLIC",
              }),
            }),
          true,
        );
      },

      onRechargeEntry: (characterId, entryId, revision) =>
        run(
          () =>
            api(`/api/characters/${characterId}/catalog/${entryId}/recharge`, {
              method: "POST",
              body: withAction({ revision }),
            }),
          true,
        ),
    }),
    [run, load, setError],
  );
}

import { useMemo } from "react";
import type { PlayerAccessDto, PlayerAccessSecretDto } from "@arken/contracts";
import { api } from "./api";
import type { Props as SidebarProps } from "./Sidebar";

/**
 * UIX-398 — player access and membership naming.
 *
 * Classified as a ref-domain by the earlier automated scan, which was wrong:
 * its window ran past the end of `onRevokePlayerAccess` into the neighbouring
 * `viewedSceneId={activeScene?.id}` prop. Nothing here reads render-scoped
 * state, so this needs no indirection. Two miscounts in opposite directions
 * (characters were called clean and were not) is enough to say the scan was
 * only ever a way to decide reading order — the function body is the answer.
 *
 * Three of these deliberately bypass `run`: they return a value to the caller,
 * which owns the outcome, and routing them through `run` would clear the
 * shared error banner on every listing.
 */
export type AccessActions = Pick<
  SidebarProps,
  | "onCreateInvite"
  | "onListPlayerAccess"
  | "onRotatePlayerAccess"
  | "onRevokePlayerAccess"
  | "onRenameMembership"
>;

const withAction = (body: Record<string, unknown> = {}) =>
  JSON.stringify({ ...body, actionId: crypto.randomUUID() });

export function useAccessActions(dependencies: {
  /** Stable — see `use-mutation-runners.ts`. */
  run: (action: () => Promise<unknown>, refresh?: boolean) => Promise<void>;
}): AccessActions {
  const { run } = dependencies;

  return useMemo<AccessActions>(
    () => ({
      // A week, matching the invite's own default lifetime.
      onCreateInvite: (characterId, label) =>
        api<PlayerAccessSecretDto>("/api/invites", {
          method: "POST",
          body: withAction({ characterId, label, expiresInHours: 168 }),
        }),

      onListPlayerAccess: () => api<PlayerAccessDto[]>("/api/player-access"),

      onRotatePlayerAccess: (id) =>
        api<PlayerAccessSecretDto>(`/api/player-access/${id}/rotate`, {
          method: "POST",
          body: withAction(),
        }),

      onRevokePlayerAccess: (id) =>
        run(() =>
          api(`/api/player-access/${id}/revoke`, {
            method: "POST",
            body: withAction(),
          }),
        ),

      onRenameMembership: (membershipId, revision, name) =>
        run(() =>
          api(`/api/memberships/${membershipId}/name`, {
            method: "PATCH",
            body: withAction({ revision, name }),
          }),
        ),
    }),
    [run],
  );
}

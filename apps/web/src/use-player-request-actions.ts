import { useMemo, type Dispatch, type SetStateAction } from "react";
import type { GameSnapshot, PlayerRequestDto } from "@arken/contracts";
import { api, ApiError } from "./api";
import { applyPlayerRequestChanged } from "./player-request-realtime";
import type { Props as SidebarProps } from "./Sidebar";

/**
 * UIX-398 — durable player requests.
 *
 * All three writes share one shape: send, apply the returned request to the
 * snapshot, and on a conflict refetch before rethrowing. That shape is
 * factored out rather than repeated, since three copies of a
 * conflict-handling branch is three places to fix it.
 *
 * The conflict reload is kept as-is here, unlike the canvas mutations in
 * UIX-396 stage 1 which stopped rebuilding on 409. The difference is real: a
 * conflicting canvas write has already been broadcast to this client, so the
 * correction is on its way regardless, whereas a request's new state is not
 * pushed the same way and has to be fetched.
 */
export type PlayerRequestActions = Pick<
  SidebarProps,
  | "onOpenPlayerRequestCreate"
  | "onCreatePlayerRequest"
  | "onUpdatePlayerRequest"
  | "onPlayerRequestAction"
>;

const withAction = (body: Record<string, unknown> = {}) =>
  JSON.stringify({ ...body, actionId: crypto.randomUUID() });

export function usePlayerRequestActions(dependencies: {
  setSnapshot: Dispatch<SetStateAction<GameSnapshot | null>>;
  /** Stable — `useCallback` with an empty dependency list in App. */
  load: () => Promise<void>;
  /** Stable — `useCallback` in App. */
  openPlayerRequests: () => void;
}): PlayerRequestActions {
  const { setSnapshot, load, openPlayerRequests } = dependencies;

  return useMemo<PlayerRequestActions>(() => {
    const applyOrReload = async (send: () => Promise<PlayerRequestDto>) => {
      try {
        const request = await send();
        setSnapshot((current) => applyPlayerRequestChanged(current, request));
      } catch (reason) {
        if (reason instanceof ApiError && reason.status === 409) await load();
        throw reason;
      }
    };

    return {
      onOpenPlayerRequestCreate: openPlayerRequests,

      onCreatePlayerRequest: (input) =>
        applyOrReload(() =>
          api<PlayerRequestDto>("/api/player-requests", {
            method: "POST",
            body: withAction({ ...input }),
          }),
        ),

      onUpdatePlayerRequest: (currentRequest, input) =>
        applyOrReload(() =>
          api<PlayerRequestDto>(`/api/player-requests/${currentRequest.id}`, {
            method: "PATCH",
            body: withAction({
              ...input,
              revision: currentRequest.revision,
            }),
          }),
        ),

      onPlayerRequestAction: (currentRequest, action, resolutionNote) =>
        applyOrReload(() =>
          api<PlayerRequestDto>(
            `/api/player-requests/${currentRequest.id}/actions`,
            {
              method: "POST",
              body: withAction({
                revision: currentRequest.revision,
                action,
                // Omitted rather than sent as undefined: the server treats an
                // absent note differently from an empty one.
                ...(resolutionNote ? { resolutionNote } : {}),
              }),
            },
          ),
        ),
    };
  }, [setSnapshot, load, openPlayerRequests]);
}

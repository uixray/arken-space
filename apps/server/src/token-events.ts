import { fogHiddenTokenIds, type TokenDto } from "@arken/contracts";
import { canvasSceneVisibleTo } from "./drawing-events.js";

type FogOperation = Parameters<typeof fogHiddenTokenIds>[1][number];

interface TokenView {
  id: string;
  sceneId: string;
  visible: boolean;
  layer: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

type SocketData = {
  auth?: { role: string; membershipId?: string };
  viewedSceneId?: string | null;
};

/**
 * UIX-412: whether this socket has the token in `snapshot.tokens` — the same
 * three filters buildSnapshot applies: a visible scene, the GM layer and
 * hidden flag for players, and fog for players who do not control it.
 */
export function tokenVisibleTo(
  data: SocketData,
  campaign: { activeSceneId: string | null },
  token: TokenView,
  controllerIds: readonly string[],
  reveals: readonly FogOperation[],
) {
  const auth = data.auth;
  if (!auth || !canvasSceneVisibleTo(data, campaign, token.sceneId))
    return false;
  if (auth.role === "GM") return true;
  if (!token.visible || token.layer === "GM") return false;
  return !fogHiddenTokenIds(
    [{ ...token, controllerMembershipIds: controllerIds }],
    reveals,
    { role: "PLAYER", membershipId: auth.membershipId ?? "" },
  ).has(token.id);
}

interface TokenEventSocket {
  data: SocketData;
  emit(
    event: "token:updated",
    envelope: {
      sequence: number;
      actionId: string;
      emittedAt: string;
      data: TokenDto;
    },
  ): unknown;
}

/**
 * Sends `token:updated` to every socket that sees the token, and to nobody
 * else. Only for changes that keep the token's visibility (conditions,
 * colours): who saw it before sees it after. `project` builds the DTO for
 * one viewer's controller list; a player sees only themself there.
 */
export function emitTokenUpdated(
  sockets: readonly TokenEventSocket[],
  campaign: { activeSceneId: string | null },
  token: TokenView,
  controllerIds: readonly string[],
  reveals: readonly FogOperation[],
  project: (visibleControllerIds: string[]) => TokenDto,
  envelope: { sequence: number; actionId: string; emittedAt: string },
) {
  for (const socket of sockets) {
    if (!tokenVisibleTo(socket.data, campaign, token, controllerIds, reveals))
      continue;
    const auth = socket.data.auth!;
    socket.emit("token:updated", {
      ...envelope,
      data: project(
        auth.role === "GM"
          ? [...controllerIds]
          : controllerIds.filter((id) => id === auth.membershipId),
      ),
    });
  }
}

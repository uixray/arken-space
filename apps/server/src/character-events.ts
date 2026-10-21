import type { CharacterDto } from "@arken/contracts";

/**
 * UIX-412: who sees a character in `snapshot.characters` — the GM, its owner
 * and its controllers (the same filter buildSnapshot applies).
 */
export function characterVisibleTo(
  data: { auth?: { role: string; membershipId?: string } },
  character: { ownerMembershipId: string | null },
  controllerIds: readonly string[],
) {
  const auth = data.auth;
  if (!auth) return false;
  if (auth.role === "GM") return true;
  return (
    !!auth.membershipId &&
    (character.ownerMembershipId === auth.membershipId ||
      controllerIds.includes(auth.membershipId))
  );
}

interface CharacterEventSocket {
  data: { auth?: { role: string; membershipId?: string } };
  emit(
    event: "character:updated",
    envelope: {
      sequence: number;
      actionId: string;
      emittedAt: string;
      data: CharacterDto;
    },
  ): unknown;
}

/**
 * Sends `character:updated` to every socket that has this character in its
 * snapshot, and to nobody else. `project` builds the DTO for one viewer's
 * controller list: like the snapshot, a player sees only themself there.
 */
export function emitCharacterUpdated(
  sockets: readonly CharacterEventSocket[],
  character: { ownerMembershipId: string | null },
  controllerIds: readonly string[],
  project: (visibleControllerIds: string[]) => CharacterDto,
  envelope: { sequence: number; actionId: string; emittedAt: string },
) {
  for (const socket of sockets) {
    if (!characterVisibleTo(socket.data, character, controllerIds)) continue;
    const auth = socket.data.auth!;
    socket.emit("character:updated", {
      ...envelope,
      data: project(
        auth.role === "GM"
          ? [...controllerIds]
          : controllerIds.filter((id) => id === auth.membershipId),
      ),
    });
  }
}

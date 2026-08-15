import type { GameSnapshot, Role } from "@arken/contracts";

type PlacementRequest = {
  path: string;
  body: Record<string, unknown>;
};

/**
 * Mirrors the permission model already used for token movement/control
 * (see `canMoveMapToken` in renderers/map-interaction.ts): the GM can
 * always act, and a player can act only if they are listed as a
 * controller of the token definition. Used to gate the drag-to-place
 * affordance in the token palette; the server independently re-verifies
 * this on the placement route.
 */
export function canPlaceTokenDefinition(input: {
  role: Role;
  membershipId: string;
  controllerMembershipIds: readonly string[];
}): boolean {
  return (
    input.role === "GM" ||
    input.controllerMembershipIds.includes(input.membershipId)
  );
}

export function mapWorldPointFromDrop(input: {
  clientX: number;
  clientY: number;
  containerRect: { left: number; top: number };
  pan: { x: number; y: number };
  scale: number;
}): { x: number; y: number } {
  return {
    x: (input.clientX - input.containerRect.left - input.pan.x) / input.scale,
    y: (input.clientY - input.containerRect.top - input.pan.y) / input.scale,
  };
}

export function characterTokenPlacementRequest(
  snapshot: GameSnapshot,
  characterId: string,
  scene: GameSnapshot["scenes"][number],
  actionId: string,
): PlacementRequest | null {
  const character = snapshot.characters.find((item) => item.id === characterId);
  if (!character) return null;

  const definition = snapshot.tokenDefinitions?.find(
    (item) => item.characterId === characterId,
  );
  if (definition) {
    return {
      path: `/api/token-definitions/${definition.id}/placements`,
      body: { actionId, definitionId: definition.id, sceneId: scene.id },
    };
  }

  return {
    path: "/api/tokens",
    body: {
      actionId,
      sceneId: scene.id,
      characterId,
      ownerMembershipId: character.ownerMembershipId,
      // UIX-400: имя не копируется — токен зовётся как персонаж и
      // переименовывается вместе с ним. Копия здесь и была причиной «Хориста»
      // у «Могучего Тэйна»: имя фиксировалось в момент создания навсегда.
      x: scene.width / 2,
      y: scene.height / 2,
      width: scene.grid.size,
      height: scene.grid.size,
    },
  };
}

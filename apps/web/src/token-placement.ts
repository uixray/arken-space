import type { GameSnapshot } from "@arken/contracts";

type PlacementRequest = {
  path: string;
  body: Record<string, unknown>;
};

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
      name: character.name,
      x: scene.width / 2,
      y: scene.height / 2,
      width: scene.grid.size,
      height: scene.grid.size,
    },
  };
}

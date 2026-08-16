import type {
  GameSnapshot,
  PublicCharacterIdentityDto,
} from "@arken/contracts";

/**
 * UIX-454/467 — откуда лента берёт аватар бросающего.
 *
 * Отдельным модулем, потому что лент две: `ActivityPanel` (броски и события) и
 * `ChatPanel` (переписка). Первый раз я вписал аватар только во вторую и не
 * заметил — мастер увидел ленту бросков без единого аватара. Общая функция
 * делает эту ошибку невозможной: забыть подключить её можно, а разойтись
 * поведением — нет.
 *
 * Порядок источников: миниатюра токена, потом портрет, потом инициалы.
 * Токен первый по решению мастера — на карте персонажа узнают именно по нему, а
 * портрет в ленте размером с ноготь.
 */
export function createRollAvatarSource(snapshot: GameSnapshot) {
  const identityById = new Map(
    snapshot.characterIdentities.map((identity) => [identity.id, identity]),
  );
  const assetUrlById = new Map(
    snapshot.assets.map((asset) => [asset.id, asset.url]),
  );

  return function avatarFor(characterId: string | null): {
    identity: PublicCharacterIdentityDto | null;
    assetUrl: string | null;
  } {
    const identity = characterId
      ? (identityById.get(characterId) ?? null)
      : null;
    const assetId = identity?.tokenAssetId ?? identity?.portraitAssetId ?? null;
    return {
      identity,
      assetUrl: assetId ? (assetUrlById.get(assetId) ?? null) : null,
    };
  };
}

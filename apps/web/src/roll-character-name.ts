import type { GameSnapshot } from "@arken/contracts";

/**
 * UIX-501 — чьё имя подписывает бросок.
 *
 * Подпись убирали дважды (UIX-454, UIX-467), и оба раза причина была одна: у
 * чужого броска она вырождалась в слово «Персонаж». Виновата была не подпись, а
 * источник — старая разметка искала имя в `snapshot.characters`, среди
 * **доступных мне** карточек, где чужого персонажа нет.
 *
 * Правильный источник — `characterIdentities`: публичная проекция имени для
 * персонажей, у которых есть владелец или управляющий. Отсюда первое правило.
 *
 * Второе правило нашлось замером и в постановке задачи не было. Проекция
 * фильтрует по владельцу **для всех**, включая мастера, а у NPC мастера
 * владельца нет — то есть бросок мастера за своего «Лучника в кустах» оставался
 * без подписи, хотя условие приёмки требует показывать и мастера, и персонажа.
 * Поэтому у мастера есть запасной источник: его собственный `characters`, где
 * лежат все карточки кампании.
 *
 * Утечки здесь нет и быть не может: запасной источник — это снапшот самого
 * мастера, собранный сервером по его роли. Игроку эта ветка недоступна, и
 * скрытый NPC у него по-прежнему остаётся без имени — ровно как решили в
 * UIX-454.
 *
 * Отсутствие имени — осмысленный ответ, а не сбой: строка подписана именем
 * участника, и добавлять к нему слово «Персонаж» значило бы вернуть дефект, из-за
 * которого подпись убирали.
 */
export function createRollCharacterNameSource(snapshot: GameSnapshot) {
  const publicNameById = new Map(
    snapshot.characterIdentities.map((identity) => [
      identity.id,
      identity.name,
    ]),
  );
  const ownNameById =
    snapshot.me.role === "GM"
      ? new Map(
          snapshot.characters.map((character) => [
            character.id,
            character.name,
          ]),
        )
      : null;

  return function characterNameFor(characterId: string | null): string | null {
    if (!characterId) return null;
    return (
      publicNameById.get(characterId) ?? ownNameById?.get(characterId) ?? null
    );
  };
}

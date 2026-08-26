import type { InitiativeParticipantDto } from "@arken/contracts";

/**
 * UIX-431/466 — что из очереди ходов видит конкретный человек.
 *
 * UIX-466 сменил правило с «виден токен» на «это персонаж игрока». Прежнее
 * зависело от тумана: NPC, стоящий на виду, попадал игроку в очередь, а
 * отступивший в туман — исчезал из неё посреди боя. Новое правило строже и
 * устойчивее: игрок видит себя и других игроков, противников — никогда, чем бы
 * ни кончилась разведка. Численность засады из очереди больше не вычитается
 * вовсе — это та же утечка, которую UIX-449 закрыл для самих токенов.
 *
 * Строка игрока показывается независимо от видимости его токена: свой ход
 * человек обязан видеть, даже когда сам стоит в тумане.
 *
 * Отсюда следствие, с которым надо жить: у игрока список короче, чем у мастера,
 * и «третий ход» у них означает разное. Панель информационная, очередь ведёт
 * мастер вслух — цена приемлемая.
 *
 * Участник без токена («Волк №3», брошенный физическим кубом за столом) игрокам
 * не виден: за ним нет персонажа игрока.
 */
export function projectInitiative(
  participants: ReadonlyArray<{
    id: string;
    tokenId: string | null;
    name: string | null;
    initiative: number | null;
    /** Очереди, сохранённые до UIX-466 п. 9, поля не имеют — это не закрепление. */
    pinned?: boolean;
  }>,
  context: {
    /**
     * Имена токенов, участвующих в очереди. Мастеру — всех; игроку сюда попадают
     * и токены игроков, скрытые туманом, иначе своя строка осталась бы безымянной.
     */
    tokenNames: ReadonlyMap<string, string>;
    /** Токены, за которыми стоит персонаж игрока — не мастерский NPC. */
    playerTokenIds: ReadonlySet<string>;
    /** Токены персонажей, которыми управляет именно этот человек. */
    ownTokenIds: ReadonlySet<string>;
    /** Бонус к инициативе персонажа, стоящего за токеном. */
    initiativeBonusByToken: ReadonlyMap<string, number>;
    role: "GM" | "PLAYER";
  },
): InitiativeParticipantDto[] {
  const projected: InitiativeParticipantDto[] = [];
  for (const participant of participants) {
    const tokenId = participant.tokenId;
    const isPlayerRow = tokenId ? context.playerTokenIds.has(tokenId) : false;
    if (context.role !== "GM" && !isPlayerRow) continue;
    const tokenName = tokenId ? context.tokenNames.get(tokenId) : undefined;
    projected.push({
      id: participant.id,
      tokenId,
      name: resolveParticipantName(participant.name, tokenName),
      ownName: participant.name,
      initiative: participant.initiative,
      initiativeBonus: tokenId
        ? (context.initiativeBonusByToken.get(tokenId) ?? null)
        : null,
      canEdit:
        context.role === "GM" ||
        (tokenId ? context.ownTokenIds.has(tokenId) : false),
      pinned: participant.pinned ?? false,
    });
  }
  return projected;
}

/**
 * Имя строки очереди — по той же лестнице, что имя токена в UIX-400:
 * собственное, иначе от токена, иначе подпись-заглушка.
 *
 * Последняя ступень нужна не для красоты: мастер может удалить токен посреди
 * боя, и строка обязана остаться на своём месте в очереди, а не исчезнуть или
 * превратиться в пустоту. Порядок ходов — не производная карты.
 */
export function resolveParticipantName(
  own: string | null,
  tokenName: string | undefined,
): string {
  const trimmed = own?.trim();
  if (trimmed) return trimmed;
  const inherited = tokenName?.trim();
  if (inherited) return inherited;
  return "Без имени";
}

/**
 * UIX-466 п. 3 — состав очереди по зоне боя.
 *
 * **Пополняет, а не пересобирает.** Уже введённые участники остаются со своими
 * бросками и закреплением: снимок по зоне — это «добавь тех, кто внутри», а не
 * «замени всех». Иначе повторное нажатие стирало бы внесённые числа, а вышедший
 * из зоны терял бы строку вместе с ходом.
 *
 * Участник без токена («Волк №3» за столом) переживает пополнение по той же
 * причине: на карте его нет вовсе, и любой пересчёт по геометрии его бы потерял.
 *
 * Один токен — одна строка: повторный вызов не задваивает состав. Это то же
 * правило, что стоит в `initiativeOrderSchema`, и здесь оно соблюдается заранее,
 * а не ловится отказом схемы уже после сборки.
 */
export function recruitFromZone<
  P extends { tokenId: string | null },
  T extends { id: string },
>(
  existing: readonly P[],
  inZone: readonly T[],
  makeParticipant: (tokenId: string) => P,
): P[] {
  const already = new Set(
    existing
      .map((participant) => participant.tokenId)
      .filter((tokenId): tokenId is string => Boolean(tokenId)),
  );
  const added = inZone
    .filter((token) => !already.has(token.id))
    .map((token) => makeParticipant(token.id));
  return [...existing, ...added];
}

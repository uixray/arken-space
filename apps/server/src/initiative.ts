import type { InitiativeParticipantDto } from "@arken/contracts";

/**
 * UIX-431 — что из очереди ходов видит конкретный человек.
 *
 * Правило одно: строка со скрытым токеном игроку не отправляется. Не «серым
 * цветом», не заглушкой «???» — заглушка выдала бы численность засады, а это
 * ровно та утечка, которую закрыл UIX-449 для самих токенов. Присылать
 * координаты нельзя, а присылать счётчик спрятанного — можно только если
 * считать, что игрок не умеет считать строки.
 *
 * Отсюда следствие, с которым надо жить: у игрока список короче, чем у мастера,
 * и «третий ход» у них означает разное. Панель информационная, очередь ведёт
 * мастер вслух — цена приемлемая, а обратная сделка (показать всех) стоила бы
 * засад.
 *
 * Участник без токена («Волк №3», брошенный физическим кубом за столом) игрокам
 * не виден по тому же правилу: его нет на карте, значит показывать нечего.
 */
export function projectInitiative(
  participants: ReadonlyArray<{
    id: string;
    tokenId: string | null;
    name: string | null;
    initiative: number | null;
  }>,
  context: {
    /** Имена ровно тех токенов, которые этот человек и так видит. */
    visibleTokenNames: ReadonlyMap<string, string>;
    role: "GM" | "PLAYER";
  },
): InitiativeParticipantDto[] {
  const projected: InitiativeParticipantDto[] = [];
  for (const participant of participants) {
    const tokenName = participant.tokenId
      ? context.visibleTokenNames.get(participant.tokenId)
      : undefined;
    if (context.role !== "GM" && tokenName === undefined) continue;
    projected.push({
      id: participant.id,
      tokenId: participant.tokenId,
      name: resolveParticipantName(participant.name, tokenName),
      ownName: participant.name,
      initiative: participant.initiative,
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
 * Порядок по броскам — по убыванию, «ещё не бросал» уходит вниз.
 *
 * Используется только кнопкой «пересортировать»: ввод числа порядок не меняет.
 * Это главное требование задачи — часть бросков идёт физическими кубами, и
 * автосортировка на каждый ввод рушила бы расстановку, которую мастер собрал
 * руками. Сортировка устойчива: равные броски сохраняют взаимный порядок,
 * поэтому решённая мастером ничья не перетасовывается сама.
 */
export function sortByInitiative<T extends { initiative: number | null }>(
  participants: readonly T[],
): T[] {
  return participants
    .map((participant, index) => ({ participant, index }))
    .sort((left, right) => {
      const a = left.participant.initiative;
      const b = right.participant.initiative;
      if (a === null && b === null) return left.index - right.index;
      if (a === null) return 1;
      if (b === null) return -1;
      if (a !== b) return b - a;
      return left.index - right.index;
    })
    .map(({ participant }) => participant);
}

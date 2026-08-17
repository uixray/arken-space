export type WorkspaceId =
  | "characters"
  | "tokens"
  | "scenes"
  | "setup"
  | "media"
  | "world-maps"
  | "operator-feedback"
  | "player-requests"
  | "world-encyclopedia"
  | "world-codex";

export interface WorkspaceNavItem {
  id: WorkspaceId;
  label: string;
}

/**
 * UIX-472 — какие разделы показывать этому человеку.
 *
 * «Файлы», «Карты мира» и «Энциклопедия» у игрока скрыты: это мастерские
 * инструменты подготовки, и в списке они только удлиняли перебор. Скрытие
 * **только в интерфейсе** — так решил мастер, и это записано здесь, чтобы
 * следующий читатель не принял отсутствие серверной проверки за недосмотр.
 * Прямая ссылка на такой раздел игроку по-прежнему откроется; данные внутри
 * при этом остаются под проекцией снапшота, которая никуда не делась.
 */
export function workspaceNavItems(context: {
  isGm: boolean;
  operatorFeedbackAllowed: boolean;
}): WorkspaceNavItem[] {
  const items: WorkspaceNavItem[] = [
    { id: "characters", label: "Персонажи" },
    { id: "tokens", label: "Токены" },
  ];
  if (context.isGm)
    items.push(
      { id: "scenes", label: "Сцены" },
      { id: "setup", label: "Подготовка" },
      { id: "world-encyclopedia", label: "Энциклопедия мира" },
      { id: "world-maps", label: "Карты мира" },
      { id: "world-codex", label: "Энциклопедия" },
    );
  items.push({
    id: "player-requests",
    label: context.isGm ? "Открытые заявки" : "Мои заявки",
  });
  if (context.operatorFeedbackAllowed)
    items.push({ id: "operator-feedback", label: "Operator feedback" });
  if (context.isGm) items.push({ id: "media", label: "Файлы" });
  return items;
}

/**
 * UIX-472 — сколько разделов помещается в строку.
 *
 * Считается по измеренным ширинам, а не фиксированным числом пунктов: подписи
 * разной длины, шрифт и масштаб у всех свои, и «первые четыре» на одной машине
 * занимают строку, а на другой — половину.
 *
 * Кнопка «Ещё» учитывается только когда она действительно понадобится: иначе
 * последний раздел уезжал бы в меню, освобождая место для кнопки, которая
 * открывает меню с ним одним.
 */
export function splitWorkspaceNav<T extends { id: WorkspaceId }>(
  items: readonly T[],
  widths: ReadonlyMap<WorkspaceId, number>,
  available: number,
  moreWidth: number,
  gap = 0,
): { visible: T[]; overflow: T[] } {
  if (!Number.isFinite(available) || available <= 0)
    return { visible: [], overflow: [...items] };

  const widthOf = (item: T) => widths.get(item.id) ?? 0;
  const rowWidth = (count: number) =>
    items.slice(0, count).reduce((sum, item) => sum + widthOf(item), 0) +
    Math.max(0, count - 1) * gap;

  // Всё помещается — «Ещё» не нужна вовсе.
  if (rowWidth(items.length) <= available)
    return { visible: [...items], overflow: [] };

  let fits = 0;
  for (let count = 1; count <= items.length; count += 1) {
    // Место под «Ещё» резервируется, потому что она уже неизбежна.
    if (rowWidth(count) + gap + moreWidth > available) break;
    fits = count;
  }
  return { visible: items.slice(0, fits), overflow: items.slice(fits) };
}

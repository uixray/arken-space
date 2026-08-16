import { formulaReferencesStatKey } from "@arken/contracts";
import { RESOURCE_REGEN_STAT } from "@arken/system";

/**
 * UIX-424 — превращение русской подписи характеристики в ключ и поиск ссылок на
 * ключ в формулах.
 *
 * Ключ и подпись разведены не по вкусу, а по необходимости: парсер формул
 * (`apps/server/src/dice.ts`) принимает идентификатор `[a-zA-Z_][a-zA-Z0-9_]*`,
 * то есть латиницу без пробелов. Написать «1d20 + Ближний бой» нельзя. Поэтому
 * мастер вводит подпись по-русски, а ключ строится отсюда — и после создания
 * **не меняется**, иначе формулы, которые на него ссылаются, поедут молча.
 *
 * Та же форма уже у навыков: `{ key, name, rank, formula }`.
 */

const TRANSLITERATION: Record<string, string> = {
  а: "a",
  б: "b",
  в: "v",
  г: "g",
  д: "d",
  е: "e",
  ё: "e",
  ж: "zh",
  з: "z",
  и: "i",
  й: "i",
  к: "k",
  л: "l",
  м: "m",
  н: "n",
  о: "o",
  п: "p",
  р: "r",
  с: "s",
  т: "t",
  у: "u",
  ф: "f",
  х: "h",
  ц: "c",
  ч: "ch",
  ш: "sh",
  щ: "sch",
  ъ: "",
  ы: "y",
  ь: "",
  э: "e",
  ю: "yu",
  я: "ya",
};

/**
 * Строит ключ-кандидат из подписи. Результат может совпасть с существующим —
 * уникальность обеспечивает `uniqueStatKey`.
 *
 * Возвращает пустую строку, если из подписи не осталось ни одного пригодного
 * символа (например, она состоит из одних цифр или знаков). Вызывающий код
 * обязан это обработать: ключ, начинающийся с цифры, парсер формул не примет.
 */
export function statKeyFromLabel(label: string): string {
  const letters = [...label.toLowerCase()]
    .map((character) => {
      if (Object.hasOwn(TRANSLITERATION, character))
        return TRANSLITERATION[character]!;
      if (/[a-z0-9]/.test(character)) return character;
      // Пробелы и знаки становятся границей слова, а не исчезают: иначе
      // «Ближний бой» и «Ближнийбой» дали бы один ключ.
      return " ";
    })
    .join("")
    .trim()
    .split(/\s+/)
    .filter(Boolean);

  if (letters.length === 0) return "";
  const [first, ...rest] = letters;
  const camel =
    first! +
    rest.map((word) => word[0]!.toUpperCase() + word.slice(1)).join("");
  // Формулы не примут ключ, начинающийся с цифры.
  return /^[0-9]/.test(camel) ? `_${camel}` : camel;
}

/**
 * Разводит совпадающие ключи числовым суффиксом.
 *
 * Нужно чаще, чем кажется: «Сила» и «Сила воли» дают `sila` и `silaVoli` — а вот
 * «Ближний бой» и «Ближний Бой» совпадут полностью, и без суффикса второй молча
 * затёр бы первый.
 */
export function uniqueStatKey(
  candidate: string,
  taken: Iterable<string>,
): string {
  const used = new Set(taken);
  if (!used.has(candidate)) return candidate;
  for (let suffix = 2; suffix < 1000; suffix++) {
    const next = `${candidate}${suffix}`;
    if (!used.has(next)) return next;
  }
  throw new Error("не удалось подобрать уникальный ключ характеристики");
}

/**
 * Находит формулы, ссылающиеся на ключ.
 *
 * Это защита от главной опасности задачи: удалить характеристику, на которую
 * ссылается навык, — значит получить «Стат не найден» **в момент броска на
 * игре**, а не при удалении.
 *
 * Сопоставление по границе слова, а не по вхождению подстроки: иначе удаление
 * `sila` считалось бы ссылкой в формуле `1d20 + silaVoli`, и мастер не смог бы
 * удалить характеристику из-за несуществующей связи.
 */
export function formulasReferencingKey<T extends { formula?: string }>(
  entries: readonly T[],
  key: string,
): T[] {
  // Само правило — в контракте: тот же вопрос задаёт сервер, отказывая в
  // удалении, и две копии разошлись бы ровно там, где это дороже всего —
  // клиент сказал бы «ссылок нет», а сервер отказал.
  return entries.filter((entry) =>
    formulaReferencesStatKey(entry.formula, key),
  );
}

/**
 * Все числовые строки раскладки, по порядку групп.
 *
 * Существует затем же, зачем `statLabelsFromLayout`: панель быстрых бросков
 * раньше строилась из стартовой раскладки, и добавленная мастером
 * характеристика кнопки не получала — карточка её показывала, а панель нет.
 */
export function statRowsFromLayout(
  layout: readonly {
    rows: readonly { key: string; label: string; source?: string }[];
  }[],
): { key: string; label: string }[] {
  return layout.flatMap((group) =>
    group.rows
      .filter((row) => row.source !== "RESOURCE")
      .map(({ key, label }) => ({ key, label })),
  );
}

/**
 * UIX-468 — строки, по которым имеет смысл бросать кубик.
 *
 * Реген задаёт скорость восстановления ресурса; «1d20 + реген маны» за столом
 * не значит ничего. Кнопка появилась не по замыслу: UIX-424 сделала набор
 * производным от раскладки кампании, и реген приехал в него наравне с
 * ловкостью — раскладка не различает, что бросают, а что применяют.
 *
 * Список исключений не заводится: он считается от `RESOURCE_REGEN_STAT`, того
 * же места, откуда реген берёт отдых. Второй список разошёлся бы с первым на
 * первом же новом ресурсе.
 */
export function rollableStatRows<T extends { key: string }>(
  rows: readonly T[],
): T[] {
  const regenKeys = new Set(Object.values(RESOURCE_REGEN_STAT));
  return rows.filter((row) => !regenKeys.has(row.key));
}

/**
 * Строки-ресурсы раскладки: выносливость и мана.
 *
 * UIX-424, шаг 8. Подписи ресурсов тоже принадлежат раскладке, а не коду: до
 * этого шага карточка звала их «Физическая сила» и «Магическая сила» — именами,
 * от которых мастер отказался ещё на этапе решений. Ключи при этом остаются
 * прежними (`physicalPower`, `magicPower`): переименование — это подписи, а
 * менять ключи значило бы мигрировать и записи ресурсов, и все `cost.type` в
 * способностях ради имени, которого никто не видит.
 */
export function statResourceRowsFromLayout(
  layout: readonly {
    rows: readonly { key: string; label: string; source?: string }[];
  }[],
): { key: string; label: string }[] {
  return layout.flatMap((group) =>
    group.rows
      .filter((row) => row.source === "RESOURCE")
      .map(({ key, label }) => ({ key, label })),
  );
}

/**
 * Подписи для стоимости применения.
 *
 * Ключи стоимости (`physical`, `magic`) принадлежат серверу и не меняются, а
 * имена — мастеру: он переименовал ресурсы, и форма способности обязана
 * показывать его слова, а не «Physical Power».
 *
 * Строки-ресурсы раскладки идут в порядке объявления, поэтому первая — та, что
 * соответствует `physicalPower`, вторая — `magicPower`; сопоставление идёт по
 * ключу, а не по порядку, чтобы перестановка строк ничего не сломала.
 */
export function resourceCostLabels(
  layout: readonly {
    rows: readonly { key: string; label: string; source?: string }[];
  }[],
): { physical: string; magic: string } {
  const rows = statResourceRowsFromLayout(layout);
  const labelOf = (key: string, fallback: string) =>
    rows.find((row) => row.key === key)?.label ?? fallback;
  return {
    physical: labelOf("physicalPower", "Выносливость"),
    magic: labelOf("magicPower", "Мана"),
  };
}

export function statRowsOfGroup(
  layout: readonly {
    id: string;
    rows: readonly { key: string; label: string; source?: string }[];
  }[],
  groupId: string,
): { key: string; label: string }[] {
  const group = layout.find((candidate) => candidate.id === groupId);
  return (group?.rows ?? [])
    .filter((row) => row.source !== "RESOURCE")
    .map(({ key, label }) => ({ key, label }));
}

/**
 * Плоская карта «ключ → подпись» из раскладки кампании.
 *
 * Существует затем, чтобы у списка характеристик остался **один** источник.
 * До UIX-424 он был продублирован в четырёх местах, и одна из копий уже
 * разошлась с остальными: форма способности предлагала восемь характеристик
 * из одиннадцати, молча лишая мастера трёх.
 *
 * Строки-ресурсы (выносливость, мана) сюда не попадают: их значение — пул с
 * текущим и максимумом, а не модификатор, и в формуле броска ему не место.
 */
export function statLabelsFromLayout(
  layout: readonly {
    rows: readonly { key: string; label: string; source?: string }[];
  }[],
): Record<string, string> {
  const labels: Record<string, string> = {};
  for (const group of layout)
    for (const row of group.rows)
      if (row.source !== "RESOURCE") labels[row.key] = row.label;
  return labels;
}

/**
 * UIX-424, шаг 7 — перестановка строки внутри её группы.
 *
 * Порядок строк — часть раскладки, а не украшение: в этом же порядке идут
 * кнопки в панели быстрых бросков, и мастер расставляет их так, как ему
 * удобно тянуться на игре.
 *
 * Возвращает `null`, когда двигать некуда: строка уже с краю, или такого ключа
 * в раскладке нет. Пустая правка иначе ушла бы на сервер, подняла бы ревизию
 * кампании и разошлась бы всем клиентам, ничего не изменив.
 *
 * `movable` отсеивает строки, которых мастер в карточке не видит: между двумя
 * характеристиками в группе стоят ресурсы, и обмен с ними выглядел бы как
 * «кнопка нажалась, а ничего не произошло». Меняются местами видимые соседи, а
 * невидимые строки остаются на своих местах в массиве — на их отрисовку это не
 * влияет, они находятся по ключу.
 *
 * Ключи не трогаются вовсе — на них ссылаются формулы; меняется только порядок.
 */
export function moveStatRow<G extends { rows: readonly { key: string }[] }>(
  layout: readonly G[],
  key: string,
  direction: "up" | "down",
  // Тип строки берётся из самой раскладки, а не отдельным параметром: иначе
  // вызывающий получил бы `{ key: string }` и не смог бы посмотреть на
  // `source`, ради которого предикат и нужен.
  movable: (row: G["rows"][number]) => boolean = () => true,
): G[] | null {
  const groupIndex = layout.findIndex((group) =>
    group.rows.some((row) => row.key === key),
  );
  if (groupIndex === -1) return null;

  const group = layout[groupIndex]!;
  const from = group.rows.findIndex((row) => row.key === key);
  const step = direction === "up" ? -1 : 1;
  let to = from + step;
  while (to >= 0 && to < group.rows.length && !movable(group.rows[to]!))
    to += step;
  if (to < 0 || to >= group.rows.length) return null;

  const rows = [...group.rows];
  [rows[from], rows[to]] = [rows[to]!, rows[from]!];
  return layout.map((candidate, index) =>
    index === groupIndex ? { ...candidate, rows } : candidate,
  );
}

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
  if (!key) return [];
  const pattern = new RegExp(`(^|[^a-zA-Z0-9_])${key}([^a-zA-Z0-9_]|$)`);
  return entries.filter((entry) => pattern.test(entry.formula ?? ""));
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
/**
 * Числовые строки одной группы раскладки.
 *
 * Строки `RESOURCE` отфильтрованы: у пула нет одного числа, которое можно
 * положить в поле ввода или в формулу броска. Их редактирование — блок ресурсов
 * (UIX-424, шаг 8).
 *
 * Группы неизвестной кампании может не быть вовсе — тогда пусто, а не падение:
 * раскладка приходит из базы и не обязана содержать то, чего ждёт карточка.
 */
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

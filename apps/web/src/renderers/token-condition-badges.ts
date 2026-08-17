import {
  TOKEN_CONDITION_LABEL,
  tokenConditionSchema,
  type TokenCondition,
} from "@arken/contracts";

/**
 * UIX-471 — как состояния выглядят на фигуре.
 *
 * Цвет, а не значок-символ: набор значков пришлось бы подбирать из шрифта,
 * который на чужой машине может его не иметь, и «отравлен» тихо превратился бы
 * в пустой прямоугольник. Цветная точка рисуется канвасом всегда, а что она
 * значит — говорит подпись при наведении.
 *
 * Буква рядом с цветом нужна тому, кто цвета различает плохо: две точки подряд
 * иначе неразличимы. Буквы взяты разные намеренно — «Обездвижен» и «Отравлен»
 * начинаются одинаково, поэтому у второго взята «Я» от «яда».
 */
export const TOKEN_CONDITION_BADGE: Readonly<
  Record<TokenCondition, { color: string; short: string }>
> = {
  POISONED: { color: "#6aa84f", short: "Я" },
  UNCONSCIOUS: { color: "#8e7cc3", short: "С" },
  RESTRAINED: { color: "#c9862e", short: "О" },
  PRONE: { color: "#5b8fb0", short: "Л" },
};

/**
 * Раскладка ряда значков над фигурой.
 *
 * Размер считается от фигуры, а не берётся постоянным: токены бывают и 32, и
 * 256 пикселей, и значок в четверть фигуры так же плох, как незаметная точка.
 * Нижняя граница не даёт ему исчезнуть на мелких.
 */
export function conditionBadgeLayout(
  count: number,
  tokenWidth: number,
): { size: number; gap: number; startX: number; y: number } {
  const size = Math.max(10, Math.min(18, tokenWidth / 4));
  const gap = size / 3;
  const row = count * size + Math.max(0, count - 1) * gap;
  return {
    size,
    gap,
    // Ряд по центру фигуры: сдвинутый вбок он читается как часть соседней.
    startX: (tokenWidth - row) / 2,
    // Над фигурой, а не поверх — портрет закрывать нельзя, по нему узнают.
    y: -size - 2,
  };
}

/** Подпись для наведения: перечисляет состояния словами, в порядке набора. */
export function conditionsHint(conditions: readonly TokenCondition[]): string {
  return tokenConditionSchema.options
    .filter((condition) => conditions.includes(condition))
    .map((condition) => TOKEN_CONDITION_LABEL[condition])
    .join(", ");
}

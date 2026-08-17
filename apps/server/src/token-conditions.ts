import {
  tokenConditionSchema,
  tokenConditionsSchema,
  type TokenCondition,
} from "@arken/contracts";

/**
 * UIX-471 — приведение состояний, прочитанных из `jsonb`.
 *
 * Колонка типизирована как `string[]`, но приходит из базы, то есть может быть
 * чем угодно: написанным прошлой версией, поправленным руками, недописанным.
 * Разбор схемой, а не приведение типа: неизвестное состояние иначе уехало бы
 * всем клиентам и нарисовало на фигуре значок, которого нет.
 *
 * Заодно нормализуется порядок и снимаются повторы — этим занимается сама
 * схема, здесь только обработка негодного значения.
 */
export function normalizeTokenConditions(stored: unknown): TokenCondition[] {
  const parsed = tokenConditionsSchema.safeParse(stored);
  if (parsed.success) return parsed.data;
  // Массив с одним негодным значением не должен стоить фигуре всех остальных.
  // Отбор именно по принадлежности набору, а не по типу: «CURSED» — тоже
  // строка, и проверка на `typeof` пропустила бы её обратно в схему, где она
  // снова уронила бы разбор целиком.
  if (Array.isArray(stored))
    return tokenConditionSchema.options.filter((condition) =>
      stored.includes(condition),
    );
  return [];
}

/**
 * UIX-408/409, этап 0 — временная оснастка измерений.
 *
 * Существует, чтобы не оптимизировать вслепую. Технический разбор дал числа,
 * которые между собой не сходятся: сумма по полям (780 КБ) больше заявленного
 * итога (691 КБ), а «~280 запросов на действие» — это одна сборка, умноженная
 * на семь клиентов, то есть расчёт, а не наблюдение. Целью приёмки может быть
 * только измеренное число.
 *
 * **Это не телеметрия.** Оснастка включается переменной окружения, по умолчанию
 * молчит и не стоит ничего: при выключенном флаге счётчики не заводятся, а
 * замеры не считаются. Постоянной она станет отдельным решением, если станет.
 *
 * Ничего из измеренного не содержит игровых данных: наружу идут только числа —
 * количество запросов, байты и миллисекунды. Размер по полям считается по
 * ключам верхнего уровня, а не по их содержимому.
 */
export const SNAPSHOT_METRICS_ENABLED =
  process.env.ARKEN_SNAPSHOT_METRICS === "1";

let queryCount = 0;

/** Считает запросы к БД. Вызывается из хука `postgres`, если оснастка включена. */
export function countQuery() {
  queryCount += 1;
}

export function resetQueryCount() {
  queryCount = 0;
}

export function readQueryCount() {
  return queryCount;
}

export interface BroadcastMeasurement {
  campaignId: string;
  sockets: number;
  queries: number;
  totalBytes: number;
  totalMs: number;
  /** По одному замеру на сокет: роль, размер и время сборки. */
  perSocket: { role: string; bytes: number; ms: number }[];
  /** Размер по ключам верхнего уровня — закрывает расхождение из разбора. */
  bytesByField: Record<string, number>;
}

/**
 * Размер снапшота и его состав по полям.
 *
 * `Buffer.byteLength` по сериализованному значению, а не `JSON.stringify().length`:
 * длина строки считает символы, а по сети идут байты, и на кириллице разница
 * двукратная. Именно на этом уже ошибся один замер в разборе.
 */
export function measureSnapshot(snapshot: unknown): {
  bytes: number;
  byField: Record<string, number>;
} {
  const bytes = Buffer.byteLength(JSON.stringify(snapshot), "utf8");
  const byField: Record<string, number> = {};
  if (snapshot && typeof snapshot === "object")
    for (const [key, value] of Object.entries(snapshot))
      byField[key] = Buffer.byteLength(JSON.stringify(value) ?? "", "utf8");
  return { bytes, byField };
}

/** Складывает размеры по полям нескольких снапшотов в один отчёт. */
export function sumByField(
  reports: readonly Record<string, number>[],
): Record<string, number> {
  const total: Record<string, number> = {};
  for (const report of reports)
    for (const [key, value] of Object.entries(report))
      total[key] = (total[key] ?? 0) + value;
  return total;
}

/**
 * Поля, крупнее которых стоит смотреть в первую очередь. Отсортировано по
 * убыванию — читать отчёт с конца никто не станет.
 */
export function largestFields(
  byField: Record<string, number>,
  take = 8,
): { field: string; bytes: number }[] {
  return Object.entries(byField)
    .map(([field, bytes]) => ({ field, bytes }))
    .sort((a, b) => b.bytes - a.bytes)
    .slice(0, take);
}

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
 * В новом формате v2 наружу идут числа, время записи и фиксированные метки
 * модулей, но не campaignId или значения игровых данных. Старые логи могут
 * содержать campaignId. Размер по полям считается по ключам верхнего уровня,
 * а не по их содержимому.
 */
export const SNAPSHOT_METRICS_ENABLED =
  process.env.ARKEN_SNAPSHOT_METRICS === "1";

// Fixed source labels, never a request path, entity ID or user-provided value.
// Keep the standalone report's allowlist in sync when extending this list.
export const SNAPSHOT_TRIGGER_DOMAINS = [
  "world-map",
  "progression",
  "character-extras",
  "awards",
  "character-archive",
  "encounter",
  "economy",
  "asset-lifecycle",
  "campaign-pause",
  "membership-rename",
  "character",
  "scene",
  "token",
  "canvas",
  "sticker",
  "campaign",
  "character-play",
  "asset",
  "drawing-fallback",
  "unattributed",
] as const;

export type SnapshotTriggerDomain = (typeof SNAPSHOT_TRIGGER_DOMAINS)[number];

export interface SnapshotTriggerBatch {
  scope: "ROUTE_MODULE";
  counts: Partial<Record<SnapshotTriggerDomain, number>>;
  requestedCalls: number;
  truncated: boolean;
}

/**
 * UIX-708: attribution for the existing coalescer, not a new delivery queue.
 * Record EVERY request, including callers that join an already queued run.
 * Take/delete synchronously when the actual run starts (before its first await).
 * Later requests then belong to the next run, never to the in-flight snapshot.
 * Instantiate only when SNAPSHOT_METRICS_ENABLED; no timers or retained history.
 */
export function createSnapshotTriggerCollector() {
  const pending = new Map<string, SnapshotTriggerBatch>();
  const allowed = new Set<string>(SNAPSHOT_TRIGGER_DOMAINS);
  // A bounded diagnostic counter, not an assertion about production traffic.
  const maxCallsPerBatch = 1_000_000;
  return {
    record(campaignId: string, domain: SnapshotTriggerDomain) {
      let batch = pending.get(campaignId);
      if (!batch) {
        batch = {
          scope: "ROUTE_MODULE",
          counts: {},
          requestedCalls: 0,
          truncated: false,
        };
        pending.set(campaignId, batch);
      }
      if (batch.requestedCalls === maxCallsPerBatch) {
        batch.truncated = true;
        return;
      }
      const label = allowed.has(domain) ? domain : "unattributed";
      batch.requestedCalls += 1;
      batch.counts[label] = (batch.counts[label] ?? 0) + 1;
    },
    take(campaignId: string): SnapshotTriggerBatch | null {
      const batch = pending.get(campaignId) ?? null;
      pending.delete(campaignId);
      return batch;
    },
  };
}

let queryCount = 0;

/** Считает запросы к БД. Вызывается из хука `postgres`, если оснастка включена. */
export function countQuery() {
  queryCount += 1;
}

export function readQueryCount() {
  return queryCount;
}

/**
 * Возвращает прирост монотонного process-wide счётчика.
 *
 * Это честная оценка окна, а не scoped trace: параллельная работа процесса
 * может увеличить результат, но уже не способна обнулить или испортить чужой
 * замер. Авторитетные acceptance-числа снимаются отдельным изолированным
 * процессом через `scripts/measure-broadcast.ts`.
 */
export function queryCountSince(start: number) {
  return Math.max(0, queryCount - start);
}

export interface BroadcastMeasurement {
  campaignId: string;
  sockets: number;
  queries: number;
  queryCountScope: "PROCESS_WINDOW_ESTIMATE";
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

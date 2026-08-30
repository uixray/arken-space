import type { GameSnapshot } from "@arken/contracts";

/**
 * UIX-503 — что именно отменит следующее нажатие.
 *
 * Кнопки отмены и повтора были подписаны «Отменить последнее действие». Это
 * верно и бесполезно: на карте за минуту происходит десяток правок, и человек
 * жмёт отмену вслепую, а на карте боя вслепую отменённое движение стоит хода.
 *
 * Описание собирается **на клиенте, из уже полученной истории**. Сервер отдаёт
 * только безопасный маркер авторитетного следующего Undo/Redo, но не добавляет
 * имён или снимков сущностей: `/api/canvas/history` уже отфильтрован по роли —
 * игроку приходят только его собственные публичные действия.
 *
 * Имя объекта берётся из **моего** снапшота и только оттуда. Снапшот тоже
 * отфильтрован: токен, скрытый туманом, в него не попадает. Поэтому имени может
 * не быть — и тогда подпись остаётся родовой («токен»), а не выдумывает
 * название и не раскрывает скрытое. Отсутствие имени здесь штатный ответ, а не
 * сбой.
 */
export interface CanvasHistoryEntry {
  sequence: number;
  type: string;
  targetType: string;
  targetId: string;
  status: string;
  /** Авторитетный кандидат сервера; отсутствует только у старых/mock ответов. */
  nextDirection?: "undo" | "redo" | null;
}

/**
 * Родовые названия по типу записи. Список закрытый: незнакомый тип получит
 * подпись «действие», а не будет показан сырым идентификатором из журнала.
 */
const ACTION_LABEL: Record<string, string> = {
  TOKEN_CREATE: "токен добавлен",
  TOKEN_DELETE: "токен удалён",
  TOKEN_MOVE: "токен перемещён",
  TOKEN_RESIZE: "размер токена изменён",
  TOKEN_APPEARANCE: "вид токена изменён",
  TOKEN_CONDITIONS: "состояния токена изменены",
  TOKEN_LAYER: "слой токена изменён",
  DRAWING_CREATE: "рисунок создан",
  DRAWING_UPDATE: "рисунок изменён",
  DRAWING_DELETE: "рисунок удалён",
  FOG_CREATE: "туман изменён",
  SCENE_CANVAS: "сцена изменена",
  CANVAS_BULK_MOVE: "объекты перемещены",
  CANVAS_BULK_DELETE: "объекты удалены",
};

type CanvasRevision = {
  id: string;
  revision?: number | null;
};

/**
 * Версия видимого канваса, от которой зависит авторитетная история.
 *
 * Одного максимума ревизий недостаточно: если токен 1 → 2 изменился рядом с
 * токеном ревизии 20, максимум остаётся 20 и история не перезагрузится. Здесь
 * участвует каждая пара id/revision, а сортировка не превращает простую смену
 * порядка в ложное canvas-событие.
 */
export function canvasHistoryVersion(
  scene: CanvasRevision | undefined,
  fogReveals: readonly CanvasRevision[],
  drawings: readonly CanvasRevision[],
  tokens: readonly CanvasRevision[],
): string {
  const fingerprint = (rows: readonly CanvasRevision[]) =>
    rows
      .map((row) => `${row.id}:${row.revision ?? 0}`)
      .sort()
      .join(",");
  return [
    `scene:${scene?.id ?? ""}:${scene?.revision ?? 0}`,
    `fog:${fingerprint(fogReveals)}`,
    `drawings:${fingerprint(drawings)}`,
    `tokens:${fingerprint(tokens)}`,
  ].join("|");
}

/** Имя объекта — только если он есть в моём снапшоте. */
function nameOf(
  entry: CanvasHistoryEntry,
  snapshot: GameSnapshot,
): string | null {
  if (entry.targetType !== "TOKEN") return null;
  const token = snapshot.tokens.find(
    (candidate) => candidate.id === entry.targetId,
  );
  const name = token?.name.trim();
  return name ? name : null;
}

/**
 * Описание одной записи журнала: «токен перемещён» или «токен перемещён —
 * Тейн». Имя ставится после тире, а не подставляется в фразу: фразы разные, и
 * склонять их под имя значило бы завести двенадцать шаблонов ради украшения.
 */
export function describeHistoryEntry(
  entry: CanvasHistoryEntry,
  snapshot: GameSnapshot,
): string {
  const action = ACTION_LABEL[entry.type] ?? "действие";
  const name = nameOf(entry, snapshot);
  return name ? `${action} — ${name}` : action;
}

/**
 * Подпись кнопки. Недоступной кнопке достаётся родовая подпись: обещать
 * действие, которого нет, хуже, чем не обещать ничего.
 */
export function historyControlLabel(
  direction: "undo" | "redo",
  entry: CanvasHistoryEntry | undefined,
  snapshot: GameSnapshot,
): string {
  const verb = direction === "undo" ? "Отменить" : "Повторить";
  if (!entry)
    return direction === "undo"
      ? "Отменить последнее действие"
      : "Повторить отменённое действие";
  return `${verb}: ${describeHistoryEntry(entry, snapshot)}`;
}

/**
 * Следующая запись, которую тронет кнопка.
 *
 * Отмена берёт последнюю перешедшую в APPLIED, повтор — последнюю перешедшую в
 * UNDONE. Сервер маркирует обоих авторитетных кандидатов `nextDirection`, в
 * том числе если один из них оказался за пределами обычной страницы истории.
 * Fallback по первому статусу нужен только старым мокам и прежнему серверу.
 * Исходный `sequence` для выбора не подходит: после двух Undo порядок создания
 * и порядок переходов расходятся.
 */
export function nextHistoryEntry(
  direction: "undo" | "redo",
  history: CanvasHistoryEntry[],
): CanvasHistoryEntry | undefined {
  const wanted = direction === "undo" ? "APPLIED" : "UNDONE";
  const hasCandidateMetadata = history.some(
    (entry) => entry.nextDirection !== undefined,
  );
  return hasCandidateMetadata
    ? history.find((entry) => entry.nextDirection === direction)
    : history.find((entry) => entry.status === wanted);
}

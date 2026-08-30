import type { GameSnapshot } from "@arken/contracts";

/**
 * UIX-503 — что именно отменит следующее нажатие.
 *
 * Кнопки отмены и повтора были подписаны «Отменить последнее действие». Это
 * верно и бесполезно: на карте за минуту происходит десяток правок, и человек
 * жмёт отмену вслепую, а на карте боя вслепую отменённое движение стоит хода.
 *
 * Описание собирается **на клиенте, из уже полученной истории**. Сервер новых
 * полей не отдаёт, и это не экономия: `/api/canvas/history` уже отфильтрован по
 * роли — игроку приходят только его собственные публичные действия, — а значит
 * описывать нечего сверх того, что человеку и так показано.
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
};

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
 * Отмена берёт самую свежую применённую, повтор — самую свежую отменённую.
 * Порядок здесь тот же, что у сервера: `/api/canvas/history` отдаёт записи по
 * убыванию `sequence`, и первая подходящая — та, которую сервер и выберет.
 * Считать порядок заново на клиенте нельзя: разойдясь с сервером, подпись
 * назовёт одно, а отменится другое — и это хуже прежней родовой подписи.
 */
export function nextHistoryEntry(
  direction: "undo" | "redo",
  history: CanvasHistoryEntry[],
): CanvasHistoryEntry | undefined {
  const wanted = direction === "undo" ? "APPLIED" : "UNDONE";
  return history.find((entry) => entry.status === wanted);
}

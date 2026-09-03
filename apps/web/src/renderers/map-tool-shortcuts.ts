import type { Role } from "@arken/contracts";

/**
 * Every selectable canvas tool, including tools without a keyboard shortcut.
 * SCENE_REGION is the GM encounter-area drag mode; the BRUSH and POLYGON pairs
 * are the continuous-stroke and click-to-add-vertex fog modes from UIX-313.
 */
export type MapTool =
  | "PAN"
  | "FOG"
  | "COVER"
  | "DRAW"
  | "RULER"
  | "PING"
  | "SCENE_REGION"
  | "BATTLE_ZONE"
  | "FOG_BRUSH"
  | "COVER_BRUSH"
  | "FOG_POLYGON"
  | "COVER_POLYGON";

type ShortcutMapTool = Exclude<MapTool, "SCENE_REGION">;

/**
 * UIX-463 — единственный список клавиш инструментов карты.
 *
 * До него список существовал трижды: разбор нажатия в `resolveMapToolShortcut`,
 * описание в шпаргалке (`landing-guide-content.ts`) и — молчаливым отсутствием —
 * подсказки на кнопках панели, где клавиш не было вовсе. Первые два держал в
 * согласии тест, третьего он не видел, и панель годами не сообщала, что у
 * инструментов вообще есть клавиши.
 *
 * Отсюда берут все трое. Разойтись им теперь негде: новая клавиша появляется в
 * разборе, в подсказке и в шпаргалке одной правкой.
 */
interface MapToolShortcutBase {
  /** Клавиша в нижнем регистре — так же, как её отдаёт `KeyboardEvent.key`. */
  key: string;
  /** Что выбирается без Shift. */
  tool: ShortcutMapTool;
  /** Подпись действия — она же строка шпаргалки. */
  action: string;
  /** Инструменты мастера игроку не показываются и по клавише не открываются. */
  gmOnly?: boolean;
}

/**
 * Парный инструмент и его подпись появляются только вместе. Дискриминированный
 * union не даёт добавить `shiftTool` без строки для шпаргалки (или наоборот).
 */
export type MapToolShortcut = MapToolShortcutBase &
  (
    | Readonly<{
        shiftTool: ShortcutMapTool;
        shiftAction: string;
      }>
    | Readonly<{
        shiftTool?: never;
        shiftAction?: never;
      }>
  );

/**
 * Порядок важен: в нём же клавиши идут в шпаргалке. Сначала то, чем пользуются
 * все и всегда, потом мастерский туман — от простого к тому, у чего есть пары.
 */
export const MAP_TOOL_SHORTCUTS: readonly MapToolShortcut[] = [
  { key: "v", tool: "PAN", action: "Перемещение и выделение" },
  { key: "d", tool: "DRAW", action: "Рисование" },
  { key: "r", tool: "RULER", action: "Линейка — измерить расстояние" },
  { key: "p", tool: "PING", action: "Пинг — показать точку остальным" },
  {
    key: "g",
    tool: "FOG",
    shiftTool: "COVER",
    action: "Открыть туман областью",
    shiftAction: "Закрыть туман областью",
    gmOnly: true,
  },
  {
    key: "b",
    tool: "FOG_BRUSH",
    shiftTool: "COVER_BRUSH",
    action: "Открыть туман кистью",
    shiftAction: "Закрыть туман кистью",
    gmOnly: true,
  },
  {
    key: "l",
    tool: "FOG_POLYGON",
    shiftTool: "COVER_POLYGON",
    action: "Открыть туман полигоном",
    shiftAction: "Закрыть туман полигоном",
    gmOnly: true,
  },
  {
    /**
     * Не `z`: она уже занята отменой (`Ctrl+Z`). Инструмент на той же букве
     * означал бы, что промах мимо Ctrl включает зону боя вместо отмены — и
     * тест шпаргалки справедливо считает такую букву противоречивой, потому
     * что одна и та же клавиша не может быть и общей, и мастерской.
     */
    key: "e",
    tool: "BATTLE_ZONE",
    action: "Зона боя — обвести поле, из которого собирается очередь",
    gmOnly: true,
  },
];

const MAP_VIEWPORT_KEYS_BEFORE_TOOLS = [
  "ArrowUp",
  "ArrowDown",
  "ArrowLeft",
  "ArrowRight",
  "+",
  "-",
  "0",
  "F",
  "O",
] as const;

const MAP_VIEWPORT_KEYS_AFTER_TOOLS = ["Enter", "Delete", "Escape"] as const;

/**
 * Accessible keyboard inventory for the focused map region.
 *
 * Tool keys come from the same manifest as the key handler, guide and button
 * titles. Inline renderer commands stay explicit here, and GM-only tool keys
 * are omitted for players instead of advertising commands they cannot use.
 */
export function mapViewportAriaKeyShortcuts(role: Role): string {
  const toolKeys = MAP_TOOL_SHORTCUTS.filter(
    (entry) => !entry.gmOnly || role === "GM",
  ).flatMap((entry) => {
    const key = entry.key.toUpperCase();
    return entry.shiftTool ? [key, `Shift+${key}`] : [key];
  });

  return [
    ...MAP_VIEWPORT_KEYS_BEFORE_TOOLS,
    ...toolKeys,
    ...MAP_VIEWPORT_KEYS_AFTER_TOOLS,
  ].join(" ");
}

/**
 * UIX-466: куда уходит прямоугольник, который мастер только что обвёл.
 *
 * Два инструмента тянут одну и ту же рамку и различаются лишь адресатом.
 * Развилка живёт здесь, а не в обработчике внутри Konva-компонента, потому что
 * там её нечем проверить: подмена адресата не ломает ни типы, ни один тест —
 * мастер просто получает диалог «Начать бой» вместо сохранённой зоны. Ровно это
 * и случилось при диверсии, пока функции не было.
 */
export function regionCommitTarget(
  tool: MapTool,
): "BATTLE_ZONE" | "ENCOUNTER" | null {
  if (tool === "BATTLE_ZONE") return "BATTLE_ZONE";
  if (tool === "SCENE_REGION") return "ENCOUNTER";
  return null;
}

/** Клавиша инструмента для подсказки на кнопке: `undefined`, если её нет. */
export function shortcutForTool(
  tool: MapTool,
): { key: string; withShift: boolean } | undefined {
  for (const entry of MAP_TOOL_SHORTCUTS) {
    if (entry.tool === tool) return { key: entry.key, withShift: false };
    if (entry.shiftTool === tool) return { key: entry.key, withShift: true };
  }
  return undefined;
}

/**
 * Готовая подпись клавиши: «V», «Shift + G». Регистр верхний — на клавише
 * написана заглавная буква, и в подсказке человек ищет глазами именно её.
 */
export function shortcutLabel(tool: MapTool): string | undefined {
  const found = shortcutForTool(tool);
  if (!found) return undefined;
  const key = found.key.toUpperCase();
  return found.withShift ? `Shift + ${key}` : key;
}

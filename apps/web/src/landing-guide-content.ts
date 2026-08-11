/**
 * UIX-415: the reference behind the landing page's guide.
 *
 * Kept as data rather than JSX so it can be checked against the code it
 * describes. A guide that lists a shortcut the app does not have is worse than
 * no guide: the reader tries it, nothing happens, and they stop trusting the
 * rest of the page. `landing-guide-content.test.ts` asserts every canvas
 * shortcut here actually resolves in `map-interaction.ts`, and every slash
 * command actually exists in `chat-composer.ts`.
 *
 * Sources, so a future edit knows where to look:
 *   - map tools and keys — `renderers/map-interaction.ts` (TOOL_SHORTCUTS,
 *     resolveMapToolShortcut) and `Orthographic2DRenderer.tsx`
 *     (handleMapKeyDown);
 *   - composer keys — `composer-keyboard-intent.ts`;
 *   - slash commands — `chat-composer.ts`.
 */

export interface GuideShortcut {
  /** Rendered as key caps; each entry is one key or one combination. */
  keys: string[];
  action: string;
  /** GM-only shortcuts are marked so a player is not left hunting for them. */
  gmOnly?: boolean;
}

export interface GuideSection {
  title: string;
  hint?: string;
  shortcuts: GuideShortcut[];
}

/**
 * The canvas listens only while it has focus and ignores anything held with
 * Ctrl, Alt or Cmd — which is why none of these collide with browser
 * shortcuts, and why clicking the map first is part of the instruction.
 */
export const canvasSections: GuideSection[] = [
  {
    title: "Инструменты",
    hint: "Нажмите клавишу — инструмент выбран. Esc всегда возвращает к перемещению.",
    shortcuts: [
      { keys: ["V"], action: "Перемещение и выделение" },
      { keys: ["D"], action: "Рисование" },
      { keys: ["R"], action: "Линейка — измерить расстояние" },
      { keys: ["P"], action: "Пинг — показать точку остальным" },
      { keys: ["O"], action: "Список объектов на сцене" },
      { keys: ["Esc"], action: "Отменить действие, снять выделение" },
    ],
  },
  {
    title: "Отмена",
    hint: "Эти две работают везде, а не только на карте — но не тогда, когда вы печатаете.",
    shortcuts: [
      { keys: ["Ctrl", "Z"], action: "Отменить изменение на карте" },
      { keys: ["Ctrl", "Shift", "Z"], action: "Вернуть отменённое" },
    ],
  },
  {
    title: "Туман войны",
    hint: "Только мастер. С Shift тот же инструмент закрывает туман обратно.",
    shortcuts: [
      { keys: ["G"], action: "Открыть прямоугольник", gmOnly: true },
      { keys: ["Shift", "G"], action: "Закрыть прямоугольник", gmOnly: true },
      { keys: ["B"], action: "Открыть кистью", gmOnly: true },
      { keys: ["Shift", "B"], action: "Закрыть кистью", gmOnly: true },
      { keys: ["L"], action: "Открыть многоугольником", gmOnly: true },
      { keys: ["Shift", "L"], action: "Закрыть многоугольником", gmOnly: true },
    ],
  },
  {
    title: "Камера",
    shortcuts: [
      { keys: ["+"], action: "Приблизить" },
      { keys: ["−"], action: "Отдалить" },
      { keys: ["0"], action: "Вписать карту в экран" },
      { keys: ["F"], action: "То же самое" },
      { keys: ["Колесо"], action: "Масштаб под курсором" },
    ],
  },
  {
    title: "Токены",
    hint: "Стрелки двигают выделенный токен. Если ничего не выделено — двигают карту.",
    shortcuts: [
      { keys: ["←", "→", "↑", "↓"], action: "Шаг на одну клетку сетки" },
      { keys: ["Shift", "стрелка"], action: "Шаг сразу на пять клеток" },
      { keys: ["Enter"], action: "Открыть действия выделенного" },
      { keys: ["Delete"], action: "Удалить выделенное" },
    ],
  },
];

export const chatSection: GuideSection = {
  title: "Чат и броски",
  hint: "Ctrl+Enter отправляет сообщение только мастеру — удобно для тайных действий.",
  shortcuts: [
    { keys: ["Enter"], action: "Отправить всем" },
    { keys: ["Shift", "Enter"], action: "Перенос строки" },
    { keys: ["Ctrl", "Enter"], action: "Отправить только мастеру" },
  ],
};

export interface GuideCommand {
  command: string;
  description: string;
}

export const chatCommands: GuideCommand[] = [
  { command: "/d20", description: "Обычный бросок d20" },
  { command: "/roll 1d20 + agility", description: "Бросок по формуле" },
  {
    command: "/strength",
    description: "Бросок характеристики: 1d20 плюс её значение",
  },
  { command: "2d6+3", description: "Формула без команды тоже работает" },
];

export interface GuideFeature {
  title: string;
  text: string;
}

/**
 * Deliberately describes what a person does, not what the system has. "Карты
 * мира" means nothing to someone who has never opened the app; "отмечаете, где
 * находится партия" does.
 */
export const guideFeatures: GuideFeature[] = [
  {
    title: "Стол и карта",
    text: "Мастер выкладывает сцену с сеткой и открывает туман по мере продвижения партии. Токены двигаются мышью или стрелками, расстояние меряется линейкой, а пинг показывает остальным нужную точку.",
  },
  {
    title: "Персонажи",
    text: "Карточка с характеристиками, навыками, способностями, ресурсами и инвентарём. Броски считает сервер, поэтому результат одинаков у всех и его нельзя переиграть.",
  },
  {
    title: "Общение",
    text: "Общий чат, личные переписки, стикеры и вложения. Сообщение можно отправить только мастеру, а бросок — сделать закрытым.",
  },
  {
    title: "Мир и сюжет",
    text: "Карты мира с положением партии, сюжетный канал с публикациями мастера и заявки, которыми игроки предлагают, чем хотят заняться.",
  },
  {
    title: "Музыка",
    text: "Мастер включает трек — он играет у всех синхронно. Громкость каждый настраивает у себя.",
  },
];

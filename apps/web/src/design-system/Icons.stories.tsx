import { useId, useLayoutEffect, useMemo, useState } from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { ThemeProvider } from "@gravity-ui/uikit";
import { AppIcon } from "../ui/AppIcon";
import {
  AddIcon,
  CharacterArchiveIcon,
  CloseIcon,
  CollapseCharacterRailIcon,
  CollapseSectionIcon,
  CollapseToolbarIcon,
  CoverBrushIcon,
  CoverFogIcon,
  CoverPolygonIcon,
  CursorPresenceIcon,
  DecreaseIcon,
  DeleteIcon,
  DrawIcon,
  DuplicateIcon,
  ExpandCharacterRailIcon,
  ExpandSectionIcon,
  ExpandToolbarIcon,
  FogBrushIcon,
  FogPolygonIcon,
  GridSettingsIcon,
  MoreIcon,
  MoreToolsIcon,
  MoveDownIcon,
  MoveSelectionIcon,
  MoveUpIcon,
  NextPageIcon,
  NormalRollIcon,
  OfflineStatusIcon,
  OnlineStatusIcon,
  PanIcon,
  PartyLocationIcon,
  PauseIcon,
  PingIcon,
  PlayIcon,
  PreviousPageIcon,
  PublishSceneIcon,
  PublishedSceneIcon,
  RedoIcon,
  RenameIcon,
  ResetWindowIcon,
  ResizeMapIcon,
  RevealFogIcon,
  RulerIcon,
  ScenePickerIcon,
  SecretRollIcon,
  SelectedOptionIcon,
  SendIcon,
  SessionMenuIcon,
  SettingsIcon,
  SidebarCollapseIcon,
  SidebarExpandIcon,
  StickerPickerIcon,
  UndoIcon,
  VolumeIcon,
  WorldLocationIcon,
  type LucideIcon,
} from "../ui/icons";
import { Button } from "./Button";
import { FormSelect } from "../ui/GravityFormControls";
import {
  PLAYER_THEMES,
  resolvePlayerThemeId,
  type PlayerThemeId,
} from "./player-themes";
import "./player-themes.generated.css";
import "./player-theme-gravity.css";

interface IconItem {
  name: string;
  original: string;
  icon: LucideIcon;
  category: "map" | "dice" | "chat" | "audio" | "character" | "dialog" | "navigation" | "status";
  locations: string;
}

const ALL_ICONS: IconItem[] = [
  // Карта и холст
  { name: "PanIcon", original: "Hand", icon: PanIcon, category: "map", locations: "MapToolbar: панорамирование сцены (Space / Pan)" },
  { name: "RevealFogIcon", original: "Eye", icon: RevealFogIcon, category: "map", locations: "MapToolbar: открыть область тумана" },
  { name: "CoverFogIcon", original: "EyeOff", icon: CoverFogIcon, category: "map", locations: "MapToolbar: скрыть область туманом" },
  { name: "FogBrushIcon", original: "Brush", icon: FogBrushIcon, category: "map", locations: "MapToolbar: круглая кисть открытия тумана" },
  { name: "CoverBrushIcon", original: "Eraser", icon: CoverBrushIcon, category: "map", locations: "MapToolbar: кисть скрытия тумана (ластик)" },
  { name: "FogPolygonIcon", original: "Pentagon", icon: FogPolygonIcon, category: "map", locations: "MapToolbar: многоугольник открытия тумана" },
  { name: "CoverPolygonIcon", original: "Hexagon", icon: CoverPolygonIcon, category: "map", locations: "MapToolbar: многоугольник скрытия тумана" },
  { name: "DrawIcon", original: "Pencil", icon: DrawIcon, category: "map", locations: "MapToolbar: рисование на холсте" },
  { name: "RulerIcon", original: "Ruler", icon: RulerIcon, category: "map", locations: "MapToolbar: линейка измерения расстояний" },
  { name: "PingIcon", original: "MapPin", icon: PingIcon, category: "map", locations: "MapToolbar: метка внимания на карте" },
  { name: "CursorPresenceIcon", original: "MousePointer2", icon: CursorPresenceIcon, category: "map", locations: "CursorPresenceMenu: курсор и видимость" },
  { name: "GridSettingsIcon", original: "Grid3x3", icon: GridSettingsIcon, category: "map", locations: "GridSettings: настройки сетки сцены" },
  { name: "ResizeMapIcon", original: "Maximize2", icon: ResizeMapIcon, category: "map", locations: "ResizeSettings: изменение размеров карты" },
  { name: "MoreToolsIcon", original: "Ellipsis", icon: MoreToolsIcon, category: "map", locations: "MapToolbar: меню дополнительных инструментов" },
  { name: "UndoIcon", original: "Undo2", icon: UndoIcon, category: "map", locations: "CanvasHistoryControls: отмена действия на карте" },
  { name: "RedoIcon", original: "Redo2", icon: RedoIcon, category: "map", locations: "CanvasHistoryControls: повтор действия на карте" },

  // Кубы и броски
  { name: "NormalRollIcon", original: "Circle", icon: NormalRollIcon, category: "dice", locations: "DiceTrayPanel / RollModeControl: открытый бросок" },
  { name: "SecretRollIcon", original: "EyeOff", icon: SecretRollIcon, category: "dice", locations: "DiceTrayPanel / RollModeControl: скрытый бросок GM" },

  // Чат и связь
  { name: "SendIcon", original: "Send", icon: SendIcon, category: "chat", locations: "ChatPanels: кнопка отправки сообщения" },
  { name: "MoreIcon", original: "Ellipsis", icon: MoreIcon, category: "chat", locations: "ChatPanels: фильтры и действия сообщений" },
  { name: "StickerPickerIcon", original: "Sticker", icon: StickerPickerIcon, category: "chat", locations: "StickerPicker: каталог стикеров/эмодзи" },

  // Аудио и пауза
  { name: "PlayIcon", original: "Play", icon: PlayIcon, category: "audio", locations: "MusicBar: воспроизведение трека" },
  { name: "PauseIcon", original: "Pause", icon: PauseIcon, category: "audio", locations: "MusicBar / GamePauseOverlay: пауза музыки и игры" },
  { name: "VolumeIcon", original: "Volume2", icon: VolumeIcon, category: "audio", locations: "MusicBar: громкость фоновой музыки" },

  // Персонаж и статы
  { name: "CharacterArchiveIcon", original: "Archive", icon: CharacterArchiveIcon, category: "character", locations: "CharacterWorkspace: архив персонажей" },
  { name: "AddIcon", original: "Plus", icon: AddIcon, category: "character", locations: "CharacterWorkspace / StatLayoutCard: добавить" },
  { name: "DecreaseIcon", original: "Minus", icon: DecreaseIcon, category: "character", locations: "ResourceCounters: уменьшить HP/MP/счётчик" },
  { name: "RenameIcon", original: "Pencil", icon: RenameIcon, category: "character", locations: "StatLayoutCard: переименовать характеристику" },
  { name: "DeleteIcon", original: "Trash", icon: DeleteIcon, category: "character", locations: "StatLayoutCard / TokenPalette: удалить объект" },

  // Диалоги и окна
  { name: "CloseIcon", original: "X", icon: CloseIcon, category: "dialog", locations: "ArkenDialog / Модальные окна: закрыть окно" },
  { name: "ResetWindowIcon", original: "RotateCcw", icon: ResetWindowIcon, category: "dialog", locations: "ArkenDialog: сбросить позицию и размер окна" },

  // Навигация и меню
  { name: "SidebarCollapseIcon", original: "PanelRightClose", icon: SidebarCollapseIcon, category: "navigation", locations: "Sidebar: свернуть боковую панель" },
  { name: "SidebarExpandIcon", original: "PanelRightOpen", icon: SidebarExpandIcon, category: "navigation", locations: "Sidebar: развернуть боковую панель" },
  { name: "CollapseToolbarIcon", original: "ChevronsLeft", icon: CollapseToolbarIcon, category: "navigation", locations: "MapToolbar: свернуть панель инструментов" },
  { name: "ExpandToolbarIcon", original: "ChevronsRight", icon: ExpandToolbarIcon, category: "navigation", locations: "MapToolbar: развернуть панель инструментов" },
  { name: "CollapseCharacterRailIcon", original: "PanelLeftClose", icon: CollapseCharacterRailIcon, category: "navigation", locations: "CharacterWorkspace: свернуть колонку персонажей" },
  { name: "ExpandCharacterRailIcon", original: "PanelLeftOpen", icon: ExpandCharacterRailIcon, category: "navigation", locations: "CharacterWorkspace: развернуть колонку персонажей" },
  { name: "SessionMenuIcon", original: "Menu", icon: SessionMenuIcon, category: "navigation", locations: "App header: главное меню сессии" },
  { name: "ScenePickerIcon", original: "ChevronDown", icon: ScenePickerIcon, category: "navigation", locations: "App header: выбор активной сцены" },
  { name: "CollapseSectionIcon", original: "ChevronDown", icon: CollapseSectionIcon, category: "navigation", locations: "Аккордеоны и списки: свернуть секцию" },
  { name: "ExpandSectionIcon", original: "ChevronRight", icon: ExpandSectionIcon, category: "navigation", locations: "Аккордеоны и списки: развернуть секцию" },
  { name: "DuplicateIcon", original: "Copy", icon: DuplicateIcon, category: "navigation", locations: "ObjectList / Сцены: дублировать объект" },
  { name: "PublishSceneIcon", original: "ScreenShare", icon: PublishSceneIcon, category: "navigation", locations: "Scene list: опубликовать сцену игрокам" },
  { name: "PublishedSceneIcon", original: "Cast", icon: PublishedSceneIcon, category: "navigation", locations: "Scene list: сцена транслируется игрокам" },
  { name: "PreviousPageIcon", original: "ArrowLeft", icon: PreviousPageIcon, category: "navigation", locations: "CharacterMediaGallery: страница назад" },
  { name: "NextPageIcon", original: "ArrowRight", icon: NextPageIcon, category: "navigation", locations: "CharacterMediaGallery: страница вперед" },
  { name: "MoveSelectionIcon", original: "ArrowRight", icon: MoveSelectionIcon, category: "navigation", locations: "SelectionActions: переместить выбранные элементы" },
  { name: "SettingsIcon", original: "Settings", icon: SettingsIcon, category: "navigation", locations: "GravityFoundationPreview / Настройки" },

  // Статусы и маркеры
  { name: "OnlineStatusIcon", original: "CircleDot", icon: OnlineStatusIcon, category: "status", locations: "SetupPanel: участник в сети (Online)" },
  { name: "OfflineStatusIcon", original: "Circle", icon: OfflineStatusIcon, category: "status", locations: "SetupPanel: участник не в сети (Offline)" },
  { name: "WorldLocationIcon", original: "MapPin", icon: WorldLocationIcon, category: "status", locations: "WorldMaps: метка точки интереса / локации" },
  { name: "PartyLocationIcon", original: "UsersRound", icon: PartyLocationIcon, category: "status", locations: "WorldMaps: маркер отряда приключенцев" },
  { name: "SelectedOptionIcon", original: "Check", icon: SelectedOptionIcon, category: "status", locations: "TokenConditionMenu: выбранный статус токена" },
  { name: "MoveUpIcon", original: "ArrowUp", icon: MoveUpIcon, category: "status", locations: "WorldContent / Галерея: поднять в списке" },
  { name: "MoveDownIcon", original: "ArrowDown", icon: MoveDownIcon, category: "status", locations: "WorldContent / Галерея: опустить в списке" },
];

const CATEGORY_LABELS: Record<string, string> = {
  all: "Все иконки (55)",
  map: "Холст и карта",
  dice: "Кубы и броски",
  chat: "Чат и связь",
  audio: "Аудио и плеер",
  character: "Персонажи и статы",
  dialog: "Окна и диалоги",
  navigation: "Навигация и шелл",
  status: "Статусы и маркеры",
};

export function IconGalleryStand() {
  const [themeId, setThemeId] = useState<PlayerThemeId | "system">("system");
  const [size, setSize] = useState<16 | 20 | 24>(20);
  const [category, setCategory] = useState<string>("all");
  const [query, setQuery] = useState("");
  const themeSelectId = useId();

  const theme = PLAYER_THEMES.find((candidate) => candidate.id === themeId);

  useLayoutEffect(() => {
    const root = document.documentElement;
    const body = document.body;
    const previous = root.getAttribute("data-player-theme");
    const prevRootOverflow = root.style.overflow;
    const prevBodyOverflow = body.style.overflow;

    root.style.overflow = "auto";
    body.style.overflow = "auto";

    if (themeId === "system") root.removeAttribute("data-player-theme");
    else root.setAttribute("data-player-theme", themeId);
    return () => {
      if (previous === null) root.removeAttribute("data-player-theme");
      else root.setAttribute("data-player-theme", previous);
      root.style.overflow = prevRootOverflow;
      body.style.overflow = prevBodyOverflow;
    };
  }, [themeId]);

  const filteredIcons = useMemo(() => {
    return ALL_ICONS.filter((item) => {
      const matchesCategory = category === "all" || item.category === category;
      const q = query.trim().toLowerCase();
      const matchesQuery =
        !q ||
        item.name.toLowerCase().includes(q) ||
        item.original.toLowerCase().includes(q) ||
        item.locations.toLowerCase().includes(q);
      return matchesCategory && matchesQuery;
    });
  }, [category, query]);

  return (
    <ThemeProvider theme={theme?.colorScheme ?? "dark"} lang="ru">
      <div
        style={{
          background: "var(--color-canvas)",
          color: "var(--color-text)",
          padding: "var(--space-xl)",
          minHeight: "100%",
          height: "100vh",
          overflowY: "auto",
          overflowX: "hidden",
          boxSizing: "border-box",
          fontFamily: "var(--font-sans, system-ui, sans-serif)",
        }}
      >
        {/* Заголовок и цели стенда */}
        <header style={{ marginBottom: "var(--space-xl)", borderBottom: "1px solid var(--color-border)", paddingBottom: "var(--space-md)" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: "var(--space-md)" }}>
            <div>
              <span style={{ fontSize: "var(--font-size-caption, 12px)", color: "var(--color-accent)", textTransform: "uppercase", letterSpacing: "0.05em", fontWeight: 600 }}>
                UIX-645 · Human Visual QA Stand
              </span>
              <h1 style={{ margin: "4px 0", fontSize: "var(--font-size-heading-lg, 24px)" }}>
                Приёмочный стенд иконок Lucide
              </h1>
              <p style={{ margin: 0, color: "var(--color-text-muted)", fontSize: "var(--font-size-body, 14px)", maxWidth: 700 }}>
                Стенд для проверки четкости контуров, отсутствия замыливания (16/20/24px), контраста во всех темах и поведения в интерактивных кнопках (hover/focus/disabled).
              </p>
            </div>

            {/* Селектор темы */}
            <div style={{ display: "flex", flexDirection: "column", gap: 4, minWidth: 200 }}>
              <label htmlFor={themeSelectId} style={{ fontSize: "12px", color: "var(--color-text-muted)" }}>
                Тема оформления:
              </label>
              <FormSelect
                id={themeSelectId}
                aria-label="Тема оформления"
                value={themeId}
                onChange={(event) =>
                  setThemeId(
                    resolvePlayerThemeId({ selectedThemeId: event.target.value }),
                  )
                }
              >
                <option value="system">Системная (Default)</option>
                {PLAYER_THEMES.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.name}
                  </option>
                ))}
              </FormSelect>
            </div>
          </div>

          {/* Панель фильтров и размеров */}
          <div style={{ display: "flex", alignItems: "center", gap: "var(--space-md)", marginTop: "var(--space-lg)", flexWrap: "wrap" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <span style={{ fontSize: "13px", color: "var(--color-text-muted)" }}>Размер:</span>
              {([16, 20, 24] as const).map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => setSize(s)}
                  style={{
                    padding: "4px 10px",
                    borderRadius: "var(--radius-sm)",
                    border: size === s ? "2px solid var(--color-accent)" : "1px solid var(--color-border)",
                    background: size === s ? "var(--color-surface-raised)" : "var(--color-surface)",
                    color: "var(--color-text)",
                    cursor: "pointer",
                    fontWeight: size === s ? 600 : 400,
                  }}
                >
                  {s}px
                </button>
              ))}
            </div>

            <div style={{ display: "flex", alignItems: "center", gap: 6, flex: 1, minWidth: 200 }}>
              <input
                type="text"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Поиск по имени, Lucide или месту..."
                style={{
                  width: "100%",
                  padding: "6px 12px",
                  borderRadius: "var(--radius-sm)",
                  border: "1px solid var(--color-border)",
                  background: "var(--color-surface)",
                  color: "var(--color-text)",
                  fontSize: "14px",
                }}
              />
            </div>
          </div>

          {/* Категории */}
          <div style={{ display: "flex", gap: 6, marginTop: "var(--space-md)", flexWrap: "wrap" }}>
            {Object.entries(CATEGORY_LABELS).map(([catKey, catLabel]) => (
              <button
                key={catKey}
                type="button"
                onClick={() => setCategory(catKey)}
                style={{
                  padding: "4px 10px",
                  fontSize: "12px",
                  borderRadius: "var(--radius-sm)",
                  border: "1px solid",
                  borderColor: category === catKey ? "var(--color-accent)" : "var(--color-border)",
                  background: category === catKey ? "var(--color-accent)" : "transparent",
                  color: category === catKey ? "#ffffff" : "var(--color-text-muted)",
                  cursor: "pointer",
                }}
              >
                {catLabel}
              </button>
            ))}
          </div>
        </header>

        {/* Сетка иконок */}
        <section
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))",
            gap: "var(--space-md)",
          }}
        >
          {filteredIcons.map((item) => (
            <div
              key={item.name}
              style={{
                background: "var(--color-surface)",
                border: "1px solid var(--color-border)",
                borderRadius: "var(--radius-md)",
                padding: "var(--space-md)",
                display: "flex",
                flexDirection: "column",
                gap: "var(--space-sm)",
                transition: "border-color 0.15s ease",
              }}
            >
              {/* Превью иконки и действия */}
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    width: 44,
                    height: 44,
                    background: "var(--color-canvas)",
                    border: "1px solid var(--color-border)",
                    borderRadius: "var(--radius-sm)",
                  }}
                >
                  <AppIcon icon={item.icon} size={size} />
                </div>

                {/* Интерактивные кнопки с этой иконкой */}
                <div style={{ display: "flex", gap: 4 }}>
                  <Button view="normal" size="s" aria-label={`Тест ${item.name}`}>
                    <AppIcon icon={item.icon} size={16} />
                  </Button>
                  <Button view="action" size="s" aria-label={`Акцент ${item.name}`}>
                    <AppIcon icon={item.icon} size={16} />
                  </Button>
                  <Button view="normal" size="s" disabled aria-label={`Disabled ${item.name}`}>
                    <AppIcon icon={item.icon} size={16} />
                  </Button>
                </div>
              </div>

              {/* Имена и Lucide связка */}
              <div>
                <div style={{ fontWeight: 600, fontSize: "14px", color: "var(--color-text)" }}>
                  {item.name}
                </div>
                <div style={{ fontSize: "12px", color: "var(--color-text-faint)", fontFamily: "var(--font-mono, monospace)" }}>
                  Lucide: {item.original}
                </div>
              </div>

              {/* Где используется */}
              <div
                style={{
                  fontSize: "12px",
                  color: "var(--color-text-muted)",
                  background: "var(--color-surface-raised)",
                  padding: "4px 8px",
                  borderRadius: "var(--radius-sm)",
                  lineHeight: 1.4,
                  marginTop: "auto",
                }}
              >
                {item.locations}
              </div>
            </div>
          ))}
        </section>

        {filteredIcons.length === 0 && (
          <div style={{ textAlign: "center", padding: "var(--space-2xl)", color: "var(--color-text-muted)" }}>
            Иконки не найдены по запросу "{query}"
          </div>
        )}

        {/* Чеклист критериев приёмки внизу стенда */}
        <footer
          style={{
            marginTop: "var(--space-2xl)",
            padding: "var(--space-lg)",
            background: "var(--color-surface)",
            border: "1px solid var(--color-border)",
            borderRadius: "var(--radius-md)",
          }}
        >
          <h2 style={{ fontSize: "16px", marginTop: 0 }}>Чеклист визуальной приёмки UIX-645</h2>
          <ul style={{ margin: 0, paddingLeft: 20, fontSize: "13px", lineHeight: 1.8, color: "var(--color-text-muted)" }}>
            <li><b>Четкость на пиксельной сетке:</b> иконка не размыта и центрирована при 16px, 20px и 24px.</li>
            <li><b>Контраст тем:</b> проверьте переключение на "Светлая", "Classic v1", "Пергамент" — цвет наследуется через <code>currentColor</code> и контрастен фону.</li>
            <li><b>Различимость пар:</b> проверьте, что <code>FogPolygonIcon (Pentagon)</code> и <code>CoverPolygonIcon (Hexagon)</code> визуально различимы даже без текста.</li>
            <li><b>Интерактивные состояния:</b> крайние правые кнопки показывают иконку в обычной кнопке, акцентной кнопке и в состоянии <code>disabled</code> (полупрозрачная).</li>
          </ul>
        </footer>
      </div>
    </ThemeProvider>
  );
}

const meta: Meta = {
  title: "Дизайн-система/Иконки Lucide",
  component: IconGalleryStand,
  parameters: { layout: "fullscreen" },
};
export default meta;

export const AllIcons: StoryObj = {
  name: "Все иконки (Visual QA)",
  render: () => <IconGalleryStand />,
};

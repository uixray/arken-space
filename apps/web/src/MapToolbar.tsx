import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import type { EncounterDto, GameSnapshot, SceneDto } from "@arken/contracts";
import type { MapTool } from "./renderers/map-interaction";
import { shortcutLabel } from "./renderers/map-tool-shortcuts";
import {
  readToolbarCollapsed,
  writeToolbarCollapsed,
} from "./toolbar-preference";
import { CursorPresenceMenu } from "./ui/CursorPresenceMenu";
import type { CursorPreference } from "./cursor-preference";
import { CanvasHistoryControls } from "./renderers/CanvasHistoryControls";
import { GridSettings } from "./renderers/GridSettings";
import { useDismissibleDetails } from "./ui/dismissible-details";

export interface MapToolbarProps {
  pauseControl?: ReactNode;
  tool: MapTool;
  onToolSelect: (tool: MapTool) => void;
  snapshot: GameSnapshot;
  viewSnapshot: GameSnapshot;
  previewSnapshot: GameSnapshot | null;
  activeScene: SceneDto | null | undefined;
  activeEncounter?: EncounterDto | null;
  activeCanvasVersion: string;
  cursorPreference: CursorPreference;
  onCursorPreferenceChange: (preference: CursorPreference) => void;
  fogBrushRadius: number;
  onFogBrushRadiusChange: (radius: number) => void;
  canvasEditMode: "BACKGROUND" | "WORLD" | null;
  onCanvasEditModeChange: (mode: "BACKGROUND" | "WORLD" | null) => void;
  onStartEncounter: () => void;
  onEndEncounter: () => void;
  onToggleBattleZone: () => void;
  onGridPreview: (grid: SceneDto["grid"] | null) => void;
  onGridSave: (grid: SceneDto["grid"]) => Promise<void>;
  gmFogOpacity: number;
  onGmFogOpacityChange: (opacity: number) => void;
  gmFogVisible: boolean;
  onGmFogVisibleChange: (visible: boolean) => void;
  gmGridVisible: boolean;
  onGmGridVisibleChange: (visible: boolean) => void;
}

export function MapToolbar({
  pauseControl,
  tool,
  onToolSelect,
  snapshot,
  viewSnapshot,
  previewSnapshot,
  activeScene,
  activeEncounter,
  activeCanvasVersion,
  cursorPreference,
  onCursorPreferenceChange,
  fogBrushRadius,
  onFogBrushRadiusChange,
  canvasEditMode,
  onCanvasEditModeChange,
  onStartEncounter,
  onEndEncounter,
  onToggleBattleZone,
  onGridPreview,
  onGridSave,
  gmFogOpacity,
  onGmFogOpacityChange,
  gmFogVisible,
  onGmFogVisibleChange,
  gmGridVisible,
  onGmGridVisibleChange,
}: MapToolbarProps) {
  const [toolbarCollapsed, setToolbarCollapsed] = useState(false);
  const toolbarRef = useRef<HTMLDivElement | null>(null);
  const resizeSettingsRef = useRef<HTMLDetailsElement>(null);
  const toolbarOverflowRef = useRef<HTMLDetailsElement>(null);

  useDismissibleDetails(resizeSettingsRef);
  useDismissibleDetails(toolbarOverflowRef);

  useEffect(() => {
    if (!snapshot) return;
    setToolbarCollapsed(
      readToolbarCollapsed(window.localStorage, snapshot.me.id),
    );
  }, [snapshot?.me.id]);

  useLayoutEffect(() => {
    const toolbar = toolbarRef.current;
    const host = toolbar?.parentElement;
    if (!toolbar || !host) return;
    const publish = () => {
      host.style.setProperty(
        "--map-toolbar-width",
        `${Math.round(toolbar.getBoundingClientRect().width)}px`,
      );
    };
    publish();
    if (typeof ResizeObserver === "function") {
      const observer = new ResizeObserver(publish);
      observer.observe(toolbar);
      return () => {
        observer.disconnect();
        host.style.removeProperty("--map-toolbar-width");
      };
    }

    window.addEventListener("resize", publish);
    return () => {
      window.removeEventListener("resize", publish);
      host.style.removeProperty("--map-toolbar-width");
    };
  }, [toolbarCollapsed, snapshot?.me.role]);

  const toggleCollapsed = useCallback(() => {
    setToolbarCollapsed((current) => {
      const next = !current;
      writeToolbarCollapsed(window.localStorage, snapshot.me.id, next);
      return next;
    });
  }, [snapshot.me.id]);

  const overflowTools =
    snapshot.me.role === "GM" ? (
      <div className="fog-view-controls">
        <label>
          <input
            type="checkbox"
            checked={gmGridVisible}
            onChange={(event) => onGmGridVisibleChange(event.target.checked)}
          />
          Показывать сетку
        </label>
        <label>
          <input
            type="checkbox"
            checked={gmFogVisible}
            onChange={(event) => onGmFogVisibleChange(event.target.checked)}
          />
          Показывать туман
        </label>
        <label>
          Прозрачность мастера
          <input
            type="range"
            min="0"
            max="1"
            step="0.05"
            value={gmFogOpacity}
            onChange={(event) =>
              onGmFogOpacityChange(Number(event.target.value))
            }
          />
        </label>
      </div>
    ) : null;

  return (
    <div
      ref={toolbarRef}
      className={`map-toolbar${toolbarCollapsed ? " is-collapsed" : ""}`}
      role="toolbar"
      aria-label="Инструменты карты"
    >
      <button
        type="button"
        className="map-toolbar__collapse"
        aria-expanded={!toolbarCollapsed}
        aria-label={
          toolbarCollapsed
            ? "Показать подписи инструментов"
            : "Свернуть панель до значков"
        }
        title={
          toolbarCollapsed
            ? "Показать подписи инструментов"
            : "Свернуть панель до значков"
        }
        onClick={toggleCollapsed}
      >
        <span aria-hidden="true">{toolbarCollapsed ? "»" : "«"}</span>
      </button>

      <div className="toolbar-group">
        {pauseControl}
        <button
          aria-label="Перемещение"
          title={`Перемещение по карте (средняя кнопка мыши) · ${shortcutLabel("PAN")}`}
          className="map-tool"
          data-tool="PAN"
          aria-pressed={tool === "PAN"}
          onClick={() => onToolSelect("PAN")}
        >
          Двигать
        </button>

        {!previewSnapshot && snapshot.me.role === "GM" && (
          <>
            <div className="toolbar-group__title">Туман</div>
            <button
              aria-label="Открыть туман"
              title={`Открыть выбранную область тумана · ${shortcutLabel("FOG")}`}
              className="map-tool"
              data-tool="FOG"
              aria-pressed={tool === "FOG"}
              onClick={() => onToolSelect("FOG")}
            >
              Открыть
            </button>
            <button
              aria-label="Закрыть туман"
              title={`Закрыть выбранную область туманом · ${shortcutLabel("COVER")}`}
              className="map-tool"
              data-tool="COVER"
              aria-pressed={tool === "COVER"}
              onClick={() => onToolSelect("COVER")}
            >
              Закрыть
            </button>
            <button
              aria-label="Открыть туман кистью"
              title={`Открыть туман круглой кистью (клик или протяжка) · ${shortcutLabel("FOG_BRUSH")}`}
              className="map-tool"
              data-tool="FOG_BRUSH"
              aria-pressed={tool === "FOG_BRUSH"}
              onClick={() => onToolSelect("FOG_BRUSH")}
            >
              Кисть
            </button>
            <button
              aria-label="Закрыть туман кистью"
              title={`Закрыть область круглой кистью тумана · ${shortcutLabel("COVER_BRUSH")}`}
              className="map-tool"
              data-tool="COVER_BRUSH"
              aria-pressed={tool === "COVER_BRUSH"}
              onClick={() => onToolSelect("COVER_BRUSH")}
            >
              Кисть закр.
            </button>
            {(tool === "FOG_BRUSH" || tool === "COVER_BRUSH") && (
              <label className="map-tool-text" title="Радиус кисти тумана">
                Радиус
                <input
                  type="range"
                  min={8}
                  max={200}
                  step={4}
                  value={fogBrushRadius}
                  onChange={(event) =>
                    onFogBrushRadiusChange(Number(event.target.value))
                  }
                  aria-label="Радиус кисти тумана"
                  style={{ verticalAlign: "middle", margin: "0 6px" }}
                />
                {fogBrushRadius}
              </label>
            )}
            <button
              aria-label="Открыть туман полигоном"
              title={`Открыть туман многоугольником (клик — вершина, Enter/двойной клик — завершить, Esc — отмена) · ${shortcutLabel("FOG_POLYGON")}`}
              className="map-tool"
              data-tool="FOG_POLYGON"
              aria-pressed={tool === "FOG_POLYGON"}
              onClick={() => onToolSelect("FOG_POLYGON")}
            >
              Полигон
            </button>
            <button
              aria-label="Закрыть туман полигоном"
              title={`Закрыть область многоугольником тумана (клик — вершина, Enter/двойной клик — завершить, Esc — отмена) · ${shortcutLabel("COVER_POLYGON")}`}
              className="map-tool"
              data-tool="COVER_POLYGON"
              aria-pressed={tool === "COVER_POLYGON"}
              onClick={() => onToolSelect("COVER_POLYGON")}
            >
              Полигон закр.
            </button>

            <div className="toolbar-group__title">Метки</div>
            <button
              aria-label="Линейка"
              title={`Измерить расстояние на карте · ${shortcutLabel("RULER")}`}
              className="map-tool"
              data-tool="RULER"
              aria-pressed={tool === "RULER"}
              onClick={() => onToolSelect("RULER")}
            >
              Линейка
            </button>
            <button
              aria-label="Пинг"
              title={`Показать точку группе · ${shortcutLabel("PING")}`}
              className="map-tool"
              data-tool="PING"
              aria-pressed={tool === "PING"}
              onClick={() => onToolSelect("PING")}
            >
              Пинг
            </button>

            <div className="toolbar-group__title">Прочее</div>
            <button
              aria-label={
                viewSnapshot.campaign.battleZone
                  ? "Снять зону боя"
                  : "Обвести зону боя"
              }
              title={
                viewSnapshot.campaign.battleZone
                  ? `Снять зону боя · ${shortcutLabel("BATTLE_ZONE")}`
                  : `Обвести поле боя: из него собирается очередь ходов · ${shortcutLabel("BATTLE_ZONE")}`
              }
              className="map-tool"
              data-tool="BATTLE_ZONE"
              disabled={!activeScene}
              aria-pressed={tool === "BATTLE_ZONE"}
              onClick={onToggleBattleZone}
            >
              {viewSnapshot.campaign.battleZone ? "Снять зону" : "Зона боя"}
            </button>

            {activeEncounter ? (
              <button
                aria-label="Завершить бой"
                title="Завершить текущий бой"
                className="map-tool"
                data-tool="ENCOUNTER_END"
                onClick={onEndEncounter}
              >
                Завершить бой
              </button>
            ) : (
              <button
                aria-label="Начать бой"
                title="Начать бой из области сцены или связанной локации"
                className="map-tool"
                data-tool="ENCOUNTER_START"
                disabled={!activeScene}
                onClick={onStartEncounter}
              >
                Начать бой
              </button>
            )}
          </>
        )}

        <button
          aria-label="Рисование"
          title={`Нарисовать линию на карте · ${shortcutLabel("DRAW")}`}
          className="map-tool"
          data-tool="DRAW"
          aria-pressed={tool === "DRAW"}
          onClick={() => onToolSelect("DRAW")}
        >
          Рисовать
        </button>

        {(previewSnapshot || snapshot.me.role !== "GM") && (
          <>
            <button
              aria-label="Линейка"
              title={`Измерить расстояние на карте · ${shortcutLabel("RULER")}`}
              className="map-tool"
              data-tool="RULER"
              aria-pressed={tool === "RULER"}
              onClick={() => onToolSelect("RULER")}
            >
              Линейка
            </button>
            <button
              aria-label="Пинг"
              title={`Показать точку группе · ${shortcutLabel("PING")}`}
              className="map-tool"
              data-tool="PING"
              aria-pressed={tool === "PING"}
              onClick={() => onToolSelect("PING")}
            >
              Пинг
            </button>
          </>
        )}

        <CursorPresenceMenu
          preference={cursorPreference}
          role={snapshot.me.role === "GM" ? "GM" : "PLAYER"}
          onChange={onCursorPreferenceChange}
        />

        {!previewSnapshot && snapshot.me.role === "GM" && activeScene && (
          <>
            <GridSettings
              scene={activeScene}
              onPreview={onGridPreview}
              onSave={onGridSave}
            />
            <details ref={resizeSettingsRef} className="resize-settings">
              <summary
                aria-label="Настройки размера карты"
                title="Настройки размера карты"
                className="toolbar-detail-trigger"
                data-tool="RESIZE"
              >
                Размер
              </summary>
              <div className="resize-settings-popover">
                <button
                  aria-pressed={canvasEditMode === "BACKGROUND"}
                  onClick={() => {
                    onToolSelect("PAN");
                    onCanvasEditModeChange("BACKGROUND");
                  }}
                >
                  Изображение
                </button>
                <button
                  aria-pressed={canvasEditMode === "WORLD"}
                  onClick={() => {
                    onToolSelect("PAN");
                    onCanvasEditModeChange("WORLD");
                  }}
                >
                  Область
                </button>
                <button
                  onClick={() => {
                    onCanvasEditModeChange(null);
                    if (resizeSettingsRef.current) {
                      resizeSettingsRef.current.open = false;
                      resizeSettingsRef.current
                        .querySelector<HTMLElement>("summary")
                        ?.focus();
                    }
                  }}
                >
                  Готово
                </button>
              </div>
            </details>
          </>
        )}
      </div>

      {!previewSnapshot && (
        <div className="toolbar-history">
          <CanvasHistoryControls
            sceneId={activeScene?.id}
            disabled={!activeScene}
            version={activeCanvasVersion}
            snapshot={viewSnapshot}
          />
        </div>
      )}

      {!previewSnapshot && overflowTools && (
        <details className="toolbar-overflow" ref={toolbarOverflowRef}>
          <summary
            aria-label="Дополнительные инструменты"
            title="Дополнительные инструменты карты"
          >
            •••
          </summary>
          <div className="toolbar-overflow-menu">{overflowTools}</div>
        </details>
      )}
    </div>
  );
}

import { memo, useRef, useState } from "react";
import type { GameSnapshot } from "@arken/contracts";
import { AppIcon } from "./AppIcon";
import {
  BattleIcon,
  CloseIcon,
  DiceTrayIcon,
  JournalSurfaceIcon,
  MapObjectsIcon,
  MapSurfaceIcon,
  OnlineStatusIcon,
  OfflineStatusIcon,
  PublishSceneIcon,
  SendIcon,
  SettingsIcon,
  PauseIcon,
  TokenTrayIcon,
  CharacterSurfaceIcon,
} from "./icons";
import { workspaceNavItems, type WorkspaceId } from "../workspace-nav";
import type { CompactSurface } from "./useCompactNavigation";

export interface CompactMenuSurfaceProps {
  snapshot: GameSnapshot;
  viewSnapshot: GameSnapshot;
  connection:
    "ONLINE" | "RESYNCING" | "OFFLINE" | "RECONNECTING" | "CONNECTING";
  operatorFeedbackAllowed: boolean;
  onSelectWorkspace: (workspace: WorkspaceId) => void;
  onSelectSurface: (surface: CompactSurface) => void;
  onOpenThemeSettings: () => void;
  onOpenShortcuts: () => void;
  onOpenPlayerHandoff: () => void;
  onLogout: () => Promise<void> | void;
  onTogglePause?: () => Promise<void>;
  onMusicControlsTarget: (target: HTMLElement | null) => void;
  onSoundpadLauncherTarget: (target: HTMLElement | null) => void;
}

export const CompactMenuSurface = memo(function CompactMenuSurface({
  snapshot,
  viewSnapshot,
  connection,
  operatorFeedbackAllowed,
  onSelectWorkspace,
  onSelectSurface,
  onOpenThemeSettings,
  onOpenShortcuts,
  onOpenPlayerHandoff,
  onLogout,
  onTogglePause,
  onMusicControlsTarget,
  onSoundpadLauncherTarget,
}: CompactMenuSurfaceProps) {
  // Preview must expose the viewed player's navigation, not GM-only sections.
  const isGm = viewSnapshot.me.role === "GM";
  const navItems = workspaceNavItems({ isGm, operatorFeedbackAllowed });
  const preparationIds: readonly WorkspaceId[] = [
    "setup",
    "world-encyclopedia",
    "world-maps",
    "spell-schools",
    "media",
  ];
  const preparation = isGm
    ? navItems.filter((item) => preparationIds.includes(item.id))
    : [];
  const liveItems = navItems.filter((item) => !preparation.includes(item));
  const [pausePending, setPausePending] = useState(false);
  const [pauseError, setPauseError] = useState("");
  const pauseInFlight = useRef(false);
  const togglePause = async () => {
    if (
      !isGm ||
      snapshot.me.role !== "GM" ||
      !onTogglePause ||
      connection !== "ONLINE" ||
      pauseInFlight.current
    )
      return;
    pauseInFlight.current = true;
    setPausePending(true);
    setPauseError("");
    try {
      await onTogglePause();
    } catch {
      setPauseError("Не удалось изменить перерыв. Попробуйте ещё раз.");
    } finally {
      pauseInFlight.current = false;
      setPausePending(false);
    }
  };

  const getSectionIcon = (id: WorkspaceId) => {
    switch (id) {
      case "characters":
        return CharacterSurfaceIcon;
      case "tokens":
        return TokenTrayIcon;
      case "scenes":
        return PublishSceneIcon;
      case "setup":
        return SettingsIcon;
      case "player-requests":
        return SendIcon;
      case "operator-feedback":
        return BattleIcon;
      default:
        return MapObjectsIcon;
    }
  };

  return (
    <div
      id="compact-menu-view"
      className="compact-menu-surface"
      role="region"
      aria-label="Меню кампании"
    >
      {/* Campaign & Player Header */}
      <header className="compact-menu-header">
        <div className="compact-menu-campaign">
          <span className="compact-menu-eyebrow">Кампания</span>
          <h2 className="compact-menu-title">
            {snapshot.campaign.name || "Безымянная кампания"}
          </h2>
        </div>

        <div className="compact-menu-user-card">
          <div className="compact-menu-user-info">
            <span className="compact-menu-user-name">
              {viewSnapshot.me.displayName}
            </span>
            <span className="compact-menu-user-role">
              {isGm ? "Гейммастер (GM)" : "Игрок"}
            </span>
          </div>
          <div
            className={`compact-menu-status compact-menu-status--${connection.toLowerCase()}`}
            title={`Статус: ${connection}`}
          >
            <AppIcon
              icon={
                connection === "ONLINE" ? OnlineStatusIcon : OfflineStatusIcon
              }
              className="compact-menu-status-icon"
            />
            <span>
              {connection === "ONLINE"
                ? "В сети"
                : connection === "OFFLINE"
                  ? "Нет связи"
                  : "Подключение…"}
            </span>
          </div>
        </div>
      </header>

      {/* Main Navigation Sections */}
      <section className="compact-menu-section">
        <h3 className="compact-menu-section-title">Во время игры</h3>
        <div className="compact-menu-grid">
          <button
            type="button"
            className="compact-menu-tile"
            onClick={() => onSelectSurface("map")}
          >
            <span className="compact-menu-tile-icon">
              <AppIcon icon={MapSurfaceIcon} />
            </span>
            <span className="compact-menu-tile-label">Карта стола</span>
          </button>

          <button
            type="button"
            className="compact-menu-tile"
            onClick={() => onSelectSurface("journal")}
          >
            <span className="compact-menu-tile-icon">
              <AppIcon icon={JournalSurfaceIcon} />
            </span>
            <span className="compact-menu-tile-label">Журнал и чат</span>
          </button>

          {liveItems.map((item) => (
            <button
              key={item.id}
              type="button"
              className="compact-menu-tile"
              onClick={() => onSelectWorkspace(item.id)}
            >
              <span className="compact-menu-tile-icon">
                <AppIcon icon={getSectionIcon(item.id)} />
              </span>
              <span className="compact-menu-tile-label">{item.label}</span>
            </button>
          ))}
        </div>
      </section>

      {isGm && snapshot.me.role === "GM" && onTogglePause && (
        <section className="compact-menu-section" aria-label="Перерыв">
          <h3 className="compact-menu-section-title">Перерыв</h3>
          <p role="status">
            {snapshot.campaign.paused
              ? "Игра на перерыве. Чат и броски доступны."
              : "Игра идёт."}
          </p>
          <button
            type="button"
            className="compact-menu-action-btn"
            disabled={pausePending || connection !== "ONLINE"}
            aria-busy={pausePending}
            onClick={() => void togglePause()}
          >
            <AppIcon icon={PauseIcon} />
            <span>
              {pausePending
                ? "Сохраняю…"
                : snapshot.campaign.paused
                  ? "Продолжить игру"
                  : "Начать перерыв"}
            </span>
          </button>
          {connection !== "ONLINE" && (
            <p>Управление перерывом доступно после восстановления связи.</p>
          )}
          {pauseError && <p role="alert">{pauseError}</p>}
        </section>
      )}

      {/* Audio & Ambience */}
      <section className="compact-menu-section">
        <h3 className="compact-menu-section-title">Звуки и музыка</h3>
        {/* UIX-512: the compact map and menu hide the header, which holds the
          soundpad launcher everywhere else. */}
        <div
          ref={onSoundpadLauncherTarget}
          className="compact-menu-soundpad-slot"
        />
        <div ref={onMusicControlsTarget} className="compact-menu-audio-card" />
      </section>

      {preparation.length > 0 && (
        <section
          className="compact-menu-section"
          aria-labelledby="compact-preparation-title"
        >
          <h3
            id="compact-preparation-title"
            className="compact-menu-section-title"
          >
            Подготовка
          </h3>
          <p id="compact-preparation-hint">
            Сложную подготовку удобнее делать на компьютере. Все разделы
            доступны и здесь.
          </p>
          <div className="compact-menu-grid">
            {preparation.map((item) => (
              <button
                key={item.id}
                type="button"
                className="compact-menu-tile"
                aria-describedby="compact-preparation-hint"
                onClick={() => onSelectWorkspace(item.id)}
              >
                <span className="compact-menu-tile-icon">
                  <AppIcon icon={getSectionIcon(item.id)} />
                </span>
                <span className="compact-menu-tile-label">{item.label}</span>
                <small>Удобнее на компьютере</small>
              </button>
            ))}
          </div>
        </section>
      )}

      {/* Settings & Session Actions */}
      <section className="compact-menu-section">
        <h3 className="compact-menu-section-title">Сеанс и настройки</h3>
        <div className="compact-menu-actions-list">
          <button
            type="button"
            className="compact-menu-action-btn"
            onClick={onOpenThemeSettings}
          >
            <AppIcon icon={SettingsIcon} />
            <span>Тема и рамка бросков</span>
          </button>

          <button
            type="button"
            className="compact-menu-action-btn"
            onClick={onOpenShortcuts}
          >
            <AppIcon icon={DiceTrayIcon} />
            <span>Горячие клавиши</span>
          </button>

          <button
            type="button"
            className="compact-menu-action-btn"
            onClick={onOpenPlayerHandoff}
          >
            <AppIcon icon={CharacterSurfaceIcon} />
            <span>Сменить персонажа / игрока</span>
          </button>

          <button
            type="button"
            className="compact-menu-action-btn compact-menu-action-btn--danger"
            onClick={() => void onLogout()}
          >
            <AppIcon icon={CloseIcon} />
            <span>Выйти из кампании</span>
          </button>
        </div>
      </section>
    </div>
  );
});

import { memo } from "react";
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
  onMusicControlsTarget: (target: HTMLElement | null) => void;
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
  onMusicControlsTarget,
}: CompactMenuSurfaceProps) {
  // Preview must expose the viewed player's navigation, not GM-only sections.
  const isGm = viewSnapshot.me.role === "GM";
  const navItems = workspaceNavItems({ isGm, operatorFeedbackAllowed });

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
        <h3 className="compact-menu-section-title">Разделы стола</h3>
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

          {navItems.map((item) => (
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

      {/* Audio & Ambience */}
      <section className="compact-menu-section">
        <h3 className="compact-menu-section-title">Звуки и музыка</h3>
        <div ref={onMusicControlsTarget} className="compact-menu-audio-card" />
      </section>

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
            <span>Оформление и тема</span>
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

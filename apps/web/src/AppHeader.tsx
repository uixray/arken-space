import { memo, useRef } from "react";
import type { GameSnapshot } from "@arken/contracts";
import { AppIcon } from "./ui/AppIcon";
import {
  MapObjectsIcon,
  PublishedSceneIcon,
  PublishSceneIcon,
  SessionMenuIcon,
} from "./ui/icons";
import { useDismissibleDetails } from "./ui/dismissible-details";
import { WorkspaceNav } from "./WorkspaceNav";
import { FeedbackReporter } from "./FeedbackReporter";
import { ScenePicker } from "./ScenePicker";
import { workspaceNavItems, type WorkspaceId } from "./workspace-nav";

export interface AppHeaderProps {
  compact: boolean;
  activeScene: GameSnapshot["scenes"][number] | null | undefined;
  broadcastScene: GameSnapshot["scenes"][number] | null | undefined;
  recentlyPublishedSceneId: string | null;
  viewSnapshot: GameSnapshot;
  snapshot: GameSnapshot;
  connection:
    "ONLINE" | "RESYNCING" | "OFFLINE" | "RECONNECTING" | "CONNECTING";
  previewSnapshot: GameSnapshot | null;
  operatorFeedbackAllowed: boolean;
  workspace: WorkspaceId | null;
  personalTheme?: GameSnapshot["personalTheme"];
  onMusicControlsTarget: (target: HTMLElement | null) => void;
  onSoundpadLauncherTarget: (target: HTMLElement | null) => void;

  onOpenCompactSections: () => void;
  onSelectScene: (sceneId: string) => void;
  onRequestEditScene: (sceneId: string) => void;
  onPublishScene: () => void;
  onRequestCreateScene: () => void;
  onSelectWorkspace: (workspace: WorkspaceId) => void;
  onResync: () => void;
  onOpenCampaignRename: () => void;
  onOpenThemeSettings: () => void;
  onOpenShortcuts: () => void;
  onExitPreview: () => void;
  onOpenPlayerHandoff: () => void;
  onLogout: () => Promise<void> | void;
}

export const AppHeader = memo(function AppHeader({
  compact,
  activeScene,
  broadcastScene,
  recentlyPublishedSceneId,
  viewSnapshot,
  snapshot,
  connection,
  previewSnapshot,
  operatorFeedbackAllowed,
  workspace,
  personalTheme,
  onMusicControlsTarget,
  onSoundpadLauncherTarget,

  onOpenCompactSections,
  onSelectScene,
  onRequestEditScene,
  onPublishScene,
  onSelectWorkspace,
  onResync,
  onOpenCampaignRename,
  onOpenThemeSettings,
  onOpenShortcuts,
  onExitPreview,
  onOpenPlayerHandoff,
  onLogout,
}: AppHeaderProps) {
  const accountMenuRef = useRef<HTMLDetailsElement>(null);
  useDismissibleDetails(accountMenuRef);

  return (
    <header className="topbar">
      {compact && (
        <>
          <div className="compact-session-caption">
            <strong>{activeScene?.name ?? "Нет активной сцены"}</strong>
            <span role="status">
              {viewSnapshot.me.role === "GM"
                ? "Мастер"
                : viewSnapshot.me.displayName}{" "}
              ·{" "}
              {connection === "ONLINE"
                ? "в сети"
                : connection === "OFFLINE"
                  ? "нет связи"
                  : "подключаемся"}
            </span>
          </div>
          <button
            className="compact-sections-button"
            type="button"
            disabled={Boolean(previewSnapshot)}
            onClick={onOpenCompactSections}
          >
            Разделы
          </button>
        </>
      )}
      <div className="brand">
        <a href="/?home=1" aria-label="Открыть главную страницу Arken Space">
          <span className="brand__mark" role="img" aria-label="ARKPATH" />
        </a>
      </div>
      <div className="scene-switcher">
        <ScenePicker
          activeScene={activeScene}
          scenes={viewSnapshot.scenes}
          assets={viewSnapshot.assets}
          tokens={viewSnapshot.tokens}
          isGm={snapshot.me.role === "GM"}
          isPreview={Boolean(previewSnapshot)}
          onSelectScene={onSelectScene}
          onEditScene={onRequestEditScene}
        />
        {!previewSnapshot && snapshot.me.role === "GM" && activeScene && (
          <button
            className="topbar-icon-button publish-scene"
            disabled={
              activeScene.id === broadcastScene?.id ||
              activeScene.id === recentlyPublishedSceneId
            }
            aria-label={
              activeScene.id === broadcastScene?.id ||
              activeScene.id === recentlyPublishedSceneId
                ? "Сцена уже показана игрокам"
                : "Показать выбранную сцену игрокам"
            }
            title={
              activeScene.id === broadcastScene?.id ||
              activeScene.id === recentlyPublishedSceneId
                ? "Сцена у игроков"
                : "Показать выбранную сцену игрокам"
            }
            aria-pressed={
              activeScene.id === broadcastScene?.id ||
              activeScene.id === recentlyPublishedSceneId
            }
            onClick={onPublishScene}
          >
            <AppIcon
              icon={
                activeScene.id === broadcastScene?.id
                  ? PublishedSceneIcon
                  : PublishSceneIcon
              }
            />
          </button>
        )}
        {!previewSnapshot && snapshot.me.role === "GM" && (
          <button
            className="topbar-icon-button"
            aria-label="Список сцен"
            title="Открыть список сцен"
            onClick={() => onSelectWorkspace("scenes")}
          >
            <AppIcon icon={MapObjectsIcon} />
          </button>
        )}
      </div>
      {/* UIX-472: разделы строкой; не поместившиеся — под «Ещё». Состав
        и расчёт вместимости живут в `workspace-nav.ts`. */}
      <WorkspaceNav
        items={workspaceNavItems({
          isGm: snapshot.me.role === "GM",
          operatorFeedbackAllowed,
        })}
        active={workspace}
        onSelect={onSelectWorkspace}
      />
      <div className="status-line">
        <div ref={onSoundpadLauncherTarget} className="soundpad-header-slot" />
        <div ref={onMusicControlsTarget} className="music-controls-slot" />
        <details className="account-menu" ref={accountMenuRef}>
          <summary aria-label="Меню сеанса" title="Меню сеанса">
            <AppIcon icon={SessionMenuIcon} />
          </summary>
          <div className="account-menu__content">
            <span
              className={connection === "ONLINE" ? "status online" : "status"}
            >
              {connection === "ONLINE"
                ? "в сети"
                : connection === "RESYNCING"
                  ? "синхронизация"
                  : connection === "OFFLINE"
                    ? "нет связи"
                    : "переподключение"}
            </span>
            {connection !== "ONLINE" && (
              <button onClick={onResync}>Синхронизировать</button>
            )}
            <span className="account-menu__identity">
              {previewSnapshot
                ? `Просмотр: ${viewSnapshot.me.displayName}`
                : snapshot.me.role === "PLAYER"
                  ? `Вы играете как: ${snapshot.me.displayName}`
                  : `${snapshot.me.displayName} · Мастер`}
            </span>
            <span
              className="account-menu__build"
              title={`Схема ${snapshot.schemaVersion}, сборка ${snapshot.buildVersion}, Git ${snapshot.buildRevision ?? "unknown"}`}
            >
              v{snapshot.snapshotVersion} ·{" "}
              {(snapshot.buildRevision ?? "unknown").slice(0, 7)}
            </span>
            {snapshot.me.role === "GM" && !previewSnapshot && (
              <button
                type="button"
                onClick={() => {
                  const menu = accountMenuRef.current;
                  if (menu) {
                    menu.open = false;
                    menu.querySelector<HTMLElement>("summary")?.focus();
                  }
                  onOpenCampaignRename();
                }}
              >
                Переименовать кампанию
              </button>
            )}
            {!previewSnapshot && personalTheme && (
              <button
                type="button"
                onClick={() => {
                  const menu = accountMenuRef.current;
                  if (menu) {
                    menu.open = false;
                    menu.querySelector<HTMLElement>("summary")?.focus();
                  }
                  onOpenThemeSettings();
                }}
              >
                Оформление
              </button>
            )}
            {/* UIX-462: шпаргалка рядом с выходом — сюда лезут, когда ищут
              «что-то про программу, а не про игру». */}
            <button onClick={onOpenShortcuts}>Клавиши и команды</button>
            {!previewSnapshot && (
              <FeedbackReporter
                onOpen={() => {
                  const menu = accountMenuRef.current;
                  if (menu) {
                    menu.open = false;
                    menu.querySelector<HTMLElement>("summary")?.focus();
                  }
                }}
                buildVersion={snapshot.buildVersion}
                buildRevision={snapshot.buildRevision}
                connection={connection}
              />
            )}
            {previewSnapshot && (
              <button onClick={onExitPreview}>Вернуться к мастеру</button>
            )}
            {snapshot.me.role === "PLAYER" && !previewSnapshot ? (
              <button onClick={onOpenPlayerHandoff}>Сменить игрока</button>
            ) : (
              <button onClick={() => void onLogout()}>Выйти</button>
            )}
          </div>
        </details>
      </div>
    </header>
  );
});

import { memo } from "react";
import type { GameSnapshot } from "@arken/contracts";
import { ArkenDialog } from "./ui/ArkenDialog";
import { TextPromptDialog } from "./ui/TextPromptDialog";
import { ShortcutsDialog } from "./ShortcutsDialog";
import { workspaceNavItems, type WorkspaceId } from "./workspace-nav";
import { resolvePlayerThemeId } from "./design-system/player-themes";
import { PlayerThemeSettings } from "./design-system/PlayerThemeSettings";
import type { PlayerThemePreferenceController } from "./design-system/usePlayerThemePreference";

export interface AppModalsProps {
  personalTheme?: GameSnapshot["personalTheme"];
  themePreference: PlayerThemePreferenceController;
  publishedThemeIds: readonly string[];
  themeSettingsOpen: boolean;
  onCloseThemeSettings: () => void;

  compact: boolean;
  compactSectionsOpen: boolean;
  onCloseCompactSections: () => void;
  isGm: boolean;
  operatorFeedbackAllowed: boolean;
  onSelectWorkspace: (workspace: WorkspaceId) => void;

  playerHandoffOpen: boolean;
  playerHandoffPending: boolean;
  playerHandoffError: string;
  onApplyPlayerHandoff: () => void;
  onClosePlayerHandoff: () => void;

  campaignRenameOpen: boolean;
  campaignName: string;
  onApplyCampaignRename: (name: string) => Promise<void>;
  onCloseCampaignRename: () => void;

  shortcutsOpen: boolean;
  onCloseShortcuts: () => void;
}

export const AppModals = memo(function AppModals({
  personalTheme,
  themePreference,
  publishedThemeIds,
  themeSettingsOpen,
  onCloseThemeSettings,

  compact,
  compactSectionsOpen,
  onCloseCompactSections,
  isGm,
  operatorFeedbackAllowed,
  onSelectWorkspace,

  playerHandoffOpen,
  playerHandoffPending,
  playerHandoffError,
  onApplyPlayerHandoff,
  onClosePlayerHandoff,

  campaignRenameOpen,
  campaignName,
  onApplyCampaignRename,
  onCloseCampaignRename,

  shortcutsOpen,
  onCloseShortcuts,
}: AppModalsProps) {
  return (
    <>
      {personalTheme ? (
        <ArkenDialog
          open={themeSettingsOpen}
          title="Оформление"
          footer={false}
          onClose={() => {
            if (themePreference.pending) return;
            themePreference.cancel();
            onCloseThemeSettings();
          }}
        >
          <PlayerThemeSettings
            publishedThemes={personalTheme.publishedThemes}
            currentResolvedThemeId={themePreference.selection}
            defaultThemeId={resolvePlayerThemeId({
              selectedThemeId: null,
              defaultThemeId: personalTheme.defaultThemeId,
              publishedThemeIds: new Set(publishedThemeIds),
            })}
            savedOverrideThemeId={
              themePreference.preference?.selectedThemeId ?? null
            }
            scopeKey={personalTheme.scopeKey}
            pending={themePreference.pending}
            error={themePreference.error}
            onPreview={themePreference.preview}
            onApply={() => void themePreference.apply()}
            onReset={() => void themePreference.reset()}
            onCancel={() => {
              themePreference.cancel();
              onCloseThemeSettings();
            }}
          />
        </ArkenDialog>
      ) : null}

      <ArkenDialog
        open={compact && compactSectionsOpen}
        title="Разделы"
        footer={false}
        onClose={onCloseCompactSections}
      >
        <div className="compact-sections-list">
          {workspaceNavItems({
            isGm,
            operatorFeedbackAllowed,
          }).map((item) => (
            <button
              type="button"
              key={item.id}
              onClick={() => {
                onCloseCompactSections();
                onSelectWorkspace(item.id);
              }}
            >
              {item.label}
            </button>
          ))}
        </div>
        <p className="compact-desktop-note">
          Подготовка мира и сложные редакторы рассчитаны на компьютер. Мобильные
          инструменты появятся отдельными этапами.
        </p>
      </ArkenDialog>

      <ArkenDialog
        open={playerHandoffOpen}
        title="Сменить игрока?"
        applyLabel="Сменить игрока"
        loading={playerHandoffPending}
        error={playerHandoffError}
        onApply={() => void onApplyPlayerHandoff()}
        onClose={onClosePlayerHandoff}
      >
        <p className="arken-dialog-message">
          Завершите текущие действия перед передачей компьютера: несохранённые
          данные в открытых формах будут потеряны. Следующий игрок войдёт по
          своей личной ссылке. На общем экране не открывайте личные заметки или
          сообщения, которые не должны видеть другие игроки.
        </p>
      </ArkenDialog>

      <TextPromptDialog
        open={campaignRenameOpen}
        title="Название кампании"
        label="Название кампании"
        initialValue={campaignName}
        applyLabel="Сохранить"
        onClose={onCloseCampaignRename}
        onApply={onApplyCampaignRename}
      />

      <ShortcutsDialog
        open={shortcutsOpen}
        isGm={isGm}
        onClose={onCloseShortcuts}
      />
    </>
  );
});

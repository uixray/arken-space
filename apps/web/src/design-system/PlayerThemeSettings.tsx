import { useId, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Button } from "@gravity-ui/uikit";

import { FormSelect } from "../ui/GravityFormControls";
import type { PlayerThemeDefinition, PlayerThemeId } from "./player-themes";
import { isPlayerThemeId } from "./player-themes";
import "./PlayerThemeSettings.css";

export type PlayerThemeSelection = PlayerThemeId | "system";

export interface PlayerThemeSettingsProps {
  /** A server-approved, already published catalogue. Unpublished themes stay out. */
  publishedThemes: readonly PlayerThemeDefinition[];
  /** Appearance that is currently rendered, after resolving the assigned default. */
  currentResolvedThemeId: PlayerThemeSelection;
  /** The player's assigned default. Resetting clears the override back to this value. */
  defaultThemeId: PlayerThemeSelection;
  /** Persisted explicit choice; null means the assigned default. */
  savedOverrideThemeId: PlayerThemeSelection | null;
  /** Stable identity/settings scope. Changing it discards the previous scope's draft. */
  scopeKey: string;
  pending?: boolean;
  error?: string | null;
  onPreview: (themeId: PlayerThemeSelection) => void;
  onApply: (themeId: PlayerThemeSelection) => void;
  onReset: () => void;
  /** The owner restores the persisted appearance before closing the surface. */
  onCancel: () => void;
}

function visibleName(theme: PlayerThemeDefinition): string {
  return theme.id === "classic-v1" ? "Прежнее оформление" : theme.name;
}

export function PlayerThemeSettings({
  scopeKey,
  ...props
}: PlayerThemeSettingsProps) {
  // A keyed boundary prevents even one render with another identity's draft.
  return <ScopedPlayerThemeSettings key={scopeKey} {...props} />;
}

function ScopedPlayerThemeSettings({
  publishedThemes,
  currentResolvedThemeId,
  defaultThemeId,
  savedOverrideThemeId,
  pending = false,
  error,
  onPreview,
  onApply,
  onReset,
  onCancel,
}: Omit<PlayerThemeSettingsProps, "scopeKey">) {
  const descriptionId = useId();
  const errorId = useId();
  const visiblePublishedThemes = useMemo(
    () =>
      publishedThemes.filter(
        (theme): theme is PlayerThemeDefinition & { id: PlayerThemeId } =>
          isPlayerThemeId(theme.id),
      ),
    [publishedThemes],
  );
  const allowedThemeIds = useMemo(
    () =>
      new Set<PlayerThemeSelection>([
        "system",
        ...visiblePublishedThemes.map(({ id }) => id),
      ]),
    [visiblePublishedThemes],
  );
  const safeSelection = (selection: PlayerThemeSelection) =>
    allowedThemeIds.has(selection) ? selection : "system";
  const persistedSelection = safeSelection(
    savedOverrideThemeId ?? defaultThemeId,
  );
  const [draftThemeId, setDraftThemeId] =
    useState<PlayerThemeSelection>(persistedSelection);
  const previousPersistedSelection = useRef(persistedSelection);
  const resolvedCurrentThemeId = safeSelection(currentResolvedThemeId);
  const previousCurrentThemeId = useRef(resolvedCurrentThemeId);
  const visibleDraftThemeId = allowedThemeIds.has(draftThemeId)
    ? draftThemeId
    : persistedSelection;

  // A confirmed persistence change adopts the saved value. Error-only rerenders
  // keep the draft. A catalogue removal cannot leave an unpublished selection.
  useLayoutEffect(() => {
    const persistedChanged =
      previousPersistedSelection.current !== persistedSelection;
    const currentChanged =
      previousCurrentThemeId.current !== resolvedCurrentThemeId;
    if (
      persistedChanged ||
      currentChanged ||
      !allowedThemeIds.has(draftThemeId)
    ) {
      previousPersistedSelection.current = persistedSelection;
      previousCurrentThemeId.current = resolvedCurrentThemeId;
      setDraftThemeId(
        currentChanged ? resolvedCurrentThemeId : persistedSelection,
      );
    }
  }, [
    allowedThemeIds,
    draftThemeId,
    persistedSelection,
    resolvedCurrentThemeId,
  ]);

  const optionLabel = (id: string, name: string) => {
    const labels: string[] = [];
    if (id === currentResolvedThemeId) labels.push("сейчас");
    if (id === defaultThemeId) labels.push("по умолчанию");
    return labels.length ? `${name} — ${labels.join(", ")}` : name;
  };

  return (
    <section
      className="player-theme-settings"
      aria-labelledby={`${descriptionId}-title`}
      aria-busy={pending}
    >
      <h2 id={`${descriptionId}-title`}>Оформление игрока</h2>
      <p id={descriptionId} className="player-theme-settings__description">
        Предпросмотр не сохраняет выбор. «Системное оформление» оставляет
        базовый интерфейс и не означает сброс к назначенной теме.
      </p>

      <label
        className="player-theme-settings__field"
        htmlFor={`${descriptionId}-select`}
      >
        <span>Тема</span>
        <FormSelect
          id={`${descriptionId}-select`}
          value={visibleDraftThemeId}
          disabled={pending}
          aria-describedby={[descriptionId, error ? errorId : undefined]
            .filter(Boolean)
            .join(" ")}
          aria-invalid={Boolean(error)}
          onChange={(event) => {
            const next = event.target.value as PlayerThemeSelection;
            if (!allowedThemeIds.has(next)) return;
            setDraftThemeId(next);
            onPreview(next);
          }}
        >
          <option value="system">
            {optionLabel("system", "Системное оформление")}
          </option>
          {visiblePublishedThemes.map((theme) => (
            <option key={theme.id} value={theme.id}>
              {optionLabel(theme.id, visibleName(theme))}
            </option>
          ))}
        </FormSelect>
      </label>

      {error ? (
        <p id={errorId} className="player-theme-settings__error" role="alert">
          {error}
        </p>
      ) : null}

      <div className="player-theme-settings__actions">
        <Button view="outlined" disabled={pending} onClick={onReset}>
          Сбросить к моей теме
        </Button>
        <span className="player-theme-settings__actions-main">
          <Button view="flat" disabled={pending} onClick={onCancel}>
            Отмена
          </Button>
          <Button
            view="action"
            loading={pending}
            disabled={pending}
            onClick={() => onApply(visibleDraftThemeId)}
          >
            Сохранить
          </Button>
        </span>
      </div>
    </section>
  );
}

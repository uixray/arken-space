import {
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
  type FormEvent,
  type CSSProperties,
} from "react";
import {
  statKeyFromLabel,
  moveStatRow,
  resourceCostLabels,
  statLabelsFromLayout,
  statResourceRowsFromLayout,
  statRowsOfGroup,
  uniqueStatKey,
} from "../stat-keys";
import { useCampaignActions } from "../campaign-actions-context";
import type { CampaignActions } from "../campaign-actions-context";
import { createPortal } from "react-dom";
import type { CharacterDto, GameSnapshot } from "@arken/contracts";
import { RESOURCE_REGEN_STAT, isSystemRegenStatKey } from "@arken/system";
import { Button } from "../design-system/Button";
import { CatalogEntryForm } from "../CatalogEntryForm";
import { ApiError, formatApiError } from "../api";
import { TextPromptDialog } from "../ui/TextPromptDialog";
import { ArkenDialog } from "../ui/ArkenDialog";
import { isEditableEventTarget } from "../input-diagnostics";
import { useRemoteFieldValue } from "../ui/remote-field-value";
import { ImageUploadField } from "../ui/ImageUploadField";
import { FormInput, FormSelect, FormTextArea } from "../ui/GravityFormControls";
import { AssetPicker } from "../ui/AssetPicker";
import { normalizeCharacterControllerIds } from "../character-controller-access-state";
import {
  characterWorkspaceReducer,
  createCharacterWorkspaceState,
  extractCharacterTemplateFields,
  MAX_OPEN_CHARACTER_SHEETS,
  uniqueCharacterIds,
  type CharacterTemplateFields,
} from "../character-workspace-state";
import { CharacterMediaGallery } from "./CharacterMediaGallery";
import { CharacterSpellBranches } from "../CharacterSpellBranches";
import { CharacterActionCard } from "../SkillCards";
import { humanizeFormula } from "../formula-display";
import { rollModeFromEvent } from "../roll-modifier-keys";
import type { RollMode } from "../roll-mode";
import { RollButton } from "./RollButton";
import { CatalogEntryPicker } from "./CatalogEntryPicker";
import { StatLayoutCard } from "./StatLayoutCard";
import { selectableCatalogEntries } from "./catalog-entry-selection";
import {
  changeWalletValue,
  EMPTY_WALLET,
  mergeWalletDelta,
  normalizeWallet,
  normalizeWalletValue,
  WALLET_ADJUST_DELAY_MS,
  WALLET_LABELS,
  walletDeltaIsEmpty,
  spendWalletCoin,
  canSpendWalletCoin,
  type Wallet,
  type WalletDelta,
} from "../wallet";
import type { Props } from "../Sidebar";
import { Empty } from "./MediaPanel";
import { AppIcon } from "../ui/AppIcon";
import { notify } from "../ui/notifications";
import {
  AddIcon,
  CharacterArchiveIcon,
  CloseIcon,
  CoinsIcon,
  CollapseCharacterRailIcon,
  DecreaseIcon,
  ExpandCharacterRailIcon,
} from "../ui/icons";

// UIX-389/UIX-391: re-exported for backward compatibility — RollButton now
// lives in its own module (./RollButton) so CatalogEntryPicker can import it
// without a circular dependency on this file.
export { RollButton } from "./RollButton";

type WalletBatch = {
  /** null means that a preceding manual input made this an absolute SET. */
  delta: WalletDelta | null;
  wallet: Wallet;
  baseWallet: Wallet;
  flush: () => void;
  timer: ReturnType<typeof setTimeout>;
};

export function CharacterWorkspace({
  onClose,
  active = true,
  ...props
}: Props & { onClose: () => void; active?: boolean }) {
  // UIX-398 step B: archive/restore come from context, not through Sidebar.
  const {
    worldMap: worldMapActions,
    character: characterActions,
    campaign: campaignActions,
    dice: diceActions,
  } = useCampaignActions();
  const characters = useMemo(() => {
    const visible =
      props.snapshot.me.role === "GM"
        ? props.snapshot.characters
        : props.snapshot.characters.filter(
            (character) =>
              character.ownerMembershipId === props.snapshot.me.id ||
              character.controllerMembershipIds.includes(
                props.snapshot.me.id,
              ) ||
              character.id === props.snapshot.me.characterId,
          );
    const byId = new Map(visible.map((character) => [character.id, character]));
    return uniqueCharacterIds(visible.map((character) => character.id))
      .map((id) => byId.get(id))
      .filter((character): character is CharacterDto => Boolean(character));
  }, [props.snapshot.characters, props.snapshot.me]);
  const [state, dispatch] = useReducer(
    characterWorkspaceReducer,
    characters.map((character) => character.id),
    createCharacterWorkspaceState,
  );
  const workspaceRef = useRef<HTMLElement>(null);
  const titleRef = useRef<HTMLHeadingElement>(null);
  const [createCharacterOpen, setCreateCharacterOpen] = useState(false);
  const [dayPending, setDayPending] = useState(false);
  const dayPendingRef = useRef(false);
  const sheetLimitDescriptionId = useId();
  const [railCollapsed, setRailCollapsed] = useState(false);
  // UIX-393: GM-only archive/restore. `archiveTarget` drives the confirm
  // dialog for a single character; `restoreDialogOpen` opens the separate
  // archived-roster dialog (archived characters are excluded from
  // `props.snapshot.characters` server-side, so they are fetched on demand).
  const [archiveTarget, setArchiveTarget] = useState<CharacterDto | null>(null);
  const [restoreDialogOpen, setRestoreDialogOpen] = useState(false);

  useEffect(() => {
    if (active) titleRef.current?.focus({ preventScroll: true });
  }, [active]);
  useEffect(() => {
    dispatch({
      type: "SYNC",
      ids: characters.map((character) => character.id),
    });
  }, [characters]);
  useEffect(() => {
    const id = props.requestedCharacterId;
    if (!id || !characters.some((character) => character.id === id)) return;
    dispatch({ type: "OPEN_EXCLUSIVE", id });
  }, [characters, props.requestedCharacterId]);
  useEffect(() => {
    if (!active || !state.activeId) return;
    workspaceRef.current
      ?.querySelector<HTMLElement>(
        `[data-character-sheet-id="${CSS.escape(state.activeId)}"]`,
      )
      ?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [active, state.activeId]);
  useEffect(() => {
    if (!active) return;
    // Gravity may synchronously collapse the Select before the window bubble
    // listener runs. Remember ownership in capture, without intercepting the
    // event: the Select still closes itself; a second Escape closes the sheet.
    const selectEscapes = new WeakSet<KeyboardEvent>();
    const rememberSelectEscape = (event: KeyboardEvent) => {
      if (
        event.key === "Escape" &&
        event.target instanceof Element &&
        event.target.closest(
          '[role="listbox"], [role="combobox"][aria-expanded="true"]',
        )
      ) {
        selectEscapes.add(event);
      }
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (
        selectEscapes.has(event) ||
        event.defaultPrevented ||
        event.isComposing ||
        isEditableEventTarget(event.target)
      )
        return;
      if (event.key !== "Escape") return;
      if (
        (event.target as Element | null)?.closest(
          '[role="dialog"], [role="listbox"], [role="combobox"][aria-expanded="true"]',
        )
      )
        return;
      onClose();
    };
    window.addEventListener("keydown", rememberSelectEscape, true);
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("keydown", rememberSelectEscape, true);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [active, onClose]);

  const openCount = state.openIds.length;
  const sheetLimitReached = openCount >= MAX_OPEN_CHARACTER_SHEETS;
  return createPortal(
    <main
      ref={workspaceRef}
      id="character-workspace"
      tabIndex={-1}
      data-compact={props.compact ? "true" : undefined}
      hidden={!active}
      inert={!active}
      aria-hidden={!active}
      className={`character-workspace${props.collapsed ? " is-sidebar-collapsed" : ""}`}
      aria-labelledby="character-workspace-title"
      style={
        props.workspaceSidebarWidth != null
          ? ({
              "--sidebar-width": `${props.workspaceSidebarWidth}px`,
            } as CSSProperties)
          : undefined
      }
    >
      <header className="character-workspace__header">
        <button
          type="button"
          className="character-rail-toggle"
          aria-label={
            railCollapsed
              ? "Развернуть список персонажей"
              : "Свернуть список персонажей"
          }
          aria-pressed={railCollapsed}
          title={
            railCollapsed
              ? "Развернуть список персонажей"
              : "Свернуть список персонажей"
          }
          onClick={() => setRailCollapsed((current) => !current)}
        >
          <AppIcon
            icon={
              railCollapsed
                ? ExpandCharacterRailIcon
                : CollapseCharacterRailIcon
            }
          />
        </button>
        <div>
          <span className="eyebrow">Рабочее пространство</span>
          <h2 ref={titleRef} id="character-workspace-title" tabIndex={-1}>
            Персонажи
          </h2>
        </div>
        <p className="muted">
          Открыто {openCount}/{MAX_OPEN_CHARACTER_SHEETS}
        </p>
        {props.snapshot.me.role === "GM" && (
          <Button
            view="flat"
            disabled={dayPending}
            loading={dayPending}
            title="Перевести календарь на следующий день без восстановления ресурсов"
            onClick={() => {
              if (dayPendingRef.current) return;
              dayPendingRef.current = true;
              setDayPending(true);
              void Promise.resolve()
                .then(() =>
                  campaignActions.onCampaignClock(
                    "ADVANCE_DAY",
                    props.snapshot.campaign.revision,
                  ),
                )
                .then(() =>
                  notify({ title: "Наступил следующий день", tone: "success" }),
                )
                .catch((reason) =>
                  notify({
                    title: "Не удалось перевести календарь",
                    message: formatApiError(
                      reason,
                      "Не удалось изменить день.",
                    ),
                    tone: "danger",
                  }),
                )
                .finally(() => {
                  dayPendingRef.current = false;
                  setDayPending(false);
                });
            }}
          >
            День {props.snapshot.campaign.day}
          </Button>
        )}
        <button
          type="button"
          className="character-workspace__close"
          aria-label="Закрыть персонажей"
          title="Закрыть рабочее пространство персонажей"
          onClick={onClose}
        >
          <AppIcon icon={CloseIcon} />
        </button>
      </header>
      <div
        className={`character-workspace__body${railCollapsed ? " is-rail-collapsed" : ""}`}
      >
        <nav className="character-rail" aria-label="Персонажи кампании">
          {sheetLimitReached && (
            <p className="muted" id={sheetLimitDescriptionId}>
              Закройте один из открытых листов, чтобы открыть другой.
            </p>
          )}
          {characters.length === 0 ? (
            <p className="muted">Нет доступных персонажей.</p>
          ) : (
            characters.map((character) => {
              const isOpen = state.openIds.includes(character.id);
              const full = !isOpen && sheetLimitReached;
              return (
                <div className="character-rail__item" key={character.id}>
                  <button
                    type="button"
                    className={
                      state.activeId === character.id ? "is-active" : undefined
                    }
                    aria-pressed={state.activeId === character.id}
                    disabled={full}
                    aria-describedby={
                      full ? sheetLimitDescriptionId : undefined
                    }
                    title={
                      full
                        ? "Закройте один из открытых листов, чтобы открыть другой."
                        : isOpen
                          ? `Перейти к персонажу ${character.name}`
                          : `Открыть персонажа ${character.name}`
                    }
                    onClick={() => {
                      if (isOpen) dispatch({ type: "FOCUS", id: character.id });
                      else dispatch({ type: "OPEN", id: character.id });
                    }}
                  >
                    <span
                      className="character-rail__initial"
                      aria-hidden="true"
                    >
                      {character.name.slice(0, 1).toLocaleUpperCase()}
                    </span>
                    <strong>{character.name}</strong>
                    <span className="character-rail__status">
                      {isOpen ? "открыт" : ""}
                    </span>
                  </button>
                  {isOpen && (
                    <button
                      type="button"
                      className="character-rail__close"
                      aria-label={`Закрыть лист ${character.name}`}
                      title={`Закрыть лист ${character.name}`}
                      onClick={() =>
                        dispatch({ type: "CLOSE", id: character.id })
                      }
                    >
                      <AppIcon icon={CloseIcon} />
                    </button>
                  )}
                </div>
              );
            })
          )}
          <div className="character-rail__actions">
            <button
              type="button"
              className="character-rail__create"
              onClick={() => setCreateCharacterOpen(true)}
            >
              <AppIcon icon={AddIcon} /> Создать персонажа
            </button>
            {props.snapshot.me.role === "GM" && (
              <button
                type="button"
                className="character-rail__restore-archived"
                onClick={() => setRestoreDialogOpen(true)}
              >
                <AppIcon icon={CharacterArchiveIcon} /> Архив персонажей
              </button>
            )}
          </div>
        </nav>
        <div
          className="character-sheet-deck"
          aria-label="Открытые листы персонажей"
        >
          {state.openIds.length === 0 ? (
            <div className="character-sheet-deck__empty">
              <p>Выберите персонажа в списке, чтобы открыть его лист.</p>
            </div>
          ) : (
            state.openIds.map((id) => {
              const character = characters.find((item) => item.id === id);
              if (!character) return null;
              return (
                <article
                  className={`character-sheet-card${
                    state.activeId === id ? " is-active" : ""
                  }`}
                  key={id}
                  data-character-sheet-id={id}
                  aria-label={`Лист персонажа ${character.name}`}
                  tabIndex={-1}
                >
                  <header className="character-sheet-card__header">
                    <button
                      type="button"
                      className="character-sheet-card__title"
                      onClick={() => dispatch({ type: "FOCUS", id })}
                    >
                      {character.name}
                    </button>
                    <button
                      type="button"
                      aria-label={`Закрыть лист ${character.name}`}
                      onClick={() => dispatch({ type: "CLOSE", id })}
                    >
                      Закрыть
                    </button>
                  </header>
                  <div className="character-sheet-card__body">
                    <CharacterPanel
                      snapshot={props.snapshot}
                      character={character}
                      selectedId={id}
                      setSelectedId={(nextId) =>
                        dispatch({ type: "OPEN", id: nextId })
                      }
                      showCharacterPicker={false}
                      onPatch={characterActions.patchCharacter}
                      onReplaceControllers={
                        characterActions.replaceCharacterControllers
                      }
                      onRoll={diceActions.onRoll}
                      onUpdateCounters={
                        characterActions.updateCharacterCounters
                      }
                      onArchive={
                        props.snapshot.me.role === "GM"
                          ? () => setArchiveTarget(character)
                          : undefined
                      }
                    />
                  </div>
                </article>
              );
            })
          )}
        </div>
      </div>
      <CreateCharacterDialog
        open={createCharacterOpen}
        characters={props.snapshot.characters}
        onCreate={async (name, template) => {
          await characterActions.onCreateCharacter(name, template);
          setCreateCharacterOpen(false);
        }}
        onClose={() => setCreateCharacterOpen(false)}
      />
      <ArchiveCharacterDialog
        character={archiveTarget}
        onArchive={worldMapActions.onArchiveCharacter}
        onClose={() => setArchiveTarget(null)}
      />
      <RestoreCharactersDialog
        open={restoreDialogOpen}
        onLoad={worldMapActions.onLoadArchivedCharacters}
        onRestore={worldMapActions.onRestoreCharacter}
        onClose={() => setRestoreDialogOpen(false)}
      />
    </main>,
    document.body,
  );
}

/**
 * GM-only: creates a new, independent character — optionally pre-filled from an
 * existing campaign character's structure (stats/skills/spells/inventory/resources).
 * The template is a one-time, editable starting point: the GM can adjust the name
 * here and every structural field afterward on the new character's own sheet;
 * nothing stays linked back to the source.
 */
function CreateCharacterDialog({
  open,
  characters,
  onCreate,
  onClose,
}: {
  open: boolean;
  characters: CharacterDto[];
  onCreate: (
    name: string,
    template: CharacterTemplateFields | undefined,
  ) => Promise<void>;
  onClose: () => void;
}) {
  const [name, setName] = useState("");
  const [templateId, setTemplateId] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (open) {
      setName("");
      setTemplateId("");
      setError("");
    }
  }, [open]);

  const submit = async () => {
    const trimmed = name.trim();
    if (!trimmed) return;
    setPending(true);
    setError("");
    try {
      const source = templateId
        ? characters.find((character) => character.id === templateId)
        : undefined;
      await onCreate(
        trimmed,
        source ? extractCharacterTemplateFields(source) : undefined,
      );
    } catch {
      setError("Не удалось создать персонажа. Повторите попытку.");
    } finally {
      setPending(false);
    }
  };

  return (
    <ArkenDialog
      open={open}
      title="Новый персонаж"
      applyLabel="Создать"
      loading={pending}
      error={error}
      onApply={() => void submit()}
      onClose={onClose}
    >
      <div className="create-character-dialog">
        <div className="create-character-dialog__step">
          <label className="field">
            <span className="create-character-dialog__label">
              1. Имя персонажа
            </span>
            <FormInput
              autoFocus
              value={name}
              placeholder="Например: Элдрин Ветрокрылый"
              onChange={(event) => setName(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter" && name.trim()) void submit();
              }}
            />
            <span className="muted">
              Имя будет отображаться в списке кампании, инициативе и бросках
              кубиков.
            </span>
          </label>
        </div>

        <div className="create-character-dialog__step">
          <label className="field">
            <span className="create-character-dialog__label">
              2. Стартовый шаблон листа (опционально)
            </span>
            <FormSelect
              value={templateId}
              onChange={(event) => setTemplateId(event.target.value)}
            >
              <option value="">Без шаблона (пустой лист)</option>
              {characters.map((character) => (
                <option key={character.id} value={character.id}>
                  {`На основе «${character.name}»`}
                </option>
              ))}
            </FormSelect>
          </label>

          <div className="create-character-dialog__callout">
            <div className="create-character-dialog__callout-title">
              {templateId
                ? "Особенности копирования шаблона:"
                : "Информация о создании:"}
            </div>
            <ul className="create-character-dialog__callout-list">
              <li>
                Копируются характеристики, навыки, заклинания, инвентарь и
                ресурсы.
              </li>
              <li>
                Имя, портрет, владелец и кошелёк не переносятся — новый персонаж
                полностью независим.
              </li>
            </ul>
          </div>
        </div>
      </div>
    </ArkenDialog>
  );
}

/**
 * UIX-393: GM-only archive confirmation. Never a hard delete — the dialog
 * spells out exactly what archiving detaches (scene tokens, sheet-access
 * grants, unclaimed invites) versus what it keeps (the sheet itself, its
 * media/catalog entries, and all chat/audit history), since a GM should not
 * have to guess at the consequence before confirming. On failure the error
 * stays inside the dialog and the dialog stays open — never a silent close
 * that could be mistaken for success.
 */
function ArchiveCharacterDialog({
  character,
  onArchive,
  onClose,
}: {
  character: CharacterDto | null;
  onArchive: (character: CharacterDto) => Promise<void>;
  onClose: () => void;
}) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    setError("");
    setPending(false);
  }, [character]);

  const submit = async () => {
    if (!character) return;
    setPending(true);
    setError("");
    try {
      await onArchive(character);
      onClose();
    } catch (reason) {
      setError(
        reason instanceof ApiError
          ? reason.message
          : "Не удалось архивировать персонажа. Повторите попытку.",
      );
    } finally {
      setPending(false);
    }
  };

  return (
    <ArkenDialog
      open={character !== null}
      title={character ? `Архивировать «${character.name}»?` : "Архивировать?"}
      applyLabel="Архивировать"
      danger
      loading={pending}
      error={error}
      onApply={() => void submit()}
      onClose={() => !pending && onClose()}
    >
      <p className="arken-dialog-message">
        Персонаж исчезнет из активного списка и станет недоступен для игры, но
        не будет удалён безвозвратно — мастер сможет восстановить его в любой
        момент через «Архив персонажей».
      </p>
      <ul className="arken-dialog-consequence-list">
        <li>Токены на сценах и токен-заготовки отвяжутся от персонажа.</li>
        <li>Доступ игроков к листу персонажа будет отозван.</li>
        <li>
          Неиспользованные приглашения на этого персонажа станут
          недействительны.
        </li>
        <li>
          История чата, журнал событий, галерея и лист персонажа сохранятся.
        </li>
      </ul>
    </ArkenDialog>
  );
}

/**
 * UIX-393: GM-only restore roster. Archived characters are excluded from
 * `snapshot.characters` entirely (see `snapshot.ts`), so this dialog loads
 * them on demand via a dedicated GM-only endpoint instead of reading off the
 * shared snapshot. Restoring only flips the character back to ACTIVE; it
 * deliberately does not reinstate detached token/controller/invite links
 * (documented server-side) — the row disappears from this list on success.
 */
function RestoreCharactersDialog({
  open,
  onLoad,
  onRestore,
  onClose,
}: {
  open: boolean;
  onLoad: () => Promise<CharacterDto[]>;
  onRestore: (character: CharacterDto) => Promise<void>;
  onClose: () => void;
}) {
  const [items, setItems] = useState<CharacterDto[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState("");
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [rowError, setRowError] = useState("");

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setLoading(true);
    setLoadError("");
    setRowError("");
    onLoad()
      .then((list) => {
        if (!cancelled) setItems(list);
      })
      .catch((reason) => {
        if (cancelled) return;
        setLoadError(
          reason instanceof ApiError
            ? reason.message
            : "Не удалось загрузить архив персонажей.",
        );
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open, onLoad]);

  const restore = async (character: CharacterDto) => {
    setPendingId(character.id);
    setRowError("");
    try {
      await onRestore(character);
      setItems((current) => current.filter((item) => item.id !== character.id));
    } catch (reason) {
      setRowError(
        reason instanceof ApiError
          ? reason.message
          : `Не удалось восстановить «${character.name}». Повторите попытку.`,
      );
    } finally {
      setPendingId(null);
    }
  };

  return (
    <ArkenDialog
      open={open}
      title="Архив персонажей"
      footer={false}
      error={rowError || loadError}
      onClose={onClose}
    >
      {loading ? (
        <p className="muted">Загрузка…</p>
      ) : items.length === 0 ? (
        <p className="muted">В архиве нет персонажей.</p>
      ) : (
        <ul className="archived-character-list">
          {items.map((character) => (
            <li key={character.id} className="archived-character-list__item">
              <span className="archived-character-list__name">
                {character.name}
              </span>
              {character.archivedAt && (
                <span className="muted">
                  {new Date(character.archivedAt).toLocaleString()}
                </span>
              )}
              <Button
                view="outlined"
                size="s"
                loading={pendingId === character.id}
                disabled={pendingId !== null && pendingId !== character.id}
                onClick={() => void restore(character)}
              >
                Восстановить
              </Button>
            </li>
          ))}
        </ul>
      )}
    </ArkenDialog>
  );
}

function CharacterControllerAccess({
  character,
  members,
  onSave,
}: {
  character: CharacterDto;
  members: GameSnapshot["members"];
  onSave: CampaignActions["character"]["replaceCharacterControllers"];
}) {
  const canonical = useMemo(
    () =>
      normalizeCharacterControllerIds(
        character.controllerMembershipIds,
        character.ownerMembershipId,
      ),
    [character.controllerMembershipIds, character.ownerMembershipId],
  );
  const [draft, setDraft] = useState(canonical);
  const [pending, setPending] = useState(false);
  const pendingRef = useRef(false);
  const [error, setError] = useState("");
  const saveDescriptionId = useId();
  const dirty =
    JSON.stringify([...draft].sort()) !== JSON.stringify([...canonical].sort());

  useEffect(() => {
    setDraft(canonical);
  }, [canonical, character.id, character.revision]);

  const players = members.filter((member) => member.role === "PLAYER");
  return (
    <fieldset className="character-controller-access" disabled={pending}>
      <legend>Доступ к персонажу</legend>
      <p className="muted">
        Игроки, которые могут видеть и управлять этим персонажем.
      </p>
      <div className="character-controller-access__players">
        {players.length === 0 && (
          <p className="muted">В кампании пока нет игроков.</p>
        )}
        {players.map((member) => {
          const owner = member.id === character.ownerMembershipId;
          const checked = owner || draft.includes(member.id);
          return (
            <label key={member.id}>
              <input
                type="checkbox"
                checked={checked}
                disabled={owner || pending}
                onChange={(event) =>
                  setDraft((current) =>
                    event.target.checked
                      ? normalizeCharacterControllerIds(
                          [...current, member.id],
                          character.ownerMembershipId,
                        )
                      : current.filter((id) => id !== member.id),
                  )
                }
              />
              <span>{member.displayName}</span>
              {owner && <span className="muted">Владелец</span>}
            </label>
          );
        })}
      </div>
      {error && (
        <p className="field-error" role="alert">
          {error}
        </p>
      )}
      <span id={saveDescriptionId} className="sr-only">
        {pending
          ? "Сохраняем доступ к персонажу…"
          : dirty
            ? "Изменения доступа ещё не сохранены."
            : "Изменений доступа нет."}
      </span>
      <Button
        disabled={!dirty || pending}
        aria-describedby={saveDescriptionId}
        aria-busy={pending}
        onClick={() => {
          if (pendingRef.current) return;
          pendingRef.current = true;
          setPending(true);
          setError("");
          void (async () => {
            try {
              await onSave(character.id, character.revision, draft);
              notify({ title: "Доступ к персонажу сохранён", tone: "success" });
            } catch {
              setError(
                "Не удалось сохранить доступ. Данные обновлены — проверьте список и повторите попытку.",
              );
            } finally {
              pendingRef.current = false;
              setPending(false);
            }
          })();
        }}
      >
        {pending ? "Сохранение…" : "Сохранить доступ"}
      </Button>
    </fieldset>
  );
}

export function CharacterPanel({
  snapshot,
  character,
  selectedId,
  setSelectedId,
  showCharacterPicker = true,
  onPatch,
  onReplaceControllers,
  onRoll,
  onUpdateCounters,
  onArchive,
}: {
  snapshot: GameSnapshot;
  character: CharacterDto | undefined;
  selectedId: string;
  setSelectedId: (value: string) => void;
  showCharacterPicker?: boolean;
  onPatch: CampaignActions["character"]["patchCharacter"];
  onReplaceControllers: CampaignActions["character"]["replaceCharacterControllers"];
  onRoll: CampaignActions["dice"]["onRoll"];
  onUpdateCounters: CampaignActions["character"]["updateCharacterCounters"];
  onArchive?: () => void;
}) {
  // The catalog handlers are read here rather than passed in: this panel is
  // the only place that uses them, so threading them through the workspace
  // above only made two components know about them instead of one.
  const {
    catalog: catalogActions,
    asset: assetActions,
    statLayout: statLayoutActions,
  } = useCampaignActions();
  const statLabels = statLabelsFromLayout(snapshot.campaign.statLayout);
  const characteristicRows = statRowsOfGroup(
    snapshot.campaign.statLayout,
    "characteristics",
  );
  const combatRows = statRowsOfGroup(snapshot.campaign.statLayout, "combat");
  const initiativeRows = combatRows.filter(
    (row) => row.key === "initiative" || row.key === "reaction",
  );
  const resourceRows = statResourceRowsFromLayout(snapshot.campaign.statLayout);
  const resourceLabels = resourceCostLabels(snapshot.campaign.statLayout);
  const [countersPending, setCountersPending] = useState(0);
  const [vitalsTab, setVitalsTab] = useState<
    "stats" | "inventory" | "bio"
  >("stats");
  const vitalsTabId = useId();
  const [countersError, setCountersError] = useState("");
  // Undefined preserves each catalog action's legacy advantage setting until the player explicitly overrides it.
  const [rollPending, setRollPending] = useState(false);
  const [rollError, setRollError] = useState("");
  const [characterMutationError, setCharacterMutationError] = useState("");
  const [editingStandardSkill, setEditingStandardSkill] = useState<
    CharacterDto["skills"][number] | null
  >(null);
  const [standardSkillDraft, setStandardSkillDraft] = useState({
    name: "",
    rank: "",
    formula: "",
  });
  const [standardSkillToDelete, setStandardSkillToDelete] = useState<
    CharacterDto["skills"][number] | null
  >(null);
  const [standardSkillPending, setStandardSkillPending] = useState(false);
  const standardSkillPendingRef = useRef(false);
  const [standardSkillError, setStandardSkillError] = useState("");
  const [statLayoutError, setStatLayoutError] = useState("");
  const runCharacterMutation = async (action: () => Promise<unknown>) => {
    setCharacterMutationError("");
    try {
      await action();
    } catch {
      setCharacterMutationError(
        "Не удалось сохранить изменения персонажа. Повторите попытку.",
      );
    }
  };
  /**
   * UIX-424, шаг 5 — правка раскладки.
   *
   * Раскладка уходит целиком: она общая на кампанию и меняется под её
   * ревизией, поэтому две одновременные правки должны разойтись конфликтом, а
   * не слиться. Ошибки не глушим — их показывает окно ввода, рядом с тем, что
   * не получилось.
   */
  const layout = snapshot.campaign.statLayout;
  const statLayoutPendingRef = useRef(false);
  const saveLayout = async (next: typeof layout) => {
    if (statLayoutPendingRef.current)
      throw new Error("Дождитесь сохранения предыдущей правки.");
    statLayoutPendingRef.current = true;
    try {
      await statLayoutActions.onUpdateStatLayout(
        next,
        snapshot.campaign.revision,
      );
    } finally {
      statLayoutPendingRef.current = false;
    }
  };

  const renameStatRow = (key: string, label: string) =>
    saveLayout(
      layout.map((group) => ({
        ...group,
        // Ключ не трогаем: на него ссылаются формулы навыков и способностей,
        // и переименование не должно их ломать. Меняется только подпись.
        rows: group.rows.map((row) =>
          row.key === key ? { ...row, label } : row,
        ),
      })),
    );

  const addStatRow = (groupId: string, label: string) => {
    const taken = layout.flatMap((group) => group.rows.map((row) => row.key));
    const key = uniqueStatKey(statKeyFromLabel(label), taken);
    // Из подписи вроде «—» или «2» ключ не получается: парсер формул не примет
    // ни пустое имя, ни начинающееся с цифры. Отказ здесь виден мастеру в том
    // же окне; молча записанная строка сломала бы первый же бросок по ней.
    if (!key)
      throw new Error(
        "Из этого названия не получается имя для формул. Добавьте в него буквы.",
      );
    return saveLayout(
      layout.map((group) =>
        group.id === groupId
          ? { ...group, rows: [...group.rows, { key, label, source: "STAT" }] }
          : group,
      ),
    );
  };

  /**
   * Значения удалённой строки в `characters.stats` не стираются: раскладка их
   * больше не показывает, но если на ключ ссылалась формула, мастеру нужно
   * видеть, что там было, когда он будет её чинить. Отказ при наличии ссылок
   * приходит с сервера вместе со списком — см. `StatLayoutCard`.
   */
  const deleteStatRow = (key: string) =>
    saveLayout(
      layout.map((group) => ({
        ...group,
        rows: group.rows.filter((row) => row.key !== key),
      })),
    );

  /**
   * Порядок строк — часть раскладки: в этом же порядке идут кнопки в панели
   * быстрых бросков. Ресурсы карточка не показывает, поэтому меняются местами
   * видимые соседи, а не соседи по массиву, — иначе нажатие выглядело бы как
   * «ничего не произошло».
   */
  const reorderStatRow = async (key: string, targetKey: string) => {
    const group = layout.find((candidate) =>
      candidate.rows.some((row) => row.key === key),
    );
    if (
      !group ||
      key === targetKey ||
      !group.rows.some((row) => row.key === targetKey)
    )
      return;
    const visible = group.rows.filter((row) => row.source !== "RESOURCE");
    const from = visible.findIndex((row) => row.key === key);
    const to = visible.findIndex((row) => row.key === targetKey);
    if (from < 0 || to < 0) return;
    visible.splice(to, 0, visible.splice(from, 1)[0]!);
    let cursor = 0;
    const next = layout.map((candidate) =>
      candidate.id === group.id
        ? {
            ...candidate,
            rows: candidate.rows.map((row) =>
              row.source === "RESOURCE" ? row : visible[cursor++]!,
            ),
          }
        : candidate,
    );
    setStatLayoutError("");
    try {
      await saveLayout(next);
    } catch (reason) {
      setStatLayoutError(
        formatApiError(reason, "Не удалось сохранить порядок строк."),
      );
    }
  };

  const moveStatRowBy = async (key: string, direction: "up" | "down") => {
    const next = moveStatRow(
      layout,
      key,
      direction,
      (row) => row.source !== "RESOURCE",
    );
    // Строка уже с краю — пустую правку не отправляем: она подняла бы ревизию
    // кампании и разошлась бы всем клиентам, ничего не изменив.
    if (!next) return;
    setStatLayoutError("");
    try {
      await saveLayout(next);
    } catch (reason) {
      /**
       * У стрелок, в отличие от переименования и удаления, нет своего окна, где
       * показать отказ. Без этой ветки конфликт ревизий (мастер в двух
       * вкладках) выглядел бы как «кнопка нажалась, порядок не изменился», и
       * ошибка ушла бы в необработанное отклонение промиса, то есть никуда.
       */
      setStatLayoutError(
        reason instanceof ApiError && reason.status === 409
          ? "Раскладка изменилась в другой сессии. Обновите страницу и повторите."
          : formatApiError(reason, "Не удалось изменить порядок строк"),
      );
    }
  };

  const changeStatValue = (target: CharacterDto, key: string, value: number) =>
    void runCharacterMutation(() =>
      onPatch(target.id, {
        stats: { [key]: value },
        revision: target.revision,
      }),
    );

  const [entryEditor, setEntryEditor] = useState<
    CharacterDto["entries"][number] | null
  >(null);
  // UIX-391: which catalog picker (if any) is open for this character sheet.
  const [catalogPicker, setCatalogPicker] = useState<
    "SKILL" | "ABILITY" | null
  >(null);
  const [renameOpen, setRenameOpen] = useState(false);
  const [portraitEditorOpen, setPortraitEditorOpen] = useState(false);
  const [portraitUpload, setPortraitUpload] = useState<File>();
  const [portraitUploadPending, setPortraitUploadPending] = useState(false);
  const portraitUploadPendingRef = useRef(false);
  const portraitUploadDescriptionId = useId();
  const backstoryDescriptionId = useId();
  const newResourceDescriptionId = useId();
  const [walletDraft, setWalletDraft] = useState(() =>
    normalizeWallet(character?.wallet ?? EMPTY_WALLET),
  );
  const walletDraftRef = useRef(walletDraft);
  const walletInputDirtyRef = useRef(false);
  const walletBatchRef = useRef<WalletBatch | undefined>(undefined);
  const walletMountedRef = useRef(true);
  const [resourcesDraft, setResourcesDraft] = useState<
    CharacterDto["resources"]
  >(() => ({ ...(character?.resources ?? {}) }));
  const [newResourceName, setNewResourceName] = useState("");
  const [editingResourceKey, setEditingResourceKey] = useState<string | null>(
    null,
  );
  useEffect(() => {
    if (character && countersPending === 0) {
      // A manual value can start by absorbing an unsent +/- batch. That
      // releases the batch reservation, but must not let this sync effect
      // overwrite the still-focused absolute draft with the old snapshot.
      if (!walletInputDirtyRef.current) {
        const nextWallet = normalizeWallet(character.wallet);
        walletDraftRef.current = nextWallet;
        setWalletDraft(nextWallet);
      }
      setResourcesDraft({ ...character.resources });
    }
  }, [character, countersPending]);
  useEffect(() => {
    walletMountedRef.current = true;
    return () => {
      // A visible click is already an accepted decision. Closing the sheet
      // before the pause expires flushes it into App's stable character queue.
      walletMountedRef.current = false;
      const batch = walletBatchRef.current;
      if (!batch) return;
      clearTimeout(batch.timer);
      batch.flush();
    };
  }, []);
  const editable =
    character &&
    (snapshot.me.role === "GM" ||
      character.ownerMembershipId === snapshot.me.id ||
      character.controllerMembershipIds.includes(snapshot.me.id));
  // Media gallery ACL (character-media.ts) only allows owner/GM to mutate,
  // not controllers — a narrower check than the general sheet `editable`,
  // so controllers don't see edit/reorder/detach buttons that 403 on click.
  const canEditMedia =
    character &&
    (snapshot.me.role === "GM" ||
      character.ownerMembershipId === snapshot.me.id);
  const portraitUploadEpochRef = useRef(0);
  useLayoutEffect(() => {
    portraitUploadPendingRef.current = false;
    setPortraitUploadPending(false);
    setPortraitEditorOpen(false);
  }, [snapshot.me.id, snapshot.me.role, character?.id, editable]);

  useLayoutEffect(() => {
    const epoch = portraitUploadEpochRef.current + 1;
    portraitUploadEpochRef.current = epoch;
    return () => {
      // An uploaded asset belongs to the exact actor, character, permission
      // and selected-file context that started it. Cleanup also invalidates a
      // pending result when the sheet unmounts.
      if (portraitUploadEpochRef.current === epoch) {
        portraitUploadEpochRef.current = epoch + 1;
      }
    };
  }, [
    snapshot.me.id,
    snapshot.me.role,
    character?.id,
    editable,
    portraitUpload,
  ]);
  // Хук обязан стоять до раннего выхода ниже: порядок вызовов не должен
  // зависеть от того, назначен ли персонаж. Пустая строка безопасна — без
  // персонажа поле не отрисовано, и класть значение некуда.
  const inventoryRef = useRemoteFieldValue<HTMLTextAreaElement>(
    character?.inventory.join("\n") ?? "",
  );
  if (!character)
    return (
      <Empty
        title="Нет персонажа"
        text="Мастер ещё не назначил вам персонажа."
      />
    );
  const editPermissionReason =
    "Редактирование доступно мастеру, владельцу листа и назначенным контроллерам.";
  const newResourceKey = newResourceName.trim();
  const newResourceReason = !editable
    ? "У вас нет права добавлять дополнительные ресурсы."
    : !newResourceKey
      ? "Введите название ресурса."
      : resourcesDraft[newResourceKey]
        ? `Ресурс «${newResourceKey}» уже существует.`
        : undefined;
  const submitCharacterRoll = async (
    formula: string,
    label: string,
    mode: RollMode = "NORMAL",
  ) => {
    setRollPending(true);
    setRollError("");
    try {
      await onRoll(formula, label, "PUBLIC", character.id, mode);
    } catch (reason) {
      setRollError(
        reason instanceof Error
          ? reason.message
          : "Не удалось выполнить бросок. Повторите попытку.",
      );
    } finally {
      setRollPending(false);
    }
  };
  const portrait = snapshot.assets.find(
    (asset) => asset.id === character.portraitAssetId,
  );
  // The catalog system (UIX-209) is the only mechanism that lets a GM add, edit
  // or remove a named skill/ability on a specific character — character.skills
  // and character.spells are legacy fixed arrays with no create/remove UI, kept
  // here read-only for backward compatibility with existing data.
  const skillEntries = character.entries.filter(
    (entry) => entry.kind === "SKILL",
  );
  const abilityEntries = character.entries.filter(
    (entry) => entry.kind === "ABILITY",
  );
  // UIX-391: exclude entries the character already has assigned so the "add
  // existing" picker can't offer — and silently create — a duplicate
  // assignment. See catalog-entry-selection.ts for the matching rule.
  const skillCatalogOptions = selectableCatalogEntries(
    snapshot.catalogEntries,
    character.entries,
    "SKILL",
  );
  const abilityCatalogOptions = selectableCatalogEntries(
    snapshot.catalogEntries,
    character.entries,
    "ABILITY",
  );
  const saveStandardSkill = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!editable || !editingStandardSkill || standardSkillPendingRef.current)
      return;
    const name = standardSkillDraft.name.trim();
    const rank = Number(standardSkillDraft.rank);
    const formula = standardSkillDraft.formula.trim();
    if (!name || name.length > 120) {
      setStandardSkillError("Название навыка должно содержать от 1 до 120 символов.");
      return;
    }
    if (!Number.isInteger(rank) || rank < 0) {
      setStandardSkillError("Ранг навыка должен быть целым неотрицательным числом.");
      return;
    }
    if (!formula || formula.length > 160) {
      setStandardSkillError("Формула броска должна содержать от 1 до 160 символов.");
      return;
    }
    standardSkillPendingRef.current = true;
    setStandardSkillPending(true);
    setStandardSkillError("");
    try {
      await onPatch(character.id, {
        skills: character.skills.map((skill) =>
          skill.key === editingStandardSkill.key
            ? { ...skill, name, rank, formula }
            : skill,
        ),
        revision: character.revision,
      });
      setEditingStandardSkill(null);
    } catch {
      setStandardSkillError("Не удалось сохранить навык. Повторите попытку.");
    } finally {
      standardSkillPendingRef.current = false;
      setStandardSkillPending(false);
    }
  };
  const deleteStandardSkill = async () => {
    if (!editable || !standardSkillToDelete || standardSkillPendingRef.current)
      return;
    standardSkillPendingRef.current = true;
    setStandardSkillPending(true);
    setStandardSkillError("");
    try {
      await onPatch(character.id, {
        skills: character.skills.filter(
          (skill) => skill.key !== standardSkillToDelete.key,
        ),
        revision: character.revision,
      });
      setStandardSkillToDelete(null);
    } catch {
      setStandardSkillError("Не удалось удалить навык. Повторите попытку.");
    } finally {
      standardSkillPendingRef.current = false;
      setStandardSkillPending(false);
    }
  };
  const submitWallet = async (
    nextWallet: CharacterDto["wallet"],
    intent: Parameters<typeof onUpdateCounters>[3],
    pendingReserved: boolean,
    conflictMessage: string,
    failureMessage: string,
  ) => {
    if (!pendingReserved && walletMountedRef.current)
      setCountersPending((current) => current + 1);
    if (walletMountedRef.current) setCountersError("");
    try {
      await onUpdateCounters(
        character.id,
        character.revision,
        { wallet: normalizeWallet(nextWallet) },
        intent,
      );
    } catch (reason) {
      if (!walletMountedRef.current) return;
      setCountersError(
        reason instanceof ApiError && reason.code === "CHARACTER_CONFLICT"
          ? conflictMessage
          : failureMessage,
      );
    } finally {
      if (walletMountedRef.current)
        setCountersPending((current) => Math.max(0, current - 1));
    }
  };

  const cancelWalletBatch = (restoreBase: boolean) => {
    const batch = walletBatchRef.current;
    if (!batch) return;
    clearTimeout(batch.timer);
    walletBatchRef.current = undefined;
    if (restoreBase) {
      walletDraftRef.current = batch.baseWallet;
      setWalletDraft(batch.baseWallet);
    }
    setCountersPending((current) => Math.max(0, current - 1));
  };

  const saveWallet = async (nextWallet: CharacterDto["wallet"]) => {
    nextWallet = normalizeWallet(nextWallet);
    if (!walletInputDirtyRef.current) return;
    const canonicalWallet = normalizeWallet(character.wallet);
    if (
      countersPending === 0 &&
      (Object.keys(nextWallet) as Array<keyof CharacterDto["wallet"]>).every(
        (key) => nextWallet[key] === canonicalWallet[key],
      )
    ) {
      walletInputDirtyRef.current = false;
      return;
    }
    walletInputDirtyRef.current = false;
    walletDraftRef.current = nextWallet;
    setWalletDraft(nextWallet);
    await submitWallet(
      nextWallet,
      undefined,
      false,
      "Кошелёк уже изменён в другой сессии. Значения обновлены — повторите действие.",
      "Не удалось сохранить кошелёк. Проверьте соединение и повторите действие.",
    );
  };
  const saveResources = async (next: CharacterDto["resources"]) => {
    setResourcesDraft(next);
    if (JSON.stringify(next) === JSON.stringify(character.resources))
      return true;
    setCountersPending((count) => count + 1);
    setCountersError("");
    try {
      await onUpdateCounters(
        character.id,
        character.revision,
        { resources: next },
        {
          resourceMapPatch: {
            base: character.resources,
            desired: next,
          },
        },
      );
      return true;
    } catch (reason) {
      setResourcesDraft(character.resources);
      setCountersError(
        reason instanceof ApiError && reason.code === "CHARACTER_CONFLICT"
          ? "Ресурсы изменены. Повторите действие."
          : "Не удалось сохранить ресурсы.",
      );
      return false;
    } finally {
      setCountersPending((count) => Math.max(0, count - 1));
    }
  };
  const runRest = async (rest: "SHORT" | "LONG") => {
    setCountersPending((count) => count + 1);
    setCountersError("");
    try {
      await onUpdateCounters(character.id, character.revision, { rest });
    } catch (reason) {
      setCountersError(
        reason instanceof ApiError && reason.code === "CHARACTER_CONFLICT"
          ? "Ресурсы изменены. Повторите отдых."
          : "Не удалось применить отдых.",
      );
    } finally {
      setCountersPending((count) => Math.max(0, count - 1));
    }
  };
  const changeWallet = (key: keyof CharacterDto["wallet"], delta: number) => {
    const current = normalizeWallet(walletDraftRef.current);
    const next =
      delta === -1
        ? spendWalletCoin(current, key)
        : changeWalletValue(current, key, delta);
    const nextValue = next[key];
    const appliedDelta = nextValue - current[key];
    if (
      Object.keys(current).every(
        (walletKey) =>
          next[walletKey as keyof Wallet] ===
          current[walletKey as keyof Wallet],
      )
    )
      return;
    walletDraftRef.current = next;
    setWalletDraft(next);
    setCountersError("");

    const running = walletBatchRef.current;
    if (running) clearTimeout(running.timer);
    // A denomination break changes two or three fields in one PATCH. Do not
    // replay its numeric delta after a conflict: that could mint coins if a
    // concurrent edit spent the higher coin first.
    const denominationBreak = Object.keys(current).some(
      (walletKey) =>
        walletKey !== key &&
        next[walletKey as keyof Wallet] !== current[walletKey as keyof Wallet],
    );
    const absolute =
      walletInputDirtyRef.current ||
      running?.delta === null ||
      denominationBreak;
    const combinedDelta = absolute
      ? null
      : mergeWalletDelta(running?.delta ?? {}, key, appliedDelta);
    walletInputDirtyRef.current = false;

    if (combinedDelta && walletDeltaIsEmpty(combinedDelta)) {
      // A relative +/- series that returns to its starting wallet is no action.
      cancelWalletBatch(true);
      return;
    }

    if (!running) setCountersPending((count) => count + 1);
    const flush = () => {
      if (walletBatchRef.current !== batch) return;
      walletBatchRef.current = undefined;
      void submitWallet(
        batch.wallet,
        batch.delta ? { walletDelta: batch.delta } : undefined,
        true,
        "Кошелёк изменён в другой сессии. Данные обновлены; повторите изменение, если оно всё ещё нужно.",
        "Не удалось сохранить кошелёк. Данные обновлены — проверьте соединение и повторите действие.",
      );
    };
    const batch: WalletBatch = {
      delta: combinedDelta,
      wallet: next,
      baseWallet: running?.baseWallet ?? current,
      flush,
      timer: setTimeout(flush, WALLET_ADJUST_DELAY_MS),
    };
    walletBatchRef.current = batch;
  };
  return (
    <section className="panel-section character-sheet-content">
      {characterMutationError && !portraitEditorOpen && (
        <p className="field-error" role="alert">
          {characterMutationError}
        </p>
      )}
      {statLayoutError && (
        <p className="field-error" role="alert">
          {statLayoutError}
        </p>
      )}
      {showCharacterPicker && snapshot.me.role === "GM" && (
        <label className="field character-sheet-picker">
          Персонаж
          <FormSelect
            value={selectedId}
            onChange={(event) => setSelectedId(event.target.value)}
          >
            {snapshot.characters.map((item) => (
              <option key={item.id} value={item.id}>
                {item.name}
              </option>
            ))}
          </FormSelect>
        </label>
      )}

      {/* Hero Header: выразительная шапка персонажа */}
      <header className="character-hero">
        <div className="character-hero__main">
          <button
            type="button"
            className="character-hero__avatar"
            disabled={!editable}
            aria-label={`Изменить портрет: ${character.name}`}
            title={editable ? "Изменить портрет" : editPermissionReason}
            onClick={() => setPortraitEditorOpen(true)}
          >
            {portrait ? (
              <img
                className="character-hero__avatar-img"
                src={portrait.url}
                alt={`Портрет ${character.name}`}
              />
            ) : (
              <div
                className="character-hero__avatar-placeholder"
                aria-hidden="true"
              >
                {character.name.slice(0, 1).toLocaleUpperCase()}
              </div>
            )}
          </button>
          <div className="character-hero__info">
            <div className="inline-fields">
              <strong className="character-hero__name">{character.name}</strong>
              <Button disabled={!editable} onClick={() => setRenameOpen(true)}>
                Переименовать
              </Button>
            </div>
          </div>
        </div>

        <div className="character-hero__actions">
          {rollError && (
            <p className="field-error" role="alert">
              {rollError}
            </p>
          )}
          {onArchive && (
            <Button
              className="danger-link"
              aria-label={`Архивировать персонажа ${character.name}`}
              title="Архивировать персонажа"
              onClick={onArchive}
            >
              <AppIcon icon={CharacterArchiveIcon} />
            </Button>
          )}
        </div>
        <details className="character-hero__backstory">
          <summary>Предыстория</summary>
          <FormTextArea
            aria-label="Предыстория"
            aria-describedby={!editable ? backstoryDescriptionId : undefined}
            defaultValue={character.backstory}
            disabled={!editable}
            rows={6}
            onBlur={(event) =>
              void runCharacterMutation(() =>
                onPatch(character.id, {
                  backstory: event.target.value,
                  revision: character.revision,
                }),
              )
            }
          />
          {!editable && (
            <p className="muted" id={backstoryDescriptionId}>
              {editPermissionReason}
            </p>
          )}
        </details>
      </header>

      {/* Vital Stats Bar: ключевые показатели прямо под шапкой */}
      <div
        className="character-vitals__tabs"
        role="tablist"
        aria-label="Ключевые показатели персонажа"
      >
        {(["stats", "inventory", "bio"] as const).map((tab) => (
          <button
            key={tab}
            type="button"
            role="tab"
            id={`${vitalsTabId}-${tab}-tab`}
            aria-controls={`${vitalsTabId}-${tab}-panel`}
            aria-selected={vitalsTab === tab}
            tabIndex={vitalsTab === tab ? 0 : -1}
            onClick={() => setVitalsTab(tab)}
            onKeyDown={(event) => {
              if (
                !["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)
              )
                return;
              event.preventDefault();
              const tabs = ["stats", "inventory", "bio"] as const;
              const current = tabs.indexOf(vitalsTab);
              const next =
                event.key === "Home"
                  ? tabs[0]
                  : event.key === "End"
                    ? tabs[2]
                    : (tabs[
                        (current + (event.key === "ArrowLeft" ? 2 : 1)) %
                          tabs.length
                      ] ?? tabs[0]);
              setVitalsTab(next);
              document.getElementById(`${vitalsTabId}-${next}-tab`)?.focus();
            }}
          >
            {
              {
                stats: "Показатели",
                inventory: "Инвентарь и ресурсы",
                bio: "Личность",
              }[tab]
            }
          </button>
        ))}
      </div>
      <div
        className="character-sheet-stat-panel"
        role="tabpanel"
        id={`${vitalsTabId}-stats-panel`}
        aria-labelledby={`${vitalsTabId}-stats-tab`}
        hidden={vitalsTab !== "stats"}
      >
        <div className="character-sheet-stat-grid">
          {/* Секция 1: Характеристики и боевые параметры */}
          <div
            className="character-section character-section--stats"
            data-character-section="stats"
          >
            <div className="character-card-row">
              <StatLayoutCard
                title="Характеристики"
                modifier="stats"
                rows={characteristicRows}
                values={character.stats}
                editable={Boolean(editable)}
                rollPending={rollPending}
                canEditLayout={snapshot.me.role === "GM"}
                onChangeValue={(key, value) =>
                  changeStatValue(character, key, value)
                }
                onRoll={(formula, label, mode) =>
                  void submitCharacterRoll(formula, label, mode)
                }
                onRenameRow={renameStatRow}
                onAddRow={(label) => addStatRow("characteristics", label)}
                onDeleteRow={deleteStatRow}
                onMoveRow={moveStatRowBy}
                onReorderRow={reorderStatRow}
              />
            </div>
          </div>
          <div
            className="character-section character-section--combat"
            data-character-section="combat"
          >
            <div className="character-card-row">
              <StatLayoutCard
                title="Боевые характеристики"
                modifier="combat"
                rows={[
                  ...initiativeRows,
                  ...combatRows.filter(
                    (row) =>
                      !isSystemRegenStatKey(row.key) &&
                      row.key !== "initiative" &&
                      row.key !== "reaction",
                  ),
                ]}
                values={character.stats}
                editable={Boolean(editable)}
                rollPending={rollPending}
                canEditLayout={snapshot.me.role === "GM"}
                onChangeValue={(key, value) =>
                  changeStatValue(character, key, value)
                }
                onRoll={(formula, label, mode) =>
                  void submitCharacterRoll(formula, label, mode)
                }
                onRenameRow={renameStatRow}
                onAddRow={(label) => addStatRow("combat", label)}
                onDeleteRow={deleteStatRow}
                onMoveRow={moveStatRowBy}
                onReorderRow={reorderStatRow}
              />
              <div className="character-card character-card--skills">
                <h3 className="character-card__header">Навыки</h3>
                {standardSkillError && (
                  <p className="field-error" role="alert">
                    {standardSkillError}
                  </p>
                )}
                <div className="character-card__body">
                  {character.skills.length > 0 &&
                    character.skills.map((skill) => (
                      <div className="character-card__row" key={skill.key}>
                        <RollButton
                          name={skill.name}
                          formula={skill.formula}
                          disabled={rollPending}
                          onClick={(event) =>
                            void submitCharacterRoll(
                              skill.formula,
                              skill.name,
                              rollModeFromEvent(event.nativeEvent),
                            )
                          }
                        />
                        {editable && (
                          <div className="inline-fields">
                            <Button
                              disabled={standardSkillPending}
                              aria-label={`Редактировать навык ${skill.name}`}
                              onClick={() => {
                                setStandardSkillError("");
                                setEditingStandardSkill(skill);
                                setStandardSkillDraft({
                                  name: skill.name,
                                  rank: String(skill.rank),
                                  formula: skill.formula,
                                });
                              }}
                            >
                              Редактировать
                            </Button>
                            <Button
                              className="danger-link"
                              disabled={standardSkillPending}
                              aria-label={`Удалить навык ${skill.name}`}
                              onClick={() => {
                                setStandardSkillError("");
                                setStandardSkillToDelete(skill);
                              }}
                            >
                              Удалить
                            </Button>
                          </div>
                        )}
                      </div>
                    ))}
                  {skillEntries.length ? (
                    skillEntries.map((entry) => (
                      <div className="character-card__row" key={entry.id}>
                        <CharacterActionCard
                          entry={entry}
                          disabled={!editable}
                          onAction={(input) =>
                            catalogActions.onRollEntry(character.id, entry.id, {
                              ...input,
                            })
                          }
                        />
                        {entry.data.uses && (
                          <Button
                            disabled={!editable}
                            onClick={() =>
                              catalogActions.onRechargeEntry(
                                character.id,
                                entry.id,
                                entry.revision,
                              )
                            }
                          >
                            Перезарядить
                          </Button>
                        )}
                        {editable && (
                          <div className="inline-fields">
                            <Button onClick={() => setEntryEditor(entry)}>
                              Редактировать
                            </Button>
                            <Button
                              className="danger-link"
                              onClick={() =>
                                void catalogActions.onDeleteCharacterEntry(
                                  character.id,
                                  entry.id,
                                  entry.revision,
                                )
                              }
                            >
                              Удалить
                            </Button>
                          </div>
                        )}
                      </div>
                    ))
                  ) : character.skills.length === 0 ? (
                    <p className="muted">Навыки ещё не добавлены.</p>
                  ) : null}
                </div>
                {editable && (
                  <div className="character-card__add">
                    <Button onClick={() => setCatalogPicker("SKILL")}>
                      + Добавить навык…
                    </Button>
                  </div>
                )}
              </div>
              <div className="character-card character-card--abilities">
                <h3 className="character-card__header">
                  Способности и заклинания
                </h3>
                <div className="character-card__body">
                  {character.spells.length > 0 &&
                    character.spells.map((spell) => (
                      <div className="plain-row" key={spell.key}>
                        <strong>{spell.name}</strong>
                        <p>{spell.description}</p>
                        {spell.formula && (
                          <Button
                            disabled={rollPending}
                            onClick={(event) =>
                              void submitCharacterRoll(
                                spell.formula!,
                                spell.name,
                                rollModeFromEvent(event.nativeEvent),
                              )
                            }
                          >
                            Бросить {humanizeFormula(spell.formula, statLabels)}
                          </Button>
                        )}
                      </div>
                    ))}
                  {abilityEntries.length ? (
                    abilityEntries.map((entry) => (
                      <div className="character-card__row" key={entry.id}>
                        <CharacterActionCard
                          entry={entry}
                          disabled={!editable}
                          onAction={(input) =>
                            catalogActions.onRollEntry(character.id, entry.id, {
                              ...input,
                            })
                          }
                        />
                        {entry.data.uses && (
                          <Button
                            disabled={!editable}
                            onClick={() =>
                              catalogActions.onRechargeEntry(
                                character.id,
                                entry.id,
                                entry.revision,
                              )
                            }
                          >
                            Перезарядить
                          </Button>
                        )}
                        {editable && (
                          <div className="inline-fields">
                            <Button onClick={() => setEntryEditor(entry)}>
                              Редактировать
                            </Button>
                            <Button
                              className="danger-link"
                              onClick={() =>
                                void catalogActions.onDeleteCharacterEntry(
                                  character.id,
                                  entry.id,
                                  entry.revision,
                                )
                              }
                            >
                              Удалить
                            </Button>
                          </div>
                        )}
                      </div>
                    ))
                  ) : character.spells.length === 0 ? (
                    <p className="muted">Способности ещё не добавлены.</p>
                  ) : null}
                </div>
                {editable && (
                  <div className="character-card__add">
                    <Button onClick={() => setCatalogPicker("ABILITY")}>
                      + Добавить способность…
                    </Button>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>

      {editable && catalogPicker && (
        <CatalogEntryPicker
          statLabels={statLabels}
          resourceLabels={resourceLabels}
          open
          kind={catalogPicker}
          options={
            catalogPicker === "SKILL"
              ? skillCatalogOptions
              : abilityCatalogOptions
          }
          onClose={() => setCatalogPicker(null)}
          onAssign={(catalogEntryId) =>
            catalogActions.onAssignCatalogEntry(character.id, catalogEntryId)
          }
          onCreate={(input) => catalogActions.onCreateCatalogEntry(input)}
        />
      )}

      {editingStandardSkill && (
        <ArkenDialog
          open
          footer={false}
          title={`Редактировать навык «${editingStandardSkill.name}»`}
          onClose={() => !standardSkillPending && setEditingStandardSkill(null)}
        >
          <form
            className="catalog-entry-form"
            aria-label="Редактирование стандартного навыка"
            onSubmit={(event) => void saveStandardSkill(event)}
          >
            <label>
              Название
              <FormInput
                value={standardSkillDraft.name}
                maxLength={120}
                required
                disabled={standardSkillPending}
                onChange={(event) =>
                  setStandardSkillDraft((draft) => ({
                    ...draft,
                    name: event.target.value,
                  }))
                }
              />
            </label>
            <label>
              Ранг
              <FormInput
                type="number"
                min={0}
                step={1}
                value={standardSkillDraft.rank}
                required
                disabled={standardSkillPending}
                onChange={(event) =>
                  setStandardSkillDraft((draft) => ({
                    ...draft,
                    rank: event.target.value,
                  }))
                }
              />
            </label>
            <label>
              Формула броска
              <FormInput
                value={standardSkillDraft.formula}
                maxLength={160}
                required
                disabled={standardSkillPending}
                onChange={(event) =>
                  setStandardSkillDraft((draft) => ({
                    ...draft,
                    formula: event.target.value,
                  }))
                }
              />
            </label>
            {standardSkillError && (
              <p className="field-error" role="alert">
                {standardSkillError}
              </p>
            )}
            <Button type="submit" disabled={standardSkillPending}>
              {standardSkillPending ? "Сохранение…" : "Сохранить навык"}
            </Button>
          </form>
        </ArkenDialog>
      )}

      {standardSkillToDelete && (
        <ArkenDialog
          open
          title="Удалить стандартный навык?"
          applyLabel={standardSkillPending ? "Удаление…" : "Удалить навык"}
          danger
          loading={standardSkillPending}
          onApply={() => void deleteStandardSkill()}
          onClose={() =>
            !standardSkillPending && setStandardSkillToDelete(null)
          }
        >
          <p>
            Навык «{standardSkillToDelete.name}» будет удалён с листа персонажа.
          </p>
          {standardSkillError && (
            <p className="field-error" role="alert">
              {standardSkillError}
            </p>
          )}
        </ArkenDialog>
      )}

      {entryEditor && (
        <ArkenDialog
          open
          footer={false}
          title={`Редактирование ${entryEditor.name}`}
          onClose={() => setEntryEditor(null)}
        >
          <CatalogEntryForm
            statLabels={statLabels}
            resourceLabels={resourceLabels}
            key={entryEditor.id}
            existing={entryEditor}
            onCancel={() => setEntryEditor(null)}
            onSubmit={async (input) => {
              await catalogActions.onUpdateCharacterEntry(
                character.id,
                entryEditor.id,
                {
                  ...input,
                  revision: entryEditor.revision,
                },
              );
              setEntryEditor(null);
            }}
          />
        </ArkenDialog>
      )}

      {/* Секция 2: Ресурсы и кошелёк */}
      <div
        className="character-vitals-panel"
        role="tabpanel"
        id={`${vitalsTabId}-inventory-panel`}
        aria-labelledby={`${vitalsTabId}-inventory-tab`}
        hidden={vitalsTab !== "inventory"}
      >
      <div className="character-vitals" aria-label="Ключевые показатели">
        <div className="character-vitals__actions">
          <Button
            view="outlined"
            disabled={!editable || countersPending > 0}
            title="Половина регена выносливости и маны, округление вниз"
            onClick={() => void runRest("SHORT")}
          >
            Короткий отдых
          </Button>
        </div>
        <div className="character-vital-chip character-vital-chip--wallet">
          <span className="character-vital-chip__label">Кошелёк</span>
          <span className="character-vital-chip__value character-vital-chip__wallet-values">
            <AppIcon icon={CoinsIcon} />
            {(["gold", "silver", "copper"] as const).map((key) => (
              <label className="character-wallet__coin" key={key}>
                <span className="character-wallet__coin-label">
                  {key === "gold"
                    ? "Золото"
                    : key === "silver"
                      ? "Серебро"
                      : "Медь"}
                </span>
                <span className="character-wallet__coin-controls">
                  <Button
                    disabled={
                      !editable || !canSpendWalletCoin(walletDraft, key)
                    }
                    aria-label={`Уменьшить: ${WALLET_LABELS[key]}`}
                    onPointerDown={(event) => event.preventDefault()}
                    onClick={() => changeWallet(key, -1)}
                  >
                    <AppIcon icon={DecreaseIcon} />
                  </Button>
                  <FormInput
                    type="number"
                    min={0}
                    step={1}
                    aria-label={`Кошелёк: ${WALLET_LABELS[key].toLowerCase()}`}
                    value={walletDraft[key]}
                    disabled={!editable}
                    onChange={(event) => {
                      cancelWalletBatch(false);
                      const next = {
                        ...walletDraftRef.current,
                        [key]: normalizeWalletValue(event.target.value),
                      };
                      walletDraftRef.current = next;
                      walletInputDirtyRef.current = true;
                      setWalletDraft(next);
                    }}
                    onBlur={() => void saveWallet(walletDraftRef.current)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") event.currentTarget.blur();
                    }}
                  />
                  <span>
                    {key === "gold" ? "зм" : key === "silver" ? "см" : "мм"}
                  </span>
                  <Button
                    disabled={!editable}
                    aria-label={`Увеличить: ${WALLET_LABELS[key]}`}
                    onPointerDown={(event) => event.preventDefault()}
                    onClick={() => changeWallet(key, 1)}
                  >
                    <AppIcon icon={AddIcon} />
                  </Button>
                </span>
              </label>
            ))}
          </span>
        </div>
        {resourceRows.map(({ key, label }) => {
          const res = resourcesDraft[key] ?? { current: 0, maximum: 0 };
          const max = res.maximum ?? res.current;
          const regenKey = RESOURCE_REGEN_STAT[key];
          const regenRow = combatRows.find((row) => row.key === regenKey);
          const regen = regenKey ? (character.stats[regenKey] ?? 0) : 0;
          const changeResource = (delta: number) => {
            const next = {
              ...resourcesDraft,
              [key]: { ...res, current: Math.max(0, res.current + delta) },
            };
            void saveResources(next);
          };
          return (
            <div
              className="character-vital-chip character-vital-chip--resource"
              key={key}
            >
              <span className="character-vital-chip__label">{label}</span>
              <span className="character-vital-chip__value character-vital-chip__resource-values">
                <label className="character-vital-chip__number-field">
                  <span>Текущее</span>
                  <FormInput
                    type="number"
                    min={0}
                    aria-label={`${label}: текущее`}
                    value={res.current}
                    disabled={!editable}
                    onChange={(event) =>
                      setResourcesDraft((current) => ({
                        ...current,
                        [key]: {
                          ...res,
                          current: Math.max(0, Number(event.target.value)),
                        },
                      }))
                    }
                    onBlur={() => void saveResources(resourcesDraft)}
                  />
                </label>
                <label className="character-vital-chip__number-field">
                  <span>Максимум</span>
                  <FormInput
                    type="number"
                    min={0}
                    aria-label={`${label}: максимум`}
                    value={max}
                    disabled={!editable}
                    onChange={(event) =>
                      setResourcesDraft((current) => ({
                        ...current,
                        [key]: {
                          ...res,
                          maximum: Math.max(0, Number(event.target.value)),
                          recoverable: true,
                        },
                      }))
                    }
                    onBlur={() => void saveResources(resourcesDraft)}
                  />
                </label>
              </span>
              <div className="character-vital-chip__controls">
                <Button
                  disabled={
                    !editable || countersPending > 0 || res.current <= 0
                  }
                  aria-label={`Уменьшить ${label}`}
                  onClick={() => changeResource(-1)}
                >
                  <AppIcon icon={DecreaseIcon} />
                </Button>
                <Button
                  disabled={!editable || countersPending > 0}
                  aria-label={`Увеличить ${label}`}
                  onClick={() => changeResource(1)}
                >
                  <AppIcon icon={AddIcon} />
                </Button>
                {regen > 0 && (
                  <Button
                    disabled={
                      !editable || countersPending > 0 || res.current >= max
                    }
                    aria-label={`Восстановить ${regen}: ${label}`}
                    title={`Восстановить на величину регена (${regen})`}
                    onClick={() =>
                      void saveResources({
                        ...resourcesDraft,
                        [key]: {
                          ...res,
                          current: Math.min(max, res.current + regen),
                        },
                      })
                    }
                  >
                    <AppIcon icon={AddIcon} /> {regen}
                  </Button>
                )}
              </div>
              {regenKey && regenRow && (
                <label className="character-vital-chip__regen">
                  <span>Реген</span>
                  <FormInput
                    type="number"
                    aria-label={regenRow.label}
                    min={0}
                    defaultValue={regen}
                    disabled={!editable}
                    onBlur={(event) =>
                      changeStatValue(
                        character,
                        regenKey,
                        Number(event.target.value),
                      )
                    }
                  />
                </label>
              )}
              <span className="character-vital-chip__track" aria-hidden="true">
                <span
                  style={{
                    width: `${max > 0 ? Math.min(100, (res.current / max) * 100) : 0}%`,
                  }}
                />
                {max > 0 && res.current > max && (
                  <span
                    className="character-vital-chip__excess"
                    style={{
                      width: `${Math.min(100, (((res.current - max) % max || max) / max) * 100)}%`,
                    }}
                  />
                )}
              </span>
            </div>
          );
        })}
      </div>

      <div
        className="character-section character-section--resources"
        data-character-section="resources"
      >
        <h3 className="character-block-heading">Дополнительные ресурсы</h3>
        <div className="subsection character-resource-editor">
          {Object.entries(resourcesDraft)
            .filter(([key]) => key !== "physicalPower" && key !== "magicPower")
            .map(([key, resource]) => (
              <fieldset
                className="resource-card"
                key={key}
                disabled={!editable}
              >
                <legend>
                  {editingResourceKey === key ? "Создание нового ресурса" : key}
                </legend>
                {editingResourceKey === key ? (
                  <div className="resource-card__extra-fields">
                    <label className="field">
                      <span>Название</span>
                      <FormInput
                        defaultValue={key}
                        required
                        onBlur={(event) => {
                          const nextKey = event.target.value.trim();
                          if (
                            !nextKey ||
                            nextKey === key ||
                            resourcesDraft[nextKey]
                          ) {
                            event.target.value = key;
                            return;
                          }
                          const { [key]: moved, ...rest } = resourcesDraft;
                          void saveResources({ ...rest, [nextKey]: moved! });
                        }}
                      />
                    </label>
                    <label className="field">
                      <span>Описание</span>
                      <FormInput
                        value={resource.description ?? ""}
                        onChange={(event) =>
                          setResourcesDraft((current) => ({
                            ...current,
                            [key]: {
                              ...resource,
                              description: event.target.value,
                            },
                          }))
                        }
                        onBlur={() => void saveResources(resourcesDraft)}
                      />
                    </label>
                    <div className="resource-card__inputs">
                      <Button
                        aria-label={`Уменьшить ${key}`}
                        disabled={
                          !editable ||
                          countersPending > 0 ||
                          resource.current <= 0
                        }
                        onClick={() =>
                          void saveResources({
                            ...resourcesDraft,
                            [key]: {
                              ...resource,
                              current: resource.current - 1,
                            },
                          })
                        }
                      >
                        <AppIcon icon={DecreaseIcon} />
                      </Button>
                      <label className="field">
                        <span>Текущее</span>
                        <FormInput
                          type="number"
                          min={0}
                          value={resource.current}
                          onChange={(event) =>
                            setResourcesDraft((current) => ({
                              ...current,
                              [key]: {
                                ...resource,
                                current: Math.max(
                                  0,
                                  Number(event.target.value),
                                ),
                              },
                            }))
                          }
                          onBlur={() => void saveResources(resourcesDraft)}
                        />
                      </label>
                      <label className="field">
                        <span>Максимум</span>
                        <FormInput
                          type="number"
                          min={0}
                          value={resource.maximum ?? resource.current}
                          onChange={(event) => {
                            const maximum = Math.max(
                              0,
                              Number(event.target.value),
                            );
                            setResourcesDraft((current) => ({
                              ...current,
                              [key]: {
                                ...resource,
                                maximum: maximum,
                                current: resource.current,
                              },
                            }));
                          }}
                          onBlur={() => void saveResources(resourcesDraft)}
                        />
                      </label>
                      <Button
                        aria-label={`Увеличить ${key}`}
                        disabled={!editable || countersPending > 0}
                        onClick={() =>
                          void saveResources({
                            ...resourcesDraft,
                            [key]: {
                              ...resource,
                              current: resource.current + 1,
                            },
                          })
                        }
                      >
                        <AppIcon icon={AddIcon} />
                      </Button>
                    </div>
                    <div className="field">
                      <span>Изображение</span>
                      <AssetPicker
                        aria-label={`Изображение ресурса ${key}`}
                        value={resource.imageAssetId ?? null}
                        onUpload={async (file) =>
                          (await assetActions.uploadAsset(file, "IMAGE")).id
                        }
                        assets={snapshot.assets.filter((asset) =>
                          asset.mimeType.startsWith("image/"),
                        )}
                        onChange={(assetId) => {
                          const next = {
                            ...resourcesDraft,
                            [key]: {
                              ...resource,
                              imageAssetId: assetId,
                            },
                          };
                          void saveResources(next);
                        }}
                      />
                    </div>
                    <label className="compact-check">
                      <input
                        type="checkbox"
                        checked={resource.recoverable !== false}
                        onChange={(event) =>
                          void saveResources({
                            ...resourcesDraft,
                            [key]: {
                              ...resource,
                              recoverable: event.target.checked,
                            },
                          })
                        }
                      />
                      Восполнять при отдыхе
                    </label>
                    <label className="field">
                      <span>Сколько восполнять за длинный отдых</span>
                      <FormInput
                        type="number"
                        min={0}
                        value={resource.restAmount ?? 0}
                        onChange={(event) =>
                          setResourcesDraft((current) => ({
                            ...current,
                            [key]: {
                              ...resource,
                              restAmount: Math.max(
                                0,
                                Number(event.target.value),
                              ),
                            },
                          }))
                        }
                      />
                    </label>
                    <Button
                      disabled={countersPending > 0}
                      onClick={async () => {
                        if (await saveResources(resourcesDraft))
                          setEditingResourceKey(null);
                      }}
                    >
                      Сохранить
                    </Button>
                    <Button
                      className="danger-link"
                      onClick={() => {
                        const { [key]: _removed, ...rest } = resourcesDraft;
                        void saveResources(rest);
                      }}
                    >
                      Удалить
                    </Button>
                  </div>
                ) : (
                  <div className="resource-card__summary">
                    <span className="resource-card__summary-value">
                      {resource.current} /{" "}
                      {resource.maximum ?? resource.current}
                    </span>
                    <Button
                      disabled={
                        !editable ||
                        resource.current <= 0 ||
                        countersPending > 0
                      }
                      aria-label={`Уменьшить ${key}`}
                      onClick={() =>
                        void saveResources({
                          ...resourcesDraft,
                          [key]: { ...resource, current: resource.current - 1 },
                        })
                      }
                    >
                      <AppIcon icon={DecreaseIcon} />
                    </Button>
                    <Button
                      disabled={!editable || countersPending > 0}
                      aria-label={`Увеличить ${key}`}
                      onClick={() =>
                        void saveResources({
                          ...resourcesDraft,
                          [key]: { ...resource, current: resource.current + 1 },
                        })
                      }
                    >
                      <AppIcon icon={AddIcon} />
                    </Button>
                    <div
                      className="resource-bar"
                      role="progressbar"
                      aria-label={`Уровень: ${key}`}
                      aria-valuenow={resource.current}
                      aria-valuemin={0}
                      aria-valuemax={Math.max(
                        resource.maximum ?? resource.current,
                        resource.current,
                      )}
                    >
                      <div
                        className="resource-bar__fill resource-bar__fill--default"
                        style={{
                          width: `${Math.min(100, (resource.current / Math.max(1, resource.maximum ?? resource.current)) * 100)}%`,
                        }}
                      />
                    </div>
                    <Button
                      disabled={
                        !editable ||
                        countersPending > 0 ||
                        resource.recoverable === false ||
                        (resource.restAmount ?? 0) <= 0 ||
                        resource.current >=
                          (resource.maximum ?? resource.current)
                      }
                      aria-label={`Восстановить ${resource.restAmount ?? 0}: ${key}`}
                      onClick={() =>
                        void saveResources({
                          ...resourcesDraft,
                          [key]: {
                            ...resource,
                            current: Math.min(
                              resource.maximum ?? resource.current,
                              resource.current + (resource.restAmount ?? 0),
                            ),
                          },
                        })
                      }
                    >
                      <AppIcon icon={AddIcon} /> {resource.restAmount ?? 0}
                    </Button>
                    <Button
                      disabled={!editable}
                      onClick={() => setEditingResourceKey(key)}
                    >
                      Настроить
                    </Button>
                  </div>
                )}
              </fieldset>
            ))}
          <div className="inline-fields">
            <FormInput
              aria-label="Название нового ресурса"
              aria-invalid={
                editable && newResourceKey && resourcesDraft[newResourceKey]
                  ? true
                  : undefined
              }
              aria-describedby={
                newResourceReason ? newResourceDescriptionId : undefined
              }
              value={newResourceName}
              placeholder="Новый ресурс"
              onChange={(event) => setNewResourceName(event.target.value)}
            />
            <Button
              aria-describedby={
                newResourceReason ? newResourceDescriptionId : undefined
              }
              disabled={
                !editable ||
                !newResourceName.trim() ||
                Boolean(resourcesDraft[newResourceName.trim()])
              }
              onClick={() => {
                const key = newResourceName.trim();
                if (!key) return;
                setNewResourceName("");
                setEditingResourceKey(key);
                void saveResources({
                  ...resourcesDraft,
                  [key]: { current: 0, maximum: 0, recoverable: true },
                });
              }}
            >
              Добавить
            </Button>
          </div>
          {newResourceReason && (
            <p className="muted" id={newResourceDescriptionId}>
              {newResourceReason}
            </p>
          )}
        </div>

        {countersPending > 0 && <span className="muted">Сохраняем…</span>}
        {countersError && (
          <span className="field-error" role="alert">
            {countersError}
          </span>
        )}
      </div>

      {/* Секция 3: Инвентарь и снаряжение */}
      <div
        className="character-section character-section--inventory"
        data-character-section="inventory"
      >
        <h3 className="character-block-heading">Инвентарь и снаряжение</h3>
        <label className="field">
          Инвентарь (один предмет на строку)
          <FormTextArea
            controlRef={inventoryRef}
            defaultValue={character.inventory.join("\n")}
            disabled={!editable}
            rows={5}
            onBlur={(event) =>
              void runCharacterMutation(() =>
                onPatch(character.id, {
                  inventory: event.target.value
                    .split("\n")
                    .map((item) => item.trim())
                    .filter(Boolean),
                  revision: character.revision,
                }),
              )
            }
          />
        </label>
        <h3 className="character-block-heading">Заметки</h3>
        <label className="field">
          Заметки
          <FormTextArea
            defaultValue={character.notes}
            disabled={!editable}
            rows={6}
            onBlur={(event) =>
              onPatch(character.id, {
                notes: event.target.value,
                revision: character.revision,
              })
            }
          />
        </label>
      </div>
      </div>

      {/* Секция 4: Личность, медиа и доступ */}
      <div
        className="character-section character-section--bio"
        data-character-section="bio"
        role="tabpanel"
        id={`${vitalsTabId}-bio-panel`}
        aria-labelledby={`${vitalsTabId}-bio-tab`}
        hidden={vitalsTab !== "bio"}
      >
        {vitalsTab === "bio" && (
          <CharacterSpellBranches
            key={character.id}
            character={character}
            isGm={snapshot.me.role === "GM"}
          />
        )}
        {snapshot.me.role === "GM" && (
          <CharacterControllerAccess
            character={character}
            members={snapshot.members}
            onSave={onReplaceControllers}
          />
        )}
        <ArkenDialog
          open={portraitEditorOpen}
          title={`Портрет: ${character.name}`}
          footer={false}
          onClose={() => setPortraitEditorOpen(false)}
        >
          <div className="character-portrait-manager">
            {characterMutationError && (
              <p className="field-error" role="alert">
                {characterMutationError}
              </p>
            )}
            <div className="field">
              <span>Портрет</span>
              <AssetPicker
                aria-label="Портрет персонажа"
                value={character.portraitAssetId ?? null}
                noneLabel="Без портрета"
                disabled={!editable}
                assets={snapshot.assets.filter(
                  (asset) => asset.kind === "PORTRAIT",
                )}
                onChange={(assetId) => {
                  if (!editable) return;
                  void runCharacterMutation(() =>
                    onPatch(character.id, {
                      portraitAssetId: assetId,
                      revision: character.revision,
                    }),
                  );
                }}
              />
            </div>
            <ImageUploadField
              label="Загрузить портрет для персонажа"
              value={portraitUpload}
              disabled={!editable || portraitUploadPending}
              onUpdate={(file) => {
                if (!editable || portraitUploadPendingRef.current) return;
                setPortraitUpload(file);
              }}
            />
            <p id={portraitUploadDescriptionId} className="muted" role="status">
              {portraitUploadPending
                ? "Загружаем и назначаем портрет…"
                : !editable
                  ? "Портрет доступен только для чтения."
                  : portraitUpload
                    ? "Файл выбран. Загрузите его, чтобы назначить портрет."
                    : "Сначала выберите изображение портрета."}
            </p>
            <Button
              disabled={!editable || !portraitUpload || portraitUploadPending}
              aria-describedby={portraitUploadDescriptionId}
              aria-busy={portraitUploadPending}
              onClick={() => {
                if (
                  !editable ||
                  !portraitUpload ||
                  portraitUploadPendingRef.current
                )
                  return;
                const uploadEpoch = portraitUploadEpochRef.current;
                const file = portraitUpload;
                const targetId = character.id;
                const targetRevision = character.revision;
                portraitUploadPendingRef.current = true;
                setPortraitUploadPending(true);
                void runCharacterMutation(async () => {
                  const asset = await assetActions.uploadAsset(
                    file,
                    "PORTRAIT",
                  );
                  if (portraitUploadEpochRef.current !== uploadEpoch) return;
                  await onPatch(targetId, {
                    portraitAssetId: asset.id,
                    revision: targetRevision,
                  });
                  if (portraitUploadEpochRef.current === uploadEpoch) {
                    portraitUploadPendingRef.current = false;
                    setPortraitUploadPending(false);
                    setPortraitUpload(undefined);
                  }
                }).finally(() => {
                  if (portraitUploadEpochRef.current === uploadEpoch) {
                    portraitUploadPendingRef.current = false;
                    setPortraitUploadPending(false);
                  }
                });
              }}
            >
              {portraitUploadPending ? "Загрузка…" : "Загрузить и назначить"}
            </Button>
          </div>
        </ArkenDialog>
        <h3 className="character-block-heading">Галерея</h3>
        <CharacterMediaGallery
          characterId={character.id}
          assets={snapshot.assets}
          characterName={character.name}
          editable={Boolean(canEditMedia)}
          isGm={snapshot.me.role === "GM"}
          onUpload={assetActions.uploadAsset}
        />
      </div>

      <TextPromptDialog
        open={renameOpen}
        title="Переименовать персонажа"
        label="Имя персонажа"
        initialValue={character.name}
        onClose={() => setRenameOpen(false)}
        onApply={async (name) => {
          if (!editable) return;
          await onPatch(character.id, {
            name,
            revision: character.revision,
          });
          setRenameOpen(false);
        }}
      />
    </section>
  );
}

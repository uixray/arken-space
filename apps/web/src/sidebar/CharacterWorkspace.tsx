import { useEffect, useMemo, useReducer, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { CharacterDto, GameSnapshot } from "@arken/contracts";
import { arkenSystem } from "@arken/system";
import { Button } from "@gravity-ui/uikit";
import { CatalogEntryForm } from "../CatalogEntryForm";
import { ApiError } from "../api";
import { TextPromptDialog } from "../ui/TextPromptDialog";
import { ArkenDialog } from "../ui/ArkenDialog";
import { isEditableEventTarget } from "../input-diagnostics";
import { ImageUploadField } from "../ui/ImageUploadField";
import { FormInput, FormSelect, FormTextArea } from "../ui/GravityFormControls";
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
import { CharacterActionCard } from "../SkillCards";
import { RollModeControl, type RollMode } from "../RollModeControl";
import {
  changeWalletValue,
  EMPTY_WALLET,
  normalizeWallet,
  normalizeWalletValue,
} from "../wallet";
import type { Props } from "../Sidebar";
import { Empty } from "./MediaPanel";

export function CharacterWorkspace({
  onClose,
  ...props
}: Props & { onClose: () => void }) {
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
  const [railCollapsed, setRailCollapsed] = useState(false);

  useEffect(() => titleRef.current?.focus(), []);
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
    if (!state.activeId) return;
    workspaceRef.current
      ?.querySelector<HTMLElement>(
        `[data-character-sheet-id="${CSS.escape(state.activeId)}"]`,
      )
      ?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [state.activeId]);
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.isComposing || isEditableEventTarget(event.target)) return;
      if (event.key !== "Escape") return;
      if ((event.target as Element | null)?.closest('[role="dialog"]')) return;
      onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  const openCount = state.openIds.length;
  return createPortal(
    <main
      ref={workspaceRef}
      className={`character-workspace${props.collapsed ? " is-sidebar-collapsed" : ""}`}
      aria-labelledby="character-workspace-title"
    >
      <header className="character-workspace__header">
        <div>
          <span className="eyebrow">Рабочее пространство</span>
          <h2 ref={titleRef} id="character-workspace-title" tabIndex={-1}>
            Персонажи
          </h2>
        </div>
        <p className="muted">
          Открыто {openCount}/{MAX_OPEN_CHARACTER_SHEETS}
        </p>
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
          <span aria-hidden="true">{railCollapsed ? ">" : "<"}</span>
        </button>
        <button
          type="button"
          aria-label="Закрыть персонажей"
          title="Закрыть рабочее пространство персонажей"
          onClick={onClose}
        >
          <span aria-hidden="true">×</span>
        </button>
      </header>
      <div
        className={`character-workspace__body${railCollapsed ? " is-rail-collapsed" : ""}`}
      >
        <nav className="character-rail" aria-label="Персонажи кампании">
          {props.snapshot.me.role === "GM" && (
            <button
              type="button"
              className="character-rail__create"
              onClick={() => setCreateCharacterOpen(true)}
            >
              <span aria-hidden="true">＋</span>
              Создать персонажа
            </button>
          )}
          {characters.length === 0 ? (
            <p className="muted">Нет доступных персонажей.</p>
          ) : (
            characters.map((character) => {
              const isOpen = state.openIds.includes(character.id);
              const isCollapsed = state.collapsedIds.includes(character.id);
              const full = !isOpen && openCount >= MAX_OPEN_CHARACTER_SHEETS;
              return (
                <div className="character-rail__item" key={character.id}>
                  <button
                    type="button"
                    className={
                      state.activeId === character.id ? "is-active" : undefined
                    }
                    aria-pressed={state.activeId === character.id}
                    disabled={full}
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
                      {isCollapsed ? "свернут" : isOpen ? "открыт" : ""}
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
                      ×
                    </button>
                  )}
                </div>
              );
            })
          )}
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
              const collapsed = state.collapsedIds.includes(id);
              return (
                <article
                  className={`character-sheet-card${
                    state.activeId === id ? " is-active" : ""
                  }${collapsed ? " is-collapsed" : ""}`}
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
                      aria-label={`${collapsed ? "Развернуть" : "Свернуть"} лист ${character.name}`}
                      onClick={() =>
                        dispatch({
                          type: collapsed ? "RESTORE" : "COLLAPSE",
                          id,
                        })
                      }
                    >
                      {collapsed ? "Развернуть" : "Свернуть"}
                    </button>
                    <button
                      type="button"
                      aria-label={`Закрыть лист ${character.name}`}
                      onClick={() => dispatch({ type: "CLOSE", id })}
                    >
                      Закрыть
                    </button>
                  </header>
                  <div
                    className="character-sheet-card__body"
                    hidden={collapsed}
                    aria-hidden={collapsed}
                  >
                    <CharacterPanel
                      snapshot={props.snapshot}
                      character={character}
                      selectedId={id}
                      setSelectedId={(nextId) =>
                        dispatch({ type: "OPEN", id: nextId })
                      }
                      showCharacterPicker={false}
                      onPatch={props.onPatchCharacter}
                      onReplaceControllers={props.onReplaceCharacterControllers}
                      onRoll={props.onRoll}
                      onAssignEntry={props.onAssignCatalogEntry}
                      onUpdateEntry={props.onUpdateCharacterEntry}
                      onDeleteEntry={props.onDeleteCharacterEntry}
                      onRollEntry={props.onRollEntry}
                      onRechargeEntry={props.onRechargeEntry}
                      onUpdateCounters={props.onUpdateCounters}
                      onCampaignClock={props.onCampaignClock}
                      onUpload={props.onUpload}
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
          await props.onCreateCharacter(name, template);
          setCreateCharacterOpen(false);
        }}
        onClose={() => setCreateCharacterOpen(false)}
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
      <label className="field">
        Имя персонажа
        <FormInput
          autoFocus
          value={name}
          onChange={(event) => setName(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && name.trim()) void submit();
          }}
        />
      </label>
      <label className="field">
        Шаблон (необязательно)
        <FormSelect
          value={templateId}
          onChange={(event) => setTemplateId(event.target.value)}
        >
          <option value="">Без шаблона (пустой лист)</option>
          {characters.map((character) => (
            <option key={character.id} value={character.id}>
              На основе «{character.name}»
            </option>
          ))}
        </FormSelect>
        <span className="muted">
          Копируются характеристики, навыки, заклинания, инвентарь и ресурсы.
          Имя, портрет, владелец и кошелёк не переносятся — новый персонаж
          полностью независим и остаётся редактируемым.
        </span>
      </label>
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
  onSave: Props["onReplaceCharacterControllers"];
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
  const [error, setError] = useState("");
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
      <Button
        disabled={!dirty || pending}
        onClick={() => {
          setPending(true);
          setError("");
          void onSave(character.id, character.revision, draft)
            .catch(() =>
              setError(
                "Не удалось сохранить доступ. Данные обновлены — проверьте список и повторите попытку.",
              ),
            )
            .finally(() => setPending(false));
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
  onAssignEntry,
  onUpdateEntry,
  onDeleteEntry,
  onRollEntry,
  onRechargeEntry,
  onUpdateCounters,
  onCampaignClock,
  onUpload,
}: {
  snapshot: GameSnapshot;
  character: CharacterDto | undefined;
  selectedId: string;
  setSelectedId: (value: string) => void;
  showCharacterPicker?: boolean;
  onPatch: Props["onPatchCharacter"];
  onReplaceControllers: Props["onReplaceCharacterControllers"];
  onRoll: Props["onRoll"];
  onAssignEntry: Props["onAssignCatalogEntry"];
  onUpdateEntry: Props["onUpdateCharacterEntry"];
  onDeleteEntry: Props["onDeleteCharacterEntry"];
  onRollEntry: Props["onRollEntry"];
  onRechargeEntry: Props["onRechargeEntry"];
  onUpdateCounters: Props["onUpdateCounters"];
  onCampaignClock: Props["onCampaignClock"];
  onUpload: Props["onUpload"];
}) {
  const [countersPending, setCountersPending] = useState(0);
  const [countersError, setCountersError] = useState("");
  // Undefined preserves each catalog action's legacy advantage setting until the player explicitly overrides it.
  const [rollMode, setRollMode] = useState<RollMode>();
  const [rollPending, setRollPending] = useState(false);
  const [rollError, setRollError] = useState("");
  const [characterMutationError, setCharacterMutationError] = useState("");
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
  const [entryEditor, setEntryEditor] = useState<
    CharacterDto["entries"][number] | null
  >(null);
  const [renameOpen, setRenameOpen] = useState(false);
  const [portraitUpload, setPortraitUpload] = useState<File>();
  const [walletDraft, setWalletDraft] = useState(() =>
    normalizeWallet(character?.wallet ?? EMPTY_WALLET),
  );
  const walletDraftRef = useRef(walletDraft);
  const walletInputDirtyRef = useRef(false);
  const [resourcesDraft, setResourcesDraft] = useState<
    CharacterDto["resources"]
  >(() => ({ ...(character?.resources ?? {}) }));
  const [newResourceName, setNewResourceName] = useState("");
  useEffect(() => {
    if (character && countersPending === 0) {
      const nextWallet = normalizeWallet(character.wallet);
      walletDraftRef.current = nextWallet;
      walletInputDirtyRef.current = false;
      setWalletDraft(nextWallet);
      setResourcesDraft({ ...character.resources });
    }
  }, [character, countersPending]);
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
  if (!character)
    return (
      <Empty
        title="Нет персонажа"
        text="Мастер ещё не назначил вам персонажа."
      />
    );
  const submitCharacterRoll = async (formula: string, label: string) => {
    setRollPending(true);
    setRollError("");
    try {
      await onRoll(formula, label, "PUBLIC", character.id, rollMode);
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
  const saveWallet = async (nextWallet: CharacterDto["wallet"]) => {
    nextWallet = normalizeWallet(nextWallet);
    if (!walletInputDirtyRef.current) return;
    const canonicalWallet = normalizeWallet(character.wallet);
    if (
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
    setCountersPending((current) => current + 1);
    setCountersError("");
    try {
      await onUpdateCounters(character.id, character.revision, {
        wallet: nextWallet,
      });
    } catch (reason) {
      setCountersError(
        reason instanceof ApiError && reason.code === "CHARACTER_CONFLICT"
          ? "Кошелёк уже изменён в другой сессии. Значения обновлены — повторите действие."
          : "Не удалось сохранить кошелёк. Проверьте соединение и повторите действие.",
      );
    } finally {
      setCountersPending((current) => Math.max(0, current - 1));
    }
  };
  const saveResources = async (next: CharacterDto["resources"]) => {
    setResourcesDraft(next);
    if (JSON.stringify(next) === JSON.stringify(character.resources)) return;
    setCountersPending((count) => count + 1);
    setCountersError("");
    try {
      await onUpdateCounters(character.id, character.revision, {
        resources: next,
      });
    } catch (reason) {
      setCountersError(
        reason instanceof ApiError && reason.code === "CHARACTER_CONFLICT"
          ? "Ресурсы изменены. Повторите действие."
          : "Не удалось сохранить ресурсы.",
      );
    } finally {
      setCountersPending((count) => Math.max(0, count - 1));
    }
  };
  const runRest = async (rest: "SHORT" | "LONG" | "CATCH_BREATH") => {
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
    const next = changeWalletValue(current, key, delta);
    const nextValue = next[key];
    const appliedDelta = nextValue - current[key];
    if (appliedDelta === 0) return;
    walletDraftRef.current = next;
    setWalletDraft(next);
    setCountersPending((count) => count + 1);
    setCountersError("");
    const intent = walletInputDirtyRef.current
      ? undefined
      : { walletDelta: { key, delta: appliedDelta } };
    walletInputDirtyRef.current = false;
    void onUpdateCounters(
      character.id,
      character.revision,
      { wallet: next },
      intent,
    )
      .catch((reason) => {
        setCountersError(
          reason instanceof ApiError && reason.code === "CHARACTER_CONFLICT"
            ? "Кошелёк изменён в другой сессии. Данные обновлены; повторите изменение, если оно всё ещё нужно."
            : "Не удалось сохранить кошелёк. Данные обновлены — проверьте соединение и повторите действие.",
        );
      })
      .finally(() => setCountersPending((count) => Math.max(0, count - 1)));
  };
  return (
    <section className="panel-section">
      {characterMutationError && (
        <p className="field-error" role="alert">
          {characterMutationError}
        </p>
      )}
      {showCharacterPicker && snapshot.me.role === "GM" && (
        <label className="field">
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
      <h3 className="character-block-heading">Личность и портрет</h3>
      <div className="section-heading">
        <div>
          <span className="eyebrow">Карточка</span>
          <h2>{character.name}</h2>
        </div>
        <div className="inline-fields">
          <Button onClick={() => setRenameOpen(true)}>Переименовать</Button>
          <span className="revision">rev {character.revision}</span>
        </div>
      </div>
      {snapshot.me.role === "GM" && (
        <CharacterControllerAccess
          character={character}
          members={snapshot.members}
          onSave={onReplaceControllers}
        />
      )}
      {portrait && (
        <img
          className="character-portrait"
          src={portrait.url}
          alt={`Портрет ${character.name}`}
        />
      )}
      <label className="field">
        Портрет
        <FormSelect
          value={character.portraitAssetId ?? ""}
          onChange={(event) =>
            void runCharacterMutation(() =>
              onPatch(character.id, {
                portraitAssetId: event.target.value || null,
                revision: character.revision,
              }),
            )
          }
        >
          <option value="">Без портрета</option>
          {snapshot.assets
            .filter((asset) => asset.kind === "PORTRAIT")
            .map((asset) => (
              <option key={asset.id} value={asset.id}>
                {asset.name}
              </option>
            ))}
        </FormSelect>
      </label>
      <ImageUploadField
        label="Загрузить портрет для персонажа"
        value={portraitUpload}
        onUpdate={setPortraitUpload}
      />
      <Button
        disabled={!portraitUpload}
        onClick={() =>
          void runCharacterMutation(async () => {
            if (!portraitUpload) return;
            const asset = await onUpload(portraitUpload, "PORTRAIT");
            await onPatch(character.id, {
              portraitAssetId: asset.id,
              revision: character.revision,
            });
            setPortraitUpload(undefined);
          })
        }
      >
        Загрузить и назначить
      </Button>
      <h3 className="character-block-heading">Галерея</h3>
      <CharacterMediaGallery
        characterId={character.id}
        characterName={character.name}
        editable={Boolean(canEditMedia)}
        isGm={snapshot.me.role === "GM"}
        onUpload={onUpload}
      />
      {snapshot.me.role === "GM" && (
        <div className="subsection">
          <h3>Время кампании</h3>
          <p>
            День {snapshot.campaign.day} ·{" "}
            {snapshot.campaign.battleActive
              ? `бой #${snapshot.campaign.battleCounter}`
              : "вне боя"}
          </p>
          <Button
            onClick={() =>
              onCampaignClock("LONG_REST", snapshot.campaign.revision)
            }
          >
            Длинный отдых
          </Button>
          <Button
            onClick={() =>
              onCampaignClock(
                snapshot.campaign.battleActive ? "END_BATTLE" : "START_BATTLE",
                snapshot.campaign.revision,
              )
            }
          >
            {snapshot.campaign.battleActive ? "Завершить бой" : "Начать бой"}
          </Button>
        </div>
      )}
      <details className="subsection">
        <summary>Предыстория</summary>
        <FormTextArea
          defaultValue={character.backstory}
          disabled={!editable}
          rows={8}
          onBlur={(event) =>
            void runCharacterMutation(() =>
              onPatch(character.id, {
                backstory: event.target.value,
                revision: character.revision,
              }),
            )
          }
        />
      </details>
      <h3 className="character-block-heading">Основные характеристики</h3>
      <div className="subsection character-roll-controls">
        <RollModeControl
          value={rollMode}
          onChange={setRollMode}
          disabled={rollPending}
          label={"Режим броска"}
        />
        {rollError && (
          <p className="field-error" role="alert">
            {rollError}
          </p>
        )}
      </div>
      <div className="stats-grid">
        {arkenSystem.stats
          .filter(
            (stat) => stat.key !== "reaction" && stat.key !== "magicPower",
          )
          .map((stat) => (
            <label key={stat.key} className="stat-field">
              <span>{stat.label}</span>
              <FormInput
                key={`${character.id}-${stat.key}-${character.revision}`}
                type="number"
                defaultValue={character.stats[stat.key] ?? stat.defaultValue}
                disabled={!editable}
                min={stat.min}
                max={stat.max}
                onBlur={(event) =>
                  void runCharacterMutation(() =>
                    onPatch(character.id, {
                      stats: { [stat.key]: Number(event.target.value) },
                      revision: character.revision,
                    }),
                  )
                }
              />
              <Button
                disabled={!editable || rollPending}
                onClick={() =>
                  void submitCharacterRoll(`1d20 + ${stat.key}`, stat.label)
                }
              >
                Бросок
              </Button>
            </label>
          ))}
      </div>
      <h3 className="character-block-heading">{"Особые характеристики"}</h3>
      <div className="stats-grid">
        {arkenSystem.stats
          .filter((stat) => stat.key === "magicPower")
          .map((stat) => (
            <label key={stat.key} className="stat-field">
              <span>{stat.label}</span>
              <FormInput
                key={`${character.id}-${stat.key}-${character.revision}`}
                type="number"
                defaultValue={character.stats[stat.key] ?? stat.defaultValue}
                disabled={!editable}
                min={stat.min}
                max={stat.max}
                onBlur={(event) =>
                  void runCharacterMutation(() =>
                    onPatch(character.id, {
                      stats: { [stat.key]: Number(event.target.value) },
                      revision: character.revision,
                    }),
                  )
                }
              />
              <Button
                disabled={!editable || rollPending}
                onClick={() =>
                  void submitCharacterRoll(`1d20 + ${stat.key}`, stat.label)
                }
              >
                {"Бросок"}
              </Button>
            </label>
          ))}
      </div>
      <h3 className="character-block-heading">Боевые характеристики</h3>
      <div className="inline-fields">
        <Button
          disabled={!editable || rollPending}
          onClick={() =>
            void submitCharacterRoll("1d20 + agility", "Инициатива")
          }
        >
          Инициатива (d20 + Ловкость)
        </Button>
        <Button
          disabled={!editable || rollPending}
          onClick={() => void submitCharacterRoll("1d20 + reaction", "Бросок?")}
        >
          {"Бросок? (d20 + Бросок?)"}
        </Button>
      </div>
      <div className="subsection">
        <h3>Дополнительные навыки</h3>
        {character.skills.length ? (
          character.skills.map((skill) => (
            <Button
              className="action-row"
              key={skill.key}
              disabled={rollPending}
              onClick={() =>
                void submitCharacterRoll(skill.formula, skill.name)
              }
            >
              <span>{skill.name}</span>
              <code>{skill.formula}</code>
            </Button>
          ))
        ) : (
          <p className="muted">Навыки ещё не добавлены.</p>
        )}
      </div>
      <div className="subsection">
        <h3>Способности и заклинания</h3>
        {character.spells.length ? (
          character.spells.map((spell) => (
            <div className="plain-row" key={spell.key}>
              <strong>{spell.name}</strong>
              <p>{spell.description}</p>
              {spell.formula && (
                <Button
                  disabled={rollPending}
                  onClick={() =>
                    void submitCharacterRoll(spell.formula!, spell.name)
                  }
                >
                  Бросить {spell.formula}
                </Button>
              )}
            </div>
          ))
        ) : (
          <p className="muted">Заклинания ещё не добавлены.</p>
        )}
      </div>
      <div className="subsection">
        <h3>Каталог персонажа</h3>
        {snapshot.me.role === "GM" && snapshot.catalogEntries.length > 0 && (
          <FormSelect
            defaultValue=""
            onChange={(event) => {
              if (event.target.value)
                void runCharacterMutation(() =>
                  onAssignEntry(character.id, event.target.value),
                );
              event.target.value = "";
            }}
          >
            <option value="">Назначить из общего каталога…</option>
            {snapshot.catalogEntries.map((entry) => (
              <option key={entry.id} value={entry.id}>
                {entry.name}
              </option>
            ))}
          </FormSelect>
        )}
        {character.entries.length ? (
          character.entries.map((entry) => (
            <div className="plain-row" key={entry.id}>
              <CharacterActionCard
                entry={entry}
                disabled={!editable}
                onAction={(input) =>
                  onRollEntry(character.id, entry.id, {
                    ...input,
                    ...(rollMode ? { rollMode } : {}),
                  })
                }
              />
              {entry.data.uses && (
                <Button
                  disabled={!editable}
                  onClick={() =>
                    onRechargeEntry(character.id, entry.id, entry.revision)
                  }
                >
                  Перезарядить
                </Button>
              )}
              {snapshot.me.role === "GM" && (
                <div className="inline-fields">
                  <Button onClick={() => setEntryEditor(entry)}>
                    Редактировать запись
                  </Button>
                  <Button
                    className="danger-link"
                    onClick={() =>
                      void onDeleteEntry(character.id, entry.id, entry.revision)
                    }
                  >
                    Удалить у персонажа
                  </Button>
                </div>
              )}
              {snapshot.me.role === "GM" && (
                <Button hidden onClick={() => setEntryEditor(entry)}>
                  Редактировать запись
                </Button>
              )}
            </div>
          ))
        ) : (
          <p className="muted">
            Мастер ещё не назначил навыки или способности.
          </p>
        )}
      </div>
      {entryEditor && (
        <ArkenDialog
          open
          footer={false}
          title={`Редактирование ${entryEditor.name}`}
          onClose={() => setEntryEditor(null)}
        >
          <CatalogEntryForm
            key={entryEditor.id}
            existing={entryEditor}
            onCancel={() => setEntryEditor(null)}
            onSubmit={async (input) => {
              await onUpdateEntry(character.id, entryEditor.id, {
                ...input,
                revision: entryEditor.revision,
              });
              setEntryEditor(null);
            }}
          />
        </ArkenDialog>
      )}
      <h3 className="character-block-heading">Инвентарь и снаряжение</h3>
      <label className="field">
        Инвентарь (один предмет на строку)
        <FormTextArea
          key={`${character.id}:${character.revision}`}
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
      <h3 className="character-block-heading">Ресурсы и кошелёк</h3>
      <div className="character-power-controls">
        {(["physicalPower", "magicPower"] as const).map((key) => {
          const resource = resourcesDraft[key] ?? { current: 0, maximum: 0 };
          const maximum = resource.maximum ?? resource.current;
          return (
            <fieldset className="resource-card" key={key} disabled={!editable}>
              <legend>
                {key === "physicalPower"
                  ? "Физическая сила"
                  : "Магическая сила"}
              </legend>
              <label>
                Текущее
                <FormInput
                  type="number"
                  min={0}
                  value={resource.current}
                  onChange={(event) =>
                    setResourcesDraft((current) => ({
                      ...current,
                      [key]: {
                        ...resource,
                        current: Math.max(0, Number(event.target.value)),
                      },
                    }))
                  }
                  onBlur={() => void saveResources(resourcesDraft)}
                />
              </label>
              <label>
                Максимум
                <FormInput
                  type="number"
                  min={0}
                  value={maximum}
                  onChange={(event) => {
                    const nextMaximum = Math.max(0, Number(event.target.value));
                    setResourcesDraft((current) => ({
                      ...current,
                      [key]: {
                        ...resource,
                        maximum: nextMaximum,
                        current: Math.min(resource.current, nextMaximum),
                        recoverable: true,
                      },
                    }));
                  }}
                  onBlur={() => void saveResources(resourcesDraft)}
                />
              </label>
            </fieldset>
          );
        })}
        <div className="inline-fields character-rest-controls">
          <Button
            disabled={!editable || countersPending > 0}
            onClick={() => void runRest("CATCH_BREATH")}
          >
            Перевести дух
          </Button>
          <Button
            disabled={!editable || countersPending > 0}
            onClick={() => void runRest("SHORT")}
          >
            Короткий отдых (+25%)
          </Button>
        </div>
      </div>
      <div className="subsection character-resource-editor">
        <h3>Дополнительные ресурсы</h3>
        {Object.entries(resourcesDraft)
          .filter(([key]) => key !== "physicalPower" && key !== "magicPower")
          .map(([key, resource]) => (
            <fieldset className="resource-card" key={key} disabled={!editable}>
              <legend>{key}</legend>
              <label>
                Название
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
              <label>
                Описание
                <FormInput
                  value={resource.description ?? ""}
                  onChange={(event) =>
                    setResourcesDraft((current) => ({
                      ...current,
                      [key]: { ...resource, description: event.target.value },
                    }))
                  }
                  onBlur={() => void saveResources(resourcesDraft)}
                />
              </label>
              <label>
                Текущее
                <FormInput
                  type="number"
                  min={0}
                  value={resource.current}
                  onChange={(event) =>
                    setResourcesDraft((current) => ({
                      ...current,
                      [key]: {
                        ...resource,
                        current: Math.max(0, Number(event.target.value)),
                      },
                    }))
                  }
                  onBlur={() => void saveResources(resourcesDraft)}
                />
              </label>
              <label>
                Максимум
                <FormInput
                  type="number"
                  min={0}
                  value={resource.maximum ?? resource.current}
                  onChange={(event) => {
                    const maximum = Math.max(0, Number(event.target.value));
                    setResourcesDraft((current) => ({
                      ...current,
                      [key]: {
                        ...resource,
                        maximum,
                        current: Math.min(resource.current, maximum),
                      },
                    }));
                  }}
                  onBlur={() => void saveResources(resourcesDraft)}
                />
              </label>
              <label>
                Изображение
                <FormSelect
                  value={resource.imageAssetId ?? ""}
                  onChange={(event) => {
                    const next = {
                      ...resourcesDraft,
                      [key]: {
                        ...resource,
                        imageAssetId: event.target.value || null,
                      },
                    };
                    void saveResources(next);
                  }}
                >
                  <option value="">Без изображения</option>
                  {snapshot.assets
                    .filter((asset) => asset.mimeType.startsWith("image/"))
                    .map((asset) => (
                      <option key={asset.id} value={asset.id}>
                        {asset.name}
                      </option>
                    ))}
                </FormSelect>
              </label>
              <label className="compact-check">
                <input
                  type="checkbox"
                  checked={resource.recoverable !== false}
                  onChange={(event) =>
                    void saveResources({
                      ...resourcesDraft,
                      [key]: { ...resource, recoverable: event.target.checked },
                    })
                  }
                />
                Восполнять при отдыхе
              </label>
              <Button
                className="danger-link"
                onClick={() => {
                  const { [key]: _removed, ...rest } = resourcesDraft;
                  void saveResources(rest);
                }}
              >
                Удалить
              </Button>
            </fieldset>
          ))}
        <div className="inline-fields">
          <FormInput
            value={newResourceName}
            placeholder="Новый ресурс"
            onChange={(event) => setNewResourceName(event.target.value)}
          />
          <Button
            disabled={
              !editable ||
              !newResourceName.trim() ||
              Boolean(resourcesDraft[newResourceName.trim()])
            }
            onClick={() => {
              const key = newResourceName.trim();
              if (!key) return;
              setNewResourceName("");
              void saveResources({
                ...resourcesDraft,
                [key]: { current: 0, maximum: 0, recoverable: true },
              });
            }}
          >
            Добавить
          </Button>
        </div>
      </div>
      <label className="field">
        Кошелёк (1 золото = 10 серебра; 1 серебро = 10 меди; значения не
        нормализуются)
        {(["gold", "silver", "copper", "sp"] as const).map((key) => (
          <span className="inline-fields" key={key}>
            <b>{key}</b>
            <Button
              disabled={!editable || walletDraft[key] === 0}
              onPointerDown={(event) => event.preventDefault()}
              onClick={() => changeWallet(key, -1)}
            >
              −
            </Button>
            <FormInput
              type="number"
              min={0}
              value={walletDraft[key]}
              disabled={!editable}
              onChange={(event) => {
                const next = {
                  ...walletDraftRef.current,
                  [key]: normalizeWalletValue(event.target.value),
                };
                walletDraftRef.current = next;
                walletInputDirtyRef.current = true;
                setWalletDraft(next);
              }}
              onBlur={() => void saveWallet(walletDraft)}
            />
            <Button
              disabled={!editable}
              onPointerDown={(event) => event.preventDefault()}
              onClick={() => changeWallet(key, 1)}
            >
              +
            </Button>
          </span>
        ))}
        {countersPending > 0 && <span className="muted">Сохраняем…</span>}
        {countersError && (
          <span className="field-error" role="alert">
            {countersError}
          </span>
        )}
      </label>
      <h3 className="character-block-heading">Заметки</h3>
      <label className="field">
        Заметки
        <FormTextArea
          defaultValue={character.notes}
          disabled={!editable}
          rows={7}
          onBlur={(event) =>
            onPatch(character.id, {
              notes: event.target.value,
              revision: character.revision,
            })
          }
        />
      </label>
      <TextPromptDialog
        open={renameOpen}
        title="Переименовать персонажа"
        label="Имя персонажа"
        initialValue={character.name}
        onClose={() => setRenameOpen(false)}
        onApply={async (name) => {
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

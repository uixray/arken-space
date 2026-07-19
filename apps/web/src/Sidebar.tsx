import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import type {
  AssetKind,
  AssetDto,
  CatalogEntryDto,
  CharacterDto,
  GameSnapshot,
  MessageVisibility,
  PlayerAccessDto,
  PlayerAccessSecretDto,
} from "@arken/contracts";
import { arkenSystem } from "@arken/system";
import { Button } from "@gravity-ui/uikit";
import {
  CatalogEntryForm,
  type CatalogEntryFormInput,
} from "./CatalogEntryForm";
import type { GameSocket } from "./realtime";
import { ApiError } from "./api";
import { ConfirmDialog } from "./ui/ConfirmDialog";
import { TextPromptDialog } from "./ui/TextPromptDialog";
import { ArkenDialog } from "./ui/ArkenDialog";
import { ImageUploadField } from "./ui/ImageUploadField";
import { FormInput, FormSelect, FormTextArea } from "./ui/GravityFormControls";
import { SceneManagerDialog, type SceneDraft } from "./ui/SceneManagerDialog";
import { parseComposerInput } from "./chat-composer";

function formatDiceBreakdown(dice: GameSnapshot["messages"][number]["dice"]) {
  if (!dice) return "";
  const terms = dice.terms.map(
    (term) => `${term.notation} (${term.rolls.join(", ")})`,
  );
  const modifiers = dice.modifiers
    .filter((modifier) => modifier.value !== 0)
    .map((modifier) =>
      modifier.value > 0 ? `+${modifier.value}` : String(modifier.value),
    );
  return [...terms, ...modifiers].join(" ");
}

type Props = {
  snapshot: GameSnapshot;
  socket: GameSocket | null;
  presence: Array<{ membershipId: string; online: boolean }>;
  onPlaceTokenDefinition: (definitionId: string) => Promise<void>;
  onDeleteTokenDefinition: (
    definitionId: string,
    revision: number,
  ) => Promise<void>;
  onPatchTokenDefinition: (
    definitionId: string,
    revision: number,
    patch: {
      name?: string;
      defaultAssetId?: string | null;
      characterId?: string | null;
      defaultWidth?: number;
      defaultHeight?: number;
    },
  ) => Promise<void>;
  onCreateTokenDefinition: (input: {
    name: string;
    characterId: string | null;
    defaultAssetId: string | null;
    defaultWidth: number;
    defaultHeight: number;
    controllerMembershipIds: string[];
  }) => Promise<void>;
  onReplaceTokenControllers: (
    definitionId: string,
    revision: number,
    controllerMembershipIds: string[],
  ) => Promise<void>;
  onPatchCharacter: (id: string, patch: Partial<CharacterDto>) => Promise<void>;
  onChat: (body: string, visibility: MessageVisibility) => Promise<void>;
  onRoll: (
    formula: string,
    label?: string,
    visibility?: MessageVisibility,
    characterId?: string | null,
    rollMode?: "NORMAL" | "ADVANTAGE" | "DISADVANTAGE",
  ) => Promise<void>;
  onCreateCharacter: (name: string) => Promise<void>;
  onCreateInvite: (
    characterId: string,
    label: string,
  ) => Promise<PlayerAccessSecretDto>;
  onListPlayerAccess: () => Promise<PlayerAccessDto[]>;
  onRotatePlayerAccess: (id: string) => Promise<PlayerAccessSecretDto>;
  onRevokePlayerAccess: (id: string) => Promise<void>;
  onSaveScene: (
    scene: GameSnapshot["scenes"][number] | null,
    draft: SceneDraft,
  ) => Promise<void>;
  onActivateScene: (sceneId: string) => Promise<void>;
  /** @deprecated SceneManagerDialog owns scene editing. */
  onCreateScene: (name: string) => Promise<void>;
  /** @deprecated SceneManagerDialog owns scene editing. */
  onAssignMap: (sceneId: string, assetId: string | null) => Promise<void>;
  /** @deprecated SceneManagerDialog owns scene editing. */
  onRenameScene: (
    sceneId: string,
    revision: number,
    name: string,
  ) => Promise<void>;
  onViewScene: (sceneId: string) => void;
  viewedSceneId: string | null;
  sceneDialogRequest: number;
  onRenameMembership: (
    membershipId: string,
    revision: number,
    name: string,
  ) => Promise<void>;
  onCreateToken: (characterId: string) => Promise<void>;
  onUpload: (file: File, kind: AssetKind) => Promise<AssetDto>;
  onPreviewPlayer: (membershipId: string) => Promise<void>;
  onCreateCatalogEntry: (input: {
    kind: "SKILL" | "ABILITY";
    name: string;
    description: string;
    data?: Record<string, unknown>;
  }) => Promise<void>;
  onUpdateCatalogEntry: (
    id: string,
    patch: Partial<CatalogEntryDto>,
  ) => Promise<void>;
  onDeleteCatalogEntry: (id: string, revision: number) => Promise<void>;
  onAssignCatalogEntry: (
    characterId: string,
    catalogEntryId: string,
  ) => Promise<void>;
  onUpdateCharacterEntry: (
    characterId: string,
    id: string,
    patch: {
      kind?: "SKILL" | "ABILITY";
      name?: string;
      description?: string;
      data?: Record<string, unknown>;
      revision?: number;
    },
  ) => Promise<void>;
  onDeleteCharacterEntry: (
    characterId: string,
    id: string,
    revision: number,
  ) => Promise<void>;
  onRollEntry: (
    characterId: string,
    entryId: string,
    rollActionId: string,
  ) => Promise<void>;
  onRechargeEntry: (
    characterId: string,
    entryId: string,
    revision: number,
  ) => Promise<void>;
  onUpdateCounters: (
    characterId: string,
    revision: number,
    patch: {
      wallet?: CharacterDto["wallet"];
      resources?: CharacterDto["resources"];
    },
    intent?: {
      walletDelta?: {
        key: keyof CharacterDto["wallet"];
        delta: number;
      };
    },
  ) => Promise<void>;
  onCampaignClock: (
    command: "ADVANCE_DAY" | "START_BATTLE" | "END_BATTLE",
    revision: number,
  ) => Promise<void>;
  requestedChatMessageId: string | null;
  onRequestedChatMessageHandled: () => void;
  onChatVisibilityChange: (visible: boolean) => void;
  workspace: "characters" | "tokens" | "scenes" | "setup" | "media" | null;
  onWorkspaceChange: (
    workspace: "characters" | "tokens" | "scenes" | "setup" | "media" | null,
  ) => void;
};

export function Sidebar(props: Props) {
  const {
    onChatVisibilityChange,
    onRequestedChatMessageHandled,
    requestedChatMessageId,
    onWorkspaceChange,
    sceneDialogRequest,
  } = props;
  const isGm = props.snapshot.me.role === "GM";
  const [focusedMessageId, setFocusedMessageId] = useState<string | null>(null);
  const ownCharacter = props.snapshot.characters.find(
    (character) => character.ownerMembershipId === props.snapshot.me.id,
  );
  const [selectedCharacterId, setSelectedCharacterId] = useState(
    ownCharacter?.id ?? props.snapshot.characters[0]?.id ?? "",
  );
  const selectedCharacter =
    props.snapshot.characters.find(
      (character) => character.id === selectedCharacterId,
    ) ?? ownCharacter;

  const openChat = (messageId?: string) => {
    setFocusedMessageId(messageId ?? null);
  };
  useEffect(() => onChatVisibilityChange(true), [onChatVisibilityChange]);
  useEffect(() => {
    if (!requestedChatMessageId) return;
    setFocusedMessageId(requestedChatMessageId);
    onRequestedChatMessageHandled();
  }, [requestedChatMessageId, onRequestedChatMessageHandled]);
  useEffect(() => {
    if (sceneDialogRequest > 0 && isGm) onWorkspaceChange("scenes");
  }, [sceneDialogRequest, isGm, onWorkspaceChange]);

  return (
    <aside className={`sidebar ${!isGm ? "player-sidebar" : ""}`}>
      <nav className="tabs" aria-label="Панели">
        <Button view="flat" aria-pressed="true" onClick={() => openChat()}>
          Чат <span>{props.snapshot.messages.length}</span>
        </Button>
      </nav>
      <div className="panel-scroll chat-scroll">
        <ChatPanel
          snapshot={props.snapshot}
          onChat={props.onChat}
          onRoll={props.onRoll}
          focusedMessageId={focusedMessageId}
          onMessageFocused={() => setFocusedMessageId(null)}
        />
        {props.workspace === "characters" && (
          <ArkenDialog
            open
            footer={false}
            title="Персонажи"
            variant="workspace"
            className={!isGm ? "player-character-drawer" : undefined}
            onClose={() => props.onWorkspaceChange(null)}
          >
            <CharacterPanel
              snapshot={props.snapshot}
              character={selectedCharacter}
              selectedId={selectedCharacterId}
              setSelectedId={setSelectedCharacterId}
              onPatch={props.onPatchCharacter}
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
          </ArkenDialog>
        )}
        {props.workspace === "tokens" && (
          <ArkenDialog
            open
            footer={false}
            title="Токены"
            variant="workspace"
            onClose={() => props.onWorkspaceChange(null)}
          >
            <PalettePanel {...props} />
          </ArkenDialog>
        )}
        {props.workspace === "setup" && isGm && (
          <ArkenDialog
            open
            footer={false}
            title="Подготовка"
            variant="workspace"
            onClose={() => props.onWorkspaceChange(null)}
          >
            <SetupPanel {...props} />
          </ArkenDialog>
        )}
        {props.workspace === "scenes" && isGm && (
          <SceneManagerDialog
            open
            variant="workspace"
            snapshot={props.snapshot}
            viewedSceneId={props.viewedSceneId}
            onClose={() => props.onWorkspaceChange(null)}
            onView={props.onViewScene}
            onPublish={props.onActivateScene}
            onSave={props.onSaveScene}
            onUpload={props.onUpload}
          />
        )}
        {props.workspace === "media" && (
          <ArkenDialog
            open
            footer={false}
            title="Файлы"
            variant="workspace"
            onClose={() => props.onWorkspaceChange(null)}
          >
            <MediaPanel snapshot={props.snapshot} onUpload={props.onUpload} />
          </ArkenDialog>
        )}
      </div>
    </aside>
  );
}

function CharacterPanel({
  snapshot,
  character,
  selectedId,
  setSelectedId,
  onPatch,
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
  onPatch: Props["onPatchCharacter"];
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
  const [entryEditor, setEntryEditor] = useState<
    CharacterDto["entries"][number] | null
  >(null);
  const [renameOpen, setRenameOpen] = useState(false);
  const [portraitUpload, setPortraitUpload] = useState<File>();
  const [walletDraft, setWalletDraft] = useState(
    () => character?.wallet ?? { gold: 0, silver: 0, copper: 0, sp: 0 },
  );
  const walletDraftRef = useRef(walletDraft);
  const walletInputDirtyRef = useRef(false);
  const [resourcesDraft, setResourcesDraft] = useState(() =>
    JSON.stringify(character?.resources ?? {}, null, 2),
  );
  useEffect(() => {
    if (character && countersPending === 0) {
      walletDraftRef.current = character.wallet;
      walletInputDirtyRef.current = false;
      setWalletDraft(character.wallet);
      setResourcesDraft(JSON.stringify(character.resources, null, 2));
    }
  }, [character, countersPending]);
  const editable =
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
  const portrait = snapshot.assets.find(
    (asset) => asset.id === character.portraitAssetId,
  );
  const saveWallet = async (nextWallet: CharacterDto["wallet"]) => {
    if (!walletInputDirtyRef.current) return;
    if (
      (Object.keys(nextWallet) as Array<keyof CharacterDto["wallet"]>).every(
        (key) => nextWallet[key] === character.wallet[key],
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
  const changeWallet = (key: keyof CharacterDto["wallet"], delta: number) => {
    const current = walletDraftRef.current;
    const nextValue = Math.max(0, current[key] + delta);
    const appliedDelta = nextValue - current[key];
    if (appliedDelta === 0) return;
    const next = { ...current, [key]: nextValue };
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
      {snapshot.me.role === "GM" && (
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
            void onPatch(character.id, {
              portraitAssetId: event.target.value || null,
              revision: character.revision,
            })
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
        onClick={async () => {
          if (!portraitUpload) return;
          const asset = await onUpload(portraitUpload, "PORTRAIT");
          await onPatch(character.id, {
            portraitAssetId: asset.id,
            revision: character.revision,
          });
          setPortraitUpload(undefined);
        }}
      >
        Загрузить и назначить
      </Button>
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
              onCampaignClock("ADVANCE_DAY", snapshot.campaign.revision)
            }
          >
            Следующий день
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
            onPatch(character.id, {
              backstory: event.target.value,
              revision: character.revision,
            })
          }
        />
      </details>
      <div className="stats-grid">
        {arkenSystem.stats.map((stat) => (
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
                onPatch(character.id, {
                  stats: { [stat.key]: Number(event.target.value) },
                  revision: character.revision,
                })
              }
            />
            <Button
              disabled={!editable}
              onClick={() =>
                onRoll(`1d20 + ${stat.key}`, stat.label, "PUBLIC", character.id)
              }
            >
              Бросок
            </Button>
          </label>
        ))}
      </div>
      <Button
        onClick={() =>
          onRoll("1d20 + agility", "Инициатива", "PUBLIC", character.id)
        }
      >
        Инициатива (d20 + Ловкость)
      </Button>
      <div className="subsection">
        <h3>Навыки</h3>
        {character.skills.length ? (
          character.skills.map((skill) => (
            <Button
              className="action-row"
              key={skill.key}
              onClick={() =>
                onRoll(skill.formula, skill.name, "PUBLIC", character.id)
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
        <h3>Заклинания</h3>
        {character.spells.length ? (
          character.spells.map((spell) => (
            <div className="plain-row" key={spell.key}>
              <strong>{spell.name}</strong>
              <p>{spell.description}</p>
              {spell.formula && (
                <Button
                  onClick={() =>
                    onRoll(spell.formula!, spell.name, "PUBLIC", character.id)
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
                void onAssignEntry(character.id, event.target.value);
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
              <strong>{entry.name}</strong>
              <span className="eyebrow">
                {entry.kind === "SKILL" ? "Навык" : "Способность"}
              </span>
              {entry.description && <p>{entry.description}</p>}
              {entry.data.uses && (
                <p>
                  {entry.data.uses.current}/{entry.data.uses.max} ·{" "}
                  {entry.data.uses.recharge}
                  {entry.data.uses.progressText
                    ? ` · ${entry.data.uses.progressText}`
                    : ""}
                  <Button
                    disabled={!editable}
                    onClick={() =>
                      onRechargeEntry(character.id, entry.id, entry.revision)
                    }
                  >
                    Перезарядить
                  </Button>
                </p>
              )}
              {[...(entry.data.rollActions ?? [])]
                .sort((a, b) => a.order - b.order)
                .map((action) => (
                  <Button
                    key={action.id}
                    disabled={!editable || (entry.data.uses?.current ?? 1) < 1}
                    onClick={() =>
                      onRollEntry(character.id, entry.id, action.id)
                    }
                  >
                    {action.label} · {action.kind}
                  </Button>
                ))}
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
      <label className="field">
        Инвентарь (один предмет на строку)
        <FormTextArea
          defaultValue={character.inventory.join("\n")}
          disabled={!editable}
          rows={5}
          onBlur={(event) =>
            onPatch(character.id, {
              inventory: event.target.value
                .split("\n")
                .map((item) => item.trim())
                .filter(Boolean),
              revision: character.revision,
            })
          }
        />
      </label>
      <label className="field">
        Ресурсы (JSON: имя → current/maximum)
        <FormTextArea
          value={resourcesDraft}
          disabled={!editable}
          rows={5}
          onChange={(event) => setResourcesDraft(event.target.value)}
          onBlur={(event) => {
            try {
              const resources = JSON.parse(
                event.target.value,
              ) as CharacterDto["resources"];
              if (
                JSON.stringify(resources) ===
                JSON.stringify(character.resources)
              )
                return;
              setCountersPending((count) => count + 1);
              setCountersError("");
              void onUpdateCounters(character.id, character.revision, {
                resources,
              })
                .catch((reason) => {
                  setCountersError(
                    reason instanceof ApiError &&
                      reason.code === "CHARACTER_CONFLICT"
                      ? "Ресурсы изменены в другой сессии. Показаны актуальные значения — повторите правку при необходимости."
                      : "Не удалось сохранить ресурсы. Проверьте данные и соединение.",
                  );
                })
                .finally(() =>
                  setCountersPending((count) => Math.max(0, count - 1)),
                );
            } catch {
              setResourcesDraft(JSON.stringify(character.resources, null, 2));
            }
          }}
        />
      </label>
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
                  [key]: Math.max(
                    0,
                    Number.parseInt(event.target.value || "0", 10),
                  ),
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

function ChatPanel({
  snapshot,
  onChat,
  onRoll,
  focusedMessageId,
  onMessageFocused,
}: {
  snapshot: GameSnapshot;
  onChat: Props["onChat"];
  onRoll: Props["onRoll"];
  focusedMessageId: string | null;
  onMessageFocused: () => void;
}) {
  const [composer, setComposer] = useState("");
  const [visibility, setVisibility] = useState<MessageVisibility>("PUBLIC");
  const [rollMode, setRollMode] = useState<
    "NORMAL" | "ADVANTAGE" | "DISADVANTAGE"
  >("NORMAL");
  const [composerError, setComposerError] = useState("");
  const endRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const followRef = useRef(true);
  const [newMessageCount, setNewMessageCount] = useState(0);
  const latestMessageId = snapshot.messages.at(-1)?.id;
  useEffect(() => {
    const list = listRef.current;
    if (!list || !latestMessageId) return;
    if (followRef.current) {
      list.scrollTo({ top: list.scrollHeight });
      setNewMessageCount(0);
    } else {
      setNewMessageCount((current) => current + 1);
    }
  }, [latestMessageId]);
  useEffect(() => {
    if (!focusedMessageId) return;
    const message = document.getElementById(`chat-message-${focusedMessageId}`);
    if (!message) return;
    const list = listRef.current;
    if (list) {
      list.scrollTo({
        top:
          message.offsetTop - list.clientHeight / 2 + message.clientHeight / 2,
      });
    }
    message.focus({ preventScroll: true });
    onMessageFocused();
  }, [focusedMessageId, onMessageFocused]);
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const intent = parseComposerInput(composer);
    if (intent.kind === "INVALID") {
      setComposerError(intent.message);
      return;
    }
    setComposerError("");
    if (intent.kind === "ROLL")
      await onRoll(
        intent.formula,
        undefined,
        visibility,
        snapshot.me.characterId,
        rollMode,
      );
    else await onChat(intent.body, visibility);
    setComposer("");
  };
  return (
    <section className="chat-panel">
      <div
        className="message-list"
        aria-live="polite"
        ref={listRef}
        onScroll={(event) => {
          const list = event.currentTarget;
          followRef.current =
            list.scrollHeight - list.scrollTop - list.clientHeight < 48;
          if (followRef.current) setNewMessageCount(0);
        }}
      >
        {snapshot.messages.map((message) => (
          <article
            id={`chat-message-${message.id}`}
            className={`message ${message.kind.toLowerCase()}`}
            key={message.id}
            tabIndex={-1}
          >
            <header>
              <strong>{message.displayName}</strong>
              {message.characterId && (
                <span className="message-character">
                  {snapshot.characters.find(
                    (character) => character.id === message.characterId,
                  )?.name ?? "Персонаж"}
                </span>
              )}
              <time>
                {new Date(message.createdAt).toLocaleTimeString([], {
                  hour: "2-digit",
                  minute: "2-digit",
                })}
              </time>
              {message.visibility === "GM_ONLY" && <span>мастеру</span>}
            </header>
            {message.kind === "DICE" && message.dice ? (
              <div className="roll-result">
                <strong className="roll-total" aria-label="Итог броска">
                  {message.dice.total}
                </strong>
                <div className="roll-details">
                  <div>{message.body}</div>
                  <small>{formatDiceBreakdown(message.dice)}</small>
                </div>
              </div>
            ) : (
              <p>{message.body}</p>
            )}
          </article>
        ))}
        <div ref={endRef} aria-hidden="true" />
      </div>
      {newMessageCount > 0 && (
        <Button
          className="new-messages"
          onClick={() => {
            const list = listRef.current;
            if (list)
              list.scrollTo({ top: list.scrollHeight, behavior: "smooth" });
            followRef.current = true;
            setNewMessageCount(0);
          }}
        >
          Новые сообщения · {newMessageCount}
        </Button>
      )}
      <div className="chat-tools">
        <label className="compact-select">
          Бросок d20
          <select
            aria-label="Режим броска"
            value={rollMode}
            onChange={(event) =>
              setRollMode(
                event.target.value as "NORMAL" | "ADVANTAGE" | "DISADVANTAGE",
              )
            }
          >
            <option value="NORMAL">обычный</option>
            <option value="ADVANTAGE">с преимуществом</option>
            <option value="DISADVANTAGE">с помехой</option>
          </select>
        </label>
        <label className="compact-check">
          <FormInput
            type="checkbox"
            checked={visibility === "GM_ONLY"}
            onChange={(event) =>
              setVisibility(event.target.checked ? "GM_ONLY" : "PUBLIC")
            }
          />{" "}
          Только мастер
        </label>
      </div>
      <form className="chat-compose" onSubmit={submit}>
        <FormTextArea
          aria-label="Сообщение или бросок"
          placeholder="Сообщение … или /roll 1d20 + agility"
          value={composer}
          onChange={(event) => setComposer(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.shiftKey) {
              event.preventDefault();
              event.currentTarget.form?.requestSubmit();
            }
          }}
          rows={3}
        />
        <Button className="primary" type="submit">
          Отправить
        </Button>
      </form>
      {composerError && (
        <p className="composer-error" role="alert">
          {composerError}
        </p>
      )}
    </section>
  );
}

function PalettePanel(props: Props) {
  const definitions = props.snapshot.tokenDefinitions ?? [];
  const [editor, setEditor] = useState<
    (typeof definitions)[number] | "NEW" | null
  >(null);
  const [deleteDefinition, setDeleteDefinition] = useState<
    (typeof definitions)[number] | null
  >(null);
  if (!definitions.length && props.snapshot.me.role !== "GM")
    return (
      <Empty
        title="Нет доступных токенов"
        text="Мастер ещё не добавил токены в вашу палитру."
      />
    );
  return (
    <section className="panel-section token-palette">
      <div className="section-heading">
        <div>
          <span className="eyebrow">Палитра</span>
          <h2>Токены</h2>
        </div>
        <span className="revision">{definitions.length}</span>
      </div>
      {props.snapshot.me.role === "GM" && (
        <Button view="action" onClick={() => setEditor("NEW")}>
          Создать токен
        </Button>
      )}
      <p className="muted">
        Нажмите, чтобы поставить токен в центр карты, или перетащите его на
        нужное место.
      </p>
      <div className="palette-grid">
        {definitions.map((definition) => {
          const asset = props.snapshot.assets.find(
            (item) => item.id === definition.defaultAssetId,
          );
          return (
            <article
              className="palette-card"
              key={definition.id}
              draggable
              onDragStart={(event) => {
                event.dataTransfer.effectAllowed = "copy";
                event.dataTransfer.setData(
                  "application/x-arken-token-definition",
                  definition.id,
                );
              }}
            >
              <Button
                className="palette-place"
                onClick={() => props.onPlaceTokenDefinition(definition.id)}
                title="Поставить экземпляр токена на активную сцену"
              >
                {asset ? (
                  <img src={asset.url} alt="" />
                ) : (
                  <span aria-hidden="true">
                    {definition.name.slice(0, 2).toUpperCase()}
                  </span>
                )}
              </Button>
              <strong className="palette-card__title">{definition.name}</strong>
              <FormSelect
                aria-label={`Изображение токена ${definition.name}`}
                value={definition.defaultAssetId ?? ""}
                onChange={(event) =>
                  void props.onPatchTokenDefinition(
                    definition.id,
                    definition.revision,
                    { defaultAssetId: event.target.value || null },
                  )
                }
              >
                <option value="">Без изображения</option>
                {props.snapshot.assets
                  .filter((item) => item.kind === "TOKEN")
                  .map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.name}
                    </option>
                  ))}
              </FormSelect>
              {props.snapshot.me.role !== "GM" && (
                <TokenImageAssignment
                  definition={definition}
                  onUpload={props.onUpload}
                  onPatch={props.onPatchTokenDefinition}
                />
              )}
              {props.snapshot.me.role === "GM" && (
                <div className="inline-fields">
                  <Button onClick={() => setEditor(definition)}>
                    Настроить
                  </Button>
                  <Button
                    className="danger-link"
                    onClick={() => setDeleteDefinition(definition)}
                  >
                    Удалить определение и все размещения
                  </Button>
                </div>
              )}
            </article>
          );
        })}
      </div>
      {editor && (
        <TokenDefinitionEditor
          key={editor === "NEW" ? "new" : `${editor.id}:${editor.revision}`}
          snapshot={props.snapshot}
          definition={editor === "NEW" ? undefined : editor}
          onUpload={props.onUpload}
          onCancel={() => setEditor(null)}
          onCreate={props.onCreateTokenDefinition}
          onPatch={props.onPatchTokenDefinition}
          onReplaceControllers={props.onReplaceTokenControllers}
        />
      )}
      <ConfirmDialog
        open={Boolean(deleteDefinition)}
        title="Удалить определение токена?"
        message={
          deleteDefinition
            ? `Определение «${deleteDefinition.name}» и все его размещения на сценах будут удалены. Это не удаление одного токена с карты.`
            : ""
        }
        confirmLabel="Удалить"
        onClose={() => setDeleteDefinition(null)}
        onConfirm={() => {
          if (!deleteDefinition) return;
          const target = deleteDefinition;
          setDeleteDefinition(null);
          void props.onDeleteTokenDefinition(target.id, target.revision);
        }}
      />
    </section>
  );
}

function TokenImageAssignment({
  definition,
  onUpload,
  onPatch,
}: {
  definition: NonNullable<GameSnapshot["tokenDefinitions"]>[number];
  onUpload: Props["onUpload"];
  onPatch: Props["onPatchTokenDefinition"];
}) {
  const [file, setFile] = useState<File>();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const assign = async () => {
    if (!file || saving) return;
    setSaving(true);
    setError("");
    try {
      const asset = await onUpload(file, "TOKEN");
      await onPatch(definition.id, definition.revision, {
        defaultAssetId: asset.id,
      });
      setFile(undefined);
    } catch (reason) {
      setError(
        reason instanceof Error
          ? reason.message
          : "Не удалось назначить изображение токену.",
      );
    } finally {
      setSaving(false);
    }
  };
  return (
    <div className="direct-asset-upload">
      <ImageUploadField
        label={`Новое изображение для ${definition.name}`}
        value={file}
        accept=".png,.jpg,.jpeg,.webp,image/png,image/jpeg,image/webp"
        hint="PNG, JPEG или WebP"
        disabled={saving}
        onUpdate={setFile}
      />
      <Button
        view="action"
        disabled={!file || saving}
        loading={saving}
        onClick={() => void assign()}
      >
        Загрузить и назначить
      </Button>
      {error && <div className="field-error">{error}</div>}
    </div>
  );
}

function TokenDefinitionEditor({
  snapshot,
  definition,
  onUpload,
  onCancel,
  onCreate,
  onPatch,
  onReplaceControllers,
}: {
  snapshot: GameSnapshot;
  definition?: NonNullable<GameSnapshot["tokenDefinitions"]>[number];
  onUpload: Props["onUpload"];
  onCancel: () => void;
  onCreate: Props["onCreateTokenDefinition"];
  onPatch: Props["onPatchTokenDefinition"];
  onReplaceControllers: Props["onReplaceTokenControllers"];
}) {
  const [name, setName] = useState(definition?.name ?? "");
  const [characterId, setCharacterId] = useState(definition?.characterId ?? "");
  const [assetId, setAssetId] = useState(definition?.defaultAssetId ?? "");
  const [width, setWidth] = useState(definition?.defaultWidth ?? 64);
  const [height, setHeight] = useState(definition?.defaultHeight ?? 64);
  const [controllers, setControllers] = useState<string[]>(
    definition?.controllerMembershipIds ?? [],
  );
  const [image, setImage] = useState<File>();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!name.trim()) return setError("Укажите название токена.");
    setSaving(true);
    setError("");
    try {
      let selectedAssetId = assetId || null;
      if (image) selectedAssetId = (await onUpload(image, "TOKEN")).id;
      const input = {
        name: name.trim(),
        characterId: characterId || null,
        defaultAssetId: selectedAssetId,
        defaultWidth: width,
        defaultHeight: height,
        controllerMembershipIds: controllers,
      };
      if (!definition) await onCreate(input);
      else {
        await onPatch(definition.id, definition.revision, input);
        await onReplaceControllers(
          definition.id,
          definition.revision + 1,
          controllers,
        );
      }
      onCancel();
    } catch (reason) {
      setError(
        reason instanceof Error
          ? reason.message
          : "Не удалось сохранить токен.",
      );
    } finally {
      setSaving(false);
    }
  };

  return (
    <ArkenDialog
      open
      footer={false}
      title={definition ? `Настройка ${definition.name}` : "Новый токен"}
      onClose={onCancel}
    >
      <form className="entity-form" onSubmit={submit}>
        <label>
          Название
          <FormInput
            value={name}
            onChange={(event) => setName(event.target.value)}
          />
        </label>
        <label>
          Персонаж
          <FormSelect
            value={characterId}
            onChange={(event) => setCharacterId(event.target.value)}
          >
            <option value="">Без персонажа</option>
            {snapshot.characters.map((character) => (
              <option key={character.id} value={character.id}>
                {character.name}
              </option>
            ))}
          </FormSelect>
        </label>
        <label>
          Изображение из файлов
          <FormSelect
            value={assetId}
            onChange={(event) => setAssetId(event.target.value)}
          >
            <option value="">Без изображения</option>
            {snapshot.assets
              .filter((asset) => asset.kind === "TOKEN")
              .map((asset) => (
                <option key={asset.id} value={asset.id}>
                  {asset.name}
                </option>
              ))}
          </FormSelect>
        </label>
        <ImageUploadField
          label="Загрузить новое изображение"
          value={image}
          onUpdate={setImage}
          disabled={saving}
        />
        <div className="inline-fields">
          <label>
            Ширина
            <FormInput
              type="number"
              min={16}
              max={1024}
              value={width}
              onChange={(event) => setWidth(Number(event.target.value))}
            />
          </label>
          <label>
            Высота
            <FormInput
              type="number"
              min={16}
              max={1024}
              value={height}
              onChange={(event) => setHeight(Number(event.target.value))}
            />
          </label>
        </div>
        <fieldset>
          <legend>Управление игроками</legend>
          {snapshot.members
            .filter((member) => member.role === "PLAYER")
            .map((member) => (
              <label key={member.id} className="inline-fields">
                <FormInput
                  type="checkbox"
                  checked={controllers.includes(member.id)}
                  onChange={(event) =>
                    setControllers((current) =>
                      event.target.checked
                        ? [...new Set([...current, member.id])]
                        : current.filter((id) => id !== member.id),
                    )
                  }
                />
                {member.displayName}
              </label>
            ))}
        </fieldset>
        {error && <div className="field-error">{error}</div>}
        <div className="dialog-actions">
          <Button type="submit" view="action" loading={saving}>
            Сохранить
          </Button>
          <Button type="button" onClick={onCancel} disabled={saving}>
            Отмена
          </Button>
        </div>
      </form>
    </ArkenDialog>
  );
}

function SetupPanel(props: Props) {
  const [characterName, setCharacterName] = useState("");
  const [sceneName, setSceneName] = useState("");
  const [renameMember, setRenameMember] = useState<
    GameSnapshot["members"][number] | null
  >(null);
  const [renameSceneOpen, setRenameSceneOpen] = useState(false);
  const [catalogEditor, setCatalogEditor] = useState<
    CatalogEntryDto | "NEW" | null
  >(null);
  // Kept only to preserve the pre-v2 editor while the new form is mounted;
  // the legacy JSON controls are hidden and can be removed after rollout.
  const [catalogName, setCatalogName] = useState("");
  const [catalogDescription, setCatalogDescription] = useState("");
  const [catalogKind, setCatalogKind] = useState<"SKILL" | "ABILITY">("SKILL");
  const [catalogData, setCatalogData] = useState("{}");
  const [inviteCharacter, setInviteCharacter] = useState(
    props.snapshot.characters[0]?.id ?? "",
  );
  const [tokenCharacter, setTokenCharacter] = useState(
    props.snapshot.characters[0]?.id ?? "",
  );
  const [inviteUrl, setInviteUrl] = useState("");
  const [playerAccess, setPlayerAccess] = useState<PlayerAccessDto[]>([]);
  const [previewMembership, setPreviewMembership] = useState(
    props.snapshot.members.find((member) => member.role === "PLAYER")?.id ?? "",
  );
  const activeScene = props.snapshot.scenes.find((scene) => scene.active);
  const maps = props.snapshot.assets.filter((asset) => asset.kind === "MAP");
  const refreshPlayerAccess = async () =>
    setPlayerAccess(await props.onListPlayerAccess());
  useEffect(() => {
    void refreshPlayerAccess();
    // The setup panel loads once; mutations refresh the list explicitly.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return (
    <section className="panel-section">
      <div className="section-heading">
        <div>
          <span className="eyebrow">Мастер</span>
          <h2>Подготовка</h2>
        </div>
      </div>
      <div className="subsection">
        <h3>Игроки онлайн</h3>
        <div className="stack-list">
          {props.snapshot.members
            .filter((member) => member.role === "PLAYER")
            .map((member) => {
              const online = props.presence.find(
                (item) => item.membershipId === member.id,
              )?.online;
              return (
                <Button key={member.id} onClick={() => setRenameMember(member)}>
                  {online ? "●" : "○"} {member.displayName}
                </Button>
              );
            })}
        </div>
      </div>
      <div className="subsection">
        <h3>Общий каталог</h3>
        <Button onClick={() => setCatalogEditor("NEW")}>
          Добавить навык или способность
        </Button>
        <div className="catalog-entry-list">
          {props.snapshot.catalogEntries.map((entry) => (
            <article className="plain-row" key={`v2-${entry.id}`}>
              <strong>{entry.name}</strong>
              <span className="eyebrow">
                {entry.kind === "SKILL" ? "Навык" : "Способность"}
              </span>
              {entry.description && <p>{entry.description}</p>}
              <div className="inline-fields">
                <Button onClick={() => setCatalogEditor(entry)}>
                  Редактировать
                </Button>
                <Button
                  className="danger-link"
                  onClick={() =>
                    void props.onDeleteCatalogEntry(entry.id, entry.revision)
                  }
                >
                  Удалить шаблон
                </Button>
              </div>
            </article>
          ))}
        </div>
        {catalogEditor && (
          <ArkenDialog
            open
            footer={false}
            title={
              catalogEditor === "NEW"
                ? "Новая запись каталога"
                : `Редактирование ${catalogEditor.name}`
            }
            onClose={() => setCatalogEditor(null)}
          >
            <CatalogEntryForm
              key={catalogEditor === "NEW" ? "new" : catalogEditor.id}
              existing={catalogEditor === "NEW" ? undefined : catalogEditor}
              onCancel={() => setCatalogEditor(null)}
              onSubmit={async (input: CatalogEntryFormInput) => {
                if (catalogEditor === "NEW")
                  await props.onCreateCatalogEntry(input);
                else
                  await props.onUpdateCatalogEntry(catalogEditor.id, {
                    ...input,
                    revision: catalogEditor.revision,
                  });
                setCatalogEditor(null);
              }}
            />
          </ArkenDialog>
        )}
        <div hidden aria-hidden="true">
          <FormSelect
            value={catalogKind}
            onChange={(event) =>
              setCatalogKind(event.target.value as "SKILL" | "ABILITY")
            }
          >
            <option value="SKILL">Навык</option>
            <option value="ABILITY">Способность</option>
          </FormSelect>
          <FormInput
            value={catalogName}
            placeholder="Название"
            onChange={(event) => setCatalogName(event.target.value)}
          />
          <FormTextArea
            value={catalogDescription}
            placeholder="Описание"
            onChange={(event) => setCatalogDescription(event.target.value)}
          />
          <FormTextArea
            value={catalogData}
            onChange={(event) => setCatalogData(event.target.value)}
            rows={8}
            aria-label="Данные и действия JSON"
          />
          <Button
            onClick={() =>
              setCatalogData(
                JSON.stringify(
                  {
                    rollActions: [
                      {
                        id: "hit",
                        kind: "HIT",
                        label: "Попадание",
                        dice: "1d20",
                        order: 0,
                        advantage: false,
                        consumeUse: false,
                        modifiers: [{ type: "CHARACTERISTIC", key: "agility" }],
                      },
                      {
                        id: "damage",
                        kind: "DAMAGE",
                        label: "Физический урон",
                        dice: "1d8",
                        order: 1,
                        advantage: false,
                        consumeUse: true,
                        modifiers: [
                          { type: "CHARACTERISTIC", key: "strength" },
                        ],
                      },
                    ],
                  },
                  null,
                  2,
                ),
              )
            }
          >
            Пресет: физический
          </Button>
          <Button
            onClick={() =>
              setCatalogData(
                JSON.stringify(
                  {
                    values: { magic: 0 },
                    rollActions: [
                      {
                        id: "hit",
                        kind: "HIT",
                        label: "Попадание",
                        dice: "1d20",
                        order: 0,
                        advantage: false,
                        consumeUse: false,
                        modifiers: [{ type: "CHARACTERISTIC", key: "agility" }],
                      },
                      {
                        id: "damage",
                        kind: "DAMAGE",
                        label: "Магический урон",
                        dice: "1d8",
                        order: 1,
                        advantage: false,
                        consumeUse: true,
                        modifiers: [{ type: "ENTRY_VALUE", key: "magic" }],
                      },
                    ],
                  },
                  null,
                  2,
                ),
              )
            }
          >
            Пресет: магический
          </Button>
          <Button
            disabled={!catalogName.trim()}
            onClick={async () => {
              let data: Record<string, unknown>;
              try {
                data = JSON.parse(catalogData) as Record<string, unknown>;
              } catch {
                return;
              }
              await props.onCreateCatalogEntry({
                kind: catalogKind,
                name: catalogName.trim(),
                description: catalogDescription,
                data,
              });
              setCatalogName("");
              setCatalogDescription("");
            }}
          >
            Добавить
          </Button>
          {props.snapshot.catalogEntries.map((entry) => (
            <div className="plain-row" key={entry.id}>
              <strong>{entry.name}</strong>
              <p>{entry.description}</p>
              <Button onClick={() => setCatalogEditor(entry)}>
                Редактировать шаблон
              </Button>
            </div>
          ))}
        </div>
      </div>
      <div className="subsection">
        <h3>Проверка видимости</h3>
        <label className="field">
          Игрок
          <FormSelect
            value={previewMembership}
            onChange={(event) => setPreviewMembership(event.target.value)}
          >
            <option value="">Выберите игрока</option>
            {props.snapshot.members
              .filter((member) => member.role === "PLAYER")
              .map((member) => (
                <option key={member.id} value={member.id}>
                  {member.displayName}
                </option>
              ))}
          </FormSelect>
        </label>
        <Button
          disabled={!previewMembership}
          onClick={() => props.onPreviewPlayer(previewMembership)}
        >
          Посмотреть глазами игрока
        </Button>
      </div>
      <div className="subsection" hidden aria-hidden="true">
        <h3>Сцены (устаревшее управление)</h3>
        <label className="field">
          Активная
          <FormSelect
            value={activeScene?.id ?? ""}
            onChange={(event) => props.onActivateScene(event.target.value)}
          >
            {props.snapshot.scenes.map((scene) => (
              <option key={scene.id} value={scene.id}>
                {scene.name}
              </option>
            ))}
          </FormSelect>
        </label>
        {activeScene && (
          <Button onClick={() => setRenameSceneOpen(true)}>
            Переименовать сцену
          </Button>
        )}
        {activeScene && (
          <label className="field">
            Фоновая карта
            <FormSelect
              value={activeScene.mapAssetId ?? ""}
              onChange={(event) =>
                props.onAssignMap(activeScene.id, event.target.value || null)
              }
            >
              <option value="">Без карты</option>
              {maps.map((map) => (
                <option key={map.id} value={map.id}>
                  {map.name}
                </option>
              ))}
            </FormSelect>
          </label>
        )}
        <form
          className="inline-fields"
          onSubmit={async (event) => {
            event.preventDefault();
            if (!sceneName) return;
            await props.onCreateScene(sceneName);
            setSceneName("");
          }}
        >
          <FormInput
            placeholder="Название сцены"
            value={sceneName}
            onChange={(event) => setSceneName(event.target.value)}
          />
          <Button>Создать</Button>
        </form>
      </div>
      <div className="subsection">
        <h3>Персонажи</h3>
        <form
          className="inline-fields"
          onSubmit={async (event) => {
            event.preventDefault();
            if (!characterName) return;
            await props.onCreateCharacter(characterName);
            setCharacterName("");
          }}
        >
          <FormInput
            placeholder="Имя персонажа"
            value={characterName}
            onChange={(event) => setCharacterName(event.target.value)}
          />
          <Button>Создать</Button>
        </form>
        <label className="field">
          Персонаж для токена
          <FormSelect
            value={tokenCharacter}
            onChange={(event) => setTokenCharacter(event.target.value)}
          >
            {props.snapshot.characters.map((character) => (
              <option key={character.id} value={character.id}>
                {character.name}
              </option>
            ))}
          </FormSelect>
        </label>
        <Button
          onClick={() => props.onCreateToken(tokenCharacter)}
          disabled={!tokenCharacter || !activeScene}
        >
          Добавить токен в центр
        </Button>
      </div>
      <div className="subsection">
        <h3>Постоянные ссылки игроков</h3>
        <label className="field">
          Персонаж
          <FormSelect
            value={inviteCharacter}
            onChange={(event) => setInviteCharacter(event.target.value)}
          >
            {props.snapshot.characters.map((character) => (
              <option key={character.id} value={character.id}>
                {character.name}
              </option>
            ))}
          </FormSelect>
        </label>
        <Button
          onClick={async () => {
            const result = await props.onCreateInvite(
              inviteCharacter,
              props.snapshot.characters.find(
                (item) => item.id === inviteCharacter,
              )?.name ?? "Игрок",
            );
            setInviteUrl(result.url ?? "");
            await refreshPlayerAccess();
          }}
          disabled={!inviteCharacter}
        >
          Создать постоянную ссылку
        </Button>
        {inviteUrl && (
          <div className="copy-field">
            <FormInput readOnly value={inviteUrl} />
            <Button onClick={() => navigator.clipboard.writeText(inviteUrl)}>
              Копировать
            </Button>
            <Button onClick={() => setInviteUrl("")}>Скрыть</Button>
          </div>
        )}
        {playerAccess.map((grant) => (
          <div className="inline-fields" key={grant.id}>
            <span>
              {grant.label} {grant.revokedAt ? "(отозвана)" : ""}
            </span>
            {!grant.revokedAt && (
              <>
                <Button
                  onClick={async () => {
                    const result = await props.onRotatePlayerAccess(grant.id);
                    setInviteUrl(result.url ?? "");
                    await refreshPlayerAccess();
                  }}
                >
                  Заменить ссылку
                </Button>
                <Button
                  onClick={async () => {
                    await props.onRevokePlayerAccess(grant.id);
                    setInviteUrl("");
                    await refreshPlayerAccess();
                  }}
                >
                  Отозвать
                </Button>
              </>
            )}
          </div>
        ))}
      </div>
      <TextPromptDialog
        open={Boolean(renameMember)}
        title="Переименовать игрока"
        label="Имя игрока"
        initialValue={renameMember?.displayName ?? ""}
        onClose={() => setRenameMember(null)}
        onApply={async (name) => {
          if (!renameMember) return;
          const target = renameMember;
          await props.onRenameMembership(target.id, target.revision ?? 0, name);
          setRenameMember(null);
        }}
      />
      <TextPromptDialog
        open={renameSceneOpen}
        title="Переименовать сцену"
        label="Название сцены"
        initialValue={activeScene?.name ?? ""}
        onClose={() => setRenameSceneOpen(false)}
        onApply={async (name) => {
          if (!activeScene) return;
          await props.onRenameScene(
            activeScene.id,
            activeScene.revision ?? 0,
            name,
          );
          setRenameSceneOpen(false);
        }}
      />
    </section>
  );
}

function MediaPanel({
  snapshot,
  onUpload,
}: {
  snapshot: GameSnapshot;
  onUpload: Props["onUpload"];
}) {
  const [drafts, setDrafts] = useState<Partial<Record<AssetKind, File>>>({});
  const [uploading, setUploading] = useState<AssetKind | null>(null);
  const [error, setError] = useState("");
  const allowed = useMemo<AssetKind[]>(
    () =>
      snapshot.me.role === "GM"
        ? ["MAP", "TOKEN", "PORTRAIT", "IMAGE", "AUDIO"]
        : ["TOKEN", "PORTRAIT"],
    [snapshot.me.role],
  );
  const labels: Record<AssetKind, string> = {
    MAP: "Карты",
    TOKEN: "Изображения токенов",
    PORTRAIT: "Портреты персонажей",
    IMAGE: "Другие изображения",
    AUDIO: "Музыка и звуки",
  };
  const upload = async (kind: AssetKind) => {
    const file = drafts[kind];
    if (!file) return;
    setUploading(kind);
    setError("");
    try {
      await onUpload(file, kind);
      setDrafts((current) => ({ ...current, [kind]: undefined }));
    } catch (reason) {
      setError(
        reason instanceof Error ? reason.message : "Не удалось загрузить файл.",
      );
    } finally {
      setUploading(null);
    }
  };
  return (
    <section className="panel-section">
      <div className="section-heading">
        <div>
          <span className="eyebrow">Хранилище</span>
          <h2>Файлы</h2>
        </div>
        <span className="revision">{snapshot.assets.length}</span>
      </div>
      <div className="upload-sections">
        {allowed.map((kind) => (
          <section className="upload-section" key={kind}>
            <ImageUploadField
              label={labels[kind]}
              value={drafts[kind]}
              accept={
                kind === "AUDIO"
                  ? ".mp3,.ogg,audio/mpeg,audio/ogg"
                  : ".png,.jpg,.jpeg,.webp,image/png,image/jpeg,image/webp"
              }
              hint={kind === "AUDIO" ? "MP3 или OGG" : "PNG, JPEG или WebP"}
              disabled={uploading !== null}
              onUpdate={(file) =>
                setDrafts((current) => ({ ...current, [kind]: file }))
              }
            />
            <Button
              view="action"
              disabled={!drafts[kind] || uploading !== null}
              loading={uploading === kind}
              onClick={() => void upload(kind)}
            >
              Загрузить
            </Button>
          </section>
        ))}
      </div>
      {error && <div className="field-error">{error}</div>}
      <div className="asset-list">
        {snapshot.assets.map((asset) => (
          <div className="asset-row" key={asset.id}>
            {asset.kind !== "AUDIO" ? (
              <img className="asset-thumbnail" src={asset.url} alt="" />
            ) : (
              <span>{asset.kind}</span>
            )}
            <div>
              <strong>{asset.name}</strong>
              <small>{(asset.sizeBytes / 1024 / 1024).toFixed(1)} МБ</small>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

function Empty({ title, text }: { title: string; text: string }) {
  return (
    <div className="empty">
      <strong>{title}</strong>
      <p>{text}</p>
    </div>
  );
}

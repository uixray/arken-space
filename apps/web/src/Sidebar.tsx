import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type FormEvent,
} from "react";
import type {
  AssetKind,
  CatalogEntryDto,
  CharacterDto,
  GameSnapshot,
  MessageVisibility,
  PlayerAccessDto,
  PlayerAccessSecretDto,
} from "@arken/contracts";
import { arkenSystem } from "@arken/system";
import { Button } from "@gravity-ui/uikit";
import { MusicBar } from "./MusicBar";
import {
  CatalogEntryForm,
  type CatalogEntryFormInput,
} from "./CatalogEntryForm";
import type { GameSocket } from "./realtime";
import { ApiError } from "./api";
import { ConfirmDialog } from "./ui/ConfirmDialog";
import { TextPromptDialog } from "./ui/TextPromptDialog";
import { ArkenDialog } from "./ui/ArkenDialog";
import { FormInput, FormSelect, FormTextArea } from "./ui/GravityFormControls";

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
    patch: { defaultAssetId?: string | null; characterId?: string | null },
  ) => Promise<void>;
  onPatchCharacter: (id: string, patch: Partial<CharacterDto>) => Promise<void>;
  onChat: (body: string, visibility: MessageVisibility) => Promise<void>;
  onRoll: (
    formula: string,
    label?: string,
    visibility?: MessageVisibility,
    characterId?: string | null,
  ) => Promise<void>;
  onCreateCharacter: (name: string) => Promise<void>;
  onCreateInvite: (
    characterId: string,
    label: string,
  ) => Promise<PlayerAccessSecretDto>;
  onListPlayerAccess: () => Promise<PlayerAccessDto[]>;
  onRotatePlayerAccess: (id: string) => Promise<PlayerAccessSecretDto>;
  onRevokePlayerAccess: (id: string) => Promise<void>;
  onCreateScene: (name: string) => Promise<void>;
  onActivateScene: (sceneId: string) => Promise<void>;
  onAssignMap: (sceneId: string, assetId: string | null) => Promise<void>;
  onRenameScene: (
    sceneId: string,
    revision: number,
    name: string,
  ) => Promise<void>;
  onRenameMembership: (
    membershipId: string,
    revision: number,
    name: string,
  ) => Promise<void>;
  onCreateToken: (characterId: string) => Promise<void>;
  onUpload: (file: File, kind: AssetKind) => Promise<void>;
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
  ) => Promise<void>;
  onCampaignClock: (
    command: "ADVANCE_DAY" | "START_BATTLE" | "END_BATTLE",
    revision: number,
  ) => Promise<void>;
  requestedChatMessageId: string | null;
  onRequestedChatMessageHandled: () => void;
  onChatVisibilityChange: (visible: boolean) => void;
};

export function Sidebar(props: Props) {
  const {
    onChatVisibilityChange,
    onRequestedChatMessageHandled,
    requestedChatMessageId,
  } = props;
  const isGm = props.snapshot.me.role === "GM";
  const [tab, setTab] = useState<
    "character" | "chat" | "palette" | "music" | "setup" | "media"
  >(isGm ? "setup" : "chat");
  const [playerCharacterOpen, setPlayerCharacterOpen] = useState(false);
  const playerCharacterButtonRef = useRef<HTMLButtonElement>(null);
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
    setTab("chat");
  };
  const chatVisible = tab === "chat";
  useEffect(
    () => onChatVisibilityChange(chatVisible),
    [chatVisible, onChatVisibilityChange],
  );
  useEffect(() => {
    if (!requestedChatMessageId) return;
    setFocusedMessageId(requestedChatMessageId);
    setTab("chat");
    onRequestedChatMessageHandled();
  }, [requestedChatMessageId, onRequestedChatMessageHandled]);
  useEffect(() => {
    if (!playerCharacterOpen) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setPlayerCharacterOpen(false);
      playerCharacterButtonRef.current?.focus();
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [playerCharacterOpen]);

  return (
    <aside className={`sidebar ${!isGm ? "player-sidebar" : ""}`}>
      <nav className="tabs" aria-label="Панели">
        <Button
          view="flat"
          ref={playerCharacterButtonRef}
          aria-pressed={!isGm ? playerCharacterOpen : tab === "character"}
          onClick={() =>
            isGm
              ? setTab("character")
              : setPlayerCharacterOpen((current) => !current)
          }
        >
          Персонаж
        </Button>
        <Button
          view="flat"
          aria-pressed={tab === "chat"}
          onClick={() => openChat()}
        >
          Чат <span>{props.snapshot.messages.length}</span>
        </Button>
        <Button
          view="flat"
          aria-pressed={tab === "palette"}
          onClick={() => setTab("palette")}
        >
          Токены
        </Button>
        <Button
          view="flat"
          aria-pressed={tab === "music"}
          onClick={() => setTab("music")}
        >
          Музыка
        </Button>
        {isGm && (
          <Button
            view="flat"
            aria-pressed={tab === "setup"}
            onClick={() => setTab("setup")}
          >
            Подготовка
          </Button>
        )}
        <Button
          view="flat"
          aria-pressed={tab === "media"}
          onClick={() => setTab("media")}
        >
          Файлы
        </Button>
      </nav>
      <div className={`panel-scroll ${tab === "chat" ? "chat-scroll" : ""}`}>
        {tab === "character" && isGm && (
          <ArkenDialog
            open
            footer={false}
            title="Персонажи"
            onClose={() => setTab("chat")}
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
            />
          </ArkenDialog>
        )}
        {tab === "chat" && (
          <ChatPanel
            snapshot={props.snapshot}
            onChat={props.onChat}
            onRoll={props.onRoll}
            focusedMessageId={focusedMessageId}
            onMessageFocused={() => setFocusedMessageId(null)}
          />
        )}
        {tab === "palette" && <PalettePanel {...props} />}
        <div hidden={tab !== "music"}>
          <MusicBar
            audio={props.snapshot.audio}
            assets={props.snapshot.assets}
            role={props.snapshot.me.role}
            socket={props.socket}
          />
        </div>
        {tab === "setup" && isGm && <SetupPanel {...props} />}
        {tab === "media" && (
          <MediaPanel snapshot={props.snapshot} onUpload={props.onUpload} />
        )}
      </div>
      {!isGm && playerCharacterOpen && (
        <aside className="player-character-drawer" aria-label="Персонаж">
          <div className="drawer-heading">
            <strong>Персонаж</strong>
            <Button
              aria-label="Закрыть персонажа"
              onClick={() => {
                setPlayerCharacterOpen(false);
                playerCharacterButtonRef.current?.focus();
              }}
            >
              ×
            </Button>
          </div>
          <div className="panel-scroll">
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
            />
          </div>
        </aside>
      )}
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
}) {
  const [countersPending, setCountersPending] = useState(false);
  const [countersError, setCountersError] = useState("");
  const [entryEditor, setEntryEditor] = useState<
    CharacterDto["entries"][number] | null
  >(null);
  const [renameOpen, setRenameOpen] = useState(false);
  const [walletDraft, setWalletDraft] = useState(
    () => character?.wallet ?? { gold: 0, silver: 0, copper: 0, sp: 0 },
  );
  useEffect(() => {
    if (character) setWalletDraft(character.wallet);
  }, [character]);
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
    if (
      countersPending ||
      (Object.keys(nextWallet) as Array<keyof CharacterDto["wallet"]>).every(
        (key) => nextWallet[key] === character.wallet[key],
      )
    )
      return;
    setWalletDraft(nextWallet);
    setCountersPending(true);
    setCountersError("");
    try {
      await onUpdateCounters(character.id, character.revision, {
        wallet: nextWallet,
      });
    } catch (reason) {
      setWalletDraft(character.wallet);
      setCountersError(
        reason instanceof ApiError && reason.code === "CHARACTER_CONFLICT"
          ? "Кошелёк уже изменён в другой сессии. Значения обновлены — повторите действие."
          : "Не удалось сохранить кошелёк. Проверьте соединение и повторите действие.",
      );
    } finally {
      setCountersPending(false);
    }
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
          defaultValue={JSON.stringify(character.resources, null, 2)}
          disabled={!editable}
          rows={5}
          onBlur={(event) => {
            const textarea = event.currentTarget;
            try {
              const resources = JSON.parse(
                event.target.value,
              ) as CharacterDto["resources"];
              if (
                JSON.stringify(resources) ===
                JSON.stringify(character.resources)
              )
                return;
              void onUpdateCounters(character.id, character.revision, {
                resources,
              }).catch(() => {
                textarea.value = JSON.stringify(character.resources, null, 2);
                setCountersError(
                  "Не удалось сохранить ресурсы. Проверьте данные и соединение.",
                );
              });
            } catch {
              event.target.value = JSON.stringify(character.resources, null, 2);
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
              disabled={!editable || countersPending || walletDraft[key] === 0}
              onPointerDown={(event) => event.preventDefault()}
              onClick={() =>
                void saveWallet({
                  ...walletDraft,
                  [key]: Math.max(0, walletDraft[key] - 1),
                })
              }
            >
              −
            </Button>
            <FormInput
              type="number"
              min={0}
              value={walletDraft[key]}
              disabled={!editable || countersPending}
              onChange={(event) =>
                setWalletDraft((current) => ({
                  ...current,
                  [key]: Math.max(
                    0,
                    Number.parseInt(event.target.value || "0", 10),
                  ),
                }))
              }
              onBlur={() => void saveWallet(walletDraft)}
            />
            <Button
              disabled={!editable || countersPending}
              onPointerDown={(event) => event.preventDefault()}
              onClick={() =>
                void saveWallet({ ...walletDraft, [key]: walletDraft[key] + 1 })
              }
            >
              +
            </Button>
          </span>
        ))}
        {countersPending && <span className="muted">Сохраняем…</span>}
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
  const [text, setText] = useState("");
  const [formula, setFormula] = useState("2d6");
  const [visibility, setVisibility] = useState<MessageVisibility>("PUBLIC");
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
    if (!text.trim()) return;
    await onChat(text, visibility);
    setText("");
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
                <div>{message.body}</div>
                <small>{formatDiceBreakdown(message.dice)}</small>
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
        <div className="inline-fields">
          <FormInput
            aria-label="Формула броска"
            value={formula}
            onChange={(event) => setFormula(event.target.value)}
          />
          <Button
            onClick={() =>
              onRoll(formula, undefined, visibility, snapshot.me.characterId)
            }
          >
            Бросить
          </Button>
        </div>
        <div className="inline-fields">
          {[2, 4, 8, 12, 20].map((sides) => (
            <Button
              key={sides}
              onClick={() =>
                onRoll(
                  `1d${sides}`,
                  `d${sides}`,
                  visibility,
                  snapshot.me.characterId,
                )
              }
            >
              d{sides}
            </Button>
          ))}
        </div>
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
          aria-label="Сообщение"
          placeholder="Сообщение…"
          value={text}
          onChange={(event) => setText(event.target.value)}
          rows={3}
        />
        <Button className="primary">Отправить</Button>
      </form>
    </section>
  );
}

function PalettePanel(props: Props) {
  const definitions = props.snapshot.tokenDefinitions ?? [];
  const [deleteDefinition, setDeleteDefinition] = useState<
    (typeof definitions)[number] | null
  >(null);
  if (!definitions.length)
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
                <strong>{definition.name}</strong>
              </Button>
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
              {props.snapshot.me.role === "GM" && (
                <Button
                  className="danger-link"
                  onClick={() => setDeleteDefinition(definition)}
                >
                  Удалить определение и все размещения
                </Button>
              )}
            </article>
          );
        })}
      </div>
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
      <div className="subsection">
        <h3>Сцены</h3>
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
  const [kind, setKind] = useState<AssetKind>(
    snapshot.me.role === "GM" ? "MAP" : "PORTRAIT",
  );
  const allowed = useMemo<AssetKind[]>(
    () =>
      snapshot.me.role === "GM"
        ? ["MAP", "TOKEN", "PORTRAIT", "IMAGE", "AUDIO"]
        : ["TOKEN", "PORTRAIT"],
    [snapshot.me.role],
  );
  const upload = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) await onUpload(file, kind);
    event.target.value = "";
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
      <div className="upload-row">
        <FormSelect
          value={kind}
          onChange={(event) => setKind(event.target.value as AssetKind)}
        >
          {allowed.map((item) => (
            <option key={item} value={item}>
              {item}
            </option>
          ))}
        </FormSelect>
        <label className="file-button">
          Загрузить
          <FormInput
            type="file"
            accept={
              kind === "AUDIO"
                ? ".mp3,.ogg,audio/mpeg,audio/ogg"
                : ".png,.jpg,.jpeg,.webp,image/png,image/jpeg,image/webp"
            }
            onChange={upload}
          />
        </label>
      </div>
      <div className="asset-list">
        {snapshot.assets.map((asset) => (
          <div className="asset-row" key={asset.id}>
            <span>{asset.kind}</span>
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

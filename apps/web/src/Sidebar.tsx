import {
  useEffect,
  useMemo,
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

type Props = {
  snapshot: GameSnapshot;
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
    },
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
};

export function Sidebar(props: Props) {
  const isGm = props.snapshot.me.role === "GM";
  const [tab, setTab] = useState<"character" | "chat" | "setup" | "media">(
    isGm ? "setup" : "character",
  );
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

  return (
    <aside className="sidebar">
      <nav className="tabs" aria-label="Панели">
        <button
          aria-pressed={tab === "character"}
          onClick={() => setTab("character")}
        >
          Персонаж
        </button>
        <button aria-pressed={tab === "chat"} onClick={() => setTab("chat")}>
          Чат <span>{props.snapshot.messages.length}</span>
        </button>
        {isGm && (
          <button
            aria-pressed={tab === "setup"}
            onClick={() => setTab("setup")}
          >
            Подготовка
          </button>
        )}
        <button aria-pressed={tab === "media"} onClick={() => setTab("media")}>
          Файлы
        </button>
      </nav>
      <div className="panel-scroll">
        {tab === "character" && (
          <CharacterPanel
            snapshot={props.snapshot}
            character={selectedCharacter}
            selectedId={selectedCharacterId}
            setSelectedId={setSelectedCharacterId}
            onPatch={props.onPatchCharacter}
            onRoll={props.onRoll}
            onAssignEntry={props.onAssignCatalogEntry}
            onUpdateEntry={props.onUpdateCharacterEntry}
            onRollEntry={props.onRollEntry}
            onRechargeEntry={props.onRechargeEntry}
            onUpdateCounters={props.onUpdateCounters}
            onCampaignClock={props.onCampaignClock}
          />
        )}
        {tab === "chat" && (
          <ChatPanel
            snapshot={props.snapshot}
            onChat={props.onChat}
            onRoll={props.onRoll}
          />
        )}
        {tab === "setup" && isGm && <SetupPanel {...props} />}
        {tab === "media" && (
          <MediaPanel snapshot={props.snapshot} onUpload={props.onUpload} />
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
  onRollEntry: Props["onRollEntry"];
  onRechargeEntry: Props["onRechargeEntry"];
  onUpdateCounters: Props["onUpdateCounters"];
  onCampaignClock: Props["onCampaignClock"];
}) {
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
  return (
    <section className="panel-section">
      {snapshot.me.role === "GM" && (
        <label className="field">
          Персонаж
          <select
            value={selectedId}
            onChange={(event) => setSelectedId(event.target.value)}
          >
            {snapshot.characters.map((item) => (
              <option key={item.id} value={item.id}>
                {item.name}
              </option>
            ))}
          </select>
        </label>
      )}
      <div className="section-heading">
        <div>
          <span className="eyebrow">Карточка</span>
          <h2>{character.name}</h2>
        </div>
        <span className="revision">rev {character.revision}</span>
      </div>
      {snapshot.me.role === "GM" && (
        <div className="subsection">
          <h3>Время кампании</h3>
          <p>
            День {snapshot.campaign.day} ·{" "}
            {snapshot.campaign.battleActive
              ? `бой #${snapshot.campaign.battleCounter}`
              : "вне боя"}
          </p>
          <button
            onClick={() =>
              onCampaignClock("ADVANCE_DAY", snapshot.campaign.revision)
            }
          >
            Следующий день
          </button>
          <button
            onClick={() =>
              onCampaignClock(
                snapshot.campaign.battleActive ? "END_BATTLE" : "START_BATTLE",
                snapshot.campaign.revision,
              )
            }
          >
            {snapshot.campaign.battleActive ? "Завершить бой" : "Начать бой"}
          </button>
        </div>
      )}
      <details className="subsection">
        <summary>Предыстория</summary>
        <textarea
          defaultValue={character.backstory}
          disabled={!editable}
          rows={8}
          onBlur={(event) =>
            onPatch(character.id, { backstory: event.target.value })
          }
        />
      </details>
      <div className="stats-grid">
        {arkenSystem.stats.map((stat) => (
          <label key={stat.key} className="stat-field">
            <span title={stat.label}>{stat.shortLabel}</span>
            <input
              key={`${character.id}-${stat.key}-${character.revision}`}
              type="number"
              defaultValue={character.stats[stat.key] ?? stat.defaultValue}
              disabled={!editable}
              min={stat.min}
              max={stat.max}
              onBlur={(event) =>
                onPatch(character.id, {
                  stats: {
                    ...character.stats,
                    [stat.key]: Number(event.target.value),
                  },
                })
              }
            />
            <button
              disabled={!editable}
              onClick={() =>
                onRoll(`1d20 + ${stat.key}`, stat.label, "PUBLIC", character.id)
              }
            >
              Бросок
            </button>
          </label>
        ))}
      </div>
      <button
        onClick={() =>
          onRoll("1d20 + agility", "Инициатива", "PUBLIC", character.id)
        }
      >
        Инициатива (d20 + Ловкость)
      </button>
      <div className="subsection">
        <h3>Навыки</h3>
        {character.skills.length ? (
          character.skills.map((skill) => (
            <button
              className="action-row"
              key={skill.key}
              onClick={() =>
                onRoll(skill.formula, skill.name, "PUBLIC", character.id)
              }
            >
              <span>{skill.name}</span>
              <code>{skill.formula}</code>
            </button>
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
                <button
                  onClick={() =>
                    onRoll(spell.formula!, spell.name, "PUBLIC", character.id)
                  }
                >
                  Бросить {spell.formula}
                </button>
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
          <select
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
          </select>
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
                  <button
                    disabled={!editable}
                    onClick={() =>
                      onRechargeEntry(character.id, entry.id, entry.revision)
                    }
                  >
                    Перезарядить
                  </button>
                </p>
              )}
              {[...(entry.data.rollActions ?? [])]
                .sort((a, b) => a.order - b.order)
                .map((action) => (
                  <button
                    key={action.id}
                    disabled={!editable || (entry.data.uses?.current ?? 1) < 1}
                    onClick={() =>
                      onRollEntry(character.id, entry.id, action.id)
                    }
                  >
                    {action.label} · {action.kind}
                  </button>
                ))}
              {snapshot.me.role === "GM" && (
                <button
                  onClick={() => {
                    const kind = window.prompt(
                      "Тип: SKILL или ABILITY",
                      entry.kind,
                    );
                    if (kind !== "SKILL" && kind !== "ABILITY") return;
                    const name = window.prompt("Название", entry.name);
                    if (!name?.trim()) return;
                    const description = window.prompt(
                      "Описание",
                      entry.description,
                    );
                    if (description === null) return;
                    const raw = window.prompt(
                      "Данные JSON",
                      JSON.stringify(entry.data, null, 2),
                    );
                    if (raw === null) return;
                    try {
                      void onUpdateEntry(character.id, entry.id, {
                        kind,
                        name: name.trim(),
                        description,
                        data: JSON.parse(raw) as Record<string, unknown>,
                      });
                    } catch {
                      window.alert("Некорректный JSON");
                    }
                  }}
                >
                  Редактировать запись
                </button>
              )}
            </div>
          ))
        ) : (
          <p className="muted">
            Мастер ещё не назначил навыки или способности.
          </p>
        )}
      </div>
      <label className="field">
        Инвентарь (один предмет на строку)
        <textarea
          defaultValue={character.inventory.join("\n")}
          disabled={!editable}
          rows={5}
          onBlur={(event) =>
            onPatch(character.id, {
              inventory: event.target.value
                .split("\n")
                .map((item) => item.trim())
                .filter(Boolean),
            })
          }
        />
      </label>
      <label className="field">
        Ресурсы (JSON: имя → current/maximum)
        <textarea
          defaultValue={JSON.stringify(character.resources, null, 2)}
          disabled={!editable}
          rows={5}
          onBlur={(event) => {
            try {
              const resources = JSON.parse(
                event.target.value,
              ) as CharacterDto["resources"];
              void onUpdateCounters(character.id, character.revision, {
                resources,
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
            <button
              disabled={!editable || character.wallet[key] === 0}
              onClick={() =>
                onUpdateCounters(character.id, character.revision, {
                  wallet: {
                    ...character.wallet,
                    [key]: character.wallet[key] - 1,
                  },
                })
              }
            >
              −
            </button>
            <input
              type="number"
              min={0}
              defaultValue={character.wallet[key]}
              disabled={!editable}
              onBlur={(event) =>
                onUpdateCounters(character.id, character.revision, {
                  wallet: {
                    ...character.wallet,
                    [key]: Math.max(
                      0,
                      Number.parseInt(event.target.value || "0", 10),
                    ),
                  },
                })
              }
            />
            <button
              disabled={!editable}
              onClick={() =>
                onUpdateCounters(character.id, character.revision, {
                  wallet: {
                    ...character.wallet,
                    [key]: character.wallet[key] + 1,
                  },
                })
              }
            >
              +
            </button>
          </span>
        ))}
      </label>
      <label className="field">
        Заметки
        <textarea
          defaultValue={character.notes}
          disabled={!editable}
          rows={7}
          onBlur={(event) =>
            onPatch(character.id, { notes: event.target.value })
          }
        />
      </label>
    </section>
  );
}

function ChatPanel({
  snapshot,
  onChat,
  onRoll,
}: {
  snapshot: GameSnapshot;
  onChat: Props["onChat"];
  onRoll: Props["onRoll"];
}) {
  const [text, setText] = useState("");
  const [formula, setFormula] = useState("2d6");
  const [visibility, setVisibility] = useState<MessageVisibility>("PUBLIC");
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!text.trim()) return;
    await onChat(text, visibility);
    setText("");
  };
  return (
    <section className="chat-panel">
      <div className="message-list" aria-live="polite">
        {snapshot.messages.map((message) => (
          <article
            className={`message ${message.kind.toLowerCase()}`}
            key={message.id}
          >
            <header>
              <strong>{message.displayName}</strong>
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
                <b>{message.dice.total}</b>
                <div>{message.body}</div>
                <small>
                  {message.dice.terms.flatMap((term) => term.rolls).join(", ")}{" "}
                  · {message.dice.resolvedFormula}
                </small>
              </div>
            ) : (
              <p>{message.body}</p>
            )}
          </article>
        ))}
      </div>
      <div className="chat-tools">
        <div className="inline-fields">
          <input
            aria-label="Формула броска"
            value={formula}
            onChange={(event) => setFormula(event.target.value)}
          />
          <button
            onClick={() =>
              onRoll(formula, undefined, visibility, snapshot.me.characterId)
            }
          >
            Бросить
          </button>
        </div>
        <div className="inline-fields">
          {[2, 4, 8, 12, 20].map((sides) => (
            <button
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
            </button>
          ))}
        </div>
        <label className="compact-check">
          <input
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
        <textarea
          aria-label="Сообщение"
          placeholder="Сообщение…"
          value={text}
          onChange={(event) => setText(event.target.value)}
          rows={3}
        />
        <button className="primary">Отправить</button>
      </form>
    </section>
  );
}

function SetupPanel(props: Props) {
  const [characterName, setCharacterName] = useState("");
  const [sceneName, setSceneName] = useState("");
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
        <h3>Общий каталог</h3>
        <select
          value={catalogKind}
          onChange={(event) =>
            setCatalogKind(event.target.value as "SKILL" | "ABILITY")
          }
        >
          <option value="SKILL">Навык</option>
          <option value="ABILITY">Способность</option>
        </select>
        <input
          value={catalogName}
          placeholder="Название"
          onChange={(event) => setCatalogName(event.target.value)}
        />
        <textarea
          value={catalogDescription}
          placeholder="Описание"
          onChange={(event) => setCatalogDescription(event.target.value)}
        />
        <textarea
          value={catalogData}
          onChange={(event) => setCatalogData(event.target.value)}
          rows={8}
          aria-label="Данные и действия JSON"
        />
        <button
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
                      modifiers: [{ type: "CHARACTERISTIC", key: "agility" }],
                    },
                    {
                      id: "damage",
                      kind: "DAMAGE",
                      label: "Физический урон",
                      dice: "1d8",
                      order: 1,
                      advantage: false,
                      modifiers: [{ type: "CHARACTERISTIC", key: "strength" }],
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
        </button>
        <button
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
                      modifiers: [{ type: "CHARACTERISTIC", key: "agility" }],
                    },
                    {
                      id: "damage",
                      kind: "DAMAGE",
                      label: "Магический урон",
                      dice: "1d8",
                      order: 1,
                      advantage: false,
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
        </button>
        <button
          disabled={!catalogName.trim()}
          onClick={async () => {
            let data: Record<string, unknown>;
            try {
              data = JSON.parse(catalogData) as Record<string, unknown>;
            } catch {
              window.alert("Некорректный JSON");
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
        </button>
        {props.snapshot.catalogEntries.map((entry) => (
          <div className="plain-row" key={entry.id}>
            <strong>{entry.name}</strong>
            <p>{entry.description}</p>
            <button
              onClick={() => {
                const kind = window.prompt(
                  "Тип: SKILL или ABILITY",
                  entry.kind,
                );
                if (kind !== "SKILL" && kind !== "ABILITY") return;
                const name = window.prompt("Название", entry.name);
                if (!name?.trim()) return;
                const description = window.prompt(
                  "Описание",
                  entry.description,
                );
                if (description === null) return;
                const raw = window.prompt(
                  "Данные JSON",
                  JSON.stringify(entry.data, null, 2),
                );
                if (raw === null) return;
                try {
                  void props.onUpdateCatalogEntry(entry.id, {
                    kind,
                    name: name.trim(),
                    description,
                    data: JSON.parse(raw) as Record<string, unknown>,
                  });
                } catch {
                  window.alert("Некорректный JSON");
                }
              }}
            >
              Редактировать шаблон
            </button>
          </div>
        ))}
      </div>
      <div className="subsection">
        <h3>Проверка видимости</h3>
        <label className="field">
          Игрок
          <select
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
          </select>
        </label>
        <button
          disabled={!previewMembership}
          onClick={() => props.onPreviewPlayer(previewMembership)}
        >
          Посмотреть глазами игрока
        </button>
      </div>
      <div className="subsection">
        <h3>Сцены</h3>
        <label className="field">
          Активная
          <select
            value={activeScene?.id ?? ""}
            onChange={(event) => props.onActivateScene(event.target.value)}
          >
            {props.snapshot.scenes.map((scene) => (
              <option key={scene.id} value={scene.id}>
                {scene.name}
              </option>
            ))}
          </select>
        </label>
        {activeScene && (
          <label className="field">
            Фоновая карта
            <select
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
            </select>
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
          <input
            placeholder="Название сцены"
            value={sceneName}
            onChange={(event) => setSceneName(event.target.value)}
          />
          <button>Создать</button>
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
          <input
            placeholder="Имя персонажа"
            value={characterName}
            onChange={(event) => setCharacterName(event.target.value)}
          />
          <button>Создать</button>
        </form>
        <label className="field">
          Персонаж для токена
          <select
            value={tokenCharacter}
            onChange={(event) => setTokenCharacter(event.target.value)}
          >
            {props.snapshot.characters.map((character) => (
              <option key={character.id} value={character.id}>
                {character.name}
              </option>
            ))}
          </select>
        </label>
        <button
          onClick={() => props.onCreateToken(tokenCharacter)}
          disabled={!tokenCharacter || !activeScene}
        >
          Добавить токен в центр
        </button>
      </div>
      <div className="subsection">
        <h3>Постоянные ссылки игроков</h3>
        <label className="field">
          Персонаж
          <select
            value={inviteCharacter}
            onChange={(event) => setInviteCharacter(event.target.value)}
          >
            {props.snapshot.characters.map((character) => (
              <option key={character.id} value={character.id}>
                {character.name}
              </option>
            ))}
          </select>
        </label>
        <button
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
        </button>
        {inviteUrl && (
          <div className="copy-field">
            <input readOnly value={inviteUrl} />
            <button onClick={() => navigator.clipboard.writeText(inviteUrl)}>
              Копировать
            </button>
            <button onClick={() => setInviteUrl("")}>Скрыть</button>
          </div>
        )}
        {playerAccess.map((grant) => (
          <div className="inline-fields" key={grant.id}>
            <span>
              {grant.label} {grant.revokedAt ? "(отозвана)" : ""}
            </span>
            {!grant.revokedAt && (
              <>
                <button
                  onClick={async () => {
                    const result = await props.onRotatePlayerAccess(grant.id);
                    setInviteUrl(result.url ?? "");
                    await refreshPlayerAccess();
                  }}
                >
                  Заменить ссылку
                </button>
                <button
                  onClick={async () => {
                    await props.onRevokePlayerAccess(grant.id);
                    setInviteUrl("");
                    await refreshPlayerAccess();
                  }}
                >
                  Отозвать
                </button>
              </>
            )}
          </div>
        ))}
      </div>
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
        <select
          value={kind}
          onChange={(event) => setKind(event.target.value as AssetKind)}
        >
          {allowed.map((item) => (
            <option key={item} value={item}>
              {item}
            </option>
          ))}
        </select>
        <label className="file-button">
          Загрузить
          <input
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

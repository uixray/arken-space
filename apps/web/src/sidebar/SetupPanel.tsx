import { useEffect, useState } from "react";
import type {
  CatalogEntryDto,
  GameSnapshot,
  PlayerAccessDto,
} from "@arken/contracts";
import { Button } from "@gravity-ui/uikit";
import {
  CatalogEntryForm,
  type CatalogEntryFormInput,
} from "../CatalogEntryForm";
import { ArkenDialog } from "../ui/ArkenDialog";
import { FormInput, FormSelect, FormTextArea } from "../ui/GravityFormControls";
import { TextPromptDialog } from "../ui/TextPromptDialog";
import type { Props } from "../Sidebar";

export function SetupPanel(props: Props) {
  const [activeSetupTab, setActiveSetupTab] = useState<
    "OVERVIEW" | "CHARACTERS" | "CATALOG"
  >("OVERVIEW");
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
      <nav className="setup-tabs" aria-label="Разделы подготовки">
        {[
          ["OVERVIEW", "Обзор"],
          ["CHARACTERS", "Персонажи и доступ"],
          ["CATALOG", "Общий каталог"],
        ].map(([id, label]) => (
          <Button
            key={id}
            view={activeSetupTab === id ? "action" : "normal"}
            aria-pressed={activeSetupTab === id}
            onClick={() =>
              setActiveSetupTab(id as "OVERVIEW" | "CHARACTERS" | "CATALOG")
            }
          >
            {label}
          </Button>
        ))}
      </nav>
      <div className="subsection" hidden={activeSetupTab !== "OVERVIEW"}>
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
      <div className="subsection" hidden={activeSetupTab !== "CATALOG"}>
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
      <div className="subsection" hidden={activeSetupTab !== "OVERVIEW"}>
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
      <div className="subsection" hidden={activeSetupTab !== "CHARACTERS"}>
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
      <div className="subsection" hidden={activeSetupTab !== "CHARACTERS"}>
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

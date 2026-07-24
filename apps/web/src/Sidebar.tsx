import {
  useEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
  type FormEvent,
} from "react";
import { createPortal } from "react-dom";
import type {
  AssetKind,
  AssetDto,
  ChatStream,
  CatalogEntryDto,
  ChatAttachmentMetadata,
  DirectChatThreadDto,
  CharacterDto,
  GameSnapshot,
  MessageVisibility,
  PlayerAccessDto,
  PlayerAccessSecretDto,
  StoryPostAdminDto,
  StoryPostDto,
  WorldMapDto,
  WorldMapLocationDto,
  WorldMapScope,
  WorldMapVisibility,
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
import {
  getSlashCommandSuggestions,
  parseComposerInput,
} from "./chat-composer";
import {
  characterWorkspaceReducer,
  createCharacterWorkspaceState,
  MAX_OPEN_CHARACTER_SHEETS,
} from "./character-workspace-state";
import { buildChatTimeline } from "./chat-date";
import { normalizeClientDiceResult } from "./dice-result";
import {
  CharacterActionCard,
  parseSkillCard,
  SkillChatCard,
} from "./SkillCards";
import { StickerPicker } from "./StickerPicker";
import { StoryChannel, type StoryDraftInput } from "./StoryChannel";
import { WorldMapsWorkspace } from "./WorldMapsWorkspace";
import {
  CHAT_STREAM_LABEL,
  CHAT_STREAM_ORDER,
  nextChatStream,
  messagesForStream,
  streamForMessage,
  threadForStream,
  unreadCountForStream,
} from "./chat-state";
import {
  directThreadLabel,
  directThreads,
  directUnreadCount,
  eligibleDirectRecipients,
  messagesForDirectThread,
} from "./direct-chat-state";

function formatDiceBreakdown(value: unknown) {
  const dice = normalizeClientDiceResult(value);
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
  onChat: (
    body: string,
    visibility: MessageVisibility,
    stream: ChatStream,
  ) => Promise<void>;
  onCreateDirectThread: (
    participantMembershipId: string,
  ) => Promise<DirectChatThreadDto>;
  onDirectChat: (
    threadId: string,
    body: string,
    attachmentContentIds: string[],
  ) => Promise<void>;
  onSticker: (
    target: { threadId: string } | { stream: "TABLE" | "STORY" },
    stickerId: string,
  ) => Promise<void>;
  onUploadChatAttachment: (file: File) => Promise<ChatAttachmentMetadata>;
  storyPosts: Array<StoryPostDto | StoryPostAdminDto>;
  onCreateStoryDraft: (input: StoryDraftInput) => Promise<void>;
  onPublishStoryPost: (post: StoryPostAdminDto) => Promise<void>;
  onUpdateStoryPost: (
    post: StoryPostAdminDto,
    input: StoryDraftInput,
  ) => Promise<void>;
  onArchiveStoryPost: (post: StoryPostAdminDto) => Promise<void>;
  onMarkChatRead: (threadId: string, sequence: number) => Promise<void>;
  onActiveChatThreadChange: (threadId: string | null) => void;
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
    input: {
      mode: "EXECUTE" | "SHARE";
      rollActionId?: string;
      entryRevision: number;
    },
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
  workspace:
    | "characters"
    | "tokens"
    | "scenes"
    | "setup"
    | "media"
    | "world-maps"
    | null;
  onWorkspaceChange: (
    workspace:
      | "characters"
      | "tokens"
      | "scenes"
      | "setup"
      | "media"
      | "world-maps"
      | null,
  ) => void;
  onCreateWorldMap: (input: {
    name: string;
    scope: WorldMapScope;
    visibility: WorldMapVisibility;
  }) => Promise<void>;
  onSetWorldMapDraftBackground: (
    map: WorldMapDto,
    assetId: string | null,
  ) => Promise<void>;
  onApproveWorldMapBackground: (map: WorldMapDto) => Promise<void>;
  onPublishWorldMap: (map: WorldMapDto) => Promise<void>;
  onArchiveWorldMap: (map: WorldMapDto) => Promise<void>;
  onCreateWorldMapLocation: (input: {
    mapId: string;
    name: string;
    kind: WorldMapLocationDto["kind"];
    summary: string;
    gmNotes: string;
    visibility: WorldMapLocationDto["visibility"];
    x: number;
    y: number;
  }) => Promise<void>;
  onUpdateWorldMapLocation: (
    location: WorldMapLocationDto,
    input: {
      name: string;
      kind: WorldMapLocationDto["kind"];
      summary: string;
      gmNotes: string;
      visibility: WorldMapLocationDto["visibility"];
      x: number;
      y: number;
    },
  ) => Promise<void>;
  onLinkWorldMapLocationScene: (
    location: WorldMapLocationDto,
    sceneId: string,
  ) => Promise<void>;
  onUnlinkWorldMapLocationScene: (
    location: WorldMapLocationDto,
    sceneId: string,
  ) => Promise<void>;
  onSetWorldMapPartyPosition: (
    mapId: string,
    locationId: string,
    revision: number | null,
  ) => Promise<void>;
  onClearWorldMapPartyPosition: (revision: number) => Promise<void>;
};

export function Sidebar(props: Props) {
  const {
    onChatVisibilityChange,
    onRequestedChatMessageHandled,
    requestedChatMessageId,
    onWorkspaceChange,
    sceneDialogRequest,
    onActiveChatThreadChange,
  } = props;
  const isGm = props.snapshot.me.role === "GM";
  const [focusedMessageId, setFocusedMessageId] = useState<string | null>(null);
  const [activeStream, setActiveStream] = useState<ChatStream>("TABLE");
  const [directMode, setDirectMode] = useState(false);
  const [activeDirectThreadId, setActiveDirectThreadId] = useState<
    string | null
  >(null);
  useEffect(() => onChatVisibilityChange(true), [onChatVisibilityChange]);
  const activeThreadId = directMode
    ? activeDirectThreadId
    : (threadForStream(props.snapshot, activeStream)?.id ?? null);
  useEffect(() => {
    onActiveChatThreadChange(activeThreadId);
  }, [activeThreadId, onActiveChatThreadChange]);
  useEffect(() => {
    if (!requestedChatMessageId) return;
    const requestedStream = streamForMessage(
      props.snapshot.messages,
      requestedChatMessageId,
      props.snapshot.chatThreads,
    );
    if (requestedStream) setActiveStream(requestedStream);
    setFocusedMessageId(requestedChatMessageId);
    onRequestedChatMessageHandled();
  }, [
    requestedChatMessageId,
    onRequestedChatMessageHandled,
    props.snapshot.messages,
    props.snapshot.chatThreads,
  ]);
  useEffect(() => {
    if (sceneDialogRequest > 0 && isGm) onWorkspaceChange("scenes");
  }, [sceneDialogRequest, isGm, onWorkspaceChange]);

  return (
    <aside className={`sidebar ${!isGm ? "player-sidebar" : ""}`}>
      <nav
        className="tabs chat-stream-tabs"
        aria-label="Потоки чата"
        role="tablist"
        onKeyDown={(event) => {
          const nextStream = nextChatStream(activeStream, event.key);
          if (!nextStream) return;
          event.preventDefault();
          setActiveStream(nextStream);
          requestAnimationFrame(() =>
            document
              .getElementById(`chat-tab-${nextStream.toLowerCase()}`)
              ?.focus(),
          );
        }}
      >
        {CHAT_STREAM_ORDER.map((stream) => {
          const unread = unreadCountForStream(props.snapshot, stream);
          return (
            <Button
              key={stream}
              view="flat"
              role="tab"
              id={`chat-tab-${stream.toLowerCase()}`}
              aria-controls={`chat-panel-${stream.toLowerCase()}`}
              aria-selected={!directMode && activeStream === stream}
              tabIndex={!directMode && activeStream === stream ? 0 : -1}
              onClick={() => {
                setDirectMode(false);
                setActiveStream(stream);
              }}
            >
              {CHAT_STREAM_LABEL[stream]}
              {unread > 0 && (
                <span
                  className="chat-unread-badge"
                  aria-label={`${unread} непрочитанных`}
                >
                  {unread}
                </span>
              )}
            </Button>
          );
        })}
        <Button
          view="flat"
          role="tab"
          id="chat-tab-direct"
          aria-controls="chat-panel-direct"
          aria-selected={directMode}
          tabIndex={directMode ? 0 : -1}
          onClick={() => setDirectMode(true)}
        >
          Личные
          {directThreads(props.snapshot).reduce(
            (total, thread) =>
              total + directUnreadCount(props.snapshot, thread.id),
            0,
          ) > 0 && (
            <span className="chat-unread-badge" aria-label="Есть непрочитанные">
              {directThreads(props.snapshot).reduce(
                (total, thread) =>
                  total + directUnreadCount(props.snapshot, thread.id),
                0,
              )}
            </span>
          )}
        </Button>
      </nav>
      <div className="panel-scroll chat-scroll">
        {directMode ? (
          <DirectChatPanel
            snapshot={props.snapshot}
            activeThreadId={activeDirectThreadId}
            onActiveThreadChange={setActiveDirectThreadId}
            onCreateThread={props.onCreateDirectThread}
            onDirectChat={props.onDirectChat}
            onSticker={props.onSticker}
            onUploadAttachment={props.onUploadChatAttachment}
            onMarkChatRead={props.onMarkChatRead}
          />
        ) : activeStream === "STORY" ? (
          <StoryChannel
            posts={props.storyPosts}
            legacyMessages={messagesForStream(
              props.snapshot.messages,
              "STORY",
              props.snapshot.chatThreads,
            )}
            isGm={isGm}
            onCreateDraft={isGm ? props.onCreateStoryDraft : undefined}
            onPublish={isGm ? props.onPublishStoryPost : undefined}
            onUpdate={isGm ? props.onUpdateStoryPost : undefined}
            onArchive={isGm ? props.onArchiveStoryPost : undefined}
            onUploadImage={isGm ? props.onUploadChatAttachment : undefined}
          />
        ) : (
          <ChatPanel
            snapshot={props.snapshot}
            onChat={props.onChat}
            onSticker={props.onSticker}
            onRoll={props.onRoll}
            onMarkChatRead={props.onMarkChatRead}
            activeStream={activeStream}
            focusedMessageId={focusedMessageId}
            onMessageFocused={() => setFocusedMessageId(null)}
          />
        )}
        {props.workspace === "characters" && (
          <CharacterWorkspace
            {...props}
            onClose={() => props.onWorkspaceChange(null)}
          />
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
        {props.workspace === "world-maps" && (
          <WorldMapsWorkspace
            open
            snapshot={props.snapshot}
            onClose={() => props.onWorkspaceChange(null)}
            onOpenScene={(sceneId) => {
              props.onViewScene(sceneId);
              props.onWorkspaceChange(null);
            }}
            onCreateMap={props.onCreateWorldMap}
            onSetDraftBackground={props.onSetWorldMapDraftBackground}
            onApproveBackground={props.onApproveWorldMapBackground}
            onPublishMap={props.onPublishWorldMap}
            onArchiveMap={props.onArchiveWorldMap}
            onCreateLocation={props.onCreateWorldMapLocation}
            onUpdateLocation={props.onUpdateWorldMapLocation}
            onLinkLocationScene={props.onLinkWorldMapLocationScene}
            onUnlinkLocationScene={props.onUnlinkWorldMapLocationScene}
            onSetPartyPosition={props.onSetWorldMapPartyPosition}
            onClearPartyPosition={props.onClearWorldMapPartyPosition}
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

export function CharacterWorkspace({
  onClose,
  ...props
}: Props & { onClose: () => void }) {
  const characters = useMemo(
    () =>
      props.snapshot.me.role === "GM"
        ? props.snapshot.characters
        : props.snapshot.characters.filter(
            (character) =>
              character.ownerMembershipId === props.snapshot.me.id ||
              character.id === props.snapshot.me.characterId,
          ),
    [props.snapshot.characters, props.snapshot.me],
  );
  const [state, dispatch] = useReducer(
    characterWorkspaceReducer,
    characters.map((character) => character.id),
    createCharacterWorkspaceState,
  );
  const workspaceRef = useRef<HTMLElement>(null);
  const titleRef = useRef<HTMLHeadingElement>(null);

  useEffect(() => titleRef.current?.focus(), []);
  useEffect(() => {
    dispatch({
      type: "SYNC",
      ids: characters.map((character) => character.id),
    });
  }, [characters]);
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
      className="character-workspace"
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
        <button type="button" aria-label="Закрыть персонажей" onClick={onClose}>
          Закрыть
        </button>
      </header>
      <div className="character-workspace__body">
        <nav className="character-rail" aria-label="Персонажи кампании">
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
                    <strong>{character.name}</strong>
                    <span>
                      {isCollapsed ? "свернут" : isOpen ? "открыт" : ""}
                    </span>
                  </button>
                  {isOpen && (
                    <button
                      type="button"
                      className="character-rail__close"
                      aria-label={`Закрыть лист ${character.name}`}
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
    </main>,
    document.body,
  );
}

export function CharacterPanel({
  snapshot,
  character,
  selectedId,
  setSelectedId,
  showCharacterPicker = true,
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
  showCharacterPicker?: boolean;
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
  const [rollMode, setRollMode] = useState<
    "NORMAL" | "ADVANTAGE" | "DISADVANTAGE"
  >("NORMAL");
  const [rollPending, setRollPending] = useState(false);
  const [rollError, setRollError] = useState("");
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
  const submitCharacterRoll = async (formula: string, label: string) => {
    setRollPending(true);
    setRollError("");
    try {
      await onRoll(
        formula,
        label,
        "PUBLIC",
        character.id,
        /(?:^|[+\-\s])1?d20(?:$|[+\-\s])/.test(formula) ? rollMode : "NORMAL",
      );
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
      <h3 className="character-block-heading">Основные характеристики</h3>
      <div className="subsection character-roll-controls">
        <label className="field">
          Режим броска (d20)
          <select
            aria-label="Режим броска в карточке"
            value={rollMode}
            disabled={rollPending}
            onChange={(event) =>
              setRollMode(
                event.target.value as "NORMAL" | "ADVANTAGE" | "DISADVANTAGE",
              )
            }
          >
            <option value="NORMAL">Обычный</option>
            <option value="ADVANTAGE">С преимуществом</option>
            <option value="DISADVANTAGE">С помехой</option>
          </select>
        </label>
        {rollError && (
          <p className="field-error" role="alert">
            {rollError}
          </p>
        )}
      </div>
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
      <h3 className="character-block-heading">Боевые характеристики</h3>
      <Button
        disabled={!editable || rollPending}
        onClick={() => void submitCharacterRoll("1d20 + agility", "Инициатива")}
      >
        Инициатива (d20 + Ловкость)
      </Button>
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
              <CharacterActionCard
                entry={entry}
                disabled={!editable}
                onAction={(input) => onRollEntry(character.id, entry.id, input)}
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
      <h3 className="character-block-heading">Ресурсы и кошелёк</h3>
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

function ChatMessageBody({
  message,
  catalogEntryIds,
}: {
  message: GameSnapshot["messages"][number];
  catalogEntryIds?: ReadonlySet<string>;
}) {
  if (message.stickerId || message.stickerPresentation) {
    const presentation = message.stickerPresentation;
    if (!message.stickerId || !presentation)
      return (
        <p className="chat-sticker-tombstone">
          {
            "\u0421\u0442\u0438\u043a\u0435\u0440 \u0431\u043e\u043b\u044c\u0448\u0435 \u043d\u0435\u0434\u043e\u0441\u0442\u0443\u043f\u0435\u043d"
          }
        </p>
      );
    return (
      <figure className="chat-sticker">
        <img
          src={`/api/stickers/${message.stickerId}/content`}
          alt={presentation.altText}
          width={presentation.width}
          height={presentation.height}
          loading="lazy"
        />
        <figcaption>{presentation.name}</figcaption>
      </figure>
    );
  }
  const skillCard = parseSkillCard(
    message.skillCard ? { skillCard: message.skillCard } : message.dice,
  );
  if (message.kind === "DICE" && skillCard)
    return (
      <SkillChatCard
        card={skillCard}
        sourceRemoved={
          skillCard.entry.sourceRemoved ||
          Boolean(
            skillCard.entry.sourceCatalogEntryId &&
            catalogEntryIds &&
            !catalogEntryIds.has(skillCard.entry.sourceCatalogEntryId),
          )
        }
      />
    );
  const dice = normalizeClientDiceResult(message.dice);
  if (message.kind !== "DICE" || !dice)
    return (
      <>
        <p>{message.body}</p>
        {message.attachments?.map((attachment) => (
          <figure className="chat-attachment" key={attachment.contentId}>
            <img
              src={`/api/chat/attachments/${attachment.contentId}/content`}
              alt={`Вложение ${attachment.fileName}`}
              loading="lazy"
            />
            <figcaption>{attachment.fileName}</figcaption>
          </figure>
        ))}
      </>
    );
  return (
    <div className="roll-result">
      <strong className="roll-total" aria-label="Итог броска">
        {dice.total}
      </strong>
      <div className="roll-details">
        <div>{message.body}</div>
        <small>{formatDiceBreakdown(dice)}</small>
      </div>
    </div>
  );
}

function DirectChatPanel({
  snapshot,
  activeThreadId,
  onActiveThreadChange,
  onCreateThread,
  onDirectChat,
  onSticker,
  onUploadAttachment,
  onMarkChatRead,
}: {
  snapshot: GameSnapshot;
  activeThreadId: string | null;
  onActiveThreadChange: (threadId: string | null) => void;
  onCreateThread: Props["onCreateDirectThread"];
  onDirectChat: Props["onDirectChat"];
  onSticker: Props["onSticker"];
  onUploadAttachment: Props["onUploadChatAttachment"];
  onMarkChatRead: Props["onMarkChatRead"];
}) {
  const threads = directThreads(snapshot);
  const activeThread =
    threads.find((thread) => thread.id === activeThreadId) ??
    threads[0] ??
    null;
  const [recipientId, setRecipientId] = useState("");
  const [composer, setComposer] = useState("");
  const [attachment, setAttachment] = useState<ChatAttachmentMetadata | null>(
    null,
  );
  const [attachmentPreviewUrl, setAttachmentPreviewUrl] = useState("");
  const attachmentPreviewUrlRef = useRef("");
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState("");
  const messages = activeThread
    ? messagesForDirectThread(snapshot, activeThread.id)
    : [];
  const latestSequence = messages.at(-1)?.sequence;

  useEffect(() => {
    attachmentPreviewUrlRef.current = attachmentPreviewUrl;
  }, [attachmentPreviewUrl]);
  useEffect(
    () => () => {
      if (attachmentPreviewUrlRef.current)
        URL.revokeObjectURL(attachmentPreviewUrlRef.current);
    },
    [],
  );

  useEffect(() => {
    if (!activeThreadId && activeThread) onActiveThreadChange(activeThread.id);
  }, [activeThread, activeThreadId, onActiveThreadChange]);

  useEffect(() => {
    if (!activeThread || latestSequence === undefined) return;
    const timer = window.setTimeout(
      () => void onMarkChatRead(activeThread.id, latestSequence),
      350,
    );
    return () => window.clearTimeout(timer);
  }, [activeThread, latestSequence, onMarkChatRead]);

  async function createThread() {
    if (!recipientId) return;
    setError("");
    try {
      const thread = await onCreateThread(recipientId);
      onActiveThreadChange(thread.id);
      setRecipientId("");
    } catch {
      setError("Не удалось открыть личный диалог.");
    }
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    const body = composer.trim();
    if (!activeThread || (!body && !attachment)) return;
    setError("");
    try {
      await onDirectChat(
        activeThread.id,
        body || "Изображение",
        attachment ? [attachment.contentId] : [],
      );
      setComposer("");
      setAttachment(null);
      if (attachmentPreviewUrl) URL.revokeObjectURL(attachmentPreviewUrl);
      setAttachmentPreviewUrl("");
    } catch {
      setError("Не удалось отправить личное сообщение.");
    }
  }

  return (
    <section
      className="chat-panel direct-chat-panel"
      role="tabpanel"
      id="chat-panel-direct"
      aria-labelledby="chat-tab-direct"
    >
      <div className="direct-thread-toolbar">
        <FormSelect
          aria-label="Открытый личный диалог"
          value={activeThread?.id ?? ""}
          onChange={(event) => onActiveThreadChange(event.target.value || null)}
        >
          <option value="">Выберите диалог</option>
          {threads.map((thread) => (
            <option key={thread.id} value={thread.id}>
              {directThreadLabel(thread, snapshot.me.id)}
              {directUnreadCount(snapshot, thread.id)
                ? ` · ${directUnreadCount(snapshot, thread.id)}`
                : ""}
            </option>
          ))}
        </FormSelect>
        <div className="direct-thread-create">
          <FormSelect
            aria-label="Получатель личного сообщения"
            value={recipientId}
            onChange={(event) => setRecipientId(event.target.value)}
          >
            <option value="">Новый диалог…</option>
            {eligibleDirectRecipients(snapshot.members, snapshot.me.id).map(
              (member) => (
                <option key={member.id} value={member.id}>
                  {member.displayName}
                </option>
              ),
            )}
          </FormSelect>
          <Button
            type="button"
            disabled={!recipientId}
            onClick={() => void createThread()}
          >
            Открыть
          </Button>
        </div>
      </div>
      <div className="message-list" aria-live="polite">
        {!activeThread && (
          <p className="chat-empty">
            Выберите получателя, чтобы начать личный диалог.
          </p>
        )}
        {activeThread && messages.length === 0 && (
          <p className="chat-empty">
            В диалоге с {directThreadLabel(activeThread, snapshot.me.id)} пока
            нет сообщений.
          </p>
        )}
        {buildChatTimeline(messages).map((item) =>
          item.type === "DATE" ? (
            <div className="chat-date-divider" key={`direct-date-${item.key}`}>
              <span>{item.label}</span>
            </div>
          ) : (
            <article
              key={item.message.id}
              className="message text"
              data-thread-id={activeThread?.id}
            >
              <header>
                <strong>{item.message.displayName}</strong>
                <time>
                  {new Date(item.message.createdAt).toLocaleTimeString([], {
                    hour: "2-digit",
                    minute: "2-digit",
                  })}
                </time>
              </header>
              <ChatMessageBody message={item.message} />
            </article>
          ),
        )}
      </div>
      {activeThread && (
        <form className="chat-compose direct-compose" onSubmit={submit}>
          <div className="chat-composer-input">
            <FormTextArea
              aria-label={`Личное сообщение: ${directThreadLabel(activeThread, snapshot.me.id)}`}
              placeholder={`Сообщение для ${directThreadLabel(activeThread, snapshot.me.id)}…`}
              value={composer}
              onChange={(event) => setComposer(event.target.value)}
              rows={3}
            />
            {attachment && (
              <div className="direct-attachment-preview">
                <img
                  src={attachmentPreviewUrl}
                  alt={`Вложение ${attachment.fileName}`}
                />
                <span>{attachment.fileName}</span>
                <Button
                  view="flat"
                  type="button"
                  onClick={() => {
                    setAttachment(null);
                    if (attachmentPreviewUrl)
                      URL.revokeObjectURL(attachmentPreviewUrl);
                    setAttachmentPreviewUrl("");
                  }}
                >
                  Убрать
                </Button>
              </div>
            )}
          </div>
          <StickerPicker
            disabled={uploading}
            onSelect={(stickerId) =>
              onSticker({ threadId: activeThread.id }, stickerId)
            }
          />
          <label className="direct-attach-button">
            <span>{uploading ? "Загрузка…" : "Изображение"}</span>
            <input
              type="file"
              accept="image/*"
              disabled={uploading}
              onChange={async (event) => {
                const file = event.target.files?.[0];
                event.currentTarget.value = "";
                if (!file) return;
                setUploading(true);
                setError("");
                try {
                  const previewUrl = URL.createObjectURL(file);
                  try {
                    setAttachment(await onUploadAttachment(file));
                    if (attachmentPreviewUrl)
                      URL.revokeObjectURL(attachmentPreviewUrl);
                    setAttachmentPreviewUrl(previewUrl);
                  } catch (error) {
                    URL.revokeObjectURL(previewUrl);
                    throw error;
                  }
                } catch {
                  setError("Не удалось загрузить изображение.");
                } finally {
                  setUploading(false);
                }
              }}
            />
          </label>
          <Button
            className="primary"
            type="submit"
            disabled={uploading || (!composer.trim() && !attachment)}
          >
            Отправить
          </Button>
        </form>
      )}
      {error && (
        <p className="composer-error" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}

function ChatPanel({
  snapshot,
  onChat,
  onSticker,
  onRoll,
  onMarkChatRead,
  activeStream,
  focusedMessageId,
  onMessageFocused,
}: {
  snapshot: GameSnapshot;
  onChat: Props["onChat"];
  onSticker: Props["onSticker"];
  onRoll: Props["onRoll"];
  onMarkChatRead: Props["onMarkChatRead"];
  activeStream: ChatStream;
  focusedMessageId: string | null;
  onMessageFocused: () => void;
}) {
  const [composer, setComposer] = useState("");
  const [visibility, setVisibility] = useState<MessageVisibility>("PUBLIC");
  const [composerError, setComposerError] = useState("");
  const listRef = useRef<HTMLDivElement>(null);
  const followRef = useRef(true);
  const [atBottom, setAtBottom] = useState(true);
  const [newMessageCount, setNewMessageCount] = useState(0);
  const messages = useMemo(
    () =>
      messagesForStream(snapshot.messages, activeStream, snapshot.chatThreads),
    [snapshot.messages, snapshot.chatThreads, activeStream],
  );
  const timeline = buildChatTimeline(messages);
  const catalogEntryIds = useMemo(
    () => new Set(snapshot.catalogEntries.map((entry) => entry.id)),
    [snapshot.catalogEntries],
  );
  const latestMessage = messages.at(-1);
  const thread = threadForStream(snapshot, activeStream);
  const threadId = thread?.id;
  const latestMessageId = latestMessage?.id;
  const latestSequence = latestMessage?.sequence;
  const canCompose =
    activeStream === "TABLE" ||
    (activeStream === "STORY" && snapshot.me.role === "GM");
  const slashSuggestions =
    activeStream === "TABLE" ? getSlashCommandSuggestions(composer) : [];

  useEffect(() => {
    followRef.current = true;
    setAtBottom(true);
    setNewMessageCount(0);
    requestAnimationFrame(() => {
      const list = listRef.current;
      if (list) list.scrollTo({ top: list.scrollHeight });
    });
  }, [activeStream]);

  useEffect(() => {
    const list = listRef.current;
    if (!list || !latestMessage) return;
    if (followRef.current) {
      list.scrollTo({ top: list.scrollHeight });
      setNewMessageCount(0);
    } else {
      setNewMessageCount((current) => current + 1);
    }
  }, [latestMessageId, latestMessage]);

  useEffect(() => {
    if (!threadId || latestSequence === undefined || !atBottom) return;
    const timer = window.setTimeout(() => {
      void onMarkChatRead(threadId, latestSequence);
    }, 350);
    return () => window.clearTimeout(timer);
  }, [threadId, latestSequence, atBottom, onMarkChatRead]);

  useEffect(() => {
    if (!focusedMessageId) return;
    const message = document.getElementById(`chat-message-${focusedMessageId}`);
    if (!message) return;
    const list = listRef.current;
    if (list)
      list.scrollTo({
        top:
          message.offsetTop - list.clientHeight / 2 + message.clientHeight / 2,
      });
    message.focus({ preventScroll: true });
    onMessageFocused();
  }, [focusedMessageId, onMessageFocused, activeStream]);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!canCompose) return;
    const intent = parseComposerInput(composer);
    if (intent.kind === "INVALID") {
      setComposerError(intent.message);
      return;
    }
    setComposerError("");
    if (intent.kind === "ROLL" && activeStream === "TABLE")
      await onRoll(
        intent.formula,
        undefined,
        visibility,
        snapshot.me.characterId,
        "NORMAL",
      );
    else if (intent.kind === "TEXT")
      await onChat(intent.body, visibility, activeStream);
    setComposer("");
  };

  return (
    <section
      className="chat-panel"
      role="tabpanel"
      id={`chat-panel-${activeStream.toLowerCase()}`}
      aria-labelledby={`chat-tab-${activeStream.toLowerCase()}`}
    >
      <div
        className="message-list"
        aria-live="polite"
        ref={listRef}
        onScroll={(event) => {
          const list = event.currentTarget;
          const nextAtBottom =
            list.scrollHeight - list.scrollTop - list.clientHeight < 48;
          followRef.current = nextAtBottom;
          setAtBottom(nextAtBottom);
          if (nextAtBottom) setNewMessageCount(0);
        }}
      >
        {timeline.length === 0 && (
          <p className="chat-empty">В этом потоке пока нет сообщений.</p>
        )}
        {timeline.map((item) =>
          item.type === "DATE" ? (
            <div className="chat-date-divider" key={`date-${item.key}`}>
              <span>{item.label}</span>
            </div>
          ) : (
            <article
              key={item.message.id}
              id={`chat-message-${item.message.id}`}
              className={`message ${item.message.kind.toLowerCase()}`}
              tabIndex={-1}
            >
              <header>
                <strong>{item.message.displayName}</strong>
                {item.message.characterId && (
                  <span className="message-character">
                    {snapshot.characters.find(
                      (character) => character.id === item.message.characterId,
                    )?.name ?? "Персонаж"}
                  </span>
                )}
                <time>
                  {new Date(item.message.createdAt).toLocaleTimeString([], {
                    hour: "2-digit",
                    minute: "2-digit",
                  })}
                </time>
                {item.message.visibility === "GM_ONLY" && <span>мастеру</span>}
              </header>
              <ChatMessageBody
                message={item.message}
                catalogEntryIds={
                  snapshot.me.role === "GM" ? catalogEntryIds : undefined
                }
              />
            </article>
          ),
        )}
      </div>
      {newMessageCount > 0 && (
        <Button
          className="new-messages"
          onClick={() => {
            const list = listRef.current;
            if (list)
              list.scrollTo({ top: list.scrollHeight, behavior: "smooth" });
            followRef.current = true;
            setAtBottom(true);
            setNewMessageCount(0);
          }}
        >
          Новые сообщения · {newMessageCount}
        </Button>
      )}
      {activeStream === "ROLLS" && (
        <p className="chat-stream-note">
          {
            "\u0411\u0440\u043e\u0441\u043a\u0438 \u043f\u043e\u044f\u0432\u043b\u044f\u044e\u0442\u0441\u044f \u0437\u0434\u0435\u0441\u044c \u0430\u0432\u0442\u043e\u043c\u0430\u0442\u0438\u0447\u0435\u0441\u043a\u0438."
          }
        </p>
      )}
      {activeStream === "STORY" && snapshot.me.role !== "GM" && (
        <p className="chat-stream-note">
          {
            "\u0421\u044e\u0436\u0435\u0442\u043d\u044b\u0439 \u043f\u043e\u0442\u043e\u043a \u0432\u0435\u0434\u0451\u0442 \u043c\u0430\u0441\u0442\u0435\u0440."
          }
        </p>
      )}
      {canCompose && (
        <>
          <div className="chat-tools">
            <label className="compact-check">
              <FormInput
                type="checkbox"
                checked={visibility === "GM_ONLY"}
                onChange={(event) =>
                  setVisibility(event.target.checked ? "GM_ONLY" : "PUBLIC")
                }
              />{" "}
              {
                "\u0422\u043e\u043b\u044c\u043a\u043e \u043c\u0430\u0441\u0442\u0435\u0440"
              }
            </label>
          </div>
          <form className="chat-compose" onSubmit={submit}>
            <div className="chat-composer-input">
              <FormTextArea
                aria-label={
                  activeStream === "STORY"
                    ? "Сообщение сюжета"
                    : "Сообщение или бросок"
                }
                aria-expanded={slashSuggestions.length > 0}
                aria-controls={
                  slashSuggestions.length > 0
                    ? "chat-slash-suggestions"
                    : undefined
                }
                placeholder={
                  activeStream === "STORY"
                    ? "Продолжить историю…"
                    : "Сообщение … или /roll 1d20 + agility"
                }
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
              {slashSuggestions.length > 0 && (
                <div
                  className="slash-command-suggestions"
                  id="chat-slash-suggestions"
                  role="listbox"
                  aria-label={
                    "\u041a\u043e\u043c\u0430\u043d\u0434\u044b \u0447\u0430\u0442\u0430"
                  }
                >
                  {slashSuggestions.map((suggestion) => (
                    <button
                      key={suggestion.command}
                      type="button"
                      role="option"
                      aria-selected="false"
                      onClick={() => setComposer(suggestion.insertion)}
                    >
                      <strong>{suggestion.command}</strong>
                      <span>{suggestion.description}</span>
                      <code>{suggestion.example}</code>
                    </button>
                  ))}
                </div>
              )}
            </div>
            <StickerPicker
              onSelect={(stickerId) =>
                onSticker(
                  { stream: activeStream as "TABLE" | "STORY" },
                  stickerId,
                )
              }
            />
            <Button className="primary" type="submit">
              {"\u041e\u0442\u043f\u0440\u0430\u0432\u0438\u0442\u044c"}
            </Button>
          </form>
          {composerError && (
            <p className="composer-error" role="alert">
              {composerError}
            </p>
          )}
        </>
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

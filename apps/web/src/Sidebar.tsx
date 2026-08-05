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
import { TokenImageGenerator } from "./TokenImageGenerator";
import {
  mergeAssets,
  tokenAssetLabel,
  tokenDefinitionAssets,
  tokenGeneratorSources,
} from "./token-definition-options";
import type { TokenFramePreset } from "./token-image-editor-state";
import { ConfirmDialog } from "./ui/ConfirmDialog";
import { TextPromptDialog } from "./ui/TextPromptDialog";
import { ArkenDialog } from "./ui/ArkenDialog";
import { isEditableEventTarget } from "./input-diagnostics";
import { ImageUploadField } from "./ui/ImageUploadField";
import { FormInput, FormSelect, FormTextArea } from "./ui/GravityFormControls";
import { SceneManagerDialog, type SceneDraft } from "./ui/SceneManagerDialog";
import {
  getSlashCommandSuggestions,
  parseComposerInput,
} from "./chat-composer";
import { normalizeCharacterControllerIds } from "./character-controller-access-state";
import {
  characterWorkspaceReducer,
  createCharacterWorkspaceState,
  MAX_OPEN_CHARACTER_SHEETS,
  uniqueCharacterIds,
} from "./character-workspace-state";
import { buildChatTimeline } from "./chat-date";
import { formatDiceBreakdown, normalizeClientDiceResult } from "./dice-result";
import { getDiceCritical } from "./dice-critical";
import {
  CharacterActionCard,
  parseSkillCard,
  SkillChatCard,
} from "./SkillCards";
import { RollModeControl, type RollMode } from "./RollModeControl";
import { StickerPicker } from "./StickerPicker";
import { StoryChannel, StoryPost, type StoryDraftInput } from "./StoryChannel";
import {
  buildActivityFeed,
  buildActivityTimeline,
  type ActivityStoryPost,
} from "./activity-feed";
import { WorldMapsWorkspace } from "./WorldMapsWorkspace";
import { OperatorFeedbackWorkspace } from "./OperatorFeedbackWorkspace";
import { PlayerRequestsWorkspace } from "./PlayerRequestsWorkspace";
import { PlayerRequestChatCard } from "./player-request-chat";
import {
  changeWalletValue,
  EMPTY_WALLET,
  normalizeWallet,
  normalizeWalletValue,
} from "./wallet";
import {
  CHAT_STREAM_LABEL,
  CHAT_STREAM_ORDER,
  messagesForStream,
  streamForMessage,
  threadForStream,
  unreadCountForStream,
} from "./chat-state";
import {
  directChatContacts,
  directThreadForPeer,
  directThreadLabel,
  directThreads,
  directUnreadCount,
  messagesForDirectThread,
  persistDirectSelection,
  restoreDirectSelection,
} from "./direct-chat-state";
import { activityTableReadTarget, feedForChatStream } from "./sidebar-feed";
import {
  charactersAvailableForActivityRolls,
  filterActivityEvents,
  formulaBonus,
  physicalDiceStorageKey,
  physicalRollBonus,
  physicalRollChatRequest,
  type ActivityFilter,
} from "./activity-roll-controls";

type SidebarFeed = "ACTIVITY" | ChatStream;

const CHAT_FEED_ORDER: readonly SidebarFeed[] = [
  "ACTIVITY",
  ...CHAT_STREAM_ORDER.filter(
    (stream) => stream !== "TABLE" && stream !== "ROLLS",
  ),
];

function nextChatFeed(current: SidebarFeed, key: string): SidebarFeed | null {
  const index = CHAT_FEED_ORDER.indexOf(current);
  if (key === "Home") return CHAT_FEED_ORDER[0] ?? null;
  if (key === "End") return CHAT_FEED_ORDER.at(-1) ?? null;
  if (key === "ArrowRight")
    return CHAT_FEED_ORDER[(index + 1) % CHAT_FEED_ORDER.length] ?? null;
  if (key === "ArrowLeft")
    return (
      CHAT_FEED_ORDER[
        (index - 1 + CHAT_FEED_ORDER.length) % CHAT_FEED_ORDER.length
      ] ?? null
    );
  return null;
}

type Props = {
  snapshot: GameSnapshot;
  requestedCharacterId?: string | null;
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
  onReplaceCharacterControllers: (
    characterId: string,
    revision: number,
    controllerMembershipIds: string[],
  ) => Promise<void>;
  onPatchCharacter: (id: string, patch: Partial<CharacterDto>) => Promise<void>;
  onChat: (
    body: string,
    visibility: MessageVisibility,
    stream: ChatStream,
    characterId?: string | null,
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
  storyNextCursor: string | null;
  onLoadMoreStoryPosts: () => Promise<void>;
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
  onGenerateTokenImage: (input: {
    sourceAssetId: string;
    cropX: number;
    cropY: number;
    zoom: number;
    frame: TokenFramePreset;
    name?: string;
  }) => Promise<AssetDto>;
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
      rollMode?: RollMode;
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
      rest?: "SHORT" | "LONG" | "CATCH_BREATH";
    },
    intent?: {
      walletDelta?: {
        key: keyof CharacterDto["wallet"];
        delta: number;
      };
    },
  ) => Promise<void>;
  onCampaignClock: (
    command: "ADVANCE_DAY" | "LONG_REST" | "START_BATTLE" | "END_BATTLE",
    revision: number,
  ) => Promise<void>;
  requestedChatMessageId: string | null;
  onRequestedChatMessageHandled: () => void;
  onChatVisibilityChange: (visible: boolean) => void;
  onOpenPlayerRequestCreate: () => void;
  onCreatePlayerRequest: (input: {
    title: string;
    body: string;
    horizon: "NOW" | "BEFORE_BREAK" | "NEXT_SESSION";
    audience: "PUBLIC" | "GM_ONLY";
    characterId: string | null;
  }) => Promise<void>;
  onUpdatePlayerRequest: (
    request: import("@arken/contracts").PlayerRequestDto,
    input: { title: string; body: string },
  ) => Promise<void>;
  onPlayerRequestAction: (
    request: import("@arken/contracts").PlayerRequestDto,
    action: import("@arken/contracts").PlayerRequestTransition,
    resolutionNote?: string,
  ) => Promise<void>;
  collapsed: boolean;
  onCollapsedChange: (collapsed: boolean) => void;
  workspace:
    | "characters"
    | "tokens"
    | "scenes"
    | "setup"
    | "media"
    | "world-maps"
    | "operator-feedback"
    | "player-requests"
    | null;
  operatorFeedbackAllowed: boolean;
  onWorkspaceChange: (
    workspace:
      | "characters"
      | "tokens"
      | "scenes"
      | "setup"
      | "media"
      | "world-maps"
      | "operator-feedback"
      | "player-requests"
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
    onMarkChatRead,
  } = props;
  const { messages: snapshotMessages, chatThreads: snapshotChatThreads } =
    props.snapshot;
  const isGm = props.snapshot.me.role === "GM";
  const [focusedMessageId, setFocusedMessageId] = useState<string | null>(null);
  const readSequenceRef = useRef(new Map<string, number>());
  const [activeFeed, setActiveFeed] = useState<SidebarFeed>("ACTIVITY");
  const [directMode, setDirectMode] = useState(false);
  const [activeDirectThreadId, setActiveDirectThreadId] = useState<
    string | null
  >(null);
  useEffect(
    () => onChatVisibilityChange(!props.collapsed),
    [onChatVisibilityChange, props.collapsed],
  );
  const activeThreadId = directMode
    ? activeDirectThreadId
    : activeFeed === "ACTIVITY"
      ? null
      : (threadForStream(props.snapshot, activeFeed)?.id ?? null);
  useEffect(() => {
    onActiveChatThreadChange(activeThreadId);
  }, [activeThreadId, onActiveChatThreadChange]);
  useEffect(() => {
    if (directMode || activeFeed !== "STORY" || !activeThreadId) return;
    const latestSequence = messagesForStream(
      snapshotMessages,
      "STORY",
      snapshotChatThreads,
    ).at(-1)?.sequence;
    if (latestSequence === undefined) return;
    if ((readSequenceRef.current.get(activeThreadId) ?? 0) >= latestSequence)
      return;
    readSequenceRef.current.set(activeThreadId, latestSequence);
    void onMarkChatRead(activeThreadId, latestSequence).catch(() => {
      readSequenceRef.current.delete(activeThreadId);
    });
  }, [
    activeDirectThreadId,
    activeFeed,
    activeThreadId,
    directMode,
    onMarkChatRead,
    snapshotChatThreads,
    snapshotMessages,
  ]);
  useEffect(() => {
    if (directMode || activeFeed !== "ACTIVITY") return;
    const target = activityTableReadTarget(props.snapshot);
    if (!target) return;
    if ((readSequenceRef.current.get(target.threadId) ?? 0) >= target.sequence)
      return;
    readSequenceRef.current.set(target.threadId, target.sequence);
    void onMarkChatRead(target.threadId, target.sequence).catch(() => {
      readSequenceRef.current.delete(target.threadId);
    });
  }, [activeFeed, directMode, onMarkChatRead, props.snapshot]);
  useEffect(() => {
    if (!requestedChatMessageId) return;
    const requestedStream = streamForMessage(
      props.snapshot.messages,
      requestedChatMessageId,
      props.snapshot.chatThreads,
    );
    if (requestedStream) {
      setDirectMode(false);
      setActiveFeed(feedForChatStream(requestedStream));
    }
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
    <aside
      id="activity-sidebar"
      className={`sidebar ${!isGm ? "player-sidebar" : ""}`}
      hidden={props.collapsed}
      inert={props.collapsed}
      aria-hidden={props.collapsed}
    >
      <button
        type="button"
        className="sidebar-collapse-button"
        aria-controls="activity-sidebar"
        aria-expanded="true"
        aria-label="Свернуть боковую панель"
        title="Свернуть боковую панель"
        onClick={() => props.onCollapsedChange(true)}
      >
        <span aria-hidden="true">&#x203a;</span>
      </button>
      <nav
        className="tabs chat-stream-tabs"
        aria-label="Потоки чата"
        role="tablist"
        onKeyDown={(event) => {
          const nextFeed = nextChatFeed(activeFeed, event.key);
          if (!nextFeed) return;
          event.preventDefault();
          setActiveFeed(nextFeed);
          requestAnimationFrame(() =>
            document
              .getElementById(`chat-tab-${nextFeed.toLowerCase()}`)
              ?.focus(),
          );
        }}
      >
        <Button
          view="flat"
          role="tab"
          id="chat-tab-activity"
          aria-controls="chat-panel-activity"
          aria-selected={!directMode && activeFeed === "ACTIVITY"}
          tabIndex={!directMode && activeFeed === "ACTIVITY" ? 0 : -1}
          onClick={() => {
            setDirectMode(false);
            setActiveFeed("ACTIVITY");
          }}
        >
          {"События"}
        </Button>
        {CHAT_STREAM_ORDER.filter(
          (stream) => stream !== "TABLE" && stream !== "ROLLS",
        ).map((stream) => {
          const unread = unreadCountForStream(props.snapshot, stream);
          return (
            <Button
              key={stream}
              view="flat"
              role="tab"
              id={`chat-tab-${stream.toLowerCase()}`}
              aria-controls={`chat-panel-${stream.toLowerCase()}`}
              aria-selected={!directMode && activeFeed === stream}
              tabIndex={!directMode && activeFeed === stream ? 0 : -1}
              onClick={() => {
                setDirectMode(false);
                setActiveFeed(stream);
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
        {/* UIX-365: direct-message tab hidden pending a dedicated redesign of the mechanic. */}
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
        ) : activeFeed === "ACTIVITY" ? (
          <ActivityPanel
            snapshot={props.snapshot}
            storyPosts={props.storyPosts}
            onChat={props.onChat}
            onSticker={props.onSticker}
            onRoll={props.onRoll}
            focusedMessageId={focusedMessageId}
            onMessageFocused={() => setFocusedMessageId(null)}
            onOpenPlayerRequestCreate={props.onOpenPlayerRequestCreate}
          />
        ) : activeFeed === "STORY" ? (
          <StoryChannel
            posts={props.storyPosts}
            nextCursor={props.storyNextCursor}
            onLoadMore={props.onLoadMoreStoryPosts}
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
            activeStream={activeFeed}
            focusedMessageId={focusedMessageId}
            onMessageFocused={() => setFocusedMessageId(null)}
            onOpenPlayerRequests={() =>
              props.onWorkspaceChange("player-requests")
            }
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
            className="setup-workspace"
            workspaceDraggable={false}
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
        {props.workspace === "operator-feedback" &&
          props.operatorFeedbackAllowed && (
            <OperatorFeedbackWorkspace
              open
              onClose={() => props.onWorkspaceChange(null)}
            />
          )}
        {props.workspace === "player-requests" && (
          <PlayerRequestsWorkspace
            open
            snapshot={props.snapshot}
            onClose={() => props.onWorkspaceChange(null)}
            onCreate={props.onCreatePlayerRequest}
            onUpdate={props.onUpdatePlayerRequest}
            onAction={props.onPlayerRequestAction}
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
      <TextPromptDialog
        open={createCharacterOpen}
        title="Новый персонаж"
        label="Имя персонажа"
        applyLabel="Создать"
        onApply={async (name) => {
          await props.onCreateCharacter(name);
          setCreateCharacterOpen(false);
        }}
        onClose={() => setCreateCharacterOpen(false)}
      />
    </main>,
    document.body,
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

function ChatMessageBody({
  message,
  catalogEntryIds,
  playerRequests,
  onOpenPlayerRequests,
}: {
  message: GameSnapshot["messages"][number];
  catalogEntryIds?: ReadonlySet<string>;
  playerRequests?: GameSnapshot["playerRequests"];
  onOpenPlayerRequests?: () => void;
}) {
  if (message.playerRequestId)
    return (
      <PlayerRequestChatCard
        message={message}
        requests={playerRequests ?? []}
        onOpen={onOpenPlayerRequests ?? (() => {})}
      />
    );
  if (message.stickerId || message.stickerPresentation) {
    const presentation = message.stickerPresentation;
    if (!message.stickerId || !presentation)
      return (
        <p className="chat-sticker-tombstone">{"Стикер больше недоступен"}</p>
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
  const dice = normalizeClientDiceResult(message.dice);
  const critical = dice ? getDiceCritical(dice) : null;
  if (message.kind === "DICE" && skillCard)
    return (
      <SkillChatCard
        card={skillCard}
        critical={critical}
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
  if (message.kind !== "DICE" || !dice) {
    const physicalBonus = physicalRollBonus(message.body);
    return (
      <>
        {physicalBonus && (
          <strong className="physical-roll-bonus">
            Бонус к кубу {physicalBonus}
          </strong>
        )}
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
  }
  return (
    <div
      className={`roll-result${critical ? ` roll-result--critical-${critical.kind}` : ""}`}
    >
      <strong className="roll-total" aria-label="Итог броска">
        {dice.total}
      </strong>
      <div className="roll-details">
        <div>{message.body}</div>
        {critical && (
          <span className="roll-critical-label">{critical.label}</span>
        )}
        <small>{formatDiceBreakdown(dice)}</small>
      </div>
    </div>
  );
}

function ActivityPanel({
  snapshot,
  storyPosts,
  onChat,
  onSticker,
  onRoll,
  focusedMessageId,
  onMessageFocused,
  onOpenPlayerRequestCreate,
}: {
  snapshot: GameSnapshot;
  storyPosts: readonly ActivityStoryPost[];
  onChat: Props["onChat"];
  onSticker: Props["onSticker"];
  onRoll: Props["onRoll"];
  focusedMessageId: string | null;
  onMessageFocused: () => void;
  onOpenPlayerRequestCreate: () => void;
}) {
  const [composer, setComposer] = useState("");
  const [visibility, setVisibility] = useState<MessageVisibility>("PUBLIC");
  const [composerError, setComposerError] = useState("");
  const [slashHelpOpen, setSlashHelpOpen] = useState(false);
  const availableRollCharacters = useMemo(
    () => charactersAvailableForActivityRolls(snapshot),
    [snapshot],
  );
  const [rollCharacterId, setRollCharacterId] = useState(
    () => availableRollCharacters[0]?.id ?? "",
  );
  const rollCharacter =
    availableRollCharacters.find(
      (character) => character.id === rollCharacterId,
    ) ?? availableRollCharacters[0];
  const [physicalDice, setPhysicalDice] = useState(
    () =>
      window.localStorage.getItem(physicalDiceStorageKey(snapshot.me.id)) ===
      "true",
  );
  const [activityFilters, setActivityFilters] = useState<Set<ActivityFilter>>(
    () => new Set(["ROLLS", "STORY", "REFERENCE"]),
  );
  const [quickRollPending, setQuickRollPending] = useState(false);
  const characterStats =
    snapshot.characters.find(
      (character) => character.id === snapshot.me.characterId,
    )?.stats ?? {};
  const slashSuggestions = slashHelpOpen
    ? getSlashCommandSuggestions("/", characterStats)
    : getSlashCommandSuggestions(composer, characterStats);
  const executeActivitySuggestion = (insertion: string) => {
    const intent = parseComposerInput(insertion, characterStats);
    setSlashHelpOpen(false);
    if (intent.kind !== "ROLL") {
      setComposer(insertion);
      return;
    }
    setComposer("");
    setComposerError("");
    void onRoll(
      intent.formula,
      intent.label,
      visibility,
      snapshot.me.characterId,
      "NORMAL",
    ).catch(() =>
      setComposerError("Не удалось выполнить бросок. Повторите попытку."),
    );
  };
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const intent = parseComposerInput(composer, characterStats);
    if (intent.kind === "INVALID") {
      setComposerError(intent.message);
      return;
    }
    setComposerError("");
    try {
      if (intent.kind === "ROLL")
        await onRoll(
          intent.formula,
          intent.label,
          visibility,
          snapshot.me.characterId,
          "NORMAL",
        );
      else await onChat(intent.body, visibility, "TABLE");
      setComposer("");
    } catch {
      setComposerError(
        intent.kind === "ROLL"
          ? "Не удалось выполнить бросок. Проверьте характеристику и повторите попытку."
          : "Не удалось отправить сообщение. Проверьте соединение и повторите попытку.",
      );
    }
  };
  const activityEvents = useMemo(
    () =>
      filterActivityEvents(
        buildActivityFeed(snapshot.messages, snapshot.chatThreads, storyPosts),
        activityFilters,
      ),
    [activityFilters, snapshot.messages, snapshot.chatThreads, storyPosts],
  );
  const submitQuickRoll = async (
    formula: string,
    label: string,
    bonus: number,
  ) => {
    if (!rollCharacter) return;
    setQuickRollPending(true);
    setComposerError("");
    try {
      if (physicalDice) {
        const request = physicalRollChatRequest(label, bonus, rollCharacter.id);
        await onChat(request.body, visibility, "TABLE", request.characterId);
      } else {
        await onRoll(formula, label, visibility, rollCharacter.id, "NORMAL");
      }
    } catch {
      setComposerError("Не удалось выполнить бросок. Повторите попытку.");
    } finally {
      setQuickRollPending(false);
    }
  };
  const timeline = useMemo(
    () => buildActivityTimeline(activityEvents),
    [activityEvents],
  );
  const catalogEntryIds = useMemo(
    () => new Set(snapshot.catalogEntries.map((entry) => entry.id)),
    [snapshot.catalogEntries],
  );
  const listRef = useRef<HTMLDivElement>(null);
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
  }, [focusedMessageId, onMessageFocused, timeline]);
  return (
    <section
      className="chat-panel activity-feed"
      role="tabpanel"
      id="chat-panel-activity"
      aria-labelledby="chat-tab-activity"
    >
      <section className="activity-roll-controls" aria-label="Быстрые броски">
        <div className="activity-roll-controls__heading">
          <strong>Быстрые броски</strong>
          {snapshot.me.role === "GM" && availableRollCharacters.length > 0 && (
            <FormSelect
              aria-label="Персонаж для броска"
              value={rollCharacter?.id ?? ""}
              onChange={(event) => setRollCharacterId(event.target.value)}
            >
              {availableRollCharacters.map((character) => (
                <option key={character.id} value={character.id}>
                  {character.name}
                </option>
              ))}
            </FormSelect>
          )}
          <label className="compact-check">
            <FormInput
              type="checkbox"
              checked={physicalDice}
              onChange={(event) => {
                const enabled = event.target.checked;
                setPhysicalDice(enabled);
                window.localStorage.setItem(
                  physicalDiceStorageKey(snapshot.me.id),
                  String(enabled),
                );
              }}
            />
            Физические кубы
          </label>
        </div>
        {rollCharacter ? (
          <div className="activity-quick-rolls">
            <Button
              disabled={quickRollPending}
              onClick={() =>
                void submitQuickRoll(
                  "1d20 + agility",
                  "Инициатива",
                  rollCharacter.stats.agility ?? 0,
                )
              }
            >
              Инициатива
            </Button>
            {arkenSystem.stats.map((stat) => (
              <Button
                key={stat.key}
                disabled={quickRollPending}
                onClick={() =>
                  void submitQuickRoll(
                    `1d20 + ${stat.key}`,
                    stat.label,
                    rollCharacter.stats[stat.key] ?? stat.defaultValue,
                  )
                }
              >
                {stat.label}
              </Button>
            ))}
            {rollCharacter.skills.map((skill) => (
              <Button
                key={skill.key}
                disabled={quickRollPending}
                onClick={() =>
                  void submitQuickRoll(
                    skill.formula,
                    skill.name,
                    formulaBonus(skill.formula, rollCharacter.stats),
                  )
                }
              >
                {skill.name}
              </Button>
            ))}
          </div>
        ) : (
          <p className="muted">Нет доступного персонажа для броска.</p>
        )}
        <fieldset className="activity-filters">
          <legend>Показывать</legend>
          {(["ROLLS", "STORY", "REFERENCE"] as const).map((filter) => (
            <label className="compact-check" key={filter}>
              <FormInput
                type="checkbox"
                checked={activityFilters.has(filter)}
                onChange={(event) =>
                  setActivityFilters((current) => {
                    const next = new Set(current);
                    if (event.target.checked) next.add(filter);
                    else next.delete(filter);
                    return next;
                  })
                }
              />
              {filter === "ROLLS"
                ? "Броски"
                : filter === "STORY"
                  ? "Сюжет"
                  : "Справочные события"}
            </label>
          ))}
        </fieldset>
      </section>
      <div className="message-list" aria-live="polite" ref={listRef}>
        {timeline.length === 0 && (
          <p className="chat-empty">
            {
              "В ленте событий пока нет сообщений, сюжетных публикаций или бросков."
            }
          </p>
        )}
        {timeline.map((item) => {
          if (item.type === "DATE")
            return (
              <div
                className="chat-date-divider"
                key={`activity-date-${item.key}`}
              >
                <span>{item.label}</span>
              </div>
            );
          if (item.event.type === "STORY_POST")
            return (
              <StoryPost
                key={`activity-story-${item.event.id}`}
                post={item.event.post}
                isGm={false}
              />
            );
          const { message, stream, id, occurredAt } = item.event;
          return (
            <article
              key={`activity-message-${id}`}
              id={`chat-message-${id}`}
              className={`message ${message.kind.toLowerCase()}`}
              data-activity-stream={stream}
              tabIndex={-1}
            >
              <header>
                <strong>{message.displayName}</strong>
                <span className="activity-stream-label">
                  {CHAT_STREAM_LABEL[stream]}
                </span>
                {message.characterId && (
                  <span className="message-character">
                    {snapshot.characters.find(
                      (character) => character.id === message.characterId,
                    )?.name ?? "Персонаж"}
                  </span>
                )}
                <time>
                  {new Date(occurredAt).toLocaleTimeString([], {
                    hour: "2-digit",
                    minute: "2-digit",
                  })}
                </time>
                {message.visibility === "GM_ONLY" && <span>{"мастеру"}</span>}
              </header>
              <ChatMessageBody
                message={message}
                catalogEntryIds={
                  snapshot.me.role === "GM" ? catalogEntryIds : undefined
                }
                playerRequests={snapshot.playerRequests}
                onOpenPlayerRequests={onOpenPlayerRequestCreate}
              />
            </article>
          );
        })}
      </div>
      <form className="chat-compose" onSubmit={submit}>
        <div className="chat-composer-input">
          <FormTextArea
            aria-label="Сообщение или бросок"
            aria-expanded={slashSuggestions.length > 0}
            aria-controls={
              slashSuggestions.length > 0
                ? "activity-slash-suggestions"
                : undefined
            }
            placeholder={"Сообщение? Введите / для быстрых команд"}
            value={composer}
            onChange={(event) => {
              setSlashHelpOpen(false);
              setComposer(event.target.value);
            }}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey) {
                event.preventDefault();
                event.currentTarget.form?.requestSubmit();
              }
            }}
            rows={3}
          />
          <div className="chat-composer-actions">
            {!composer.trim() && (
              <StickerPicker
                iconOnly
                onSelect={(stickerId) =>
                  onSticker({ stream: "TABLE" }, stickerId)
                }
              />
            )}
            <Button
              className="composer-icon composer-slash-action"
              type="button"
              view="flat"
              aria-label="Быстрые команды"
              title="Быстрые команды"
              aria-expanded={slashSuggestions.length > 0}
              onClick={() => setSlashHelpOpen((open) => !open)}
            >
              <span aria-hidden="true">/</span>
            </Button>
          </div>
          {slashSuggestions.length > 0 && (
            <div
              className="slash-command-suggestions"
              id="activity-slash-suggestions"
              role="listbox"
              aria-label="Команды чата"
            >
              {slashSuggestions.map((suggestion) => (
                <button
                  key={suggestion.command}
                  type="button"
                  role="option"
                  aria-selected="false"
                  onClick={() =>
                    executeActivitySuggestion(suggestion.insertion)
                  }
                >
                  <strong>{suggestion.command}</strong>
                  <span>{suggestion.description}</span>
                  <code>{suggestion.example}</code>
                </button>
              ))}
            </div>
          )}
        </div>
        <div className="chat-compose-submit">
          <Button className="primary" type="submit">
            {"Отправить"}
          </Button>
          {snapshot.me.role === "PLAYER" && (
            <Button
              type="button"
              view="flat"
              onClick={onOpenPlayerRequestCreate}
            >
              Заявка
            </Button>
          )}
          <label className="compact-check chat-visibility-check">
            <FormInput
              type="checkbox"
              checked={visibility === "GM_ONLY"}
              onChange={(event) =>
                setVisibility(event.target.checked ? "GM_ONLY" : "PUBLIC")
              }
            />
            <span>{"Только мастер"}</span>
          </label>
        </div>
      </form>
      {composerError && (
        <p className="composer-error" role="alert">
          {composerError}
        </p>
      )}
    </section>
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
  const contacts = directChatContacts(snapshot);
  const activeThread =
    threads.find((thread) => thread.id === activeThreadId) ?? null;
  const [selectedPeerId, setSelectedPeerId] = useState(
    () =>
      restoreDirectSelection(window.localStorage, snapshot)?.peerMembershipId ??
      "",
  );
  const [selectingPeer, setSelectingPeer] = useState(false);
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
    const restored = restoreDirectSelection(window.localStorage, snapshot);
    if (!restored) {
      setSelectedPeerId("");
      if (activeThreadId) onActiveThreadChange(null);
      return;
    }
    setSelectedPeerId(restored.peerMembershipId);
    if (activeThreadId !== restored.threadId)
      onActiveThreadChange(restored.threadId);
  }, [activeThreadId, onActiveThreadChange, snapshot]);

  useEffect(() => {
    if (!selectedPeerId) return;
    const thread = directThreadForPeer(snapshot, selectedPeerId);
    if (thread && activeThreadId !== thread.id) {
      onActiveThreadChange(thread.id);
      persistDirectSelection(window.localStorage, snapshot, {
        peerMembershipId: selectedPeerId,
        threadId: thread.id,
      });
    }
  }, [activeThreadId, onActiveThreadChange, selectedPeerId, snapshot]);

  useEffect(() => {
    if (!activeThread || latestSequence === undefined) return;
    const timer = window.setTimeout(
      () => void onMarkChatRead(activeThread.id, latestSequence),
      350,
    );
    return () => window.clearTimeout(timer);
  }, [activeThread, latestSequence, onMarkChatRead]);

  async function selectPeer(peerMembershipId: string) {
    setSelectedPeerId(peerMembershipId);
    setError("");
    if (!peerMembershipId) {
      onActiveThreadChange(null);
      persistDirectSelection(window.localStorage, snapshot, null);
      return;
    }
    const existing = directThreadForPeer(snapshot, peerMembershipId);
    if (existing) {
      onActiveThreadChange(existing.id);
      persistDirectSelection(window.localStorage, snapshot, {
        peerMembershipId,
        threadId: existing.id,
      });
      return;
    }
    setSelectingPeer(true);
    try {
      const thread = await onCreateThread(peerMembershipId);
      onActiveThreadChange(thread.id);
      persistDirectSelection(window.localStorage, snapshot, {
        peerMembershipId,
        threadId: thread.id,
      });
    } catch {
      setSelectedPeerId("");
      onActiveThreadChange(null);
      persistDirectSelection(window.localStorage, snapshot, null);
      setError("Не удалось открыть личный диалог.");
    } finally {
      setSelectingPeer(false);
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
        <select
          className="direct-peer-select"
          aria-label="Собеседник"
          value={selectedPeerId}
          disabled={selectingPeer || contacts.length === 0}
          onChange={(event) => void selectPeer(event.target.value)}
        >
          <option value="">Выберите собеседника</option>
          {contacts.map((contact) => {
            const thread = directThreadForPeer(snapshot, contact.membershipId);
            const unread = thread ? directUnreadCount(snapshot, thread.id) : 0;
            return (
              <option key={contact.membershipId} value={contact.membershipId}>
                {contact.displayName}
                {unread ? ` ? ${unread}` : ""}
              </option>
            );
          })}
        </select>
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
  onOpenPlayerRequests,
}: {
  snapshot: GameSnapshot;
  onChat: Props["onChat"];
  onSticker: Props["onSticker"];
  onRoll: Props["onRoll"];
  onMarkChatRead: Props["onMarkChatRead"];
  activeStream: ChatStream;
  focusedMessageId: string | null;
  onMessageFocused: () => void;
  onOpenPlayerRequests: () => void;
}) {
  const [composer, setComposer] = useState("");
  const [visibility, setVisibility] = useState<MessageVisibility>("PUBLIC");
  const [composerError, setComposerError] = useState("");
  const [slashHelpOpen, setSlashHelpOpen] = useState(false);
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
    activeStream === "TABLE"
      ? slashHelpOpen
        ? getSlashCommandSuggestions("/")
        : getSlashCommandSuggestions(composer)
      : [];
  const executeChatSuggestion = (insertion: string) => {
    const intent = parseComposerInput(insertion);
    setSlashHelpOpen(false);
    if (intent.kind !== "ROLL") {
      setComposer(insertion);
      return;
    }
    setComposer("");
    setComposerError("");
    void onRoll(
      intent.formula,
      intent.label,
      visibility,
      snapshot.me.characterId,
      "NORMAL",
    ).catch(() =>
      setComposerError("Не удалось выполнить бросок. Повторите попытку."),
    );
  };

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
                playerRequests={snapshot.playerRequests}
                onOpenPlayerRequests={onOpenPlayerRequests}
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
          {"Броски появляются здесь автоматически."}
        </p>
      )}
      {activeStream === "STORY" && snapshot.me.role !== "GM" && (
        <p className="chat-stream-note">{"Сюжетный поток ведёт мастер."}</p>
      )}
      {canCompose && (
        <>
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
                onChange={(event) => {
                  setSlashHelpOpen(false);
                  setComposer(event.target.value);
                }}
                onKeyDown={(event) => {
                  if (event.key === "Enter" && !event.shiftKey) {
                    event.preventDefault();
                    event.currentTarget.form?.requestSubmit();
                  }
                }}
                rows={3}
              />
              <div className="chat-composer-actions">
                {!composer.trim() && (
                  <StickerPicker
                    iconOnly
                    onSelect={(stickerId) =>
                      onSticker(
                        { stream: activeStream as "TABLE" | "STORY" },
                        stickerId,
                      )
                    }
                  />
                )}
                <Button
                  className="composer-icon composer-slash-action"
                  type="button"
                  view="flat"
                  aria-label="Быстрые команды"
                  title="Быстрые команды"
                  aria-expanded={slashSuggestions.length > 0}
                  onClick={() => setSlashHelpOpen((open) => !open)}
                >
                  <span aria-hidden="true">/</span>
                </Button>
              </div>
              {slashSuggestions.length > 0 && (
                <div
                  className="slash-command-suggestions"
                  id="chat-slash-suggestions"
                  role="listbox"
                  aria-label={"Команды чата"}
                >
                  {slashSuggestions.map((suggestion) => (
                    <button
                      key={suggestion.command}
                      type="button"
                      role="option"
                      aria-selected="false"
                      onClick={() =>
                        executeChatSuggestion(suggestion.insertion)
                      }
                    >
                      <strong>{suggestion.command}</strong>
                      <span>{suggestion.description}</span>
                      <code>{suggestion.example}</code>
                    </button>
                  ))}
                </div>
              )}
            </div>
            <div className="chat-compose-submit">
              <Button className="primary" type="submit">
                {"Отправить"}
              </Button>
              <label className="compact-check chat-visibility-check">
                <FormInput
                  type="checkbox"
                  checked={visibility === "GM_ONLY"}
                  onChange={(event) =>
                    setVisibility(event.target.checked ? "GM_ONLY" : "PUBLIC")
                  }
                />
                <span>{"Только мастер"}</span>
              </label>
            </div>
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
          onGenerateTokenImage={props.onGenerateTokenImage}
          onCancel={() => setEditor(null)}
          onCreate={props.onCreateTokenDefinition}
          onPatch={props.onPatchTokenDefinition}
          onReplaceControllers={props.onReplaceTokenControllers}
          onOpenCharacters={() => {
            setEditor(null);
            props.onWorkspaceChange("setup");
          }}
          onOpenMedia={() => {
            setEditor(null);
            props.onWorkspaceChange("media");
          }}
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
  onGenerateTokenImage,
  onCancel,
  onCreate,
  onPatch,
  onReplaceControllers,
  onOpenCharacters,
  onOpenMedia,
}: {
  snapshot: GameSnapshot;
  definition?: NonNullable<GameSnapshot["tokenDefinitions"]>[number];
  onUpload: Props["onUpload"];
  onGenerateTokenImage: Props["onGenerateTokenImage"];
  onCancel: () => void;
  onCreate: Props["onCreateTokenDefinition"];
  onPatch: Props["onPatchTokenDefinition"];
  onReplaceControllers: Props["onReplaceTokenControllers"];
  onOpenCharacters: () => void;
  onOpenMedia: () => void;
}) {
  const activeScene = snapshot.scenes.find((scene) => scene.active);
  const gridSize = activeScene?.grid.enabled ? activeScene.grid.size : 64;
  const initialWidth = (definition?.defaultWidth ?? 64) / gridSize;
  const initialHeight = (definition?.defaultHeight ?? 64) / gridSize;
  const [name, setName] = useState(definition?.name ?? "");
  const [characterId, setCharacterId] = useState(definition?.characterId ?? "");
  const [assetId, setAssetId] = useState(definition?.defaultAssetId ?? "");
  const [width, setWidth] = useState(initialWidth);
  const [height, setHeight] = useState(initialHeight);
  const [lockAspect, setLockAspect] = useState(true);
  const aspectRatio = useRef(
    initialHeight > 0 ? initialWidth / initialHeight : 1,
  );
  const [controllers, setControllers] = useState<string[]>(
    definition?.controllerMembershipIds ?? [],
  );
  const [image, setImage] = useState<File>();
  const [uploadedSource, setUploadedSource] = useState<AssetDto>();
  const uploadSourcePromise = useRef<Promise<AssetDto> | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!name.trim()) return setError("Укажите название токена.");
    setSaving(true);
    setError("");
    try {
      let selectedAssetId = assetId || null;
      if (image && uploadSourcePromise.current) {
        const uploaded = await uploadSourcePromise.current;
        if (!selectedAssetId) selectedAssetId = uploaded.id;
      }
      const input = {
        name: name.trim(),
        characterId: characterId || null,
        defaultAssetId: selectedAssetId,
        // The API keeps pixel values for backwards compatibility. The editor
        // exposes grid units, so a token follows the active scene's grid.
        defaultWidth: Math.round(width * gridSize),
        defaultHeight: Math.round(height * gridSize),
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
            emptyMessage={
              snapshot.characters.length === 0
                ? "Персонажей пока нет"
                : undefined
            }
            createAction={
              snapshot.characters.length === 0
                ? { label: "Создать персонажа", onSelect: onOpenCharacters }
                : undefined
            }
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
            emptyMessage={
              tokenDefinitionAssets(
                mergeAssets(snapshot.assets, uploadedSource),
              ).length === 0
                ? "Изображений токенов пока нет"
                : undefined
            }
            createAction={
              tokenDefinitionAssets(
                mergeAssets(snapshot.assets, uploadedSource),
              ).length === 0
                ? { label: "Добавить изображение", onSelect: onOpenMedia }
                : undefined
            }
          >
            <option value="">Без изображения</option>
            {tokenDefinitionAssets(
              mergeAssets(snapshot.assets, uploadedSource),
            ).map((asset) => (
              <option key={asset.id} value={asset.id}>
                {tokenAssetLabel(asset)}
              </option>
            ))}
          </FormSelect>
        </label>
        <TokenImageGenerator
          imageAssets={tokenGeneratorSources(
            mergeAssets(snapshot.assets, uploadedSource),
          )}
          disabled={saving}
          onGenerate={onGenerateTokenImage}
          onGenerated={(asset) => setAssetId(asset.id)}
        />
        <ImageUploadField
          label="Загрузить новое изображение"
          value={image}
          hint="После выбора файл станет доступен в генераторе"
          onUpdate={(file) => {
            setImage(file);
            setError("");
            setUploadedSource(undefined);
            uploadSourcePromise.current = null;
            if (!file) return;
            const upload = onUpload(file, "IMAGE");
            uploadSourcePromise.current = upload;
            void upload
              .then((asset) => {
                if (uploadSourcePromise.current !== upload) return;
                setUploadedSource(asset);
                setAssetId(asset.id);
              })
              .catch((reason) => {
                if (uploadSourcePromise.current !== upload) return;
                uploadSourcePromise.current = null;
                setError(
                  reason instanceof Error
                    ? reason.message
                    : "Не удалось загрузить исходное изображение.",
                );
              });
          }}
          disabled={saving}
        />
        <section className="token-dimensions" aria-label={"Размер токена"}>
          <p className="token-dimensions__hint">
            {"Размер в клетках активной сетки"} ({gridSize}
            {" px на клетку"}).
          </p>
          <div className="inline-fields">
            <label>
              {"Ширина, клетки"}
              <FormInput
                type="number"
                min={0.25}
                max={16}
                step={0.25}
                value={width}
                onChange={(event) => {
                  const next = Math.max(0.25, Number(event.target.value));
                  setWidth(next);
                  if (lockAspect) setHeight(next / aspectRatio.current);
                }}
              />
            </label>
            <label>
              {"Высота, клетки"}
              <FormInput
                type="number"
                min={0.25}
                max={16}
                step={0.25}
                value={height}
                onChange={(event) => {
                  const next = Math.max(0.25, Number(event.target.value));
                  setHeight(next);
                  if (lockAspect) setWidth(next * aspectRatio.current);
                }}
              />
            </label>
            <label className="aspect-lock">
              <FormInput
                type="checkbox"
                checked={lockAspect}
                onChange={(event) => {
                  setLockAspect(event.target.checked);
                  if (height > 0) aspectRatio.current = width / height;
                }}
              />
              {"Сохранять пропорции"}
            </label>
          </div>
        </section>
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

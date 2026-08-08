import {
  useEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from "react";
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
import { Button } from "@gravity-ui/uikit";
import type { GameSocket } from "./realtime";
import type { CharacterTemplateFields } from "./character-workspace-state";
import type { RollMode } from "./RollModeControl";
import type { TokenFramePreset } from "./token-image-editor-state";
import { ArkenDialog } from "./ui/ArkenDialog";
import { SceneManagerDialog, type SceneDraft } from "./ui/SceneManagerDialog";
import { StoryChannel, type StoryDraftInput } from "./StoryChannel";
import { WorldMapsWorkspace } from "./WorldMapsWorkspace";
import { OperatorFeedbackWorkspace } from "./OperatorFeedbackWorkspace";
import { WorldContentWorkspace } from "./WorldContentWorkspace";
import { PlayerRequestsWorkspace } from "./PlayerRequestsWorkspace";
import {
  CHAT_STREAM_LABEL,
  CHAT_STREAM_ORDER,
  messagesForStream,
  streamForMessage,
  threadForStream,
  unreadCountForStream,
} from "./chat-state";
import { activityTableReadTarget, feedForChatStream } from "./sidebar-feed";
import { CharacterWorkspace } from "./sidebar/CharacterWorkspace";
import {
  ActivityPanel,
  ChatPanel,
  DirectChatPanel,
} from "./sidebar/ChatPanels";
import { PalettePanel } from "./sidebar/TokenPalette";
import { SetupPanel } from "./sidebar/SetupPanel";
import { MediaPanel } from "./sidebar/MediaPanel";

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

export type Props = {
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
  onCreateCharacter: (
    name: string,
    template?: CharacterTemplateFields,
  ) => Promise<void>;
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
  /** UIX-372: pointer handlers driving the sidebar's drag-to-resize width
   * handle. Left to the caller (App.tsx) since it owns the persisted width
   * and the `--sidebar-width` custom property on `.workbench`. */
  onResizeHandleDown: (event: ReactPointerEvent<HTMLButtonElement>) => void;
  onResizeHandleMove: (event: ReactPointerEvent<HTMLButtonElement>) => void;
  onResizeHandleUp: (event: ReactPointerEvent<HTMLButtonElement>) => void;
  workspace:
    | "characters"
    | "tokens"
    | "scenes"
    | "setup"
    | "media"
    | "world-maps"
    | "operator-feedback"
    | "player-requests"
    | "world-encyclopedia"
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
      | "world-encyclopedia"
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
        className="sidebar-resize-handle"
        aria-label="Изменить ширину боковой панели"
        title="Перетащите, чтобы изменить ширину боковой панели"
        onPointerDown={props.onResizeHandleDown}
        onPointerMove={props.onResizeHandleMove}
        onPointerUp={props.onResizeHandleUp}
        onPointerCancel={props.onResizeHandleUp}
      />
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
        {props.workspace === "world-encyclopedia" && isGm && (
          <WorldContentWorkspace
            open
            assets={props.snapshot.assets}
            onClose={() => props.onWorkspaceChange(null)}
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

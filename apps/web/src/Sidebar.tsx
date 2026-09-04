import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from "react";
import type {
  ChatStream,
  CharacterDto,
  GameSnapshot,
  InitiativeParticipantDto,
  MessageVisibility,
  StoryPostAdminDto,
  StoryPostDto,
} from "@arken/contracts";
import { Button } from "@gravity-ui/uikit";
import type { GameSocket } from "./realtime";
import { useCampaignActions } from "./campaign-actions-context";
import type { CharacterTemplateFields } from "./character-workspace-state";
import { ArkenDialog } from "./ui/ArkenDialog";
import { SceneManagerDialog } from "./ui/SceneManagerDialog";
import { StoryChannel } from "./StoryChannel";
import { WorldMapsWorkspace } from "./WorldMapsWorkspace";
import { OperatorFeedbackWorkspace } from "./OperatorFeedbackWorkspace";
import { WorldContentWorkspace } from "./WorldContentWorkspace";
import { WorldEncyclopediaWorkspace } from "./WorldEncyclopediaWorkspace";
import { PlayerRequestsWorkspace } from "./PlayerRequestsWorkspace";
import {
  CHAT_STREAM_LABEL,
  messagesForStream,
  streamForMessage,
  threadForStream,
  unreadCountForStream,
} from "./chat-state";
import {
  activityReadTargets,
  allowedSidebarFeed,
  chatFeedOrder,
  feedForChatStream,
} from "./sidebar-feed";
import { ACTIVITY_FILTERS } from "./activity-filter-menu";
import type { ActivityFilter } from "./activity-roll-controls";
import { CharacterWorkspace } from "./sidebar/CharacterWorkspace";
import {
  ActivityPanel,
  ChatPanel,
  DirectChatPanel,
} from "./sidebar/ChatPanels";
import { PalettePanel } from "./sidebar/TokenPalette";
import { SetupPanel } from "./sidebar/SetupPanel";
import { MediaPanel } from "./sidebar/MediaPanel";
import type { CharacterCounterMutationIntent } from "./character-counter-mutation";
import { CampaignStatLabelsProvider } from "./campaign-stat-labels-context";

type SidebarFeed = "ACTIVITY" | ChatStream;

// UIX-467: порядок больше не модульная константа — он зависит от роли, потому
// что «Сюжет» у игрока скрыт. Список берётся из `chatFeedOrder`, чтобы стрелки
// не уводили на вкладку, которой в разметке нет.
function nextChatFeed(
  current: SidebarFeed,
  key: string,
  isGm: boolean,
): SidebarFeed | null {
  const order = chatFeedOrder(isGm);
  const index = order.indexOf(current);
  if (key === "Home") return order[0] ?? null;
  if (key === "End") return order.at(-1) ?? null;
  if (key === "ArrowRight") return order[(index + 1) % order.length] ?? null;
  if (key === "ArrowLeft")
    return order[(index - 1 + order.length) % order.length] ?? null;
  return null;
}

export type Props = {
  snapshot: GameSnapshot;
  requestedCharacterId?: string | null;
  socket: GameSocket | null;
  presence: Array<{ membershipId: string; online: boolean }>;
  onReplaceCharacterControllers: (
    characterId: string,
    revision: number,
    controllerMembershipIds: string[],
  ) => Promise<void>;
  onPatchCharacter: (id: string, patch: Partial<CharacterDto>) => Promise<void>;
  storyPosts: Array<StoryPostDto | StoryPostAdminDto>;
  storyNextCursor: string | null;
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
  viewedSceneId: string | null;
  sceneDialogRequest: number;
  /** UIX-431: выделение с карты и правка очереди ходов. */
  selectedTokenIds: readonly string[];
  onUpdateInitiative: (
    participants: InitiativeParticipantDto[],
    revision: number,
  ) => Promise<void>;
  onSetOwnInitiative: (
    participantId: string,
    initiative: number | null,
    revision: number,
  ) => Promise<void>;
  onRollInitiative: (
    participants: readonly InitiativeParticipantDto[],
    participant: InitiativeParticipantDto,
    revision: number,
    isGm: boolean,
  ) => Promise<void>;
  /** UIX-466 п. 3: подтянуть в очередь тех, кто в зоне боя; отсутствует, когда зона не задана. */
  onRecruitFromBattleZone?: () => void;
  onPreviewPlayer: (membershipId: string) => Promise<void>;
  onUpdateCounters: (
    characterId: string,
    revision: number,
    patch: {
      wallet?: CharacterDto["wallet"];
      resources?: CharacterDto["resources"];
      rest?: "SHORT" | "LONG";
    },
    intent?: CharacterCounterMutationIntent,
  ) => Promise<void>;
  onCampaignClock: (
    command:
      | "ADVANCE_DAY"
      | "LONG_REST"
      | "START_BATTLE"
      | "END_BATTLE"
      | "RESET_CLOCK",
    revision: number,
  ) => Promise<void>;
  requestedChatMessageId: string | null;
  onRequestedChatMessageHandled: () => void;
  onChatVisibilityChange: (visible: boolean) => void;
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
    | "world-codex"
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
      | "world-codex"
      | null,
  ) => void;
};

export function Sidebar(props: Props) {
  return (
    <CampaignStatLabelsProvider layout={props.snapshot.campaign.statLayout}>
      <SidebarContent {...props} />
    </CampaignStatLabelsProvider>
  );
}

function SidebarContent(props: Props) {
  // UIX-398 step B: scene commands arrive by context rather than as six props
  // threaded through every layer. See campaign-actions-context.tsx.
  const {
    scene: sceneActions,
    worldMap: worldMapActions,
    playerRequest: playerRequestActions,
    story: storyActions,
    chat: chatActions,
    asset: assetActions,
  } = useCampaignActions();
  const {
    onChatVisibilityChange,
    onRequestedChatMessageHandled,
    requestedChatMessageId,
    onWorkspaceChange,
    sceneDialogRequest,
  } = props;
  const { onActiveChatThreadChange, onMarkChatRead } = chatActions;
  const { messages: snapshotMessages, chatThreads: snapshotChatThreads } =
    props.snapshot;
  const isGm = props.snapshot.me.role === "GM";
  const [focusedMessageId, setFocusedMessageId] = useState<string | null>(null);
  const readSequenceRef = useRef(new Map<string, number>());
  const [selectedFeed, setActiveFeed] = useState<SidebarFeed>("ACTIVITY");
  const [activityFilters, setActivityFilters] = useState<Set<ActivityFilter>>(
    () => new Set(ACTIVITY_FILTERS),
  );
  // UIX-467: «Сюжет» скрыт у игрока, поэтому доступность ленты проверяется на
  // чтении, а не в каждой из точек, где её выставляют. Переход к сообщению
  // сюжета и восстановление прежней вкладки одинаково приводят игрока к
  // «Событиям», и панель не может отрисоваться без своей вкладки.
  const activeFeed = allowedSidebarFeed(selectedFeed, isGm);
  const [directMode, setDirectMode] = useState(false);
  const [activeDirectThreadId, setActiveDirectThreadId] = useState<
    string | null
  >(null);
  useEffect(
    () => onChatVisibilityChange(!props.collapsed),
    [onChatVisibilityChange, props.collapsed],
  );
  // UIX-395: stable onClose for the self-fetching, React.memo-wrapped GM
  // workspace panels (OperatorFeedbackWorkspace, WorldContentWorkspace,
  // WorldEncyclopediaWorkspace). `onWorkspaceChange` (handleWorkspaceChange
  // in App.tsx) is itself useCallback-stable, so this closure is stable for
  // the component's whole lifetime — without it, `() => onWorkspaceChange(null)`
  // inline at each usage site would be a fresh function every Sidebar
  // render (which happens on every realtime snapshot event), defeating
  // React.memo's shallow prop comparison on those panels.
  const closeWorkspace = useCallback(
    () => onWorkspaceChange(null),
    [onWorkspaceChange],
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
    for (const target of activityReadTargets(props.snapshot, activityFilters)) {
      if (
        (readSequenceRef.current.get(target.threadId) ?? 0) >= target.sequence
      )
        continue;
      readSequenceRef.current.set(target.threadId, target.sequence);
      void onMarkChatRead(target.threadId, target.sequence).catch(() => {
        // A newer request may already own the ref when an older one fails.
        if (readSequenceRef.current.get(target.threadId) === target.sequence)
          readSequenceRef.current.delete(target.threadId);
      });
    }
  }, [activeFeed, activityFilters, directMode, onMarkChatRead, props.snapshot]);
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
          const nextFeed = nextChatFeed(activeFeed, event.key, isGm);
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
        {chatFeedOrder(isGm)
          .filter((feed): feed is ChatStream => feed !== "ACTIVITY")
          .map((stream) => {
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
            onCreateThread={chatActions.onCreateDirectThread}
            onDirectChat={chatActions.onDirectChat}
            onSticker={chatActions.onSticker}
            onUploadAttachment={chatActions.onUploadChatAttachment}
            onMarkChatRead={chatActions.onMarkChatRead}
          />
        ) : activeFeed === "ACTIVITY" ? (
          <ActivityPanel
            snapshot={props.snapshot}
            storyPosts={props.storyPosts}
            activityFilters={activityFilters}
            onActivityFiltersChange={setActivityFilters}
            onChat={chatActions.onChat}
            onSticker={chatActions.onSticker}
            onRoll={props.onRoll}
            focusedMessageId={focusedMessageId}
            onMessageFocused={() => setFocusedMessageId(null)}
            onOpenPlayerRequestCreate={
              playerRequestActions.onOpenPlayerRequestCreate
            }
            onUpdateCounters={props.onUpdateCounters}
            selectedTokenIds={props.selectedTokenIds}
            onUpdateInitiative={props.onUpdateInitiative}
            onSetOwnInitiative={props.onSetOwnInitiative}
            onRollInitiative={props.onRollInitiative}
            onRecruitFromBattleZone={props.onRecruitFromBattleZone}
          />
        ) : activeFeed === "STORY" ? (
          <StoryChannel
            posts={props.storyPosts}
            nextCursor={props.storyNextCursor}
            onLoadMore={storyActions.onLoadMoreStoryPosts}
            legacyMessages={messagesForStream(
              props.snapshot.messages,
              "STORY",
              props.snapshot.chatThreads,
            )}
            isGm={isGm}
            onCreateDraft={isGm ? storyActions.onCreateStoryDraft : undefined}
            onPublish={isGm ? storyActions.onPublishStoryPost : undefined}
            onUpdate={isGm ? storyActions.onUpdateStoryPost : undefined}
            onArchive={isGm ? storyActions.onArchiveStoryPost : undefined}
            onUploadImage={
              isGm ? chatActions.onUploadChatAttachment : undefined
            }
          />
        ) : (
          <ChatPanel
            snapshot={props.snapshot}
            onChat={chatActions.onChat}
            onSticker={chatActions.onSticker}
            onRoll={props.onRoll}
            onMarkChatRead={chatActions.onMarkChatRead}
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
            onView={sceneActions.onViewScene}
            onPublish={sceneActions.onActivateScene}
            onSave={sceneActions.onSaveScene}
            onUpload={assetActions.uploadAsset}
          />
        )}
        {props.workspace === "operator-feedback" &&
          props.operatorFeedbackAllowed && (
            <OperatorFeedbackWorkspace open onClose={closeWorkspace} />
          )}
        {props.workspace === "player-requests" && (
          <PlayerRequestsWorkspace
            open
            snapshot={props.snapshot}
            onClose={() => props.onWorkspaceChange(null)}
            onCreate={playerRequestActions.onCreatePlayerRequest}
            onUpdate={playerRequestActions.onUpdatePlayerRequest}
            onAction={playerRequestActions.onPlayerRequestAction}
          />
        )}
        {props.workspace === "world-maps" && (
          <WorldMapsWorkspace
            open
            snapshot={props.snapshot}
            onClose={() => props.onWorkspaceChange(null)}
            onOpenScene={(sceneId) => {
              sceneActions.onViewScene(sceneId);
              props.onWorkspaceChange(null);
            }}
            onCreateMap={worldMapActions.onCreateWorldMap}
            onSetDraftBackground={worldMapActions.onSetWorldMapDraftBackground}
            onApproveBackground={worldMapActions.onApproveWorldMapBackground}
            onPublishMap={worldMapActions.onPublishWorldMap}
            onArchiveMap={worldMapActions.onArchiveWorldMap}
            onCreateLocation={worldMapActions.onCreateWorldMapLocation}
            onUpdateLocation={worldMapActions.onUpdateWorldMapLocation}
            onLinkLocationScene={worldMapActions.onLinkWorldMapLocationScene}
            onUnlinkLocationScene={
              worldMapActions.onUnlinkWorldMapLocationScene
            }
            onSetPartyPosition={worldMapActions.onSetWorldMapPartyPosition}
            onClearPartyPosition={worldMapActions.onClearWorldMapPartyPosition}
          />
        )}
        {props.workspace === "world-encyclopedia" && isGm && (
          <WorldContentWorkspace
            open
            assets={props.snapshot.assets}
            onClose={closeWorkspace}
          />
        )}
        {props.workspace === "world-codex" && (
          <WorldEncyclopediaWorkspace open onClose={closeWorkspace} />
        )}
        {props.workspace === "media" && (
          <ArkenDialog
            open
            footer={false}
            title="Файлы"
            variant="workspace"
            onClose={() => props.onWorkspaceChange(null)}
          >
            <MediaPanel
              snapshot={props.snapshot}
              onUpload={assetActions.uploadAsset}
              onGetUsage={assetActions.getAssetUsage}
              onDelete={assetActions.deleteAsset}
            />
          </ArkenDialog>
        )}
      </div>
    </aside>
  );
}

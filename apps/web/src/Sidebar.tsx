import { memo, useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type {
  ChatStream,
  GameSnapshot,
  StoryPostAdminDto,
  StoryPostDto,
} from "@arken/contracts";
import { Button } from "./design-system/Button";
import type { GameSocket } from "./realtime";
import { useCampaignActions } from "./campaign-actions-context";
import { ArkenDialog } from "./ui/ArkenDialog";
import { AppIcon } from "./ui/AppIcon";
import { SidebarCollapseIcon } from "./ui/icons";
import { SceneManagerDialog } from "./ui/SceneManagerDialog";
import { StoryChannel } from "./StoryChannel";
import { StoryAttachmentLibrary } from "./StoryAttachmentLibrary";
import { useThreadHistory } from "./use-thread-history";
import { WorldMapsWorkspace } from "./WorldMapsWorkspace";
import { OperatorFeedbackWorkspace } from "./OperatorFeedbackWorkspace";
import { WorldContentWorkspace } from "./WorldContentWorkspace";
import { EconomyWorkspace } from "./EconomyWorkspace";
import { CreationWorkspace } from "./CreationWorkspace";
import { SpellSchoolsWorkspace } from "./SpellSchoolsWorkspace";
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
import { CampaignStatLabelsProvider } from "./campaign-stat-labels-context";

import {
  directThreads,
  directUnreadCount,
  persistDirectSelection,
} from "./direct-chat-state";

type SidebarFeed = "ACTIVITY" | ChatStream;

// UIX-467: порядок больше не модульная константа — он зависит от роли, потому
// что «Сюжет» у игрока скрыт. Список берётся из `chatFeedOrder`, чтобы стрелки
// не уводили на вкладку, которой в разметке нет.
function nextChatFeed(
  current: SidebarFeed | "DIRECT",
  key: string,
  isGm: boolean,
): SidebarFeed | "DIRECT" | null {
  const order: Array<SidebarFeed | "DIRECT"> = [
    ...chatFeedOrder(isGm),
    "DIRECT",
  ];
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
  storyPosts: Array<StoryPostDto | StoryPostAdminDto>;
  storyNextCursor: string | null;
  /** UIX-245: эпохи летописи и выбранный фильтр. */
  storyEras?: readonly string[];
  storyEraFilter?: string | null;
  viewedSceneId: string | null;
  sceneDialogRequest: number;
  requestedSceneEditId?: string | null;
  /** UIX-431: выделение с карты и правка очереди ходов. */
  selectedTokenIds: readonly string[];
  /** Mirrors the preview-aware battle-zone availability from App's view snapshot. */
  canRecruitFromBattleZone: boolean;
  requestedChatMessageId: string | null;
  collapsed: boolean;
  /** Compact surfaces retain one mounted feed and one cached character portal. */
  compact?: boolean;
  chatVisible?: boolean;
  keepCharacterWorkspaceMounted?: boolean;
  /** Width of the journal column, forwarded to body-portalled workspaces. */
  workspaceSidebarWidth?: number | null;
  workspace:
    | "characters"
    | "tokens"
    | "scenes"
    | "story"
    | "setup"
    | "media"
    | "world-maps"
    | "operator-feedback"
    | "player-requests"
    | "world-encyclopedia"
    | "spell-schools"
    | "shops"
    | "world-codex"
    | "creations"
    | null;
  operatorFeedbackAllowed: boolean;
};

function SidebarComponent(props: Props) {
  return (
    <CampaignStatLabelsProvider layout={props.snapshot.campaign.statLayout}>
      <SidebarContent
        key={props.snapshot.campaign.id + ":" + props.snapshot.me.id}
        {...props}
      />
    </CampaignStatLabelsProvider>
  );
}

export const Sidebar = memo(SidebarComponent);

function TokenPaletteWorkspacePortal({ props }: { props: Props }) {
  const { sidebar: sidebarActions } = useCampaignActions();
  return createPortal(
    <ArkenDialog
      open
      footer={false}
      title="Токены"
      variant="workspace"
      onClose={() => sidebarActions.onWorkspaceChange(null)}
    >
      <PalettePanel {...props} />
    </ArkenDialog>,
    document.body,
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
    character: characterActions,
    initiative: initiativeActions,
    dice: diceActions,
    sidebar: sidebarActions,
  } = useCampaignActions();
  const { requestedChatMessageId, sceneDialogRequest } = props;
  const {
    onChatVisibilityChange,
    onRequestedChatMessageHandled,
    onWorkspaceChange,
  } = sidebarActions;
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
  const chatVisible = props.chatVisible ?? !props.collapsed;
  const [activeDirectThreadId, setActiveDirectThreadId] = useState<
    string | null
  >(null);
  useEffect(
    () => onChatVisibilityChange(chatVisible),
    [onChatVisibilityChange, chatVisible],
  );
  // UIX-395: stable onClose for the self-fetching, React.memo-wrapped GM
  // workspace panels (OperatorFeedbackWorkspace, WorldContentWorkspace,
  // WorldEncyclopediaWorkspace). `onWorkspaceChange` (handleWorkspaceChange
  // in App.tsx) is itself useCallback-stable, so this closure is stable for
  // the component's whole lifetime — without it, `() => onWorkspaceChange(null)`
  // inline at each usage site would be a fresh function every Sidebar
  // render (which happens on every realtime snapshot event), defeating
  // React.memo's shallow prop comparison on those panels.
  const [spellSavePending, setSpellSavePending] = useState(false);
  const closeSpellWorkspace = useCallback(() => {
    if (!spellSavePending) onWorkspaceChange(null);
  }, [spellSavePending, onWorkspaceChange]);
  const closeWorkspace = useCallback(
    () => onWorkspaceChange(null),
    [onWorkspaceChange],
  );
  const storyWorkspaceOpen = props.workspace === "story" && isGm;
  const storyThreadId = threadForStream(props.snapshot, "STORY")?.id ?? null;
  const storyHistory = useThreadHistory(
    storyWorkspaceOpen ? props.snapshot : null,
    storyWorkspaceOpen ? storyThreadId : null,
    snapshotMessages,
  );
  const activeThreadId = storyWorkspaceOpen
    ? (threadForStream(props.snapshot, "STORY")?.id ?? null)
    : directMode
      ? activeDirectThreadId
      : activeFeed === "ACTIVITY"
        ? null
        : (threadForStream(props.snapshot, activeFeed)?.id ?? null);
  useEffect(() => {
    onActiveChatThreadChange(
      chatVisible || storyWorkspaceOpen ? activeThreadId : null,
    );
  }, [
    activeThreadId,
    chatVisible,
    storyWorkspaceOpen,
    onActiveChatThreadChange,
  ]);
  useEffect(() => {
    if (!storyWorkspaceOpen || !activeThreadId) return;
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
    chatVisible,
    directMode,
    onMarkChatRead,
    snapshotChatThreads,
    snapshotMessages,
    storyWorkspaceOpen,
  ]);
  useEffect(() => {
    if (!chatVisible || directMode || activeFeed !== "ACTIVITY") return;
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
  }, [
    activeFeed,
    activityFilters,
    chatVisible,
    directMode,
    onMarkChatRead,
    props.snapshot,
  ]);
  useEffect(() => {
    if (!requestedChatMessageId) return;
    const requestedMessage = props.snapshot.messages.find(
      (message) => message.id === requestedChatMessageId,
    );
    const direct = directThreads(props.snapshot).find(
      (thread) => thread.id === requestedMessage?.threadId,
    );
    if (direct) {
      const peer = direct.participants.find(
        (participant) => participant.membershipId !== props.snapshot.me.id,
      );
      if (peer)
        persistDirectSelection(window.localStorage, props.snapshot, {
          peerMembershipId: peer.membershipId,
          threadId: direct.id,
        });
      setDirectMode(true);
      setActiveDirectThreadId(direct.id);
    }
    const requestedStream = streamForMessage(
      props.snapshot.messages,
      requestedChatMessageId,
      props.snapshot.chatThreads,
    );
    if (requestedStream === "STORY" && isGm) onWorkspaceChange("story");
    if (requestedStream) {
      setDirectMode(false);
      setActiveFeed(feedForChatStream(requestedStream));
    }
    setFocusedMessageId(requestedChatMessageId);
    onRequestedChatMessageHandled();
  }, [
    requestedChatMessageId,
    isGm,
    onWorkspaceChange,
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
      tabIndex={-1}
      aria-label="Журнал"
      className="sidebar"
      hidden={!chatVisible}
      inert={!chatVisible}
      aria-hidden={!chatVisible}
    >
      <button
        type="button"
        className="sidebar-resize-handle"
        aria-label="Изменить ширину боковой панели"
        title="Перетащите, чтобы изменить ширину боковой панели"
        onPointerDown={sidebarActions.onResizeHandleDown}
        onPointerMove={sidebarActions.onResizeHandleMove}
        onPointerUp={sidebarActions.onResizeHandleUp}
        onPointerCancel={sidebarActions.onResizeHandleUp}
      />
      <button
        type="button"
        className="sidebar-collapse-button"
        aria-controls="activity-sidebar"
        aria-expanded="true"
        aria-label="Свернуть боковую панель"
        title="Свернуть боковую панель"
        onClick={() => sidebarActions.onCollapsedChange(true)}
      >
        <AppIcon icon={SidebarCollapseIcon} />
      </button>
      {
        <nav
          className="tabs chat-stream-tabs"
          aria-label="Потоки чата"
          role="tablist"
          onKeyDown={(event) => {
            const nextFeed = nextChatFeed(
              directMode ? "DIRECT" : activeFeed,
              event.key,
              isGm,
            );
            if (!nextFeed) return;
            event.preventDefault();
            setDirectMode(nextFeed === "DIRECT");
            if (nextFeed !== "DIRECT") setActiveFeed(nextFeed);
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
              (sum, thread) =>
                sum + directUnreadCount(props.snapshot, thread.id),
              0,
            ) > 0 && (
              <span
                className="chat-unread-badge"
                aria-label="Непрочитанные личные сообщения"
              >
                {directThreads(props.snapshot).reduce(
                  (sum, thread) =>
                    sum + directUnreadCount(props.snapshot, thread.id),
                  0,
                )}
              </span>
            )}
          </Button>
        </nav>
      }
      <div className="panel-scroll chat-scroll">
        <div
          className="chat-feed-slot"
          hidden={!directMode}
          inert={!directMode}
        >
          <DirectChatPanel
            focusedMessageId={
              chatVisible && directMode ? focusedMessageId : null
            }
            onMessageFocused={() => setFocusedMessageId(null)}
            snapshot={props.snapshot}
            visible={chatVisible && directMode}
            activeThreadId={activeDirectThreadId}
            onActiveThreadChange={setActiveDirectThreadId}
            onCreateThread={chatActions.onCreateDirectThread}
            onDirectChat={chatActions.onDirectChat}
            onSticker={chatActions.onSticker}
            onUploadAttachment={chatActions.onUploadChatAttachment}
            onMarkChatRead={chatActions.onMarkChatRead}
          />
        </div>
        <div className="chat-feed-slot" hidden={directMode} inert={directMode}>
          {activeFeed === "ACTIVITY" ? (
            <ActivityPanel
              snapshot={props.snapshot}
              storyPosts={props.storyPosts}
              activityFilters={activityFilters}
              onActivityFiltersChange={setActivityFilters}
              onChat={chatActions.onChat}
              onSticker={chatActions.onSticker}
              onRoll={diceActions.onRoll}
              focusedMessageId={
                chatVisible && !directMode ? focusedMessageId : null
              }
              onMessageFocused={() => setFocusedMessageId(null)}
              onOpenPlayerRequestCreate={
                playerRequestActions.onOpenPlayerRequestCreate
              }
              onUpdateCounters={characterActions.updateCharacterCounters}
              selectedTokenIds={props.selectedTokenIds}
              onUpdateInitiative={initiativeActions.onUpdateInitiative}
              onSetOwnInitiative={initiativeActions.onSetOwnInitiative}
              onRollInitiative={initiativeActions.onRollInitiative}
              onRecruitFromBattleZone={
                props.canRecruitFromBattleZone
                  ? initiativeActions.onRecruitFromBattleZone
                  : undefined
              }
            />
          ) : (
            <ChatPanel
              snapshot={props.snapshot}
              visible={chatVisible && !directMode}
              onChat={chatActions.onChat}
              onSticker={chatActions.onSticker}
              onRoll={diceActions.onRoll}
              onMarkChatRead={chatActions.onMarkChatRead}
              activeStream={activeFeed}
              focusedMessageId={
                chatVisible && !directMode ? focusedMessageId : null
              }
              onMessageFocused={() => setFocusedMessageId(null)}
              onOpenPlayerRequests={() => onWorkspaceChange("player-requests")}
            />
          )}
        </div>
        {(props.workspace === "characters" ||
          props.keepCharacterWorkspaceMounted) && (
          <CharacterWorkspace
            {...props}
            active={props.workspace === "characters"}
            onClose={() => onWorkspaceChange(null)}
          />
        )}
        {props.workspace === "story" && isGm && (
          <ArkenDialog
            open
            footer={false}
            title="Сюжет"
            variant="workspace"
            onClose={closeWorkspace}
          >
            {storyHistory.hasMore && (
              <button
                type="button"
                disabled={storyHistory.pending}
                onClick={() => void storyHistory.loadOlder()}
              >
                {storyHistory.pending
                  ? "Загрузка…"
                  : "Показать ранние сообщения сюжета"}
              </button>
            )}
            {storyHistory.error && <p role="alert">{storyHistory.error}</p>}
            <StoryAttachmentLibrary
              campaignId={props.snapshot.campaign.id}
              isGm={isGm}
            />
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
              eras={props.storyEras ?? []}
              eraFilter={props.storyEraFilter ?? null}
              onSelectEra={storyActions.onSelectStoryEra}
              onLoadEventSources={
                isGm ? storyActions.onLoadStoryEventSources : undefined
              }
              onCreateFromEvent={
                isGm ? storyActions.onCreateStoryFromEvent : undefined
              }
              onSearchLinkTargets={
                isGm ? storyActions.onSearchStoryLinkTargets : undefined
              }
            />
          </ArkenDialog>
        )}
        {props.workspace === "tokens" && (
          <TokenPaletteWorkspacePortal props={props} />
        )}
        {props.workspace === "setup" && isGm && (
          <ArkenDialog
            open
            footer={false}
            title="Подготовка"
            variant="workspace"
            className="setup-workspace"
            workspaceDraggable={false}
            onClose={() => onWorkspaceChange(null)}
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
            initialEditSceneId={props.requestedSceneEditId}
            editRequest={props.sceneDialogRequest}
            onClose={() => onWorkspaceChange(null)}
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
            onClose={() => onWorkspaceChange(null)}
            onCreate={playerRequestActions.onCreatePlayerRequest}
            onUpdate={playerRequestActions.onUpdatePlayerRequest}
            onAction={playerRequestActions.onPlayerRequestAction}
          />
        )}
        {props.workspace === "world-maps" && (
          <WorldMapsWorkspace
            open
            snapshot={props.snapshot}
            onClose={() => onWorkspaceChange(null)}
            onOpenScene={(sceneId) => {
              sceneActions.onViewScene(sceneId);
              onWorkspaceChange(null);
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
            campaignId={props.snapshot.campaign.id}
            assets={props.snapshot.assets}
            members={props.snapshot.members}
            worldMaps={props.snapshot.worldMaps}
            onUpload={assetActions.uploadAsset}
            onClose={closeWorkspace}
          />
        )}
        {props.workspace === "spell-schools" && isGm && (
          <ArkenDialog
            open
            footer={false}
            title="Школы заклинаний"
            variant="workspace"
            onClose={closeSpellWorkspace}
          >
            <SpellSchoolsWorkspace
              onClose={closeSpellWorkspace}
              onPendingChange={setSpellSavePending}
            />
          </ArkenDialog>
        )}
        {props.workspace === "world-codex" && (
          <WorldEncyclopediaWorkspace
            open
            assets={props.snapshot.assets}
            onClose={closeWorkspace}
          />
        )}
        {props.workspace === "creations" && (
          <CreationWorkspace
            key={`${props.snapshot.campaign.id}:${props.snapshot.me.id}:${props.snapshot.me.role}`}
            campaignId={props.snapshot.campaign.id}
            membershipId={props.snapshot.me.id}
            gm={isGm}
            characters={props.snapshot.characters.filter((character) =>
              character.lifecycle === "ACTIVE" &&
              (isGm || character.ownerMembershipId === props.snapshot.me.id ||
                character.controllerMembershipIds.includes(props.snapshot.me.id)))}
            onClose={closeWorkspace}
          />
        )}
        {props.workspace === "shops" && (
          <EconomyWorkspace
            key={`${props.snapshot.campaign.id}:${props.snapshot.me.id}:${props.snapshot.me.role}`}
            campaignId={props.snapshot.campaign.id}
            membershipId={props.snapshot.me.id}
            gm={isGm}
            characters={props.snapshot.characters.filter(
              (character) =>
                character.lifecycle === "ACTIVE" &&
                (isGm ||
                  character.ownerMembershipId === props.snapshot.me.id ||
                  character.controllerMembershipIds.includes(
                    props.snapshot.me.id,
                  )),
            )}
            onClose={closeWorkspace}
          />
        )}
        {props.workspace === "media" && (
          <ArkenDialog
            open
            footer={false}
            title="Файлы"
            variant="workspace"
            onClose={() => onWorkspaceChange(null)}
          >
            <MediaPanel
              snapshot={props.snapshot}
              onUpload={assetActions.uploadAsset}
              onGetUsage={assetActions.getAssetUsage}
              onDelete={assetActions.deleteAsset}
              onReplace={assetActions.replaceAsset}
              onRefresh={assetActions.refreshAssets}
            />
          </ArkenDialog>
        )}
      </div>
    </aside>
  );
}

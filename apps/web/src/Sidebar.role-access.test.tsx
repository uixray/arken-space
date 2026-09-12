// @vitest-environment jsdom
import type { ComponentProps } from "react";
import type { Button } from "@gravity-ui/uikit";
import type { GameSnapshot } from "@arken/contracts";
import { describe, expect, it, vi } from "vitest";
import { renderComponent, screen } from "./test-support/render";
import {
  gmSnapshot,
  playerSnapshot,
} from "./test-support/game-snapshot-fixtures";
import {
  CampaignActionsContext,
  type CampaignActions,
} from "./campaign-actions-context";
import type { ArkenDialog } from "./ui/ArkenDialog";
import type { SceneManagerDialog } from "./ui/SceneManagerDialog";
import type { StoryChannel } from "./StoryChannel";
import type { WorldMapsWorkspace } from "./WorldMapsWorkspace";
import type { OperatorFeedbackWorkspace } from "./OperatorFeedbackWorkspace";
import type { WorldContentWorkspace } from "./WorldContentWorkspace";
import type { WorldEncyclopediaWorkspace } from "./WorldEncyclopediaWorkspace";
import type { PlayerRequestsWorkspace } from "./PlayerRequestsWorkspace";
import type { CharacterWorkspace } from "./sidebar/CharacterWorkspace";
import type {
  ActivityPanel,
  ChatPanel,
  DirectChatPanel,
} from "./sidebar/ChatPanels";
import type { PalettePanel } from "./sidebar/TokenPalette";
import type { SetupPanel } from "./sidebar/SetupPanel";
import type { MediaPanel } from "./sidebar/MediaPanel";
import { Sidebar, type Props } from "./Sidebar";

// UIX-414: the real Sidebar chooses the route from snapshot.me.role. Leaf
// mocks remove CSS, canvas and self-fetching workspaces, not the role decision.
// The editor marker only knows its real `open` prop, never a test-only role.
// This covers client routing, not editor internals, navigation or server ACL.
vi.mock("@gravity-ui/uikit", () => ({
  Button: ({ children, disabled, onClick }: ComponentProps<typeof Button>) => (
    <button type="button" disabled={disabled} onClick={onClick}>
      {children}
    </button>
  ),
}));
vi.mock("./ui/ArkenDialog", () => ({
  ArkenDialog: (_props: ComponentProps<typeof ArkenDialog>) => null,
}));
vi.mock("./ui/SceneManagerDialog", () => ({
  SceneManagerDialog: (_props: ComponentProps<typeof SceneManagerDialog>) =>
    null,
}));
vi.mock("./StoryChannel", () => ({
  StoryChannel: (_props: ComponentProps<typeof StoryChannel>) => null,
}));
vi.mock("./WorldMapsWorkspace", () => ({
  WorldMapsWorkspace: (_props: ComponentProps<typeof WorldMapsWorkspace>) =>
    null,
}));
vi.mock("./OperatorFeedbackWorkspace", () => ({
  OperatorFeedbackWorkspace: (
    _props: ComponentProps<typeof OperatorFeedbackWorkspace>,
  ) => null,
}));
vi.mock("./WorldContentWorkspace", () => ({
  WorldContentWorkspace: ({
    open,
  }: ComponentProps<typeof WorldContentWorkspace>) =>
    open ? <section aria-label="World content editor route" /> : null,
}));
vi.mock("./WorldEncyclopediaWorkspace", () => ({
  WorldEncyclopediaWorkspace: (
    _props: ComponentProps<typeof WorldEncyclopediaWorkspace>,
  ) => null,
}));
vi.mock("./PlayerRequestsWorkspace", () => ({
  PlayerRequestsWorkspace: (
    _props: ComponentProps<typeof PlayerRequestsWorkspace>,
  ) => null,
}));
vi.mock("./sidebar/CharacterWorkspace", () => ({
  CharacterWorkspace: (_props: ComponentProps<typeof CharacterWorkspace>) =>
    null,
}));
vi.mock("./sidebar/ChatPanels", () => ({
  ActivityPanel: (_props: ComponentProps<typeof ActivityPanel>) => null,
  ChatPanel: (_props: ComponentProps<typeof ChatPanel>) => null,
  DirectChatPanel: (_props: ComponentProps<typeof DirectChatPanel>) => null,
}));
vi.mock("./sidebar/TokenPalette", () => ({
  PalettePanel: (_props: ComponentProps<typeof PalettePanel>) => null,
}));
vi.mock("./sidebar/SetupPanel", () => ({
  SetupPanel: (_props: ComponentProps<typeof SetupPanel>) => null,
}));
vi.mock("./sidebar/MediaPanel", () => ({
  MediaPanel: (_props: ComponentProps<typeof MediaPanel>) => null,
}));

const noop = () => undefined;
const unexpectedAction = (): never => {
  throw new Error("Role-routing test must not execute campaign commands");
};

// Keep the real context provider and its complete contract. Unused commands
// fail closed rather than pretending to perform mutations or returning DTOs.
const actions: CampaignActions = {
  scene: {
    onViewScene: unexpectedAction,
    onSaveScene: unexpectedAction,
    onCreateScene: unexpectedAction,
    onActivateScene: unexpectedAction,
    onAssignMap: unexpectedAction,
    onRenameScene: unexpectedAction,
  },
  worldMap: {
    onCreateWorldMap: unexpectedAction,
    onSetWorldMapDraftBackground: unexpectedAction,
    onApproveWorldMapBackground: unexpectedAction,
    onPublishWorldMap: unexpectedAction,
    onArchiveWorldMap: unexpectedAction,
    onArchiveCharacter: unexpectedAction,
    onRestoreCharacter: unexpectedAction,
    onLoadArchivedCharacters: unexpectedAction,
    onCreateWorldMapLocation: unexpectedAction,
    onUpdateWorldMapLocation: unexpectedAction,
    onLinkWorldMapLocationScene: unexpectedAction,
    onUnlinkWorldMapLocationScene: unexpectedAction,
    onSetWorldMapPartyPosition: unexpectedAction,
    onClearWorldMapPartyPosition: unexpectedAction,
  },
  token: {
    onPlaceTokenDefinition: unexpectedAction,
    onDeleteTokenDefinition: unexpectedAction,
    onPatchTokenDefinition: unexpectedAction,
    onCreateTokenDefinition: unexpectedAction,
    onCreateAndPlaceTokenDefinition: unexpectedAction,
    onReplaceTokenControllers: unexpectedAction,
    onCreateToken: unexpectedAction,
  },
  chat: {
    onChat: unexpectedAction,
    onSticker: unexpectedAction,
    onCreateDirectThread: unexpectedAction,
    onDirectChat: unexpectedAction,
    onUploadChatAttachment: unexpectedAction,
    onActiveChatThreadChange: noop,
    onMarkChatRead: unexpectedAction,
  },
  access: {
    onCreateInvite: unexpectedAction,
    onListPlayerAccess: unexpectedAction,
    onRotatePlayerAccess: unexpectedAction,
    onRevokePlayerAccess: unexpectedAction,
    onRenameMembership: unexpectedAction,
  },
  catalog: {
    onCreateCatalogEntry: unexpectedAction,
    onUpdateCatalogEntry: unexpectedAction,
    onDeleteCatalogEntry: unexpectedAction,
    onAssignCatalogEntry: unexpectedAction,
    onUpdateCharacterEntry: unexpectedAction,
    onDeleteCharacterEntry: unexpectedAction,
    onRollEntry: unexpectedAction,
    onRechargeEntry: unexpectedAction,
  },
  story: {
    onLoadMoreStoryPosts: unexpectedAction,
    onCreateStoryDraft: unexpectedAction,
    onUpdateStoryPost: unexpectedAction,
    onPublishStoryPost: unexpectedAction,
    onArchiveStoryPost: unexpectedAction,
  },
  playerRequest: {
    onOpenPlayerRequestCreate: unexpectedAction,
    onCreatePlayerRequest: unexpectedAction,
    onUpdatePlayerRequest: unexpectedAction,
    onPlayerRequestAction: unexpectedAction,
  },
  asset: {
    uploadAsset: unexpectedAction,
    getAssetUsage: unexpectedAction,
    deleteAsset: unexpectedAction,
    generateTokenImage: unexpectedAction,
  },
  statLayout: { onUpdateStatLayout: unexpectedAction },
  chatHistory: { onLoadThreadHistory: unexpectedAction },
};

function renderEditorRoute(snapshot: GameSnapshot) {
  const props: Props = {
    snapshot,
    socket: null,
    presence: [],
    onReplaceCharacterControllers: unexpectedAction,
    onPatchCharacter: unexpectedAction,
    storyPosts: [],
    storyNextCursor: null,
    onRoll: unexpectedAction,
    onCreateCharacter: unexpectedAction,
    viewedSceneId: null,
    sceneDialogRequest: 0,
    selectedTokenIds: [],
    onUpdateInitiative: unexpectedAction,
    onSetOwnInitiative: unexpectedAction,
    onRollInitiative: unexpectedAction,
    onPreviewPlayer: unexpectedAction,
    onUpdateCounters: unexpectedAction,
    onCampaignClock: unexpectedAction,
    requestedChatMessageId: null,
    onRequestedChatMessageHandled: unexpectedAction,
    onChatVisibilityChange: noop,
    collapsed: false,
    onCollapsedChange: unexpectedAction,
    onResizeHandleDown: unexpectedAction,
    onResizeHandleMove: unexpectedAction,
    onResizeHandleUp: unexpectedAction,
    workspace: "world-encyclopedia",
    operatorFeedbackAllowed: false,
    onWorkspaceChange: unexpectedAction,
  };
  return renderComponent(
    <CampaignActionsContext.Provider value={actions}>
      <Sidebar {...props} />
    </CampaignActionsContext.Provider>,
  );
}

describe("Sidebar editor role routing", () => {
  it("opens the editor route for a GM snapshot", () => {
    renderEditorRoute(gmSnapshot());
    expect(
      screen.getByRole("region", { name: "World content editor route" }),
    ).toBeInTheDocument();
  });

  it("rejects the editor route for a PLAYER snapshot", () => {
    renderEditorRoute(playerSnapshot());
    expect(
      screen.queryByRole("region", { name: "World content editor route" }),
    ).not.toBeInTheDocument();
  });
});

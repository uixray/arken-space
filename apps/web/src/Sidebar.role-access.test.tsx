// @vitest-environment jsdom
import type { ComponentProps } from "react";
import type { GameSnapshot } from "@arken/contracts";
import { describe, expect, it, vi } from "vitest";
import { fireEvent, renderComponent, screen } from "./test-support/render";
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
vi.mock("./ui/ArkenDialog", () => ({
  ArkenDialog: (props: ComponentProps<typeof ArkenDialog>) =>
    props.title === "Токены" ? (
      <section aria-label="Палитра">
        <button onClick={props.onClose}>Закрыть палитру</button>
        {props.children}
      </section>
    ) : null,
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
  PalettePanel: (props: ComponentProps<typeof PalettePanel>) => (
    <>
      <button onClick={() => props.onSpriteUploadRiskChange?.(true)}>
        Загрузка не подтверждена
      </button>
      <button onClick={() => props.onSpriteUploadRiskChange?.(false)}>
        Загрузка завершена
      </button>
      <button onClick={() => props.onSpriteDirtyChange?.(true)}>
        Изменённая фигурка
      </button>
    </>
  ),
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
    onSelectStoryEra: unexpectedAction,
    onLoadStoryEventSources: unexpectedAction,
    onCreateStoryFromEvent: unexpectedAction,
    onSearchStoryLinkTargets: unexpectedAction,
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
    replaceAsset: unexpectedAction,
    refreshAssets: unexpectedAction,
    generateTokenImage: unexpectedAction,
  },
  statLayout: {
    onUpdateStatLayout: unexpectedAction,
    onUpdateCharacterStatLayout: unexpectedAction,
  },
  chatHistory: { onLoadThreadHistory: unexpectedAction },
  character: {
    replaceCharacterControllers: unexpectedAction,
    patchCharacter: unexpectedAction,
    updateCharacterCounters: unexpectedAction,
    onCreateCharacter: unexpectedAction,
  },
  initiative: {
    onUpdateInitiative: unexpectedAction,
    onSetOwnInitiative: unexpectedAction,
    onRollInitiative: unexpectedAction,
    onSetBattleZone: unexpectedAction,
    onRecruitFromBattleZone: unexpectedAction,
  },
  dice: { onRoll: unexpectedAction },
  campaign: { onCampaignClock: unexpectedAction },
  player: { onPreviewPlayer: unexpectedAction },
  sidebar: {
    onRequestedChatMessageHandled: noop,
    onChatVisibilityChange: noop,
    onCollapsedChange: noop,
    onResizeHandleDown: noop,
    onResizeHandleMove: noop,
    onResizeHandleUp: noop,
    onWorkspaceChange: noop,
  },
};

function renderEditorRoute(
  snapshot: GameSnapshot,
  workspace: Props["workspace"] = "world-encyclopedia",
) {
  const props: Props = {
    snapshot,
    socket: null,
    presence: [],
    storyPosts: [],
    storyNextCursor: null,
    viewedSceneId: null,
    sceneDialogRequest: 0,
    selectedTokenIds: [],
    canRecruitFromBattleZone: false,
    requestedChatMessageId: null,
    collapsed: false,
    workspace,
    operatorFeedbackAllowed: false,
  };
  return renderComponent(
    <CampaignActionsContext.Provider value={actions}>
      <Sidebar {...props} />
    </CampaignActionsContext.Provider>,
  );
}

describe("Sidebar editor role routing", () => {
  it("does not close the palette until an uncertain sprite upload is resolved", () => {
    const close = vi.spyOn(actions.sidebar, "onWorkspaceChange");
    renderEditorRoute(gmSnapshot(), "tokens");
    fireEvent.click(
      screen.getByRole("button", { name: "Загрузка не подтверждена" }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Закрыть палитру" }));
    expect(close).not.toHaveBeenCalled();
    expect(screen.getByRole("status")).toHaveTextContent(
      "Сначала дождитесь загрузки кадра",
    );
    fireEvent.click(screen.getByRole("button", { name: "Загрузка завершена" }));
    fireEvent.click(screen.getByRole("button", { name: "Закрыть палитру" }));
    expect(close).toHaveBeenCalledWith(null);
    close.mockRestore();
  });
  it("asks before closing a palette containing unsaved sprite frames", () => {
    const close = vi.spyOn(actions.sidebar, "onWorkspaceChange"),
      confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    renderEditorRoute(gmSnapshot(), "tokens");
    fireEvent.click(screen.getByRole("button", { name: "Изменённая фигурка" }));
    fireEvent.click(screen.getByRole("button", { name: "Закрыть палитру" }));
    expect(confirm).toHaveBeenCalledOnce();
    expect(close).not.toHaveBeenCalled();
    confirm.mockReturnValue(true);
    fireEvent.click(screen.getByRole("button", { name: "Закрыть палитру" }));
    expect(close).toHaveBeenCalledWith(null);
    confirm.mockRestore();
    close.mockRestore();
  });
  // The workspace is lazy-loaded: wait for it rather than query synchronously.
  it("opens the editor route for a GM snapshot", async () => {
    renderEditorRoute(gmSnapshot());
    expect(
      await screen.findByRole("region", { name: "World content editor route" }),
    ).toBeInTheDocument();
  });

  it("rejects the editor route for a PLAYER snapshot", async () => {
    // Load the lazy module first, so absence proves the role gate rather
    // than a chunk that has not arrived yet.
    await import("./WorldContentWorkspace");
    renderEditorRoute(playerSnapshot());
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(
      screen.queryByRole("region", { name: "World content editor route" }),
    ).not.toBeInTheDocument();
  });
});


describe("Shared campaign chat tabs", () => {
  for (const [role, snapshot] of [["GM", gmSnapshot], ["PLAYER", playerSnapshot]] as const) {
    it(`keeps journal, character and private tabs accessible for ${role}`, () => {
      renderEditorRoute(snapshot(), null);
      const journal = screen.getByRole("tab", { name: /^Журнал$/ });
      const character = screen.getByRole("tab", { name: /^Персонаж$/ });
      const direct = screen.getByRole("tab", { name: /^Личные$/ });
      fireEvent.click(direct);
      expect(direct).toHaveAttribute("aria-selected", "true");
      expect(character).toHaveAttribute("aria-selected", "false");
      fireEvent.keyDown(direct, { key: "Home" });
      expect(journal).toHaveAttribute("aria-selected", "true");
      expect(direct).toHaveAttribute("aria-selected", "false");
      fireEvent.keyDown(journal, { key: "ArrowRight" });
      expect(character).toHaveAttribute("aria-selected", "true");
      fireEvent.keyDown(character, { key: "End" });
      expect(direct).toHaveAttribute("aria-selected", "true");
      expect(character).toHaveAttribute("aria-selected", "false");
    });
  }
});

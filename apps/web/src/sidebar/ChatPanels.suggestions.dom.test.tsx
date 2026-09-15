// @vitest-environment jsdom
import type { ComponentProps } from "react";
import type { ChatStream, GameSnapshot } from "@arken/contracts";
import { ThemeProvider } from "@gravity-ui/uikit";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  CampaignActionsContext,
  type CampaignActions,
} from "../campaign-actions-context";
import { gmSnapshot } from "../test-support/game-snapshot-fixtures";
import { installMatchMediaMock } from "../test-support/dom-mocks";
import {
  act,
  fireEvent,
  renderComponent,
  screen,
  userEvent,
} from "../test-support/render";
import { ActivityPanel, ChatPanel } from "./ChatPanels";

// Real callers and Gravity native controls; only absent browser APIs shimmed.
beforeEach(() => {
  installMatchMediaMock();
  window.localStorage.clear();
  Object.defineProperty(HTMLElement.prototype, "scrollTo", {
    configurable: true,
    writable: true,
    value: vi.fn(),
  });
});

const unexpectedAction = (): never => {
  throw new Error("Unexpected campaign action in suggestions lifecycle test");
};

function actions(
  uploadAsset: CampaignActions["asset"]["uploadAsset"] = unexpectedAction,
): CampaignActions {
  return {
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
      onActiveChatThreadChange: unexpectedAction,
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
      uploadAsset,
      getAssetUsage: unexpectedAction,
      deleteAsset: unexpectedAction,
      generateTokenImage: unexpectedAction,
    },
    statLayout: { onUpdateStatLayout: unexpectedAction },
    chatHistory: { onLoadThreadHistory: unexpectedAction },
  };
}

type Surface = "activity" | "chat";
type Roll = ComponentProps<typeof ActivityPanel>["onRoll"];
type Send = CampaignActions["chat"]["onChat"];

function mount(surface: Surface, onChat: Send = vi.fn(async () => undefined)) {
  const onRoll = vi.fn<Roll>().mockResolvedValue(undefined);
  const escaped = vi.fn();
  const commands = actions();
  const state = gmSnapshot();
  function view(current: GameSnapshot, stream: ChatStream = "TABLE") {
    const common = {
      snapshot: current,
      onChat,
      onRoll,
      onSticker: vi.fn(async () => undefined),
      focusedMessageId: null,
      onMessageFocused: vi.fn(),
    };
    return (
      <ThemeProvider theme="dark" lang="ru">
        <CampaignActionsContext.Provider value={commands}>
          <section onKeyDown={escaped}>
            {surface === "activity" ? (
              <ActivityPanel
                {...common}
                storyPosts={[]}
                activityFilters={new Set(["ROLLS", "STORY", "REFERENCE"])}
                onActivityFiltersChange={vi.fn()}
                onOpenPlayerRequestCreate={vi.fn()}
                onUpdateCounters={vi.fn(async () => undefined)}
                selectedTokenIds={[]}
                onUpdateInitiative={vi.fn(async () => undefined)}
                onSetOwnInitiative={vi.fn(async () => undefined)}
                onRollInitiative={vi.fn(async () => undefined)}
              />
            ) : (
              <ChatPanel
                {...common}
                activeStream={stream}
                onMarkChatRead={vi.fn(async () => undefined)}
                onOpenPlayerRequests={vi.fn()}
              />
            )}
          </section>
          <button type="button">Вне composer</button>
        </CampaignActionsContext.Provider>
      </ThemeProvider>
    );
  }
  const rendered = renderComponent(view(state));
  return {
    state,
    onRoll,
    onChat,
    escaped,
    rerender: (current: GameSnapshot, stream?: ChatStream) =>
      rendered.rerender(view(current, stream)),
  };
}
const input = () =>
  screen.getByRole("textbox", { name: "Сообщение или бросок" });
const trigger = () => screen.getByRole("button", { name: "Быстрые команды" });
const popup = () => screen.queryByRole("listbox", { name: "Команды чата" });

describe.each(["activity", "chat"] as const)(
  "UIX644 %s real composer suggestions",
  (surface) => {
    it("trigger Escape closes the nearest popup and restores its trigger", async () => {
      const current = mount(surface);
      const user = userEvent.setup();
      await user.click(trigger());
      expect(popup()).toBeVisible();
      current.escaped.mockClear();
      await user.keyboard("{Escape}");
      expect(popup()).not.toBeInTheDocument();
      expect(trigger()).toHaveFocus();
      expect(trigger()).toHaveAttribute("aria-expanded", "false");
      expect(current.escaped).not.toHaveBeenCalled();
    });

    it("typed Escape preserves draft, typing reopens, and trigger toggles effective visibility", async () => {
      mount(surface);
      const user = userEvent.setup();
      await user.type(input(), "/");
      await user.keyboard("{Escape}");
      expect(input()).toHaveValue("/");
      expect(input()).toHaveFocus();
      expect(popup()).not.toBeInTheDocument();
      await user.type(input(), "d");
      expect(popup()).toBeVisible();
      await user.click(trigger());
      expect(popup()).not.toBeInTheDocument();
      expect(input()).toHaveValue("/d");
      await user.click(trigger());
      expect(screen.getAllByRole("option")).toHaveLength(2);
    });

    it("outside pointer and focus dismiss without moving focus or changing draft", async () => {
      mount(surface);
      const user = userEvent.setup();
      await user.type(input(), "/");
      const outside = screen.getByRole("button", { name: "Вне composer" });
      fireEvent.pointerDown(outside);
      expect(popup()).not.toBeInTheDocument();
      expect(input()).toHaveFocus();
      expect(input()).toHaveValue("/");
      await user.click(trigger());
      act(() => outside.focus());
      expect(outside).toHaveFocus();
      expect(popup()).not.toBeInTheDocument();
      expect(input()).toHaveValue("/");
    });

    it.each(["{Enter}", " "])(
      "navigates real options and executes %s exactly once",
      async (activation) => {
        const current = mount(surface);
        const user = userEvent.setup();
        await user.click(trigger());
        const options = screen.getAllByRole("option");
        await user.keyboard("{ArrowDown}");
        expect(options[0]).toHaveFocus();
        await user.keyboard("{End}");
        expect(options.at(-1)).toHaveFocus();
        await user.keyboard("{Home}");
        expect(options[0]).toHaveFocus();
        await user.keyboard("{ArrowUp}");
        expect(options.at(-1)).toHaveFocus();
        await user.keyboard("{ArrowDown}");
        expect(options[0]).toHaveFocus();
        await user.keyboard(activation);
        expect(current.onRoll).toHaveBeenCalledExactlyOnceWith(
          "1d20",
          "d20",
          "PUBLIC",
          null,
          "NORMAL",
        );
        expect(current.onChat).not.toHaveBeenCalled();
        expect(popup()).not.toBeInTheDocument();
        expect(input()).toHaveFocus();
        expect(input()).toHaveValue("");
      },
    );

    it("keeps IME Escape and Enter out of popup and submission actions", async () => {
      const current = mount(surface);
      const user = userEvent.setup();
      await user.type(input(), "/");
      fireEvent.compositionStart(input());
      fireEvent.keyDown(input(), { key: "Enter", isComposing: true });
      fireEvent.keyDown(input(), { key: "Escape", isComposing: true });
      expect(popup()).toBeVisible();
      expect(input()).toHaveValue("/");
      expect(current.onRoll).not.toHaveBeenCalled();
      expect(current.onChat).not.toHaveBeenCalled();
      const option = screen.getAllByRole("option")[0]!;
      act(() => option.focus());
      fireEvent.keyDown(option, { key: "Enter", isComposing: true });
      expect(current.onRoll).not.toHaveBeenCalled();
      fireEvent.compositionEnd(input());
      await user.keyboard("{Escape}");
      expect(popup()).not.toBeInTheDocument();
      expect(input()).toHaveFocus();
    });

    it.each(["campaign", "member", "role", "character"] as const)(
      "closes stale suggestions on %s changes without erasing draft",
      async (scope) => {
        const current = mount(surface);
        const user = userEvent.setup();
        await user.type(input(), "/");
        const next = structuredClone(current.state);
        if (scope === "campaign") next.campaign.id = "next-campaign";
        if (scope === "member") next.me.id = "next-member";
        if (scope === "role") next.me.role = "PLAYER";
        if (scope === "character") next.me.characterId = "next-character";
        current.rerender(next);
        expect(popup()).not.toBeInTheDocument();
        expect(input()).toHaveValue("/");
        await user.type(input(), "d");
        expect(popup()).toBeVisible();
      },
    );

    it.each(["trigger", "typed"] as const)(
      "returns option Escape focus to %s origin",
      async (origin) => {
        const current = mount(surface);
        const user = userEvent.setup();
        if (origin === "trigger") await user.click(trigger());
        else await user.type(input(), "/");
        await user.keyboard("{ArrowDown}");
        expect(screen.getAllByRole("option")[0]).toHaveFocus();
        current.escaped.mockClear();
        await user.keyboard("{Escape}");
        expect(origin === "trigger" ? trigger() : input()).toHaveFocus();
        expect(popup()).not.toBeInTheDocument();
        expect(current.escaped).not.toHaveBeenCalled();
      },
    );

    it("leaves textarea Home/End and unrelated control arrows native", async () => {
      mount(surface);
      const user = userEvent.setup();
      await user.type(input(), "/");
      expect(popup()).toBeVisible();
      expect(fireEvent.keyDown(input(), { key: "Home" })).toBe(true);
      expect(input()).toHaveFocus();
      expect(fireEvent.keyDown(input(), { key: "End" })).toBe(true);
      expect(input()).toHaveFocus();
      const send = screen.getByRole("button", { name: /^Отправить\./ });
      act(() => send.focus());
      expect(fireEvent.keyDown(send, { key: "ArrowDown" })).toBe(true);
      expect(send).toHaveFocus();
      expect(fireEvent.keyDown(send, { key: "ArrowUp" })).toBe(true);
      expect(send).toHaveFocus();
      expect(popup()).toBeVisible();
    });

    it("keeps native Tab exit without cancelling or trapping the event", async () => {
      mount(surface);
      const user = userEvent.setup();
      await user.click(trigger());
      await user.keyboard("{ArrowDown}");
      const options = screen.getAllByRole("option");
      expect(fireEvent.keyDown(options[0]!, { key: "Tab" })).toBe(true);
      expect(options.every((option) => option.tabIndex === -1)).toBe(true);
      await user.tab();
      expect(
        screen.getByRole("button", { name: "Вне composer" }),
      ).toHaveFocus();
      expect(popup()).not.toBeInTheDocument();
    });

    it("does not put a prior actor command rejection into the new composer", async () => {
      const current = mount(surface);
      let reject!: (reason: Error) => void;
      const pending = new Promise<void>((_accept, refuse) => {
        reject = refuse;
      });
      current.onRoll.mockReturnValueOnce(pending);
      const user = userEvent.setup();
      await user.click(trigger());
      await user.keyboard("{ArrowDown}{Enter}");
      expect(current.onRoll).toHaveBeenCalledTimes(1);
      current.rerender({
        ...current.state,
        me: { ...current.state.me, id: "new-actor" },
      });
      await user.type(input(), "Черновик нового участника");
      await act(async () => reject(new Error("Старая ошибка")));
      expect(input()).toHaveValue("Черновик нового участника");
      expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    });

    it("preserves accepted public and private send draft ownership through dismissal", async () => {
      let resolve!: () => void;
      const held = new Promise<void>((accept) => {
        resolve = accept;
      });
      const onChat = vi
        .fn<Send>()
        .mockImplementationOnce(() => held)
        .mockResolvedValue(undefined);
      mount(surface, onChat);
      const user = userEvent.setup();
      await user.type(input(), "Публичное{Enter}");
      expect(input()).toHaveValue("");
      await user.type(input(), "/");
      await user.keyboard("{Escape}");
      expect(input()).toHaveValue("/");
      await user.clear(input());
      await user.type(input(), "Приватное");
      await act(async () => resolve());
      expect(input()).toHaveValue("Приватное");
      await user.keyboard("{Control>}{Enter}{/Control}");
      expect(onChat).toHaveBeenNthCalledWith(1, "Публичное", "PUBLIC", "TABLE");
      expect(onChat).toHaveBeenNthCalledWith(
        2,
        "Приватное",
        "GM_ONLY",
        "TABLE",
      );
      expect(input()).toHaveValue("");
    });
  },
);

it("Chat TABLE/STORY/TABLE closes scoped popup and leaves the published draft intact", async () => {
  const current = mount("chat");
  const user = userEvent.setup();
  await user.type(input(), "/");
  current.rerender(current.state, "STORY");
  expect(popup()).not.toBeInTheDocument();
  expect(screen.getByRole("textbox", { name: "Сообщение сюжета" })).toHaveValue(
    "/",
  );
  current.rerender(current.state, "TABLE");
  expect(popup()).not.toBeInTheDocument();
  expect(input()).toHaveValue("/");
  await user.type(input(), "d");
  expect(popup()).toBeVisible();
});

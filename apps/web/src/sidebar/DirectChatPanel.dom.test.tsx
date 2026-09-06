// @vitest-environment jsdom
import type { ReactNode, TextareaHTMLAttributes } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { GameSnapshot } from "@arken/contracts";
import { CampaignActionsContext } from "../campaign-actions-context";
import { playerSnapshot } from "../test-support/game-snapshot-fixtures";
import {
  act,
  fireEvent,
  renderComponent,
  screen,
  userEvent,
  waitFor,
} from "../test-support/render";

vi.mock("@gravity-ui/uikit", () => ({
  Button: ({
    children,
    onClick,
    disabled,
    ...props
  }: {
    children?: ReactNode;
    onClick?: () => void;
    disabled?: boolean;
    type?: "button" | "submit";
    className?: string;
    "aria-label"?: string;
    title?: string;
  }) => (
    <button disabled={disabled} onClick={onClick} {...props}>
      {children}
    </button>
  ),
  TextArea: (props: TextareaHTMLAttributes<HTMLTextAreaElement>) => (
    <textarea {...props} />
  ),
  TextInput: () => null,
  Checkbox: () => null,
  Select: () => null,
}));

const { ChatPanel, DirectChatPanel } = await import("./ChatPanels");

const threadId = "00000000-0000-4000-8000-000000000101";
const ownId = "member-under-test";
const peerId = "00000000-0000-4000-8000-000000000102";

function snapshot(): GameSnapshot {
  return playerSnapshot({
    directChatContacts: [{ membershipId: peerId, displayName: "Собеседник" }],
    chatThreads: [
      {
        id: threadId,
        campaignId: "campaign-under-test",
        type: "DIRECT",
        stream: null,
        participants: [
          { membershipId: ownId, displayName: "Игрок" },
          { membershipId: peerId, displayName: "Собеседник" },
        ],
        createdAt: new Date(0).toISOString(),
        updatedAt: new Date(0).toISOString(),
      },
    ],
  });
}

const noop = vi.fn(async () => undefined);

function renderDirect(
  activeThreadId: string | null,
  loader = vi.fn(async () => ({
    loaded: 0,
    hasMore: false,
    accepted: false,
    messageIds: [],
  })),
) {
  const current = snapshot();
  window.localStorage.setItem(
    `arken.direct-chat.${current.campaign.id}.${current.me.id}`,
    JSON.stringify({ peerMembershipId: peerId, threadId }),
  );
  renderComponent(
    <CampaignActionsContext.Provider
      value={{ chatHistory: { onLoadThreadHistory: loader } } as never}
    >
      <DirectChatPanel
        snapshot={current}
        activeThreadId={activeThreadId}
        onActiveThreadChange={vi.fn()}
        onCreateThread={noop as never}
        onDirectChat={noop as never}
        onSticker={noop as never}
        onUploadAttachment={noop as never}
        onMarkChatRead={noop as never}
      />
    </CampaignActionsContext.Provider>,
  );
  return loader;
}

describe("DirectChatPanel history", () => {
  beforeEach(() => {
    window.localStorage.clear();
    vi.clearAllMocks();
    Object.defineProperty(HTMLElement.prototype, "scrollTo", {
      configurable: true,
      writable: true,
      value: vi.fn(),
    });
  });

  it("показывает явную подгрузку даже в пустом выбранном диалоге", async () => {
    const loader = renderDirect(threadId);
    await userEvent.click(
      screen.getByRole("button", { name: "Показать более ранние" }),
    );

    expect(loader).toHaveBeenCalledWith(threadId, undefined);
    expect(
      screen.getByRole("button", { name: "Показать более ранние" }),
    ).toBeInTheDocument();
  });

  it("не открывает историю до явного выбора диалога", () => {
    const loader = renderDirect(null);
    expect(
      screen.queryByRole("button", { name: "Показать более ранние" }),
    ).not.toBeInTheDocument();
    expect(loader).not.toHaveBeenCalled();
  });

  it("подгружает историю при прокрутке вверх и сохраняет кнопку fallback", async () => {
    const loader = renderDirect(threadId);
    expect(
      screen.getByRole("button", { name: "Показать более ранние" }),
    ).toBeInTheDocument();
    const list = document.querySelector<HTMLDivElement>(".message-list");
    if (!list) throw new Error("message list not rendered");

    list.scrollTop = 100;
    fireEvent.scroll(list);
    expect(loader).not.toHaveBeenCalled();

    list.scrollTop = 20;
    fireEvent.scroll(list);
    await waitFor(() =>
      expect(loader).toHaveBeenCalledWith(threadId, undefined),
    );
  });
});

describe("retained chat read visibility", () => {
  beforeEach(() => {
    window.localStorage.clear();
    vi.clearAllMocks();
    vi.useFakeTimers();
    Object.defineProperty(HTMLElement.prototype, "scrollTo", {
      configurable: true,
      writable: true,
      value: vi.fn(),
    });
  });

  afterEach(() => vi.useRealTimers());

  for (const kind of ["STREAM", "DIRECT"] as const) {
    it(`${kind}: hidden mount and interrupted read stay unread until shown again`, async () => {
      const current = snapshot();
      if (kind === "STREAM") {
        current.chatThreads = [
          {
            id: threadId,
            campaignId: current.campaign.id,
            type: "STREAM",
            stream: "TABLE",
            createdAt: new Date(0).toISOString(),
            updatedAt: new Date(0).toISOString(),
          },
        ];
      }
      current.messages = [
        {
          id: "message-1",
          sequence: 1,
          membershipId: peerId,
          displayName: "Собеседник",
          characterId: null,
          body: "Непрочитанная запись",
          visibility: "PUBLIC",
          kind: "TEXT",
          threadId,
          stream: kind === "STREAM" ? "TABLE" : null,
          dice: null,
          createdAt: new Date(0).toISOString(),
        },
      ];
      const markRead = vi.fn(async () => undefined);
      const context = {
        chatHistory: {
          onLoadThreadHistory: async () => ({
            loaded: 0,
            hasMore: false,
            accepted: false,
            messageIds: [],
          }),
        },
      };
      const panel = (visible: boolean, state = current) => (
        <CampaignActionsContext.Provider value={context as never}>
          {kind === "DIRECT" ? (
            <DirectChatPanel
              snapshot={state}
              visible={visible}
              activeThreadId={threadId}
              onActiveThreadChange={noop}
              onCreateThread={noop as never}
              onDirectChat={noop as never}
              onSticker={noop as never}
              onUploadAttachment={noop as never}
              onMarkChatRead={markRead}
            />
          ) : (
            <ChatPanel
              snapshot={state}
              visible={visible}
              onChat={noop as never}
              onSticker={noop as never}
              onRoll={noop as never}
              onMarkChatRead={markRead}
              activeStream="TABLE"
              focusedMessageId={null}
              onMessageFocused={noop}
              onOpenPlayerRequests={noop}
            />
          )}
        </CampaignActionsContext.Provider>
      );
      const view = renderComponent(panel(false));
      const list = view.container.querySelector(".message-list");
      expect(list).not.toBeNull();
      await act(() => vi.advanceTimersByTimeAsync(400));
      expect(markRead).not.toHaveBeenCalled();

      view.rerender(panel(true));
      await act(() => vi.advanceTimersByTimeAsync(200));
      view.rerender(panel(false));
      await act(() => vi.advanceTimersByTimeAsync(400));
      expect(markRead).not.toHaveBeenCalled();

      const latest = {
        ...current,
        messages: [
          ...current.messages,
          { ...current.messages[0]!, id: "message-2", sequence: 2 },
        ],
      };
      view.rerender(panel(false, latest));
      await act(() => vi.advanceTimersByTimeAsync(400));
      expect(markRead).not.toHaveBeenCalled();

      view.rerender(panel(true, latest));
      await act(() => vi.advanceTimersByTimeAsync(350));
      expect(markRead).toHaveBeenCalledExactlyOnceWith(threadId, 2);
      expect(view.container.querySelector(".message-list")).toBe(list);
    });
  }
});

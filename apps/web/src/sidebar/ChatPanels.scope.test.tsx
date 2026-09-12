// @vitest-environment jsdom
import type { ReactNode, Ref, TextareaHTMLAttributes } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { GameSnapshot } from "@arken/contracts";
import { CampaignActionsContext } from "../campaign-actions-context";
import { gmSnapshot } from "../test-support/game-snapshot-fixtures";
import type { ChatActions } from "../use-chat-actions";
import {
  act,
  renderComponent,
  screen,
  userEvent,
  waitFor,
} from "../test-support/render";

vi.mock("@gravity-ui/uikit", () => ({
  Button: ({
    children,
    ...props
  }: {
    children?: ReactNode;
    disabled?: boolean;
    type?: "button" | "submit";
    className?: string;
    "aria-label"?: string;
    title?: string;
  }) => <button {...props}>{children}</button>,
  TextArea: ({
    controlProps,
    controlRef,
    validationState,
    ...props
  }: TextareaHTMLAttributes<HTMLTextAreaElement> & {
    controlProps?: TextareaHTMLAttributes<HTMLTextAreaElement>;
    controlRef?: Ref<HTMLTextAreaElement>;
    validationState?: "invalid";
  }) => (
    <textarea
      {...props}
      {...controlProps}
      ref={controlRef}
      aria-invalid={validationState === "invalid" || undefined}
    />
  ),
  TextInput: () => null,
  Checkbox: () => null,
  Select: () => null,
}));

const { ChatPanel } = await import("./ChatPanels");

function snapshot(): GameSnapshot {
  const current = gmSnapshot();
  return gmSnapshot({
    chatThreads: [
      {
        id: "thread-table",
        campaignId: current.campaign.id,
        type: "STREAM",
        stream: "TABLE",
        createdAt: new Date(0).toISOString(),
        updatedAt: new Date(0).toISOString(),
      },
      {
        id: "thread-story",
        campaignId: current.campaign.id,
        type: "STREAM",
        stream: "STORY",
        createdAt: new Date(0).toISOString(),
        updatedAt: new Date(0).toISOString(),
      },
    ],
  });
}

function deferredFailure() {
  let reject!: () => void;
  const promise = new Promise<void>((_resolve, onReject) => {
    reject = () => onReject(new Error("send failed"));
  });
  return { promise, reject };
}

function panel(
  current: GameSnapshot,
  stream: "TABLE" | "STORY",
  onChat: ChatActions["onChat"],
) {
  return (
    <CampaignActionsContext.Provider
      value={
        {
          chatHistory: {
            onLoadThreadHistory: async () => ({
              loaded: 0,
              hasMore: false,
              accepted: false,
              messageIds: [],
            }),
          },
        } as never
      }
    >
      <ChatPanel
        snapshot={current}
        onChat={onChat}
        onSticker={vi.fn(async () => undefined)}
        onRoll={vi.fn(async () => undefined)}
        onMarkChatRead={vi.fn(async () => undefined)}
        activeStream={stream}
        focusedMessageId={null}
        onMessageFocused={vi.fn()}
        onOpenPlayerRequests={vi.fn()}
      />
    </CampaignActionsContext.Provider>
  );
}

describe("UIX624 ChatPanel async scope ownership", () => {
  beforeEach(() => {
    // jsdom omits scrolling; this suite checks ownership, not geometry.
    Object.defineProperty(HTMLElement.prototype, "scrollTo", {
      configurable: true,
      writable: true,
      value: vi.fn(),
    });
  });
  it("TABLE to STORY to TABLE ABA invalidates a stale failed submission", async () => {
    const current = snapshot();
    const failure = deferredFailure();
    const onChat = vi.fn(() => failure.promise);
    const view = renderComponent(panel(current, "TABLE", onChat));
    const tableComposer = screen.getByRole("textbox", {
      name: "Сообщение или бросок",
    });
    await userEvent.type(tableComposer, "Не восстанавливать после ABA");
    await userEvent.type(tableComposer, "{enter}");
    await waitFor(() => expect(tableComposer).toHaveValue(""));
    expect(onChat).toHaveBeenCalledWith(
      "Не восстанавливать после ABA",
      "PUBLIC",
      "TABLE",
    );

    view.rerender(panel(current, "STORY", onChat));
    view.rerender(panel(current, "TABLE", onChat));
    await act(async () => {
      failure.reject();
      await failure.promise.catch(() => undefined);
    });
    expect(
      screen.getByRole("textbox", { name: "Сообщение или бросок" }),
      "UIX624_CHAT_SCOPE_ABA_EMPTY",
    ).toHaveValue("");
    expect(
      screen.queryByText(/Не удалось отправить сообщение/),
      "UIX624_CHAT_SCOPE_ABA_NO_STALE_ERROR",
    ).not.toBeInTheDocument();
  });

  it("a newer cross-stream draft survives the stale TABLE failure", async () => {
    const current = snapshot();
    const failure = deferredFailure();
    const onChat = vi.fn(() => failure.promise);
    const view = renderComponent(panel(current, "TABLE", onChat));
    const tableComposer = screen.getByRole("textbox", {
      name: "Сообщение или бросок",
    });
    await userEvent.type(tableComposer, "Старое отправление");
    await userEvent.type(tableComposer, "{enter}");
    await waitFor(() => expect(tableComposer).toHaveValue(""));

    view.rerender(panel(current, "STORY", onChat));
    const storyComposer = screen.getByRole("textbox", {
      name: "Сообщение сюжета",
    });
    await userEvent.type(storyComposer, "Новый сохранённый черновик");
    await act(async () => {
      failure.reject();
      await failure.promise.catch(() => undefined);
    });
    expect(storyComposer, "UIX624_CHAT_SCOPE_NEWER_DRAFT").toHaveValue(
      "Новый сохранённый черновик",
    );
    expect(
      screen.queryByText(/Не удалось отправить сообщение/),
      "UIX624_CHAT_SCOPE_NEWER_NO_STALE_ERROR",
    ).not.toBeInTheDocument();
  });
});

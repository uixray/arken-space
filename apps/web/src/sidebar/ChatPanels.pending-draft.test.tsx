// @vitest-environment jsdom
import type { ReactNode, TextareaHTMLAttributes } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { DirectChatThreadDto, GameSnapshot } from "@arken/contracts";
import { CampaignActionsContext } from "../campaign-actions-context";
import { directSelectionStorageKey } from "../direct-chat-state";
import { playerSnapshot } from "../test-support/game-snapshot-fixtures";
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
  TextArea: (props: TextareaHTMLAttributes<HTMLTextAreaElement>) => (
    <textarea {...props} />
  ),
  TextInput: () => null,
  Checkbox: () => null,
  Select: () => null,
}));

const { DirectChatPanel } = await import("./ChatPanels");
const threadId = "00000000-0000-4000-8000-000000000201";
const peerId = "00000000-0000-4000-8000-000000000202";

function snapshot(): GameSnapshot {
  const base = playerSnapshot();
  return playerSnapshot({
    directChatContacts: [{ membershipId: peerId, displayName: "Собеседник" }],
    chatThreads: [
      {
        id: threadId,
        campaignId: base.campaign.id,
        type: "DIRECT",
        stream: null,
        participants: [
          { membershipId: base.me.id, displayName: base.me.displayName },
          { membershipId: peerId, displayName: "Собеседник" },
        ],
        createdAt: new Date(0).toISOString(),
        updatedAt: new Date(0).toISOString(),
      },
    ],
  });
}

function deferred() {
  let resolve!: () => void;
  let reject!: () => void;
  const promise = new Promise<void>((onResolve, onReject) => {
    resolve = onResolve;
    reject = () => onReject(new Error("send failed"));
  });
  return { promise, resolve, reject };
}

function renderDirect(onDirectChat: ChatActions["onDirectChat"]) {
  const current = snapshot();
  const thread = current.chatThreads?.find(
    (item): item is DirectChatThreadDto => item.type === "DIRECT",
  );
  if (!thread) throw new Error("Direct fixture thread missing");
  window.localStorage.setItem(
    directSelectionStorageKey(current),
    JSON.stringify({ peerMembershipId: peerId, threadId }),
  );
  let upload = 0;
  renderComponent(
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
      <DirectChatPanel
        snapshot={current}
        activeThreadId={threadId}
        onActiveThreadChange={vi.fn()}
        onCreateThread={vi.fn(async () => thread)}
        onDirectChat={onDirectChat}
        onSticker={vi.fn(async () => undefined)}
        onUploadAttachment={vi.fn(async (file: File) => ({
          contentId: `content-${++upload}`,
          fileName: file.name,
          mimeType: file.type,
          sizeBytes: file.size,
          width: null,
          height: null,
          createdAt: new Date(0).toISOString(),
        }))}
        onMarkChatRead={vi.fn(async () => undefined)}
      />
    </CampaignActionsContext.Provider>,
  );
}

describe("UIX624 DirectChatPanel pending draft ownership", () => {
  beforeEach(() => {
    window.localStorage.clear();
    vi.clearAllMocks();
    // jsdom has no scrollTo; geometry is outside this draft-lifecycle test.
    Object.defineProperty(HTMLElement.prototype, "scrollTo", {
      configurable: true,
      writable: true,
      value: vi.fn(),
    });
    let preview = 0;
    Object.defineProperty(URL, "createObjectURL", {
      configurable: true,
      value: vi.fn(() => `blob:preview-${++preview}`),
    });
    Object.defineProperty(URL, "revokeObjectURL", {
      configurable: true,
      value: vi.fn(),
    });
  });

  it("late success keeps newer text and attachment", async () => {
    const send = deferred();
    const onDirectChat = vi.fn(() => send.promise);
    renderDirect(onDirectChat);
    const composer = screen.getByRole("textbox", {
      name: "Личное сообщение: Собеседник",
    });
    const input = screen.getByLabelText("Изображение");
    await userEvent.upload(
      input,
      new File(["old"], "old.png", { type: "image/png" }),
    );
    await userEvent.type(composer, "Первое сообщение");
    await userEvent.click(screen.getByRole("button", { name: "Отправить" }));
    await waitFor(() => expect(composer).toHaveValue(""));
    expect(onDirectChat).toHaveBeenCalledWith(threadId, "Первое сообщение", [
      "content-1",
    ]);
    await userEvent.type(composer, "Новый черновик");
    await userEvent.upload(
      input,
      new File(["new"], "new.png", { type: "image/png" }),
    );
    await act(async () => {
      send.resolve();
      await send.promise;
    });
    await waitFor(() =>
      expect(composer, "UIX624_DIRECT_NEWER_DRAFT").toHaveValue(
        "Новый черновик",
      ),
    );
    expect(screen.getByText("new.png")).toBeInTheDocument();
    expect(screen.queryByText("old.png")).not.toBeInTheDocument();
    expect(
      URL.revokeObjectURL,
      "UIX624_DIRECT_NEW_ATTACHMENT_NOT_REVOKED",
    ).not.toHaveBeenCalledWith("blob:preview-2");
  });

  it("success consumes sent attachment while keeping newer text", async () => {
    const send = deferred();
    const onDirectChat = vi.fn(() => send.promise);
    renderDirect(onDirectChat);
    const composer = screen.getByRole("textbox", {
      name: "Личное сообщение: Собеседник",
    });
    await userEvent.upload(
      screen.getByLabelText("Изображение"),
      new File(["old"], "old.png", { type: "image/png" }),
    );
    await userEvent.type(composer, "Первое сообщение");
    await userEvent.click(screen.getByRole("button", { name: "Отправить" }));
    await waitFor(() => expect(composer).toHaveValue(""));
    await userEvent.type(composer, "Новый черновик");
    await act(async () => {
      send.resolve();
      await send.promise;
    });
    expect(composer, "UIX624_DIRECT_NEWER_DRAFT").toHaveValue("Новый черновик");
    expect(
      screen.queryByRole("img", { name: "Вложение old.png" }),
      "UIX624_DIRECT_SENT_ATTACHMENT_CONSUMED",
    ).not.toBeInTheDocument();
    expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:preview-1");
    await userEvent.click(screen.getByRole("button", { name: "Отправить" }));
    expect(onDirectChat).toHaveBeenNthCalledWith(
      2,
      threadId,
      "Новый черновик",
      [],
    );
  });

  it("failure restores only untouched text and retains its preview", async () => {
    const send = deferred();
    const onDirectChat = vi.fn(() => send.promise);
    renderDirect(onDirectChat);
    const composer = screen.getByRole("textbox", {
      name: "Личное сообщение: Собеседник",
    });
    await userEvent.upload(
      screen.getByLabelText("Изображение"),
      new File(["kept"], "kept.png", { type: "image/png" }),
    );
    const preview = screen.getByRole("img", { name: "Вложение kept.png" });
    await userEvent.type(composer, "Вернуть после ошибки");
    await userEvent.click(screen.getByRole("button", { name: "Отправить" }));
    expect(onDirectChat).toHaveBeenCalledWith(
      threadId,
      "Вернуть после ошибки",
      ["content-1"],
    );
    await act(async () => {
      send.reject();
      await send.promise.catch(() => undefined);
    });
    await waitFor(() =>
      expect(composer, "UIX624_DIRECT_RESTORED_DRAFT").toHaveValue(
        "Вернуть после ошибки",
      ),
    );
    expect(preview, "UIX624_DIRECT_RESTORED_PREVIEW").toHaveAttribute(
      "src",
      "blob:preview-1",
    );
    expect(
      URL.revokeObjectURL,
      "UIX624_DIRECT_RESTORED_PREVIEW_NOT_REVOKED",
    ).not.toHaveBeenCalledWith("blob:preview-1");
  });
});

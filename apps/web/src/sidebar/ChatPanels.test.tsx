import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { GameSnapshot } from "@arken/contracts";
import { CampaignActionsContext } from "../campaign-actions-context";

// UIX-388: same mocking precedent as RollButton.test.tsx / AppErrorBoundary
// test.ts -- vitest runs this repo's tests under `environment: "node"` (no
// jsdom), so @gravity-ui/uikit's real components (which ship CSS the node
// transform can't handle) are swapped for plain DOM elements that preserve
// the prop contract ChatPanel actually relies on.
vi.mock("@gravity-ui/uikit", () => ({
  Button: ({
    className,
    type,
    disabled,
    onClick,
    children,
    "aria-label": ariaLabel,
    "aria-expanded": ariaExpanded,
    "aria-haspopup": ariaHaspopup,
    title,
  }: {
    className?: string;
    type?: "button" | "submit";
    disabled?: boolean;
    onClick?: () => void;
    children?: ReactNode;
    "aria-label"?: string;
    "aria-expanded"?: boolean;
    // Narrower than `string` so the value stays assignable to the DOM
    // button's own aria-haspopup union.
    "aria-haspopup"?: "menu" | "listbox" | "dialog" | "true" | boolean;
    title?: string;
  }) => (
    <button
      className={className}
      type={type}
      disabled={disabled}
      onClick={onClick}
      aria-label={ariaLabel}
      aria-expanded={ariaExpanded}
      aria-haspopup={ariaHaspopup}
      title={title}
    >
      {children}
    </button>
  ),
  TextArea: ({
    value,
    placeholder,
    rows,
    "aria-label": ariaLabel,
    "aria-describedby": ariaDescribedby,
    "aria-expanded": ariaExpanded,
    "aria-controls": ariaControls,
  }: {
    value?: string;
    placeholder?: string;
    rows?: number;
    "aria-label"?: string;
    "aria-describedby"?: string;
    "aria-expanded"?: boolean;
    "aria-controls"?: string;
  }) => (
    <textarea
      value={value}
      placeholder={placeholder}
      rows={rows}
      readOnly
      aria-label={ariaLabel}
      aria-describedby={ariaDescribedby}
      aria-expanded={ariaExpanded}
      aria-controls={ariaControls}
    />
  ),
}));

const { ChatPanel } = await import("./ChatPanels");

const noop = () => Promise.resolve();

function baseSnapshot(): GameSnapshot {
  return {
    me: { id: "member-1", role: "PLAYER", characterId: null },
    campaign: { id: "campaign-1" },
    characters: [],
    characterIdentities: [],
    assets: [],
    catalogEntries: [],
    messages: [],
    chatThreads: [],
    playerRequests: [],
  } as unknown as GameSnapshot;
}

function renderTablePanel() {
  // UIX-450: панель подгружает старые сообщения через контекст действий,
  // поэтому провайдер обязателен. Заглушка возвращает пустую страницу — тесты
  // здесь про композер, а не про историю.
  return renderToStaticMarkup(
    <CampaignActionsContext.Provider
      value={
        {
          chatHistory: {
            onLoadThreadHistory: async () => ({ loaded: 0, hasMore: false }),
          },
        } as never
      }
    >
      <ChatPanel
        snapshot={baseSnapshot()}
        onChat={noop as never}
        onSticker={noop as never}
        onRoll={noop as never}
        onMarkChatRead={noop as never}
        activeStream="TABLE"
        focusedMessageId={null}
        onMessageFocused={() => {}}
        onOpenPlayerRequests={() => {}}
      />
    </CampaignActionsContext.Provider>,
  );
}

describe("ChatPanel composer (UIX-388 layout repair)", () => {
  it("never renders a visible GM-only checkbox", () => {
    const html = renderTablePanel();
    expect(html).not.toContain("Только мастер");
    expect(html).not.toContain('type="checkbox"');
  });

  it("renders slash and send icon buttons with accessible labels inside the composer", () => {
    const html = renderTablePanel();
    expect(html).toContain('aria-label="Быстрые команды"');
    expect(html).toContain('title="Быстрые команды"');
    // Send is an icon button immediately after the slash icon, and its
    // label/tooltip explain both Enter and Ctrl+Enter up front.
    expect(html).toContain("Enter — отправить всем");
    expect(html).toContain("Ctrl+Enter — отправить только мастеру");
    const slashIndex = html.indexOf('aria-label="Быстрые команды"');
    const sendIndex = html.indexOf("composer-send-action");
    expect(slashIndex).toBeGreaterThan(-1);
    expect(sendIndex).toBeGreaterThan(slashIndex);
  });

  it("renders the sticker button with its accessible label before the slash button (focus order)", () => {
    const html = renderTablePanel();
    const stickerIndex = html.indexOf('aria-label="Стикеры"');
    const slashIndex = html.indexOf('aria-label="Быстрые команды"');
    const sendIndex = html.indexOf("composer-send-action");
    expect(stickerIndex).toBeGreaterThan(-1);
    expect(stickerIndex).toBeLessThan(slashIndex);
    expect(slashIndex).toBeLessThan(sendIndex);
  });

  it("shows a persistent (not hover-only) hint explaining Enter vs Ctrl+Enter", () => {
    const html = renderTablePanel();
    expect(html).toContain("composer-hint");
    expect(html).toContain("Enter — всем · Ctrl+Enter — только мастеру");
    expect(html).toContain('aria-describedby="chat-composer-hint"');
  });
});

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

const { ChatPanel, ChatMessageBody } = await import("./ChatPanels");

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
            onLoadThreadHistory: async () => ({
              loaded: 0,
              hasMore: false,
              accepted: true,
              messageIds: [],
            }),
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

/**
 * UIX-501 — за кого сделан бросок.
 *
 * Подпись с именем персонажа убирали дважды, в UIX-454 и UIX-467, и оба раза по
 * одной причине: у чужого броска она вырождалась в слово «Персонаж». Причина
 * была не в подписи, а в источнике — старая разметка искала имя в
 * `snapshot.characters`, то есть среди доступных мне карточек, где чужого
 * персонажа нет.
 *
 * Поэтому проверяется в первую очередь источник, а не наличие текста: тест,
 * который смотрит только «имя показано», прошёл бы и со старой разметкой на
 * своём персонаже — то есть ровно на том случае, где дефекта никогда и не было.
 */
function renderActivityWith(
  overrides: Partial<GameSnapshot>,
  displayName = "Андрей",
  characterId: string | null = "character-1",
) {
  const snapshot = { ...baseSnapshot(), ...overrides } as GameSnapshot;
  return renderToStaticMarkup(
    <CampaignActionsContext.Provider
      value={
        {
          chatHistory: {
            onLoadThreadHistory: async () => ({
              loaded: 0,
              hasMore: false,
              accepted: true,
              messageIds: [],
            }),
          },
        } as never
      }
    >
      <ChatPanel
        snapshot={
          {
            ...snapshot,
            messages: [
              {
                id: "message-1",
                threadId: "thread-1",
                stream: "TABLE",
                kind: "TEXT",
                visibility: "PUBLIC",
                displayName,
                characterId,
                body: "бросок",
                createdAt: new Date().toISOString(),
                sequence: 1,
              },
            ],
            chatThreads: [
              { id: "thread-1", type: "STREAM", stream: "TABLE", unread: 0 },
            ],
          } as unknown as GameSnapshot
        }
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

const identity = (id: string, name: string) => ({
  id,
  name,
  portraitAssetId: null,
  tokenAssetId: null,
});

describe("подпись персонажа в ленте (UIX-501)", () => {
  it("берёт имя из публичной личности, а не из доступных мне карточек", () => {
    // Сердце задачи. В `characters` лежит другое имя намеренно: если разметка
    // вернётся к прежнему источнику, тест назовёт это вслух, а не промолчит.
    const markup = renderActivityWith({
      characterIdentities: [identity("character-1", "Тейн")],
      characters: [
        { id: "character-1", name: "ИМЯ ИЗ ДОСТУПНОЙ КАРТОЧКИ" },
      ] as unknown as GameSnapshot["characters"],
    });
    expect(markup).toContain("Тейн");
    expect(markup).not.toContain("ИМЯ ИЗ ДОСТУПНОЙ КАРТОЧКИ");
  });

  it("показывает и участника, и персонажа, не смешивая их", () => {
    // Мастер бросает за чужого персонажа: обе стороны обязаны читаться.
    const markup = renderActivityWith(
      { characterIdentities: [identity("character-1", "Тейн")] },
      "Мастер",
    );
    expect(markup).toContain("<strong>Мастер</strong>");
    expect(markup).toContain('class="message-character"');
    expect(markup).toContain("Тейн");
  });

  it("не подписывает бросок без персонажа", () => {
    const markup = renderActivityWith(
      { characterIdentities: [identity("character-1", "Тейн")] },
      "Мастер",
      null,
    );
    expect(markup).not.toContain('class="message-character"');
    expect(markup).toContain("<strong>Мастер</strong>");
  });

  it("молчит о персонаже, которого мне не показывают, вместо заглушки", () => {
    // Скрытый NPC мастера, удалённый или архивный персонаж — все три приходят
    // одинаково: `characterId` есть, публичной личности нет. Здесь и появлялось
    // слово «Персонаж», из-за которого подпись убирали дважды.
    const markup = renderActivityWith({ characterIdentities: [] });
    expect(markup).not.toContain('class="message-character"');
    expect(markup).not.toContain("Персонаж");
  });
});

describe("dice presentation boundary (UIX-289)", () => {
  const validDice = {
    formula: "1d20+5",
    resolvedFormula: "1d20+5",
    terms: [{ notation: "1d20", rolls: [20], subtotal: 20 }],
    modifiers: [{ source: "5", value: 5 }],
    total: 25,
    semanticOutcome: { kind: "CRITICAL_SUCCESS", keptNaturalD20: 20 },
  };

  function renderDiceBody(dice: unknown, skill: boolean) {
    const payload = skill
      ? {
          ...(dice as Record<string, unknown>),
          skillCard: {
            version: 1,
            mode: "EXECUTE",
            characterName: "Test actor",
            entry: { id: "skill-1", name: "Test skill", kind: "SKILL" },
            action: {
              id: "action-1",
              label: "Test action",
              formula: "1d20+5",
              kind: "CUSTOM",
            },
            result: { total: 25 },
          },
        }
      : dice;
    const message: GameSnapshot["messages"][number] = {
      id: "dice-1",
      sequence: 1,
      membershipId: "member-1",
      displayName: "Test participant",
      characterId: null,
      body: "Test roll",
      visibility: "PUBLIC",
      kind: "DICE",
      threadId: "table-1",
      stream: "TABLE",
      dice: payload as GameSnapshot["messages"][number]["dice"],
      createdAt: "2026-09-12T00:00:00.000Z",
    };
    return renderToStaticMarkup(<ChatMessageBody message={message} />);
  }

  it.each([false, true])(
    "keeps total and critical label when decorative frame is invalid (skill=%s)",
    (skill) => {
      const markup = renderDiceBody(
        { ...validDice, frame: { setKey: "PRIVATE", frameKey: "unpublished" } },
        skill,
      );
      expect(markup).toMatch(
        /<strong[^>]*aria-label="Итог броска"[^>]*>25<\/strong>/,
      );
      expect(markup).toContain("Критический успех");
      expect(markup).not.toContain("Критический провал");
    },
  );

  it.each([false, true])(
    "does not turn malformed semantics into a legacy critical (skill=%s)",
    (skill) => {
      const markup = renderDiceBody(
        {
          ...validDice,
          semanticOutcome: { kind: "CRITICAL_SUCCESS", keptNaturalD20: 1 },
        },
        skill,
      );
      expect(markup).not.toContain("roll-critical-label");
      expect(markup).not.toContain("roll-result--critical-");
    },
  );

  it.each([false, true])(
    "preserves explicit noncritical semantics over natural legacy terms (skill=%s)",
    (skill) => {
      const markup = renderDiceBody(
        {
          ...validDice,
          semanticOutcome: { kind: "NORMAL", keptNaturalD20: 20 },
          frame: { setKey: "ARKEN_CRITICAL_V1", frameKey: "critical-success" },
        },
        skill,
      );
      expect(markup).toMatch(
        /<strong[^>]*aria-label="Итог броска"[^>]*>25<\/strong>/,
      );
      expect(markup).not.toContain("roll-critical-label");
    },
  );
});

// @vitest-environment jsdom
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import type { ChatMessageDto, GameSnapshot } from "@arken/contracts";
import { CampaignActionsContext } from "./campaign-actions-context";
import {
  shouldLoadOlderAfterScroll,
  useThreadHistory,
} from "./use-thread-history";
import { act, renderComponent, screen, waitFor } from "./test-support/render";
import { playerSnapshot } from "./test-support/game-snapshot-fixtures";

const message = (threadId: string, sequence: number) =>
  ({
    id: `${threadId}-${sequence}`,
    threadId,
    sequence,
  }) as ChatMessageDto;

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function Harness({
  authority,
  threadId,
  messages,
}: {
  authority: GameSnapshot;
  threadId: string | null;
  messages: ChatMessageDto[];
}) {
  const history = useThreadHistory(authority, threadId, messages);
  return (
    <>
      <span data-testid="has-more">{String(history.hasMore)}</span>
      <span data-testid="pending">{String(history.pending)}</span>
      <span data-testid="error">{history.error}</span>
      <button type="button" onClick={() => void history.loadOlder()}>
        load
      </button>
    </>
  );
}

function Provider({
  loader,
  children,
}: {
  loader: (
    threadId: string,
    before?: number,
  ) => Promise<{
    loaded: number;
    hasMore: boolean;
    accepted: boolean;
    messageIds: string[];
  }>;
  children: ReactNode;
}) {
  return (
    <CampaignActionsContext.Provider
      value={{ chatHistory: { onLoadThreadHistory: loader } } as never}
    >
      {children}
    </CampaignActionsContext.Provider>
  );
}

function authorityFor(
  threadId: string | null,
  messages: ChatMessageDto[],
): GameSnapshot {
  const base = playerSnapshot();
  return {
    ...base,
    messages,
    chatThreads: threadId
      ? [
          {
            id: threadId,
            campaignId: base.campaign.id,
            type: "STREAM",
            stream: "TABLE",
            createdAt: new Date(0).toISOString(),
            updatedAt: new Date(0).toISOString(),
          },
        ]
      : [],
  };
}

describe("useThreadHistory", () => {
  it("автозагружает только после движения вверх к началу списка", () => {
    expect(
      shouldLoadOlderAfterScroll({
        previousScrollTop: null,
        scrollTop: 0,
        hasMore: true,
        pending: false,
      }),
    ).toBe(false);
    expect(
      shouldLoadOlderAfterScroll({
        previousScrollTop: 90,
        scrollTop: 24,
        hasMore: true,
        pending: false,
      }),
    ).toBe(true);
    expect(
      shouldLoadOlderAfterScroll({
        previousScrollTop: 24,
        scrollTop: 40,
        hasMore: true,
        pending: false,
      }),
    ).toBe(false);
    expect(
      shouldLoadOlderAfterScroll({
        previousScrollTop: 90,
        scrollTop: 24,
        hasMore: false,
        pending: false,
      }),
    ).toBe(false);
  });

  it("не предлагает историю без выбранного потока", () => {
    const loader = vi.fn();
    const authority = authorityFor(null, []);
    renderComponent(
      <Provider loader={loader}>
        <Harness authority={authority} threadId={null} messages={[]} />
      </Provider>,
    );

    expect(screen.getByTestId("has-more")).toHaveTextContent("false");
    screen.getByRole("button", { name: "load" }).click();
    expect(loader).not.toHaveBeenCalled();
  });

  it("берёт курсор из явно выбранного потока даже при смешанном массиве", async () => {
    const loader = vi.fn(async () => ({
      loaded: 2,
      hasMore: false,
      accepted: true,
      messageIds: [],
    }));
    const messages = [
      message("other", 1),
      message("direct-a", 9),
      message("direct-a", 4),
    ];
    const authority = authorityFor("direct-a", messages);
    const { rerender } = renderComponent(
      <Provider loader={loader}>
        <Harness
          authority={authority}
          threadId="direct-a"
          messages={messages}
        />
      </Provider>,
    );

    act(() => {
      screen.getByRole("button", { name: "load" }).click();
    });
    await waitFor(() => expect(loader).toHaveBeenCalledWith("direct-a", 4));
    const committed = { ...authority };
    rerender(
      <Provider loader={loader}>
        <Harness
          authority={committed}
          threadId="direct-a"
          messages={messages}
        />
      </Provider>,
    );
    await waitFor(() =>
      expect(screen.getByTestId("has-more")).toHaveTextContent("false"),
    );
  });

  it("сбрасывает hasMore и ошибку при переключении потока", async () => {
    const loader = vi.fn(() => Promise.reject(new Error("сломано")));
    const authorityA = authorityFor("direct-a", []);
    const { rerender } = renderComponent(
      <Provider loader={loader}>
        <Harness authority={authorityA} threadId="direct-a" messages={[]} />
      </Provider>,
    );

    await act(async () => {
      screen.getByRole("button", { name: "load" }).click();
    });
    expect(screen.getByTestId("error").textContent).not.toBe("");

    const authorityB = authorityFor("direct-b", []);
    rerender(
      <Provider loader={loader}>
        <Harness authority={authorityB} threadId="direct-b" messages={[]} />
      </Provider>,
    );
    await waitFor(() => {
      expect(screen.getByTestId("has-more")).toHaveTextContent("true");
      expect(screen.getByTestId("error").textContent).toBe("");
      expect(screen.getByTestId("pending")).toHaveTextContent("false");
    });
  });

  it("игнорирует поздний ответ предыдущего потока", async () => {
    const pageA = deferred<{
      loaded: number;
      hasMore: boolean;
      accepted: boolean;
      messageIds: string[];
    }>();
    const loader = vi.fn((threadId: string) =>
      threadId === "direct-a"
        ? pageA.promise
        : Promise.resolve({
            loaded: 0,
            hasMore: true,
            accepted: true,
            messageIds: [],
          }),
    );
    const messagesA = [message("direct-a", 5)];
    const authorityA = authorityFor("direct-a", messagesA);
    const { rerender } = renderComponent(
      <Provider loader={loader}>
        <Harness
          authority={authorityA}
          threadId="direct-a"
          messages={messagesA}
        />
      </Provider>,
    );

    act(() => {
      screen.getByRole("button", { name: "load" }).click();
    });
    expect(screen.getByTestId("pending")).toHaveTextContent("true");

    const authorityB = authorityFor("direct-b", []);
    rerender(
      <Provider loader={loader}>
        <Harness authority={authorityB} threadId="direct-b" messages={[]} />
      </Provider>,
    );
    await act(async () => {
      pageA.resolve({
        loaded: 0,
        hasMore: false,
        accepted: true,
        messageIds: [],
      });
      await pageA.promise;
    });

    expect(screen.getByTestId("has-more")).toHaveTextContent("true");
    expect(screen.getByTestId("pending")).toHaveTextContent("false");
    expect(screen.getByTestId("error").textContent).toBe("");
  });

  it("не доверяет hasMore страницы, которую action не применил", async () => {
    const loader = vi.fn(async () => ({
      loaded: 0,
      hasMore: false,
      accepted: false,
      messageIds: [],
    }));
    const authority = authorityFor("direct-a", []);
    renderComponent(
      <Provider loader={loader}>
        <Harness authority={authority} threadId="direct-a" messages={[]} />
      </Provider>,
    );

    await act(async () => {
      screen.getByRole("button", { name: "load" }).click();
    });
    expect(screen.getByTestId("has-more")).toHaveTextContent("true");
  });

  it("снова открывает историю после authoritative window truncation и гасит её stale response", async () => {
    const stale = deferred<{
      loaded: number;
      hasMore: boolean;
      accepted: boolean;
      messageIds: string[];
    }>();
    const loader = vi
      .fn()
      .mockResolvedValueOnce({
        loaded: 50,
        hasMore: false,
        accepted: true,
        messageIds: [],
      })
      .mockReturnValueOnce(stale.promise);
    const loadedWindow = Array.from({ length: 70 }, (_, index) =>
      message("direct-a", index + 1),
    );
    const loadedAuthority = authorityFor("direct-a", loadedWindow);
    const { rerender } = renderComponent(
      <Provider loader={loader}>
        <Harness
          authority={loadedAuthority}
          threadId="direct-a"
          messages={loadedWindow}
        />
      </Provider>,
    );

    act(() => {
      screen.getByRole("button", { name: "load" }).click();
    });
    await waitFor(() => expect(loader).toHaveBeenCalledTimes(1));
    const committedLoadedAuthority = { ...loadedAuthority };
    rerender(
      <Provider loader={loader}>
        <Harness
          authority={committedLoadedAuthority}
          threadId="direct-a"
          messages={loadedWindow}
        />
      </Provider>,
    );
    await waitFor(() =>
      expect(screen.getByTestId("has-more")).toHaveTextContent("false"),
    );

    const authoritativeWindow = Array.from({ length: 20 }, (_, index) =>
      message("direct-a", index + 101),
    );
    const authoritativeSnapshot = authorityFor("direct-a", authoritativeWindow);
    rerender(
      <Provider loader={loader}>
        <Harness
          authority={authoritativeSnapshot}
          threadId="direct-a"
          messages={authoritativeWindow}
        />
      </Provider>,
    );
    expect(screen.getByTestId("has-more")).toHaveTextContent("true");

    act(() => {
      screen.getByRole("button", { name: "load" }).click();
    });
    expect(screen.getByTestId("pending")).toHaveTextContent("true");

    const newerAuthoritativeWindow = Array.from({ length: 20 }, (_, index) =>
      message("direct-a", index + 121),
    );
    const newerAuthoritativeSnapshot = authorityFor(
      "direct-a",
      newerAuthoritativeWindow,
    );
    rerender(
      <Provider loader={loader}>
        <Harness
          authority={newerAuthoritativeSnapshot}
          threadId="direct-a"
          messages={newerAuthoritativeWindow}
        />
      </Provider>,
    );
    expect(screen.getByTestId("pending")).toHaveTextContent("false");

    await act(async () => {
      stale.resolve({
        loaded: 50,
        hasMore: false,
        accepted: true,
        messageIds: [],
      });
      await stale.promise;
    });
    expect(screen.getByTestId("has-more")).toHaveTextContent("true");
    expect(screen.getByTestId("pending")).toHaveTextContent("false");
  });
});

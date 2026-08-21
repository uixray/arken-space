// @vitest-environment jsdom
import {
  useLayoutEffect,
  type Dispatch,
  type MutableRefObject,
  type SetStateAction,
} from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ChatMessageDto, GameSnapshot } from "@arken/contracts";
import { buildActivityFeed } from "./activity-feed";
import { CampaignActionsContext } from "./campaign-actions-context";
import { playerSnapshot } from "./test-support/game-snapshot-fixtures";
import { act, renderComponent, screen, waitFor } from "./test-support/render";
import { useThreadHistory } from "./use-thread-history";

const apiMock = vi.hoisted(() => vi.fn());
vi.mock("./api", () => ({ api: apiMock }));

const { useChatHistoryActions } = await import("./use-chat-history-actions");
type Actions = ReturnType<typeof useChatHistoryActions>;

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

function snapshotFor({
  campaignId,
  membershipId,
  threadId,
}: {
  campaignId: string;
  membershipId: string;
  threadId: string;
}): GameSnapshot {
  const base = playerSnapshot();
  const me = { ...base.me, id: membershipId };
  return {
    ...base,
    campaign: { ...base.campaign, id: campaignId },
    me,
    members: [me],
    chatThreads: [
      {
        id: threadId,
        campaignId,
        type: "DIRECT",
        stream: null,
        participants: [
          { membershipId, displayName: "Я" },
          { membershipId: `${membershipId}-peer`, displayName: "Собеседник" },
        ],
        createdAt: new Date(0).toISOString(),
        updatedAt: new Date(0).toISOString(),
      },
    ],
    messages: [],
  };
}

function oldDirectMessage(threadId: string): ChatMessageDto {
  return {
    id: "old-direct-secret",
    sequence: 1,
    membershipId: "old-peer",
    displayName: "Старый собеседник",
    characterId: null,
    body: "секрет предыдущего игрока",
    playerRequestId: null,
    visibility: "PUBLIC",
    kind: "TEXT",
    threadId,
    stream: null,
    dice: null,
    skillCard: null,
    stickerId: null,
    stickerPresentation: null,
    attachments: [],
    createdAt: new Date(0).toISOString(),
  };
}

function stateHarness(initial: GameSnapshot) {
  let current: GameSnapshot | null = initial;
  const snapshotRef: MutableRefObject<GameSnapshot | null> = {
    current: initial,
  };
  const setSnapshot: Dispatch<SetStateAction<GameSnapshot | null>> = (
    update,
  ) => {
    current = typeof update === "function" ? update(current) : update;
    snapshotRef.current = current;
  };
  return {
    snapshotRef,
    setSnapshot,
    current: () => current,
    replace(next: GameSnapshot | null) {
      current = next;
      snapshotRef.current = next;
    },
  };
}

function queuedStateHarness(initial: GameSnapshot) {
  let current: GameSnapshot | null = initial;
  const snapshotRef: MutableRefObject<GameSnapshot | null> = {
    current: initial,
  };
  const queue: SetStateAction<GameSnapshot | null>[] = [];
  const setSnapshot: Dispatch<SetStateAction<GameSnapshot | null>> = (
    update,
  ) => {
    queue.push(update);
  };
  return {
    snapshotRef,
    setSnapshot,
    current: () => current,
    enqueueReplacement(next: GameSnapshot) {
      queue.push(next);
    },
    queued: () => queue.length,
    flush() {
      for (const update of queue.splice(0))
        current = typeof update === "function" ? update(current) : update;
      snapshotRef.current = current;
    },
  };
}

function captureActions(
  setSnapshot: Dispatch<SetStateAction<GameSnapshot | null>>,
  snapshotRef: MutableRefObject<GameSnapshot | null>,
) {
  const capture = vi.fn<(actions: Actions) => void>();
  function Harness() {
    const actions = useChatHistoryActions({ setSnapshot, snapshotRef });
    useLayoutEffect(() => capture(actions), [actions]);
    return null;
  }
  renderComponent(<Harness />);
  const captured = capture.mock.lastCall?.[0];
  if (!captured) throw new Error("actions not captured");
  return captured;
}

function HistoryHarness({
  authority,
  threadId,
  actions,
}: {
  authority: GameSnapshot;
  threadId: string;
  actions: Actions;
}) {
  return (
    <CampaignActionsContext.Provider value={{ chatHistory: actions } as never}>
      <HistoryConsumer authority={authority} threadId={threadId} />
    </CampaignActionsContext.Provider>
  );
}

function HistoryConsumer({
  authority,
  threadId,
}: {
  authority: GameSnapshot;
  threadId: string;
}) {
  const messages = authority.messages.filter(
    (message) => message.threadId === threadId,
  );
  const history = useThreadHistory(authority, threadId, messages);
  return (
    <>
      {history.hasMore && (
        <button type="button" onClick={() => void history.loadOlder()}>
          history
        </button>
      )}
      <span data-testid="history-pending">{String(history.pending)}</span>
    </>
  );
}

beforeEach(() => apiMock.mockReset());

describe("useChatHistoryActions authority guard", () => {
  it("не переносит позднюю DIRECT-страницу в снапшот другого игрока или activity", async () => {
    const oldThread = "00000000-0000-4000-8000-000000000201";
    const nextThread = "00000000-0000-4000-8000-000000000202";
    const oldSnapshot = snapshotFor({
      campaignId: "campaign-old",
      membershipId: "member-old",
      threadId: oldThread,
    });
    const nextSnapshot = snapshotFor({
      campaignId: "campaign-next",
      membershipId: "member-next",
      threadId: nextThread,
    });
    const state = stateHarness(oldSnapshot);
    const actions = captureActions(state.setSnapshot, state.snapshotRef);
    const response = deferred<{
      messages: ChatMessageDto[];
      hasMore: boolean;
    }>();
    apiMock.mockReturnValueOnce(response.promise);

    const loading = actions.onLoadThreadHistory(oldThread);
    state.replace(nextSnapshot);
    response.resolve({
      messages: [oldDirectMessage(oldThread)],
      hasMore: false,
    });
    const result = await loading;

    expect(result).toMatchObject({ loaded: 0, accepted: false });
    expect(state.current()).toBe(nextSnapshot);
    expect(JSON.stringify(state.current())).not.toContain(
      "секрет предыдущего игрока",
    );
    expect(
      buildActivityFeed(
        state.current()?.messages ?? [],
        state.current()?.chatThreads ?? [],
      ),
    ).toEqual([]);
  });

  it("отбрасывает страницу после full-snapshot replacement даже при той же identity/thread", async () => {
    const threadId = "00000000-0000-4000-8000-000000000203";
    const initial = snapshotFor({
      campaignId: "campaign-same",
      membershipId: "member-same",
      threadId,
    });
    const replacement = { ...initial, messages: [...initial.messages] };
    const state = stateHarness(initial);
    const actions = captureActions(state.setSnapshot, state.snapshotRef);
    const response = deferred<{
      messages: ChatMessageDto[];
      hasMore: boolean;
    }>();
    apiMock.mockReturnValueOnce(response.promise);

    const loading = actions.onLoadThreadHistory(threadId);
    state.replace(replacement);
    response.resolve({
      messages: [oldDirectMessage(threadId)],
      hasMore: false,
    });

    await expect(loading).resolves.toMatchObject({
      accepted: false,
      loaded: 0,
    });
    expect(state.current()).toBe(replacement);
    expect(state.current()?.messages).toEqual([]);
  });

  it("не скрывает кнопку, если queued replacement побеждает guarded updater", async () => {
    const threadId = "00000000-0000-4000-8000-000000000205";
    const initial = snapshotFor({
      campaignId: "campaign-queued",
      membershipId: "member-queued",
      threadId,
    });
    const replacement = { ...initial, messages: [...initial.messages] };
    const state = queuedStateHarness(initial);
    const actions = captureActions(state.setSnapshot, state.snapshotRef);
    const response = deferred<{
      messages: ChatMessageDto[];
      hasMore: boolean;
    }>();
    apiMock.mockReturnValueOnce(response.promise);

    const { rerender } = renderComponent(
      <HistoryHarness
        authority={initial}
        threadId={threadId}
        actions={actions}
      />,
    );
    act(() => {
      screen.getByRole("button", { name: "history" }).click();
    });
    // React accepted a newer authoritative snapshot but has not committed it;
    // the post-await precheck still sees `initial` and queues its guarded
    // updater behind this replacement.
    state.enqueueReplacement(replacement);
    await act(async () => {
      response.resolve({
        messages: [oldDirectMessage(threadId)],
        hasMore: false,
      });
      await response.promise;
    });
    await waitFor(() => expect(state.queued()).toBe(2));
    expect(screen.getByRole("button", { name: "history" })).toBeInTheDocument();
    expect(screen.getByTestId("history-pending")).toHaveTextContent("true");

    state.flush();
    rerender(
      <HistoryHarness
        authority={replacement}
        threadId={threadId}
        actions={actions}
      />,
    );
    await waitFor(() =>
      expect(screen.getByTestId("history-pending")).toHaveTextContent("false"),
    );
    expect(screen.getByRole("button", { name: "history" })).toBeInTheDocument();
    expect(state.current()).toBe(replacement);
    expect(state.current()?.messages).toEqual([]);
  });

  it("подшивает страницу только в неизменившийся authoritative snapshot", async () => {
    const threadId = "00000000-0000-4000-8000-000000000204";
    const initial = snapshotFor({
      campaignId: "campaign-current",
      membershipId: "member-current",
      threadId,
    });
    const state = stateHarness(initial);
    const actions = captureActions(state.setSnapshot, state.snapshotRef);
    apiMock.mockResolvedValueOnce({
      messages: [oldDirectMessage(threadId)],
      hasMore: false,
    });

    await expect(actions.onLoadThreadHistory(threadId)).resolves.toMatchObject({
      loaded: 1,
      hasMore: false,
      accepted: true,
      messageIds: ["old-direct-secret"],
    });
    expect(state.current()?.messages.map((message) => message.id)).toEqual([
      "old-direct-secret",
    ]);
  });
});

// @vitest-environment jsdom
import { useRef, useState } from "react";
import { beforeEach, expect, it, vi } from "vitest";
import type { GameSnapshot, TokenDto } from "@arken/contracts";
import { act, renderComponent } from "./test-support/render";
import { gmSnapshot } from "./test-support/game-snapshot-fixtures";

type Listener = (payload?: unknown) => void;
const fake = vi.hoisted(() => {
  const listeners = new Map<string, Listener[]>();
  const socket = {
    id: "socket",
    connected: false,
    recovered: false,
    on(event: string, listener: Listener) {
      listeners.set(event, [...(listeners.get(event) ?? []), listener]);
      return socket;
    },
    off() {
      return socket;
    },
    emit: vi.fn(() => {
      return socket;
    }),
    disconnect() {
      return socket;
    },
    io: { on() {} },
  };
  return {
    socket,
    fire(event: string, payload?: unknown) {
      for (const listener of listeners.get(event) ?? []) listener(payload);
    },
    reset() {
      listeners.clear();
      socket.emit.mockClear();
      socket.connected = false;
    },
  };
});
vi.mock("./realtime", () => ({ createGameSocket: () => fake.socket }));
vi.mock("./api", () => ({ reportClientEvent: vi.fn() }));
const { useGameSocketSubscriptions } =
  await import("./use-game-socket-subscriptions");
const token = (id: string, revision: number, sceneId = "a", x = 0) =>
  ({ id, revision, sceneId, x, y: 0 }) as TokenDto;
const initial = () =>
  gmSnapshot({ snapshotVersion: 100, tokens: [token("a", 0), token("b", 0)] });
const noop = () => {};
let observed: GameSnapshot;
function Harness({ player = false }: { player?: boolean }) {
  const [state, setSnapshot] = useState<GameSnapshot | null>(() =>
    player ? playerSnapshot(100) : initial(),
  );
  observed = state!;
  const chatIds = useRef(new Set<string>()),
    threadId = useRef<string | null>(null),
    chatOpen = useRef(false);
  useGameSocketSubscriptions({
    campaignId: state?.campaign.id ?? null,
    initialSnapshotVersion: 100,
    authRequired: false,
    viewedSceneId: "a",
    loadStoryPosts: async () => {},
    setSnapshot,
    setPings: noop,
    setRulers: noop,
    setCursors: noop,
    setRollToasts: noop,
    setPresence: noop,
    setError: noop,
    knownChatMessageIdsRef: chatIds,
    activeChatThreadIdRef: threadId,
    chatOpenRef: chatOpen,
  });
  return null;
}
beforeEach(() => fake.reset());
it("handles interleaved movement, deletion, ID reuse and scene changes through the socket", async () => {
  renderComponent(<Harness />);
  await act(async () => fake.fire("token:preview-epoch", "new"));
  await act(async () =>
    fake.fire("token:updated", { sequence: 105, data: token("b", 1) }),
  );
  await act(async () =>
    fake.fire("token:moving", { tokenId: "a", revision: 0, x: 60, y: 0 }),
  );
  await act(async () =>
    fake.fire("token:moved", { sequence: 104, data: token("a", 1, "a", 60) }),
  );
  expect(observed.tokens[0]).toMatchObject({ revision: 1, x: 60 });
  expect(observed.snapshotVersion).toBe(105);
  await act(async () =>
    fake.fire(
      "game:snapshot",
      gmSnapshot({ snapshotVersion: 106, tokens: [token("b", 1)] }),
    ),
  );
  await act(async () =>
    fake.fire("token:moved", { sequence: 104, data: token("a", 2, "a", 90) }),
  );
  expect(observed.tokens.map((item) => item.id)).toEqual(["b"]);
  await act(async () =>
    fake.fire(
      "game:snapshot",
      gmSnapshot({
        snapshotVersion: 108,
        tokens: [token("a", 0, "b", 4), token("b", 1)],
      }),
    ),
  );
  await act(async () =>
    fake.fire("token:moved", { sequence: 104, data: token("a", 2, "a", 90) }),
  );
  await act(async () =>
    fake.fire("token:updated", { sequence: 105, data: token("a", 3, "b", 90) }),
  );
  expect(observed.tokens[0]).toMatchObject({ revision: 0, sceneId: "b", x: 4 });
  await act(async () => fake.fire("token:moving", { tokenId: "a", revision: 0, sceneId: "b", snapshotVersion: 104, previewEpoch: "old", x: 90, y: 0 }));
  expect(observed.tokens[0]).toMatchObject({ x: 4 });
  await act(async () => fake.fire("token:moving", { tokenId: "a", revision: 0, sceneId: "a", snapshotVersion: 108, previewEpoch: "new", x: 90, y: 0 }));
  expect(observed.tokens[0]).toMatchObject({ x: 4 });
  await act(async () => fake.fire("token:moving", { tokenId: "a", revision: 0, sceneId: "b", snapshotVersion: 108, previewEpoch: "new", x: 20, y: 0 }));
  expect(observed.tokens[0]).toMatchObject({ x: 20 });
  await act(async () =>
    fake.fire("token:moved", { sequence: 109, data: token("a", 1, "b", 30) }),
  );
  expect(observed.tokens[0]).toMatchObject({
    revision: 1,
    sceneId: "b",
    x: 30,
  });
});

function playerSnapshot(snapshotVersion: number) {
  const base = gmSnapshot({
    snapshotVersion, tokens: [{ ...token("a", 0), visible: true }],
  });
  return { ...base, me: { ...base.me, role: "PLAYER" as const } };
}

it("keeps a held redaction across unrelated snapshots, then resyncs an abandoned drag", async () => {
  vi.useFakeTimers();
  try {
    fake.socket.connected = true;
    renderComponent(<Harness player />);
    await act(async () => fake.fire("token:preview-epoch", "current"));
    const event = { tokenId: "a", sceneId: "a", revision: 0, previewEpoch: "current" };
    await act(async () => fake.fire("token:preview-hidden", event));
    expect(observed.tokens[0]).toMatchObject({ visible: false, x: 0 });
    await act(async () => fake.fire("game:snapshot", playerSnapshot(101)));
    expect(observed.tokens[0]).toMatchObject({ visible: false, x: 0 });
    await act(async () => { await vi.advanceTimersByTimeAsync(7000); });
    await act(async () => fake.fire("token:preview-hidden", event));
    await act(async () => { await vi.advanceTimersByTimeAsync(7999); });
    expect(fake.socket.emit).not.toHaveBeenCalledWith("game:resync", 101);
    await act(async () => { await vi.advanceTimersByTimeAsync(1); });
    expect(fake.socket.emit).toHaveBeenCalledWith("game:resync", 101);
    await act(async () => fake.fire("game:snapshot", playerSnapshot(101)));
    expect(observed.tokens[0]).toMatchObject({ visible: true, x: 0 });
  } finally {
    vi.useRealTimers();
  }
});

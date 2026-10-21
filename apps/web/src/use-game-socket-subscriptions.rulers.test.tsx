// @vitest-environment jsdom
import { useState } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderComponent } from "./test-support/render";
import {
  useGameSocketSubscriptions,
  type RulerItem,
} from "./use-game-socket-subscriptions";

/**
 * UIX-682 C20: линейки — эфемерное состояние без серверного снимка. Сервер
 * переигрывает пропущенный ruler:cleared только восстановленной сессии
 * (connectionStateRecovery, 120 s); после обычного переподключения его нет —
 * см. tests/realtime-ruler-lifecycle.test.ts. Клиент не должен держать
 * линейку, которую уже никто не сотрёт.
 */

type Listener = (payload?: unknown) => void;

const fake = vi.hoisted(() => {
  const listeners = new Map<string, Listener[]>();
  const socket = {
    id: "socket-1",
    recovered: undefined as boolean | undefined,
    on(event: string, listener: Listener) {
      listeners.set(event, [...(listeners.get(event) ?? []), listener]);
      return socket;
    },
    off() {
      return socket;
    },
    emit() {
      return socket;
    },
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
      socket.recovered = undefined;
    },
  };
});

vi.mock("./realtime", () => ({ createGameSocket: () => fake.socket }));
vi.mock("./api", () => ({ reportClientEvent: vi.fn() }));

const ruler = {
  sceneId: "scene-1",
  membershipId: "author",
  displayName: "Author",
  points: [
    { x: 0, y: 0 },
    { x: 64, y: 0 },
  ],
  distance: 1,
};

let rulers: RulerItem[] = [];

function Harness({ receive }: { receive: (value: RulerItem[]) => void }) {
  const [state, setRulers] = useState<RulerItem[]>([]);
  receive(state);
  useGameSocketSubscriptions({
    campaignId: "campaign-1",
    authRequired: false,
    viewedSceneId: "scene-1",
    loadStoryPosts: async () => undefined,
    setSnapshot: vi.fn(),
    setPings: vi.fn(),
    setRulers,
    setCursors: vi.fn(),
    setRollToasts: vi.fn(),
    setPresence: vi.fn(),
    setError: vi.fn(),
    knownChatMessageIdsRef: { current: new Set() },
    activeChatThreadIdRef: { current: null },
    chatOpenRef: { current: false },
  });
  return null;
}

async function reconnect(recovered: boolean | undefined) {
  await act(async () => {
    fake.fire("disconnect", "transport close");
    fake.socket.recovered = recovered;
    fake.fire("connect");
  });
}

beforeEach(() => {
  fake.reset();
  rulers = [];
});

describe("UIX-682 C20 ruler state across reconnect", () => {
  it("drops a remote ruler whose clear may have been missed by a fresh session", async () => {
    renderComponent(<Harness receive={(value) => (rulers = value)} />);
    await act(async () => fake.fire("connect"));
    await act(async () => fake.fire("ruler:updated", ruler));
    expect(rulers).toEqual([ruler]);

    await reconnect(undefined);

    expect(rulers).toEqual([]);
  });

  it("keeps rulers on a recovered session, where missed events are replayed", async () => {
    renderComponent(<Harness receive={(value) => (rulers = value)} />);
    await act(async () => fake.fire("connect"));
    await act(async () => fake.fire("ruler:updated", ruler));

    await reconnect(true);
    expect(rulers).toEqual([ruler]);

    await act(async () =>
      fake.fire("ruler:cleared", {
        sceneId: ruler.sceneId,
        membershipId: ruler.membershipId,
      }),
    );
    expect(rulers).toEqual([]);
  });

  it("still shows a ruler drawn after a fresh reconnect", async () => {
    renderComponent(<Harness receive={(value) => (rulers = value)} />);
    await act(async () => fake.fire("connect"));
    await reconnect(false);

    await act(async () => fake.fire("ruler:updated", ruler));

    expect(rulers).toEqual([ruler]);
  });
});

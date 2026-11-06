// @vitest-environment jsdom
import { useRef, useState } from "react";
import { beforeEach, expect, it, vi } from "vitest";
import type { FogRevealDto, GameSnapshot } from "@arken/contracts";
import { act, renderComponent } from "./test-support/render";
import { gmSnapshot } from "./test-support/game-snapshot-fixtures";
type Listener = (payload?: any) => void;
const fake = vi.hoisted(() => {
  const listeners = new Map<string, Listener[]>();
  const emit = vi.fn();
  const socket = { id: "socket", connected: true, recovered: false,
    on(event: string, fn: Listener) { listeners.set(event, [...(listeners.get(event) ?? []), fn]); return socket; },
    off() { return socket; }, emit, disconnect() { return socket; }, io: { on() {} } };
  return { socket, emit, fire(event: string, payload?: unknown) { for (const fn of listeners.get(event) ?? []) fn(payload); }, reset() { listeners.clear(); emit.mockClear(); } };
});
vi.mock("./realtime", () => ({ createGameSocket: () => fake.socket }));
vi.mock("./api", () => ({ reportClientEvent: vi.fn() }));
const { useGameSocketSubscriptions } = await import("./use-game-socket-subscriptions");
const fog = (id: string): FogRevealDto => ({ id, sceneId: "scene-a", x: 0, y: 0, width: 10, height: 10 } as FogRevealDto);
const noop = () => {};
let observed: GameSnapshot;
function Harness() {
  const [state, setSnapshot] = useState<GameSnapshot | null>(() => gmSnapshot({ snapshotVersion: 100, fogReveals: [] }));
  observed = state!;
  const chatIds = useRef(new Set<string>()), thread = useRef<string | null>(null), open = useRef(false);
  useGameSocketSubscriptions({ campaignId: state?.campaign.id ?? null, initialSnapshotVersion: 100, authRequired: false, viewedSceneId: "scene-a", loadStoryPosts: async () => {}, setSnapshot, setPings: noop, setRulers: noop, setCursors: noop, setRollToasts: noop, setPresence: noop, setError: noop, knownChatMessageIdsRef: chatIds, activeChatThreadIdRef: thread, chatOpenRef: open });
  return null;
}
beforeEach(() => fake.reset());
it("resyncs an overtaken create and accepts canonical state without duplicating it", async () => {
  renderComponent(<Harness />);
  await act(async () => fake.fire("fog:created", { sequence: 99, data: fog("f") }));
  expect(fake.emit).toHaveBeenCalledWith("game:resync", 100);
  expect(observed.fogReveals).toHaveLength(0);
  await act(async () => fake.fire("game:snapshot", gmSnapshot({ snapshotVersion: 100, fogReveals: [fog("f")] })));
  expect(observed.fogReveals.map(f => f.id)).toEqual(["f"]);
  fake.emit.mockClear();
  await act(async () => fake.fire("fog:created", { sequence: 99, data: fog("f") }));
  expect(fake.emit).not.toHaveBeenCalledWith("game:resync", expect.anything());
});
it("resyncs an overtaken removal and takes the canonical deletion", async () => {
  renderComponent(<Harness />);
  await act(async () => fake.fire("fog:created", { sequence: 101, data: fog("f") }));
  await act(async () => fake.fire("fog:removed", { sequence: 100, data: { fogRevealId: "f" } }));
  expect(fake.emit).toHaveBeenCalledWith("game:resync", 101);
  await act(async () => fake.fire("game:snapshot", gmSnapshot({ snapshotVersion: 101, fogReveals: [] })));
  expect(observed.fogReveals).toHaveLength(0);
});

it("ignores a delayed fog event from a scene that is no longer viewed", async () => {
  renderComponent(<Harness />);
  await act(async () => fake.fire("fog:created", { sequence: 101, data: { ...fog("old"), sceneId: "scene-b" } }));
  expect(observed.fogReveals).toHaveLength(0);
  expect(observed.snapshotVersion).toBe(100);
});

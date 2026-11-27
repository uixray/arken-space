// @vitest-environment jsdom
import { useRef, useState } from "react";
import { expect, it, vi } from "vitest";
import type { GameSnapshot } from "@arken/contracts";
import { renderComponent } from "./test-support/render";
import { playerSnapshot } from "./test-support/game-snapshot-fixtures";
import { api } from "./api";
import { useChatActions, type ChatActions } from "./use-chat-actions";
vi.mock("./api", () => ({ api: vi.fn() }));
it.each(["public", "direct"] as const)(
  "reuses a %s message action only until it is confirmed",
  async (kind) => {
    vi.mocked(api)
      .mockReset()
      .mockRejectedValueOnce(new Error("response lost"))
      .mockResolvedValue({ id: "message" } as never);
    let actions!: ChatActions;
    function Harness() {
      const [, setSnapshot] = useState<GameSnapshot | null>(null);
      const snapshotRef = useRef<GameSnapshot | null>(playerSnapshot());
      const knownChatMessageIdsRef = useRef(new Set<string>()),
        activeChatThreadIdRef = useRef<string | null>(null);
      actions = useChatActions({
        run: async (operation) => {
          await operation();
        },
        setSnapshot,
        snapshotRef,
        knownChatMessageIdsRef,
        activeChatThreadIdRef,
      });
      return null;
    }
    renderComponent(<Harness />);
    const send = () =>
      kind === "public"
        ? actions.onChat("текст", "PUBLIC", "TABLE")
        : actions.onDirectChat("thread", "текст", []);
    await expect(send()).rejects.toThrow("response lost");
    await send();
    await send();
    const bodies = vi
      .mocked(api)
      .mock.calls.map((call) => JSON.parse(String(call[1]?.body)));
    expect(bodies[1].actionId).toBe(bodies[0].actionId);
    expect(bodies[2].actionId).not.toBe(bodies[1].actionId);
  },
);
it("does not merge two intentionally separate sends while the first is pending", async () => {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  vi.mocked(api)
    .mockReset()
    .mockImplementationOnce(async () => {
      await gate;
      return {} as never;
    })
    .mockResolvedValue({} as never);
  let actions!: ChatActions;
  function Harness() {
    const [, setSnapshot] = useState<GameSnapshot | null>(null);
    const snapshotRef = useRef<GameSnapshot | null>(playerSnapshot());
    const knownChatMessageIdsRef = useRef(new Set<string>()),
      activeChatThreadIdRef = useRef<string | null>(null);
    actions = useChatActions({
      run: async (operation) => {
        await operation();
      },
      setSnapshot,
      snapshotRef,
      knownChatMessageIdsRef,
      activeChatThreadIdRef,
    });
    return null;
  }
  renderComponent(<Harness />);
  const first = actions.onChat("одинаковый текст", "PUBLIC", "TABLE");
  await actions.onChat("одинаковый текст", "PUBLIC", "TABLE");
  const bodies = vi
    .mocked(api)
    .mock.calls.map((call) => JSON.parse(String(call[1]?.body)));
  expect(bodies[0].actionId).not.toBe(bodies[1].actionId);
  release();
  await first;
});

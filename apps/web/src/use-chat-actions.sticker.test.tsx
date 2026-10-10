// @vitest-environment jsdom
import { useRef, useState } from "react";
import { afterEach, expect, it, vi } from "vitest";
import type { GameSnapshot } from "@arken/contracts";
import {
  fireEvent,
  renderComponent,
  screen,
  waitFor,
} from "./test-support/render";
import { api } from "./api";
import { useChatActions } from "./use-chat-actions";

vi.mock("./api", () => ({ api: vi.fn() }));
afterEach(() => vi.clearAllMocks());

function Harness() {
  const [, setSnapshot] = useState<GameSnapshot | null>(null);
  const snapshotRef = useRef<GameSnapshot | null>(null);
  const knownChatMessageIdsRef = useRef(new Set<string>());
  const activeChatThreadIdRef = useRef<string | null>(null);
  const actions = useChatActions({
    run: async (action) => {
      await action();
    },
    setSnapshot,
    snapshotRef,
    knownChatMessageIdsRef,
    activeChatThreadIdRef,
  });
  return (
    <>
      <button
        onClick={() =>
          void actions.onSticker({ stream: "TABLE" }, "campaign-id")
        }
      >
        campaign
      </button>
      <button
        onClick={() =>
          void actions.onSticker(
            { threadId: "thread-id" },
            "global-id",
            "GLOBAL_PUBLIC",
          )
        }
      >
        global
      </button>
    </>
  );
}

it("posts global sticker references without changing legacy campaign payloads", async () => {
  vi.mocked(api).mockResolvedValue({ id: "message-1" } as never);
  renderComponent(<Harness />);
  fireEvent.click(screen.getByRole("button", { name: "campaign" }));
  await waitFor(() => expect(api).toHaveBeenCalledTimes(1));
  const campaignBody = JSON.parse(
    String(vi.mocked(api).mock.calls[0]![1]?.body),
  );
  expect(campaignBody).toMatchObject({
    stickerId: "campaign-id",
    stream: "TABLE",
  });
  expect(campaignBody).not.toHaveProperty("scope");

  fireEvent.click(screen.getByRole("button", { name: "global" }));
  await waitFor(() => expect(api).toHaveBeenCalledTimes(2));
  const globalBody = JSON.parse(String(vi.mocked(api).mock.calls[1]![1]?.body));
  expect(globalBody).toMatchObject({
    scope: "GLOBAL",
    globalStickerId: "global-id",
    threadId: "thread-id",
  });
  expect(globalBody).not.toHaveProperty("stickerId");
});

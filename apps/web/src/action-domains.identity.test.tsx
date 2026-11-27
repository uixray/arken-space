// @vitest-environment jsdom
import { useRef, useState } from "react";
import { expect, it, vi } from "vitest";
import { renderComponent, screen, userEvent } from "./test-support/render";
import { useAccessActions } from "./use-access-actions";
import { usePlayerRequestActions } from "./use-player-request-actions";
import { useStoryActions } from "./use-story-actions";

it("keeps access, requests and story actions stable while reading the latest story cursor", async () => {
  const seen: Array<{
    access: ReturnType<typeof useAccessActions>;
    requests: ReturnType<typeof usePlayerRequestActions>;
    story: ReturnType<typeof useStoryActions>;
  }> = [];
  const run = vi.fn(async () => {}),
    load = vi.fn(async () => {}),
    open = vi.fn(),
    loadStory = vi.fn(async (_cursor?: string) => {}),
    selectEra = vi.fn(async (_era: string | null) => {});
  function Harness() {
    const [tick, setTick] = useState(0),
      [, setSnapshot] = useState(null);
    const cursor = useRef<string | null>(null);
    cursor.current = tick ? "next-page" : null;
    const access = useAccessActions({ run });
    const requests = usePlayerRequestActions({
      setSnapshot: setSnapshot as never,
      load,
      openPlayerRequests: open,
    });
    const story = useStoryActions({
      loadStoryPosts: loadStory,
      storyNextCursorRef: cursor,
      selectStoryEra: selectEra,
    });
    seen.push({ access, requests, story });
    return <button onClick={() => setTick(tick + 1)}>Обновить</button>;
  }
  renderComponent(<Harness />);
  await userEvent.click(screen.getByRole("button", { name: "Обновить" }));
  expect(seen.length).toBeGreaterThanOrEqual(2);
  expect(seen.at(-1)?.access).toBe(seen[0]?.access);
  expect(seen.at(-1)?.requests).toBe(seen[0]?.requests);
  expect(seen.at(-1)?.story).toBe(seen[0]?.story);
  await seen[0]!.story.onLoadMoreStoryPosts();
  expect(loadStory).toHaveBeenCalledWith("next-page");
});

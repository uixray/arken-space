// @vitest-environment jsdom
import { expect, it, vi } from "vitest";
import type { StoryPostAdminDto } from "@arken/contracts";
import type { StoryDraftInput } from "./StoryChannel";
import { renderComponent } from "./test-support/render";
import { useStoryActions, type StoryActions } from "./use-story-actions";

const { api } = vi.hoisted(() => ({ api: vi.fn() }));
vi.mock("./api", () => ({ api }));

it("reads the advancing cursor without re-creating actions and sends reviewed story fields and revisions", async () => {
  const cursor = { current: "page-a" as string | null };
  const loadStoryPosts = vi.fn(async (_cursor?: string) => {});
  const selectStoryEra = vi.fn(async (_era: string | null) => {});
  const seen: StoryActions[] = [];
  function Harness({ epoch }: { epoch: number }) {
    seen.push(
      useStoryActions({
        loadStoryPosts,
        storyNextCursorRef: cursor,
        selectStoryEra,
      }),
    );
    return <output>{epoch}</output>;
  }
  const { rerender } = renderComponent(<Harness epoch={0} />);
  const actions = seen[0]!;
  await actions.onLoadMoreStoryPosts();
  cursor.current = "page-b";
  rerender(<Harness epoch={1} />);
  expect(seen[1]).toBe(actions);
  for (const key of Object.keys(actions) as Array<keyof StoryActions>) {
    expect(typeof seen[1]![key]).toBe("function");
    expect(seen[1]![key]).toBe(actions[key]);
  }
  await actions.onLoadMoreStoryPosts();
  cursor.current = null;
  await actions.onLoadMoreStoryPosts();
  expect(loadStoryPosts.mock.calls).toEqual([["page-a"], ["page-b"]]);

  const draft: StoryDraftInput = {
    title: "Synthetic chronicle",
    body: "A gate opens.",
    gmNotes: "GM note",
    worldDay: 8,
    era: null,
    entityLinks: [],
    media: [
      {
        contentId: "synthetic-media",
        order: 0,
        altText: "Gate",
        caption: "North",
      },
    ],
  };
  const post = { id: "draft-post", revision: 7 } as StoryPostAdminDto;
  api.mockResolvedValue(undefined);
  await actions.onCreateStoryDraft(draft);
  await actions.onUpdateStoryPost(post, { ...draft, era: "New era" });
  await actions.onPublishStoryPost(post);
  await actions.onArchiveStoryPost({ ...post, revision: 8 });
  await actions.onCreateStoryFromEvent(42);

  const actionIds = new Set<string>();
  expect(
    api.mock.calls.map(([path, request]) => {
      const { actionId, ...body } = JSON.parse(request.body);
      expect(actionId).toMatch(/^[0-9a-f-]{36}$/i);
      actionIds.add(actionId);
      return [path, request.method, body];
    }),
  ).toEqual([
    ["/api/story/posts", "POST", draft],
    [
      "/api/story/posts/draft-post",
      "PATCH",
      { ...draft, era: "New era", revision: 7 },
    ],
    ["/api/story/posts/draft-post/publish", "POST", { revision: 7 }],
    ["/api/story/posts/draft-post/archive", "POST", { revision: 8 }],
    ["/api/story/posts/from-event", "POST", { eventSequence: 42 }],
  ]);
  expect(actionIds.size).toBe(5);
  expect(loadStoryPosts.mock.calls.slice(2)).toEqual([[], [], [], [], []]);
  api.mockRejectedValueOnce(new Error("synthetic save failure"));
  await expect(actions.onPublishStoryPost(post)).rejects.toThrow(
    "synthetic save failure",
  );
  expect(loadStoryPosts).toHaveBeenCalledTimes(7);
  api.mockClear();
  api
    .mockResolvedValueOnce({ sources: [] })
    .mockResolvedValueOnce({ targets: [] })
    .mockResolvedValueOnce({ targets: [] });
  await actions.onSelectStoryEra("Current era");
  await actions.onSelectStoryEra(null);
  expect(selectStoryEra.mock.calls).toEqual([["Current era"], [null]]);
  await expect(actions.onLoadStoryEventSources()).resolves.toEqual([]);
  await expect(
    actions.onSearchStoryLinkTargets("north & south"),
  ).resolves.toEqual([]);
  await expect(actions.onSearchStoryLinkTargets("")).resolves.toEqual([]);
  expect(api.mock.calls).toEqual([
    ["/api/story/event-sources"],
    ["/api/story/link-targets?q=north%20%26%20south"],
    ["/api/story/link-targets"],
  ]);
  expect(loadStoryPosts).toHaveBeenCalledTimes(7);
});

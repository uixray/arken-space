import { useMemo, type MutableRefObject } from "react";
import { api } from "./api";
import type { Props as SidebarProps } from "./Sidebar";

/**
 * UIX-398 — GM story-channel commands.
 *
 * The one handler here that needs the latest-value ref is `onLoadMoreStoryPosts`:
 * the pagination cursor is state that advances with every page, so a handler
 * closing over it would go stale after the first "load more" and keep
 * refetching the same page. The rest take everything they need as arguments.
 *
 * These deliberately bypass `run`. Story writes refresh the story list rather
 * than the game snapshot — they are a separate feed, not campaign state — and
 * routing them through `run(action, true)` would rebuild the whole snapshot
 * for a post that does not appear in it.
 */
export type StoryActions = Pick<
  SidebarProps,
  | "onLoadMoreStoryPosts"
  | "onCreateStoryDraft"
  | "onUpdateStoryPost"
  | "onPublishStoryPost"
  | "onArchiveStoryPost"
>;

const withAction = (body: Record<string, unknown> = {}) =>
  JSON.stringify({ ...body, actionId: crypto.randomUUID() });

export function useStoryActions(dependencies: {
  /** Stable — `useCallback` with an empty dependency list in App. */
  loadStoryPosts: (cursor?: string) => Promise<void>;
  storyNextCursorRef: MutableRefObject<string | null>;
}): StoryActions {
  const { loadStoryPosts, storyNextCursorRef } = dependencies;

  return useMemo<StoryActions>(
    () => ({
      onLoadMoreStoryPosts: async () => {
        const cursor = storyNextCursorRef.current;
        if (cursor) await loadStoryPosts(cursor);
      },

      onCreateStoryDraft: async (input) => {
        await api("/api/story/posts", {
          method: "POST",
          body: withAction({ ...input }),
        });
        await loadStoryPosts();
      },

      onUpdateStoryPost: async (post, input) => {
        await api(`/api/story/posts/${post.id}`, {
          method: "PATCH",
          body: withAction({ ...input, revision: post.revision }),
        });
        await loadStoryPosts();
      },

      onPublishStoryPost: async (post) => {
        await api(`/api/story/posts/${post.id}/publish`, {
          method: "POST",
          body: withAction({ revision: post.revision }),
        });
        await loadStoryPosts();
      },

      onArchiveStoryPost: async (post) => {
        await api(`/api/story/posts/${post.id}/archive`, {
          method: "POST",
          body: withAction({ revision: post.revision }),
        });
        await loadStoryPosts();
      },
    }),
    [loadStoryPosts, storyNextCursorRef],
  );
}

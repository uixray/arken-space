// @vitest-environment jsdom
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { useLayoutEffect } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  usePlayerThemePreference,
  type PlayerThemePreference,
} from "./usePlayerThemePreference";

const forest: PlayerThemePreference = {
  selectedThemeId: null,
  defaultThemeId: "forest",
  revision: 1,
};
const published = ["forest", "ice", "gold"];
afterEach(cleanup);

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe("usePlayerThemePreference", () => {
  it("previews, saves an explicit system choice, and resets only after null is saved", async () => {
    const save = vi.fn(
      async (selection: string | null): Promise<PlayerThemePreference> => ({
        selectedThemeId: selection,
        defaultThemeId: "forest",
        revision: selection === null ? 3 : 2,
      }),
    );
    const { result } = renderHook((input) => usePlayerThemePreference(input), {
      initialProps: {
        scopeKey: "membership-a",
        preference: forest,
        publishedThemeIds: published,
        save,
      },
    });

    act(() => result.current.preview("system"));
    expect(result.current.selection).toBe("system");
    await act(() => result.current.apply());
    expect(save).toHaveBeenLastCalledWith(
      "system",
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
    expect(result.current.preference?.selectedThemeId).toBe("system");

    const reset = deferred<PlayerThemePreference>();
    save.mockImplementationOnce(() => reset.promise);
    await act(async () => {
      void result.current.reset();
    });
    expect(result.current.selection).toBe("system");
    await act(async () => reset.resolve({ ...forest, revision: 3 }));
    expect(result.current.selection).toBe("forest");
    expect(result.current.preference?.selectedThemeId).toBeNull();
  });

  it("keeps a failed draft/preview across a same-scope canonical update and ignores an older bootstrap", async () => {
    const failure = new Error("network");
    const save = vi.fn(() => Promise.reject(failure));
    const { result, rerender } = renderHook(
      (input) => usePlayerThemePreference(input),
      {
        initialProps: {
          scopeKey: "membership-a",
          preference: forest,
          publishedThemeIds: published,
          save,
        },
      },
    );
    act(() => result.current.preview("ice"));
    await act(() => result.current.apply());
    expect(result.current.selection).toBe("ice");
    expect(result.current.error).toBe("network");
    rerender({
      scopeKey: "membership-a",
      preference: {
        selectedThemeId: "gold",
        defaultThemeId: "forest",
        revision: 2,
      },
      publishedThemeIds: published,
      save,
    });
    expect(result.current.selection).toBe("ice");
    expect(result.current.preference?.revision).toBe(2);
    rerender({
      scopeKey: "membership-a",
      preference: {
        selectedThemeId: "gold",
        defaultThemeId: "forest",
        revision: 0,
      },
      publishedThemeIds: published,
      save,
    });
    expect(result.current.selection).toBe("ice");
    expect(result.current.preference?.revision).toBe(2);
  });

  it("uses system for a removed explicit selection instead of falling through to the default", () => {
    const save = vi.fn();
    const { result } = renderHook((input) => usePlayerThemePreference(input), {
      initialProps: {
        scopeKey: "membership-a",
        preference: {
          selectedThemeId: "removed",
          defaultThemeId: "forest",
          revision: 1,
        },
        publishedThemeIds: published,
        save,
      },
    });
    expect(result.current.selection).toBe("system");
  });

  it("aborts and ignores a late request across scope changes, including A-B-A, and clears immediately on auth loss", async () => {
    const first = deferred<PlayerThemePreference>();
    const save = vi.fn(
      (_selection: string | null, _options: { signal: AbortSignal }) =>
        first.promise,
    );
    const { result, rerender } = renderHook(
      (input) => usePlayerThemePreference(input),
      {
        initialProps: {
          scopeKey: "A" as string | null,
          preference: forest,
          publishedThemeIds: published,
          save,
        },
      },
    );
    act(() => result.current.preview("ice"));
    await act(async () => {
      void result.current.apply();
    });
    rerender({
      scopeKey: "B",
      preference: { ...forest, defaultThemeId: "gold" },
      publishedThemeIds: published,
      save,
    });
    rerender({
      scopeKey: "A",
      preference: forest,
      publishedThemeIds: published,
      save,
    });
    await act(async () =>
      first.resolve({
        selectedThemeId: "ice",
        defaultThemeId: "forest",
        revision: 2,
      }),
    );
    expect(result.current.selection).toBe("forest");
    expect(result.current.preference?.revision).toBe(1);
    rerender({
      scopeKey: null,
      preference: forest,
      publishedThemeIds: published,
      save,
    });
    expect(result.current.selection).toBe("system");
    expect(result.current.preference).toBeNull();
    await waitFor(() =>
      expect(save.mock.calls[0]?.[1].signal.aborted).toBe(true),
    );
  });

  it("shows the incoming scope in the first committed layout and clamps a preview removed from the catalogue", async () => {
    const layouts: { scope: string; selection: string }[] = [];
    const save = vi.fn(async (selection: string | null) => ({
      selectedThemeId: selection,
      defaultThemeId: "gold",
      revision: 2,
    }));
    const { result, rerender } = renderHook(
      (input) => {
        const view = usePlayerThemePreference(input);
        useLayoutEffect(() => {
          layouts.push({ scope: input.scopeKey, selection: view.selection });
        });
        return view;
      },
      {
        initialProps: {
          scopeKey: "A",
          preference: forest,
          publishedThemeIds: published,
          save,
        },
      },
    );
    rerender({
      scopeKey: "B",
      preference: {
        selectedThemeId: null,
        defaultThemeId: "gold",
        revision: 1,
      },
      publishedThemeIds: published,
      save,
    });
    expect(result.current.selection).toBe("gold");
    expect(result.current.preference?.defaultThemeId).toBe("gold");
    expect(
      layouts
        .filter(({ scope }) => scope === "B")
        .map(({ selection }) => selection),
    ).not.toContain("forest");
    act(() => result.current.preview("ice"));
    rerender({
      scopeKey: "B",
      preference: {
        selectedThemeId: null,
        defaultThemeId: "gold",
        revision: 1,
      },
      publishedThemeIds: ["forest", "gold"],
      save,
    });
    expect(result.current.selection).toBe("system");
    await act(() => result.current.apply());
    expect(save).toHaveBeenCalledWith("system", expect.anything());
  });

  it("deduplicates a same-tick apply and cannot let an old save overwrite newer canonical state", async () => {
    const oldSave = deferred<PlayerThemePreference>();
    const save = vi.fn(() => oldSave.promise);
    const { result, rerender } = renderHook(
      (input) => usePlayerThemePreference(input),
      {
        initialProps: {
          scopeKey: "A",
          preference: forest,
          publishedThemeIds: published,
          save,
        },
      },
    );
    act(() => {
      result.current.preview("ice");
      void result.current.apply();
      void result.current.apply();
    });
    expect(save).toHaveBeenCalledTimes(1);
    rerender({
      scopeKey: "A",
      preference: {
        selectedThemeId: "gold",
        defaultThemeId: "forest",
        revision: 3,
      },
      publishedThemeIds: published,
      save,
    });
    await act(async () =>
      oldSave.resolve({
        selectedThemeId: "ice",
        defaultThemeId: "forest",
        revision: 2,
      }),
    );
    expect(result.current.preference?.revision).toBe(3);
    expect(result.current.selection).toBe("ice");
  });

  it("aborts a pending save on unmount", async () => {
    const pending = deferred<PlayerThemePreference>();
    const save = vi.fn(
      (_selection: string | null, _options: { signal: AbortSignal }) =>
        pending.promise,
    );
    const { result, unmount } = renderHook(
      (input) => usePlayerThemePreference(input),
      {
        initialProps: {
          scopeKey: "A",
          preference: forest,
          publishedThemeIds: published,
          save,
        },
      },
    );
    act(() => {
      result.current.preview("ice");
      void result.current.apply();
    });
    const options = save.mock.calls[0]?.[1];
    unmount();
    expect(options?.signal.aborted).toBe(true);
  });

  it("accepts an idempotent reset at the same canonical revision", async () => {
    const save = vi.fn(async () => forest);
    const { result } = renderHook(() =>
      usePlayerThemePreference({
        scopeKey: "A",
        preference: forest,
        publishedThemeIds: published,
        save,
      }),
    );
    act(() => result.current.preview("ice"));
    await act(() => result.current.reset());
    expect(save).toHaveBeenCalledWith(null, expect.anything());
    expect(result.current.selection).toBe("forest");
    expect(result.current.preference).toEqual(forest);
  });
});

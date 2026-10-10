// @vitest-environment jsdom
import { act, renderHook } from "@testing-library/react";
import type { CharacterDto, GameSnapshot } from "@arken/contracts";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError, api } from "./api";
import { gmSnapshot } from "./test-support/game-snapshot-fixtures";
import { useCharacterActions } from "./use-character-actions";

vi.mock("./api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./api")>();
  return { ...actual, api: vi.fn() };
});

function character(id: string, revision = 408, gold = 0): CharacterDto {
  return {
    id,
    name: id,
    ownerMembershipId: null,
    controllerMembershipIds: [],
    portraitAssetId: null,
    stats: {},
    skills: [],
    spells: [],
    notes: "",
    backstory: "",
    inventory: [],
    resources: {},
    wallet: { gold, silver: 0, copper: 0, sp: 0 },
    entries: [],
    revision,
    lifecycle: "ACTIVE",
    archivedAt: null,
    archivedByMembershipId: null,
  };
}

function setup(characters: CharacterDto[]) {
  const snapshotRef = {
    current: gmSnapshot({ characters }) as GameSnapshot | null,
  };
  const queuesRef = {
    current: new Map<string, Promise<CharacterDto | undefined>>(),
  };
  const setSnapshot = vi.fn(
    (
      next:
        | GameSnapshot
        | null
        | ((current: GameSnapshot | null) => GameSnapshot | null),
    ) => {
      snapshotRef.current =
        typeof next === "function"
          ? (next(snapshotRef.current) ?? snapshotRef.current)
          : (next ?? snapshotRef.current);
    },
  );
  const setError = vi.fn();
  const hook = renderHook(() =>
    useCharacterActions({ snapshotRef, queuesRef, setSnapshot, setError }),
  );
  return { ...hook, snapshotRef, queuesRef, setSnapshot, setError };
}

function requestBody(callIndex: number) {
  const [, options] = vi.mocked(api).mock.calls[callIndex]!;
  const body = options?.body;
  if (typeof body !== "string") {
    throw new Error(`Expected string request body at API call ${callIndex}`);
  }
  return JSON.parse(body) as Record<string, unknown>;
}

beforeEach(() => vi.mocked(api).mockReset());

describe("useCharacterActions production paths", () => {
  it("keeps its function-only action interface stable across rerenders and latest snapshots", () => {
    const { result, rerender, snapshotRef } = setup([character("hero")]);
    const first = result.current;
    expect(
      Object.values(first).every((action) => typeof action === "function"),
    ).toBe(true);

    snapshotRef.current = gmSnapshot({ characters: [character("hero", 409)] });
    rerender();

    expect(result.current).toBe(first);
  });

  it("serializes same-character patch and counter writes against the latest revision", async () => {
    const initial = character("hero");
    vi.mocked(api)
      .mockResolvedValueOnce({ ...initial, name: "Renamed", revision: 409 })
      .mockResolvedValueOnce({
        ...initial,
        name: "Renamed",
        revision: 410,
        wallet: { gold: 1, silver: 0, copper: 0, sp: 0 },
      });
    const { result, snapshotRef } = setup([initial]);

    await act(async () => {
      const patch = result.current.patchCharacter("hero", { name: "Renamed" });
      const counter = result.current.updateCharacterCounters(
        "hero",
        408,
        {},
        { walletDelta: { gold: 1 } },
      );
      await Promise.all([patch, counter]);
    });

    expect(vi.mocked(api).mock.calls.map(([url]) => url)).toEqual([
      "/api/characters/hero",
      "/api/characters/hero/counters",
    ]);
    expect(requestBody(0).revision).toBe(408);
    expect(requestBody(1)).toMatchObject({
      revision: 409,
      wallet: { gold: 1 },
    });
    expect(snapshotRef.current?.characters[0]?.revision).toBe(410);
  });

  it("rebases and retries a counter delta once on a conflict using refreshed canonical state", async () => {
    const initial = character("hero");
    const refreshedCharacter = character("hero", 409, 10);
    const refreshedSnapshot = gmSnapshot({ characters: [refreshedCharacter] });
    vi.mocked(api)
      .mockRejectedValueOnce(
        new ApiError(409, "CHARACTER_CONFLICT", "conflict"),
      )
      .mockResolvedValueOnce(refreshedSnapshot)
      .mockResolvedValueOnce({
        ...refreshedCharacter,
        revision: 410,
        wallet: { gold: 11, silver: 0, copper: 0, sp: 0 },
      });
    const { result } = setup([initial]);

    await act(async () => {
      await result.current.updateCharacterCounters(
        "hero",
        408,
        {},
        { walletDelta: { gold: 1 } },
      );
    });

    expect(requestBody(0).revision).toBe(408);
    expect(vi.mocked(api).mock.calls[1]?.[0]).toBe("/api/bootstrap");
    expect(requestBody(2)).toMatchObject({
      revision: 409,
      wallet: { gold: 11 },
    });
  });

  it("lets separate characters progress independently while one request is pending", async () => {
    let resolveFirst!: (value: unknown) => void;
    const firstResponse = new Promise((resolve) => {
      resolveFirst = resolve;
    });
    vi.mocked(api)
      .mockReturnValueOnce(firstResponse as ReturnType<typeof api>)
      .mockResolvedValueOnce({
        ...character("second"),
        name: "Second updated",
        revision: 409,
      });
    const first = character("first");
    const second = character("second");
    const { result } = setup([first, second]);
    let firstWrite!: Promise<void>;
    let secondWrite!: Promise<void>;

    act(() => {
      firstWrite = result.current.patchCharacter("first", {
        name: "First updated",
      });
      secondWrite = result.current.patchCharacter("second", {
        name: "Second updated",
      });
    });
    await act(async () => {
      await vi.waitFor(() => expect(vi.mocked(api)).toHaveBeenCalledTimes(2));
    });
    expect(vi.mocked(api).mock.calls.map(([url]) => url)).toEqual([
      "/api/characters/first",
      "/api/characters/second",
    ]);
    await act(async () => {
      await secondWrite;
    });

    await act(async () => {
      resolveFirst({ ...first, name: "First updated", revision: 409 });
      await Promise.all([firstWrite, secondWrite]);
    });
  });
});

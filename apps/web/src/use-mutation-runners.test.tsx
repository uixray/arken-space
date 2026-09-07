// @vitest-environment jsdom
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { renderComponent, screen, userEvent } from "./test-support/render";
import {
  useMutationRunners,
  type MutationRunners,
} from "./use-mutation-runners";
import { ApiError } from "./api";

/**
 * UIX-398 step A0. The point of these runners is their *identity*: 45 call
 * sites close over them, so if they change on every render, every handler
 * above them is unstable too and no React.memo below the sidebar can hold.
 * That is a property no type or lint rule enforces, so it is pinned here.
 */
function Harness({
  onRunners,
  load = async () => {},
  onError,
}: {
  onRunners: (runners: MutationRunners) => void;
  load?: () => Promise<void>;
  onError?: (message: string) => void;
}) {
  const [, setError] = useState("");
  const [tick, setTick] = useState(0);
  const runners = useMutationRunners({ load, setError: onError ?? setError });
  onRunners(runners);
  return (
    <button type="button" onClick={() => setTick(tick + 1)}>
      rerender {tick}
    </button>
  );
}

describe("useMutationRunners identity", () => {
  it("keeps every runner identical across unrelated re-renders", async () => {
    const seen: MutationRunners[] = [];
    const load = async () => {};
    renderComponent(
      <Harness load={load} onRunners={(runners) => seen.push(runners)} />,
    );

    await userEvent.click(screen.getByRole("button"));
    await userEvent.click(screen.getByRole("button"));

    expect(seen.length).toBeGreaterThanOrEqual(3);
    const first = seen[0]!;
    for (const runners of seen.slice(1)) {
      expect(runners.run).toBe(first.run);
      expect(runners.runResult).toBe(first.runResult);
      expect(runners.runWorldMapMutation).toBe(first.runWorldMapMutation);
      expect(runners.recoverFromCanvasMutation).toBe(
        first.recoverFromCanvasMutation,
      );
    }
  });
});

describe("useMutationRunners behaviour", () => {
  const collect = async (
    load: () => Promise<void>,
    onError?: (message: string) => void,
  ): Promise<MutationRunners> => {
    let captured: MutationRunners | undefined;
    renderComponent(
      <Harness
        load={load}
        onError={onError}
        onRunners={(runners) => {
          captured = runners;
        }}
      />,
    );
    if (!captured) throw new Error("runners not captured");
    return captured;
  };

  it("refetches only when asked", async () => {
    const load = vi.fn(async () => {});
    const runners = await collect(load);

    await runners.run(async () => {});
    expect(load).not.toHaveBeenCalled();

    await runners.run(async () => {}, true);
    expect(load).toHaveBeenCalledTimes(1);
  });

  it("rebuilds on an unknown failure but not on a conflict", async () => {
    // The UIX-396 stage 1 rule: a 409 is already being corrected by the
    // broadcast, so rebuilding everything is pure cost.
    const load = vi.fn(async () => {});
    const runners = await collect(load);

    await runners.recoverFromCanvasMutation(
      new ApiError(409, "CONFLICT", "conflict"),
    );
    expect(load).not.toHaveBeenCalled();

    await runners.recoverFromCanvasMutation(
      new ApiError(500, "SERVER_ERROR", "boom"),
    );
    expect(load).toHaveBeenCalledTimes(1);
  });

  it("returns the action's value and rethrows failures", async () => {
    const runners = await collect(async () => {});
    await expect(runners.runResult(async () => 42)).resolves.toBe(42);
    await expect(
      runners.runResult(async () => {
        throw new Error("nope");
      }),
    ).rejects.toThrow("nope");
  });

  it("reports default action failures globally and always rethrows", async () => {
    const setError = vi.fn();
    const load = vi.fn(async () => {});
    const runners = await collect(load, setError);
    const failure = new Error("mutation failed");
    await expect(
      runners.run(async () => {
        throw failure;
      }),
    ).rejects.toBe(failure);
    expect(setError.mock.calls).toEqual([[""], ["mutation failed"]]);
    expect(load).not.toHaveBeenCalled();
  });

  it("rethrows caller-owned action failures without clearing or creating global errors", async () => {
    const setError = vi.fn();
    const load = vi.fn(async () => {});
    const runners = await collect(load, setError);
    const failure = new Error("form mutation failed");
    await expect(
      runners.run(
        async () => {
          throw failure;
        },
        true,
        { errorOwner: "caller" },
      ),
    ).rejects.toBe(failure);
    expect(setError).not.toHaveBeenCalled();
    expect(load).not.toHaveBeenCalled();
  });

  it("still reconciles caller-owned successful actions and reports load failures globally", async () => {
    const setError = vi.fn();
    const failure = new Error("snapshot refresh failed");
    const load = vi
      .fn()
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(failure);
    const action = vi.fn().mockResolvedValue(undefined);
    const runners = await collect(load, setError);
    await expect(
      runners.run(action, true, { errorOwner: "caller" }),
    ).resolves.toBeUndefined();
    expect(load).toHaveBeenCalledOnce();
    expect(setError).not.toHaveBeenCalled();
    await expect(
      runners.run(action, true, { errorOwner: "caller" }),
    ).rejects.toBe(failure);
    expect(action).toHaveBeenCalledTimes(2);
    expect(load).toHaveBeenCalledTimes(2);
    expect(setError.mock.calls).toEqual([["snapshot refresh failed"]]);
  });
});

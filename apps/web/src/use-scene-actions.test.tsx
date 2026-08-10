// @vitest-environment jsdom
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { renderComponent, screen, userEvent } from "./test-support/render";
import { useSceneActions, type SceneActions } from "./use-scene-actions";

/**
 * UIX-398 step A1. Same guarantee as the mutation runners: what matters is
 * that these handlers keep their identity across renders, since that is the
 * precondition for React.memo anywhere below the sidebar. Six inline arrows
 * used to be rebuilt on every render here.
 */
function Harness({
  onActions,
  run = async () => {},
}: {
  onActions: (actions: SceneActions) => void;
  run?: (action: () => Promise<unknown>, refresh?: boolean) => Promise<void>;
}) {
  const [tick, setTick] = useState(0);
  const [, setViewedSceneId] = useState<string | null>(null);
  const actions = useSceneActions({
    run,
    setViewedSceneId: setViewedSceneId as (sceneId: string) => void,
  });
  onActions(actions);
  return (
    <button type="button" onClick={() => setTick(tick + 1)}>
      rerender {tick}
    </button>
  );
}

describe("useSceneActions identity", () => {
  it("keeps the action object and every handler identical across re-renders", async () => {
    const seen: SceneActions[] = [];
    const run = async () => {};
    renderComponent(<Harness run={run} onActions={(a) => seen.push(a)} />);

    await userEvent.click(screen.getByRole("button"));
    await userEvent.click(screen.getByRole("button"));

    expect(seen.length).toBeGreaterThanOrEqual(3);
    const first = seen[0]!;
    for (const actions of seen.slice(1)) {
      // The object itself must be stable too: a fresh object each render
      // would defeat memo just as thoroughly as fresh functions.
      expect(actions).toBe(first);
    }
  });
});

describe("useSceneActions behaviour", () => {
  const capture = (
    run: (action: () => Promise<unknown>, refresh?: boolean) => Promise<void>,
  ) => {
    let actions: SceneActions | undefined;
    renderComponent(
      <Harness
        run={run}
        onActions={(value) => {
          actions = value;
        }}
      />,
    );
    if (!actions) throw new Error("actions not captured");
    return actions;
  };

  it("refetches the snapshot for writes that change scene composition", async () => {
    // Activating a scene is broadcast, so it does not need the refetch that
    // creating or reshaping one does — preserving the original behaviour.
    const calls: (boolean | undefined)[] = [];
    const run = vi.fn(
      async (_action: () => Promise<unknown>, refresh?: boolean) => {
        calls.push(refresh);
      },
    );
    const actions = capture(run);

    await actions.onCreateScene("Tavern");
    await actions.onAssignMap("scene-1", "asset-1");
    await actions.onActivateScene("scene-1");
    await actions.onRenameScene("scene-1", 3, "Cellar");

    expect(calls).toEqual([true, true, undefined, undefined]);
  });

  it("creates a scene when given none, and patches the existing one otherwise", async () => {
    const performed: unknown[] = [];
    const run = vi.fn(async (action: () => Promise<unknown>) => {
      performed.push(action);
    });
    const actions = capture(run);

    await actions.onSaveScene(null, { name: "New" } as never);
    await actions.onSaveScene(
      { id: "scene-1", revision: 2 } as never,
      { name: "Renamed" } as never,
    );

    expect(performed).toHaveLength(2);
  });
});

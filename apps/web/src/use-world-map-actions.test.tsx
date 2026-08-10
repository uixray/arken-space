// @vitest-environment jsdom
import { useState } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderComponent, screen, userEvent } from "./test-support/render";

const apiMock = vi.hoisted(() => vi.fn());
vi.mock("./api", () => ({ api: apiMock }));

const { useWorldMapActions } = await import("./use-world-map-actions");
type WorldMapActions = ReturnType<typeof useWorldMapActions>;

/**
 * UIX-398 step A2. Identity is the point, as with the other domains — but
 * this extraction also folded fourteen hand-written request bodies into a
 * shared `withAction` helper, so the request each handler produces is pinned
 * too: a refactor that quietly changed a URL, a method or a body field would
 * otherwise only surface in production.
 */
// Defined outside the component on purpose: as default parameter values these
// would be new functions on every render, invalidating the memo and making the
// hook look unstable when the harness is what's unstable. That is precisely
// the failure mode this whole refactor exists to remove, so it is worth not
// reintroducing it in the test.
const passthroughRun = async (action: () => Promise<unknown>) => {
  await action();
};
const passthroughRunResult = <T,>(action: () => Promise<T>) => action();

function Harness({
  onActions,
  runWorldMapMutation = passthroughRun,
}: {
  onActions: (actions: WorldMapActions) => void;
  runWorldMapMutation?: (action: () => Promise<unknown>) => Promise<void>;
}) {
  const [tick, setTick] = useState(0);
  const actions = useWorldMapActions({
    runWorldMapMutation,
    runResult: passthroughRunResult,
  });
  onActions(actions);
  return (
    <button type="button" onClick={() => setTick(tick + 1)}>
      rerender {tick}
    </button>
  );
}

function capture() {
  let actions: WorldMapActions | undefined;
  renderComponent(
    <Harness
      onActions={(value) => {
        actions = value;
      }}
    />,
  );
  if (!actions) throw new Error("actions not captured");
  return actions;
}

beforeEach(() => apiMock.mockReset());

describe("useWorldMapActions identity", () => {
  it("keeps the action object identical across re-renders", async () => {
    const seen: WorldMapActions[] = [];
    renderComponent(<Harness onActions={(a) => seen.push(a)} />);
    await userEvent.click(screen.getByRole("button"));
    await userEvent.click(screen.getByRole("button"));
    expect(seen.length).toBeGreaterThanOrEqual(3);
    for (const actions of seen.slice(1)) expect(actions).toBe(seen[0]);
  });
});

describe("useWorldMapActions requests", () => {
  const bodyOf = (call: number) =>
    JSON.parse(String(apiMock.mock.calls[call]?.[1]?.body ?? "{}")) as Record<
      string,
      unknown
    >;

  it("sends the revision every lifecycle transition is gated on", async () => {
    const actions = capture();
    const map = { id: "map-1", revision: 4 } as never;

    await actions.onPublishWorldMap(map);
    expect(apiMock).toHaveBeenCalledWith(
      "/api/world-maps/map-1/publish",
      expect.objectContaining({ method: "POST" }),
    );
    expect(bodyOf(0)).toMatchObject({ revision: 4 });
    expect(bodyOf(0).actionId).toEqual(expect.any(String));
  });

  it("keeps character archive and restore on their own endpoints", async () => {
    const actions = capture();
    const character = { id: "char-1", revision: 2 } as never;

    await actions.onArchiveCharacter(character);
    await actions.onRestoreCharacter(character);

    expect(apiMock.mock.calls[0]?.[0]).toBe("/api/characters/char-1/archive");
    expect(apiMock.mock.calls[1]?.[0]).toBe("/api/characters/char-1/restore");
    expect(bodyOf(1)).toMatchObject({ revision: 2 });
  });

  it("preserves the caller's fields when spreading an input object", async () => {
    const actions = capture();
    await actions.onCreateWorldMapLocation({
      mapId: "map-1",
      name: "Gate",
    } as never);
    expect(bodyOf(0)).toMatchObject({ mapId: "map-1", name: "Gate" });
  });

  it("distinguishes linking a scene from unlinking it by method alone", async () => {
    const actions = capture();
    const location = { id: "loc-1" } as never;

    await actions.onLinkWorldMapLocationScene(location, "scene-9");
    await actions.onUnlinkWorldMapLocationScene(location, "scene-9");

    expect(apiMock.mock.calls[0]?.[0]).toBe(
      "/api/world-maps/locations/loc-1/scenes/scene-9",
    );
    expect(apiMock.mock.calls[0]?.[1]?.method).toBe("POST");
    expect(apiMock.mock.calls[1]?.[0]).toBe(
      "/api/world-maps/locations/loc-1/scenes/scene-9",
    );
    expect(apiMock.mock.calls[1]?.[1]?.method).toBe("DELETE");
  });

  it("gives every request its own actionId", async () => {
    // Reusing one would make the server dedupe a genuinely new command.
    const actions = capture();
    const map = { id: "map-1", revision: 1 } as never;
    await actions.onPublishWorldMap(map);
    await actions.onPublishWorldMap(map);
    expect(bodyOf(0).actionId).not.toBe(bodyOf(1).actionId);
  });
});

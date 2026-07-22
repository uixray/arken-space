import { describe, expect, it } from "vitest";
import {
  createInitialMapInteractionState,
  createValidatedMapObjectRef,
  mapInteractionReducer,
  type MapInteractionAction,
  type MapInteractionState,
  type MapObjectRef,
} from "./map-interaction";

const token: MapObjectRef = { kind: "token", objectId: "token-1", revision: 3 };
const drawing: MapObjectRef = {
  kind: "drawing",
  objectId: "shape-2",
  revision: 1,
};
const validatedToken = createValidatedMapObjectRef(token)!;
const reduce = (...actions: MapInteractionAction[]) =>
  actions.reduce(mapInteractionReducer, createInitialMapInteractionState());

describe("mapInteractionReducer", () => {
  it("tracks focus and typed selection across blur", () => {
    const selected = reduce({ type: "select", ref: token }, { type: "focus" });
    expect(selected).toMatchObject({ focused: true, selectedObject: token });
    expect(mapInteractionReducer(selected, { type: "blur" })).toMatchObject({
      focused: false,
      selectedObject: token,
    });
  });

  it("queues ordered pan, zoom, and fit viewport intents", () => {
    const state = reduce(
      { type: "pan", delta: { x: 10, y: -4 } },
      { type: "zoom", factor: 1.25, anchor: { x: 100, y: 50 } },
      { type: "fit" },
    );
    expect(state.commands.map(({ id: _id, ...command }) => command)).toEqual([
      { type: "viewport", intent: { type: "pan", delta: { x: 10, y: -4 } } },
      {
        type: "viewport",
        intent: { type: "zoom", factor: 1.25, anchor: { x: 100, y: 50 } },
      },
      { type: "viewport", intent: { type: "fit" } },
    ]);
    expect(
      mapInteractionReducer(state, { type: "consume-command", id: 2 }).commands,
    ).toHaveLength(2);
  });

  it.each([
    { type: "pan", delta: { x: Number.NaN, y: 0 } },
    { type: "pan", delta: { x: 0, y: Number.POSITIVE_INFINITY } },
    { type: "zoom", factor: 0, anchor: { x: 0, y: 0 } },
    { type: "zoom", factor: -1, anchor: { x: 0, y: 0 } },
    { type: "zoom", factor: 17, anchor: { x: 0, y: 0 } },
    { type: "zoom", factor: 1, anchor: { x: Number.NaN, y: 0 } },
  ] as MapInteractionAction[])(
    "rejects unsafe viewport intent %#",
    (action) => {
      const initial = createInitialMapInteractionState();
      expect(mapInteractionReducer(initial, action)).toBe(initial);
    },
  );

  it("coordinates typed selection, object list, and object menu", () => {
    const listed = reduce(
      { type: "select", ref: token },
      { type: "open-object-list" },
    );
    const menu = mapInteractionReducer(listed, {
      type: "open-object-menu",
      ref: drawing,
      position: { x: 12, y: 18 },
    });
    expect(menu).toMatchObject({
      selectedObject: drawing,
      objectListOpen: false,
      objectMenu: { ref: drawing, position: { x: 12, y: 18 } },
    });
  });

  it("creates validated destructive refs only for a bounded contract", () => {
    expect(createValidatedMapObjectRef(token)).toEqual(token);
    expect(createValidatedMapObjectRef({ ...token, objectId: " " })).toBeNull();
    expect(createValidatedMapObjectRef({ ...token, revision: -1 })).toBeNull();
    expect(createValidatedMapObjectRef({ ...token, revision: 1.5 })).toBeNull();
    expect(
      createValidatedMapObjectRef({ ...token, kind: "asset" as "token" }),
    ).toBeNull();
  });

  it("requires a validated ref and preserves its revision in the delete command", () => {
    const requested = reduce({ type: "request-delete", ref: validatedToken });
    expect(
      mapInteractionReducer(requested, { type: "cancel-delete" }).commands,
    ).toEqual([]);
    const confirmed = mapInteractionReducer(requested, {
      type: "confirm-delete",
    });
    expect(confirmed).toMatchObject({
      deleteRequestedFor: null,
      selectedObject: null,
    });
    expect(confirmed.commands).toEqual([
      { id: 1, type: "delete-object", ref: validatedToken },
    ]);
  });

  it("closes only the top layer on each Escape", () => {
    let state: MapInteractionState = {
      ...createInitialMapInteractionState(),
      selectedObject: token,
      objectListOpen: true,
      objectMenu: { ref: token, position: { x: 0, y: 0 } },
      deleteRequestedFor: validatedToken,
    };
    state = mapInteractionReducer(state, { type: "escape" });
    expect(state.deleteRequestedFor).toBeNull();
    state = mapInteractionReducer(state, { type: "escape" });
    expect(state.objectMenu).toBeNull();
    state = mapInteractionReducer(state, { type: "escape" });
    expect(state.objectListOpen).toBe(false);
    state = mapInteractionReducer(state, { type: "escape" });
    expect(state.selectedObject).toBeNull();
    expect(mapInteractionReducer(state, { type: "escape" })).toBe(state);
  });
});

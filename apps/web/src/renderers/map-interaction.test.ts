import { describe, expect, it } from "vitest";
import {
  canMoveMapToken,
  clearSettledTokenResizeDraft,
  createInitialMapInteractionState,
  createValidatedMapObjectRef,
  mapInteractionReducer,
  resolveMapToolShortcut,
  resolveMapWheelGesture,
  shouldBeginMapPan,
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

  it("queues validated tool selection and gates fog shortcuts by role", () => {
    expect(resolveMapToolShortcut("v", false, "PLAYER")).toBe("PAN");
    expect(resolveMapToolShortcut("D", false, "PLAYER")).toBe("DRAW");
    expect(resolveMapToolShortcut("r", false, "PLAYER")).toBe("RULER");
    expect(resolveMapToolShortcut("p", false, "PLAYER")).toBe("PING");
    expect(resolveMapToolShortcut("g", false, "PLAYER")).toBeNull();
    expect(resolveMapToolShortcut("g", false, "GM")).toBe("FOG");
    expect(resolveMapToolShortcut("G", true, "GM")).toBe("COVER");
    expect(resolveMapToolShortcut("d", true, "GM")).toBeNull();
    expect(resolveMapToolShortcut("Delete", false, "GM")).toBeNull();

    const state = reduce({ type: "select-tool", tool: "PING" });
    expect(state.commands).toEqual([
      { id: 1, type: "select-tool", tool: "PING" },
    ]);
  });

  it("reserves right and middle drag for panning and pans empty canvas in PAN", () => {
    expect(shouldBeginMapPan(2, "DRAW", false)).toBe(true);
    expect(shouldBeginMapPan(1, "RULER", false)).toBe(true);
    expect(shouldBeginMapPan(0, "PAN", true)).toBe(true);
    expect(shouldBeginMapPan(0, "PAN", false)).toBe(false);
    expect(shouldBeginMapPan(0, "DRAW", true)).toBe(false);
  });

  it("uses touchpad scroll for pan and modifier pinch for zoom", () => {
    expect(
      resolveMapWheelGesture({
        deltaX: 24,
        deltaY: -12,
        ctrlKey: false,
        metaKey: false,
      }),
    ).toEqual({ type: "pan", delta: { x: -24, y: 12 } });
    expect(
      resolveMapWheelGesture({
        deltaX: 0,
        deltaY: -2,
        ctrlKey: true,
        metaKey: false,
      }),
    ).toEqual({ type: "zoom", direction: "in" });
  });

  it("lets a GM move every unlocked token in PAN", () => {
    expect(
      canMoveMapToken({
        tool: "PAN",
        role: "GM",
        locked: false,
        membershipId: "gm",
        controllerMembershipIds: [],
      }),
    ).toBe(true);
    expect(
      canMoveMapToken({
        tool: "DRAW",
        role: "GM",
        locked: false,
        membershipId: "gm",
        controllerMembershipIds: [],
      }),
    ).toBe(false);
    expect(
      canMoveMapToken({
        tool: "PAN",
        role: "GM",
        locked: true,
        membershipId: "gm",
        controllerMembershipIds: [],
      }),
    ).toBe(false);
  });

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
  it("clears only the resize request that actually settled", () => {
    const latest = { width: 96, height: 96, revision: 4 };
    const drafts = { token: latest };
    expect(
      clearSettledTokenResizeDraft(drafts, "token", {
        width: 64,
        height: 64,
        revision: 3,
      }),
    ).toBe(drafts);
    expect(clearSettledTokenResizeDraft(drafts, "token", latest)).toEqual({});
  });
});

import { describe, expect, it } from "vitest";
import { RULER_MAX_POINTS } from "@arken/contracts";
import { regionCommitTarget } from "./map-tool-shortcuts";
import {
  appendRulerWaypoint,
  canMoveMapToken,
  clearSettledTokenResizeDraft,
  createInitialMapInteractionState,
  createValidatedMapObjectRef,
  mapInteractionReducer,
  moveRulerDraft,
  resolveMapToolShortcut,
  resolveTokenMoveKey,
  resolveMapWheelGesture,
  rulerDraftPoints,
  shouldBeginMapPan,
  shouldSuppressCtrlPing,
  startRulerDraft,
  type MapInteractionAction,
  type MapInteractionState,
  type MapObjectRef,
  type RulerDraft,
} from "./map-interaction";

describe("keyboard token movement", () => {
  const resolve = (
    overrides: Partial<Parameters<typeof resolveTokenMoveKey>[0]> = {},
  ) =>
    resolveTokenMoveKey({
      key: "w",
      repeat: false,
      tool: "PAN",
      hasSelectedToken: true,
      gridEnabled: true,
      gridSize: 64,
      shiftKey: false,
      ...overrides,
    });

  it("maps WASD to grid and gridless movement, with Shift acceleration", () => {
    expect(resolve()).toEqual({ delta: { x: 0, y: -64 } });
    expect(resolve({ key: "d", shiftKey: true })).toEqual({
      delta: { x: 320, y: 0 },
    });
    expect(resolve({ key: "s", gridEnabled: false })).toEqual({
      delta: { x: 0, y: 8 },
    });
  });

  it("does not steal D without a movable PAN token and consumes repeats", () => {
    expect(resolve({ key: "d", tool: "DRAW" })).toBeNull();
    expect(resolve({ key: "d", hasSelectedToken: false })).toBeNull();
    expect(resolve({ key: "d", repeat: true })).toEqual({ delta: null });
  });
});

describe("Ctrl click intent", () => {
  it("suppresses only the click paired with a committed ruler waypoint", () => {
    expect(
      shouldSuppressCtrlPing({
        tool: "RULER",
        ctrlKey: true,
        waypointCommitted: true,
      }),
    ).toBe(true);
    expect(
      shouldSuppressCtrlPing({
        tool: "PAN",
        ctrlKey: true,
        waypointCommitted: true,
      }),
    ).toBe(false);
    expect(
      shouldSuppressCtrlPing({
        tool: "RULER",
        ctrlKey: true,
        waypointCommitted: false,
      }),
    ).toBe(false);
  });
});

const token: MapObjectRef = { kind: "token", objectId: "token-1", revision: 3 };
const drawing: MapObjectRef = {
  kind: "drawing",
  objectId: "shape-2",
  revision: 1,
};
const validatedToken = createValidatedMapObjectRef(token)!;
const validatedDrawing = createValidatedMapObjectRef(drawing)!;
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

    // UIX-313: circular brush and polygon fog tools are GM-only, like FOG/COVER.
    expect(resolveMapToolShortcut("b", false, "PLAYER")).toBeNull();
    expect(resolveMapToolShortcut("b", false, "GM")).toBe("FOG_BRUSH");
    expect(resolveMapToolShortcut("B", true, "GM")).toBe("COVER_BRUSH");
    expect(resolveMapToolShortcut("l", false, "PLAYER")).toBeNull();
    expect(resolveMapToolShortcut("l", false, "GM")).toBe("FOG_POLYGON");
    expect(resolveMapToolShortcut("L", true, "GM")).toBe("COVER_POLYGON");

    const state = reduce({ type: "select-tool", tool: "PING" });
    expect(state.commands).toEqual([
      { id: 1, type: "select-tool", tool: "PING" },
    ]);
  });

  it("reserves middle drag and empty-canvas right drag for panning", () => {
    expect(shouldBeginMapPan(2, "DRAW", true)).toBe(true);
    expect(shouldBeginMapPan(2, "DRAW", false)).toBe(false);
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

  it("удаляет рисунок сразу, без подтверждения", () => {
    // UIX-470: рисуют быстро и много, и диалог на каждый штрих стоит дороже
    // редкого промаха. Промах при этом не теряется — удаление рисунка пишется
    // в `action_journal`, и Ctrl+Z его возвращает.
    const deleted = reduce({
      type: "request-delete",
      ref: validatedDrawing,
    });
    expect(deleted.deleteRequestedFor).toBeNull();
    expect(deleted.commands).toEqual([
      { id: 1, type: "delete-object", ref: validatedDrawing },
    ]);
  });

  it("у токена подтверждение остаётся", () => {
    // Токен несёт персонажа, права и владельца: его удаление — не штрих, а
    // изменение расстановки.
    const requested = reduce({ type: "request-delete", ref: validatedToken });
    expect(requested.deleteRequestedFor).toEqual(validatedToken);
    expect(requested.commands).toEqual([]);
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

describe("ruler draft (UIX-381 multi-segment waypoints)", () => {
  it("starts a draft with the drag start as both the sole waypoint and the live point", () => {
    const draft = startRulerDraft({ x: 0, y: 0 });
    expect(draft.waypoints).toEqual([{ x: 0, y: 0 }]);
    expect(draft.live).toEqual({ x: 0, y: 0 });
    expect(rulerDraftPoints(draft)).toEqual([{ x: 0, y: 0 }]);
  });

  it("moving the live point alone reflects a single in-progress segment (back-compat)", () => {
    const draft = moveRulerDraft(startRulerDraft({ x: 0, y: 0 }), {
      x: 10,
      y: 10,
    });
    expect(rulerDraftPoints(draft)).toEqual([
      { x: 0, y: 0 },
      { x: 10, y: 10 },
    ]);
  });

  it("Ctrl commits the live point as a waypoint and the next segment continues from it", () => {
    let draft = startRulerDraft({ x: 0, y: 0 });
    draft = moveRulerDraft(draft, { x: 10, y: 10 });
    draft = appendRulerWaypoint(draft);
    expect(draft.waypoints).toEqual([
      { x: 0, y: 0 },
      { x: 10, y: 10 },
    ]);
    expect(draft.live).toEqual({ x: 10, y: 10 });

    draft = moveRulerDraft(draft, { x: 20, y: 0 });
    expect(rulerDraftPoints(draft)).toEqual([
      { x: 0, y: 0 },
      { x: 10, y: 10 },
      { x: 20, y: 0 },
    ]);
  });

  it("repeats across several waypoints", () => {
    let draft = startRulerDraft({ x: 0, y: 0 });
    for (const point of [
      { x: 10, y: 0 },
      { x: 10, y: 10 },
      { x: 20, y: 10 },
    ]) {
      draft = appendRulerWaypoint(moveRulerDraft(draft, point));
    }
    draft = moveRulerDraft(draft, { x: 20, y: 20 });
    expect(rulerDraftPoints(draft)).toEqual([
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 10, y: 10 },
      { x: 20, y: 10 },
      { x: 20, y: 20 },
    ]);
  });

  it("does not commit a duplicate waypoint when the pointer has not moved (e.g. Ctrl pressed twice)", () => {
    const draft = startRulerDraft({ x: 0, y: 0 });
    const committed = appendRulerWaypoint(draft);
    expect(committed).toBe(draft);
    expect(committed.waypoints).toEqual([{ x: 0, y: 0 }]);
  });

  it("stops committing new waypoints once the RULER_MAX_POINTS cap would be exceeded", () => {
    let draft: RulerDraft = startRulerDraft({ x: 0, y: 0 });
    // Reserve one slot for the live point: only RULER_MAX_POINTS - 1
    // waypoints should ever be committable.
    for (let i = 1; i < RULER_MAX_POINTS + 5; i++) {
      draft = appendRulerWaypoint(moveRulerDraft(draft, { x: i, y: 0 }));
    }
    expect(draft.waypoints.length).toBe(RULER_MAX_POINTS - 1);
    // The live segment still fits within the cap.
    expect(rulerDraftPoints(draft).length).toBeLessThanOrEqual(
      RULER_MAX_POINTS,
    );
  });
});

describe("куда уходит обведённый прямоугольник", () => {
  it("зона боя — в сохранение зоны, область стычки — в начало боя", () => {
    // Оба инструмента тянут одну и ту же рамку. Перепутать адресата значит
    // открыть мастеру диалог «Начать бой» там, где он сохранял поле, — и это
    // не ломает ни типы, ни один тест, кроме этого.
    expect(regionCommitTarget("BATTLE_ZONE")).toBe("BATTLE_ZONE");
    expect(regionCommitTarget("SCENE_REGION")).toBe("ENCOUNTER");
  });

  it("остальные инструменты рамку не коммитят вовсе", () => {
    // Линейка и кисть тумана тоже тянутся мышью; отправить их прямоугольник
    // в зону боя значило бы собрать очередь по случайному взмаху.
    for (const tool of ["PAN", "DRAW", "RULER", "FOG", "FOG_BRUSH"] as const)
      expect(regionCommitTarget(tool)).toBeNull();
  });
});

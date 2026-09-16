import { describe, expect, it, vi } from "vitest";
import {
  createTokenDragGuard,
  isDirectTokenDrag,
  runNonPingPointerAction,
} from "./token-drag-event";

describe("isDirectTokenDrag", () => {
  it("accepts a drag emitted by the token group itself", () => {
    const tokenGroup = {};
    expect(isDirectTokenDrag(tokenGroup, tokenGroup)).toBe(true);
  });

  it("rejects a resize-handle drag bubbled to the token group", () => {
    const tokenGroup = {};
    const resizeHandle = {};
    expect(isDirectTokenDrag(resizeHandle, tokenGroup)).toBe(false);
  });
});

describe("non-ping pointer actions", () => {
  it.each([
    ["DRAW", 0, true],
    ["DRAW", 1, false],
    ["DRAW", 2, false],
    ["PAN", 0, true],
    ["PING", 0, false],
  ] as const)(
    "reserves %s/button %i/Ctrl %s without changing local state",
    (tool, button, ctrlKey) => {
      const state = { tool, selection: ["existing"], drawingActive: false };
      const action = vi.fn(() => {
        state.selection = ["clicked"];
        state.drawingActive = true;
      });
      runNonPingPointerAction(tool, { button, ctrlKey }, action);
      expect(action).not.toHaveBeenCalled();
      expect(state).toEqual({
        tool,
        selection: ["existing"],
        drawingActive: false,
      });
    },
  );

  it.each(["PAN", "DRAW"])("executes the ordinary %s action once", (tool) => {
    const action = vi.fn();
    runNonPingPointerAction(tool, { button: 0, ctrlKey: false }, action);
    expect(action).toHaveBeenCalledTimes(1);
  });
});

function dragFixture() {
  let position = { x: 120, y: 80 };
  const node = {
    x: () => position.x,
    y: () => position.y,
    position: vi.fn((point: { x: number; y: number }) => {
      position = { ...point };
    }),
    stopDrag: vi.fn((_event?: unknown) => {}),
  };
  const event = (ctrlKey = false) => ({
    target: node,
    currentTarget: node,
    evt: { button: 0, ctrlKey },
  });
  return { node, event, position: () => position };
}

describe("token drag ping guard", () => {
  it("rejects Ctrl-origin drag even after Ctrl release, including synchronous and later dragend", () => {
    const guard = createTokenDragGuard();
    const fixture = dragFixture();
    const moving = vi.fn();
    const moved = vi.fn();
    const bulkMove = vi.fn();
    const dragEnd = () => {
      guard.run(fixture.event(), () => {
        moved();
        bulkMove();
      });
    };
    // This models Konva.stopDrag's synchronous event, not just a predicate.
    fixture.node.stopDrag.mockImplementation(dragEnd);
    guard.recordPointerDown(fixture.node, { button: 0, ctrlKey: true });
    guard.begin(fixture.event());
    guard.run(fixture.event(), moving);
    dragEnd();
    expect(moving).not.toHaveBeenCalled();
    expect(moved).not.toHaveBeenCalled();
    expect(bulkMove).not.toHaveBeenCalled();
    expect(fixture.node.stopDrag).toHaveBeenCalledTimes(1);
    expect(fixture.position()).toEqual({ x: 120, y: 80 });
  });

  it("rejects Ctrl acquired before dragstart, before any moving/moved callback", () => {
    const guard = createTokenDragGuard();
    const fixture = dragFixture();
    const emit = vi.fn();
    guard.recordPointerDown(fixture.node, { button: 0, ctrlKey: false });
    guard.begin(fixture.event(true));
    guard.run(fixture.event(), emit);
    guard.run(fixture.event(), emit);
    expect(emit).not.toHaveBeenCalled();
    expect(fixture.node.stopDrag).toHaveBeenCalledTimes(1);
  });

  it("restores node and transient draft before stopping a drag that acquires Ctrl", () => {
    const guard = createTokenDragGuard();
    const fixture = dragFixture();
    const canonical = { x: 120, y: 80 };
    let draft = { ...canonical };
    const restore = vi.fn((origin: { x: number; y: number }) => {
      draft = origin;
    });
    guard.recordPointerDown(fixture.node, { button: 0, ctrlKey: false });
    guard.begin(fixture.event());
    fixture.node.position({ x: 200, y: 150 });
    guard.run(fixture.event(), () => {
      draft = fixture.position();
    });
    const emit = vi.fn();
    fixture.node.stopDrag.mockImplementation(() => {
      expect(fixture.position()).toEqual(canonical);
      expect(draft).toEqual(canonical);
      guard.run(fixture.event(), emit, restore);
    });
    guard.run(fixture.event(true), emit, restore);
    expect(emit).not.toHaveBeenCalled();
    expect(restore).toHaveBeenCalledTimes(1);
    expect(canonical).toEqual({ x: 120, y: 80 });
  });

  it("allows ordinary token/group-move callbacks unchanged, including the gesture after cancellation", () => {
    const guard = createTokenDragGuard();
    const fixture = dragFixture();
    guard.recordPointerDown(fixture.node, { button: 0, ctrlKey: true });
    guard.begin(fixture.event(true));
    guard.recordPointerDown(fixture.node, { button: 0, ctrlKey: false });
    guard.begin(fixture.event());
    fixture.node.position({ x: 220, y: 180 });
    const moving = vi.fn();
    const bulkMove = vi.fn();
    guard.run(fixture.event(), moving);
    guard.run(fixture.event(), bulkMove);
    expect(moving).toHaveBeenCalledTimes(1);
    expect(bulkMove).toHaveBeenCalledTimes(1);
    expect(fixture.position()).toEqual({ x: 220, y: 180 });
    expect(fixture.node.stopDrag).toHaveBeenCalledTimes(1);
  });

  it("ignores bubbled resize drag events without stopping the handle or running token callbacks", () => {
    const guard = createTokenDragGuard();
    const token = dragFixture();
    const handle = dragFixture();
    const event = { ...handle.event(true), currentTarget: token.node };
    const emit = vi.fn();
    guard.recordPointerDown(token.node, { button: 0, ctrlKey: true });
    guard.begin(event);
    guard.run(event, emit);
    expect(emit).not.toHaveBeenCalled();
    expect(token.node.stopDrag).not.toHaveBeenCalled();
    expect(handle.node.stopDrag).not.toHaveBeenCalled();
  });

  it("does not inherit an undragged Ctrl-click veto when the next gesture is a touch drag", () => {
    const guard = createTokenDragGuard();
    const fixture = dragFixture();
    guard.recordPointerDown(fixture.node, { button: 0, ctrlKey: true });
    // Ctrl-click ended without dragstart. Native touchstart replaces its ledger.
    guard.recordTouchStart(fixture.node, { ctrlKey: false });
    const touchDrag = { ...fixture.event(), evt: {} };
    guard.begin(touchDrag);
    fixture.node.position({ x: 220, y: 180 });
    const moving = vi.fn();
    const moved = vi.fn();
    guard.run(touchDrag, moving);
    guard.run(touchDrag, moved);
    expect(moving).toHaveBeenCalledTimes(1);
    expect(moved).toHaveBeenCalledTimes(1);
    expect(fixture.node.stopDrag).not.toHaveBeenCalled();
    expect(fixture.position()).toEqual({ x: 220, y: 180 });
  });

  it("allows a fresh token touch drag after a bubbled resize touchstart/drag", () => {
    const guard = createTokenDragGuard();
    const token = dragFixture();
    const handle = dragFixture();
    guard.recordTouchStart(token.node, { ctrlKey: false });
    const resizeDrag = {
      ...handle.event(),
      currentTarget: token.node,
      evt: {},
    };
    const tokenMoving = vi.fn();
    guard.begin(resizeDrag);
    guard.run(resizeDrag, tokenMoving);
    expect(tokenMoving).not.toHaveBeenCalled();
    guard.recordTouchStart(token.node, { ctrlKey: false });
    const tokenDrag = { ...token.event(), evt: {} };
    guard.begin(tokenDrag);
    guard.run(tokenDrag, tokenMoving);
    expect(tokenMoving).toHaveBeenCalledTimes(1);
    expect(token.node.stopDrag).not.toHaveBeenCalled();
    expect(handle.node.stopDrag).not.toHaveBeenCalled();
  });
});

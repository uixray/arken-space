// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { fireEvent, renderComponent, screen } from "../test-support/render";
import { useMapTouch } from "./useMapTouch";

const captureMethods = [
  "setPointerCapture",
  "hasPointerCapture",
  "releasePointerCapture",
] as const;
const originalCaptureMethods = captureMethods.map((name) =>
  Object.getOwnPropertyDescriptor(HTMLElement.prototype, name),
);
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  captureMethods.forEach((name, index) => {
    const descriptor = originalCaptureMethods[index];
    if (descriptor)
      Object.defineProperty(HTMLElement.prototype, name, descriptor);
    else Reflect.deleteProperty(HTMLElement.prototype, name);
  });
});

it("cancels a token drag when a second finger takes over and never commits it on release", () => {
  class TestPointerEvent extends MouseEvent {
    pointerId: number;
    pointerType: string;
    isPrimary: boolean;
    constructor(type: string, init: PointerEventInit = {}) {
      super(type, init);
      this.pointerId = init.pointerId ?? 0;
      this.pointerType = init.pointerType ?? "";
      this.isPrimary = init.isPrimary ?? false;
    }
  }
  vi.stubGlobal("PointerEvent", TestPointerEvent);
  const captures = new Set<number>();
  Object.defineProperty(HTMLElement.prototype, "setPointerCapture", {
    configurable: true,
    value: (id: number) => captures.add(id),
  });
  Object.defineProperty(HTMLElement.prototype, "hasPointerCapture", {
    configurable: true,
    value: (id: number) => captures.has(id),
  });
  Object.defineProperty(HTMLElement.prototype, "releasePointerCapture", {
    configurable: true,
    value: (id: number) => captures.delete(id),
  });
  const commit = vi.fn(),
    preview = vi.fn(),
    cameraChange = vi.fn(),
    select = vi.fn();
  const token = { id: "token", revision: 1, x: 0, y: 0 };
  function Fixture() {
    const touch = useMapTouch({
      scope: "scene",
      enabled: true,
      camera: { position: { x: 0, y: 0 }, scale: 1 },
      hit: () => token,
      movable: () => true,
      select,
      preview,
      commit,
      cameraChange,
    });
    return (
      <div
        tabIndex={0}
        onPointerDown={touch.down}
        onPointerMove={touch.move}
        onPointerUp={touch.up}
        onPointerCancel={touch.pointerCancel}
        onLostPointerCapture={touch.lostCapture}
      >
        <canvas aria-label="Карта" />
      </div>
    );
  }
  renderComponent(<Fixture />);
  const canvas = screen.getByLabelText("Карта");
  fireEvent.pointerDown(canvas, {
    pointerType: "touch",
    pointerId: 1,
    isPrimary: true,
    clientX: 10,
    clientY: 10,
  });
  fireEvent.pointerMove(canvas, {
    pointerType: "touch",
    pointerId: 1,
    isPrimary: true,
    clientX: 30,
    clientY: 10,
  });
  expect(preview).toHaveBeenCalledWith(token, { x: 20, y: 0 });
  fireEvent.pointerDown(canvas, {
    pointerType: "touch",
    pointerId: 2,
    isPrimary: false,
    clientX: 50,
    clientY: 10,
  });
  expect(preview).toHaveBeenLastCalledWith(token, null);
  fireEvent.pointerMove(canvas, {
    pointerType: "touch",
    pointerId: 2,
    isPrimary: false,
    clientX: 65,
    clientY: 10,
  });
  expect(cameraChange).toHaveBeenCalled();
  fireEvent.pointerUp(canvas, {
    pointerType: "touch",
    pointerId: 2,
    isPrimary: false,
    clientX: 65,
    clientY: 10,
  });
  fireEvent.pointerUp(canvas, {
    pointerType: "touch",
    pointerId: 1,
    isPrimary: true,
    clientX: 30,
    clientY: 10,
  });
  expect(commit).not.toHaveBeenCalled();
  expect(select).not.toHaveBeenCalled();
  fireEvent.pointerDown(canvas, {
    pointerType: "touch",
    pointerId: 3,
    isPrimary: true,
    clientX: 10,
    clientY: 10,
  });
  fireEvent.pointerMove(canvas, {
    pointerType: "touch",
    pointerId: 3,
    isPrimary: true,
    clientX: 40,
    clientY: 10,
  });
  fireEvent.pointerCancel(canvas, {
    pointerType: "touch",
    pointerId: 3,
    isPrimary: true,
    clientX: 40,
    clientY: 10,
  });
  fireEvent.pointerUp(canvas, {
    pointerType: "touch",
    pointerId: 3,
    isPrimary: true,
    clientX: 40,
    clientY: 10,
  });
  expect(preview).toHaveBeenLastCalledWith(token, null);
  expect(commit).not.toHaveBeenCalled();
  expect(select).not.toHaveBeenCalled();
});

it("lets an active map tool finish over a token without selecting or moving it", () => {
  class TestPointerEvent extends MouseEvent {
    pointerId: number;
    pointerType: string;
    isPrimary: boolean;
    constructor(type: string, init: PointerEventInit = {}) {
      super(type, init);
      this.pointerId = init.pointerId ?? 0;
      this.pointerType = init.pointerType ?? "";
      this.isPrimary = init.isPrimary ?? false;
    }
  }
  vi.stubGlobal("PointerEvent", TestPointerEvent);
  Object.defineProperty(HTMLElement.prototype, "setPointerCapture", {
    configurable: true,
    value: vi.fn(),
  });
  const commit = vi.fn(),
    preview = vi.fn(),
    select = vi.fn();
  const move = vi.fn(),
    finish = vi.fn(),
    cancel = vi.fn();
  const token = { id: "token", revision: 1, x: 0, y: 0 };
  const hit = vi.fn(() => token);
  function Fixture() {
    const touch = useMapTouch({
      scope: "scene",
      enabled: true,
      camera: { position: { x: 0, y: 0 }, scale: 1 },
      hit,
      movable: () => true,
      select,
      preview,
      commit,
      cameraChange: vi.fn(),
      startTool: () => ({ move, finish, cancel }),
    });
    return (
      <div
        tabIndex={0}
        onPointerDown={touch.down}
        onPointerMove={touch.move}
        onPointerUp={touch.up}
        onPointerCancel={touch.pointerCancel}
        onLostPointerCapture={touch.lostCapture}
      >
        <canvas aria-label="Карта" />
      </div>
    );
  }
  renderComponent(<Fixture />);
  const canvas = screen.getByLabelText("Карта");
  fireEvent.pointerDown(canvas, {
    pointerType: "touch",
    pointerId: 1,
    isPrimary: true,
    clientX: 10,
    clientY: 10,
  });
  fireEvent.pointerMove(canvas, {
    pointerType: "touch",
    pointerId: 1,
    isPrimary: true,
    clientX: 40,
    clientY: 10,
  });
  fireEvent.pointerUp(canvas, {
    pointerType: "touch",
    pointerId: 1,
    isPrimary: true,
    clientX: 40,
    clientY: 10,
  });
  expect(move).toHaveBeenCalled();
  expect(finish).toHaveBeenCalledTimes(1);
  expect(cancel).not.toHaveBeenCalled();
  expect(hit).not.toHaveBeenCalled();
  expect(select).not.toHaveBeenCalled();
  expect(commit).not.toHaveBeenCalled();
  expect(preview).not.toHaveBeenCalled();
});

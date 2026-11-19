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

it("pings only on a short primary tap in the same enabled scope", () => {
  class TouchEvent extends MouseEvent {
    readonly pointerType = "touch";
    readonly pointerId = 11;
    readonly isPrimary = true;
  }
  const captures = new Set<number>();
  for (const [name, value] of [
    ["setPointerCapture", (id: number) => captures.add(id)],
    ["hasPointerCapture", (id: number) => captures.has(id)],
    ["releasePointerCapture", (id: number) => captures.delete(id)],
  ] as const)
    Object.defineProperty(HTMLElement.prototype, name, {
      configurable: true,
      value,
    });
  const pingTap = vi.fn(),
    commit = vi.fn(),
    select = vi.fn(),
    finish = vi.fn();
  function Map({ scope = "A", enabled = true, draw = false, ping = true }) {
    const touch = useMapTouch({
      scope,
      enabled,
      pingTap: ping ? pingTap : undefined,
      camera: { position: { x: 0, y: 0 }, scale: 1 },
      cameraChange: vi.fn(),
      hit: () => null,
      movable: () => false,
      preview: vi.fn(),
      select,
      commit,
      startTool: () =>
        draw ? { move: vi.fn(), finish, cancel: vi.fn() } : null,
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
        <canvas aria-label="Ping test map" />
      </div>
    );
  }
  const view = renderComponent(<Map />);
  const canvas = screen.getByLabelText("Ping test map");
  const send = (type: string, t: number, x = 60) => {
    const event = new TouchEvent(type, {
      bubbles: true,
      cancelable: true,
      clientX: x,
      clientY: 70,
    });
    Object.defineProperty(event, "timeStamp", { value: t });
    fireEvent(canvas, event);
    if (type === "pointerup" || type === "pointercancel") captures.delete(11);
  };
  send("pointerdown", 10);
  send("pointerup", 160, 61);
  expect(pingTap).toHaveBeenCalledTimes(1);
  expect(pingTap).toHaveBeenLastCalledWith({ x: 61, y: 70 });
  send("pointerdown", 200);
  send("pointerup", 950); // stationary hold is not a tap
  send("pointerdown", 1000);
  send("pointermove", 1040, 68);
  send("pointerup", 1100);
  send("pointerdown", 1200);
  send("pointercancel", 1210);
  send("pointerup", 1220);
  send("pointerdown", 1300);
  view.rerender(<Map enabled={false} />);
  send("pointerup", 1400);
  view.rerender(<Map />);
  send("pointerdown", 1500);
  view.rerender(<Map scope="B" />);
  send("pointerup", 1550);
  view.rerender(<Map ping={false} />);
  send("pointerdown", 1600);
  send("pointerup", 1650);
  view.rerender(<Map draw />);
  send("pointerdown", 1700);
  send("pointerup", 1750);
  expect(finish).toHaveBeenCalledTimes(1);
  expect(pingTap).toHaveBeenCalledTimes(1);
  expect(commit).not.toHaveBeenCalled();
  expect(select).not.toHaveBeenCalled();
  view.rerender(<Map />);
  send("pointerdown", 1800);
  send("pointerup", 1900);
  expect(pingTap).toHaveBeenCalledTimes(2);
});

// @vitest-environment jsdom
import type { ReactNode } from "react";
import type { SceneDto, TokenDto } from "@arken/contracts";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { act, fireEvent, renderComponent } from "../test-support/render";
import type { SceneRendererProps } from "./SceneRenderer";

// Konva and element measurement are transport seams. The real renderer owns
// gesture arbitration/state; this fixture does not claim browser hit testing.
beforeAll(() => {
  vi.stubGlobal("matchMedia", (query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: () => true,
  }));
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
});
afterAll(() => vi.unstubAllGlobals());

let pointer = { x: 0, y: 0 };
const stage = {
  name: () => "stage",
  getPointerPosition: () => pointer,
  container: () => document.createElement("div"),
};
const groupProps: Array<Record<string, unknown>> = [];

vi.mock("use-image", () => ({ default: () => [undefined, "loaded"] }));
vi.mock("react-konva", async () => {
  const React = await import("react");
  const node = (name: string) => (props: { children?: ReactNode }) =>
    React.createElement("div", { "data-konva": name }, props.children);
  const stageEvent = (native: PointerEvent | MouseEvent) => ({
    evt: {
      button: native.button,
      buttons: native.buttons,
      clientX: native.clientX,
      clientY: native.clientY,
      ctrlKey: native.ctrlKey,
      shiftKey: native.shiftKey,
      preventDefault: () => native.preventDefault(),
    },
    target: stage,
    currentTarget: stage,
    cancelBubble: false,
  });
  return {
    Arrow: node("arrow"),
    Circle: node("circle"),
    Image: node("image"),
    Layer: node("layer"),
    Line: node("line"),
    Rect: node("rect"),
    Text: node("text"),
    Group: (props: Record<string, unknown> & { children?: ReactNode }) => {
      groupProps.push(props);
      return React.createElement(
        "div",
        {
          "data-konva": "group",
          "data-draggable": String(Boolean(props.draggable)),
          "data-has-context": String(Boolean(props.onContextMenu)),
          onContextMenu: props.onContextMenu
            ? (native: MouseEvent) =>
                (props.onContextMenu as (value: unknown) => void)(
                  stageEvent(native),
                )
            : undefined,
        },
        props.children,
      );
    },
    Stage: React.forwardRef(
      (props: Record<string, unknown> & { children?: ReactNode }, ref) => {
        React.useImperativeHandle(ref, () => stage);
        const updatePointer = (native: PointerEvent | MouseEvent) => {
          pointer = { x: native.clientX, y: native.clientY };
        };
        return React.createElement(
          "div",
          {
            "data-testid": "production-stage",
            "data-stage-x": String(props.x),
            "data-stage-y": String(props.y),
            onPointerDown: (native: PointerEvent) => {
              updatePointer(native);
              (props.onPointerDown as (value: unknown) => void)(
                stageEvent(native),
              );
            },
            onPointerMove: (native: PointerEvent) => {
              updatePointer(native);
              (props.onPointerMove as (value: unknown) => void)(
                stageEvent(native),
              );
            },
            onPointerUp: (native: PointerEvent) => {
              updatePointer(native);
              void (props.onPointerUp as () => void)();
            },
          },
          props.children,
        );
      },
    ),
  };
});

import { Orthographic2DRenderer } from "./Orthographic2DRenderer";

const token: TokenDto = {
  id: "token-1",
  definitionId: "definition-1",
  definitionRevision: 1,
  controllerMembershipIds: ["gm"],
  sceneId: "scene-1",
  characterId: null,
  ownerMembershipId: null,
  assetId: null,
  name: "Страж",
  x: 40,
  y: 50,
  z: 0,
  levelId: null,
  width: 32,
  height: 32,
  rotation: 0,
  visible: true,
  locked: false,
  baseColor: "#ffffff",
  frameColor: null,
  layer: "PLAYER",
  conditions: [],
  revision: 1,
};
const scene: SceneDto = {
  id: "scene-1",
  name: "Тестовая сцена",
  projection: "ORTHOGRAPHIC_2D",
  mapAssetId: null,
  width: 1200,
  height: 800,
  backgroundFrame: { x: 0, y: 0, width: 1200, height: 800 },
  grid: {
    enabled: false,
    size: 64,
    offsetX: 0,
    offsetY: 0,
    color: "#ffffff",
    opacity: 0.5,
  },
  active: true,
};

function fixture(overrides: Partial<SceneRendererProps> = {}) {
  const callbacks = {
    onEncounterRegionSelect: vi.fn(),
    onSelectionChange: vi.fn(),
    onFogCreate: vi.fn().mockResolvedValue(undefined),
    onDrawingCreate: vi.fn().mockResolvedValue(undefined),
    onPing: vi.fn(),
  };
  const props: SceneRendererProps = {
    scene,
    tokens: [token],
    fogReveals: [],
    drawings: [],
    assets: [],
    role: "GM",
    membershipId: "gm",
    socket: null,
    tool: "SCENE_REGION",
    onToolSelect: vi.fn(),
    pings: [],
    cursors: [],
    cursorSendEnabled: false,
    cursorShared: false,
    rulers: [],
    ...callbacks,
    ...overrides,
  };
  return { props, callbacks };
}
async function regionDrag(element: HTMLElement, shift = false) {
  fireEvent.pointerDown(element, {
    button: 0,
    buttons: 1,
    clientX: 140,
    clientY: 120,
    shiftKey: shift,
  });
  fireEvent.pointerMove(element, {
    buttons: 1,
    clientX: 60,
    clientY: 30,
    shiftKey: shift,
  });
  // The real release handler awaits fog cleanup before committing a region.
  // Flush that continuation before positive OR negative assertions.
  await act(async () => {
    fireEvent.pointerUp(element, { button: 0, clientX: 60, clientY: 30 });
  });
}

describe("Orthographic2DRenderer SCENE_REGION production pointer handler", () => {
  it.each([false, true])(
    "commits one normalized GM region for %s Shift without other canvas mutations",
    async (shift) => {
      groupProps.length = 0;
      const { props, callbacks } = fixture();
      const { getByTestId } = renderComponent(
        <Orthographic2DRenderer {...props} />,
      );
      expect(callbacks.onSelectionChange).toHaveBeenLastCalledWith([]);
      callbacks.onSelectionChange.mockClear();
      await regionDrag(getByTestId("production-stage"), shift);
      expect(callbacks.onEncounterRegionSelect).toHaveBeenCalledTimes(1);
      expect(callbacks.onEncounterRegionSelect).toHaveBeenCalledWith({
        x: 60,
        y: 30,
        width: 80,
        height: 90,
      });
      expect(callbacks.onSelectionChange).not.toHaveBeenCalled();
      expect(callbacks.onFogCreate).not.toHaveBeenCalled();
      expect(callbacks.onDrawingCreate).not.toHaveBeenCalled();
      expect(callbacks.onPing).not.toHaveBeenCalled();
      expect(
        groupProps.some(
          (props) =>
            props.x === token.x &&
            props.y === token.y &&
            props.draggable === false,
        ),
      ).toBe(true);
    },
  );
  it("does not expose a region commit to a PLAYER", async () => {
    const { props, callbacks } = fixture({ role: "PLAYER" });
    const { getByTestId } = renderComponent(
      <Orthographic2DRenderer {...props} />,
    );
    expect(callbacks.onSelectionChange).toHaveBeenLastCalledWith([]);
    callbacks.onSelectionChange.mockClear();
    await regionDrag(getByTestId("production-stage"));
    expect(callbacks.onEncounterRegionSelect).not.toHaveBeenCalled();
    expect(callbacks.onSelectionChange).not.toHaveBeenCalled();
    expect(callbacks.onFogCreate).not.toHaveBeenCalled();
    expect(callbacks.onDrawingCreate).not.toHaveBeenCalled();
  });
  it("pans on middle/right empty drags and opens token context without a region", async () => {
    const { props, callbacks } = fixture();
    const { getByTestId, container } = renderComponent(
      <Orthographic2DRenderer {...props} />,
    );
    expect(callbacks.onSelectionChange).toHaveBeenLastCalledWith([]);
    callbacks.onSelectionChange.mockClear();
    const renderedStage = getByTestId("production-stage");
    fireEvent.pointerDown(renderedStage, {
      button: 1,
      buttons: 4,
      clientX: 10,
      clientY: 10,
    });
    fireEvent.pointerMove(renderedStage, {
      buttons: 4,
      clientX: 90,
      clientY: 90,
    });
    await act(async () => {
      fireEvent.pointerUp(renderedStage, {
        button: 1,
        clientX: 90,
        clientY: 90,
      });
    });
    expect(renderedStage).toHaveAttribute("data-stage-x", "80");
    expect(renderedStage).toHaveAttribute("data-stage-y", "80");
    fireEvent.pointerDown(renderedStage, {
      button: 2,
      buttons: 2,
      clientX: 90,
      clientY: 90,
    });
    fireEvent.pointerMove(renderedStage, {
      buttons: 2,
      clientX: 120,
      clientY: 110,
    });
    await act(async () => {
      fireEvent.pointerUp(renderedStage, {
        button: 2,
        clientX: 120,
        clientY: 110,
      });
    });
    expect(renderedStage).toHaveAttribute("data-stage-x", "110");
    expect(renderedStage).toHaveAttribute("data-stage-y", "100");
    const tokenGroup = container.querySelector(
      '[data-konva="group"][data-has-context="true"]',
    );
    if (!tokenGroup) throw new Error("Token group was not rendered");
    fireEvent.contextMenu(tokenGroup, { button: 2, clientX: 45, clientY: 55 });
    expect(container.querySelector('[role="menu"]')).toHaveAttribute(
      "aria-label",
      "Действия токена «Страж»",
    );
    expect(callbacks.onEncounterRegionSelect).not.toHaveBeenCalled();
    expect(callbacks.onSelectionChange).not.toHaveBeenCalled();
    expect(callbacks.onFogCreate).not.toHaveBeenCalled();
    expect(callbacks.onDrawingCreate).not.toHaveBeenCalled();
  });
});

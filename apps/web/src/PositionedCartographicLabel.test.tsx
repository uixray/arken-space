// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { act, renderComponent, screen } from "./test-support/render";
import { PositionedCartographicLabel } from "./PositionedCartographicLabel";

afterEach(() => vi.restoreAllMocks());

it("clamps the visual label without changing the configured offset or semantic name", () => {
  const config = {
    presentation: "ribbon" as const,
    offsetX: 100,
    offsetY: -30,
  };
  let anchorLeft = 170;
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(
    function (this: HTMLElement) {
      const box = this.hasAttribute("data-cartographic-boundary")
        ? { x: 0, y: 0, width: 200, height: 100 }
        : { x: anchorLeft, y: 20, width: 40, height: 20 };
      return {
        ...box,
        left: box.x,
        top: box.y,
        right: box.x + box.width,
        bottom: box.y + box.height,
        toJSON: () => ({}),
      } as DOMRect;
    },
  );
  const view = renderComponent(
    <div data-cartographic-boundary>
      <button type="button">
        <PositionedCartographicLabel
          text="Восток"
          config={config}
          layoutKey="first"
        />
      </button>
    </div>,
  );
  const button = screen.getByRole("button", { name: "Восток" });
  const label = button.querySelector<HTMLElement>(
    ".positioned-cartographic-label",
  )!;
  expect(label.style.transform).toBe("translate(-10px, -20px)");
  expect(config).toEqual({
    presentation: "ribbon",
    offsetX: 100,
    offsetY: -30,
  });
  expect(button.querySelectorAll('svg[aria-hidden="true"]')).toHaveLength(2);
  anchorLeft = 50;
  act(() => {
    view.rerender(
      <div data-cartographic-boundary>
        <button type="button">
          <PositionedCartographicLabel
            text="Восток"
            config={config}
            layoutKey="moved"
          />
        </button>
      </div>,
    );
  });
  expect(label.style.transform).toBe("translate(100px, -20px)");
});

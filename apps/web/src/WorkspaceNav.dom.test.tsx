// @vitest-environment jsdom
import { act } from "react";
import { afterEach, expect, it, vi } from "vitest";
import { renderComponent, screen } from "./test-support/render";
import { WorkspaceNav } from "./WorkspaceNav";
import type { WorkspaceNavItem } from "./workspace-nav";

const items: WorkspaceNavItem[] = [
  { id: "characters", label: "Персонажи" },
  { id: "tokens", label: "Токены" },
  { id: "media", label: "Файлы" },
];
const originalFonts = Object.getOwnPropertyDescriptor(document, "fonts");
afterEach(() => {
  vi.restoreAllMocks();
  if (originalFonts) Object.defineProperty(document, "fonts", originalFonts);
  else Reflect.deleteProperty(document, "fonts");
});

function dimensions(buttonWidth: () => number) {
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(
    function (this: HTMLElement) {
      const width = this.classList.contains("workspace-nav")
        ? 300
        : this.dataset.measure === "more"
          ? 160
          : buttonWidth();
      return {
        width,
        height: 30,
        x: 0,
        y: 0,
        top: 0,
        left: 0,
        right: width,
        bottom: 30,
        toJSON: () => ({}),
      };
    },
  );
}

it("показывает скрытый активный раздел, не меняя границу при выборе", () => {
  dimensions(() => 100);
  const { container, rerender } = renderComponent(
    <WorkspaceNav items={items} active="media" onSelect={vi.fn()} />,
  );
  const summary = screen.getByLabelText("Ещё разделы");
  expect(summary).toHaveTextContent("Файлы");
  expect(summary).toHaveAttribute("title", "Открыт раздел: Файлы");
  const before = Array.from(
    container.querySelectorAll(".workspace-nav__item"),
    (node) => node.textContent,
  );
  const width = summary.style.width;
  rerender(<WorkspaceNav items={items} active="tokens" onSelect={vi.fn()} />);
  expect(summary).toHaveTextContent("Токены");
  expect(summary.style.width).toBe(width);
  expect(
    Array.from(
      container.querySelectorAll(".workspace-nav__item"),
      (node) => node.textContent,
    ),
  ).toEqual(before);
});

it("переизмеряет подписи после fonts.ready и loadingdone", async () => {
  let buttonWidth = 60;
  dimensions(() => buttonWidth);
  let ready!: () => void;
  const fonts = new EventTarget();
  Object.assign(fonts, {
    ready: new Promise<void>((resolve) => {
      ready = resolve;
    }),
  });
  Object.defineProperty(document, "fonts", {
    configurable: true,
    value: fonts,
  });
  const { container } = renderComponent(
    <WorkspaceNav items={items} active={null} onSelect={vi.fn()} />,
  );
  expect(container.querySelectorAll(".workspace-nav__item")).toHaveLength(3);
  buttonWidth = 100;
  await act(async () => ready());
  expect(container.querySelectorAll(".workspace-nav__item")).toHaveLength(1);
  buttonWidth = 60;
  await act(async () => fonts.dispatchEvent(new Event("loadingdone")));
  expect(container.querySelectorAll(".workspace-nav__item")).toHaveLength(3);
});

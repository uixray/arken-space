// @vitest-environment jsdom
import { act } from "react";
import { afterEach, expect, it, vi } from "vitest";
import { renderComponent, screen, userEvent } from "./test-support/render";
import { WorkspaceNav } from "./WorkspaceNav";
import { workspaceNavItems, type WorkspaceNavItem } from "./workspace-nav";

const items: WorkspaceNavItem[] = [
  { id: "characters", label: "Персонажи" },
  { id: "tokens", label: "Токены" },
  { id: "media", label: "Файлы" },
];
const originalFonts = Object.getOwnPropertyDescriptor(document, "fonts");
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  if (originalFonts) Object.defineProperty(document, "fonts", originalFonts);
  else Reflect.deleteProperty(document, "fonts");
});

function dimensions(buttonWidth: () => number, rowWidth = () => 300) {
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(
    function (this: HTMLElement) {
      const width = this.classList.contains("workspace-nav")
        ? rowWidth()
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

it("keeps one observer while remeasuring renders, resize and observer deliveries", () => {
  let rowWidth = 300;
  dimensions(
    () => 100,
    () => rowWidth,
  );
  let deliver!: ResizeObserverCallback;
  const observe = vi.fn();
  const disconnect = vi.fn();
  const created = vi.fn();
  class Observer {
    constructor(callback: ResizeObserverCallback) {
      deliver = callback;
      created();
    }
    observe = observe;
    disconnect = disconnect;
    unobserve = vi.fn();
  }
  vi.stubGlobal("ResizeObserver", Observer);
  const { container, rerender, unmount } = renderComponent(
    <WorkspaceNav items={items} active={null} onSelect={vi.fn()} />,
  );
  expect(created).toHaveBeenCalledTimes(1);
  expect(observe).toHaveBeenCalledTimes(1);
  expect(container.querySelectorAll(".workspace-nav__item")).toHaveLength(1);
  // A render still measures when an embedded browser never delivers RO.
  rowWidth = 600;
  rerender(<WorkspaceNav items={items} active="tokens" onSelect={vi.fn()} />);
  expect(container.querySelectorAll(".workspace-nav__item")).toHaveLength(3);
  rowWidth = 300;
  act(() => window.dispatchEvent(new Event("resize")));
  expect(container.querySelectorAll(".workspace-nav__item")).toHaveLength(1);
  rowWidth = 600;
  act(() => deliver([], {} as ResizeObserver));
  expect(container.querySelectorAll(".workspace-nav__item")).toHaveLength(3);
  expect(created).toHaveBeenCalledTimes(1);
  expect(observe).toHaveBeenCalledTimes(1);
  expect(disconnect).not.toHaveBeenCalled();
  unmount();
  expect(disconnect).toHaveBeenCalledTimes(1);
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

it("UIX-423 выбирает редактор и справочник по различимым названиям без смены маршрутов", async () => {
  dimensions(() => 100);
  const user = userEvent.setup();
  const onSelect = vi.fn();
  renderComponent(
    <WorkspaceNav
      items={workspaceNavItems({ isGm: true, operatorFeedbackAllowed: false })}
      active={null}
      onSelect={onSelect}
    />,
  );
  await user.click(screen.getByLabelText("Ещё разделы"));
  await user.click(screen.getByRole("button", { name: "Редактор мира" }));
  expect(onSelect).toHaveBeenNthCalledWith(1, "world-encyclopedia");
  await user.click(screen.getByLabelText("Ещё разделы"));
  await user.click(screen.getByRole("button", { name: "Справочник мира" }));
  expect(onSelect).toHaveBeenNthCalledWith(2, "world-codex");
});

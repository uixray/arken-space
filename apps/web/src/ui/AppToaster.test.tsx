// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import {
  act,
  fireEvent,
  renderComponent,
  screen,
} from "../test-support/render";
import { AppToaster } from "./AppToaster";
import { Toaster } from "./toaster";

/** UIX-709: the app's own toaster replaces Gravity's; same markup hooks. */
afterEach(() => vi.useRealTimers());

function setup() {
  const toaster = new Toaster();
  renderComponent(<AppToaster toaster={toaster} />);
  return toaster;
}

const toastByTitle = (title: string) =>
  screen.queryByText(title)?.closest(".g-toast") ?? null;

it("renders title, message and theme, and replaces a toast with the same name", () => {
  const toaster = setup();
  act(() =>
    toaster.add({
      name: "save",
      title: "Не удалось сохранить",
      content: "Сервер недоступен",
      theme: "danger",
    }),
  );
  const toast = toastByTitle("Не удалось сохранить");
  expect(toast).toHaveClass("g-toast_theme_danger");
  expect(screen.getByText("Сервер недоступен")).toHaveClass("g-toast__content");
  expect(toast?.closest(".g-toaster")).toHaveAttribute(
    "aria-live",
    "assertive",
  );

  act(() =>
    toaster.add({ name: "save", title: "Сохранено", theme: "success" }),
  );
  expect(toaster.getSnapshot()).toHaveLength(1);
  expect(toastByTitle("Сохранено")).toHaveClass("g-toast_theme_success");
});

it("hides itself after the timeout, but not while hovered", () => {
  vi.useFakeTimers();
  const toaster = setup();
  act(() => toaster.add({ name: "a", title: "Готово", autoHiding: 1000 }));
  const toast = toastByTitle("Готово")!;

  fireEvent.mouseOver(toast);
  act(() => vi.advanceTimersByTime(5000));
  expect(toaster.has("a")).toBe(true);

  fireEvent.mouseLeave(toast);
  act(() => vi.advanceTimersByTime(1000));
  expect(toaster.has("a")).toBe(false);
  // The exit animation never ends in jsdom; the fallback removes the node.
  act(() => vi.advanceTimersByTime(1000));
  expect(toastByTitle("Готово")).toBeNull();
});

it("keeps a toast with autoHiding false until it is closed", () => {
  vi.useFakeTimers();
  const toaster = setup();
  act(() => toaster.add({ name: "b", title: "Ошибка", autoHiding: false }));
  act(() => vi.advanceTimersByTime(60_000));
  expect(toaster.has("b")).toBe(true);

  fireEvent.click(screen.getByRole("button", { name: "Закрыть" }));
  expect(toaster.has("b")).toBe(false);
});

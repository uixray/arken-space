// @vitest-environment jsdom
import { useRef } from "react";
import { describe, expect, it, vi } from "vitest";
import {
  fireEvent,
  renderComponent,
  screen,
  waitFor,
} from "../test-support/render";
import { useDismissibleDetails } from "./dismissible-details";

/**
 * UIX-531 — поведение самого механизма закрытия.
 *
 * До сих пор оно проверялось только через `MusicBar`: если бы тот перестал
 * использовать хук, проверка исчезла бы вместе с ним, а десять остальных
 * поповеров остались бы без единого поведенческого теста. Здесь хук проверяется
 * сам по себе, без компонента, который его случайно держит.
 *
 * Соседний `dismissible-popovers.test.ts` отвечает на другой вопрос — что хук
 * действительно подключён к каждому поповеру. Вместе они дают и «механизм
 * работает», и «механизм применён»; поодиночке — ни того, ни другого.
 */
function Popover({ onDismiss }: { onDismiss?: () => void }) {
  const ref = useRef<HTMLDetailsElement>(null);
  useDismissibleDetails(ref, onDismiss);
  return (
    <details className="probe" ref={ref} open>
      <summary>Открыть</summary>
      <button type="button">Внутри</button>
    </details>
  );
}

const render = (onDismiss?: () => void) => {
  renderComponent(<Popover onDismiss={onDismiss} />);
  return document.querySelector<HTMLDetailsElement>("details.probe")!;
};

describe("механизм закрытия поповера", () => {
  it("закрывается по указателю снаружи", () => {
    const details = render();
    const outside = document.createElement("button");
    document.body.append(outside);

    fireEvent.pointerDown(outside);

    expect(details.open).toBe(false);
  });

  it("закрывается по Escape и возвращает фокус на кнопку открытия", () => {
    // Возврат фокуса — не украшение: закрыв поповер с клавиатуры, человек
    // иначе теряет место в порядке обхода и начинает его сначала.
    const details = render();
    fireEvent.keyDown(document, { key: "Escape" });

    expect(details.open).toBe(false);
    expect(document.activeElement).toBe(details.querySelector("summary"));
  });

  it("не закрывается по указателю внутри — иначе им нельзя пользоваться", () => {
    const details = render();
    fireEvent.pointerDown(details.querySelector("button")!);

    expect(details.open).toBe(true);
  });

  it("сообщает о закрытии наружу, когда об этом попросили", () => {
    // `grid-settings` через этот колбэк сбрасывает черновик настроек сетки:
    // молча закрытый поповер оставил бы его в полуприменённом виде.
    const onDismiss = vi.fn();
    render(onDismiss);
    fireEvent.keyDown(document, { key: "Escape" });

    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it("leaves an already consumed Escape and its focus with the child control", () => {
    const onDismiss = vi.fn();
    const details = render(onDismiss);
    const child = details.querySelector("button")!;
    child.focus();
    child.addEventListener("keydown", (event) => event.preventDefault());

    fireEvent.keyDown(child, { key: "Escape" });

    expect(details.open).toBe(true);
    expect(child).toHaveFocus();
    expect(onDismiss).not.toHaveBeenCalled();
  });

  it("does not steal Escape or focus from a different dialog", () => {
    const onDismiss = vi.fn();
    const details = render(onDismiss);
    const view = renderComponent(
      <section role="dialog" aria-label="Другое окно">
        <button>В другом окне</button>
      </section>,
    );
    const button = screen.getByRole("button", { name: "В другом окне" });
    button.focus();

    fireEvent.keyDown(button, { key: "Escape" });

    expect(details.open).toBe(true);
    expect(button).toHaveFocus();
    expect(onDismiss).not.toHaveBeenCalled();
    view.unmount();
  });
  it("still closes its own menu inside a dialog", () => {
    renderComponent(
      <section role="dialog" aria-label="Владелец">
        <Popover />
      </section>,
    );
    const details =
      document.querySelector<HTMLDetailsElement>("details.probe")!;
    fireEvent.keyDown(details.querySelector("button")!, { key: "Escape" });
    expect(details.open).toBe(false);
    expect(details.querySelector("summary")).toHaveFocus();
  });

  it("cleans up a hidden menu without taking focus or consuming Escape", () => {
    const details = render();
    details.hidden = true;
    const outside = screen.getByText("Открыть").parentElement!.parentElement!;
    const event = new KeyboardEvent("keydown", {
      key: "Escape",
      bubbles: true,
      cancelable: true,
    });
    fireEvent(outside, event);
    expect(details.open).toBe(false);
    expect(details.querySelector("summary")).not.toHaveFocus();
    expect(event.defaultPrevented).toBe(false);
  });
  it("dismisses an open menu when resize hides its trigger", async () => {
    const onDismiss = vi.fn();
    const details = render(onDismiss);
    const trigger = details.querySelector("summary")!;
    vi.spyOn(trigger, "getClientRects").mockReturnValue(
      [] as unknown as DOMRectList,
    );
    fireEvent(window, new Event("resize"));
    await waitFor(() => expect(details.open).toBe(false));
    expect(onDismiss).toHaveBeenCalledTimes(1);
    expect(trigger).not.toHaveFocus();
  });

  it("keeps a still-visible mixed-control menu open during resize", async () => {
    const details = render();
    const trigger = details.querySelector("summary")!;
    vi.spyOn(trigger, "getClientRects").mockReturnValue([
      {},
    ] as unknown as DOMRectList);
    fireEvent(window, new Event("resize"));
    await new Promise<void>((resolve) =>
      requestAnimationFrame(() => resolve()),
    );
    expect(details.open).toBe(true);
  });
  it("не трогает уже закрытый поповер", () => {
    // Иначе Escape в любом месте приложения дёргал бы `onDismiss` у каждого
    // смонтированного поповера разом.
    const onDismiss = vi.fn();
    const details = render(onDismiss);
    details.open = false;

    fireEvent.keyDown(document, { key: "Escape" });

    expect(onDismiss).not.toHaveBeenCalled();
  });
});

function Listbox({ visible = true }: { visible?: boolean }) {
  const ref = useRef<HTMLDetailsElement>(null);
  useDismissibleDetails(ref, undefined, {
    listbox: true,
    closeOnViewportChange: true,
  });
  return visible ? (
    <details ref={ref}>
      <summary>Сцена</summary>
      <div role="listbox" aria-label="Сцены">
        <button role="option" aria-selected={false}>
          Первая
        </button>
        <button role="option" aria-selected={true}>
          Вторая
        </button>
        <button role="option" aria-selected={false}>
          Третья
        </button>
      </div>
    </details>
  ) : null;
}

describe("UIX-644 opt-in details listbox", () => {
  it("binds after delayed bootstrap and navigates the selected option", () => {
    const view = renderComponent(<Listbox visible={false} />);
    view.rerender(<Listbox />);
    const trigger = screen.getByText("Сцена");
    fireEvent.keyDown(trigger, { key: "ArrowDown" });
    expect(document.querySelector("details")?.open).toBe(true);
    expect(screen.getByRole("option", { name: "Вторая" })).toHaveFocus();
    fireEvent.keyDown(document.activeElement!, { key: "End" });
    expect(screen.getByRole("option", { name: "Третья" })).toHaveFocus();
    fireEvent.keyDown(document.activeElement!, { key: "Home" });
    expect(screen.getByRole("option", { name: "Первая" })).toHaveFocus();
    fireEvent(document.querySelector("details")!, new Event("toggle"));
    expect(screen.getByRole("option", { name: "Первая" })).toHaveAttribute(
      "tabindex",
      "0",
    );
    fireEvent.keyDown(document.activeElement!, { key: "ArrowUp" });
    expect(screen.getByRole("option", { name: "Третья" })).toHaveFocus();
    fireEvent.keyDown(document.activeElement!, { key: "Escape" });
    expect(document.querySelector("details")?.open).toBe(false);
    expect(trigger).toHaveFocus();
    expect(trigger).toHaveAttribute("aria-expanded", "false");
  });

  it("closes on resize and focus leaving, but permits internal scrolling", () => {
    renderComponent(<Listbox />);
    const trigger = screen.getByText("Сцена");
    fireEvent.keyDown(trigger, { key: "ArrowDown" });
    fireEvent.scroll(screen.getByRole("listbox"));
    expect(document.querySelector("details")?.open).toBe(true);
    const sibling = document.createElement("div");
    document.querySelector("details")!.after(sibling);
    fireEvent.scroll(sibling);
    expect(document.querySelector("details")?.open).toBe(true);
    sibling.remove();
    fireEvent.scroll(document.querySelector("details")!.parentElement!);
    expect(document.querySelector("details")?.open).toBe(false);
    fireEvent.keyDown(trigger, { key: "ArrowDown" });
    fireEvent(window, new Event("resize"));
    expect(document.querySelector("details")?.open).toBe(false);
    fireEvent.keyDown(trigger, { key: "ArrowDown" });
    fireEvent.focusIn(document.body);
    expect(document.querySelector("details")?.open).toBe(false);
  });
});

it.each(["hidden", "inert"])(
  "closes a mounted owner on %s without moving focus, and watches a later reopen",
  async (attribute) => {
    const onDismiss = vi.fn();
    const rendered = renderComponent(
      <>
        <button type="button">Next surface</button>
        <section data-testid="owner">
          <Popover onDismiss={onDismiss} />
        </section>
      </>,
    );
    const owner = rendered.getByTestId("owner");
    const details = owner.querySelector("details")!;
    const next = screen.getByRole("button", { name: "Next surface" });
    next.focus();
    owner.setAttribute(attribute, "");
    await waitFor(() => expect(details.open).toBe(false));
    expect(onDismiss).toHaveBeenCalledTimes(1);
    expect(next).toHaveFocus();
    owner.removeAttribute(attribute);
    expect(details.open).toBe(false);
    details.open = true;
    fireEvent(details, new Event("toggle"));
    owner.setAttribute(attribute, "");
    await waitFor(() => expect(details.open).toBe(false));
    expect(onDismiss).toHaveBeenCalledTimes(2);
    expect(next).toHaveFocus();
  },
);

it("closes an initially open details already under a hidden owner", async () => {
  const onDismiss = vi.fn();
  const rendered = renderComponent(
    <section hidden>
      <Popover onDismiss={onDismiss} />
    </section>,
  );
  expect(rendered.container.querySelector("details")!.open).toBe(false);
  expect(onDismiss).toHaveBeenCalledTimes(1);
});

it("rechecks current visibility rather than dismissing on a removed attribute record", async () => {
  const onDismiss = vi.fn();
  const rendered = renderComponent(
    <section>
      <Popover onDismiss={onDismiss} />
    </section>,
  );
  const owner = rendered.container.querySelector("section")!;
  const details = owner.querySelector("details")!;
  owner.hidden = true;
  owner.hidden = false;
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(details.open).toBe(true);
  expect(onDismiss).not.toHaveBeenCalled();
  details.hidden = true;
  await waitFor(() => expect(details.open).toBe(false));
  expect(onDismiss).toHaveBeenCalledTimes(1);
});

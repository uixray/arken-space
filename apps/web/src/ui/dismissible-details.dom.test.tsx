// @vitest-environment jsdom
import { useRef } from "react";
import { describe, expect, it, vi } from "vitest";
import { fireEvent, renderComponent } from "../test-support/render";
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

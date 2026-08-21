// @vitest-environment jsdom
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  act,
  fireEvent,
  renderComponent,
  screen,
} from "../test-support/render";
import { ResourceCounters } from "./ResourceCounters";
import { RESOURCE_ADJUST_DELAY_MS } from "../resource-regen";
import type { ResourceCounterIntent } from "../resource-counter-intent";

vi.mock("@gravity-ui/uikit", () => ({
  Button: ({
    disabled,
    onClick,
    children,
    ...rest
  }: {
    disabled?: boolean;
    onClick?: () => void;
    children?: ReactNode;
    "aria-label"?: string;
    title?: string;
  }) => (
    <button
      type="button"
      disabled={disabled}
      aria-label={rest["aria-label"]}
      onClick={onClick}
    >
      {children}
    </button>
  ),
  // UIX-468: ручной ввод очков идёт через `FormInput`, а тот — через
  // `TextInput`. Без этой заглушки поле не отрисовалось бы вовсе.
  TextInput: (props: Record<string, unknown>) => <input {...props} />,
  Checkbox: () => null,
  Select: () => null,
  TextArea: () => null,
}));

/**
 * UIX-424, шаг 8. Счётчики стоят там, где раньше были снятые кнопки бросков, и
 * тратятся каждый ход — поэтому проверяется не отрисовка, а границы: за ноль и
 * за максимум уходить нельзя, и правит их только тот, кто ведёт персонажа.
 *
 * UIX-468 добавил накопление нажатий и восстановление. Главное здесь — откат:
 * показанное до ответа число обязано вернуться к серверному, если сервер отказал.
 */
const rows = [
  { key: "physicalPower", label: "Выносливость" },
  { key: "magicPower", label: "Мана" },
];

/** Реген берётся из `RESOURCE_REGEN_STAT`: physicalPower → enduranceRegen. */
const stats = { enduranceRegen: 3, manaRegen: 2 };

function deferred<T = void>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

const renderCounters = (
  overrides: Partial<Parameters<typeof ResourceCounters>[0]> = {},
) => {
  const props = {
    scopeKey: "character-a",
    rows,
    resources: {
      physicalPower: { current: 4, maximum: 10 },
      magicPower: { current: 0, maximum: 6 },
    },
    stats,
    editable: true,
    onSpend: vi.fn(() => Promise.resolve()),
    ...overrides,
  };
  renderComponent(<ResourceCounters {...props} />);
  return props;
};

const enduranceInput = () =>
  screen.getByRole("spinbutton", { name: "Очки: Выносливость" });

describe("счётчики ресурсов", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("показывает остаток вместе с максимумом", () => {
    // Тратящему важно не само число, а сколько осталось до нуля.
    renderCounters();
    expect(screen.getByText("Выносливость")).toBeInTheDocument();
    expect(enduranceInput()).toHaveValue(4);
    expect(screen.getByText("10")).toBeInTheDocument();
  });

  it("копит нажатия ±1 и отправляет одной правкой", async () => {
    const props = renderCounters();
    const spend = screen.getByRole("button", {
      name: "Потратить одно очко: Выносливость",
    });
    // Клики в одном `act` — то есть без перерисовки между ними, как при
    // быстрой серии щелчков мышью. Через `fireEvent` по одному компонент
    // успевает перерисоваться, и ошибка «каждое нажатие считает от одного и
    // того же числа» не воспроизводится: три «−1» давали −1 вместо −3.
    act(() => {
      spend.click();
      spend.click();
      spend.click();
    });

    // На экране уже 1: счётчик не должен отставать от руки.
    expect(enduranceInput()).toHaveValue(1);

    // Ровно до конца паузы сервер не тревожат. Проверяется именно этот момент,
    // а не «вызова ещё не было»: без него тест одинаково проходил бы и с
    // задержкой в 600 мс, и с отправкой на ближайшем тике — то есть не проверял
    // бы накопление вовсе.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(RESOURCE_ADJUST_DELAY_MS - 1);
    });
    expect(props.onSpend).not.toHaveBeenCalled();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1);
    });
    expect(props.onSpend).toHaveBeenCalledTimes(1);
    expect(props.onSpend).toHaveBeenCalledWith({
      key: "physicalPower",
      kind: "DELTA",
      delta: -3,
    });
  });

  it("отправляет фактическую дельту после обрезки по нижней границе", async () => {
    const props = renderCounters({
      rows: [rows[0]!],
      resources: { physicalPower: { current: 1, maximum: 10 } },
    });
    const spend = screen.getByRole("button", {
      name: "Потратить одно очко: Выносливость",
    });
    act(() => {
      spend.click();
      spend.click();
      spend.click();
    });

    expect(enduranceInput()).toHaveValue(0);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(RESOURCE_ADJUST_DELAY_MS);
    });
    expect(props.onSpend).toHaveBeenCalledWith({
      key: "physicalPower",
      kind: "DELTA",
      delta: -1,
    });
  });

  it("отправляет фактическую дельту после обрезки по верхней границе", async () => {
    const props = renderCounters({
      rows: [rows[0]!],
      resources: { physicalPower: { current: 9, maximum: 10 } },
    });
    const restore = screen.getByRole("button", {
      name: "Вернуть одно очко: Выносливость",
    });
    act(() => {
      restore.click();
      restore.click();
      restore.click();
    });

    expect(enduranceInput()).toHaveValue(10);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(RESOURCE_ADJUST_DELAY_MS);
    });
    expect(props.onSpend).toHaveBeenCalledWith({
      key: "physicalPower",
      kind: "DELTA",
      delta: 1,
    });
  });

  it("завершение старого запроса не снимает новый draft и таймер", async () => {
    const first = deferred();
    const second = deferred();
    const onSpend = vi
      .fn<(intent: ResourceCounterIntent) => Promise<void>>()
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(second.promise);
    renderCounters({ onSpend });
    const spend = screen.getByRole("button", {
      name: "Потратить одно очко: Выносливость",
    });

    fireEvent.click(spend);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(RESOURCE_ADJUST_DELAY_MS);
    });
    expect(onSpend).toHaveBeenCalledTimes(1);
    expect(spend).toBeEnabled();

    fireEvent.click(spend);
    expect(enduranceInput()).toHaveValue(2);
    await act(async () => {
      first.resolve();
      await first.promise;
    });
    expect(enduranceInput()).toHaveValue(2);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(RESOURCE_ADJUST_DELAY_MS);
    });
    expect(onSpend).toHaveBeenNthCalledWith(2, {
      key: "physicalPower",
      kind: "DELTA",
      delta: -1,
    });
    second.resolve();
  });

  it("сохраняет таймер в области исходного персонажа при переключении", async () => {
    const request = deferred();
    const onSpendA = vi.fn(() => request.promise);
    const onSpendB = vi.fn(() => Promise.resolve());
    const common = {
      rows: [rows[0]!],
      stats,
      editable: true,
    };
    const { rerender } = renderComponent(
      <ResourceCounters
        {...common}
        scopeKey="character-a"
        resources={{ physicalPower: { current: 4, maximum: 10 } }}
        onSpend={onSpendA}
      />,
    );

    fireEvent.click(
      screen.getByRole("button", {
        name: "Потратить одно очко: Выносливость",
      }),
    );
    expect(enduranceInput()).toHaveValue(3);

    // Персонаж B не видит draft A, но переключение не размонтирует компонент
    // и не отменяет уже принятое для A действие.
    rerender(
      <ResourceCounters
        {...common}
        scopeKey="character-b"
        resources={{ physicalPower: { current: 7, maximum: 10 } }}
        onSpend={onSpendB}
      />,
    );
    expect(enduranceInput()).toHaveValue(7);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(RESOURCE_ADJUST_DELAY_MS);
    });
    expect(onSpendA).toHaveBeenCalledTimes(1);
    expect(onSpendA).toHaveBeenCalledWith({
      key: "physicalPower",
      kind: "DELTA",
      delta: -1,
    });
    expect(onSpendB).not.toHaveBeenCalled();
    expect(enduranceInput()).toHaveValue(7);

    // Пока запрос A не завершился, возврат к A показывает его optimistic draft.
    rerender(
      <ResourceCounters
        {...common}
        scopeKey="character-a"
        resources={{ physicalPower: { current: 4, maximum: 10 } }}
        onSpend={onSpendA}
      />,
    );
    expect(enduranceInput()).toHaveValue(3);
    await act(async () => {
      request.resolve();
      await request.promise;
    });
    expect(enduranceInput()).toHaveValue(4);
  });

  it("отправляет накопленный DELTA при размонтировании панели", async () => {
    const onSpend = vi.fn();
    const { unmount } = renderComponent(
      <ResourceCounters
        scopeKey="character-a"
        rows={[rows[0]!]}
        resources={{ physicalPower: { current: 4, maximum: 10 } }}
        stats={stats}
        editable
        onSpend={onSpend}
      />,
    );
    fireEvent.click(
      screen.getByRole("button", {
        name: "Потратить одно очко: Выносливость",
      }),
    );

    unmount();
    expect(onSpend).toHaveBeenCalledTimes(1);
    expect(onSpend).toHaveBeenCalledWith({
      key: "physicalPower",
      kind: "DELTA",
      delta: -1,
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(RESOURCE_ADJUST_DELAY_MS);
    });
    expect(onSpend).toHaveBeenCalledTimes(1);
  });

  it("не восстанавливает завершившийся старый draft после отмены новой серии", async () => {
    const first = deferred();
    const onSpend = vi.fn(() => first.promise);
    renderCounters({ onSpend });
    const spend = screen.getByRole("button", {
      name: "Потратить одно очко: Выносливость",
    });
    const restore = screen.getByRole("button", {
      name: "Вернуть одно очко: Выносливость",
    });

    fireEvent.click(spend);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(RESOURCE_ADJUST_DELAY_MS);
    });
    fireEvent.click(spend);
    expect(enduranceInput()).toHaveValue(2);

    await act(async () => {
      first.resolve();
      await first.promise;
    });
    fireEvent.click(restore);

    // Новые -1/+1 взаимно отменились. Generation первого запроса уже завершён,
    // поэтому его optimistic 3 нельзя вернуть навсегда поверх canonical props.
    expect(enduranceInput()).toHaveValue(4);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(RESOURCE_ADJUST_DELAY_MS);
    });
    expect(onSpend).toHaveBeenCalledTimes(1);
  });

  it("возвращает серверное значение, когда сервер отказал", async () => {
    // Оптимистичный показ без отката — это экран, показывающий то, чего в базе
    // нет. Проверяется отказом маршрута, а не глазами.
    const onSpend = vi.fn(() =>
      Promise.reject(new Error("CHARACTER_CONFLICT")),
    );
    renderCounters({ onSpend });

    fireEvent.click(
      screen.getByRole("button", { name: "Потратить одно очко: Выносливость" }),
    );
    expect(enduranceInput()).toHaveValue(3);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(RESOURCE_ADJUST_DELAY_MS);
    });
    expect(onSpend).toHaveBeenCalledTimes(1);
    // 4 — то, что лежит в `resources`, то есть серверное.
    expect(enduranceInput()).toHaveValue(4);
  });

  it("восстанавливает на величину регена из карточки", async () => {
    // Та же величина, которую берёт отдых: реген выносливости 3 → 4 + 3.
    const props = renderCounters();
    fireEvent.click(
      screen.getByRole("button", { name: "Восстановить 3: Выносливость" }),
    );
    expect(props.onSpend).toHaveBeenCalledTimes(1);
    expect(props.onSpend).toHaveBeenCalledWith({
      key: "physicalPower",
      kind: "DELTA",
      delta: 3,
    });
  });

  it("не восстанавливает сверх максимума", async () => {
    const props = renderCounters({
      rows: [rows[0]!],
      resources: { physicalPower: { current: 9, maximum: 10 } },
    });
    fireEvent.click(
      screen.getByRole("button", { name: "Восстановить 3: Выносливость" }),
    );
    expect(props.onSpend).toHaveBeenCalledWith({
      key: "physicalPower",
      kind: "DELTA",
      delta: 1,
    });
  });

  it("восстанавливает ману её собственной величиной регена", () => {
    const props = renderCounters();
    fireEvent.click(
      screen.getByRole("button", { name: "Восстановить 2: Мана" }),
    );
    expect(props.onSpend).toHaveBeenCalledWith({
      key: "magicPower",
      kind: "DELTA",
      delta: 2,
    });
  });

  it("объединяет ещё не отправленную трату с немедленным регеном", async () => {
    const props = renderCounters();
    fireEvent.click(
      screen.getByRole("button", {
        name: "Потратить одно очко: Выносливость",
      }),
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Восстановить 3: Выносливость" }),
    );

    expect(enduranceInput()).toHaveValue(6);
    expect(props.onSpend).toHaveBeenCalledTimes(1);
    expect(props.onSpend).toHaveBeenCalledWith({
      key: "physicalPower",
      kind: "DELTA",
      delta: 2,
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(RESOURCE_ADJUST_DELAY_MS);
    });
    expect(props.onSpend).toHaveBeenCalledTimes(1);
  });

  it("не предлагает восстановление ресурсу без строки регена", () => {
    // «На величину регена» у неизвестного ресурса величины не имеет — кнопка,
    // которая не знает, на сколько восстанавливать, хуже её отсутствия.
    renderCounters({
      rows: [{ key: "focus", label: "Сосредоточенность" }],
      resources: { focus: { current: 1, maximum: 4 } },
    });
    expect(
      screen.queryByRole("button", { name: /Восстановить/ }),
    ).not.toBeInTheDocument();
  });

  it.each([
    ["нулевой", 0],
    ["отрицательный", -2],
  ])("не предлагает %s реген", (_label, enduranceRegen) => {
    renderCounters({
      rows: [rows[0]!],
      stats: { enduranceRegen },
    });
    expect(
      screen.queryByRole("button", { name: /Восстановить/ }),
    ).not.toBeInTheDocument();
  });

  it("принимает значение, введённое числом", async () => {
    const props = renderCounters();
    const input = enduranceInput();
    fireEvent.change(input, { target: { value: "8" } });
    fireEvent.blur(input);
    expect(props.onSpend).toHaveBeenCalledWith({
      key: "physicalPower",
      kind: "SET",
      value: 8,
    });
  });

  it("после Enter следующий blur не повторяет SET", () => {
    const props = renderCounters();
    const input = enduranceInput();
    fireEvent.change(input, { target: { value: "8" } });
    fireEvent.keyDown(input, { key: "Enter" });
    fireEvent.blur(input);
    expect(props.onSpend).toHaveBeenCalledTimes(1);
  });

  it("не отправляет неизменённое значение при blur", () => {
    const props = renderCounters();
    fireEvent.blur(enduranceInput());
    expect(props.onSpend).not.toHaveBeenCalled();
  });

  it("держит быстрый ручной ввод optimistic и откатывает после отказа", async () => {
    const request = deferred();
    const onSpend = vi.fn(() => request.promise);
    renderCounters({ onSpend });
    const input = enduranceInput();

    fireEvent.change(input, { target: { value: "8" } });
    fireEvent.blur(input);
    expect(enduranceInput()).toHaveValue(8);

    await act(async () => {
      request.reject(new Error("CHARACTER_CONFLICT"));
      await request.promise.catch(() => undefined);
    });
    expect(enduranceInput()).toHaveValue(4);
  });

  it("обрезает введённое число по границам ресурса", async () => {
    const props = renderCounters();
    const input = enduranceInput();
    fireEvent.change(input, { target: { value: "99" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(props.onSpend).toHaveBeenCalledWith({
      key: "physicalPower",
      kind: "SET",
      value: 10,
    });
  });

  it("не даёт уйти ниже нуля и выше максимума", () => {
    // Ограничение здесь, а не только на сервере: иначе счётчик уводит в минус
    // на глазах, а отказ приходит позже.
    renderCounters();
    expect(
      screen.getByRole("button", { name: "Потратить одно очко: Мана" }),
    ).toBeDisabled();
    expect(
      screen.getByRole("button", { name: "Вернуть одно очко: Выносливость" }),
    ).toBeEnabled();
  });

  it("не даёт править ресурсы тому, кто не ведёт персонажа", () => {
    renderCounters({ editable: false });
    for (const button of screen.getAllByRole("button"))
      expect(button).toBeDisabled();
    expect(enduranceInput()).toBeDisabled();
  });

  it("сворачивается целиком", async () => {
    // Вне боя две строки не меняются часами, а место занимают.
    renderCounters();
    const block = document.querySelector("details.resource-counters");
    expect(block).toHaveAttribute("open");
    fireEvent.click(screen.getByText("Ресурсы"));
    expect(block).not.toHaveAttribute("open");
  });

  it("не показывает ничего, когда ресурсов в раскладке нет", () => {
    // Мастер может убрать строки-ресурсы совсем; пустая рамка в панели была бы
    // мусором.
    const { container } = renderComponent(
      <ResourceCounters
        scopeKey="character-a"
        rows={[]}
        resources={{}}
        stats={{}}
        editable
        onSpend={vi.fn()}
      />,
    );
    expect(container.querySelector(".resource-counters")).toBeNull();
  });

  it("берёт подписи из раскладки, а не из ключей", () => {
    // Мастер переименовал ресурс — счётчик обязан показать его имя.
    renderCounters({
      rows: [{ key: "physicalPower", label: "Дыхание" }],
      resources: { physicalPower: { current: 2, maximum: 3 } },
    });
    expect(screen.getByText("Дыхание")).toBeInTheDocument();
  });
});

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

const renderCounters = (
  overrides: Partial<Parameters<typeof ResourceCounters>[0]> = {},
) => {
  const props = {
    rows,
    resources: {
      physicalPower: { current: 4, maximum: 10 },
      magicPower: { current: 0, maximum: 6 },
    },
    stats,
    editable: true,
    pending: false,
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
    expect(props.onSpend).toHaveBeenCalledWith("physicalPower", 1);
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
    expect(props.onSpend).toHaveBeenCalledWith("physicalPower", 7);
  });

  it("не восстанавливает сверх максимума", async () => {
    const props = renderCounters({
      rows: [rows[0]!],
      resources: { physicalPower: { current: 9, maximum: 10 } },
    });
    fireEvent.click(
      screen.getByRole("button", { name: "Восстановить 3: Выносливость" }),
    );
    expect(props.onSpend).toHaveBeenCalledWith("physicalPower", 10);
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

  it("принимает значение, введённое числом", async () => {
    const props = renderCounters();
    const input = enduranceInput();
    fireEvent.change(input, { target: { value: "8" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(props.onSpend).toHaveBeenCalledWith("physicalPower", 8);
  });

  it("обрезает введённое число по границам ресурса", async () => {
    const props = renderCounters();
    const input = enduranceInput();
    fireEvent.change(input, { target: { value: "99" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(props.onSpend).toHaveBeenCalledWith("physicalPower", 10);
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
        rows={[]}
        resources={{}}
        stats={{}}
        editable
        pending={false}
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

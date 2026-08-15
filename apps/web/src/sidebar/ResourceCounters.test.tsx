// @vitest-environment jsdom
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import { renderComponent, screen, userEvent } from "../test-support/render";
import { ResourceCounters } from "./ResourceCounters";

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
}));

/**
 * UIX-424, шаг 8. Счётчики стоят там, где раньше были снятые кнопки бросков, и
 * тратятся каждый ход — поэтому проверяется не отрисовка, а границы: за ноль и
 * за максимум уходить нельзя, и правит их только тот, кто ведёт персонажа.
 */
const rows = [
  { key: "physicalPower", label: "Выносливость" },
  { key: "magicPower", label: "Мана" },
];

const renderCounters = (
  overrides: Partial<Parameters<typeof ResourceCounters>[0]> = {},
) => {
  const props = {
    rows,
    resources: {
      physicalPower: { current: 4, maximum: 10 },
      magicPower: { current: 0, maximum: 6 },
    },
    editable: true,
    pending: false,
    onSpend: vi.fn(),
    ...overrides,
  };
  renderComponent(<ResourceCounters {...props} />);
  return props;
};

describe("счётчики ресурсов", () => {
  it("показывает остаток вместе с максимумом", () => {
    // Тратящему важно не само число, а сколько осталось до нуля.
    renderCounters();
    expect(screen.getByText("Выносливость")).toBeInTheDocument();
    expect(screen.getByText("4")).toBeInTheDocument();
    expect(screen.getByText("10")).toBeInTheDocument();
  });

  it("тратит и возвращает по одному очку", async () => {
    const props = renderCounters();
    await userEvent.click(
      screen.getByRole("button", {
        name: "Потратить одно очко: Выносливость",
      }),
    );
    expect(props.onSpend).toHaveBeenCalledWith("physicalPower", 3);

    await userEvent.click(
      screen.getByRole("button", { name: "Вернуть одно очко: Выносливость" }),
    );
    expect(props.onSpend).toHaveBeenCalledWith("physicalPower", 5);
  });

  it("не даёт уйти ниже нуля и выше максимума", () => {
    // Ограничение здесь, а не только на сервере: иначе счётчик уводит в минус
    // на глазах, а отказ приходит позже.
    renderCounters();
    expect(
      screen.getByRole("button", { name: "Потратить одно очко: Мана" }),
    ).toBeDisabled();
    renderCounters({
      resources: { physicalPower: { current: 10, maximum: 10 } },
      rows: [rows[0]!],
    });
    expect(
      screen.getAllByRole("button", {
        name: "Вернуть одно очко: Выносливость",
      })[1],
    ).toBeDisabled();
  });

  it("не даёт править ресурсы тому, кто не ведёт персонажа", () => {
    renderCounters({ editable: false });
    for (const button of screen.getAllByRole("button"))
      expect(button).toBeDisabled();
  });

  it("не показывает ничего, когда ресурсов в раскладке нет", () => {
    // Мастер может убрать строки-ресурсы совсем; пустая рамка в панели была бы
    // мусором.
    const { container } = renderComponent(
      <ResourceCounters
        rows={[]}
        resources={{}}
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

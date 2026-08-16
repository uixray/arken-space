// @vitest-environment jsdom
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import type { InitiativeParticipantDto } from "@arken/contracts";
import { renderComponent, screen, userEvent } from "../test-support/render";
import { InitiativePanel } from "./InitiativePanel";

/**
 * UIX-431, этап 5. Заглушки `@gravity-ui/uikit` следуют образцу
 * `StatLayoutCard.test.tsx`: настоящий пакет тянет CSS, который трансформ этого
 * репозитория не разбирает.
 */
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
      title={rest.title}
      onClick={() => onClick?.()}
    >
      {children}
    </button>
  ),
  TextInput: ({
    value,
    onUpdate,
    onBlur,
    defaultValue,
    disabled,
    type,
    ...rest
  }: {
    value?: string;
    defaultValue?: string;
    disabled?: boolean;
    type?: string;
    onUpdate?: (next: string) => void;
    onBlur?: (event: { target: { value: string } }) => void;
    "aria-label"?: string;
    placeholder?: string;
  }) => (
    <input
      aria-label={rest["aria-label"]}
      placeholder={rest.placeholder}
      type={type}
      disabled={disabled}
      {...(value === undefined ? { defaultValue } : { value })}
      onChange={(event) => onUpdate?.(event.target.value)}
      onBlur={onBlur}
    />
  ),
}));

const participants: InitiativeParticipantDto[] = [
  {
    id: "a",
    tokenId: "token-a",
    name: "Ллойд",
    ownName: null,
    initiative: 12,
    initiativeBonus: 3,
    canEdit: true,
  },
  {
    id: "b",
    tokenId: "token-b",
    name: "Тэйн",
    ownName: null,
    initiative: 19,
    initiativeBonus: null,
    canEdit: true,
  },
];

const renderPanel = (
  overrides: Partial<Parameters<typeof InitiativePanel>[0]> = {},
) => {
  const onUpdate = vi.fn();
  const onSetOwnInitiative = vi.fn();
  renderComponent(
    <InitiativePanel
      participants={participants}
      isGm
      pending={false}
      selectedTokenIds={[]}
      onUpdate={onUpdate}
      onSetOwnInitiative={onSetOwnInitiative}
      {...overrides}
    />,
  );
  return { onUpdate, onSetOwnInitiative };
};

const order = () =>
  Array.from(document.querySelectorAll(".initiative-panel__name")).map(
    (item) => item.textContent,
  );

describe("очередь ходов", () => {
  it("показывает участников в том порядке, в каком их прислал сервер", async () => {
    // UIX-466: порядок больше не собирается здесь и не правится руками — он
    // производная от значений, и считает её сервер. Панель его только рисует.
    renderPanel();
    expect(order()).toEqual(["Ллойд", "Тэйн"]);
  });

  it("отправляет введённое значение, не трогая состав", async () => {
    // Заменяет прежний тест «ввод броска не меняет порядок»: он закреплял
    // отменённое решение — что расстановка собирается руками. Порядок теперь
    // пересобирает сервер, поэтому проверяется ровно то, за что отвечает
    // панель: одно изменённое поле и нетронутые соседи.
    const { onUpdate } = renderPanel();
    const field = screen.getByLabelText("Инициатива «Ллойд»");
    await userEvent.clear(field);
    await userEvent.type(field, "5");
    await userEvent.tab();
    expect(onUpdate).toHaveBeenCalledTimes(1);
    expect(onUpdate.mock.calls[0]![0]).toMatchObject([
      { id: "a", initiative: 5 },
      { id: "b", initiative: 19 },
    ]);
  });

  it("не даёт ручной перестановки вовсе", async () => {
    // Порядок стал вычисляемым: кнопки, двигающие строку, обещали бы власть
    // над ним, которой больше нет. И «Пересортировать» тоже — сортировка
    // происходит сама после каждой правки.
    renderPanel();
    expect(screen.queryByLabelText("Переместить «Тэйн» выше")).toBeNull();
    expect(screen.queryByLabelText("Переместить «Ллойд» ниже")).toBeNull();
    expect(screen.queryByText("Пересортировать")).toBeNull();
  });

  it("показывает бонус к инициативе рядом с именем", async () => {
    // Мастеру он нужен, чтобы понимать, к чему прибавлять физический бросок.
    renderPanel();
    expect(screen.getByTitle("Бонус к инициативе: 3")).toBeTruthy();
  });

  it("вводит в бой выделенных рамкой и не задваивает уже введённых", async () => {
    // Рамку легко потянуть дважды поверх тех же фигур, и вторая попытка не
    // должна удваивать половину очереди.
    const { onUpdate } = renderPanel({
      selectedTokenIds: ["token-a", "token-c"],
    });
    await userEvent.click(
      screen.getByTitle("Добавить выделенные рамкой токены"),
    );
    const next = onUpdate.mock.calls[0]![0];
    expect(next).toHaveLength(3);
    expect(next[2]).toMatchObject({ tokenId: "token-c", ownName: null });
  });

  it("добавляет участника без токена под собственным именем", async () => {
    // «Волк №3», брошенный физическим кубом за столом: на карте его нет.
    const { onUpdate } = renderPanel();
    await userEvent.type(
      screen.getByLabelText("Имя участника без токена"),
      "Волк №3",
    );
    await userEvent.click(screen.getByText("Добавить"));
    expect(onUpdate.mock.calls[0]![0][2]).toMatchObject({
      tokenId: null,
      ownName: "Волк №3",
    });
  });

  it("выводит участника из боя", async () => {
    const { onUpdate } = renderPanel();
    await userEvent.click(screen.getByLabelText("Вывести «Ллойд» из боя"));
    expect(onUpdate.mock.calls[0]![0]).toMatchObject([{ id: "b" }]);
  });

  it("даёт игроку вносить свой бросок и только свой", async () => {
    // UIX-466: раньше броски игроков вносил мастер с их слов — самое частое
    // действие боя шло через посредника. Право приходит с сервера строкой
    // `canEdit`; чужая строка остаётся текстом.
    const { onUpdate, onSetOwnInitiative } = renderPanel({
      isGm: false,
      participants: [
        { ...participants[0]!, canEdit: true },
        { ...participants[1]!, canEdit: false },
      ],
    });
    const field = screen.getByLabelText("Инициатива «Ллойд»");
    expect(screen.queryByLabelText("Инициатива «Тэйн»")).toBeNull();
    await userEvent.clear(field);
    await userEvent.type(field, "8");
    await userEvent.tab();
    // Узкой операцией, а не отправкой очереди целиком: у игрока её нет —
    // строки противников до него не доезжают.
    expect(onSetOwnInitiative).toHaveBeenCalledWith("a", 8);
    expect(onUpdate).not.toHaveBeenCalled();
  });

  it("не даёт игроку ручек ведения боя", async () => {
    // Вносить своё значение — можно; собирать состав, выводить из боя и
    // добавлять участников вне карты — по-прежнему только мастеру.
    renderPanel({
      isGm: false,
      participants: [{ ...participants[0]!, canEdit: false }],
    });
    expect(screen.queryByLabelText("Вывести «Ллойд» из боя")).toBeNull();
    expect(screen.queryByLabelText("Имя участника без токена")).toBeNull();
    expect(screen.queryByTitle("Добавить выделенные рамкой токены")).toBeNull();
    expect(screen.queryByLabelText("Инициатива «Ллойд»")).toBeNull();
  });

  it("сворачивается целиком", async () => {
    renderPanel();
    const panel = document.querySelector("details.initiative-panel");
    expect(panel).toHaveAttribute("open");
    await userEvent.click(screen.getByText("Очередь ходов"));
    expect(panel).not.toHaveAttribute("open");
  });
});

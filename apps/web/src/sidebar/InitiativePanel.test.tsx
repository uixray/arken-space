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
  },
  {
    id: "b",
    tokenId: "token-b",
    name: "Тэйн",
    ownName: null,
    initiative: 19,
  },
];

const renderPanel = (
  overrides: Partial<Parameters<typeof InitiativePanel>[0]> = {},
) => {
  const onUpdate = vi.fn();
  renderComponent(
    <InitiativePanel
      participants={participants}
      isGm
      pending={false}
      selectedTokenIds={[]}
      onUpdate={onUpdate}
      {...overrides}
    />,
  );
  return { onUpdate };
};

const order = () =>
  Array.from(document.querySelectorAll(".initiative-panel__name")).map(
    (item) => item.textContent,
  );

describe("очередь ходов", () => {
  it("показывает участников в заданном порядке, а не по броскам", async () => {
    // Ллойд с 12 стоит выше Тэйна с 19, потому что так расставил мастер.
    // Автосортировка здесь означала бы, что расстановка руками невозможна.
    renderPanel();
    expect(order()).toEqual(["Ллойд", "Тэйн"]);
  });

  it("ввод броска не меняет порядок", async () => {
    // Главное требование задачи: часть бросков идёт физическими кубами, и
    // внесение результата не должно рушить очередь, собранную руками.
    const { onUpdate } = renderPanel();
    // Число выбрано так, чтобы сортировка **изменила** порядок: 5 против 19.
    // С 20 расстановка и сортировка совпали бы, и тест пропустил бы
    // автосортировку — это и показала диверсия.
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

  it("пересортировывает только по явному нажатию", async () => {
    const { onUpdate } = renderPanel();
    await userEvent.click(screen.getByText("Пересортировать"));
    expect(
      onUpdate.mock.calls[0]![0].map((row: { id: string }) => row.id),
    ).toEqual(["b", "a"]);
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

  it("переставляет строку вверх", async () => {
    const { onUpdate } = renderPanel();
    await userEvent.click(screen.getByLabelText("Переместить «Тэйн» выше"));
    expect(
      onUpdate.mock.calls[0]![0].map((row: { id: string }) => row.id),
    ).toEqual(["b", "a"]);
  });

  it("выводит участника из боя", async () => {
    const { onUpdate } = renderPanel();
    await userEvent.click(screen.getByLabelText("Вывести «Ллойд» из боя"));
    expect(onUpdate.mock.calls[0]![0]).toMatchObject([{ id: "b" }]);
  });

  it("игроку не даёт ни одной ручки управления", async () => {
    // Очередь ведёт мастер. Игроку панель — сводка, и правка ему недоступна не
    // потому, что кнопки спрятаны, а потому что их нет.
    renderPanel({ isGm: false });
    expect(screen.queryByLabelText("Инициатива «Ллойд»")).toBeNull();
    expect(screen.queryByText("Пересортировать")).toBeNull();
    expect(screen.queryByLabelText("Вывести «Ллойд» из боя")).toBeNull();
    expect(order()).toEqual(["Ллойд", "Тэйн"]);
  });
});

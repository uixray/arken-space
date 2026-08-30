// @vitest-environment jsdom
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import { renderComponent, screen, userEvent } from "../test-support/render";
import { StatLayoutCard } from "./StatLayoutCard";
import { statKeyFromLabel, uniqueStatKey } from "../stat-keys";
import { ApiError } from "../api";

/**
 * UIX-424, шаг 5. `@gravity-ui/uikit` тянет CSS, который трансформ этого репо
 * не разбирает, — заглушки следуют заведённому здесь образцу
 * (см. `CursorPresenceMenu.test.tsx`) и типизированы по тем пропсам, которые
 * компонент действительно передаёт.
 */
/**
 * `Dialog` заглушён с его составными частями, а `ArkenDialog`,
 * `TextPromptDialog` и `useEntityForm` под ним — настоящие: проверка «отказ
 * остаётся перед глазами» опирается именно на них, и подменить их значило бы
 * проверить заглушку.
 */
vi.mock("@gravity-ui/uikit", () => {
  const Dialog = Object.assign(
    ({ open, children }: { open?: boolean; children?: ReactNode }) =>
      open ? <div role="dialog">{children}</div> : null,
    {
      Header: ({ caption }: { caption?: ReactNode }) => <h2>{caption}</h2>,
      Body: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
      Footer: ({
        textButtonApply,
        textButtonCancel,
        onClickButtonApply,
        onClickButtonCancel,
        errorText,
        showError,
      }: {
        textButtonApply?: string;
        textButtonCancel?: string;
        onClickButtonApply?: () => void;
        onClickButtonCancel?: () => void;
        errorText?: string;
        showError?: boolean;
      }) => (
        <div>
          {showError && <p role="alert">{errorText}</p>}
          <button type="button" onClick={onClickButtonCancel}>
            {textButtonCancel}
          </button>
          <button type="button" onClick={onClickButtonApply}>
            {textButtonApply}
          </button>
        </div>
      ),
    },
  );

  return {
    Dialog,
    Button: ({
      disabled,
      onClick,
      children,
      className,
      ...rest
    }: {
      disabled?: boolean;
      onClick?: (event: { preventDefault: () => void }) => void;
      children?: ReactNode;
      className?: string;
      "aria-label"?: string;
      title?: string;
    }) => (
      <button
        type="button"
        className={className}
        disabled={disabled}
        aria-label={rest["aria-label"]}
        title={rest.title}
        onClick={(event) => onClick?.(event)}
      >
        {children}
      </button>
    ),
    // Один `TextInput` обслуживает и поле значения (через `FormInput`, где оно
    // неуправляемое и отдаёт правку на `blur`), и поле ввода подписи в окне
    // (управляемое, через `onUpdate`). Поэтому поддержаны оба способа.
    TextInput: ({
      value,
      onUpdate,
      onKeyDown,
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
      onKeyDown?: (event: { key: string }) => void;
      onBlur?: (event: { target: { value: string } }) => void;
      "aria-label"?: string;
    }) => (
      <input
        aria-label={rest["aria-label"]}
        type={type}
        disabled={disabled}
        {...(value === undefined ? { defaultValue } : { value })}
        onChange={(event) => onUpdate?.(event.target.value)}
        onKeyDown={onKeyDown}
        onBlur={onBlur}
      />
    ),
  };
});

const rows = [
  { key: "strength", label: "Сила" },
  { key: "agility", label: "Ловкость" },
];

const renderCard = (
  overrides: Partial<Parameters<typeof StatLayoutCard>[0]> = {},
) => {
  const props = {
    title: "Характеристики",
    modifier: "stats",
    rows,
    values: { strength: 4, agility: 2 },
    valuesRevisionKey: "hero-1",
    editable: true,
    rollPending: false,
    canEditLayout: true,
    onChangeValue: vi.fn(),
    onRoll: vi.fn(),
    onRenameRow: vi.fn(async () => {}),
    onAddRow: vi.fn(async () => {}),
    onDeleteRow: vi.fn(async () => {}),
    onMoveRow: vi.fn(async () => {}),
    ...overrides,
  };
  renderComponent(<StatLayoutCard {...props} />);
  return props;
};

describe("карточка группы характеристик", () => {
  it("показывает строки со значениями персонажа", () => {
    renderCard();
    expect(screen.getByDisplayValue("4")).toBeInTheDocument();
    expect(screen.getByText("Ловкость")).toBeInTheDocument();
  });

  it("не предлагает игроку править раскладку", () => {
    // Раскладка общая на кампанию: переименование игроком поменяло бы подпись
    // всем за столом. Значения при этом править можно — это его персонаж.
    renderCard({ canEditLayout: false });
    expect(screen.queryByText(/Добавить строку/)).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /Переименовать/ }),
    ).not.toBeInTheDocument();
    expect(screen.getByDisplayValue("4")).toBeEnabled();
  });

  it("переименовывает строку по её ключу, а не по подписи", async () => {
    // Ключ — то, на что ссылаются формулы. Если наверх уйдёт подпись, вызов
    // придётся сопоставлять обратно, и на двух одинаковых подписях он ошибётся.
    const props = renderCard();
    await userEvent.click(
      screen.getByRole("button", { name: "Переименовать «Ловкость»" }),
    );
    const field = screen.getByLabelText("Название");
    await userEvent.clear(field);
    await userEvent.type(field, "Проворство");
    await userEvent.click(screen.getByRole("button", { name: "Сохранить" }));

    expect(props.onRenameRow).toHaveBeenCalledWith("agility", "Проворство");
  });

  it("отдаёт правку значения числом, а не строкой из поля", async () => {
    // Поле ввода отдаёт `"7"`, а `characters.stats` — запись чисел, и контракт
    // строку не примет. Преобразование должно случиться здесь, а не «где-то
    // дальше по пути».
    const props = renderCard();
    const field = screen.getByDisplayValue("4");
    await userEvent.clear(field);
    await userEvent.type(field, "7");
    await userEvent.tab();

    expect(props.onChangeValue).toHaveBeenCalledWith("strength", 7);
  });

  it("бросок идёт по ключу строки, а подпись — в сообщение", async () => {
    const props = renderCard();
    await userEvent.click(
      screen.getAllByRole("button", { name: "Бросок" })[0]!,
    );
    expect(props.onRoll).toHaveBeenCalledWith("1d20 + strength", "Сила");
  });

  it("добавляет строку с введённой подписью", async () => {
    const props = renderCard();
    await userEvent.click(screen.getByText(/Добавить строку/));
    await userEvent.type(screen.getByLabelText("Название"), "Внимательность");
    await userEvent.click(screen.getByRole("button", { name: "Сохранить" }));

    expect(props.onAddRow).toHaveBeenCalledWith("Внимательность");
  });

  it("переставляет строку и не предлагает двигать крайние за край", async () => {
    const props = renderCard();
    await userEvent.click(
      screen.getByRole("button", { name: "Переместить «Ловкость» выше" }),
    );
    expect(props.onMoveRow).toHaveBeenCalledWith("agility", "up");

    // Верхнюю вверх и нижнюю вниз двигать некуда — кнопки должны быть
    // недоступны, иначе нажатие уходит в сервер и ничего не меняет.
    expect(
      screen.getByRole("button", { name: "Переместить «Сила» выше" }),
    ).toBeDisabled();
    expect(
      screen.getByRole("button", { name: "Переместить «Ловкость» ниже" }),
    ).toBeDisabled();
  });

  it("удаляет строку по подтверждению", async () => {
    const props = renderCard();
    await userEvent.click(
      screen.getByRole("button", { name: "Удалить «Ловкость»" }),
    );
    await userEvent.click(screen.getByRole("button", { name: "Удалить" }));

    expect(props.onDeleteRow).toHaveBeenCalledWith("agility");
  });

  it("объясняет нулём отключение системного регена, не запрещая обычное удаление", async () => {
    const props = renderCard({
      rows: [
        { key: "enduranceRegen", label: "Восстановление сил" },
        { key: "agility", label: "Ловкость" },
      ],
      values: { enduranceRegen: 3, agility: 2 },
    });

    // Системность определяется точным ключом, а не подписью: мастер вправе
    // переименовать реген, но не должен потерять способ отключить его через 0.
    const protectedDelete = screen.getByRole("button", {
      name: "Нельзя удалить «Восстановление сил»: установите значение 0, чтобы отключить восстановление",
    });
    expect(protectedDelete).toBeDisabled();
    expect(protectedDelete).toHaveAttribute(
      "title",
      "Системную строку нельзя удалить. Чтобы отключить восстановление, установите значение 0.",
    );

    const ordinaryDelete = screen.getByRole("button", {
      name: "Удалить «Ловкость»",
    });
    expect(ordinaryDelete).toBeEnabled();
    await userEvent.click(ordinaryDelete);
    await userEvent.click(screen.getByRole("button", { name: "Удалить" }));
    expect(props.onDeleteRow).toHaveBeenCalledWith("agility");
  });

  it("показывает, что именно держит строку, вместо голого отказа", async () => {
    // Мастеру нужно имя того, что предстоит починить: «удалить нельзя» без
    // списка оставляет его гадать, где искать ссылку.
    renderCard({
      onDeleteRow: vi.fn(async () => {
        throw new ApiError(
          409,
          "STAT_ROW_REFERENCED",
          "Отказ",
          undefined,
          undefined,
          {
            key: "agility",
            references: [{ kind: "SKILL", name: "Меч", owner: "Ллойд" }],
          },
        );
      }),
    });
    await userEvent.click(
      screen.getByRole("button", { name: "Удалить «Ловкость»" }),
    );
    await userEvent.click(screen.getByRole("button", { name: "Удалить" }));

    expect(await screen.findByText(/Навык: Меч — Ллойд/)).toBeInTheDocument();
  });

  it("не выдаёт обычную ошибку за ссылку на строку", async () => {
    // Сеть отвалилась — это не «строку кто-то держит». Подать одно как другое
    // значило бы отправить мастера искать несуществующую ссылку.
    renderCard({
      onDeleteRow: vi.fn(async () => {
        throw new ApiError(500, "REQUEST_FAILED", "Сервер недоступен");
      }),
    });
    await userEvent.click(
      screen.getByRole("button", { name: "Удалить «Ловкость»" }),
    );
    await userEvent.click(screen.getByRole("button", { name: "Удалить" }));

    expect(await screen.findByText(/Сервер недоступен/)).toBeInTheDocument();
    expect(screen.queryByText(/ссылаются броски/)).not.toBeInTheDocument();
  });

  it("не показывает прошлый отказ на следующей строке", async () => {
    // Иначе мастер увидит ссылки от «Ловкости», открыв удаление «Силы», и
    // решит, что держат обе.
    renderCard({
      onDeleteRow: vi.fn(async () => {
        throw new ApiError(
          409,
          "STAT_ROW_REFERENCED",
          "Отказ",
          undefined,
          undefined,
          {
            references: [{ kind: "SKILL", name: "Меч" }],
          },
        );
      }),
    });
    await userEvent.click(
      screen.getByRole("button", { name: "Удалить «Ловкость»" }),
    );
    await userEvent.click(screen.getByRole("button", { name: "Удалить" }));
    expect(await screen.findByText(/Навык: Меч/)).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Отмена" }));
    await userEvent.click(
      screen.getByRole("button", { name: "Удалить «Сила»" }),
    );
    expect(screen.queryByText(/Навык: Меч/)).not.toBeInTheDocument();
  });

  it("показывает отказ вместо того, чтобы закрыть окно", async () => {
    // Ключ строится из подписи, и из «—» он не получается. Отказ должен
    // остаться перед глазами — иначе мастер решит, что строка добавлена.
    renderCard({
      onAddRow: vi.fn(async () => {
        throw new Error("Из этого названия не получается имя для формул.");
      }),
    });
    await userEvent.click(screen.getByText(/Добавить строку/));
    await userEvent.type(screen.getByLabelText("Название"), "—");
    await userEvent.click(screen.getByRole("button", { name: "Сохранить" }));

    expect(
      await screen.findByText(/не получается имя для формул/),
    ).toBeInTheDocument();
  });
});

/**
 * Ключ новой строки строится на клиенте, а принимает его контракт. Здесь
 * проверяется стык: подпись, которую мастер реально введёт, даёт ключ, который
 * не столкнётся с существующими.
 */
describe("ключ новой строки", () => {
  it("не затирает существующую строку с той же подписью", () => {
    const taken = ["blizhniiBoi"];
    const key = uniqueStatKey(statKeyFromLabel("Ближний Бой"), taken);
    expect(key).toBe("blizhniiBoi2");
  });

  it("остаётся пустым на подписи без букв — вызывающий обязан отказать", () => {
    expect(statKeyFromLabel("—")).toBe("");
  });
});

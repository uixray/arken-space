// @vitest-environment jsdom
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import { renderComponent, screen, userEvent } from "../test-support/render";
import { StatLayoutCard } from "./StatLayoutCard";
import { statKeyFromLabel, uniqueStatKey } from "../stat-keys";

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

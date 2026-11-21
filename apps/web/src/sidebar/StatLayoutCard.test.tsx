// @vitest-environment jsdom
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import {
  renderComponent,
  screen,
  userEvent,
  fireEvent,
  waitFor,
} from "../test-support/render";
import { StatLayoutCard } from "./StatLayoutCard";
import { statKeyFromLabel, uniqueStatKey } from "../stat-keys";
import { ApiError } from "../api";

/**
 * UIX-424, шаг 5. `ArkenDialog`, `TextPromptDialog` и `useEntityForm` —
 * настоящие: проверка «отказ остаётся перед глазами» опирается именно на них,
 * и подменить их значило бы проверить заглушку.
 */
// jsdom implements the closed-popover stylesheet but lacks the browser methods.
const openPopovers = new WeakSet<HTMLElement>();
beforeAll(() => {
  const nativeMatches = HTMLElement.prototype.matches;
  vi.spyOn(HTMLElement.prototype, "matches").mockImplementation(function (
    this: HTMLElement,
    selector: string,
  ) {
    return selector === ":popover-open"
      ? openPopovers.has(this)
      : nativeMatches.call(this, selector);
  });
  Object.defineProperties(HTMLElement.prototype, {
    showPopover: {
      configurable: true,
      value(this: HTMLElement) {
        openPopovers.add(this);
        this.style.display = "block";
      },
    },
    hidePopover: {
      configurable: true,
      value(this: HTMLElement) {
        openPopovers.delete(this);
        this.style.removeProperty("display");
      },
    },
  });
});
afterAll(() => {
  vi.restoreAllMocks();
  Reflect.deleteProperty(HTMLElement.prototype, "showPopover");
  Reflect.deleteProperty(HTMLElement.prototype, "hidePopover");
});
const rows = [
  { key: "strength", label: "Сила" },
  { key: "agility", label: "Ловкость" },
];

const defaultCardProps = () => ({
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
});
const renderCard = async (
  overrides: Partial<Parameters<typeof StatLayoutCard>[0]> = {},
  openMenus = true,
) => {
  const props = { ...defaultCardProps(), ...overrides };
  const rendered = renderComponent(<StatLayoutCard {...props} />);
  if (openMenus) {
    rendered.container
      .querySelectorAll("details.stat-field__menu")
      .forEach((menu) => {
        (menu as HTMLDetailsElement).open = true;
      });
    await waitFor(() => {
      for (const popup of rendered.container.querySelectorAll<HTMLElement>(
        "[popover]",
      ))
        expect(popup.matches(":popover-open")).toBe(true);
    });
  }
  return props;
};

describe("карточка группы характеристик", () => {
  it("shows concise text labels for stat row menu actions", async () => {
    await renderCard();
    expect(screen.getAllByText("Выше").length).toBe(2);
    expect(screen.getAllByText("Ниже").length).toBe(2);
    expect(screen.getAllByText("Переименовать").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Удалить").length).toBeGreaterThan(0);
  });

  it("closes only the open row menu on Escape and returns focus before the owning dialog", async () => {
    let parentEscapeCount = 0;
    const props = defaultCardProps();
    renderComponent(
      <div
        role="dialog"
        onKeyDown={(event) => {
          if (event.key === "Escape") parentEscapeCount += 1;
        }}
      >
        <StatLayoutCard {...props} />
      </div>,
    );
    const summary = screen.getByLabelText("Действия строки «Сила»");
    const menu = summary.closest("details")!;
    await userEvent.click(summary);
    expect(menu).toHaveProperty("open", true);

    await userEvent.keyboard("{Escape}");

    expect(menu).toHaveProperty("open", false);
    expect(summary).toHaveFocus();
    expect(parentEscapeCount).toBe(0);
  });

  it("dismisses a row menu on outside pointer without stealing focus from the next owner", async () => {
    await renderCard({}, false);
    const firstSummary = screen.getByLabelText("Действия строки «Сила»");
    const secondSummary = screen.getByLabelText("Действия строки «Ловкость»");
    const firstMenu = firstSummary.closest("details")!;
    const secondMenu = secondSummary.closest("details")!;
    await userEvent.click(firstSummary);
    expect(firstMenu).toHaveProperty("open", true);

    await userEvent.click(secondSummary);

    expect(firstMenu).toHaveProperty("open", false);
    expect(secondMenu).toHaveProperty("open", true);
    expect(secondSummary).toHaveFocus();
  });

  it("flips row actions into the available scroll viewport and clamps only when neither side fits", async () => {
    const props = defaultCardProps();
    const rendered = renderComponent(
      <div
        className="arken-workspace-window__body"
        style={{ overflowY: "auto", height: "550px" }}
      >
        <StatLayoutCard {...props} />
      </div>,
    );
    const body = rendered.container.querySelector(
      ".arken-workspace-window__body",
    )!;
    const summary = screen.getByLabelText("Действия строки «Сила»");
    const menu = summary.closest("details") as HTMLDetailsElement;
    const popup = menu.querySelector(".stat-field__menu-items") as HTMLElement;
    const makeRect = (top: number, bottom: number, height = bottom - top) =>
      ({
        x: 0,
        y: top,
        top,
        bottom,
        left: 0,
        right: 200,
        width: 200,
        height,
        toJSON: () => ({}),
      }) as DOMRect;
    let summaryRect = makeRect(690, 718);
    let popupHeight = 160;
    body.getBoundingClientRect = () => makeRect(50, 600);
    summary.getBoundingClientRect = () => summaryRect;
    popup.getBoundingClientRect = () => makeRect(0, popupHeight, popupHeight);
    Object.defineProperty(popup, "scrollHeight", {
      configurable: true,
      get: () => popupHeight,
    });
    Object.defineProperty(body, "clientTop", { configurable: true, value: 0 });
    Object.defineProperty(body, "clientHeight", {
      configurable: true,
      value: 550,
    });
    const scheduledFrames: FrameRequestCallback[] = [];
    const raf = vi
      .spyOn(window, "requestAnimationFrame")
      .mockImplementation((callback) => {
        scheduledFrames.push(callback);
        return scheduledFrames.length;
      });
    const flushFrames = () => {
      for (const callback of scheduledFrames.splice(0)) callback(0);
    };

    try {
      await userEvent.click(summary);
      fireEvent(menu, new Event("toggle", { bubbles: true }));
      flushFrames();
      expect(popup.style.top).toBe("522px");
      expect(popup.style.maxHeight).toBe("682px");

      summaryRect = makeRect(150, 178);
      fireEvent(window, new Event("resize"));
      flushFrames();
      expect(popup.style.top).toBe("186px");

      popupHeight = 600;
      summaryRect = makeRect(300, 328);
      fireEvent(window, new Event("resize"));
      flushFrames();
      expect(popup.style.top).toBe("336px");
      expect(popup.style.maxHeight).toBe("432px");
    } finally {
      raf.mockRestore();
    }
  });

  it("places top-layer row actions beyond nested clipping ancestors", async () => {
    const props = defaultCardProps();
    const rendered = renderComponent(
      <div className="outer-clip" style={{ overflowY: "auto" }}>
        <div
          className="arken-workspace-window__body"
          style={{ overflowY: "auto" }}
        >
          <StatLayoutCard {...props} />
        </div>
      </div>,
    );
    const outer = rendered.container.querySelector(".outer-clip")!;
    const inner = rendered.container.querySelector(
      ".arken-workspace-window__body",
    )!;
    const summary = screen.getByLabelText("Действия строки «Сила»");
    const menu = summary.closest("details") as HTMLDetailsElement;
    const popup = menu.querySelector(".stat-field__menu-items") as HTMLElement;
    const makeRect = (top: number, bottom: number) =>
      ({
        x: 0,
        y: top,
        top,
        bottom,
        left: 0,
        right: 200,
        width: 200,
        height: bottom - top,
        toJSON: () => ({}),
      }) as DOMRect;

    outer.getBoundingClientRect = () => makeRect(200, 500);
    inner.getBoundingClientRect = () => makeRect(50, 700);
    summary.getBoundingClientRect = () => makeRect(430, 458);
    popup.getBoundingClientRect = () => makeRect(0, 160);
    Object.defineProperty(popup, "scrollHeight", {
      configurable: true,
      get: () => 160,
    });
    Object.defineProperty(outer, "clientTop", { configurable: true, value: 0 });
    Object.defineProperty(outer, "clientHeight", {
      configurable: true,
      value: 300,
    });
    Object.defineProperty(inner, "clientTop", { configurable: true, value: 0 });
    Object.defineProperty(inner, "clientHeight", {
      configurable: true,
      value: 650,
    });
    const scheduledFrames: FrameRequestCallback[] = [];
    const raf = vi
      .spyOn(window, "requestAnimationFrame")
      .mockImplementation((callback) => {
        scheduledFrames.push(callback);
        return scheduledFrames.length;
      });

    try {
      await userEvent.click(summary);
      fireEvent(menu, new Event("toggle", { bubbles: true }));
      for (const callback of scheduledFrames.splice(0)) callback(0);

      expect(popup.matches(":popover-open")).toBe(true);
      expect(popup.style.top).toBe("466px");
      expect(popup.style.maxHeight).toBe("302px");
    } finally {
      raf.mockRestore();
    }
  });

  it("does not intercept Escape owned by a nested dialog", async () => {
    await renderCard({}, false);
    const summary = screen.getByLabelText("Действия строки «Ловкость»");
    const menu = summary.closest("details")!;
    await userEvent.click(summary);
    await userEvent.click(
      await screen.findByRole("button", { name: "Переименовать «Ловкость»" }),
    );
    expect(screen.getByRole("dialog")).toBeVisible();

    const input = screen.getByRole("textbox", { name: "Название" });
    const escape = new KeyboardEvent("keydown", {
      key: "Escape",
      bubbles: true,
      cancelable: true,
    });
    input.dispatchEvent(escape);

    // The dialog owns this Escape and closes; the row menu under it must not
    // treat the same key as its own and stays open.
    await waitFor(() =>
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
    );
    expect(menu).toHaveProperty("open", true);
  });

  it("hides editing actions behind the row menu and exposes a six-dot keyboard handle", async () => {
    const props = await renderCard({}, false);
    const menu = screen.getByLabelText("Действия строки «Ловкость»");
    expect(menu.closest("details")).not.toHaveAttribute("open");
    await userEvent.click(menu);
    expect(
      await screen.findByRole("button", { name: "Переименовать «Ловкость»" }),
    ).toBeVisible();
    const handle = screen.getByRole("button", {
      name: "Переместить «Ловкость»",
    });
    expect(handle.querySelectorAll("circle")).toHaveLength(6);
    fireEvent.keyDown(handle, { key: "ArrowUp" });
    expect(props.onMoveRow).toHaveBeenCalledWith("agility", "up");
  });
  it("submits the dropped row and target as one persisted reorder", async () => {
    const onReorderRow = vi.fn(async () => {});
    await renderCard({ onReorderRow }, false);
    const handle = screen.getByRole("button", { name: "Переместить «Сила»" });
    const dataTransfer = { setData: vi.fn(), effectAllowed: "" };
    fireEvent.dragStart(handle, { dataTransfer });
    fireEvent.drop(
      screen.getByRole("button", { name: "Ловкость" }).closest(".stat-field")!,
    );
    expect(onReorderRow).toHaveBeenCalledExactlyOnceWith("strength", "agility");
  });
  it("renders the campaign editor without character rolls or values", async () => {
    await renderCard({ layoutOnly: true });
    expect(screen.queryAllByRole("spinbutton")).toHaveLength(0);
    expect(
      screen.queryByRole("button", { name: "Сила" }),
    ).not.toBeInTheDocument();
    expect(screen.getByText("Сила")).toBeVisible();
  });
  it("показывает строки со значениями персонажа", async () => {
    await renderCard();
    expect(screen.getByDisplayValue("4")).toBeInTheDocument();
    expect(screen.getByText("Ловкость")).toBeInTheDocument();
  });

  it("показывает иконки действий без подмены доступных имён", async () => {
    await renderCard();
    const actionNames = [
      "Переместить «Ловкость» выше",
      "Переместить «Ловкость» ниже",
      "Переименовать «Ловкость»",
      "Удалить «Ловкость»",
      "Добавить строку",
    ];

    for (const name of actionNames) {
      expect(
        screen.getByRole("button", { name }).querySelector("svg.arken-icon"),
        `UIX645_STAT_LAYOUT_ICON: ${name}`,
      ).toBeInTheDocument();
    }
  });

  it.each([true, false])(
    "names the stat value without action labels (layout editing=%s)",
    async (canEditLayout) => {
      await renderCard({ canEditLayout });
      const input = screen.getByRole("spinbutton", {
        name: "Сила",
      });
      await userEvent.click(screen.getByText("Сила", { exact: true }));
      expect(input).not.toHaveFocus();
      expect(
        input.closest(".stat-field")?.querySelector("label button"),
      ).toBeNull();
    },
  );

  it("keeps labels attached to their own fields across two cards", async () => {
    await renderCard();
    await renderCard();
    const inputs = screen.getAllByRole("spinbutton", {
      name: "Сила",
    });
    expect(new Set(inputs.map((input) => input.id)).size).toBe(2);
    const labels = screen.getAllByText("Сила", { exact: true });
    for (const [index, label] of labels.entries()) {
      await userEvent.click(label);
      expect(inputs[index]).not.toHaveFocus();
    }
  });

  it("changes the value with flanking step controls and has no separate roll action", async () => {
    const props = await renderCard();
    expect(
      screen.queryByRole("button", { name: "Бросок" }),
    ).not.toBeInTheDocument();
    await userEvent.click(
      screen.getByRole("button", { name: "Увеличить Сила" }),
    );
    expect(props.onChangeValue).toHaveBeenLastCalledWith("strength", 5);
    expect(screen.getByRole("spinbutton", { name: "Сила" })).toHaveValue(5);
    await userEvent.click(
      screen.getByRole("button", { name: "Уменьшить Сила" }),
    );
    expect(props.onChangeValue).toHaveBeenLastCalledWith("strength", 4);
  });

  it("не предлагает игроку править раскладку", async () => {
    // Раскладка общая на кампанию: переименование игроком поменяло бы подпись
    // всем за столом. Значения при этом править можно — это его персонаж.
    await renderCard({ canEditLayout: false });
    expect(screen.queryByText(/Добавить строку/)).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /Переименовать/ }),
    ).not.toBeInTheDocument();
    expect(screen.getByDisplayValue("4")).toBeEnabled();
  });

  it("переименовывает строку по её ключу, а не по подписи", async () => {
    // Ключ — то, на что ссылаются формулы. Если наверх уйдёт подпись, вызов
    // придётся сопоставлять обратно, и на двух одинаковых подписях он ошибётся.
    const props = await renderCard();
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
    const props = await renderCard();
    const field = screen.getByDisplayValue("4");
    await userEvent.clear(field);
    await userEvent.type(field, "7");
    await userEvent.tab();

    expect(props.onChangeValue).toHaveBeenCalledWith("strength", 7);
  });

  it("бросок идёт по ключу строки, а подпись — в сообщение", async () => {
    const props = await renderCard();
    await userEvent.click(screen.getByRole("button", { name: "Сила" }));
    expect(props.onRoll).toHaveBeenCalledWith(
      "1d20 + strength",
      "Сила",
      "NORMAL",
    );
  });

  it("передаёт модификатор одного броска из клавиши", async () => {
    const props = await renderCard();
    const user = userEvent.setup();
    await user.keyboard("{Control>}");
    await user.click(screen.getByRole("button", { name: "Сила" }));
    await user.keyboard("{/Control}");
    expect(props.onRoll).toHaveBeenCalledWith(
      "1d20 + strength",
      "Сила",
      "ADVANTAGE",
    );
  });

  it("добавляет строку с введённой подписью", async () => {
    const props = await renderCard();
    await userEvent.click(screen.getByText(/Добавить строку/));
    await userEvent.type(screen.getByLabelText("Название"), "Внимательность");
    await userEvent.click(screen.getByRole("button", { name: "Сохранить" }));

    expect(props.onAddRow).toHaveBeenCalledWith("Внимательность");
  });

  it("переставляет строку и не предлагает двигать крайние за край", async () => {
    const props = await renderCard();
    // Верхнюю вверх и нижнюю вниз двигать некуда — кнопки должны быть
    // недоступны, иначе нажатие уходит в сервер и ничего не меняет.
    expect(
      screen.getByRole("button", { name: "Переместить «Сила» выше" }),
    ).toBeDisabled();
    expect(
      screen.getByRole("button", { name: "Переместить «Ловкость» ниже" }),
    ).toBeDisabled();
    await userEvent.click(
      screen.getByRole("button", { name: "Переместить «Ловкость» выше" }),
    );
    expect(props.onMoveRow).toHaveBeenCalledWith("agility", "up");
  });

  it("удаляет строку по подтверждению", async () => {
    const props = await renderCard();
    await userEvent.click(
      screen.getByRole("button", { name: "Удалить «Ловкость»" }),
    );
    await userEvent.click(screen.getByRole("button", { name: "Удалить" }));

    expect(props.onDeleteRow).toHaveBeenCalledWith("agility");
  });

  it("объясняет нулём отключение системного регена, не запрещая обычное удаление", async () => {
    const props = await renderCard({
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
    await renderCard({
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
    await renderCard({
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
    await renderCard({
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
    await userEvent.click(screen.getByLabelText("Действия строки «Сила»"));
    await userEvent.click(
      await screen.findByRole("button", { name: "Удалить «Сила»" }),
    );
    expect(screen.queryByText(/Навык: Меч/)).not.toBeInTheDocument();
  });

  it("показывает отказ вместо того, чтобы закрыть окно", async () => {
    // Ключ строится из подписи, и из «—» он не получается. Отказ должен
    // остаться перед глазами — иначе мастер решит, что строка добавлена.
    await renderCard({
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
  it("не затирает существующую строку с той же подписью", async () => {
    const taken = ["blizhniiBoi"];
    const key = uniqueStatKey(statKeyFromLabel("Ближний Бой"), taken);
    expect(key).toBe("blizhniiBoi2");
  });

  it("остаётся пустым на подписи без букв — вызывающий обязан отказать", async () => {
    expect(statKeyFromLabel("—")).toBe("");
  });
});

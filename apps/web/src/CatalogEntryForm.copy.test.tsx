// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { renderComponent, screen, userEvent } from "./test-support/render";
import { CatalogEntryForm } from "./CatalogEntryForm";
import { ApiError } from "./api";
import type { CatalogEntryDto } from "@arken/contracts";

afterEach(() => vi.unstubAllGlobals());

it("explains machine keys in Russian without translating submitted keys", async () => {
  vi.stubGlobal("matchMedia", (media: string) => ({
    matches: false,
    media,
    onchange: null,
    addEventListener() {},
    removeEventListener() {},
    addListener() {},
    removeListener() {},
    dispatchEvent: () => true,
  }));
  const onSubmit = vi.fn();
  renderComponent(
    <>
      <CatalogEntryForm
        statLabels={{}}
        resourceLabels={{ physical: "Выносливость", magic: "Мана" }}
        onSubmit={onSubmit}
        onCancel={vi.fn()}
      />
    </>,
  );
  const user = userEvent.setup();
  await user.click(
    screen.getByRole("button", { name: "Дополнительные настройки" }),
  );
  await user.type(
    screen.getByLabelText("Название *", { exact: true }),
    "Искра",
  );
  await user.click(screen.getByText("Дополнительные числовые параметры"));
  await user.click(screen.getByRole("button", { name: "Добавить значение" }));
  const key = screen.getByLabelText("Ключ", {
    exact: true,
  }) as HTMLInputElement;
  expect(key).toHaveAttribute("placeholder", "Код латиницей");
  expect(key).toHaveAttribute("pattern", "[a-z][a-z0-9_]{0,39}");
  expect(screen.getByText("might = 2")).toBeInTheDocument();
  expect(screen.getByText("+2")).toBeInTheDocument();
  await user.type(key, "magic");
  expect(key.validity.valid).toBe(true);
  await user.clear(screen.getByLabelText("Значение", { exact: true }));
  await user.type(screen.getByLabelText("Значение", { exact: true }), "3");
  await user.click(screen.getByRole("button", { name: /^Сохранить$/ }));
  expect(onSubmit).toHaveBeenCalledOnce();
  expect(onSubmit.mock.calls[0]![0]).toMatchObject({
    name: "Искра",
    data: { values: { magic: 3 } },
  });
});

it("keeps numeric ENTRY_VALUE modifiers separate from resource costs", async () => {
  vi.stubGlobal("matchMedia", (media: string) => ({
    matches: false,
    media,
    onchange: null,
    addEventListener() {},
    removeEventListener() {},
    addListener() {},
    removeListener() {},
    dispatchEvent: () => true,
  }));
  const onSubmit = vi.fn();
  renderComponent(
    <>
      <CatalogEntryForm
        statLabels={{}}
        resourceLabels={{ physical: "Выносливость", magic: "Мана" }}
        onSubmit={onSubmit}
        onCancel={vi.fn()}
      />
    </>,
  );
  const user = userEvent.setup();
  await user.click(
    screen.getByRole("button", { name: "Дополнительные настройки" }),
  );
  await user.type(
    screen.getByLabelText("Название *", { exact: true }),
    "Искра",
  );
  await user.click(screen.getByText("Дополнительные числовые параметры"));
  await user.click(screen.getByRole("button", { name: "Добавить значение" }));
  await user.type(screen.getByLabelText("Ключ", { exact: true }), "focus");
  await user.clear(screen.getByLabelText("Значение", { exact: true }));
  await user.type(screen.getByLabelText("Значение", { exact: true }), "3");
  await user.click(
    screen.getByRole("button", { name: "Добавить дополнительный бросок" }),
  );
  await user.type(screen.getByLabelText(/^Название броска/), "Усиление");
  await user.click(screen.getByLabelText("Источник модификатора"));
  await user.click(screen.getByRole("option", { name: "Значение записи" }));
  await user.click(screen.getByLabelText("Ключ значения"));
  await user.click(screen.getByRole("option", { name: "focus" }));
  await user.click(screen.getByLabelText("Ресурс"));
  await user.click(screen.getByRole("option", { name: "Выносливость" }));
  await user.clear(screen.getByLabelText("Количество", { exact: true }));
  await user.type(screen.getByLabelText("Количество", { exact: true }), "2");
  await user.click(screen.getByRole("button", { name: /^Сохранить$/ }));

  expect(onSubmit).toHaveBeenCalledOnce();
  expect(onSubmit.mock.calls[0]![0]).toMatchObject({
    data: {
      values: { focus: 3 },
      rollActions: [
        {
          modifiers: [{ type: "ENTRY_VALUE", key: "focus" }],
          cost: { type: "physical", amount: 2 },
        },
      ],
    },
  });
});

it("stores the shared usage cost for a no-roll ability separately from its description", async () => {
  vi.stubGlobal("matchMedia", (media: string) => ({
    matches: false,
    media,
    onchange: null,
    addEventListener() {},
    removeEventListener() {},
    addListener() {},
    removeListener() {},
    dispatchEvent: () => true,
  }));
  const onSubmit = vi.fn();
  renderComponent(
    <>
      <CatalogEntryForm
        initialKind="ABILITY"
        statLabels={{}}
        resourceLabels={{ physical: "Выносливость", magic: "Мана" }}
        onSubmit={onSubmit}
        onCancel={vi.fn()}
      />
    </>,
  );
  const user = userEvent.setup();
  await user.type(
    screen.getByLabelText("Название *", { exact: true }),
    "Световой прыжок",
  );
  await user.click(screen.getByLabelText("Стоимость"));
  await user.click(screen.getByRole("option", { name: "Выносливость" }));
  await user.clear(screen.getByLabelText("Количество ресурса"));
  await user.type(screen.getByLabelText("Количество ресурса"), "2");
  await user.click(screen.getByRole("button", { name: /^Сохранить$/ }));
  expect(onSubmit).toHaveBeenCalledOnce();
  expect(onSubmit.mock.calls[0]![0]).toMatchObject({
    kind: "ABILITY",
    data: { usageCost: { type: "physical", amount: 2 } },
  });
});

it("saves an unlimited no-roll ability with cost after turning off its use limit", async () => {
  vi.stubGlobal("matchMedia", (media: string) => ({
    matches: false,
    media,
    onchange: null,
    addEventListener() {},
    removeEventListener() {},
    addListener() {},
    removeListener() {},
    dispatchEvent: () => true,
  }));
  const onSubmit = vi.fn();
  renderComponent(
    <>
      <CatalogEntryForm
        initialKind="ABILITY"
        statLabels={{}}
        resourceLabels={{ physical: "Выносливость", magic: "Мана" }}
        onSubmit={onSubmit}
        onCancel={vi.fn()}
      />
    </>,
  );
  const user = userEvent.setup();
  await user.click(
    screen.getByRole("button", { name: "Дополнительные настройки" }),
  );
  await user.type(
    screen.getByLabelText("Название *", { exact: true }),
    "Световой прыжок",
  );
  await user.click(
    screen.getByLabelText("Ограничить количество использований"),
  );
  await user.click(
    screen.getByLabelText("Ограничить количество использований"),
  );
  await user.click(screen.getByLabelText("Стоимость"));
  await user.click(screen.getByRole("option", { name: "Мана" }));
  await user.clear(screen.getByLabelText("Количество ресурса"));
  await user.type(screen.getByLabelText("Количество ресурса"), "2");
  await user.click(screen.getByRole("button", { name: /^Сохранить$/ }));

  expect(onSubmit).toHaveBeenCalledOnce();
  expect(onSubmit.mock.calls[0]![0]).toMatchObject({
    kind: "ABILITY",
    data: {
      uses: undefined,
      usageCost: { type: "magic", amount: 2 },
    },
  });
});

it("preserves legacy activation data when renaming an ability that also has rolls", async () => {
  vi.stubGlobal("matchMedia", (media: string) => ({
    matches: false,
    media,
    onchange: null,
    addEventListener() {},
    removeEventListener() {},
    addListener() {},
    removeListener() {},
    dispatchEvent: () => true,
  }));
  const activation = {
    consumeUse: false,
    cost: { type: "magic", amount: 2 },
    legacyMetadata: { source: "imported", note: "retain untouched fields" },
  };
  const existing = {
    id: "entry-1",
    kind: "ABILITY",
    name: "Старое имя",
    description: "Описание",
    revision: 3,
    data: {
      activation,
      rollActions: [
        {
          id: "roll-1",
          label: "Проверка",
          kind: "CHECK",
          dice: "1d20",
          modifiers: [],
          advantage: false,
          consumeUse: false,
          order: 0,
        },
      ],
    },
  } as unknown as CatalogEntryDto;
  const onSubmit = vi.fn();
  renderComponent(
    <>
      <CatalogEntryForm
        existing={existing}
        statLabels={{}}
        resourceLabels={{ physical: "Выносливость", magic: "Мана" }}
        onSubmit={onSubmit}
        onCancel={vi.fn()}
      />
    </>,
  );
  const user = userEvent.setup();
  const name = screen.getByLabelText("Название *", { exact: true });
  await user.clear(name);
  await user.type(name, "Новое имя");
  await user.click(screen.getByRole("button", { name: /^Сохранить$/ }));

  expect(onSubmit).toHaveBeenCalledOnce();
  expect(onSubmit.mock.calls[0]![0]).toMatchObject({
    name: "Новое имя",
    kind: "ABILITY",
    data: { activation },
  });
});

it("maps safe server field errors and keeps the submitted draft", async () => {
  vi.stubGlobal("matchMedia", (media: string) => ({
    matches: false,
    media,
    onchange: null,
    addEventListener() {},
    removeEventListener() {},
    addListener() {},
    removeListener() {},
    dispatchEvent: () => true,
  }));
  const onSubmit = vi.fn().mockRejectedValue(
    new ApiError(
      400,
      "INVALID_CATALOG_ENTRY",
      "Проверьте заполнение полей навыка или способности.",
      undefined,
      undefined,
      {
        fieldErrors: [{ path: "data.usageCost.amount", code: "too_small" }],
      },
    ),
  );
  renderComponent(
    <>
      <CatalogEntryForm
        initialKind="ABILITY"
        statLabels={{}}
        resourceLabels={{ physical: "Выносливость", magic: "Мана" }}
        onSubmit={onSubmit}
        onCancel={vi.fn()}
      />
    </>,
  );
  const user = userEvent.setup();
  await user.type(
    screen.getByLabelText("Название *", { exact: true }),
    "Искра",
  );
  await user.click(screen.getByLabelText("Стоимость"));
  await user.click(screen.getByRole("option", { name: "Мана" }));
  await user.click(screen.getByRole("button", { name: /^Сохранить$/ }));

  const amount = screen.getByLabelText("Количество ресурса");
  expect(amount).toHaveAttribute("aria-invalid", "true");
  expect(
    screen.getByText("Стоимость должна быть целым числом от 1 до 100000."),
  ).toBeInTheDocument();
  expect(screen.getByLabelText("Название *", { exact: true })).toHaveValue(
    "Искра",
  );
  expect(amount).toHaveValue(1);
});

it("keeps technical values behind an accessible closed disclosure", async () => {
  vi.stubGlobal("matchMedia", (media: string) => ({
    matches: false,
    media,
    onchange: null,
    addEventListener() {},
    removeEventListener() {},
    addListener() {},
    removeListener() {},
    dispatchEvent: () => true,
  }));
  const onSubmit = vi.fn();
  renderComponent(
    <>
      <CatalogEntryForm
        statLabels={{}}
        resourceLabels={{ physical: "Выносливость", magic: "Мана" }}
        onSubmit={onSubmit}
        onCancel={vi.fn()}
      />
    </>,
  );
  expect(screen.queryByText("Дополнительные числовые параметры")).toBeNull();
  expect(screen.queryByRole("combobox", { name: "Тип" })).toBeNull();
  const user = userEvent.setup();
  await user.click(
    screen.getByRole("button", { name: "Дополнительные настройки" }),
  );
  const details = screen
    .getByText("Дополнительные числовые параметры")
    .closest("details");
  expect(details).not.toBeNull();
  expect(details).not.toHaveAttribute("open");
  expect(
    screen.getByRole("combobox", { name: "Тип записи" }),
  ).toBeInTheDocument();
  await user.click(screen.getByText("Дополнительные числовые параметры"));
  expect(details).toHaveAttribute("open");
  expect(
    screen
      .getByRole("button", { name: "Добавить значение" })
      .closest("details"),
  ).toBe(details);
  expect(screen.getByText(/Обычно заполнять не нужно/)).toBeInTheDocument();
  expect(screen.getByText("Лимит использований")).toBeInTheDocument();
  expect(screen.getByText("Броски")).toBeInTheDocument();
});

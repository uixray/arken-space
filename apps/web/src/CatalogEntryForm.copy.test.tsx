// @vitest-environment jsdom
import { ThemeProvider } from "@gravity-ui/uikit";
import { afterEach, expect, it, vi } from "vitest";
import { renderComponent, screen, userEvent } from "./test-support/render";
import { CatalogEntryForm } from "./CatalogEntryForm";

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
    <ThemeProvider theme="dark" lang="ru">
      <CatalogEntryForm
        statLabels={{}}
        resourceLabels={{ physical: "Выносливость", magic: "Мана" }}
        onSubmit={onSubmit}
        onCancel={vi.fn()}
      />
    </ThemeProvider>,
  );
  const user = userEvent.setup();
  await user.type(screen.getByLabelText("Название", { exact: true }), "Искра");
  await user.click(screen.getByRole("button", { name: "Добавить значение" }));
  const key = screen.getByLabelText("Ключ", {
    exact: true,
  }) as HTMLInputElement;
  expect(key).toHaveAttribute("placeholder", "Код латиницей");
  expect(key).toHaveAttribute("pattern", "[a-z][a-z0-9_]{0,39}");
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
    <ThemeProvider theme="dark" lang="ru">
      <CatalogEntryForm
        statLabels={{}}
        resourceLabels={{ physical: "Выносливость", magic: "Мана" }}
        onSubmit={onSubmit}
        onCancel={vi.fn()}
      />
    </ThemeProvider>,
  );
  const user = userEvent.setup();
  await user.type(screen.getByLabelText("Название", { exact: true }), "Искра");
  await user.click(screen.getByRole("button", { name: "Добавить значение" }));
  await user.type(screen.getByLabelText("Ключ", { exact: true }), "focus");
  await user.clear(screen.getByLabelText("Значение", { exact: true }));
  await user.type(screen.getByLabelText("Значение", { exact: true }), "3");
  await user.click(screen.getByRole("button", { name: "Добавить бросок" }));
  await user.type(screen.getAllByLabelText("Название", { exact: true }).at(-1)!, "Усиление");
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

it("stores explicit no-roll activation cost separately from description prose", async () => {
  vi.stubGlobal("matchMedia", (media: string) => ({
    matches: false, media, onchange: null, addEventListener() {}, removeEventListener() {},
    addListener() {}, removeListener() {}, dispatchEvent: () => true,
  }));
  const onSubmit = vi.fn();
  renderComponent(
    <ThemeProvider theme="dark" lang="ru">
      <CatalogEntryForm
        statLabels={{}}
        resourceLabels={{ physical: "Выносливость", magic: "Мана" }}
        onSubmit={onSubmit}
        onCancel={vi.fn()}
      />
    </ThemeProvider>,
  );
  const user = userEvent.setup();
  await user.type(screen.getByLabelText("Название", { exact: true }), "Световой прыжок");
  await user.click(screen.getByLabelText("Тип"));
  await user.click(screen.getByRole("option", { name: "Способность" }));
  await user.click(screen.getByLabelText("Стоимость активации"));
  await user.click(screen.getByRole("option", { name: "Выносливость" }));
  await user.clear(screen.getByLabelText("Количество ресурса"));
  await user.type(screen.getByLabelText("Количество ресурса"), "2");
  await user.click(screen.getByRole("button", { name: /^Сохранить$/ }));
  expect(onSubmit).toHaveBeenCalledOnce();
  expect(onSubmit.mock.calls[0]![0]).toMatchObject({
    kind: "ABILITY",
    data: { activation: { consumeUse: false, cost: { type: "physical", amount: 2 } } },
  });
});

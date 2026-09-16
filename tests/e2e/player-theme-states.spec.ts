import { expect, test } from "./react-console-guard";
import { PLAYER_THEMES } from "../../apps/web/src/design-system/player-themes";

test("UIX-317 real theme controls distinguish read-only disabled invalid and loading", async ({
  page,
}, info) => {
  const errors: string[] = [];
  const api: string[] = [];
  const receipts: object[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.route("**/api/**", (route) => {
    api.push(
      `${route.request().method()} ${new URL(route.request().url()).pathname}`,
    );
    return route.abort();
  });
  await page.setViewportSize({ width: 390, height: 850 });
  await page.goto("/tests/fixtures/player-themes/");
  const theme = page.getByRole("combobox", { name: "Тема", exact: true });
  const owner = page.getByRole("textbox", { name: "Владелец", exact: true });
  const resource = page.getByRole("textbox", { name: "Ресурс", exact: true });
  const add = page.getByRole("button", { name: "Добавить", exact: true });
  const cancel = page.getByRole("button", { name: "Отмена", exact: true });
  const saving = page.getByRole("button", { name: "Сохранение", exact: true });
  const checkbox = page.getByRole("checkbox", {
    name: "Показывать подпись персонажа",
  });
  for (const entry of PLAYER_THEMES) {
    await theme.click();
    await page.getByRole("option", { name: entry.name, exact: true }).click();
    await expect(page.locator("html")).toHaveAttribute(
      "data-player-theme",
      entry.id,
    );
    await expect(owner).toHaveJSProperty("readOnly", true);
    await expect(owner).toBeEnabled();
    await owner.focus();
    await owner.press("x");
    await expect(owner).toHaveValue("Игрок");
    await owner.press("Tab");
    await expect(resource).toBeFocused();
    await expect(add).toBeDisabled();
    await expect(add).toHaveAccessibleDescription("Введите название ресурса.");
    await expect(saving).toBeDisabled();
    await resource.press("Tab");
    await expect(cancel).toBeFocused();
    await cancel.press("Tab");
    await expect(checkbox).toBeFocused();
    const checked = await checkbox.isChecked();
    await checkbox.press("Space");
    await expect(checkbox).toBeChecked({ checked: !checked });
    await resource.fill("Запас");
    await expect(resource).toHaveAttribute("aria-invalid", "true");
    await expect(resource).toHaveAccessibleDescription(
      "Ресурс «Запас» уже существует.",
    );
    await expect(add).toBeDisabled();
    await resource.fill("Провизия");
    await expect(add).toBeEnabled();
    await resource.press("Tab");
    await expect(add).toBeFocused();
    await expect(add).toHaveAccessibleDescription("Название доступно.");
    await cancel.click();
    await expect(resource).toHaveValue("");
    await expect(add).toBeDisabled();
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth),
    ).toBeLessThanOrEqual(390);
    receipts.push({
      theme: entry.id,
      readonlyFocusable: true,
      disabledAndLoadingSkipped: true,
      invalidDescribed: true,
      validActionFocusable: true,
    });
  }
  await theme.click();
  await page.getByRole("option", { name: "Системная", exact: true }).click();
  await expect(page.locator("html")).not.toHaveAttribute("data-player-theme");
  await expect(owner).toHaveValue("Игрок");
  await info.attach("theme-control-states", {
    body: JSON.stringify({ receipts, errors, api }),
    contentType: "application/json",
  });
  expect(errors).toEqual([]);
  expect(api).toEqual([]);
});

test("UIX-317 readonly fields have a non-color cue without losing text selection", async ({
  page,
}, info) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const api: string[] = [];
  await page.route("**/api/**", (route) => {
    api.push(route.request().url());
    return route.abort();
  });
  await page.setViewportSize({ width: 390, height: 850 });
  await page.goto("/tests/fixtures/player-themes/");
  const theme = page.getByRole("combobox", { name: "Тема", exact: true });
  for (const entry of [{ id: "system", name: "Системная" }, ...PLAYER_THEMES]) {
    if (entry.id !== "system") {
      await theme.click();
      await page.getByRole("option", { name: entry.name, exact: true }).click();
    }
    for (const name of ["Владелец", "Заметка только для чтения"]) {
      const field = page.getByRole("textbox", { name, exact: true });
      const content = field.locator("..");
      await expect(content).toHaveCSS("border-top-style", "dashed");
      // Reach the readonly field with native Tab, not programmatic focus.
      const previous =
        name === "Владелец"
          ? page.getByRole("textbox", { name: "Предыстория", exact: true })
          : page.getByRole("checkbox", {
              name: "Показывать подпись персонажа",
            });
      await previous.focus();
      await previous.press("Tab");
      await expect(field).toBeFocused();
      await expect(content).toHaveCSS("outline-style", "solid");
      await expect(content).toHaveCSS("outline-width", "2px");
      const original = await field.inputValue();
      await field.press("ControlOrMeta+a");
      const selected = await field.evaluate(
        (node: HTMLInputElement | HTMLTextAreaElement) =>
          node.value.slice(node.selectionStart ?? 0, node.selectionEnd ?? 0),
      );
      expect(selected).toBe(original);
      await field.press("Backspace");
      await expect(field).toHaveValue(original);
      // The textarea is the last enabled control: forward Tab may enter
      // browser chrome and retain document.activeElement in Firefox.
      // Verify an explicit in-document destination in each direction instead.
      await field.press(name === "Владелец" ? "Tab" : "Shift+Tab");
      await expect(
        name === "Владелец"
          ? page.getByRole("textbox", { name: "Ресурс", exact: true })
          : previous,
      ).toBeFocused();
    }
    for (const name of [
      "Имя",
      "Предыстория",
      "Недоступное поле",
      "Недоступная заметка",
    ]) {
      const field = page.getByRole("textbox", { name, exact: true });
      await expect(field.locator("..")).toHaveCSS("border-top-style", "solid");
      if (name.startsWith("Недоступ")) await expect(field).toBeDisabled();
    }
    await page
      .getByRole("textbox", { name: "Ресурс", exact: true })
      .fill("Запас");
    await expect(
      page.getByRole("textbox", { name: "Ресурс", exact: true }),
    ).toHaveAttribute("aria-invalid", "true");
    if (entry.id === "system" || entry.id === "light") {
      await info.attach(`readonly-${entry.id}`, {
        body: await page.screenshot({ fullPage: true }),
        contentType: "image/png",
      });
    }
  }
  expect(errors).toEqual([]);
  expect(api).toEqual([]);
});

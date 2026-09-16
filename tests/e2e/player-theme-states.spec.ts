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

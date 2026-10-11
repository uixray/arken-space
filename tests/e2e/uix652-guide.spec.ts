import { expect, test } from "./react-console-guard";

test("UIX-652 guide search, deep links and history stay usable without API writes", async ({
  page,
}) => {
  const mutations: string[] = [];
  await page.route("**/api/**", (route) => {
    const request = route.request();
    if (
      request.method() !== "GET" &&
      !request.url().endsWith("/api/client-logs")
    )
      mutations.push(request.url());
    return route.fulfill({
      status: request.url().endsWith("/api/bootstrap") ? 401 : 200,
      json: [],
    });
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await page
    .getByRole("button", { name: "Показать все клавиши и команды" })
    .focus();
  await page.keyboard.press("/");
  const search = page.getByRole("searchbox", {
    name: "Найти клавишу или действие",
  });
  await expect(search).toBeFocused();
  await search.fill("/d20");
  await expect(page.getByText("Обычный бросок d20")).toBeVisible();
  await expect(page.locator(".guide-section")).toHaveCount(1);
  await page.getByRole("button", { name: "Сбросить поиск" }).click();
  await expect(page.locator(".guide-section")).toHaveCount(8);
  await search.fill("туман");
  await expect(page.locator("#guide-камера")).toHaveCount(0);
  await page.getByRole("link", { name: "Камера" }).click();
  await expect(search).toHaveValue("");
  await expect(page.locator("#guide-камера")).toBeFocused();
  await page.goBack();
  await expect(page).not.toHaveURL(/#guide-/);
  await page.getByRole("link", { name: "Туман войны" }).click();
  await expect(page).toHaveURL(
    /#guide-%D1%82%D1%83%D0%BC%D0%B0%D0%BD-%D0%B2%D0%BE%D0%B9%D0%BD%D1%8B$/i,
  );
  await expect(page.locator("#guide-туман-войны")).toBeFocused();
  await page.goBack();
  await expect(page).not.toHaveURL(/#guide-/);
  await page.goto("/#guide-камера");
  await expect(page.locator("#guide-камера")).toBeFocused();
  await page.goto("/");
  await page.evaluate(() => {
    history.replaceState(null, "", "#guide-%");
    window.dispatchEvent(new HashChangeEvent("hashchange"));
  });
  await expect(
    page.getByRole("button", { name: "Показать все клавиши и команды" }),
  ).toHaveAttribute("aria-expanded", "false");
  await page.setViewportSize({ width: 1280, height: 800 });
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth),
  ).toBeLessThanOrEqual(1280);
  expect(mutations).toEqual([]);
});

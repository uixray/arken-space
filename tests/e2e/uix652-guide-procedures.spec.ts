import { expect, test } from "./react-console-guard";

test("UIX-652 procedures and FAQ stay discoverable without displacing sign-in", async ({
  page,
}) => {
  const mutations: string[] = [];
  await page.route("**/api/**", (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    if (request.method() !== "GET" && path !== "/api/client-logs")
      mutations.push(path);
    if (path === "/api/bootstrap")
      return route.fulfill({ status: 401, json: { error: "AUTH_REQUIRED" } });
    if (path === "/api/account/capabilities")
      return route.fulfill({
        json: {
          accountAuthEnabled: false,
          registrationEnabled: false,
          legacyDevEnabled: true,
          campaignLinkAccessEnabled: false,
          campaignCreationEnabled: false,
        },
      });
    return route.fulfill({ json: [] });
  });

  const inspectAt = async (width: number, height: number) => {
    await page.setViewportSize({ width, height });
    await page.goto("/");

    const signIn = page.getByRole("form", { name: "Вход в игру" });
    const guide = page.getByRole("heading", { name: "Краткое руководство" });
    await expect(signIn).toBeVisible();
    await expect(guide).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "Как сделать" }),
    ).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "Короткие ответы" }),
    ).toBeVisible();
    await expect(page.locator(".guide-procedure")).toHaveCount(4);
    await expect(page.locator(".guide-faq__item")).toHaveCount(4);
    await expect(
      page.getByText("Почему инструменты тумана не видны игроку?"),
    ).toBeVisible();

    const workflowText = await page.locator(".guide-procedure").allInnerTexts();
    expect(workflowText.join("\n")).toContain("Игрок");
    expect(workflowText.join("\n")).toContain("Мастер");

    const signInBox = await signIn.boundingBox();
    const guideBox = await guide.boundingBox();
    expect(signInBox).not.toBeNull();
    expect(guideBox).not.toBeNull();
    expect(signInBox!.y).toBeLessThan(guideBox!.y);
    expect(signInBox!.y).toBeLessThan(height);
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth),
    ).toBeLessThanOrEqual(width);

    const gridColumns = await page
      .locator(".guide-procedures__grid")
      .evaluate((element) => getComputedStyle(element).gridTemplateColumns);
    return gridColumns.trim().split(/\s+/).length;
  };

  const mobileColumns = await inspectAt(390, 844);
  expect(mobileColumns).toBe(1);

  const articleLink = page
    .getByRole("link", { name: "Подсказка по клавишам и командам" })
    .first();
  await articleLink.focus();
  await expect(articleLink).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/#guide-%D0%BA%D0%B0%D0%BC%D0%B5%D1%80%D0%B0$/i);
  await expect(page.locator("#guide-камера")).toBeFocused();

  const search = page.getByRole("searchbox", {
    name: "Найти клавишу или действие",
  });
  await search.fill("туман");
  await expect(page.locator(".guide-section")).toHaveCount(1);
  await expect(
    page.getByRole("heading", { name: "Туман войны", exact: true }),
  ).toBeVisible();
  await expect(page.locator(".guide-procedure")).toHaveCount(4);
  await expect(page.locator(".guide-gallery")).not.toHaveAttribute("open");

  const desktopColumns = await inspectAt(1280, 800);
  expect(desktopColumns).toBe(2);
  await expect(page.locator(".guide-procedure")).toHaveCount(4);
  await expect(page.locator(".guide-faq__item")).toHaveCount(4);
  await expect(page.locator(".guide-gallery")).not.toHaveAttribute("open");
  expect(mutations).toEqual([]);
});

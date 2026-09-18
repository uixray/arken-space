import { expect, test } from "./react-console-guard";

for (const width of [360, 820]) {
  test(`compact landing links and expanded guide stay reachable at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 640 });
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
    await page.goto("/");
    await expect(page.locator(".landing-badge")).toHaveText("Ранний доступ");
    await expect(page.locator(".landing-intro .landing-kicker")).toHaveText(
      "Виртуальный стол для домашних настольных ролевых игр",
    );
    const textColor = await page.evaluate(() => {
      const hex = getComputedStyle(document.documentElement)
        .getPropertyValue("--color-text-accent")
        .trim();
      if (!/^#[0-9a-f]{6}$/i.test(hex))
        throw new Error(`Unexpected baseline text token: ${hex}`);
      return `rgb(${[1, 3, 5].map((index) => parseInt(hex.slice(index, index + 2), 16)).join(", ")})`;
    });
    await expect(page.locator(".landing-intro .landing-kicker")).toHaveCSS(
      "color",
      textColor,
    );
    const roadmapColors = await page
      .locator(".landing-roadmap li")
      .evaluateAll((items) =>
        items.map((item) => getComputedStyle(item, "::before").color),
      );
    expect(roadmapColors.length).toBeGreaterThan(0);
    expect(roadmapColors.every((color) => color === textColor)).toBe(true);
    await expect(
      page.getByRole("heading", { name: "Выберите игрока", exact: true }),
    ).toBeVisible();
    const failures: object[] = [];
    for (const link of await page.locator(".landing-shell a:visible").all()) {
      await link.scrollIntoViewIfNeeded();
      const box = await link.evaluate((node) => {
        const r = node.getBoundingClientRect();
        return {
          name: node.textContent,
          width: r.width,
          height: r.height,
          left: r.left,
          right: r.right,
          hit: node.contains(
            document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2),
          ),
        };
      });
      if (
        box.width < 44 ||
        box.height < 44 ||
        box.left < 0 ||
        box.right > width ||
        !box.hit
      )
        failures.push(box);
    }
    await page
      .getByRole("button", { name: "Показать все клавиши и команды" })
      .click();
    await expect(page.locator("#guide-shortcuts")).toBeVisible();
    const overflow = await page.locator(".landing-shell").evaluate((root) =>
      [...root.querySelectorAll<HTMLElement>("*")]
        .filter(
          (e) =>
            !e.closest(".feedback-honeypot") &&
            e.getClientRects().length &&
            e.scrollWidth > e.clientWidth + 1 &&
            getComputedStyle(e).display !== "inline",
        )
        .map((e) => ({
          className: e.className,
          scroll: e.scrollWidth,
          client: e.clientWidth,
        })),
    );
    expect(overflow).toEqual([]);
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth),
    ).toBeLessThanOrEqual(width);
    expect(failures).toEqual([]);
    await page.getByRole("button", { name: "Свернуть управление" }).click();
    await expect(page.locator("#guide-shortcuts")).toHaveCount(0);
    expect(mutations).toEqual([]);
  });
}

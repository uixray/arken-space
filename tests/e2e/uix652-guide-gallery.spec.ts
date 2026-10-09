import { mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { expect, test } from "./react-console-guard";

const receiptDir = resolve(
  process.cwd(),
  ".data/qa-prep/uix652-guide-gallery-20261009",
);

for (const viewport of [
  { name: "mobile", width: 390, height: 844 },
  { name: "desktop", width: 1280, height: 800 },
]) {
  test(`guide screenshot gallery renders at ${viewport.name} width without overflow`, async ({
    page,
  }) => {
    const mutations: string[] = [];
    const imageResponses: number[] = [];
    await page.route("**/api/**", (route) => {
      const request = route.request();
      if (
        request.method() !== "GET" &&
        !request.url().endsWith("/api/client-logs")
      )
        mutations.push(request.url());
      return route.fulfill({
        status: request.url().endsWith("/api/bootstrap") ? 401 : 200,
        json: request.url().endsWith("/api/account/capabilities") ? { accountAuthEnabled: false, registrationEnabled: false, legacyDevEnabled: true, campaignLinkAccessEnabled: false, campaignCreationEnabled: false } : [],
      });
    });
    page.on("response", (response) => {
      if (response.url().includes("/assets/guide/"))
        imageResponses.push(response.status());
    });

    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    await page.goto("/");
    const gallery = page.locator(".guide-gallery");
    await gallery.locator("summary").click();
    const images = gallery.locator("img");
    await expect(images).toHaveCount(3);
    await gallery.scrollIntoViewIfNeeded();
    for (const image of await images.all()) {
      await expect(image).toBeVisible();
      await expect(image).toHaveAttribute("loading", "lazy");
      await expect(image).toHaveAttribute("alt", /.+/);
      await expect.poll(() => image.evaluate((img: HTMLImageElement) => img.complete && img.naturalWidth > 0)).toBe(true);
    }
    await expect.poll(() => imageResponses.length).toBe(3);
    expect(imageResponses.every((status) => status === 200)).toBe(true);
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth),
    ).toBeLessThanOrEqual(viewport.width);
    expect(
      await gallery.evaluate((el) => el.scrollWidth),
    ).toBeLessThanOrEqual(await gallery.evaluate((el) => el.clientWidth));
    expect(
      await gallery.evaluate((el) => el.scrollWidth <= el.clientWidth),
    ).toBe(true);
    expect(mutations).toEqual([]);

    mkdirSync(receiptDir, { recursive: true });
    await gallery.screenshot({
      path: resolve(receiptDir, `${viewport.name}-gallery.png`),
    });
  });
}



import { randomUUID } from "node:crypto";
import type { Page } from "@playwright/test";
import { expect, test } from "./campaign-fixture";
import { openWorkspaceSection } from "./workspace-nav-helper";

/**
 * UIX-695: a short smoke against the production frontend build.
 *
 * Every other browser test runs on the Vite dev server, which never exercises
 * the bundle that ships: hashed chunks, the renderer's lazy chunk, the preview
 * proxy. This one runs only in the release gate
 * (.github/workflows/release-smoke.yml), with a real API and a disposable
 * database; the campaign fixture creates and owns its synthetic campaign.
 */
test.skip(
  process.env.ARKEN_RELEASE_SMOKE !== "production-build",
  "Release gate only: runs against `vite build` output via release-smoke.yml",
);

function watch(client: Page, problems: string[]) {
  client.on("pageerror", (error) =>
    problems.push(`pageerror: ${error.message}`),
  );
  client.on("response", (response) => {
    const url = response.url();
    if (
      response.status() >= 500 ||
      (url.includes("/assets/") && response.status() >= 400)
    )
      problems.push(`${response.status()} ${url}`);
  });
  client.on("requestfailed", (request) => {
    if (request.url().includes("/assets/"))
      problems.push(`failed ${request.url()}`);
  });
}

async function enter(client: Page) {
  await client
    .getByRole("button", {
      name: /^(Войти(?: в игру)?|Продолжить в игру)$/,
      exact: true,
    })
    .click();
  await expect(client.locator(".app-shell")).toBeVisible();
}

test("UIX-695 production build: GM, workspace, player join and chat", async ({
  page,
  browser,
  gmToken,
}, info) => {
  expect(new URL(info.project.use.baseURL!).hostname).toBe("127.0.0.1");
  const problems: string[] = [];
  watch(page, problems);
  await page.setViewportSize({ width: 1280, height: 850 });

  await page.goto(`/gm/${gmToken}`);
  // The shipped bundle, not the dev server: no Vite client, hashed entry.
  await expect(page.locator('script[src*="/@vite/client"]')).toHaveCount(0);
  await expect(
    page.locator('script[type="module"][src*="/assets/index-"]'),
  ).toHaveCount(1);
  await enter(page);
  await expect(page.locator(".map-viewport")).toBeVisible();

  // A workspace dialog renders from the production bundle.
  await openWorkspaceSection(page, "Карты мира");
  const worldMaps = page.getByRole("dialog", { name: "Карты мира" });
  await expect(worldMaps).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(worldMaps).toBeHidden();

  const bootstrap = await page.request.get("/api/bootstrap");
  await expect(bootstrap).toBeOK();
  const invite = await page.request.post("/api/invites", {
    data: {
      actionId: randomUUID(),
      characterId: (await bootstrap.json()).characters[0].id,
      label: "Release smoke",
      expiresInHours: 1,
    },
  });
  await expect(invite).toBeOK();

  const context = await browser.newContext({
    baseURL: info.project.use.baseURL,
    viewport: { width: 1280, height: 850 },
  });
  try {
    const player = await context.newPage();
    watch(player, problems);
    await player.goto(new URL((await invite.json()).url).pathname);
    await player.getByLabel(/^Имя(?: в кампании)?$/).fill("Игрок smoke");
    await enter(player);
    await expect(player.locator(".map-viewport")).toBeVisible();

    // A chat message crosses the real API and socket to the other client.
    const text = `smoke ${randomUUID().slice(0, 8)}`;
    const composer = page
      .locator("#chat-panel-activity")
      .getByLabel("Сообщение или бросок", { exact: true });
    await composer.fill(text);
    await composer.press("Enter");
    await expect(
      player.locator("#chat-panel-activity").getByText(text, { exact: true }),
    ).toBeVisible();
  } finally {
    await context.close();
  }
  expect(problems).toEqual([]);
});

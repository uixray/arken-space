import { expect, test } from "./react-console-guard";
import { buildGameSnapshot } from "../../apps/web/src/test-support/game-snapshot-fixtures";

for (const width of [390, 1440]) {
  test(`local Pragmatica Next loads and applies ${width}px`, async ({
    page,
    browserName,
  }, testInfo) => {
    await page.setViewportSize({ width, height: 900 });
    const snapshot = buildGameSnapshot("GM");
    snapshot.scenes = [];
    const fontResponses: number[] = [];
    const remoteFontRequests: string[] = [];
    await page.on("request", (request) => {
      if (/fonts\.googleapis\.com|fonts\.gstatic\.com/i.test(request.url()))
        remoteFontRequests.push(request.url());
    });
    await page.on("response", (response) => {
      if (
        new URL(response.url()).pathname.endsWith(
          "/assets/pragmatica-next_vf.woff",
        )
      )
        fontResponses.push(response.status());
    });

    await page.route("**/api/**", (route) => {
      const path = new URL(route.request().url()).pathname;
      if (route.request().method() !== "GET" && path !== "/api/client-logs")
        return route.fulfill({
          status: 405,
          json: { error: "READ_ONLY_FIXTURE" },
        });
      if (path === "/api/bootstrap") return route.fulfill({ json: snapshot });
      if (path === "/api/story/posts")
        return route.fulfill({ json: { posts: [], nextCursor: null } });
      if (path === "/api/operator/feedback/capability")
        return route.fulfill({ status: 403, json: { error: "FORBIDDEN" } });
      return route.fulfill({ json: [] });
    });
    await page.routeWebSocket(/\/socket\.io\//, (socket) => {
      socket.onMessage((message) => {
        if (message.toString() === "40") socket.send('40{"sid":"font-test"}');
      });
      socket.send(
        '0{"sid":"font-engine","upgrades":[],"pingInterval":60000,"pingTimeout":60000,"maxPayload":1000000}',
      );
    });

    await page.goto("/");
    await page.evaluate(async () => {
      await document.fonts.ready;
      await Promise.all(
        [400, 600, 800].map((weight) =>
          document.fonts.load(
            `${weight} 16px "Pragmatica Next"`,
            "Arken Space — Проверка шрифта",
          ),
        ),
      );
    });
    const result = await page.evaluate(() => {
      const sample = "Arken Space — Проверка шрифта";
      const bodyStyle = getComputedStyle(document.body);
      const gravity = document.querySelector<HTMLElement>(".g-root");
      const gravityStyle = gravity ? getComputedStyle(gravity) : null;
      const canvas = document.createElement("canvas");
      const context = canvas.getContext("2d")!;
      context.font = '400 16px "Pragmatica Next"';
      const pragmaticaWidth = context.measureText(sample).width;
      context.font = "400 16px sans-serif";
      const fallbackWidth = context.measureText(sample).width;
      return {
        bodyFamily: bodyStyle.fontFamily,
        gravityFamily:
          gravityStyle
            ?.getPropertyValue("--g-text-body-font-family")
            .replace(/\s+/g, " ")
            .trim() ?? null,
        fontChecks: [400, 600, 800].map((weight) =>
          document.fonts.check(`${weight} 16px "Pragmatica Next"`, sample),
        ),
        pragmaticaWidth,
        fallbackWidth,
        buttonCount: document.querySelectorAll("button").length,
      };
    });
    expect(result.bodyFamily).toMatch(/^"Pragmatica Next"/);
    expect(result.gravityFamily).toBe(
      '"Pragmatica Next", system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
    );
    expect(result.fontChecks).toEqual([true, true, true]);
    expect(result.pragmaticaWidth).toBeGreaterThan(0);
    expect(Number.isFinite(result.pragmaticaWidth)).toBe(true);
    expect(fontResponses).toContain(200);
    expect(remoteFontRequests).toEqual([]);
    expect(result.buttonCount).toBeGreaterThan(0);
    await page.screenshot({
      path: testInfo.outputPath(`local-font-${browserName}-${width}.png`),
      fullPage: true,
    });
  });
}

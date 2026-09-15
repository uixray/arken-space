import { type Request, type Route } from "@playwright/test";
import { captureAuthClickDiagnostics } from "./auth-click-diagnostics";
import { expect, test } from "./campaign-fixture";

// Hypothesis probe, not a workaround: only external font binaries are held.
const FONT_URL = /^https:\/\/fonts\.gstatic\.com\/[^?#]+\.woff2(?:[?#].*)?$/;

for (const transition of [false, true]) {
  test(
    transition
      ? "GM auth survives fonts completing between native pointerdown and pointerup"
      : "GM auth stable-font single-click control",
    async ({ page, gmToken }) => {
      let released = false;
      let heldFonts = 0;
      let routeFailures = 0;
      let authPosts = 0;
      let mouseDown = false;
      let releaseFonts!: () => void;
      const fontBarrier = new Promise<void>((resolve) => {
        releaseFonts = resolve;
      });
      const release = () => {
        released = true;
        releaseFonts();
      };
      const fontRoute = async (route: Route) => {
        if (!released) {
          heldFonts += 1;
          await fontBarrier;
        }
        await route.continue().catch(() => {
          routeFailures += 1;
        });
      };
      const onRequest = (request: Request) => {
        if (
          request.method() === "POST" &&
          new URL(request.url()).pathname === "/api/auth/gm"
        ) {
          authPosts += 1;
        }
      };
      const button = page.getByRole("button", { name: "Войти" });
      let diagnostics:
        Awaited<ReturnType<typeof captureAuthClickDiagnostics>> | undefined;
      const geometry: unknown[] = [];
      const snapshot = async () => {
        geometry.push(
          await button.evaluate((element) => {
            const rect = element.getBoundingClientRect();
            const round = (value: number) => Math.round(value * 100) / 100;
            return {
              stamp: round(performance.now()),
              fonts: document.fonts.status,
              x: round(rect.x),
              y: round(rect.y),
              width: round(rect.width),
              height: round(rect.height),
            };
          }),
        );
      };
      await page.route(FONT_URL, fontRoute);
      page.on("request", onRequest);
      try {
        await page.goto(`/gm/${gmToken}`, {
          waitUntil: "domcontentloaded",
        });
        await expect(button).toBeVisible();
        await expect.poll(() => heldFonts).toBeGreaterThan(0);
        expect(await page.evaluate(() => document.fonts.status)).toBe(
          "loading",
        );
        diagnostics = await captureAuthClickDiagnostics(button);
        await snapshot();
        if (transition) {
          const rect = await button.boundingBox();
          expect(rect).not.toBeNull();
          if (!rect) throw new Error("Login button has no geometry");
          await page.mouse.move(
            rect.x + rect.width / 2,
            rect.y + rect.height / 2,
          );
          mouseDown = true;
          await page.mouse.down();
          release();
          await page.evaluate(() => document.fonts.ready.then(() => undefined));
          await snapshot();
          await page.mouse.up();
          mouseDown = false;
        } else {
          release();
          await page.evaluate(() => document.fonts.ready.then(() => undefined));
          await snapshot();
          await button.click();
        }
        await expect(page).toHaveURL("/");
        await expect(page.locator("canvas").first()).toBeVisible();
        expect(authPosts).toBe(1);
        expect(routeFailures).toBe(0);
      } finally {
        release();
        if (mouseDown) await page.mouse.up().catch(() => {});
        await page.unroute(FONT_URL, fontRoute).catch(() => {});
        page.off("request", onRequest);
        const receipt = {
          transition,
          heldFonts,
          routeFailures,
          authPosts,
          geometry,
          events: diagnostics ? await diagnostics.read() : null,
        };
        console.log("auth-font-transition", JSON.stringify(receipt));
        await test
          .info()
          .attach("auth-font-transition-diagnostics", {
            body: JSON.stringify(receipt),
            contentType: "application/json",
          })
          .catch(() => {});
        await diagnostics?.dispose();
      }
    },
  );
}

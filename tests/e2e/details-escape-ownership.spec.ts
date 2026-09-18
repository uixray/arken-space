import { expect, test } from "./react-console-guard";
import { openWorkspaceSection } from "./workspace-nav-helper";
import { buildGameSnapshot } from "../../apps/web/src/test-support/game-snapshot-fixtures";

for (const role of ["GM", "PLAYER"] as const)
  for (const width of [1280, 390]) {
    test(`UIX-644 background details Escape ${role} ${width}`, async ({
      page,
    }) => {
      await page.setViewportSize({ width, height: 850 });
      const snapshot = buildGameSnapshot(role);
      snapshot.scenes = [
        {
          id: "64500000-0000-4000-8000-000000000001",
          name: "Проверка меню",
          projection: "ORTHOGRAPHIC_2D",
          mapAssetId: null,
          width: 1600,
          height: 1000,
          backgroundFrame: { x: 0, y: 0, width: 1600, height: 1000 },
          grid: {
            enabled: true,
            size: 64,
            offsetX: 0,
            offsetY: 0,
            color: "#c8b78b",
            opacity: 0.22,
          },
          active: true,
        },
      ];
      const mutations: string[] = [];
      await page.route("**/api/**", (route) => {
        const path = new URL(route.request().url()).pathname;
        if (route.request().method() !== "GET" && path !== "/api/client-logs") {
          mutations.push(`${route.request().method()} ${path}`);
          return route.fulfill({
            status: 405,
            json: { error: "READ_ONLY_FIXTURE" },
          });
        }
        if (path === "/api/bootstrap") return route.fulfill({ json: snapshot });
        if (path === "/api/story/posts")
          return route.fulfill({ json: { posts: [], nextCursor: null } });
        if (path === "/api/operator/feedback/capability")
          return route.fulfill({ status: 403, json: { error: "FORBIDDEN" } });
        return route.fulfill({ json: [] });
      });
      await page.routeWebSocket(/\/socket\.io\//, (socket) => {
        socket.onMessage((message) => {
          if (message.toString() === "40")
            socket.send('40{"sid":"icons-socket"}');
        });
        socket.send(
          '0{"sid":"icons-engine","upgrades":[],"pingInterval":60000,"pingTimeout":60000,"maxPayload":1000000}',
        );
      });
      await page.goto("/");
      await expect(page.locator(".map-viewport")).toBeVisible();
      await openWorkspaceSection(page, "Токены");
      const workspace = page.getByRole("dialog", {
        name: "Токены",
        exact: true,
      });
      await expect(workspace).toBeVisible();
      const volume = page.locator(
        width === 390 ? ".account-menu" : ".music-volume-control",
      );
      const trigger = volume.locator("summary");
      // Compact workspaces hide the map/music area; use their visible session menu.
      await trigger.click();
      const slider =
        width === 390
          ? volume.locator(".account-menu__content button").first()
          : volume.getByRole("slider", { name: "Личная громкость" });
      await expect(slider).toBeVisible();
      await expect
        .poll(() =>
          slider.evaluate((node) => {
            const box = node.getBoundingClientRect();
            return node.contains(
              document.elementFromPoint(
                box.x + box.width / 2,
                box.y + box.height / 2,
              ),
            );
          }),
        )
        .toBe(true);
      const popupLayer = await page
        .locator(".topbar")
        .evaluate((node) => Number(getComputedStyle(node).zIndex));
      const workspaceLayer = await workspace.evaluate((node) =>
        Number(getComputedStyle(node).zIndex),
      );
      expect(popupLayer).toBeGreaterThan(workspaceLayer);
      if (role === "GM") {
        await workspace
          .getByRole("button", { name: "Создать токен", exact: true })
          .focus();
        await page.keyboard.press("Enter");
        const modal = page.getByRole("dialog", {
          name: "Новый токен",
          exact: true,
        });
        await expect(modal).toBeVisible();
        const modalLayer = await modal.evaluate((node) =>
          Number(getComputedStyle(node.closest(".g-modal")!).zIndex),
        );
        expect(modalLayer).toBeGreaterThan(popupLayer);
        // Actual pointer close proves the popup does not intercept the modal.
        await modal
          .getByRole("button", { name: "Отмена", exact: true })
          .click();
        await expect(modal).toBeHidden();
        await trigger.click();
        await expect(slider).toBeVisible();
      }
      // Return keyboard focus to the already open workspace, without an outside
      // pointer event (which intentionally dismisses the volume menu).
      await workspace
        .getByRole("button", { name: "Закрыть окно", exact: true })
        .focus();
      await page.keyboard.press("Escape");
      await expect(workspace).toBeHidden();
      await expect(slider).toBeVisible();
      await expect(trigger).not.toBeFocused();
      // Its own Escape still dismisses the menu and restores its trigger.
      await slider.focus();
      await page.keyboard.press("Escape");
      await expect(slider).toBeHidden();
      await expect(trigger).toBeFocused();
      expect(mutations).toEqual([]);
    });
  }

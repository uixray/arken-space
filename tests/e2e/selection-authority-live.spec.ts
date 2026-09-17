import { randomUUID } from "node:crypto";
import type { Page, Route } from "@playwright/test";
import type { GameSnapshot, TokenDto } from "@arken/contracts";
import { expect, test } from "./campaign-fixture";
import { fitRect } from "../../apps/web/src/renderers/camera-fit";

test.skip(
  process.env.ARKEN_SELECTION_LIVE_GATE !== "isolated-loopback",
  "Requires a dedicated isolated loopback server and database",
);

for (const initiator of ["token", "drawing"] as const) {
  test(`UIX-507 real mixed ${initiator} drag recovers, respects revoked control and deletes atomically`, async ({
    page,
    browser,
    gmToken,
  }, info) => {
    expect(new URL(info.project.use.baseURL!).hostname).toBe("127.0.0.1");
    await page.setViewportSize({ width: 1280, height: 850 });
    await page.goto(`/gm/${gmToken}`);
    await page.getByRole("button", { name: "Войти", exact: true }).click();
    await expect(page.locator(".app-shell")).toBeVisible();
    const snapshot = async (client: Page): Promise<GameSnapshot> => {
      const response = await client.request.get("/api/bootstrap");
      await expect(response).toBeOK();
      return response.json();
    };
    const initial = await snapshot(page);
    const scene = initial.scenes.find((item) => item.active)!;
    expect(scene).toBeTruthy();
    const invitation = await page.request.post("/api/invites", {
      data: {
        actionId: randomUUID(),
        characterId: initial.characters[0].id,
        label: "Проверка группового переноса",
        expiresInHours: 1,
      },
    });
    await expect(invitation).toBeOK();
    const context = await browser.newContext({
      baseURL: info.project.use.baseURL,
      viewport: { width: 1280, height: 850 },
    });
    try {
      const player = await context.newPage();
      await player.goto(new URL((await invitation.json()).url).pathname);
      await player.getByLabel("Имя", { exact: true }).fill("Тестовый игрок");
      await player.getByRole("button", { name: "Войти", exact: true }).click();
      await expect(player.locator(".app-shell")).toBeVisible();
      const membership = (await snapshot(player)).me;
      expect(membership.role).toBe("PLAYER");
      const tokenResponse = await page.request.post("/api/tokens", {
        data: {
          actionId: randomUUID(),
          sceneId: scene.id,
          name: "Проверка переноса",
          x: 384,
          y: 320,
          controllerMembershipIds: [membership.id],
        },
      });
      await expect(tokenResponse).toBeOK();
      const token: TokenDto = await tokenResponse.json();
      const drawingResponse = await player.request.post("/api/drawings", {
        data: {
          actionId: randomUUID(),
          sceneId: scene.id,
          x: 512,
          y: 320,
          points: [0, 0, 64, 64],
          color: "#ef4444",
          strokeWidth: 8,
        },
      });
      await expect(drawingResponse).toBeOK();
      const drawing = (await drawingResponse.json()) as NonNullable<
        GameSnapshot["drawings"]
      >[number];
      const fog = await page.request.post("/api/fog-reveals", {
        data: {
          actionId: randomUUID(),
          sceneId: scene.id,
          x: 0,
          y: 0,
          width: scene.width,
          height: scene.height,
          operation: "REVEAL",
        },
      });
      await expect(fog).toBeOK();
      await player.reload();
      await expect(player.locator(".map-viewport")).toBeVisible();

      const camera = async (client: Page) => {
        const map = client.locator(".map-viewport");
        await map.press("f");
        const box = (await map.boundingBox())!;
        const fit = fitRect(
          { x: 0, y: 0, width: scene.width, height: scene.height },
          box,
        );
        return {
          map,
          fit,
          point: (x: number, y: number) => ({
            x: box.x + fit.position.x + x * fit.scale,
            y: box.y + fit.position.y + y * fit.scale,
          }),
        };
      };
      const selectGroup = async () => {
        // Shift marquee toggles existing members; begin each fresh gesture with
        // no selection rather than toggling the recovered group off.
        await player.keyboard.press("Escape");
        const frame = await camera(player);
        const from = frame.point(350, 285),
          to = frame.point(610, 420);
        await player.keyboard.down("Shift");
        try {
          await player.mouse.move(from.x, from.y);
          await player.mouse.down();
          await player.mouse.move(to.x, to.y, { steps: 8 });
          await player.mouse.up();
        } finally {
          await player.keyboard.up("Shift");
        }
        await expect(
          player.getByRole("button", {
            name: "Удалить выбранное",
            exact: true,
          }),
        ).toBeVisible();
        return frame;
      };
      const drag = async () => {
        const frame = await selectGroup();
        const start = frame.point(initiator === "token" ? 416 : 544, 352);
        await player.mouse.move(start.x, start.y);
        await player.mouse.down();
        await player.mouse.move(start.x + 64 * frame.fit.scale, start.y, {
          steps: 8,
        });
        await player.mouse.up();
      };
      // The only interception delays dispatch. Responses and snapshots remain
      // real server output; no route.fulfill with fabricated state/errors.
      let held: Route | undefined;
      let hold = true;
      await player.route("**/api/canvas/bulk", (route) => {
        if (hold) {
          held = route;
          return;
        }
        return route.continue();
      });
      await drag();
      await expect.poll(() => Boolean(held)).toBe(true);
      const original = held!.request().postDataJSON();
      expect(original).toMatchObject({ operation: "MOVE", sceneId: scene.id });
      expect(original.targets).toEqual(
        expect.arrayContaining([
          { targetType: "TOKEN", targetId: token.id, revision: token.revision },
          {
            targetType: "DRAWING",
            targetId: drawing.id,
            revision: drawing.revision,
          },
        ]),
      );
      expect(original.targets).toHaveLength(2);
      const changed = await page.request.patch(`/api/drawings/${drawing.id}`, {
        data: {
          actionId: randomUUID(),
          revision: drawing.revision,
          color: "#00ff88",
        },
      });
      await expect(changed).toBeOK();
      const revised = await changed.json();
      expect(revised.revision).toBe(drawing.revision + 1);
      const rejected = await held!.fetch();
      expect(rejected.status()).toBe(409);
      expect(await rejected.json()).toMatchObject({ error: "STALE_REVISION" });
      // Conflict recovery uses the authoritative socket update, not a full
      // bootstrap reload. Await the actual browser response, then exercise retry.
      const rejectionDelivered = player.waitForResponse(
        (response) => new URL(response.url()).pathname === "/api/canvas/bulk",
      );
      hold = false;
      await held!.fulfill({ response: rejected });
      expect((await rejectionDelivered).status()).toBe(409);
      const state = (data: GameSnapshot) => ({
        token: data.tokens.find((item) => item.id === token.id)!,
        drawing: (data.drawings ?? []).find((item) => item.id === drawing.id)!,
      });
      const afterReject = state(await snapshot(player));
      expect(afterReject.token).toMatchObject({
        x: 384,
        y: 320,
        revision: token.revision,
      });
      expect(afterReject.drawing).toMatchObject({
        x: 512,
        y: 320,
        revision: revised.revision,
      });
      const observer = await camera(page);
      const list = observer.map.getByRole("button", {
        name: "Объекты карты",
        exact: true,
      });
      await list.click();
      await observer.map
        .getByRole("button", { name: token.name, exact: true })
        .click();
      await list.click();
      await expect(observer.map).toHaveAttribute("data-resize-handle-x", /\d/);
      const beforeX = Number(
        await observer.map.getAttribute("data-resize-handle-x"),
      );
      // The observer must not retain a partial single-token preview after the
      // atomic rejection. This reads the rendered handle, not another API fetch.
      expect(beforeX).toBeCloseTo(
        observer.fit.position.x + (token.x + token.width) * observer.fit.scale,
        0,
      );
      const success = player.waitForResponse(
        (response) => new URL(response.url()).pathname === "/api/canvas/bulk",
        { timeout: 10000 },
      );
      await drag();
      const accepted = await success;
      expect(accepted.ok()).toBe(true);
      const movement = accepted.request().postDataJSON();
      // Token drags snap to the grid; drawings intentionally retain freehand
      // coordinates. Browser pointer rounding may shift their delta <1 CSS px.
      if (initiator === "token") expect(movement.deltaX).toBe(64);
      else
        expect(
          Math.abs(movement.deltaX - 64) * observer.fit.scale,
        ).toBeLessThan(1);
      expect(movement.deltaY).toBe(0);
      expect(accepted.request().postDataJSON().targets).toEqual(
        expect.arrayContaining([
          { targetType: "TOKEN", targetId: token.id, revision: token.revision },
          {
            targetType: "DRAWING",
            targetId: drawing.id,
            revision: revised.revision,
          },
        ]),
      );
      const afterMove = state(await snapshot(player));
      expect(afterMove.token).toMatchObject({
        x: 384 + movement.deltaX,
        y: 320,
      });
      expect(afterMove.drawing).toMatchObject({
        x: 512 + movement.deltaX,
        y: 320,
      });
      expect(state(await snapshot(page))).toEqual(afterMove);
      await expect
        .poll(async () =>
          Number(await observer.map.getAttribute("data-resize-handle-x")),
        )
        .toBeCloseTo(beforeX + movement.deltaX * observer.fit.scale, 0);

      const revoked = await page.request.put(
        `/api/token-definitions/${token.definitionId}/controllers`,
        {
          data: {
            actionId: randomUUID(),
            revision: afterMove.token.definitionRevision,
            controllerMembershipIds: [],
          },
        },
      );
      await expect(revoked).toBeOK();
      await expect(
        player.getByRole("button", { name: "Удалить выбранное", exact: true }),
      ).toHaveCount(0);
      const denied = await player.request.post("/api/canvas/bulk", {
        data: {
          actionId: randomUUID(),
          sceneId: scene.id,
          operation: "MOVE",
          deltaX: 64,
          deltaY: 0,
          targets: [
            {
              targetType: "TOKEN",
              targetId: token.id,
              revision: afterMove.token.revision,
            },
            {
              targetType: "DRAWING",
              targetId: drawing.id,
              revision: afterMove.drawing.revision,
            },
          ],
        },
      });
      expect(denied.status()).toBe(403);
      expect(await denied.json()).toMatchObject({
        error: "CANVAS_TARGET_FORBIDDEN",
      });
      const final = state(await snapshot(page));
      expect(final.token).toMatchObject({
        x: afterMove.token.x,
        y: 320,
        revision: afterMove.token.revision,
      });
      expect(final.drawing).toEqual(afterMove.drawing);

      // The GM can still delete the pair deliberately. The player's open object
      // list must converge through the live connection, without a page reload.
      await player
        .getByRole("button", { name: "Объекты карты", exact: true })
        .click();
      const playerDrawing = player
        .locator(".map-object-list")
        .getByRole("button", {
          name: "Рисунок 1",
          exact: true,
        });
      await expect(playerDrawing).toBeVisible();
      await page.keyboard.press("Escape");
      const deletionFrame = await camera(page);
      const from = deletionFrame.point(414, 285);
      const to = deletionFrame.point(674, 420);
      await page.keyboard.down("Shift");
      try {
        await page.mouse.move(from.x, from.y);
        await page.mouse.down();
        await page.mouse.move(to.x, to.y, { steps: 8 });
        await page.mouse.up();
      } finally {
        await page.keyboard.up("Shift");
      }
      const deleteGroup = page.getByRole("button", {
        name: "Удалить выбранное",
        exact: true,
      });
      await deleteGroup.click();
      const dialog = page.getByRole("dialog", {
        name: "Удалить выбранные объекты?",
        exact: true,
      });
      await expect(dialog).toContainText(
        "Выбрано объектов: 2. Токенов: 1. Рисунков: 1.",
      );
      await dialog.getByRole("button", { name: "Отмена", exact: true }).click();
      expect(state(await snapshot(page))).toEqual(final);
      await expect(playerDrawing).toBeVisible();
      await deleteGroup.click();
      const deletedResponse = page.waitForResponse(
        (response) =>
          new URL(response.url()).pathname === "/api/canvas/bulk" &&
          response.request().postDataJSON()?.operation === "DELETE",
        { timeout: 10000 },
      );
      await dialog
        .getByRole("button", { name: "Удалить", exact: true })
        .click();
      const deleted = await deletedResponse;
      expect(deleted.ok()).toBe(true);
      expect(deleted.request().postDataJSON().targets).toHaveLength(2);
      await expect(dialog).toHaveCount(0);
      await expect(deleteGroup).toHaveCount(0);
      await expect(playerDrawing).toHaveCount(0);
      for (const client of [page, player]) {
        const remaining = state(await snapshot(client));
        expect(remaining.token).toBeUndefined();
        expect(remaining.drawing).toBeUndefined();
      }
      await info.attach("connected-selection-authority", {
        body: JSON.stringify({
          initiator,
          conflict: rejected.status(),
          forbidden: denied.status(),
          atomic: true,
          gmRealtimeConverged: true,
          deletionConverged: true,
          tokenRevision: final.token.revision,
          drawingRevision: final.drawing.revision,
        }),
        contentType: "application/json",
      });
    } finally {
      await context.close();
    }
  });
}

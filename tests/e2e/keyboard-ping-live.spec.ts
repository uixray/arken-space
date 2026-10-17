import { randomUUID } from "node:crypto";
import type { Locator, Page } from "@playwright/test";
import type { GameSnapshot, TokenDto } from "@arken/contracts";
import { expect, test } from "./campaign-fixture";
import { fitRect } from "../../apps/web/src/renderers/camera-fit";

test.skip(
  process.env.ARKEN_INPUT_LIVE_GATE !== "isolated-loopback",
  "Requires a dedicated isolated loopback server and database",
);

for (const role of ["GM", "PLAYER"] as const) {
  test(`UIX-405 ${role} keyboard move and Ctrl-ping reach the other rendered client`, async ({
    page,
    browser,
    gmToken,
  }, info) => {
    expect(new URL(info.project.use.baseURL!).hostname).toBe("127.0.0.1");
    await page.setViewportSize({ width: 1280, height: 850 });
    await page.goto(`/gm/${gmToken}`);
    await page
      .getByRole("button", {
        name: /^(Войти(?: в игру)?|Продолжить в игру)$/,
        exact: true,
      })
      .click();
    await expect(page.locator(".app-shell")).toBeVisible();
    const snapshot = async (client: Page): Promise<GameSnapshot> => {
      const response = await client.request.get("/api/bootstrap");
      await expect(response).toBeOK();
      return response.json();
    };
    const initial = await snapshot(page);
    const scene = initial.scenes.find((item) => item.active)!;
    const invite = await page.request.post("/api/invites", {
      data: {
        actionId: randomUUID(),
        characterId: initial.characters[0].id,
        label: "Проверка клавиатуры и пинга",
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
      const errors: string[] = [];
      for (const client of [page, player]) {
        client.on("pageerror", (error) => errors.push(error.message));
      }
      await player.goto(new URL((await invite.json()).url).pathname);
      await player.getByLabel(/^Имя(?: в кампании)?$/).fill("Игрок клавиатуры");
      await player
        .getByRole("button", {
          name: /^(Войти(?: в игру)?|Продолжить в игру)$/,
          exact: true,
        })
        .click();
      await expect(player.locator(".app-shell")).toBeVisible();
      const membership = (await snapshot(player)).me;
      const created = await page.request.post("/api/tokens", {
        data: {
          actionId: randomUUID(),
          sceneId: scene.id,
          name: "Клавиатурный токен",
          x: 384,
          y: 320,
          controllerMembershipIds: [membership.id],
        },
      });
      await expect(created).toBeOK();
      const token: TokenDto = await created.json();
      const reveal = await page.request.post("/api/fog-reveals", {
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
      await expect(reveal).toBeOK();
      const frames: Array<{
        client: Page;
        map: Locator;
        box: { x: number; y: number; width: number; height: number };
        fit: ReturnType<typeof fitRect>;
      }> = [];
      for (const client of [page, player]) {
        await client.reload();
        const map = client.locator(".map-viewport");
        await expect(map).toBeVisible();
        await map.press("f");
        const box = (await map.boundingBox())!;
        const fit = fitRect(
          { x: 0, y: 0, width: scene.width, height: scene.height },
          box,
        );
        // The toolbar owns the object list toggle; the list itself still
        // renders inside the map viewport.
        const list = map.page().getByRole("button", {
          name: "Список объектов и токенов карты",
          exact: true,
        });
        await list.click();
        await map
          .getByRole("button", { name: token.name, exact: true })
          .click();
        await list.click();
        if (client === page) {
          await expect(map).toHaveAttribute("data-resize-handle-x", /\d/);
        }
        frames.push({ client, map, box, fit });
      }
      const sender = frames[role === "GM" ? 0 : 1]!;
      const observer = frames[role === "GM" ? 1 : 0]!;
      const selectionPixels = (frame: (typeof frames)[number], x: number) =>
        frame.map.evaluate(
          (viewport, area) => {
            const bounds = viewport.getBoundingClientRect();
            const output = document.createElement("canvas");
            output.width = Math.ceil(bounds.width);
            output.height = Math.ceil(bounds.height);
            const ctx = output.getContext("2d")!;
            for (const canvas of viewport.querySelectorAll("canvas")) {
              const rect = canvas.getBoundingClientRect();
              ctx.drawImage(
                canvas,
                rect.x - bounds.x,
                rect.y - bounds.y,
                rect.width,
                rect.height,
              );
            }
            const pixels = ctx.getImageData(
              Math.round(area.x) - 1,
              Math.round(area.y),
              3,
              Math.floor(area.height),
            ).data;
            let count = 0;
            for (let i = 0; i < pixels.length; i += 4) {
              if (
                Math.abs(pixels[i]! - 126) < 20 &&
                Math.abs(pixels[i + 1]! - 224) < 20 &&
                Math.abs(pixels[i + 2]! - 255) < 20 &&
                pixels[i + 3]! > 240
              )
                count++;
            }
            return count;
          },
          {
            x: frame.fit.position.x + x * frame.fit.scale - 4,
            y: frame.fit.position.y + token.y * frame.fit.scale,
            height: token.height * frame.fit.scale,
          },
        );
      for (const frame of frames) {
        await expect
          .poll(() => selectionPixels(frame, token.x))
          .toBeGreaterThan(8);
      }
      const moves: unknown[] = [];
      sender.client.on("request", (request) => {
        if (
          request.method() === "POST" &&
          request.url().endsWith("/api/canvas/bulk")
        ) {
          moves.push(request.postDataJSON());
        }
      });
      await sender.map.focus();
      await sender.client.keyboard.down("d");
      try {
        for (let i = 0; i < 8; i++) await sender.client.keyboard.down("d");
      } finally {
        await sender.client.keyboard.up("d");
      }
      const step = scene.grid.enabled ? scene.grid.size : 8;
      await expect
        .poll(
          async () =>
            (await snapshot(page)).tokens.find((t) => t.id === token.id)?.x,
        )
        .toBe(token.x + step);
      for (const frame of frames) {
        await expect
          .poll(() => selectionPixels(frame, token.x + step))
          .toBeGreaterThan(8);
        await expect.poll(() => selectionPixels(frame, token.x)).toBe(0);
      }
      expect(moves).toHaveLength(1);

      // UIX-508 made the ping an animated ring in the sender's cursor colour,
      // so sample geometry, not a fixed colour: the lower arc around the
      // point, away from the sender's cursor and label, must visibly change on
      // the other client and return to its baseline after the ping lifetime.
      // Composite all real canvas layers: hidden pixels under fog do not count.
      const point = { x: 800, y: 500 };
      const center = {
        x: observer.fit.position.x + point.x * observer.fit.scale,
        y: observer.fit.position.y + point.y * observer.fit.scale,
      };
      const arcPixels = () =>
        observer.map.evaluate((viewport, c) => {
          const bounds = viewport.getBoundingClientRect();
          const output = document.createElement("canvas");
          output.width = Math.ceil(bounds.width);
          output.height = Math.ceil(bounds.height);
          const ctx = output.getContext("2d")!;
          for (const canvas of viewport.querySelectorAll("canvas")) {
            const rect = canvas.getBoundingClientRect();
            ctx.drawImage(
              canvas,
              rect.x - bounds.x,
              rect.y - bounds.y,
              rect.width,
              rect.height,
            );
          }
          const samples: number[] = [];
          for (let radius = 12; radius <= 36; radius += 4)
            for (let i = 2; i <= 14; i++) {
              const angle = (Math.PI * i) / 16;
              const x = Math.round(c.x + radius * Math.cos(angle));
              const y = Math.round(c.y + radius * Math.sin(angle));
              samples.push(...ctx.getImageData(x, y, 1, 1).data);
            }
          return samples;
        }, center);
      const baseline = await arcPixels();
      const changedSamples = async () => {
        const current = await arcPixels();
        let changed = 0;
        for (let i = 0; i < current.length; i += 4) {
          const delta =
            Math.abs(current[i]! - baseline[i]!) +
            Math.abs(current[i + 1]! - baseline[i + 1]!) +
            Math.abs(current[i + 2]! - baseline[i + 2]!);
          if (delta > 60) changed++;
        }
        return changed;
      };
      expect(await changedSamples()).toBe(0);
      await sender.client.keyboard.down("Control");
      try {
        await sender.client.mouse.click(
          sender.box.x + sender.fit.position.x + point.x * sender.fit.scale,
          sender.box.y + sender.fit.position.y + point.y * sender.fit.scale,
        );
      } finally {
        await sender.client.keyboard.up("Control");
      }
      await expect.poll(changedSamples, { timeout: 2500 }).toBeGreaterThan(8);
      await info.attach("other-client-visible-ping", {
        body: await observer.map.screenshot(),
        contentType: "image/png",
      });
      await expect.poll(changedSamples, { timeout: 6000 }).toBe(0);
      expect(moves).toHaveLength(1);
      expect(errors).toEqual([]);
      await info.attach("input-evidence", {
        body: JSON.stringify({ role, step, moves, pingVisible: true, errors }),
        contentType: "application/json",
      });
    } finally {
      await context.close();
    }
  });
}

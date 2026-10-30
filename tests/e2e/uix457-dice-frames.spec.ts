import { randomUUID } from "node:crypto";
import { crc32, deflateSync } from "node:zlib";
import type { AssetDto, GameSnapshot } from "@arken/contracts";
import type { Page } from "@playwright/test";
import { expect, test } from "./campaign-fixture";

/**
 * UIX-457: рамка бросков как ассет кампании, end to end на живом backend.
 * APNG синтетический и собирается здесь: исходники владельца не публикуются
 * в тестах, их права не подтверждены.
 */
function chunk(type: string, data: Buffer) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, "latin1"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body) >>> 0);
  return Buffer.concat([length, body, crc]);
}

/** Квадратная рамка шириной `border` px; кадры отличаются цветом. */
function syntheticApng(colors: Array<[number, number, number]>) {
  const size = 96;
  const border = 10;
  const frameData = (color: [number, number, number]) => {
    const row = size * 4 + 1;
    const raw = Buffer.alloc(row * size);
    for (let y = 0; y < size; y++)
      for (let x = 0; x < size; x++) {
        const edge =
          x < border || y < border || x >= size - border || y >= size - border;
        const offset = y * row + 1 + x * 4;
        if (!edge) continue;
        raw[offset] = color[0];
        raw[offset + 1] = color[1];
        raw[offset + 2] = color[2];
        raw[offset + 3] = 255;
      }
    return deflateSync(raw);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  const actl = Buffer.alloc(8);
  actl.writeUInt32BE(colors.length, 0);
  const parts = [
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk("IHDR", ihdr),
    chunk("acTL", actl),
  ];
  let sequence = 0;
  for (const [index, color] of colors.entries()) {
    const fctl = Buffer.alloc(26);
    fctl.writeUInt32BE(sequence++, 0);
    fctl.writeUInt32BE(size, 4);
    fctl.writeUInt32BE(size, 8);
    fctl.writeUInt16BE(1, 20);
    fctl.writeUInt16BE(5, 22);
    parts.push(chunk("fcTL", fctl));
    if (index === 0) parts.push(chunk("IDAT", frameData(color)));
    else {
      const seq = Buffer.alloc(4);
      seq.writeUInt32BE(sequence++);
      parts.push(chunk("fdAT", Buffer.concat([seq, frameData(color)])));
    }
  }
  parts.push(chunk("IEND", Buffer.alloc(0)));
  return Buffer.concat(parts);
}

async function signInAsGm(page: Page, token: string) {
  await page.goto(`/gm/${token}`);
  await page
    .getByRole("button", {
      name: /^(Войти(?: в игру)?|Продолжить в игру)$/,
      exact: true,
    })
    .click();
  await expect(page).toHaveURL("/");
  await expect(page.locator("canvas").first()).toBeVisible();
}

async function openAppearance(page: Page) {
  if (await page.locator("#compact-nav-menu").isVisible()) {
    await page.locator("#compact-nav-menu").click();
    await page.getByRole("button", { name: "Тема и рамка бросков" }).click();
  } else {
    await page.locator(".account-menu > summary").click();
    await page
      .getByRole("button", { name: "Тема и рамка бросков", exact: true })
      .click();
  }
  const dialog = page.getByRole("dialog", {
    name: "Тема и рамка бросков",
    exact: true,
  });
  await expect(dialog).toBeVisible();
  return dialog;
}

async function uploadFrame(page: Page, name: string) {
  const response = await page.request.post("/api/assets?kind=DICE_FRAME", {
    headers: { "x-action-id": randomUUID() },
    multipart: {
      file: {
        name,
        mimeType: "image/png",
        buffer: syntheticApng([
          [220, 60, 40],
          [250, 190, 40],
          [220, 60, 40],
        ]),
      },
    },
  });
  await expect(response).toBeOK();
  return (await response.json()) as AssetDto;
}

const roll = (page: Page) =>
  page.request.post("/api/dice", {
    // Без d20: натуральные 1/20 дали бы критическую рамку вместо выбранной.
    data: { actionId: randomUUID(), formula: "1d6" },
  });

test("UIX-457 a chosen animated frame decorates the newest roll and history shows its poster", async ({
  page,
  gmToken,
}) => {
  test.setTimeout(90_000);
  await signInAsGm(page, gmToken);
  const frame = await uploadFrame(page, "Синтетическая рамка.png");
  await expect
    .poll(async () => {
      const snapshot = (await (
        await page.request.get("/api/bootstrap")
      ).json()) as GameSnapshot;
      return snapshot.assets.find((asset) => asset.id === frame.id)?.posterUrl;
    })
    .toMatch(/variant=poster/);

  const dialog = await openAppearance(page);
  const picker = dialog.getByRole("group", { name: "Рамка ваших бросков" });
  await expect(picker).toBeVisible();
  const saved = page.waitForResponse(
    (response) =>
      response.url().endsWith("/api/me/dice-frame") &&
      response.request().method() === "PATCH",
  );
  await picker
    .getByRole("radio", { name: "Синтетическая рамка", exact: true })
    .check();
  expect((await saved).status()).toBe(200);
  await expect(
    picker.getByRole("radio", { name: "Синтетическая рамка", exact: true }),
  ).toBeChecked();
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();

  const activity = page.locator("#chat-panel-activity");
  const styled = activity.locator(".outcome-frame--style img");
  await expect(await roll(page)).toBeOK();
  await expect(styled).toHaveCount(1);
  await expect(styled.first()).toHaveAttribute(
    "src",
    `/api/assets/${frame.id}/content`,
  );
  await expect
    .poll(() =>
      styled.first().evaluate((img: HTMLImageElement) => img.naturalWidth),
    )
    .toBe(96);

  await expect(await roll(page)).toBeOK();
  await expect(styled).toHaveCount(2);
  // Старший бросок ушёл в историю и показывает статичный постер.
  await expect(
    activity.locator(".outcome-frame--style-history img"),
  ).toHaveAttribute("src", `/api/assets/${frame.id}/content?variant=poster`);
  await expect(
    activity.locator(".outcome-frame--style-active img"),
  ).toHaveCount(1);
  await expect
    .poll(() =>
      activity
        .locator(".outcome-frame--style-history img")
        .evaluate((img: HTMLImageElement) => img.naturalWidth),
    )
    .toBe(96);

  // Reduced motion: свежий бросок тоже берёт постер.
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.reload();
  await expect(styled).toHaveCount(2);
  await expect
    .poll(() =>
      activity
        .locator(".outcome-frame--style-active img")
        .evaluate((img: HTMLImageElement) => img.currentSrc),
    )
    .toMatch(new RegExp(`/api/assets/${frame.id}/content\\?variant=poster$`));
});

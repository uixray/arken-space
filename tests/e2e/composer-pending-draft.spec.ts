import { type Page, type Response, type Route } from "@playwright/test";
import { expect, test } from "./campaign-fixture";

const MARKER = "UIX624_COMPOSER_PENDING_DRAFT";

function deferred() {
  let release!: () => void;
  const promise = new Promise<void>((resolve) => {
    release = resolve;
  });
  return { promise, release };
}

async function settleClient(page: Page, responsePromise: Promise<Response>) {
  const response = await responsePromise;
  await response.finished();
  await page.evaluate(
    () =>
      new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
      ),
  );
}

test(`${MARKER}: late success preserves a newer activity draft and private send`, async ({
  page,
  gmToken,
}) => {
  await page.goto(`/gm/${gmToken}`);
  await page.getByRole("button", { name: "Войти", exact: true }).click();
  await expect(page).toHaveURL("/");
  await page.locator("#chat-tab-activity").click();
  const composer = page
    .locator("#chat-panel-activity")
    .getByLabel("Сообщение или бросок", { exact: true });

  const heldSuccess = deferred();
  const successSettled = deferred();
  const requests: Array<{
    body: string;
    visibility: string;
    stream: string;
  }> = [];
  await page.route("**/api/chat", async (route: Route) => {
    const request = route.request().postDataJSON() as {
      body: string;
      visibility: string;
      stream: string;
    };
    requests.push(request);
    if (request.body === "Первое задержанное") {
      await heldSuccess.promise;
      await route.fulfill({ status: 201, body: "{}" });
      successSettled.release();
      return;
    }
    await route.fulfill({ status: 201, body: "{}" });
  });

  try {
    await composer.fill("/");
    const commands = page
      .locator("#chat-panel-activity")
      .getByRole("button", { name: "Быстрые команды", exact: true });
    await expect(commands).toHaveAttribute("aria-expanded", "true");
    await expect(commands).toHaveAttribute(
      "aria-controls",
      "activity-slash-suggestions",
    );
    await expect(page.locator("#activity-slash-suggestions")).toBeVisible();
    await expect(
      composer,
      `${MARKER}: textbox does not own unsupported expanded state`,
    ).not.toHaveAttribute("aria-expanded");
    await composer.fill("Первое задержанное");
    const firstResponse = page.waitForResponse(
      (response) =>
        response.url().endsWith("/api/chat") &&
        response.request().postData()?.includes("Первое задержанное") === true,
    );
    await composer.press("Enter");
    await expect(
      composer,
      `${MARKER}: accepted draft clears immediately`,
    ).toHaveValue("");
    await composer.fill("Второе приватное");
    heldSuccess.release();
    await successSettled.promise;
    await settleClient(page, firstResponse);
    await expect(
      composer,
      `${MARKER}: late success preserves newer nonempty draft`,
    ).toHaveValue("Второе приватное");
    const secondResponse = page.waitForResponse(
      (response) =>
        response.url().endsWith("/api/chat") &&
        response.request().postData()?.includes("Второе приватное") === true,
    );
    await composer.press("Control+Enter");
    await settleClient(page, secondResponse);
    await expect.poll(() => requests.length).toBe(2);
    expect(requests).toMatchObject([
      { body: "Первое задержанное", visibility: "PUBLIC", stream: "TABLE" },
      {
        body: "Второе приватное",
        visibility: "GM_ONLY",
        stream: "TABLE",
      },
    ]);
    await expect(composer).toHaveValue("");
  } finally {
    heldSuccess.release();
  }
});

test(`${MARKER}: activity failure restores only an untouched consumed draft`, async ({
  page,
  gmToken,
}) => {
  await page.goto(`/gm/${gmToken}`);
  await page.getByRole("button", { name: "Войти", exact: true }).click();
  await expect(page).toHaveURL("/");
  await page.locator("#chat-tab-activity").click();
  const composer = page
    .locator("#chat-panel-activity")
    .getByLabel("Сообщение или бросок", { exact: true });
  const heldUntouched = deferred();
  const heldFailure = deferred();
  const untouchedFailureSettled = deferred();
  const heldFailureSettled = deferred();
  await page.route("**/api/chat", async (route) => {
    const { body } = route.request().postDataJSON();
    if (body === "Восстановить без правок") {
      await heldUntouched.promise;
      await route.fulfill({ status: 500, body: "failure" });
      untouchedFailureSettled.release();
    } else {
      await heldFailure.promise;
      await route.fulfill({ status: 500, body: "failure" });
      heldFailureSettled.release();
    }
  });
  try {
    await composer.fill("Восстановить без правок");
    const untouchedFailureResponse = page.waitForResponse(
      (response) =>
        response.url().endsWith("/api/chat") &&
        response.request().postData()?.includes("Восстановить без правок") ===
          true,
    );
    await composer.press("Enter");
    await expect(composer).toHaveValue("");
    heldUntouched.release();
    await untouchedFailureSettled.promise;
    await settleClient(page, untouchedFailureResponse);
    await expect(
      composer,
      `${MARKER}: untouched consumed slot restores after failure`,
    ).toHaveValue("Восстановить без правок");

    const panel = page.locator("#chat-panel-activity");
    const error = panel.getByText(
      "Не удалось отправить сообщение. Проверьте соединение и повторите попытку.",
      { exact: true },
    );
    await expect(error).toBeVisible();

    await composer.fill("Ошибка после новой правки");
    const heldFailureResponse = page.waitForResponse(
      (response) =>
        response.url().endsWith("/api/chat") &&
        response.request().postData()?.includes("Ошибка после новой правки") ===
          true,
    );
    await composer.press("Enter");
    await expect(composer).toHaveValue("");
    await expect(error).toHaveCount(0);
    await composer.fill("Новая правка");
    await composer.fill("");
    heldFailure.release();
    await heldFailureSettled.promise;
    await settleClient(page, heldFailureResponse);
    await expect(error).toBeVisible();
    await expect(
      composer,
      `${MARKER}: intentional newer empty draft is not old failure restore`,
    ).toHaveValue("");
  } finally {
    heldUntouched.release();
    heldFailure.release();
  }
});

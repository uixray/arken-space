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

test(`${MARKER}: late success and failure never overwrite a newer activity draft`, async ({
  page,
  gmToken,
}) => {
  await page.goto(`/gm/${gmToken}`);
  await page.getByRole("button", { name: "Войти", exact: true }).click();
  await page.locator("#chat-tab-activity").click();
  const composer = page
    .locator("#chat-panel-activity")
    .getByLabel("Сообщение или бросок", { exact: true });

  const heldSuccess = deferred();
  const successSettled = deferred();
  const heldFailure = deferred();
  const heldFailureSettled = deferred();
  const untouchedFailureSettled = deferred();
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
    if (request.body === "Ошибка после новой правки") {
      await heldFailure.promise;
      await route.fulfill({ status: 500, body: "failure" });
      heldFailureSettled.release();
      return;
    }
    if (request.body === "Восстановить без правок") {
      await route.fulfill({ status: 500, body: "failure" });
      untouchedFailureSettled.release();
      return;
    }
    await route.fulfill({ status: 201, body: "{}" });
  });

  try {
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
    await composer.press("Control+Enter");
    await expect.poll(() => requests.length).toBe(2);
    expect(requests).toMatchObject([
      { body: "Первое задержанное", visibility: "PUBLIC", stream: "TABLE" },
      {
        body: "Второе приватное",
        visibility: "GM_ONLY",
        stream: "TABLE",
      },
    ]);

    await composer.fill("Восстановить без правок");
    const untouchedFailureResponse = page.waitForResponse(
      (response) =>
        response.url().endsWith("/api/chat") &&
        response.request().postData()?.includes("Восстановить без правок") ===
          true,
    );
    await composer.press("Enter");
    await untouchedFailureSettled.promise;
    await settleClient(page, untouchedFailureResponse);
    await expect(
      composer,
      `${MARKER}: untouched consumed slot restores after failure`,
    ).toHaveValue("Восстановить без правок");

    await composer.fill("Ошибка после новой правки");
    const heldFailureResponse = page.waitForResponse(
      (response) =>
        response.url().endsWith("/api/chat") &&
        response.request().postData()?.includes("Ошибка после новой правки") ===
          true,
    );
    await composer.press("Enter");
    await composer.fill("Новая правка");
    await composer.fill("");
    heldFailure.release();
    await heldFailureSettled.promise;
    await settleClient(page, heldFailureResponse);
    await expect(
      composer,
      `${MARKER}: intentional newer empty draft is not old failure restore`,
    ).toHaveValue("");
  } finally {
    heldSuccess.release();
    heldFailure.release();
  }
});

test(`${MARKER}: failed table send cannot restore into another stream scope`, async ({
  page,
  gmToken,
}) => {
  await page.goto(`/gm/${gmToken}`);
  await page.getByRole("button", { name: "Войти", exact: true }).click();
  await page.locator("#chat-tab-table").click();
  const heldFailure = deferred();
  const failureSettled = deferred();
  await page.route("**/api/chat", async (route) => {
    await heldFailure.promise;
    await route.fulfill({ status: 500, body: "failure" });
    failureSettled.release();
  });
  const tableComposer = page
    .locator("#chat-panel-table")
    .getByLabel("Сообщение или бросок", { exact: true });
  try {
    await tableComposer.fill("Черновик прежнего потока");
    const failedResponse = page.waitForResponse(
      (response) =>
        response.url().endsWith("/api/chat") &&
        response.request().postData()?.includes("Черновик прежнего потока") ===
          true,
    );
    await tableComposer.press("Enter");
    await expect(tableComposer).toHaveValue("");
    await page.locator("#chat-tab-story").click();
    const storyComposer = page
      .locator("#chat-panel-story")
      .getByLabel("Сообщение сюжета", { exact: true });
    await storyComposer.fill("Черновик другого потока");
    heldFailure.release();
    await failureSettled.promise;
    await settleClient(page, failedResponse);
    await expect(
      storyComposer,
      `${MARKER}: late failure is invalid outside submission scope`,
    ).toHaveValue("Черновик другого потока");
    await expect(
      page.getByText(
        "Не удалось отправить сообщение. Проверьте соединение и повторите попытку.",
        { exact: true },
      ),
      `${MARKER}: stale scope failure has no visible error`,
    ).toHaveCount(0);
    await page.locator("#chat-tab-table").click();
    await expect(tableComposer).toHaveValue("Черновик другого потока");
  } finally {
    heldFailure.release();
  }
});

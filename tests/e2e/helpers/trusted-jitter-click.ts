import { createRequire } from "node:module";
import type { Page, TestInfo } from "@playwright/test";

type Point = { x: number; y: number };
type Progress = { race<T>(operation: Promise<T>): Promise<T> };
type ProgressController = {
  run<T>(task: (progress: Progress) => Promise<T>, timeout: number): Promise<T>;
  abort(error: Error): Promise<void>;
};
type InternalPage = {
  guid: string;
  mouse: {
    move(
      progress: Progress,
      x: number,
      y: number,
      options?: { steps?: number },
    ): Promise<void>;
    down(
      progress: Progress,
      options?: { button?: "left"; clickCount?: number },
    ): Promise<void>;
    up(
      progress: Progress,
      options?: { button?: "left"; clickCount?: number },
    ): Promise<void>;
  };
};
type InternalPageDispatcher = {
  _object: InternalPage;
  createProgressController(metadata: Record<string, unknown>): ProgressController;
};
type DispatcherConnection = {
  _dispatcherByGuid: Map<string, InternalPageDispatcher>;
};
type ClientConnection = {
  toImpl(value: unknown): unknown;
};
type PrivateClientPage = Page & { _guid?: string; _connection?: ClientConnection };

/**
 * A narrowly version-gated Firefox test helper. Playwright's public click APIs
 * serialize these distinct-coordinate inputs into separate calls with expensive
 * test instrumentation between them. This uses only the pinned in-process
 * server mouse API, which keeps its pointer/button state and awaits each trusted
 * Firefox dispatch under a native deadline-bound ProgressController.
 */
export async function trustedJitterDoubleClick(
  page: Page,
  testInfo: TestInfo,
  first: Point,
  second: Point,
): Promise<void> {
  const rootRequire = createRequire(import.meta.url);
  const testRequire = createRequire(rootRequire.resolve("@playwright/test"));
  const playwrightRequire = createRequire(testRequire.resolve("playwright"));
  const coreBundlePath = playwrightRequire.resolve(
    "playwright-core/lib/coreBundle",
  );
  const loaded = playwrightRequire(coreBundlePath) as Record<string, unknown>;
  const core = (loaded.default ?? loaded) as {
    getPlaywrightVersion?: () => string;
    iso?: { monotonicTime?: () => number };
  };
  if (process.env.PW_VERSION_OVERRIDE)
    throw new Error("Trusted jitter helper refuses PW_VERSION_OVERRIDE");
  if (core.getPlaywrightVersion?.() !== "1.62.1")
    throw new Error("Trusted jitter helper requires Playwright 1.62.1");
  if (page.context().browser()?.browserType().name() !== "firefox")
    throw new Error("Trusted jitter helper is Firefox-only");

  const clientPage = page as PrivateClientPage;
  const clientConnection = clientPage._connection;
  const pageGuid = clientPage._guid;
  if (!clientConnection?.toImpl || !pageGuid)
    throw new Error("Playwright page is not using the in-process bridge");
  const pageImpl = clientConnection.toImpl(page) as InternalPage | undefined;
  const dispatcherConnection = clientConnection.toImpl(
    clientConnection,
  ) as DispatcherConnection | undefined;
  const dispatcher = dispatcherConnection?._dispatcherByGuid.get(pageGuid);
  if (
    !pageImpl?.mouse?.move ||
    !pageImpl.mouse.down ||
    !pageImpl.mouse.up ||
    dispatcher?._object !== pageImpl ||
    !dispatcher.createProgressController
  )
    throw new Error("Pinned Playwright in-process mouse bridge is unavailable");

  const monotonicTime = core.iso?.monotonicTime;
  if (!monotonicTime)
    throw new Error("Pinned Playwright monotonic clock is unavailable");
  const deadline = (testInfo as TestInfo & {
    _deadline?: () => { deadline: number };
  })._deadline?.().deadline;
  if (!Number.isFinite(deadline))
    throw new Error("Trusted jitter helper requires a finite test deadline");

  const controller = dispatcher.createProgressController({
    id: `qa-trusted-jitter-${pageGuid}`,
    objectId: pageGuid,
    startTime: monotonicTime(),
    endTime: 0,
    type: "Page",
    method: "qaTrustedJitterDoubleClick",
    params: {},
    log: [],
    internal: true,
  });
  const abortOnClose = () => {
    void controller.abort(new Error("Page closed during trusted polygon input")).catch(() => {});
  };
  page.once("close", abortOnClose);
  try {
    const remainingMs = Math.floor(deadline! - monotonicTime());
    if (!Number.isFinite(remainingMs) || remainingMs <= 0)
      throw new Error("No test deadline remains for trusted polygon input");
    await controller.run(async (progress) => {
      await pageImpl.mouse.move(progress, first.x, first.y);
      await pageImpl.mouse.down(progress, { button: "left", clickCount: 1 });
      await pageImpl.mouse.up(progress, { button: "left", clickCount: 1 });
      await pageImpl.mouse.move(progress, second.x, second.y);
      await pageImpl.mouse.down(progress, { button: "left", clickCount: 2 });
      await pageImpl.mouse.up(progress, { button: "left", clickCount: 2 });
    }, remainingMs);
  } finally {
    page.off("close", abortOnClose);
  }
}
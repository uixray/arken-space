import type { Page } from "@playwright/test";
import type {
  ChatAttachmentMetadata,
  GameSnapshot,
  StoryPostAdminDto,
} from "@arken/contracts";
import { randomUUID } from "node:crypto";
import { writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { expect, test } from "./campaign-fixture";
import { seedChatLog } from "./chat-seed";

const LIST = "#activity-message-list";
const BOTTOM_TOLERANCE = 4;
const FOLLOW_THRESHOLD = 48;

type Geometry = {
  at: number;
  scrollTop: number;
  scrollHeight: number;
  clientHeight: number;
  bottom: number;
  viewport: { width: number; height: number };
  list: { x: number; y: number; width: number; height: number };
  sidebar: { width: number; height: number } | null;
  quickRolls: { height: number; expanded: string | null } | null;
  focused: string | null;
  newEvents: string | null;
  overflowAnchor: string;
  articles: number;
  storyImages: Array<{
    width: number;
    height: number;
    bottom: number;
    naturalWidth: number;
    naturalHeight: number;
    complete: boolean;
    maxHeight: string;
  }>;
  children: Array<{
    index: number;
    tag: string;
    className: string;
    width: number;
    height: number;
  }>;
};
type TraceEvent = Partial<Geometry> &
  Pick<
    Geometry,
    "at" | "scrollTop" | "scrollHeight" | "clientHeight" | "bottom"
  > & {
    phase: string;
    type: string;
    trusted?: boolean;
    key?: string;
  };
type ResizeTrace = {
  phase: string;
  events: TraceEvent[];
  read: () => Geometry;
  record: (type: string, event?: Event) => void;
};
type MeasuredList = HTMLElement & { resizeFollowTrace?: ResizeTrace };

/** Observes real geometry/events; never changes scroll position, CSS or hook state. */
async function observeResizeFollow(page: Page, lean = false) {
  await page.locator(LIST).evaluate((element, lean) => {
    const list = element as MeasuredList;
    const read = (): Geometry => {
      const rect = list.getBoundingClientRect();
      const sidebar = document
        .querySelector(".sidebar")
        ?.getBoundingClientRect();
      const quickRolls = document.querySelector(".quick-roll-panel");
      const focused = document.activeElement;
      return {
        at: performance.now(),
        scrollTop: list.scrollTop,
        scrollHeight: list.scrollHeight,
        clientHeight: list.clientHeight,
        bottom: list.scrollHeight - list.scrollTop - list.clientHeight,
        viewport: { width: window.innerWidth, height: window.innerHeight },
        list: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
        sidebar: sidebar
          ? { width: sidebar.width, height: sidebar.height }
          : null,
        quickRolls: quickRolls
          ? {
              height: quickRolls.getBoundingClientRect().height,
              expanded:
                quickRolls
                  .querySelector(".quick-roll-panel__toggle")
                  ?.getAttribute("aria-expanded") ?? null,
            }
          : null,
        focused: focused
          ? `${focused.tagName}:${focused.getAttribute("aria-label") ?? focused.id}`
          : null,
        newEvents: document.querySelector(".new-messages")?.textContent ?? null,
        overflowAnchor: getComputedStyle(list).overflowAnchor,
        articles: list.querySelectorAll("article.message").length,
        storyImages: Array.from(
          list.querySelectorAll<HTMLImageElement>(".story-post__media img"),
          (image) => {
            const box = image.getBoundingClientRect();
            return {
              width: box.width,
              height: box.height,
              bottom: box.bottom,
              naturalWidth: image.naturalWidth,
              naturalHeight: image.naturalHeight,
              complete: image.complete,
              maxHeight: getComputedStyle(image).maxHeight,
            };
          },
        ),
        // Geometry only: no message text, campaign content or private labels.
        children: Array.from(list.children, (child, index) => {
          const box = child.getBoundingClientRect();
          return {
            index,
            tag: child.tagName,
            className: child.className,
            width: box.width,
            height: box.height,
          };
        }),
      };
    };
    const trace: ResizeTrace = {
      phase: "installed",
      events: [],
      read,
      record: (type, event) => {
        trace.events.push({
          ...(lean
            ? {
                at: performance.now(),
                scrollTop: list.scrollTop,
                scrollHeight: list.scrollHeight,
                clientHeight: list.clientHeight,
                bottom: list.scrollHeight - list.scrollTop - list.clientHeight,
              }
            : read()),
          phase: trace.phase,
          type,
          trusted: event?.isTrusted,
          key: event instanceof KeyboardEvent ? event.key : undefined,
        });
        if (trace.events.length > 800) trace.events.shift();
      },
    };
    list.resizeFollowTrace = trace;
    list.addEventListener("scroll", (event) => trace.record("scroll", event), {
      passive: true,
    });
    // Match the published read-only observer for the fourth baseline. Avoid
    // window-resize and descendant/style reads that can flush layout before
    // the browser delivers its native scroll/ResizeObserver event sequence.
    if (!lean) {
      for (const type of [
        "pointerdown",
        "focusin",
        "keydown",
        "wheel",
        "touchmove",
      ]) {
        document.addEventListener(
          type,
          (event) => {
            if (
              event.target instanceof Element &&
              event.target.closest(".sidebar")
            )
              trace.record(type, event);
          },
          { capture: true, passive: true },
        );
      }
      window.addEventListener("resize", (event) =>
        trace.record("window-resize", event),
      );
      window.visualViewport?.addEventListener("resize", (event) =>
        trace.record("visual-viewport-resize", event),
      );
    }
    new ResizeObserver(() => trace.record("list-resize-observer")).observe(
      list,
    );
    if (!lean) {
      new MutationObserver(() => trace.record("list-children-changed")).observe(
        list,
        {
          childList: true,
        },
      );
    }
    trace.record("initial");
  }, lean);
}

async function mark(page: Page, phase: string) {
  await page.locator(LIST).evaluate((element, next) => {
    const trace = (element as MeasuredList).resizeFollowTrace;
    if (!trace) throw new Error("Resize trace is not installed");
    trace.phase = next;
    trace.record("phase");
  }, phase);
}

async function geometry(page: Page): Promise<Geometry> {
  return page.locator(LIST).evaluate((element) => {
    const trace = (element as MeasuredList).resizeFollowTrace;
    if (!trace) throw new Error("Resize trace is not installed");
    return trace.read();
  });
}

/** A stable gap is evidence; this deliberately does not wait for bottom == 0. */
async function settleGeometry(page: Page) {
  let last: Geometry | undefined;
  let stableSince = 0;
  await expect
    .poll(
      async () => {
        const current = await geometry(page);
        const unchanged =
          last &&
          Math.abs(current.scrollTop - last.scrollTop) <= 1 &&
          current.scrollHeight === last.scrollHeight &&
          current.clientHeight === last.clientHeight;
        if (!unchanged) stableSince = current.at;
        last = current;
        return current.at - stableSince;
      },
      { timeout: 5_000, intervals: [50, 100] },
    )
    .toBeGreaterThanOrEqual(350);
}

for (const layout of [
  "collapsed",
  "expanded-restored",
  "expanded-restored-story-media",
  "history-after-media",
] as const) {
  const historyAfterMedia = layout === "history-after-media";
  const hasStoryMedia =
    layout === "expanded-restored-story-media" || historyAfterMedia;
  const title =
    layout === "collapsed"
      ? "UIX-475 resize preserves follow through real resource PATCH and new rolls"
      : layout === "expanded-restored"
        ? "UIX-475 resize expanded-restored preserves follow through real resource PATCH and new rolls"
        : layout === "expanded-restored-story-media"
          ? "UIX-475 resize story-media preserves follow through real resource PATCH and new rolls"
          : "UIX-475 resize history-after-media preserves follow through real resource PATCH and new rolls";
  test(title, async ({ page, gmToken }, testInfo) => {
    test.setTimeout(90_000);
    const checkpoints: Array<{ phase: string; geometry: Geometry }> = [];
    const requests: Array<{
      phase: string;
      method: string;
      path: string;
      status: number;
    }> = [];
    const pageErrors: string[] = [];
    page.on("pageerror", (error) => pageErrors.push(error.message));

    const capture = async (phase: string, screenshot = false) => {
      const current = await geometry(page);
      checkpoints.push({ phase, geometry: current });
      if (screenshot) {
        const path = testInfo.outputPath(`${phase}.png`);
        await page.screenshot({ path });
        await testInfo.attach(phase, { path, contentType: "image/png" });
      }
      return current;
    };
    const assertFollowing = async (phase: string) => {
      await settleGeometry(page);
      const current = await capture(phase, true);
      // Soft checks preserve the first resize failure while subsequent genuine
      // PATCH/roll/recovery phases still establish whether follow was lost.
      expect
        .soft(current.bottom, `${phase}: settled bottom gap`)
        .toBeLessThanOrEqual(BOTTOM_TOLERANCE);
      expect
        .soft(current.newEvents, `${phase}: no unsolicited new-events button`)
        .toBeNull();
      return current;
    };
    const roll = async (phase: string) => {
      await mark(page, phase);
      const label = `UIX-475 ${phase} ${randomUUID()}`;
      const response = await page.request.post("/api/dice", {
        data: {
          actionId: randomUUID(),
          formula: "1d20",
          label,
          visibility: "PUBLIC",
        },
      });
      requests.push({
        phase,
        method: "POST",
        path: "/api/dice",
        status: response.status(),
      });
      await expect(response).toBeOK();
      // Server-authoritative message arrives over the real application transport;
      // this API request does not focus/click/scroll the target page.
      await expect(
        page.locator(LIST).locator("article.message").last(),
      ).toContainText(label);
      await settleGeometry(page);
    };

    try {
      await page.setViewportSize({ width: 1440, height: 900 });
      await page.goto(`/gm/${gmToken}`);
      await page.getByRole("button", { name: "Войти" }).click();
      await expect(page).toHaveURL("/");
      const bootstrap = await page.request.get("/api/bootstrap");
      await expect(bootstrap).toBeOK();
      const snapshot = (await bootstrap.json()) as GameSnapshot;
      expect(snapshot.me.role).toBe("GM");
      const character = snapshot.characters[0];
      expect(character.resources.physicalPower.current).toBe(10);
      if (historyAfterMedia) await seedStoryPortraits();
      await seedChatLog(historyAfterMedia ? 20 : 40, {
        actionId: randomUUID,
        wait: (milliseconds) => page.waitForTimeout(milliseconds),
        extendTimeout: (milliseconds) =>
          test.setTimeout(test.info().timeout + milliseconds),
        post: async (payload) => {
          const response = await page.request.post("/api/chat", {
            data: payload,
          });
          return {
            ok: response.ok(),
            status: response.status(),
            retryAfter: response.headers()["retry-after"] ?? null,
            body: response.ok() ? "" : await response.text(),
          };
        },
      });
      if (historyAfterMedia) {
        // The bootstrap is limited to20 per thread. Real TABLE +ROLLS traffic
        // therefore produces40 articles after reload, all newer than the media.
        await seedChatLog(20, {
          actionId: randomUUID,
          wait: (milliseconds) => page.waitForTimeout(milliseconds),
          extendTimeout: (milliseconds) =>
            test.setTimeout(test.info().timeout + milliseconds),
          post: async (payload) => {
            const response = await page.request.post("/api/dice", {
              data: {
                actionId: payload.actionId,
                formula: "1d20",
                label: "UIX-475 synthetic history roll",
                visibility: "PUBLIC",
              },
            });
            requests.push({
              phase: "seed-roll-history",
              method: "POST",
              path: "/api/dice",
              status: response.status(),
            });
            return {
              ok: response.ok(),
              status: response.status(),
              retryAfter: response.headers()["retry-after"] ?? null,
              body: response.ok() ? "" : await response.text(),
            };
          },
        });
      }
      async function seedStoryPortraits() {
        // Resolve the already-installed server dependency, not a new root
        // package. These flat-colour PNGs contain no external/private content.
        const requireServer = createRequire(
          new URL("../../apps/server/package.json", import.meta.url),
        );
        const sharp = requireServer("sharp") as (options: {
          create: {
            width: number;
            height: number;
            channels: 3;
            background: string;
          };
        }) => { png(): { toBuffer(): Promise<Buffer> } };
        for (const [index, background] of ["#496d8f", "#996440"].entries()) {
          const buffer = await sharp({
            create: { width: 512, height: 1536, channels: 3, background },
          })
            .png()
            .toBuffer();
          const upload = await page.request.post("/api/chat/attachments", {
            multipart: {
              file: {
                name: `uix475-synthetic-portrait-${index + 1}.png`,
                mimeType: "image/png",
                buffer,
              },
            },
          });
          requests.push({
            phase: "seed-story-media",
            method: "POST",
            path: "/api/chat/attachments",
            status: upload.status(),
          });
          expect(upload.status()).toBe(201);
          const attachment = (await upload.json()) as ChatAttachmentMetadata;
          expect(attachment.width).toBe(512);
          expect(attachment.height).toBe(1536);
          const created = await page.request.post("/api/story/posts", {
            data: {
              actionId: randomUUID(),
              title: `UIX-475 synthetic portrait ${index + 1}`,
              body: "Синтетическая иллюстрация для проверки геометрии журнала.",
              media: [
                {
                  contentId: attachment.contentId,
                  order: 0,
                  altText: `Синтетический портрет ${index + 1}`,
                  caption: "",
                },
              ],
            },
          });
          requests.push({
            phase: "seed-story-media",
            method: "POST",
            path: "/api/story/posts",
            status: created.status(),
          });
          expect(created.status()).toBe(201);
          const draft = (await created.json()) as StoryPostAdminDto;
          const publishPath = `/api/story/posts/${draft.id}/publish`;
          const published = await page.request.post(publishPath, {
            data: { actionId: randomUUID(), revision: draft.revision },
          });
          requests.push({
            phase: "seed-story-media",
            method: "POST",
            path: publishPath,
            status: published.status(),
          });
          expect(published.status()).toBe(200);
          expect(
            ((await published.json()) as StoryPostAdminDto).lifecycle,
          ).toBe("PUBLISHED");
        }
      }
      if (layout === "expanded-restored-story-media")
        await seedStoryPortraits();
      await page.reload();
      const input = page.locator(".resource-counters").getByRole("spinbutton", {
        name: "Очки: Выносливость",
      });
      await expect(input).toHaveValue("10");
      if (hasStoryMedia) {
        const images = page.locator(`${LIST} .story-post__media img`);
        await expect(images).toHaveCount(2);
        for (const image of await images.all()) {
          // Actual scrolling makes lazy media eligible for loading. No loading
          // attribute/CSS edits: decoding must use the real stored media route.
          await image.scrollIntoViewIfNeeded();
          await image.evaluate(async (element) => {
            await (element as HTMLImageElement).decode();
          });
        }
        await expect
          .poll(() =>
            images.evaluateAll((elements) =>
              elements.every(
                (element) =>
                  element instanceof HTMLImageElement &&
                  element.complete &&
                  element.naturalWidth === 512 &&
                  element.naturalHeight === 1536,
              ),
            ),
          )
          .toBe(true);
        // This explicit setup-only reader action is before the observed resize;
        // nothing touches the list between that resize and the subsequent roll.
        await page.locator(LIST).press("End");
        await expect
          .poll(() =>
            page
              .locator(LIST)
              .evaluate(
                (list) =>
                  list.scrollHeight - list.scrollTop - list.clientHeight,
              ),
          )
          .toBeLessThanOrEqual(BOTTOM_TOLERANCE);
      }
      const quickRollToggle = page.locator(".quick-roll-panel__toggle");
      await expect(quickRollToggle).toHaveAttribute("aria-expanded", "true");
      if (historyAfterMedia) {
        await expect(page.locator(`${LIST} article.message`)).toHaveCount(40);
        await expect(
          page.locator(`${LIST} article.message[data-activity-stream="TABLE"]`),
        ).toHaveCount(20);
        await expect(
          page.locator(`${LIST} article.message[data-activity-stream="ROLLS"]`),
        ).toHaveCount(20);
        expect(
          await page.locator(LIST).evaluate((list) => {
            const firstMessage = list.querySelector("article.message");
            const stories = [...list.querySelectorAll(".story-post")];
            return (
              firstMessage &&
              stories.length === 2 &&
              stories.every((story) =>
                Boolean(
                  story.compareDocumentPosition(firstMessage) &
                  Node.DOCUMENT_POSITION_FOLLOWING,
                ),
              )
            );
          }),
          "both real story posts precede the rendered message history",
        ).toBe(true);
        // Synthetic geometry calibration through the existing native resize
        // handle, not a copied preference, localStorage write or CSS injection.
        const quickRolls = page.locator(".quick-roll-panel");
        const panel = await quickRolls.boundingBox();
        const handle = await quickRolls
          .getByRole("button", {
            name: "Изменить высоту панели быстрых бросков",
          })
          .boundingBox();
        expect(panel).not.toBeNull();
        expect(handle).not.toBeNull();
        if (!panel || !handle)
          throw new Error("Quick-roll resize handle is unavailable");
        await page.mouse.move(
          handle.x + handle.width / 2,
          handle.y + handle.height / 2,
        );
        await page.mouse.down();
        await page.mouse.move(handle.x + handle.width / 2, panel.y + 204, {
          steps: 5,
        });
        await page.mouse.up();
        await expect
          .poll(async () =>
            Math.abs((await quickRolls.boundingBox())!.height - 204),
          )
          .toBeLessThanOrEqual(1);
        // Match the production setup's actual wheel-to-bottom action before
        // the observed collapse/restore, rather than changing hook internals.
        await page.locator(LIST).hover();
        await page.mouse.wheel(0, 100_000);
        await expect
          .poll(() =>
            page
              .locator(LIST)
              .evaluate(
                (list) =>
                  list.scrollHeight - list.scrollTop - list.clientHeight,
              ),
          )
          .toBeLessThanOrEqual(BOTTOM_TOLERANCE);
      }
      // Keep the first passing collapsed baseline. The expanded-restored variant
      // additionally follows the published reproduction's actual toggle/restore
      // sequence before resizing, using only this synthetic campaign's real UI.
      await observeResizeFollow(page, historyAfterMedia);
      await mark(page, "initial-expanded");
      await settleGeometry(page);
      await capture("initial-expanded");
      await mark(page, "quick-roll-collapse");
      await quickRollToggle.click();
      await expect(quickRollToggle).toHaveAttribute("aria-expanded", "false");
      await settleGeometry(page);
      await capture("quick-roll-collapsed");
      if (layout !== "collapsed") {
        await mark(page, "quick-roll-restore");
        await quickRollToggle.click();
        await expect(quickRollToggle).toHaveAttribute("aria-expanded", "true");
      }
      await mark(page, `baseline-1440x900-${layout}`);
      await settleGeometry(page);
      const before = await capture(`baseline-1440x900-${layout}`, true);
      expect(
        before.bottom,
        "setup must begin at the real bottom",
      ).toBeLessThanOrEqual(BOTTOM_TOLERANCE);
      expect(before.newEvents).toBeNull();
      expect(before.scrollHeight - before.clientHeight).toBeGreaterThan(400);
      expect(before.clientHeight).toBeGreaterThan(160 + FOLLOW_THRESHOLD);
      if (hasStoryMedia) {
        expect(before.storyImages).toHaveLength(2);
        for (const image of before.storyImages) {
          expect(image.complete).toBe(true);
          expect(image.naturalHeight).toBe(1536);
          expect(
            Math.abs(image.height - 420),
            "portrait reaches the 900px viewport's cap",
          ).toBeLessThanOrEqual(1);
        }
      }
      if (historyAfterMedia) {
        expect(before.articles).toBe(40);
        expect(Math.abs(before.quickRolls!.height - 204)).toBeLessThanOrEqual(
          1,
        );
        expect(before.quickRolls!.expanded).toBe("true");
        expect(
          Math.abs(before.clientHeight - 292),
          "calibrated list matches the measured292px start",
        ).toBeLessThanOrEqual(1);
        for (const image of before.storyImages) {
          expect(
            image.bottom,
            "decoded media is wholly above the visible history anchor",
          ).toBeLessThanOrEqual(before.list.y);
        }
      }

      await mark(page, "viewport-shrink-1440x900-to-1280x720");
      await page.setViewportSize({ width: 1280, height: 720 });
      if (historyAfterMedia) {
        // Intentional event-order observation window identical to production
        // r2: no immediate geometry/style/descendant reads after viewport change.
        // This is not a repair or a wait-until-bottom assertion; a stable gap
        // remains observable and fails the unchanged follow oracle below.
        await page.waitForTimeout(1000);
      } else {
        await capture("resize-immediate");
      }
      if (hasStoryMedia) {
        await settleGeometry(page);
        const resizedMedia = await capture(
          "story-media-resize-precondition",
          true,
        );
        expect(resizedMedia.storyImages).toHaveLength(2);
        for (const image of resizedMedia.storyImages) {
          expect(image.complete).toBe(true);
          expect(image.naturalHeight).toBe(1536);
          expect(
            Math.abs(image.height - 720 * 0.52),
            "portrait follows actual 52vh cap",
          ).toBeLessThanOrEqual(1);
        }
        expect(
          Math.abs(resizedMedia.list.width - before.list.width),
        ).toBeLessThanOrEqual(1);
        expect(
          Math.abs(
            before.scrollHeight -
              resizedMedia.scrollHeight -
              2 * (420 - 720 * 0.52),
          ),
          "two real images must shrink total content by about 91.2px before testing follow",
        ).toBeLessThanOrEqual(2);
      }
      const afterResize = await assertFollowing("resize-settled");
      if (historyAfterMedia) {
        expect(Math.abs(afterResize.clientHeight - 160)).toBeLessThanOrEqual(1);
      }
      expect(
        before.clientHeight - afterResize.clientHeight,
        "fixture must actually shrink the visible list beyond the follow threshold",
      ).toBeGreaterThan(FOLLOW_THRESHOLD);
      expect(afterResize.viewport).toEqual({ width: 1280, height: 720 });
      expect(afterResize.clientHeight).toBeGreaterThan(0);

      // No journal click, End key, reload or synthetic scroll between resize and
      // these two production operations: none may accidentally repair follow.
      await mark(page, "resource-input-enter");
      const saved = page.waitForResponse(
        (response) =>
          new URL(response.url()).pathname ===
            `/api/characters/${character.id}/counters` &&
          response.request().method() === "PATCH",
      );
      await input.click();
      await input.fill("9");
      await input.press("Enter");
      const response = await saved;
      requests.push({
        phase: "resource-input-enter",
        method: "PATCH",
        path: `/api/characters/${character.id}/counters`,
        status: response.status(),
      });
      expect(response.ok(), "real counters PATCH accepted").toBe(true);
      await expect(input).toHaveValue("9");
      await expect(input).toBeFocused();
      const persisted = await page.request.get("/api/bootstrap");
      await expect(persisted).toBeOK();
      expect(
        ((await persisted.json()) as GameSnapshot).characters.find(
          (item) => item.id === character.id,
        )?.resources.physicalPower.current,
      ).toBe(9);
      await assertFollowing("resource-patch-settled");
      await roll("first-roll-after-resize-and-patch");
      await expect(input).toBeFocused();
      const afterRoll = await assertFollowing("first-roll-settled");

      const newEvents = page.getByRole("button", { name: /Новые события/ });
      if (afterRoll.newEvents !== null) {
        // On the unmodified failing baseline, exercise the actual recovery button
        // before the manual-reader control. A fixed implementation needs no rescue.
        await mark(page, "recover-after-resize-failure");
        await newEvents.click();
        await expect
          .poll(async () => (await geometry(page)).bottom)
          .toBeLessThanOrEqual(BOTTOM_TOLERANCE);
        await assertFollowing("resize-failure-recovered");
      }

      // Negative control: genuine user reading must still disable follow. Using
      // wheel rather than assigning scrollTop proves the natural UI intent path.
      await mark(page, "manual-reader-wheel-up");
      await page.locator(LIST).hover();
      await page.mouse.wheel(0, -400);
      await expect
        .poll(async () => (await geometry(page)).bottom)
        .toBeGreaterThan(FOLLOW_THRESHOLD);
      await settleGeometry(page);
      const reading = await capture("manual-reader-before-roll");
      await roll("roll-while-reading-history");
      const readingAfterRoll = await capture("manual-reader-after-roll", true);
      expect
        .soft(
          readingAfterRoll.bottom,
          "manual reader is not dragged to the bottom",
        )
        .toBeGreaterThan(FOLLOW_THRESHOLD);
      expect
        .soft(
          Math.abs(readingAfterRoll.scrollTop - reading.scrollTop),
          "appending one roll preserves the visible historical position",
        )
        .toBeLessThanOrEqual(BOTTOM_TOLERANCE);
      await expect(newEvents).toBeVisible();

      await mark(page, "reader-return-button");
      await newEvents.click();
      await expect
        .poll(async () => (await geometry(page)).bottom)
        .toBeLessThanOrEqual(BOTTOM_TOLERANCE);
      await assertFollowing("reader-returned-to-bottom");
      await roll("roll-after-explicit-return");
      await assertFollowing("explicit-return-restored-follow");
      if (historyAfterMedia) {
        // Additional negative control after the original unchanged baseline:
        // a reader, unlike a follower, must retain native content anchoring.
        await mark(page, "reader-before-media-growth-resize");
        await page.locator(LIST).hover();
        for (let attempt = 0; attempt < 4; attempt += 1) {
          await page.mouse.wheel(0, -400);
          await settleGeometry(page);
          if ((await geometry(page)).bottom > 400) break;
        }
        const readerBeforeResize = await capture(
          "reader-before-media-growth-resize",
          true,
        );
        expect(readerBeforeResize.bottom).toBeGreaterThan(400);
        expect(readerBeforeResize.overflowAnchor).toBe("auto");
        const readerAnchorId = await page.locator(LIST).evaluate((list) => {
          const viewport = list.getBoundingClientRect();
          return [...list.querySelectorAll("article.message")]
            .map((article) => {
              const rect = article.getBoundingClientRect();
              return {
                id: article.id,
                visibleHeight: Math.max(
                  0,
                  Math.min(rect.bottom, viewport.bottom) -
                    Math.max(rect.top, viewport.top),
                ),
              };
            })
            .sort((left, right) => right.visibleHeight - left.visibleHeight)[0]
            ?.id;
        });
        expect(readerAnchorId).toBeTruthy();
        await mark(page, "reader-resize-with-media-growth");
        await page.setViewportSize({ width: 1440, height: 900 });
        await page.waitForTimeout(1000);
        await settleGeometry(page);
        const readerResized = await capture(
          "reader-media-growth-settled",
          true,
        );
        expect(readerResized.bottom).toBeGreaterThan(FOLLOW_THRESHOLD);
        expect(readerResized.overflowAnchor).toBe("auto");
        expect(readerResized.storyImages).toHaveLength(2);
        for (const image of readerResized.storyImages)
          expect(Math.abs(image.height - 420)).toBeLessThanOrEqual(1);
        expect(
          Math.abs(
            readerResized.scrollHeight - readerBeforeResize.scrollHeight - 91.2,
          ),
          "real old media grows above the reader, not only the viewport",
        ).toBeLessThanOrEqual(2);
        expect(
          await page.locator(LIST).evaluate((list, id) => {
            const anchor = document.getElementById(id!);
            if (!anchor) return false;
            const viewport = list.getBoundingClientRect();
            const rect = anchor.getBoundingClientRect();
            return rect.bottom > viewport.top && rect.top < viewport.bottom;
          }, readerAnchorId),
          "the same historical article remains in view",
        ).toBe(true);
        await roll("roll-after-reader-media-resize");
        const readerAfterRoll = await capture(
          "reader-media-resize-after-roll",
          true,
        );
        expect(readerAfterRoll.bottom).toBeGreaterThan(FOLLOW_THRESHOLD);
        expect(
          Math.abs(readerAfterRoll.scrollTop - readerResized.scrollTop),
        ).toBeLessThanOrEqual(BOTTOM_TOLERANCE);
        await expect(newEvents).toBeVisible();
        await newEvents.click();
        await expect
          .poll(async () => (await geometry(page)).bottom)
          .toBeLessThanOrEqual(BOTTOM_TOLERANCE);
        await assertFollowing("reader-media-resize-explicit-return");
      }
      await expect(page.locator("vite-error-overlay")).toHaveCount(0);
      expect(pageErrors).toEqual([]);
    } finally {
      const trace = await page.locator(LIST).evaluateAll((elements) => {
        const current = (elements[0] as MeasuredList | undefined)
          ?.resizeFollowTrace;
        return current
          ? { final: current.read(), events: current.events }
          : null;
      });
      const path = testInfo.outputPath("resize-follow-receipts.json");
      await writeFile(
        path,
        JSON.stringify(
          {
            scenario: `GM; real seeded campaign; quick rolls ${layout} via UI; 1440x900 -> 1280x720`,
            checkpoints,
            requests,
            pageErrors,
            trace,
          },
          null,
          2,
        ),
      );
      await testInfo.attach("resize-follow-receipts", {
        path,
        contentType: "application/json",
      });
    }
  });
}

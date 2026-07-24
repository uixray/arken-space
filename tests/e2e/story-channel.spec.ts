import { expect, test, type Page } from "@playwright/test";
import type { GameSnapshot, StoryPostAdminDto, StoryPostDto } from "@arken/contracts";

const ids = {
  campaign: "11111111-1111-4111-8111-111111111111",
  gm: "22222222-2222-4222-8222-222222222222",
  player: "33333333-3333-4333-8333-333333333333",
  tableThread: "44444444-4444-4444-8444-444444444444",
  storyThread: "55555555-5555-4555-8555-555555555555",
  rollsThread: "66666666-6666-4666-8666-666666666666",
  post: "77777777-7777-4777-8777-777777777777",
};

const now = "2026-07-24T12:00:00.000Z";

function snapshotFor(role: "GM" | "PLAYER"): GameSnapshot {
  const membershipId = role === "GM" ? ids.gm : ids.player;
  return {
    campaign: { id: ids.campaign, name: "Story QA", day: 1, battleActive: false, battleCounter: 0, revision: 0 },
    me: { id: membershipId, role, displayName: role === "GM" ? "Master" : "Player", characterId: null },
    members: [{ id: ids.gm, role: "GM", displayName: "Master", characterId: null }, { id: ids.player, role: "PLAYER", displayName: "Player", characterId: null }],
    characters: [], catalogEntries: [], scenes: [], tokens: [], tokenDefinitions: [], fogReveals: [], messages: [],
    chatThreads: [
      { id: ids.tableThread, campaignId: ids.campaign, type: "STREAM", stream: "TABLE", createdAt: now, updatedAt: now },
      { id: ids.storyThread, campaignId: ids.campaign, type: "STREAM", stream: "STORY", createdAt: now, updatedAt: now },
      { id: ids.rollsThread, campaignId: ids.campaign, type: "STREAM", stream: "ROLLS", createdAt: now, updatedAt: now },
    ],
    chatThreadStates: [
      { threadId: ids.tableThread, stream: "TABLE", lastReadSequence: 0, latestSequence: 0, unreadCount: 0 },
      { threadId: ids.storyThread, stream: "STORY", lastReadSequence: 0, latestSequence: 0, unreadCount: 0 },
      { threadId: ids.rollsThread, stream: "ROLLS", lastReadSequence: 0, latestSequence: 0, unreadCount: 0 },
    ],
    assets: [],
    audio: { assetId: null, playing: false, positionSeconds: 0, loop: false, startedAt: null, revision: 0, updatedAt: now },
    snapshotVersion: 1, schemaVersion: 2, buildVersion: "test", buildRevision: "test", serverTime: now,
  };
}

function adminPost(lifecycle: StoryPostAdminDto["lifecycle"], body: string, revision = 1): StoryPostAdminDto {
  return {
    id: ids.post, threadId: ids.storyThread, authorMembershipId: ids.gm,
    title: "Arrival at Ravenford", body, lifecycle, revision, entityLinks: [], media: [],
    publishedAt: lifecycle === "DRAFT" ? null : now,
    correctedAt: lifecycle === "CORRECTED" ? now : null,
    createdAt: now, updatedAt: now,
    archivedAt: lifecycle === "ARCHIVED" ? now : null,
    gmNotes: "GM-only preparation note",
  };
}

function safePost(post: StoryPostAdminDto): StoryPostDto {
  const { gmNotes: _gmNotes, archivedAt: _archivedAt, importProvenance: _provenance, ...safe } = post;
  return safe as StoryPostDto;
}

async function mockApp(page: Page, getSnapshot: () => GameSnapshot, getPosts: () => Array<StoryPostDto | StoryPostAdminDto>) {
  await page.route("**/api/bootstrap", (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(getSnapshot()) }));
  await page.route("**/api/player-access", (route) => route.fulfill({ status: 200, contentType: "application/json", body: "[]" }));
  await page.route("**/api/story/posts?*", (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ posts: getPosts(), nextCursor: null }) }));
}

async function openStory(page: Page) {
  await page.locator("#chat-tab-story").click();
  await expect(page.locator(".story-channel")).toBeVisible();
}

test("GM drafts, publishes, corrects and archives a story post through refreshed channel data", async ({ page }) => {
  await page.setViewportSize({ width: 960, height: 900 });
  let posts: StoryPostAdminDto[] = [];
  let refreshes = 0;
  await mockApp(page, () => snapshotFor("GM"), () => {
    refreshes += 1;
    return posts;
  });

  await page.route("**/api/story/posts", async (route) => {
    expect(route.request().method()).toBe("POST");
    expect(route.request().postDataJSON()).toMatchObject({ title: "Arrival at Ravenford", body: "The gates open\nfor the party.", gmNotes: "GM-only preparation note" });
    posts = [adminPost("DRAFT", "The gates open\nfor the party.")];
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(posts[0]) });
  });
  await page.route(`**/api/story/posts/${ids.post}/publish`, async (route) => {
    expect(route.request().method()).toBe("POST");
    expect(route.request().postDataJSON()).toMatchObject({ revision: 1 });
    posts = [adminPost("PUBLISHED", posts[0].body, 2)];
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(posts[0]) });
  });
  await page.route(`**/api/story/posts/${ids.post}`, async (route) => {
    expect(route.request().method()).toBe("PATCH");
    expect(route.request().postDataJSON()).toMatchObject({ revision: 2, body: "The gates open for the whole party." });
    posts = [adminPost("CORRECTED", "The gates open for the whole party.", 3)];
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(posts[0]) });
  });
  await page.route(`**/api/story/posts/${ids.post}/archive`, async (route) => {
    expect(route.request().method()).toBe("POST");
    expect(route.request().postDataJSON()).toMatchObject({ revision: 3 });
    posts = [adminPost("ARCHIVED", posts[0].body, 4)];
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(posts[0]) });
  });

  await page.goto("/");
  await openStory(page);
  const title = page.locator(".story-composer input").first();
  await title.focus();
  await page.keyboard.press("Tab");
  await expect(page.locator(".story-composer textarea").first()).toBeFocused();
  await title.fill("Arrival at Ravenford");
  const body = page.locator(".story-composer textarea").first();
  await body.fill("The gates open");
  await page.keyboard.press("Shift+Enter");
  await page.keyboard.type("for the party.");
  await expect(body).toHaveValue("The gates open\nfor the party.");
  await page.locator(".story-composer__gm-notes textarea").fill("GM-only preparation note");
  await body.focus();
  await page.keyboard.press("Enter");

  const post = page.locator(".story-post").filter({ hasText: "Arrival at Ravenford" });
  await expect(post).toHaveAttribute("data-story-lifecycle", "DRAFT");
  await expect.poll(() => refreshes).toBeGreaterThan(1);
  expect(await page.locator(".story-channel").evaluate((node) => node.scrollWidth <= node.clientWidth)).toBe(true);

  await post.locator(".story-post__actions button").first().click();
  await expect(post).toHaveAttribute("data-story-lifecycle", "PUBLISHED");
  await post.locator(".story-post__actions button").first().click();
  const correction = post.locator(".story-post__edit textarea");
  await correction.fill("The gates open for the whole party.");
  await post.locator(".story-post__actions button").first().click();
  await expect(post).toHaveAttribute("data-story-lifecycle", "CORRECTED");
  await expect(post).toContainText("The gates open for the whole party.");
  await post.locator(".story-post__actions button").last().click();
  await expect(post).toHaveAttribute("data-story-lifecycle", "ARCHIVED");
});

test("player sees only safe published story cards in a read-only channel", async ({ page }) => {
  const published = adminPost("PUBLISHED", "A public chronicle entry.", 2);
  await mockApp(page, () => snapshotFor("PLAYER"), () => [safePost(published)]);

  await page.goto("/");
  await openStory(page);
  await expect(page.locator(".story-post")).toHaveCount(1);
  await expect(page.locator(".story-post")).toContainText("A public chronicle entry.");
  await expect(page.getByText("GM-only preparation note")).toHaveCount(0);
  await expect(page.locator(".story-channel__read-only")).toBeVisible();
  await expect(page.locator(".story-composer")).toHaveCount(0);
  await expect(page.locator(".story-post__actions")).toHaveCount(0);
});




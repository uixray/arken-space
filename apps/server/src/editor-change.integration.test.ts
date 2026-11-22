import Fastify from "fastify";
import cookie from "@fastify/cookie";
import { randomBytes } from "node:crypto";
import { drizzle } from "drizzle-orm/pglite";
import { and, eq } from "drizzle-orm";
import { expect, it, vi } from "vitest";
import * as schema from "@arken/db";
import { createMigratedPglite } from "../../../tests/helpers/pglite-template.js";
import { registerBrowserEditor } from "./editor-change-browser.js";
import { env } from "./env.js";
import { hashToken } from "./security.js";

it("confirms and restores three real domain records in a migrated test database", async () => {
  const pg = await createMigratedPglite();
  const db = drizzle(pg, { schema });
  const app = Fastify();
  const campaignId = crypto.randomUUID();
  const userId = crypto.randomUUID();
  const accountSessionId = crypto.randomUUID();
  const mcpToken = randomBytes(32).toString("base64url");
  const sessionToken = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + 120_000);
  const actor = {
    campaignId,
    membershipId: crypto.randomUUID(),
    displayName: "Amberion",
    role: "GM" as const,
  };
  const characterId = crypto.randomUUID(),
    skillId = crypto.randomUUID(),
    postId = crypto.randomUUID();
  const mcp = { authorization: `Bearer ${mcpToken}` };
  const browser = {
    cookie: `${env.SESSION_COOKIE_NAME}=${sessionToken}`,
    origin: new URL(env.WEB_ORIGIN).origin,
    "x-arken-campaign-id": campaignId,
  };
  vi.stubEnv("ARKEN_EDITOR_PILOT_CAMPAIGN_ID", campaignId);
  vi.stubEnv("ARKEN_EDITOR_PILOT_MEMBERSHIP_ID", actor.membershipId);
  vi.stubEnv("ARKEN_EDITOR_PILOT_TOKEN_HASH", hashToken(mcpToken));
  try {
    await app.register(cookie);
    await db
      .insert(schema.campaigns)
      .values({ id: campaignId, name: "Бал Амбериона · тест" });
    await db.insert(schema.users).values({
      id: userId,
      identityKind: "HOSTED",
      hostedLogin: "amberion",
      hostedApprovedAt: new Date(),
      passwordHash: "unused-test-hash",
    });
    await db
      .insert(schema.memberships)
      .values({ id: actor.membershipId, ...actor, userId });
    await db.insert(schema.accountSessions).values({
      id: accountSessionId,
      userId,
      tokenHash: hashToken("test-account-session"),
      csrfHash: hashToken("test-account-csrf"),
      expiresAt,
    });
    await db.insert(schema.sessions).values({
      membershipId: actor.membershipId,
      tokenHash: hashToken(sessionToken),
      expiresAt,
      authSource: "ACCOUNT",
      accountSessionId,
    });
    await db.insert(schema.characters).values({
      id: characterId,
      campaignId,
      name: "Мира",
      stats: { strength: 3 },
    });
    await db.insert(schema.catalogEntries).values({
      id: skillId,
      campaignId,
      kind: "SKILL",
      name: "Шаг",
      description: "Исходное описание",
    });
    const [thread] = await db
      .select({ id: schema.chatThreads.id })
      .from(schema.chatThreads)
      .where(
        and(
          eq(schema.chatThreads.campaignId, campaignId),
          eq(schema.chatThreads.stream, "STORY"),
        ),
      );
    await db.insert(schema.storyPosts).values({
      id: postId,
      campaignId,
      threadId: thread!.id,
      authorMembershipId: actor.membershipId,
      title: "Ворота",
      body: "Исходный текст",
    });
    // Only adapt the driver's result shape. Authorization and handlers are production code.
    type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
    const wrap = <T extends typeof db | Tx>(handle: T) => ({
      select: handle.select.bind(handle),
      execute: async (query: Parameters<T["execute"]>[0]) =>
        (await handle.execute(query)).rows,
      update: handle.update.bind(handle),
      insert: handle.insert.bind(handle),
    });
    registerBrowserEditor(app, {
      ...wrap(db),
      transaction: <T>(run: (tx: ReturnType<typeof wrap<Tx>>) => Promise<T>) =>
        db.transaction((tx) => run(wrap(tx))),
    } as never);
    const rejected = await app.inject({
      url: "/api/editor/search?kind=skill&q=Шаг",
      headers: {
        authorization: `Bearer ${randomBytes(32).toString("base64url")}`,
      },
    });
    expect(rejected.statusCode).toBe(403);
    const search = await app.inject({
      url: "/api/editor/search?kind=skill&q=Шаг",
      headers: mcp,
    });
    expect(search.json()).toEqual([{ id: skillId, name: "Шаг", revision: 0 }]);
    await db
      .update(schema.users)
      .set({ disabledAt: new Date() })
      .where(eq(schema.users.id, userId));
    expect(
      (
        await app.inject({
          url: "/api/editor/search?kind=skill&q=Шаг",
          headers: mcp,
        })
      ).statusCode,
    ).toBe(403);
    await db
      .update(schema.users)
      .set({ disabledAt: null })
      .where(eq(schema.users.id, userId));
    for (const [kind, id, field, before, after] of [
      ["character-stat", characterId, "strength", 3, 4],
      ["skill", skillId, "description", "Исходное описание", "Новое описание"],
      ["material", postId, "body", "Исходный текст", "Новый текст"],
    ] as const) {
      const target = { kind, id };
      const preview = await app.inject({
        method: "POST",
        url: "/api/editor/changes",
        headers: mcp,
        payload: { target, revision: 0, values: { [field]: after } },
      });
      expect(preview.statusCode, preview.body).toBe(200);
      expect(preview.json().before[field]).toBe(before);
      const approval = new URL(preview.json().approvalUrl);
      expect(approval.origin).toBe(new URL(env.PUBLIC_URL).origin);
      expect(approval.pathname).toBe(`/campaign/${campaignId}`);
      expect(approval.searchParams.get("editor-pilot")).toBe(preview.json().id);
      const first = preview.json().id as string;
      const confirm = (draftId: string, human: boolean) =>
        app.inject({
          method: "POST",
          url: `/api/editor/changes/${draftId}/confirm`,
          headers: {
            ...browser,
            "x-arken-editor-confirm": "explicit",
            ...(human ? {} : mcp),
          },
        });
      expect((await confirm(first, false)).statusCode).toBe(403);
      const confirmUrl = `/api/editor/changes/${first}/confirm`;
      expect(
        (
          await app.inject({
            method: "POST",
            url: confirmUrl,
            headers: browser,
          })
        ).statusCode,
      ).toBe(403);
      expect(
        (
          await app.inject({
            method: "POST",
            url: confirmUrl,
            headers: {
              ...browser,
              origin: "https://cross-origin.invalid",
              "x-arken-editor-confirm": "explicit",
            },
          })
        ).statusCode,
      ).toBe(403);
      const inspect = await app.inject({
        url: `/api/editor/changes/${first}`,
        headers: browser,
      });
      expect(inspect.statusCode).toBe(200);
      expect(inspect.json().before[field]).toBe(before);
      const read = () =>
        app.inject({
          url: `/api/editor/target?kind=${kind}&id=${id}`,
          headers: mcp,
        });
      expect((await read()).json().values[field]).toBe(before);
      const saved = await confirm(first, true);
      expect(saved.statusCode, saved.body).toBe(200);
      expect(saved.json().committedRevision).toBe(1);
      expect((await read()).json().values[field]).toBe(after);
      const restore = await app.inject({
        method: "POST",
        url: `/api/editor/changes/${first}/restore-preview`,
        headers: mcp,
      });
      expect(restore.statusCode, restore.body).toBe(200);
      expect(restore.json().after[field]).toBe(before);
      const restored = await confirm(restore.json().id, true);
      expect(restored.statusCode, restored.body).toBe(200);
      expect(restored.json().committedRevision).toBe(2);
      expect((await read()).json().values[field]).toBe(before);
      const history = await app.inject({
        url: `/api/editor/history?kind=${kind}&id=${id}`,
        headers: mcp,
      });
      expect(
        history
          .json()
          .map(
            (entry: { committedRevision: number }) => entry.committedRevision,
          ),
      ).toEqual([2, 1]);
    }
    await db
      .update(schema.memberships)
      .set({ accessRevokedAt: new Date() })
      .where(eq(schema.memberships.id, actor.membershipId));
    const revoked = await app.inject({
      url: "/api/editor/search?kind=skill&q=Шаг",
      headers: mcp,
    });
    expect(revoked.statusCode).toBe(403);
  } finally {
    vi.unstubAllEnvs();
    await app.close();
    await pg.close();
  }
}, 120_000);

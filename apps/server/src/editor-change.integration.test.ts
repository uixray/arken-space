import Fastify from "fastify";
import { drizzle } from "drizzle-orm/pglite";
import { and, eq } from "drizzle-orm";
import { expect, it } from "vitest";
import * as schema from "@arken/db";
import { createMigratedPglite } from "../../../tests/helpers/pglite-template.js";
import {
  postgresEditorTransaction,
  listEditorHistory,
} from "./editor-change-postgres.js";
import { registerEditorChangeRoutes } from "./editor-change-routes.js";
import { editorTargets, validEditorPatch } from "./editor-change-targets.js";

it("confirms and restores three real domain records in a migrated test database", async () => {
  const pg = await createMigratedPglite();
  const db = drizzle(pg, { schema });
  const app = Fastify();
  const campaignId = crypto.randomUUID();
  const actor = {
    campaignId,
    membershipId: crypto.randomUUID(),
    displayName: "Amberion",
    role: "GM" as const,
  };
  const characterId = crypto.randomUUID(),
    skillId = crypto.randomUUID(),
    postId = crypto.randomUUID();
  try {
    await db
      .insert(schema.campaigns)
      .values({ id: campaignId, name: "Бал Амбериона · тест" });
    await db
      .insert(schema.memberships)
      .values({ id: actor.membershipId, ...actor });
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
    registerEditorChangeRoutes(app, {
      approvalOrigin: "https://example.test",
      search: async () => [],
      authorize: async (request, capability) =>
        capability === "prepare" || request.headers["x-test-human"] === "yes"
          ? actor
          : null,
      transaction: (member, run) =>
        db.transaction(async (tx) => {
          // PGlite returns QueryResult; production Drizzle postgres-js returns rows.
          const adapter = {
            execute: async (query: Parameters<typeof tx.execute>[0]) =>
              (await tx.execute(query)).rows,
          };
          return run(
            postgresEditorTransaction(
              adapter as never,
              editorTargets(tx as never, member),
            ),
          );
        }),
      validate: validEditorPatch,
      history: (member, target) =>
        listEditorHistory(
          {
            execute: async (query: Parameters<typeof db.execute>[0]) =>
              (await db.execute(query)).rows,
          } as never,
          member.campaignId,
          target,
        ),
    });
    for (const [kind, id, field, before, after] of [
      ["character-stat", characterId, "strength", 3, 4],
      ["skill", skillId, "description", "Исходное описание", "Новое описание"],
      ["material", postId, "body", "Исходный текст", "Новый текст"],
    ] as const) {
      const target = { kind, id };
      const preview = await app.inject({
        method: "POST",
        url: "/api/editor/changes",
        payload: { target, revision: 0, values: { [field]: after } },
      });
      expect(preview.statusCode, preview.body).toBe(200);
      expect(preview.json().before[field]).toBe(before);
      expect(preview.json().approvalUrl).toMatch(
        /^https:\/\/example\.test\/\?editor-pilot=/,
      );
      const first = preview.json().id as string;
      const confirm = (draftId: string, human: boolean) =>
        app.inject({
          method: "POST",
          url: `/api/editor/changes/${draftId}/confirm`,
          headers: human ? { "x-test-human": "yes" } : {},
        });
      expect((await confirm(first, false)).statusCode).toBe(403);
      const read = () => app.inject(`/api/editor/target?kind=${kind}&id=${id}`);
      expect((await read()).json().values[field]).toBe(before);
      const saved = await confirm(first, true);
      expect(saved.statusCode, saved.body).toBe(200);
      expect(saved.json().committedRevision).toBe(1);
      expect((await read()).json().values[field]).toBe(after);
      const restore = await app.inject({
        method: "POST",
        url: `/api/editor/changes/${first}/restore-preview`,
      });
      expect(restore.statusCode, restore.body).toBe(200);
      expect(restore.json().after[field]).toBe(before);
      const restored = await confirm(restore.json().id, true);
      expect(restored.statusCode, restored.body).toBe(200);
      expect(restored.json().committedRevision).toBe(2);
      expect((await read()).json().values[field]).toBe(before);
      const history = await app.inject(
        `/api/editor/history?kind=${kind}&id=${id}`,
      );
      expect(
        history
          .json()
          .map(
            (entry: { committedRevision: number }) => entry.committedRevision,
          ),
      ).toEqual([2, 1]);
    }
  } finally {
    await app.close();
    await pg.close();
  }
}, 120_000);

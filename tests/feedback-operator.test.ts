import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import Fastify, { type FastifyInstance } from "fastify";
import cookie from "@fastify/cookie";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import * as schema from "../packages/db/src/schema.js";
import {
  operatorFeedbackRateLimit,
  registerOperatorFeedbackRoutes,
} from "../apps/server/src/operator-feedback.js";
import { env } from "../apps/server/src/env.js";
import { hashToken } from "../apps/server/src/security.js";

let database: PGlite;
let app: FastifyInstance;
let mediaRoot: string;
const campaignId = crypto.randomUUID();
const operatorId = crypto.randomUUID();
const gmId = crypto.randomUUID();
const playerId = crypto.randomUUID();
const tokens = {
  operator: "o".repeat(40),
  gm: "g".repeat(40),
  player: "p".repeat(40),
};
const auth = (token: string) => ({
  cookie: `${env.SESSION_COOKIE_NAME}=${token}`,
});

beforeEach(async () => {
  database = new PGlite();
  for (const file of (
    await readdir(new URL("../packages/db/drizzle/", import.meta.url))
  )
    .filter((name) => name.endsWith(".sql"))
    .sort())
    await database.exec(
      (
        await readFile(
          new URL(`../packages/db/drizzle/${file}`, import.meta.url),
          "utf8",
        )
      ).replaceAll("--> statement-breakpoint", ""),
    );
  const db = drizzle(database, { schema });
  await db
    .insert(schema.campaigns)
    .values({ id: campaignId, name: "Operator test" });
  await db.insert(schema.memberships).values([
    { id: operatorId, campaignId, role: "PLAYER", displayName: "Operator" },
    { id: gmId, campaignId, role: "GM", displayName: "GM" },
    { id: playerId, campaignId, role: "PLAYER", displayName: "Player" },
  ]);
  await db.insert(schema.sessions).values(
    Object.entries(tokens).map(([name, token]) => ({
      membershipId:
        name === "operator" ? operatorId : name === "gm" ? gmId : playerId,
      tokenHash: hashToken(token),
      expiresAt: new Date(Date.now() + 60_000),
    })),
  );
  env.OPERATOR_MEMBERSHIP_IDS = operatorId;
  env.OPERATOR_FEEDBACK_RATE_LIMIT_MAX = 20;
  mediaRoot = await mkdtemp(join(tmpdir(), "arken-operator-feedback-"));
  env.MEDIA_ROOT = mediaRoot;
  app = Fastify();
  await app.register(cookie);
  registerOperatorFeedbackRoutes(app, db as never);
  await app.ready();
});

afterEach(async () => {
  await app.close();
  await database.close();
  await rm(mediaRoot, { recursive: true, force: true });
});

async function report(
  values: Partial<typeof schema.feedbackReports.$inferInsert> = {},
) {
  const db = drizzle(database, { schema });
  const [row] = await db
    .insert(schema.feedbackReports)
    .values({
      kind: "BUG",
      title: "Private title",
      description: "Private description",
      contact: "secret@example.test",
      diagnostics: { logs: "secret" },
      buildVersion: "1.2.3",
      buildRevision: "abc",
      requestId: "secret-request",
      campaignId,
      actorMembershipId: playerId,
      ...values,
    })
    .returning();
  return row!;
}

describe("operator feedback boundary", () => {
  it("denies anonymous, ordinary GM and player while allowing the dedicated operator", async () => {
    await report();
    for (const headers of [undefined, auth(tokens.gm), auth(tokens.player)]) {
      const response = await app.inject({
        method: "GET",
        url: "/api/operator/feedback",
        headers,
      });
      expect(response.statusCode).toBe(headers ? 403 : 401);
    }
    expect(
      (
        await app.inject({
          method: "GET",
          url: "/api/operator/feedback",
          headers: auth(tokens.operator),
        })
      ).statusCode,
    ).toBe(200);
  });

  it("uses a safe list projection, bounded filters and cursor pagination", async () => {
    await report({
      kind: "IDEA",
      buildVersion: "wanted",
      createdAt: new Date("2026-01-01"),
    });
    await report({
      kind: "BUG",
      buildVersion: "wanted",
      createdAt: new Date("2026-01-02"),
    });
    await report({
      kind: "BUG",
      buildVersion: "other",
      createdAt: new Date("2026-01-03"),
    });
    const first = await app.inject({
      method: "GET",
      url: "/api/operator/feedback?build=wanted&limit=1",
      headers: auth(tokens.operator),
    });
    expect(first.statusCode).toBe(200);
    const page = first.json();
    expect(page.items).toHaveLength(1);
    expect(page.nextCursor).toBeTypeOf("string");
    expect(page.items[0]).not.toHaveProperty("title");
    for (const forbidden of [
      "description",
      "contact",
      "diagnostics",
      "actorMembershipId",
      "campaignId",
      "requestId",
      "storageKey",
    ])
      expect(JSON.stringify(page.items)).not.toContain(forbidden);
    const second = await app.inject({
      method: "GET",
      url: `/api/operator/feedback?build=wanted&limit=1&cursor=${encodeURIComponent(page.nextCursor)}`,
      headers: auth(tokens.operator),
    });
    expect(second.json().items).toHaveLength(1);
    expect(
      (
        await app.inject({
          method: "GET",
          url: "/api/operator/feedback?limit=51",
          headers: auth(tokens.operator),
        })
      ).statusCode,
    ).toBe(400);
  });

  it("reveals sensitive fields only explicitly and records privacy-safe audits", async () => {
    const row = await report();
    const normal = await app.inject({
      method: "GET",
      url: `/api/operator/feedback/${row.id}`,
      headers: auth(tokens.operator),
    });
    expect(normal.json()).not.toHaveProperty("contact");
    expect(normal.json()).not.toHaveProperty("diagnostics");
    const explicitFalse = await app.inject({
      method: "GET",
      url: `/api/operator/feedback/${row.id}?reveal=false`,
      headers: auth(tokens.operator),
    });
    expect(explicitFalse.json()).not.toHaveProperty("contact");
    expect(explicitFalse.json()).not.toHaveProperty("diagnostics");
    const revealed = await app.inject({
      method: "GET",
      url: `/api/operator/feedback/${row.id}?reveal=true`,
      headers: auth(tokens.operator),
    });
    expect(revealed.json()).toMatchObject({
      contact: "secret@example.test",
      diagnostics: { logs: "secret" },
    });
    const audits = await database.query<{ action: string; columns: string[] }>(
      "select action from feedback_operator_audits order by created_at",
    );
    expect(audits.rows.map((item) => item.action)).toEqual([
      "DETAIL_VIEW",
      "DETAIL_VIEW",
      "DETAIL_REVEAL",
    ]);
    const raw = JSON.stringify(audits.rows);
    expect(raw).not.toContain("secret@example.test");
    expect(raw).not.toContain("Private description");
  });

  it("serves attachment bytes by id without exposing storage keys", async () => {
    const row = await report();
    const storageKey = "operator-test.webp";
    const bytes = Buffer.from("private image bytes");
    await writeFile(join(mediaRoot, storageKey), bytes);
    const db = drizzle(database, { schema });
    const [attachment] = await db
      .insert(schema.feedbackAttachments)
      .values({
        reportId: row.id,
        kind: "SCREENSHOT",
        storageKey,
        mimeType: "image/webp",
        sizeBytes: bytes.length,
        width: 1,
        height: 1,
      })
      .returning();
    const detail = await app.inject({
      method: "GET",
      url: `/api/operator/feedback/${row.id}`,
      headers: auth(tokens.operator),
    });
    expect(detail.body).not.toContain(storageKey);
    const response = await app.inject({
      method: "GET",
      url: `/api/operator/feedback/${row.id}/attachments/${attachment!.id}`,
      headers: auth(tokens.operator),
    });
    expect(response.statusCode).toBe(200);
    expect(response.rawPayload).toEqual(bytes);
    expect(response.headers["x-content-type-options"]).toBe("nosniff");
    expect(response.headers["content-disposition"]).toContain("inline");
    await db
      .update(schema.feedbackAttachments)
      .set({ mimeType: "image/svg+xml" })
      .where(eq(schema.feedbackAttachments.id, attachment!.id));
    expect(
      (
        await app.inject({
          method: "GET",
          url: `/api/operator/feedback/${row.id}/attachments/${attachment!.id}`,
          headers: auth(tokens.operator),
        })
      ).statusCode,
    ).toBe(415);
  });

  it("enforces transitions and strict Linear links, and exports a redacted copy", async () => {
    const row = await report({
      title: "Bearer top-secret-token",
      description: [
        "cookie=session-secret",
        "private chat: hidden words",
        "internal C:\\Users\\Admin\\secret.txt",
        "http://10.0.0.8:4100/admin",
        "Safe reproduction step",
      ].join("\n"),
    });
    const invalid = await app.inject({
      method: "PATCH",
      url: `/api/operator/feedback/${row.id}`,
      headers: auth(tokens.operator),
      payload: {
        status: "LINKED",
        linearKey: "UIX-318",
        linearUrl: "https://evil.test/UIX-318",
      },
    });
    expect(invalid.statusCode).toBe(400);
    const substringOnly = await app.inject({
      method: "PATCH",
      url: `/api/operator/feedback/${row.id}`,
      headers: auth(tokens.operator),
      payload: {
        status: "LINKED",
        linearKey: "UIX-318",
        linearUrl: "https://linear.app/uixray/issue/UIX-999/UIX-318",
      },
    });
    expect(substringOnly.statusCode).toBe(400);
    const direct = await app.inject({
      method: "PATCH",
      url: `/api/operator/feedback/${row.id}`,
      headers: auth(tokens.operator),
      payload: {
        status: "LINKED",
        linearKey: "UIX-318",
        linearUrl: "https://linear.app/uixray/issue/UIX-318/test",
      },
    });
    expect(direct.statusCode).toBe(409);
    expect(
      (
        await app.inject({
          method: "PATCH",
          url: `/api/operator/feedback/${row.id}`,
          headers: auth(tokens.operator),
          payload: { status: "ACKNOWLEDGED" },
        })
      ).statusCode,
    ).toBe(200);
    expect(
      (
        await app.inject({
          method: "PATCH",
          url: `/api/operator/feedback/${row.id}`,
          headers: auth(tokens.operator),
          payload: {
            status: "LINKED",
            linearKey: "UIX-318",
            linearUrl: "https://linear.app/uixray/issue/UIX-318/operator-inbox",
          },
        })
      ).statusCode,
    ).toBe(200);
    const exported = await app.inject({
      method: "GET",
      url: `/api/operator/feedback/${row.id}/export`,
      headers: auth(tokens.operator),
    });
    for (const forbidden of [
      "contact",
      "diagnostics",
      "actorMembershipId",
      "campaignId",
      "requestId",
      "storageKey",
    ])
      expect(exported.body).not.toContain(forbidden);
    for (const secret of [
      "top-secret-token",
      "session-secret",
      "hidden words",
      "Users",
      "10.0.0.8",
    ])
      expect(exported.body).not.toContain(secret);
    expect(exported.body).toContain("[REDACTED]");
    expect(exported.body).toContain("Safe reproduction step");
  });

  it("applies a dedicated operator rate limit", () => {
    env.OPERATOR_FEEDBACK_RATE_LIMIT_MAX = 7;
    expect(operatorFeedbackRateLimit()).toEqual({
      config: { rateLimit: { max: 7, timeWindow: "1 minute" } },
    });
  });
});

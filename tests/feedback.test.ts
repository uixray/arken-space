import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Fastify, { type FastifyInstance } from "fastify";
import cookie from "@fastify/cookie";
import multipart from "@fastify/multipart";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { beforeEach, afterEach, describe, expect, it } from "vitest";
import * as schema from "../packages/db/src/schema.js";
import { registerRoutes } from "../apps/server/src/routes.js";
import { env } from "../apps/server/src/env.js";
import { hashToken } from "../apps/server/src/security.js";
import {
  parseFeedbackDiagnostics,
  publicSuggestionSchema,
  sanitizeFeedbackDiagnostics,
} from "../apps/server/src/feedback.js";

let database: PGlite;
let app: FastifyInstance;
let mediaRoot: string;
const campaignId = crypto.randomUUID();
const membershipId = crypto.randomUUID();
const sessionToken = "r".repeat(40);

function multipartBody(
  fields: Record<string, string>,
  files: Array<{
    field: string;
    filename: string;
    mime: string;
    content: Buffer;
  }> = [],
) {
  const boundary = `arken-${crypto.randomUUID()}`;
  const chunks = Object.entries(fields).map(([name, value]) =>
    Buffer.from(
      `--${boundary}\r\nContent-Disposition: form-data; name="${name}"\r\n\r\n${value}\r\n`,
    ),
  );
  for (const file of files)
    chunks.push(
      Buffer.from(
        `--${boundary}\r\nContent-Disposition: form-data; name="${file.field}"; filename="${file.filename}"\r\nContent-Type: ${file.mime}\r\n\r\n`,
      ),
      file.content,
      Buffer.from("\r\n"),
    );
  chunks.push(Buffer.from(`--${boundary}--\r\n`));
  const body = Buffer.concat(chunks);
  return { boundary, body };
}

beforeEach(async () => {
  mediaRoot = await mkdtemp(join(tmpdir(), "arken-feedback-"));
  env.MEDIA_ROOT = mediaRoot;
  env.MIN_FREE_DISK_BYTES = 1;
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
  await db.insert(schema.campaigns).values({ id: campaignId, name: "Demo" });
  await db.insert(schema.memberships).values({
    id: membershipId,
    campaignId,
    role: "PLAYER",
    displayName: "Tester",
  });
  await db.insert(schema.sessions).values({
    membershipId,
    tokenHash: hashToken(sessionToken),
    expiresAt: new Date(Date.now() + 60_000),
  });
  app = Fastify();
  await app.register(cookie);
  await app.register(multipart, { limits: { files: 2 } });
  registerRoutes(
    app,
    db as never,
    {
      in: () => ({ fetchSockets: async () => [] }),
      to: () => ({ emit() {} }),
    } as never,
  );
  await app.ready();
});

afterEach(async () => {
  await app.close();
  await database.close();
  await rm(mediaRoot, { recursive: true, force: true });
});

describe("feedback intake", () => {
  it("persists a public suggestion but silently drops honeypot submissions", async () => {
    const accepted = await app.inject({
      method: "POST",
      url: "/api/feedback/suggestions",
      payload: { description: "Добавьте список инициативы" },
    });
    expect(accepted.statusCode, accepted.body).toBe(201);

    const bot = await app.inject({
      method: "POST",
      url: "/api/feedback/suggestions",
      payload: { description: "spam", website: "https://spam.invalid" },
    });
    expect(bot.statusCode).toBe(202);
    const result = await database.query<{ count: string }>(
      "select count(*)::text as count from feedback_reports",
    );
    expect(result.rows[0]?.count).toBe("1");
  });

  it("requires authentication and stores only allowlisted diagnostics", async () => {
    const form = multipartBody({
      kind: "BUG",
      title: "Не двигается токен",
      description: "После перетаскивания токен возвращается назад",
      diagnostics: JSON.stringify({
        route: "/game",
        viewportWidth: 1440,
        cookie: "must-not-survive",
        logs: ["private chat"],
        recentFailures: [
          {
            at: "2026-07-17T01:02:03.000Z",
            status: 409,
            code: "TOKEN_CONFLICT",
            requestId: "req-safe",
            message: "private server response",
          },
          { at: "invalid", status: 999, code: "bad code with spaces" },
        ],
      }),
    });
    const unauthorized = await app.inject({
      method: "POST",
      url: "/api/feedback/reports",
      headers: {
        "content-type": `multipart/form-data; boundary=${form.boundary}`,
      },
      payload: form.body,
    });
    expect(unauthorized.statusCode).toBe(401);

    const accepted = await app.inject({
      method: "POST",
      url: "/api/feedback/reports",
      headers: {
        "content-type": `multipart/form-data; boundary=${form.boundary}`,
        cookie: `${env.SESSION_COOKIE_NAME}=${sessionToken}`,
      },
      payload: form.body,
    });
    expect(accepted.statusCode, accepted.body).toBe(201);
    const result = await database.query<{
      campaign_id: string;
      actor_membership_id: string;
      diagnostics: Record<string, unknown>;
    }>(
      "select campaign_id, actor_membership_id, diagnostics from feedback_reports",
    );
    expect(result.rows[0]).toMatchObject({
      campaign_id: campaignId,
      actor_membership_id: membershipId,
      diagnostics: {
        route: "/game",
        viewportWidth: 1440,
        recentFailures: [
          {
            at: "2026-07-17T01:02:03.000Z",
            status: 409,
            code: "TOKEN_CONFLICT",
            requestId: "req-safe",
          },
        ],
      },
    });
  });

  it("persists a validated multipart image privately and rejects disguised files", async () => {
    const png = Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
      "base64",
    );
    const fields = {
      kind: "BUG",
      title: "Visual issue",
      description: "The canvas briefly flashes",
    };
    const form = multipartBody(fields, [
      {
        field: "screenshot",
        filename: "screen.png",
        mime: "image/png",
        content: png,
      },
    ]);
    const accepted = await app.inject({
      method: "POST",
      url: "/api/feedback/reports",
      headers: {
        "content-type": `multipart/form-data; boundary=${form.boundary}`,
        cookie: `${env.SESSION_COOKIE_NAME}=${sessionToken}`,
      },
      payload: form.body,
    });
    expect(accepted.statusCode, accepted.body).toBe(201);
    const rows = await database.query<{
      kind: string;
      mime_type: string;
      storage_key: string;
    }>("select kind, mime_type, storage_key from feedback_attachments");
    expect(rows.rows[0]).toMatchObject({
      kind: "SCREENSHOT",
      mime_type: "image/webp",
    });
    expect(await readdir(mediaRoot)).toContain(rows.rows[0]?.storage_key);

    const disguised = multipartBody(fields, [
      {
        field: "image",
        filename: "not-really.png",
        mime: "image/png",
        content: Buffer.from("private text, not an image"),
      },
    ]);
    const rejected = await app.inject({
      method: "POST",
      url: "/api/feedback/reports",
      headers: {
        "content-type": `multipart/form-data; boundary=${disguised.boundary}`,
        cookie: `${env.SESSION_COOKIE_NAME}=${sessionToken}`,
      },
      payload: disguised.body,
    });
    expect(rejected.statusCode).toBe(400);
    expect(rejected.json()).toMatchObject({ error: "UNSUPPORTED_FILE_TYPE" });
  });

  it("strictly validates public payloads and malformed diagnostics", () => {
    expect(
      publicSuggestionSchema.safeParse({ description: "ok", extra: true })
        .success,
    ).toBe(false);
    expect(() => parseFeedbackDiagnostics("not-json")).toThrow(
      "INVALID_FEEDBACK_DIAGNOSTICS",
    );
    const sanitized = sanitizeFeedbackDiagnostics({
      recentFailures: Array.from({ length: 12 }, (_, index) => ({
        at: `2026-07-17T01:02:${String(index).padStart(2, "0")}.000Z`,
        status: 500,
        code: `FAILURE_${index}`,
        requestId: `req-${index}`,
        message: "raw response must be removed",
        logs: ["private content"],
      })),
    }) as { recentFailures: Array<Record<string, unknown>> };
    expect(sanitized.recentFailures).toHaveLength(10);
    expect(sanitized.recentFailures[0]).toEqual({
      at: "2026-07-17T01:02:02.000Z",
      status: 500,
      code: "FAILURE_2",
      requestId: "req-2",
    });
  });
});

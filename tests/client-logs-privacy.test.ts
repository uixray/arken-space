import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createMigratedPglite } from "./helpers/pglite-template.js";
import Fastify, { type FastifyInstance } from "fastify";
import cookie from "@fastify/cookie";
import type { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import * as schema from "../packages/db/src/schema.js";
import { env } from "../apps/server/src/env.js";
import { registerRoutes } from "../apps/server/src/routes.js";
import { hashToken } from "../apps/server/src/security.js";
import { ensureSeed } from "../apps/server/src/seed.js";

/**
 * UIX-397: client error reports must stay debuggable without carrying user
 * content into the server log. `tests/server-telemetry.test.ts` asserts that
 * `safeClientMessage`/`sanitizeClientContext` behave correctly, but those are
 * pure helpers — they prove nothing about whether the route actually uses
 * them. Verified: changing the handler to log `body.message` directly left
 * every existing telemetry test green.
 *
 * This exercises the real path instead — a genuine authenticated request
 * through `registerRoutes`, with the logger captured — and asserts the
 * private text never appears anywhere in what gets logged.
 */

let database: PGlite;
let db: ReturnType<typeof drizzle<typeof schema>>;
let app: FastifyInstance;
let logged: unknown[];
let journalDirectory: string;
const originalJournalDirectory = env.PERFORMANCE_LOG_DIR;
const originalJournalReserve = env.PERFORMANCE_MIN_FREE_DISK_BYTES;

beforeEach(async () => {
  database = await createMigratedPglite();
  db = drizzle(database, { schema });
  await ensureSeed(db as never);

  journalDirectory = await mkdtemp(join(tmpdir(), "arken-client-logs-"));
  env.PERFORMANCE_LOG_DIR = journalDirectory;
  env.PERFORMANCE_MIN_FREE_DISK_BYTES = 1;
  logged = [];
  // Only the application's own `client.event` record is under test. Fastify's
  // built-in request logging is captured here too, but this hook runs before
  // pino's serializers, so it still holds the raw request object — in
  // production the `req` serializer reduces that to method/url/host/address,
  // with no body (confirmed against real production log output). Asserting on
  // it would fail on a test artifact rather than a real leak.
  const capture = (payload: unknown, message?: string) => {
    if (message === "client.event") logged.push(payload);
  };
  app = Fastify();
  // Record whatever the handler hands to the logger, at any level.
  app.log.info = capture as typeof app.log.info;
  app.log.warn = capture as typeof app.log.warn;
  app.log.error = capture as typeof app.log.error;
  await app.register(cookie);
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
  env.PERFORMANCE_LOG_DIR = originalJournalDirectory;
  env.PERFORMANCE_MIN_FREE_DISK_BYTES = originalJournalReserve;
  await rm(journalDirectory, { recursive: true, force: true });
});

describe("client error reports never carry user content into the log", () => {
  it("drops the client-supplied message while keeping the report debuggable", async () => {
    const [campaign] = await db.select().from(schema.campaigns).limit(1);
    const [gm] = await db
      .select()
      .from(schema.memberships)
      .where(eq(schema.memberships.role, "GM"))
      .limit(1);
    if (!campaign || !gm) throw new Error("seed failed");
    const session = "z".repeat(40);
    await db.insert(schema.sessions).values({
      membershipId: gm.id,
      tokenHash: hashToken(session),
      expiresAt: new Date(Date.now() + 60_000),
    });

    // Everything a thrown Error might realistically drag along with it.
    const privateChat = "Дариус тайно предал отряд у восточных ворот";
    const characterName = "Ллеанна Среброкрылая";

    const response = await app.inject({
      method: "POST",
      url: "/api/client-logs",
      headers: { cookie: `${env.SESSION_COOKIE_NAME}=${session}` },
      payload: {
        level: "error",
        event: "window.error",
        message: `${privateChat} / ${characterName}`,
        errorName: "TypeError",
        occurrenceCount: 3,
        stack: [
          {
            function: "renderChat",
            file: "/assets/index-BK6doIJ2.js",
            line: 1,
            column: 4242,
          },
        ],
        context: { sceneId: campaign.activeSceneId, tool: "PAN", role: "GM" },
      },
    });

    expect(response.statusCode).toBe(202);
    expect(logged.length).toBeGreaterThan(0);

    const serialized = JSON.stringify(logged);
    expect(serialized).not.toContain(privateChat);
    expect(serialized).not.toContain(characterName);

    // ...while still being worth reading: the class and the code location
    // are what make a report actionable, and neither is user content.
    expect(serialized).toContain("TypeError");
    expect(serialized).toContain("renderChat");
  });

  /**
   * UIX-407: the performance window is a separate schema variant, so it needs
   * its own route-level proof. Numbers cannot leak content, but the route has
   * to actually accept them — an earlier draft passed the pure-helper tests
   * while the sanitizer silently dropped every measurement, because only
   * `line` and `status` were allowed through as numeric values.
   */
  it("accepts a performance window and keeps its measurements intact", async () => {
    const [campaign] = await db.select().from(schema.campaigns).limit(1);
    const [gm] = await db
      .select()
      .from(schema.memberships)
      .where(eq(schema.memberships.role, "GM"))
      .limit(1);
    if (!campaign || !gm) throw new Error("seed failed");
    const session = "y".repeat(40);
    await db.insert(schema.sessions).values({
      membershipId: gm.id,
      tokenHash: hashToken(session),
      expiresAt: new Date(Date.now() + 60_000),
    });

    const response = await app.inject({
      method: "POST",
      url: "/api/client-logs",
      headers: { cookie: `${env.SESSION_COOKIE_NAME}=${session}` },
      payload: {
        level: "info",
        event: "client.performance",
        context: {
          longTasks: 12,
          blockingMs: 4321,
          longestTaskMs: 890,
          interactions: 40,
          slowInteractions: 7,
          slowestInteractionMs: 3120,
          slowestInteraction: "pointerdown",
          windowMs: 60000,
          role: "GM",
        },
      },
    });

    expect(response.statusCode).toBe(202);
    const record = logged.at(-1) as { context?: Record<string, unknown> };
    // The whole point of the feature: these survive the sanitizer as numbers.
    expect(record.context).toMatchObject({
      longTasks: 12,
      blockingMs: 4321,
      longestTaskMs: 890,
      slowInteractions: 7,
      slowestInteractionMs: 3120,
      slowestInteraction: "pointerdown",
      windowMs: 60000,
    });
  });

  it("rejects a performance window carrying anything but measurements", async () => {
    const [gm] = await db
      .select()
      .from(schema.memberships)
      .where(eq(schema.memberships.role, "GM"))
      .limit(1);
    if (!gm) throw new Error("seed failed");
    const session = "x".repeat(40);
    await db.insert(schema.sessions).values({
      membershipId: gm.id,
      tokenHash: hashToken(session),
      expiresAt: new Date(Date.now() + 60_000),
    });

    const response = await app.inject({
      method: "POST",
      url: "/api/client-logs",
      headers: { cookie: `${env.SESSION_COOKIE_NAME}=${session}` },
      payload: {
        level: "info",
        event: "client.performance",
        // A free-text field would be the way user content could reach this
        // event; the strict schema has to refuse the request outright rather
        // than accept it and rely on the sanitizer downstream.
        message: "Дариус тайно предал отряд",
        context: {
          longTasks: 1,
          blockingMs: 1,
          longestTaskMs: 1,
          interactions: 1,
          slowInteractions: 1,
          slowestInteractionMs: 1,
          windowMs: 1,
        },
      },
    });

    // Not 400: the ZodError -> 400 mapping lives in the server bootstrap
    // (`index.ts` setErrorHandler), which this harness does not register, so
    // the same rejection surfaces as a 500 here. Production answers 400 —
    // verified against the live endpoint. What matters either way is that the
    // request was refused rather than accepted, and that nothing was logged.
    expect(response.statusCode).not.toBe(202);
    expect(JSON.stringify(logged)).not.toContain("Дариус");
  });
});

describe("durable performance acknowledgement", () => {
  async function sessionCookie() {
    const [gm] = await db
      .select()
      .from(schema.memberships)
      .where(eq(schema.memberships.role, "GM"))
      .limit(1);
    if (!gm) throw new Error("seed failed");
    const session = "p".repeat(40);
    await db.insert(schema.sessions).values({
      membershipId: gm.id,
      tokenHash: hashToken(session),
      expiresAt: new Date(Date.now() + 60_000),
    });
    return `${env.SESSION_COOKIE_NAME}=${session}`;
  }
  const payload = {
    level: "info",
    event: "client.performance.heartbeat",
    context: {
      sessionId: "11111111-1111-4111-8111-111111111111",
      clientRevision: "a".repeat(40),
      sequence: 1,
      sendFailures: 0,
      longTaskObserver: "active",
      interactionObserver: "unsupported",
      windowMs: 60_000,
      longTasks: 0,
      blockingMs: 0,
      longestTaskMs: 0,
      interactions: 0,
      slowInteractions: 0,
      slowestInteractionMs: 0,
    },
  };
  it("acknowledges only after writing the heartbeat without membership or cookie data", async () => {
    const cookie = await sessionCookie();
    const response = await app.inject({
      method: "POST",
      url: "/api/client-logs",
      headers: { cookie },
      payload,
    });
    expect(response.statusCode).toBe(202);
    expect(response.json()).toEqual({ ok: true, persisted: true });
    const files = await readdir(journalDirectory);
    expect(files).toHaveLength(1);
    const text = await readFile(join(journalDirectory, files[0]!), "utf8");
    const record = JSON.parse(text);
    expect(record).toMatchObject({
      schema: 1,
      event: payload.event,
      context: payload.context,
      serverRevision: env.BUILD_REVISION,
    });
    expect(text).not.toContain(cookie);
    expect(text).not.toContain("membershipId");
    expect(text).not.toContain("campaignId");
  });
  it("does not return success if the journal cannot be written", async () => {
    const cookie = await sessionCookie();
    await rm(journalDirectory, { recursive: true, force: true });
    await writeFile(journalDirectory, "not a directory");
    const response = await app.inject({
      method: "POST",
      url: "/api/client-logs",
      headers: { cookie },
      payload,
    });
    expect(response.statusCode).toBe(503);
    expect(response.json()).toEqual({
      ok: false,
      code: "PERFORMANCE_PERSISTENCE_UNAVAILABLE",
    });
  });
  it("does not persist unauthenticated reports", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/api/client-logs",
      payload,
    });
    expect(response.statusCode).not.toBe(202);
    expect(await readdir(journalDirectory)).toEqual([]);
  });
});

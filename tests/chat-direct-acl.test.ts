import { mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import cookie from "@fastify/cookie";
import { PGlite } from "@electric-sql/pglite";
import Fastify, { type FastifyInstance } from "fastify";
import { drizzle } from "drizzle-orm/pglite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { env } from "../apps/server/src/env.js";
import { registerRoutes } from "../apps/server/src/routes.js";
import { hashToken } from "../apps/server/src/security.js";
import * as schema from "../packages/db/src/schema.js";

const ids = {
  campaign: "31000000-0000-4000-8000-000000000001",
  foreignCampaign: "31000000-0000-4000-8000-000000000002",
  sender: "31000000-0000-4000-8000-000000000003",
  recipient: "31000000-0000-4000-8000-000000000004",
  outsider: "31000000-0000-4000-8000-000000000005",
  gm: "31000000-0000-4000-8000-000000000006",
  foreign: "31000000-0000-4000-8000-000000000007",
};
const secrets = {
  sender: "direct-sender-session",
  recipient: "direct-recipient-session",
  outsider: "direct-outsider-session",
  gm: "direct-gm-session",
  foreign: "direct-foreign-session",
};
const headers = (secret: string) => ({
  cookie: `${env.SESSION_COOKIE_NAME}=${secret}`,
});

let database: PGlite;
let app: FastifyInstance;
let db: ReturnType<typeof drizzle<typeof schema>>;
const createdStorageKeys: string[] = [];

async function migrate() {
  const directory = new URL("../packages/db/drizzle/", import.meta.url);
  for (const file of (await readdir(directory))
    .filter((name) => name.endsWith(".sql"))
    .sort()) {
    await database.exec(
      (await readFile(new URL(file, directory), "utf8")).replaceAll(
        "--> statement-breakpoint",
        "",
      ),
    );
  }
}

async function openDirect(
  actor: keyof typeof secrets,
  participantMembershipId: string,
) {
  return app.inject({
    method: "POST",
    url: "/api/chat/direct",
    headers: headers(secrets[actor]),
    payload: { participantMembershipId },
  });
}

async function sendDirect(actor: keyof typeof secrets, threadId: string) {
  return app.inject({
    method: "POST",
    url: "/api/chat/direct/messages",
    headers: headers(secrets[actor]),
    payload: {
      actionId: crypto.randomUUID(),
      threadId,
      body: `from ${actor}`,
    },
  });
}

beforeEach(async () => {
  database = new PGlite();
  await migrate();
  db = drizzle(database, { schema });
  await db.insert(schema.campaigns).values([
    { id: ids.campaign, name: "Direct ACL" },
    { id: ids.foreignCampaign, name: "Foreign" },
  ]);
  await db.insert(schema.memberships).values([
    {
      id: ids.sender,
      campaignId: ids.campaign,
      role: "PLAYER",
      displayName: "A",
    },
    {
      id: ids.recipient,
      campaignId: ids.campaign,
      role: "PLAYER",
      displayName: "B",
    },
    {
      id: ids.outsider,
      campaignId: ids.campaign,
      role: "PLAYER",
      displayName: "C",
    },
    { id: ids.gm, campaignId: ids.campaign, role: "GM", displayName: "GM" },
    {
      id: ids.foreign,
      campaignId: ids.foreignCampaign,
      role: "PLAYER",
      displayName: "Foreign",
    },
  ]);
  await db.insert(schema.sessions).values(
    (Object.keys(secrets) as Array<keyof typeof secrets>).map((key) => ({
      membershipId: ids[key],
      tokenHash: hashToken(secrets[key]),
      expiresAt: new Date(Date.now() + 60_000),
    })),
  );
  app = Fastify();
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
  await Promise.all(
    createdStorageKeys
      .splice(0)
      .map((key) => rm(resolve(env.MEDIA_ROOT, key), { force: true })),
  );
});

describe("direct chat integration ACL", () => {
  it("creates one canonical thread for sequential and concurrent same-pair requests", async () => {
    const first = await openDirect("sender", ids.recipient);
    const reverse = await openDirect("recipient", ids.sender);
    expect(first.statusCode, first.body).toBe(201);
    expect(reverse.statusCode).toBe(200);
    expect(reverse.json().id).toBe(first.json().id);

    const concurrent = await Promise.all(
      Array.from({ length: 4 }, (_, index) =>
        openDirect(
          index % 2 ? "recipient" : "sender",
          index % 2 ? ids.sender : ids.recipient,
        ),
      ),
    );
    expect(concurrent.map((response) => response.statusCode)).toEqual([
      200, 200, 200, 200,
    ]);
    expect(new Set(concurrent.map((response) => response.json().id))).toEqual(
      new Set([first.json().id]),
    );
  });

  it("allows only sender and recipient; outsider, GM and cross-campaign guesses are indistinguishable 404s", async () => {
    const opened = await openDirect("sender", ids.recipient);
    const threadId = opened.json().id as string;
    expect((await sendDirect("sender", threadId)).statusCode).toBe(201);
    expect((await sendDirect("recipient", threadId)).statusCode).toBe(201);

    for (const actor of ["outsider", "gm", "foreign"] as const) {
      const sent = await sendDirect(actor, threadId);
      expect(sent.statusCode).toBe(404);
      expect(sent.json()).toEqual({ error: "CHAT_THREAD_NOT_FOUND" });
      const read = await app.inject({
        method: "POST",
        url: "/api/chat/read",
        headers: headers(secrets[actor]),
        payload: { threadId, sequence: 999 },
      });
      expect(read.statusCode).toBe(404);
      expect(read.json()).toEqual({ error: "CHAT_THREAD_NOT_FOUND" });
    }
  });

  it("never exposes a direct thread or its messages in outsider, GM, or foreign reconnect snapshots", async () => {
    const opened = await openDirect("sender", ids.recipient);
    const threadId = opened.json().id as string;
    await sendDirect("sender", threadId);

    for (const actor of ["sender", "recipient"] as const) {
      const snapshot = await app.inject({
        method: "GET",
        url: "/api/bootstrap",
        headers: headers(secrets[actor]),
      });
      expect(snapshot.statusCode).toBe(200);
      expect(
        snapshot
          .json()
          .chatThreads.some((thread: { id: string }) => thread.id === threadId),
      ).toBe(true);
      expect(
        snapshot
          .json()
          .messages.some(
            (message: { threadId: string }) => message.threadId === threadId,
          ),
      ).toBe(true);
    }
    for (const actor of ["outsider", "gm", "foreign"] as const) {
      const snapshot = await app.inject({
        method: "GET",
        url: "/api/bootstrap",
        headers: headers(secrets[actor]),
      });
      expect(snapshot.statusCode).toBe(200);
      expect(
        snapshot
          .json()
          .chatThreads.some((thread: { id: string }) => thread.id === threadId),
      ).toBe(false);
      expect(
        snapshot
          .json()
          .messages.some(
            (message: { threadId: string }) => message.threadId === threadId,
          ),
      ).toBe(false);
    }
  });

  it("conceals staged and claimed attachment content from nonparticipants", async () => {
    const opened = await openDirect("sender", ids.recipient);
    const threadId = opened.json().id as string;
    const contentId = crypto.randomUUID();
    const storageKey = `direct-acl-${crypto.randomUUID()}.webp`;
    createdStorageKeys.push(storageKey);
    await mkdir(resolve(env.MEDIA_ROOT), { recursive: true });
    await writeFile(
      resolve(env.MEDIA_ROOT, storageKey),
      Buffer.from("private"),
    );
    await db.insert(schema.chatAttachmentUploads).values({
      contentId,
      campaignId: ids.campaign,
      uploadedByMembershipId: ids.sender,
      fileName: "private.webp",
      storageKey,
      mimeType: "image/webp",
      sizeBytes: 7,
      width: 1,
      height: 1,
      expiresAt: new Date(Date.now() + 60_000),
    });
    const contentUrl = `/api/chat/attachments/${contentId}/content`;
    expect(
      (
        await app.inject({
          method: "GET",
          url: contentUrl,
          headers: headers(secrets.sender),
        })
      ).statusCode,
    ).toBe(404);

    const claimed = await app.inject({
      method: "POST",
      url: "/api/chat/direct/messages",
      headers: headers(secrets.sender),
      payload: {
        actionId: crypto.randomUUID(),
        threadId,
        body: "image",
        attachmentContentIds: [contentId],
      },
    });
    expect(claimed.statusCode).toBe(201);
    expect(
      (
        await app.inject({
          method: "GET",
          url: contentUrl,
          headers: headers(secrets.sender),
        })
      ).statusCode,
    ).toBe(200);
    expect(
      (
        await app.inject({
          method: "GET",
          url: contentUrl,
          headers: headers(secrets.recipient),
        })
      ).statusCode,
    ).toBe(200);
    for (const actor of ["outsider", "gm", "foreign"] as const)
      expect(
        (
          await app.inject({
            method: "GET",
            url: contentUrl,
            headers: headers(secrets[actor]),
          })
        ).statusCode,
      ).toBe(404);
  });
});

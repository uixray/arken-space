import { readdir, readFile } from "node:fs/promises";
import Fastify from "fastify";
import cookie from "@fastify/cookie";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import * as schema from "@arken/db";
import { betaPlayerByHandle } from "@arken/contracts";
import { env } from "./env.js";
import { hashToken } from "./security.js";
import { registerRoutes } from "./routes.js";

let database: PGlite;
let app: ReturnType<typeof Fastify>;
let db: ReturnType<typeof drizzle<typeof schema>>;
const campaignId = crypto.randomUUID();

beforeEach(async () => {
  database = new PGlite();
  const migrations = new URL("../../../packages/db/drizzle/", import.meta.url);
  for (const file of (await readdir(migrations))
    .filter((name) => name.endsWith(".sql"))
    .sort()) {
    await database.exec(
      (await readFile(new URL(file, migrations), "utf8")).replaceAll(
        "--> statement-breakpoint",
        "",
      ),
    );
  }
  db = drizzle(database, { schema });
  await db.insert(schema.campaigns).values({ id: campaignId, name: "Test" });
  app = Fastify();
  await app.register(cookie);
  const io = {
    in: () => ({ fetchSockets: async () => [] }),
    to: () => ({ emit() {} }),
  };
  registerRoutes(app, db as never, io as never);
  await app.ready();
});

afterEach(async () => {
  await app.close();
  await database.close();
});

async function addIdentity(
  role: "PLAYER" | "GM",
  displayName: string,
  label: string,
  revoked = false,
) {
  const membershipId = crypto.randomUUID();
  await db.insert(schema.memberships).values({
    id: membershipId,
    campaignId,
    role,
    displayName,
  });
  await db.insert(schema.playerAccessGrants).values({
    campaignId,
    membershipId,
    label,
    tokenHash: hashToken(crypto.randomUUID()),
    revokedAt: revoked ? new Date() : null,
  });
  return membershipId;
}

async function login(handle = "archinamon") {
  return app.inject({ method: "POST", url: `/api/auth/player/${handle}` });
}

async function counts() {
  return Promise.all([
    db.select().from(schema.memberships),
    db.select().from(schema.playerAccessGrants),
    db.select().from(schema.sessions),
  ]).then(([members, grants, sessions]) => [
    members.length,
    grants.length,
    sessions.length,
  ]);
}

describe("closed-beta player authentication", () => {
  it("authenticates only a unique active PLAYER grant", async () => {
    const player = betaPlayerByHandle("archinamon")!;
    const membershipId = await addIdentity(
      "PLAYER",
      player.name,
      player.handle,
    );
    const response = await login();
    expect(response.statusCode).toBe(200);
    const sessions = await db.select().from(schema.sessions);
    expect(sessions).toHaveLength(1);
    expect(sessions[0]?.membershipId).toBe(membershipId);
  });

  it.each([
    "unknown handle",
    "known alias no grant",
    "revoked grant",
    "GM collision",
    "ambiguous grants",
  ])("fails closed without writes for %s", async (scenario) => {
    const player = betaPlayerByHandle("archinamon")!;
    if (scenario === "revoked grant")
      await addIdentity("PLAYER", player.name, player.handle, true);
    if (scenario === "GM collision")
      await addIdentity("GM", player.name, player.handle);
    if (scenario === "ambiguous grants") {
      await addIdentity("PLAYER", player.name, "unrelated");
      await addIdentity("PLAYER", "Other", player.handle);
    }
    const before = await counts();
    const response = await login(
      scenario === "unknown handle" ? "not-a-player" : "archinamon",
    );
    expect(response.statusCode).toBe(404);
    expect(await counts()).toEqual(before);
  });
});

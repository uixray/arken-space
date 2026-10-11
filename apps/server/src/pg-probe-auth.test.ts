import type { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { eq } from "drizzle-orm";
import { afterEach, beforeEach, expect, it } from "vitest";
import * as schema from "@arken/db";
import {
  campaigns,
  gmAccessCredentials,
  memberships,
  playerAccessGrants,
  sessions,
} from "@arken/db";
import { createMigratedPglite } from "../../../tests/helpers/pglite-template.js";
import { authFromSessionToken } from "./auth.js";
import { env } from "./env.js";
import { seedProbeSessions } from "./pg-probe-auth.js";
import { hashToken } from "./security.js";

let database: PGlite;
let db: ReturnType<typeof drizzle<typeof schema>>;
const previousAccountAuth = env.ACCOUNT_AUTH_ENABLED;
const previousLinkAccess = env.CAMPAIGN_LINK_ACCESS_ENABLED;

beforeEach(async () => {
  database = await createMigratedPglite();
  db = drizzle(database, { schema });
  env.ACCOUNT_AUTH_ENABLED = true;
  env.CAMPAIGN_LINK_ACCESS_ENABLED = true;
});
afterEach(async () => {
  env.ACCOUNT_AUTH_ENABLED = previousAccountAuth;
  env.CAMPAIGN_LINK_ACCESS_ENABLED = previousLinkAccess;
  await database.close();
});

async function fixture(role: "GM" | "PLAYER") {
  const [campaign] = await db
    .insert(campaigns)
    .values({ name: "Probe auth" })
    .returning();
  const [member] = await db
    .insert(memberships)
    .values({ campaignId: campaign!.id, role, displayName: "Probe" })
    .returning();
  return {
    membershipId: member!.id,
    campaignId: campaign!.id,
    role,
    token: crypto.randomUUID(),
  };
}

it("issues valid GM/PLAYER sources while still rejecting an unbound session", async () => {
  const gm = await fixture("GM");
  const player = await fixture("PLAYER");
  await seedProbeSessions(db as never, [gm, player]);
  expect(await authFromSessionToken(db as never, gm.token)).toMatchObject({
    membershipId: gm.membershipId,
    role: "GM",
  });
  expect(await authFromSessionToken(db as never, player.token)).toMatchObject({
    membershipId: player.membershipId,
    role: "PLAYER",
  });
  const legacy = crypto.randomUUID();
  await db
    .insert(sessions)
    .values({
      membershipId: gm.membershipId,
      tokenHash: hashToken(legacy),
      expiresAt: new Date(Date.now() + 60_000),
    });
  expect(await authFromSessionToken(db as never, legacy)).toBeNull();
  await db
    .update(gmAccessCredentials)
    .set({ revision: 1 })
    .where(eq(gmAccessCredentials.campaignId, gm.campaignId));
  await db
    .update(playerAccessGrants)
    .set({ revokedAt: new Date() })
    .where(eq(playerAccessGrants.membershipId, player.membershipId));
  expect(await authFromSessionToken(db as never, gm.token)).toBeNull();
  expect(await authFromSessionToken(db as never, player.token)).toBeNull();
});

it("does not bypass the campaign-link feature guard", async () => {
  const gm = await fixture("GM");
  await seedProbeSessions(db as never, [gm]);
  env.CAMPAIGN_LINK_ACCESS_ENABLED = false;
  expect(await authFromSessionToken(db as never, gm.token)).toBeNull();
});

it("rejects mismatched role/campaign before issuing any source", async () => {
  const gm = await fixture("GM");
  await expect(
    seedProbeSessions(db as never, [{ ...gm, role: "PLAYER" }]),
  ).rejects.toThrow("PROBE_SESSION_MEMBERSHIP_MISMATCH");
  await expect(
    seedProbeSessions(db as never, [
      { ...gm, campaignId: crypto.randomUUID() },
    ]),
  ).rejects.toThrow("PROBE_SESSION_MEMBERSHIP_MISMATCH");
  expect(await db.select().from(sessions)).toHaveLength(0);
});

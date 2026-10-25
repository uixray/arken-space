import Fastify from "fastify";
import cookie from "@fastify/cookie";
import type { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import * as schema from "@arken/db";
import {
  campaigns,
  characters,
  memberships,
  playerAccessGrants,
  sessions,
} from "@arken/db";
import { env } from "./env.js";
import { hashToken } from "./security.js";
import { seedCampaignContent } from "./seed.js";
import { registerRoutes } from "./routes.js";
import { memberRoom, sessionRoom } from "./rooms.js";
import { createMigratedPglite } from "../../../tests/helpers/pglite-template.js";

type Db = ReturnType<typeof drizzle<typeof schema>>;
type CampaignFixture = {
  campaign: typeof campaigns.$inferSelect;
  gm: typeof memberships.$inferSelect;
  gmLinkSecret: string;
};
type PlayerFixture = {
  membership: typeof memberships.$inferSelect;
  grant: typeof playerAccessGrants.$inferSelect;
  token: string;
};

const uuid = () => crypto.randomUUID();
const origin = env.WEB_ORIGIN;
const previousFlags = {
  accountAuthEnabled: env.ACCOUNT_AUTH_ENABLED,
  campaignLinkAccessEnabled: env.CAMPAIGN_LINK_ACCESS_ENABLED,
};

let database: PGlite;
let db: Db;
let app: ReturnType<typeof Fastify>;
const disconnects: string[] = [];
const io = {
  in(room: string) {
    return {
      fetchSockets: async () => [],
      disconnectSockets: () => disconnects.push(room),
    };
  },
  to() {
    return { emit() {} };
  },
};

beforeEach(async () => {
  database = await createMigratedPglite();
  db = drizzle(database, { schema });
  disconnects.length = 0;
  Object.assign(env, {
    ACCOUNT_AUTH_ENABLED: true,
    CAMPAIGN_LINK_ACCESS_ENABLED: true,
  });
  app = Fastify();
  await app.register(cookie);
  registerRoutes(app, db as never, io as never);
  await app.ready();
});

afterEach(async () => {
  try {
    await app.close();
  } finally {
    try {
      await database.close();
    } finally {
      Object.assign(env, {
        ACCOUNT_AUTH_ENABLED: previousFlags.accountAuthEnabled,
        CAMPAIGN_LINK_ACCESS_ENABLED: previousFlags.campaignLinkAccessEnabled,
      });
    }
  }
});

async function makeCampaign(name: string): Promise<CampaignFixture> {
  const [campaign] = await db.insert(campaigns).values({ name }).returning();
  if (!campaign) throw new Error("synthetic campaign missing");
  const gmLinkSecret = `synthetic-gm-link-${uuid()}`;
  const seeded = await seedCampaignContent(db as never, campaign, gmLinkSecret);
  if (!seeded.gm) throw new Error("synthetic GM membership missing");
  return { campaign, gm: seeded.gm, gmLinkSecret };
}

async function makePlayer(
  campaignId: string,
  displayName: string,
  label: string,
): Promise<PlayerFixture> {
  const [membership] = await db
    .insert(memberships)
    .values({ campaignId, role: "PLAYER", displayName })
    .returning();
  if (!membership) throw new Error("synthetic player membership missing");
  const token = `synthetic-player-grant-${uuid()}`;
  const [grant] = await db
    .insert(playerAccessGrants)
    .values({
      campaignId,
      membershipId: membership.id,
      label,
      tokenHash: hashToken(token),
    })
    .returning();
  if (!grant) throw new Error("synthetic player grant missing");
  return { membership, grant, token };
}

async function makeGmSession(
  fixture: CampaignFixture,
  token = `synthetic-gm-session-${uuid()}`,
) {
  await db.insert(sessions).values({
    membershipId: fixture.gm.id,
    tokenHash: hashToken(token),
    expiresAt: new Date(Date.now() + 60_000),
    authSource: "GM_LINK",
    gmCredentialCampaignId: fixture.campaign.id,
    gmCredentialRevision: 0,
  });
  return token;
}

function cookieHeader(token: string) {
  return `${env.SESSION_COOKIE_NAME}=${token}`;
}

async function loginPlayer(token: string, existingCookie?: string) {
  return app.inject({
    method: "POST",
    url: "/api/auth/invite",
    headers: {
      origin,
      ...(existingCookie ? { cookie: existingCookie } : {}),
    },
    payload: { token },
  });
}

function responseSessionToken(response: { headers: Record<string, unknown> }) {
  const raw = response.headers["set-cookie"];
  const values = Array.isArray(raw) ? raw : [raw];
  const prefix = `${env.SESSION_COOKIE_NAME}=`;
  const cookie = values
    .map((value) => String(value ?? ""))
    .flatMap((value) => value.split(/,\s*(?=[^;,]+=)/))
    .find((value) => value.trimStart().startsWith(prefix));
  if (!cookie)
    throw new Error("login response omitted its game session cookie");
  const value = cookie.trimStart().slice(prefix.length).split(";", 1)[0];
  if (!value) throw new Error("game session cookie was empty");
  return value;
}

async function getSession(token: string) {
  const [session] = await db
    .select()
    .from(sessions)
    .where(eq(sessions.tokenHash, hashToken(token)))
    .limit(1);
  return session;
}

async function bootstrap(token: string) {
  return app.inject({
    method: "GET",
    url: "/api/bootstrap",
    headers: { cookie: cookieHeader(token) },
  });
}

describe("UIX-527 server-backed roster continuity", () => {
  it("resolves six distinct synthetic grants by token and preserves identity across rename", async () => {
    const table = await makeCampaign("Synthetic continuity table");
    const players = await Promise.all(
      Array.from({ length: 6 }, (_, index) =>
        makePlayer(
          table.campaign.id,
          `Synthetic Adventurer ${index + 1}`,
          `synthetic-handle-${index + 1}`,
        ),
      ),
    );

    const sessionsByMembership = new Map<string, string>();
    for (const player of players) {
      const login = await loginPlayer(player.token);
      expect(login.statusCode, login.body).toBe(200);
      const sessionToken = responseSessionToken(login);
      sessionsByMembership.set(player.membership.id, sessionToken);
      const session = await getSession(sessionToken);
      expect(session).toMatchObject({
        membershipId: player.membership.id,
        authSource: "PLAYER_GRANT",
        playerAccessGrantId: player.grant.id,
        playerAccessGrantRevision: player.grant.revision,
      });
      const snapshot = await bootstrap(sessionToken);
      expect(snapshot.statusCode, snapshot.body).toBe(200);
      expect(snapshot.json().me.id).toBe(player.membership.id);
    }

    expect(
      await db
        .select()
        .from(memberships)
        .where(eq(memberships.campaignId, table.campaign.id)),
    ).toHaveLength(7);
    expect(
      await db
        .select()
        .from(playerAccessGrants)
        .where(eq(playerAccessGrants.campaignId, table.campaign.id)),
    ).toHaveLength(6);

    const first = players[0];
    if (!first) throw new Error("first synthetic player missing");
    const sessionToken = sessionsByMembership.get(first.membership.id);
    if (!sessionToken) throw new Error("first synthetic session missing");
    const renamed = await app.inject({
      method: "PATCH",
      url: `/api/memberships/${first.membership.id}/name`,
      headers: { cookie: cookieHeader(sessionToken) },
      payload: { actionId: uuid(), revision: 0, name: "Renamed Synthetic" },
    });
    expect(renamed.statusCode, renamed.body).toBe(200);
    const relogin = await loginPlayer(first.token);
    expect(relogin.statusCode, relogin.body).toBe(200);
    const reloginToken = responseSessionToken(relogin);
    const reloginSnapshot = await bootstrap(reloginToken);
    expect(reloginSnapshot.statusCode, reloginSnapshot.body).toBe(200);
    expect(reloginSnapshot.json().me).toMatchObject({
      id: first.membership.id,
      displayName: "Renamed Synthetic",
    });
    expect(
      await db
        .select()
        .from(playerAccessGrants)
        .where(eq(playerAccessGrants.id, first.grant.id)),
    ).toMatchObject([{ tokenHash: hashToken(first.token) }]);
  });

  it("expires the prior selected cookie on A-to-B switch and denies unbound account-mode sessions", async () => {
    const table = await makeCampaign("Synthetic cookie switch");
    const a = await makePlayer(table.campaign.id, "Synthetic A", "a-label");
    const b = await makePlayer(table.campaign.id, "Synthetic B", "b-label");
    const firstLogin = await loginPlayer(a.token);
    expect(firstLogin.statusCode).toBe(200);
    const firstToken = responseSessionToken(firstLogin);
    const firstSession = await getSession(firstToken);
    if (!firstSession) throw new Error("first game session missing");

    const secondLogin = await loginPlayer(b.token, cookieHeader(firstToken));
    expect(secondLogin.statusCode, secondLogin.body).toBe(200);
    const secondToken = responseSessionToken(secondLogin);
    const secondSession = await getSession(secondToken);
    if (!secondSession) throw new Error("second game session missing");
    expect((await getSession(firstToken))?.expiresAt.getTime()).toBe(0);
    expect(disconnects).toContain(sessionRoom(firstSession.id));
    const secondSnapshot = await bootstrap(secondToken);
    expect(secondSnapshot.statusCode, secondSnapshot.body).toBe(200);
    expect(secondSnapshot.json().me.id).toBe(b.membership.id);
    expect((await bootstrap(firstToken)).statusCode).toBe(401);

    const unboundToken = `synthetic-unbound-session-${uuid()}`;
    await db.insert(sessions).values({
      membershipId: table.gm.id,
      tokenHash: hashToken(unboundToken),
      expiresAt: new Date(Date.now() + 60_000),
    });
    expect((await bootstrap(unboundToken)).statusCode).toBe(401);

    const gmLogin = await app.inject({
      method: "POST",
      url: "/api/auth/gm",
      headers: { origin, cookie: cookieHeader(secondToken) },
      payload: { token: table.gmLinkSecret },
    });
    expect(gmLogin.statusCode, gmLogin.body).toBe(200);
    const gmSessionToken = responseSessionToken(gmLogin);
    expect(await getSession(gmSessionToken)).toMatchObject({
      membershipId: table.gm.id,
      authSource: "GM_LINK",
      gmCredentialCampaignId: table.campaign.id,
    });
    expect((await getSession(secondToken))?.expiresAt.getTime()).toBe(0);
    expect(disconnects).toContain(sessionRoom(secondSession.id));
  });

  it("keeps public aliases closed and rejects disabled or wrong-origin link auth without writes", async () => {
    const table = await makeCampaign("Synthetic auth boundary");
    const player = await makePlayer(
      table.campaign.id,
      "Synthetic public fixture",
      "synthetic-public-handle",
    );
    const before = [
      (await db.select().from(memberships)).length,
      (await db.select().from(playerAccessGrants)).length,
      (await db.select().from(sessions)).length,
    ];

    const wrongOrigin = await app.inject({
      method: "POST",
      url: "/api/auth/invite",
      headers: { origin: "https://untrusted.invalid" },
      payload: { token: player.token },
    });
    expect(wrongOrigin.statusCode).toBe(403);
    const missingOrigin = await app.inject({
      method: "POST",
      url: "/api/auth/invite",
      payload: { token: player.token },
    });
    expect(missingOrigin.statusCode).toBe(403);
    const alias = await app.inject({
      method: "POST",
      url: "/api/auth/player/synthetic-public-handle",
    });
    expect(alias.statusCode).toBe(410);
    expect(alias.json()).toEqual({ error: "PUBLIC_ALIAS_LOGIN_DISABLED" });

    Object.assign(env, { CAMPAIGN_LINK_ACCESS_ENABLED: false });
    const disabled = await app.inject({
      method: "POST",
      url: "/api/auth/invite",
      headers: { origin },
      payload: { token: player.token },
    });
    expect(disabled.statusCode).toBe(410);
    expect(disabled.json()).toEqual({ error: "CAMPAIGN_LINK_ACCESS_DISABLED" });
    const disabledGm = await app.inject({
      method: "POST",
      url: "/api/auth/gm",
      headers: { origin },
      payload: { token: table.gmLinkSecret },
    });
    expect(disabledGm.statusCode).toBe(410);
    expect(disabledGm.json()).toEqual({
      error: "CAMPAIGN_LINK_ACCESS_DISABLED",
    });

    expect([
      (await db.select().from(memberships)).length,
      (await db.select().from(playerAccessGrants)).length,
      (await db.select().from(sessions)).length,
    ]).toEqual(before);
  });

  it("adds a seventh member through the scoped GM route and preserves rename ACL/CAS", async () => {
    const table = await makeCampaign("Synthetic member creation");
    const foreign = await makeCampaign("Synthetic foreign campaign");
    const initialPlayers = await Promise.all(
      Array.from({ length: 6 }, (_, index) =>
        makePlayer(
          table.campaign.id,
          `Synthetic initial player ${index + 1}`,
          `synthetic-initial-${index + 1}`,
        ),
      ),
    );
    expect(initialPlayers).toHaveLength(6);
    const foreignPlayer = await makePlayer(
      foreign.campaign.id,
      "Synthetic foreign invite target",
      "synthetic-foreign-invite-target",
    );
    const gmToken = await makeGmSession(table);
    const foreignGmToken = await makeGmSession(foreign);
    const beforeMembers = await db
      .select({ id: memberships.id })
      .from(memberships)
      .where(eq(memberships.campaignId, table.campaign.id));
    const beforeGrants = await db
      .select({
        id: playerAccessGrants.id,
        membershipId: playerAccessGrants.membershipId,
        tokenHash: playerAccessGrants.tokenHash,
      })
      .from(playerAccessGrants)
      .where(eq(playerAccessGrants.campaignId, table.campaign.id));
    expect(beforeMembers).toHaveLength(7);
    expect(beforeGrants).toHaveLength(6);
    const [character] = await db
      .insert(characters)
      .values({
        campaignId: table.campaign.id,
        name: "Synthetic unowned character",
      })
      .returning();
    if (!character) throw new Error("synthetic character missing");

    const initialPlayerLogin = await loginPlayer(initialPlayers[0]!.token);
    expect(initialPlayerLogin.statusCode, initialPlayerLogin.body).toBe(200);
    const playerCreate = await app.inject({
      method: "POST",
      url: "/api/invites",
      headers: {
        cookie: cookieHeader(responseSessionToken(initialPlayerLogin)),
      },
      payload: {
        actionId: uuid(),
        characterId: character.id,
        label: "Synthetic forbidden player invite",
      },
    });
    expect(playerCreate.statusCode).toBe(403);

    const [foreignCharacter] = await db
      .insert(characters)
      .values({
        campaignId: foreign.campaign.id,
        name: "Synthetic foreign character",
      })
      .returning();
    if (!foreignCharacter) throw new Error("foreign character fixture missing");
    const foreignCharacterInvite = await app.inject({
      method: "POST",
      url: "/api/invites",
      headers: { cookie: cookieHeader(gmToken) },
      payload: {
        actionId: uuid(),
        characterId: foreignCharacter.id,
        label: "Synthetic foreign character invite",
      },
    });
    expect(foreignCharacterInvite.statusCode).toBe(404);

    const createActionId = uuid();
    const creation = await app.inject({
      method: "POST",
      url: "/api/invites",
      headers: { cookie: cookieHeader(gmToken) },
      payload: {
        actionId: createActionId,
        characterId: character.id,
        label: "Synthetic seventh player",
      },
    });
    expect(creation.statusCode, creation.body).toBe(201);
    expect(creation.json()).toMatchObject({ created: true });
    const grantId = creation.json().grant.id as string;
    const token = new URL(creation.json().url as string).pathname
      .split("/")
      .at(-1);
    if (!token) throw new Error("synthetic player link token missing");
    const memberId = creation.json().grant.membershipId as string;

    const sameAction = await app.inject({
      method: "POST",
      url: "/api/invites",
      headers: { cookie: cookieHeader(gmToken) },
      payload: {
        actionId: createActionId,
        characterId: character.id,
        label: "Synthetic seventh player",
      },
    });
    expect(sameAction.statusCode).toBe(409);
    const reused = await app.inject({
      method: "POST",
      url: "/api/invites",
      headers: { cookie: cookieHeader(gmToken) },
      payload: {
        actionId: uuid(),
        characterId: character.id,
        label: "Synthetic seventh player",
      },
    });
    expect(reused.statusCode).toBe(200);
    expect(reused.json()).toMatchObject({ created: false, url: null });
    expect(reused.json().grant.id).toBe(grantId);
    expect(
      (
        await db
          .select({ id: memberships.id })
          .from(memberships)
          .where(eq(memberships.campaignId, table.campaign.id))
      )
        .map(({ id }) => id)
        .sort(),
    ).toEqual([...beforeMembers.map(({ id }) => id), memberId].sort());
    const retainedGrants = await db
      .select({
        id: playerAccessGrants.id,
        membershipId: playerAccessGrants.membershipId,
        tokenHash: playerAccessGrants.tokenHash,
      })
      .from(playerAccessGrants)
      .where(eq(playerAccessGrants.campaignId, table.campaign.id));
    expect(
      retainedGrants
        .filter(({ id }) => id !== grantId)
        .sort((a, b) => a.id.localeCompare(b.id)),
    ).toEqual([...beforeGrants].sort((a, b) => a.id.localeCompare(b.id)));
    expect(
      await db.select().from(memberships).where(eq(memberships.id, memberId)),
    ).toHaveLength(1);

    const gmGrants = await app.inject({
      method: "GET",
      url: "/api/player-access",
      headers: { cookie: cookieHeader(gmToken) },
    });
    expect(gmGrants.statusCode).toBe(200);
    expect(gmGrants.json().map((grant: { id: string }) => grant.id)).toContain(
      grantId,
    );
    expect(
      gmGrants.json().map((grant: { id: string }) => grant.id),
    ).not.toContain(foreignPlayer.grant.id);
    expect(JSON.stringify(gmGrants.json())).not.toContain("tokenHash");

    const seventhPlayerLogin = await loginPlayer(token);
    expect(seventhPlayerLogin.statusCode).toBe(200);
    const playerToken = responseSessionToken(seventhPlayerLogin);
    const rename = await app.inject({
      method: "PATCH",
      url: `/api/memberships/${memberId}/name`,
      headers: { cookie: cookieHeader(playerToken) },
      payload: {
        actionId: uuid(),
        revision: 0,
        name: "Renamed synthetic player",
      },
    });
    expect(rename.statusCode, rename.body).toBe(200);
    const staleRename = await app.inject({
      method: "PATCH",
      url: `/api/memberships/${memberId}/name`,
      headers: { cookie: cookieHeader(playerToken) },
      payload: { actionId: uuid(), revision: 0, name: "Stale synthetic name" },
    });
    expect(staleRename.statusCode).toBe(409);

    const anotherPlayer = await makePlayer(
      table.campaign.id,
      "Synthetic other member",
      "synthetic-other-member",
    );
    const anotherLogin = await loginPlayer(anotherPlayer.token);
    const forbiddenRename = await app.inject({
      method: "PATCH",
      url: `/api/memberships/${memberId}/name`,
      headers: { cookie: cookieHeader(responseSessionToken(anotherLogin)) },
      payload: { actionId: uuid(), revision: 1, name: "Forbidden rename" },
    });
    expect(forbiddenRename.statusCode).toBe(403);
    const foreignRename = await app.inject({
      method: "PATCH",
      url: `/api/memberships/${memberId}/name`,
      headers: { cookie: cookieHeader(foreignGmToken) },
      payload: { actionId: uuid(), revision: 1, name: "Foreign rename" },
    });
    expect(foreignRename.statusCode).toBe(404);
    expect((await getSession(playerToken))?.membershipId).toBe(memberId);
  });

  it("rotates and revokes only the same-campaign grant while invalidating sessions", async () => {
    const table = await makeCampaign("Synthetic grant lifecycle");
    const foreign = await makeCampaign("Synthetic foreign lifecycle");
    const gmToken = await makeGmSession(table);
    const foreignGmToken = await makeGmSession(foreign);
    const player = await makePlayer(
      table.campaign.id,
      "Synthetic lifecycle player",
      "synthetic-lifecycle-label",
    );
    const firstLogin = await loginPlayer(player.token);
    expect(firstLogin.statusCode).toBe(200);
    const firstToken = responseSessionToken(firstLogin);

    const rotate = await app.inject({
      method: "POST",
      url: `/api/player-access/${player.grant.id}/rotate`,
      headers: { cookie: cookieHeader(gmToken) },
      payload: { actionId: uuid(), revision: player.grant.revision },
    });
    expect(rotate.statusCode).toBe(200);
    expect(rotate.json().grant.revision).toBe(player.grant.revision + 1);
    expect(disconnects).toContain(memberRoom(player.membership.id));
    expect(await getSession(firstToken)).toBeUndefined();
    const rotatedSecret = new URL(rotate.json().url as string).pathname
      .split("/")
      .at(-1);
    if (!rotatedSecret)
      throw new Error("rotated synthetic grant token missing");
    expect((await loginPlayer(player.token)).statusCode).toBe(410);

    const staleRotate = await app.inject({
      method: "POST",
      url: `/api/player-access/${player.grant.id}/rotate`,
      headers: { cookie: cookieHeader(gmToken) },
      payload: { actionId: uuid(), revision: player.grant.revision },
    });
    expect(staleRotate.statusCode).toBe(409);

    const rotatedLogin = await loginPlayer(rotatedSecret);
    expect(rotatedLogin.statusCode).toBe(200);
    const rotatedSessionToken = responseSessionToken(rotatedLogin);
    const playerRotate = await app.inject({
      method: "POST",
      url: `/api/player-access/${player.grant.id}/rotate`,
      headers: { cookie: cookieHeader(rotatedSessionToken) },
      payload: { actionId: uuid(), revision: player.grant.revision + 1 },
    });
    expect(playerRotate.statusCode).toBe(403);

    const foreignPlayer = await makePlayer(
      foreign.campaign.id,
      "Synthetic foreign lifecycle grant",
      "synthetic-foreign-lifecycle-grant",
    );
    const foreignRotate = await app.inject({
      method: "POST",
      url: `/api/player-access/${player.grant.id}/rotate`,
      headers: { cookie: cookieHeader(foreignGmToken) },
      payload: { actionId: uuid(), revision: player.grant.revision + 1 },
    });
    expect(foreignRotate.statusCode).toBe(404);
    const playerList = await app.inject({
      method: "GET",
      url: "/api/player-access",
      headers: { cookie: cookieHeader(rotatedSessionToken) },
    });
    expect(playerList.statusCode).toBe(403);
    const playerRevoke = await app.inject({
      method: "POST",
      url: `/api/player-access/${player.grant.id}/revoke`,
      headers: { cookie: cookieHeader(rotatedSessionToken) },
      payload: { actionId: uuid() },
    });
    expect(playerRevoke.statusCode).toBe(403);
    const foreignRevoke = await app.inject({
      method: "POST",
      url: `/api/player-access/${player.grant.id}/revoke`,
      headers: { cookie: cookieHeader(foreignGmToken) },
      payload: { actionId: uuid() },
    });
    expect(foreignRevoke.statusCode).toBe(404);

    const revokeDisconnectCountBefore = disconnects.filter(
      (room) => room === memberRoom(player.membership.id),
    ).length;
    const revoke = await app.inject({
      method: "POST",
      url: `/api/player-access/${player.grant.id}/revoke`,
      headers: { cookie: cookieHeader(gmToken) },
      payload: { actionId: uuid() },
    });
    expect(revoke.statusCode, revoke.body).toBe(200);
    const revokeDisconnects = disconnects.filter(
      (room) => room === memberRoom(player.membership.id),
    );
    expect(revokeDisconnects).toHaveLength(revokeDisconnectCountBefore + 1);
    const [foreignGrantAfterRevoke] = await db
      .select()
      .from(playerAccessGrants)
      .where(eq(playerAccessGrants.id, foreignPlayer.grant.id));
    expect(foreignGrantAfterRevoke?.revokedAt).toBeNull();
    expect(await getSession(rotatedSessionToken)).toBeUndefined();
    expect((await loginPlayer(rotatedSecret)).statusCode).toBe(410);
    expect(
      await db
        .select()
        .from(memberships)
        .where(eq(memberships.id, player.membership.id)),
    ).toHaveLength(1);
  });

  it("keeps PLAYER membership own-only, GM membership campaign-scoped and same-campaign chat contacts", async () => {
    const table = await makeCampaign("Synthetic snapshot scope");
    const foreign = await makeCampaign("Synthetic foreign snapshot");
    const own = await makePlayer(
      table.campaign.id,
      "Synthetic own",
      "own-label",
    );
    const sameCampaign = await makePlayer(
      table.campaign.id,
      "Synthetic same-campaign contact",
      "contact-label",
    );
    const otherCampaign = await makePlayer(
      foreign.campaign.id,
      "Synthetic foreign contact",
      "foreign-label",
    );
    const ownLogin = await loginPlayer(own.token);
    expect(ownLogin.statusCode).toBe(200);
    const ownSnapshot = await bootstrap(responseSessionToken(ownLogin));
    expect(ownSnapshot.statusCode).toBe(200);
    expect(ownSnapshot.json().members).toEqual([
      expect.objectContaining({ id: own.membership.id, role: "PLAYER" }),
    ]);
    expect(ownSnapshot.json().directChatContacts).toContainEqual(
      expect.objectContaining({
        membershipId: sameCampaign.membership.id,
        displayName: "Synthetic same-campaign contact",
      }),
    );
    expect(
      ownSnapshot
        .json()
        .directChatContacts.map(
          (contact: { membershipId: string }) => contact.membershipId,
        ),
    ).not.toContain(otherCampaign.membership.id);

    const gmToken = await makeGmSession(table);
    const gmSnapshot = await bootstrap(gmToken);
    expect(gmSnapshot.statusCode).toBe(200);
    const memberIds = gmSnapshot
      .json()
      .members.map((member: { id: string }) => member.id);
    expect(memberIds).toContain(table.gm.id);
    expect(memberIds).toContain(own.membership.id);
    expect(memberIds).toContain(sameCampaign.membership.id);
    expect(memberIds).not.toContain(otherCampaign.membership.id);
    expect(JSON.stringify(gmSnapshot.json())).not.toContain(
      "Synthetic foreign contact",
    );
  });
});

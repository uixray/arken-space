import Fastify from "fastify";
import cookie from "@fastify/cookie";
import { drizzle } from "drizzle-orm/pglite";
import { eq } from "drizzle-orm";
import { expect, it } from "vitest";
import * as schema from "@arken/db";
import { createMigratedPglite } from "../../../tests/helpers/pglite-template.js";
import { provisionHostedAccounts } from "./hosted-account-provisioning.js";
import { registerAccountAuthRoutes } from "./account-auth-routes.js";
import { registerAccountCampaignRoutes } from "./account-campaigns.js";
import { createTestMailKeyring, createTestMailOutbox } from "./account-mail.js";

const id = () => crypto.randomUUID();
const origin = "http://localhost:5173";
it("provisions existing memberships atomically and restricts hosted login to assigned campaigns", async () => {
  const pg = await createMigratedPglite(),
    db = drizzle(pg, { schema }),
    app = Fastify();
  const c1 = id(),
    c2 = id(),
    c3 = id(),
    gm = id(),
    player = id(),
    other = id(),
    character = id();
  const password = "synthetic-alpha-password",
    secondPassword = "synthetic-bravo-password";
  try {
    await db.insert(schema.campaigns).values([
      { id: c1, name: "Synthetic 1" },
      { id: c2, name: "Synthetic 2" },
      { id: c3, name: "Synthetic 3" },
    ]);
    await db.insert(schema.memberships).values([
      { id: gm, campaignId: c1, role: "GM", displayName: "GM" },
      { id: player, campaignId: c2, role: "PLAYER", displayName: "Player" },
      { id: other, campaignId: c3, role: "PLAYER", displayName: "Other" },
    ]);
    await db.insert(schema.characters).values({
      id: character,
      campaignId: c2,
      ownerMembershipId: player,
      name: "Synthetic character",
    });
    const target = [
      { membershipId: gm, campaignId: c1, role: "GM", displayName: "GM" },
      {
        membershipId: player,
        campaignId: c2,
        role: "PLAYER",
        displayName: "Player",
      },
    ];
    await expect(
      provisionHostedAccounts(db as never, [
        {
          login: "alpha",
          password,
          memberships: [target[0], { ...target[1], displayName: "Wrong" }],
        },
      ]),
    ).rejects.toThrow("HOSTED_PROVISION_MEMBERSHIP_CHANGED");
    expect(await db.select().from(schema.users)).toHaveLength(0);
    await expect(
      provisionHostedAccounts(db as never, [
        { login: "alpha", password, memberships: target },
        {
          login: "bravo",
          password,
          memberships: [
            {
              membershipId: other,
              campaignId: c3,
              role: "PLAYER",
              displayName: "Other",
            },
          ],
        },
      ]),
    ).rejects.toThrow("HOSTED_PROVISION_DUPLICATE_PASSWORD");
    expect(await db.select().from(schema.users)).toHaveLength(0);
    const receipt = await provisionHostedAccounts(db as never, [
      { login: "alpha", password, memberships: target },
      {
        login: "bravo",
        password: secondPassword,
        memberships: [
          {
            membershipId: other,
            campaignId: c3,
            role: "PLAYER",
            displayName: "Other",
          },
        ],
      },
    ]);
    expect(receipt.accounts).toHaveLength(2);
    expect(JSON.stringify(receipt)).not.toContain(password);
    const [linked] = await db
      .select()
      .from(schema.characters)
      .where(eq(schema.characters.id, character));
    expect(linked?.ownerMembershipId).toBe(player);
    await expect(
      provisionHostedAccounts(db as never, [
        { login: "alpha", password, memberships: target },
      ]),
    ).rejects.toThrow();
    expect(await db.select().from(schema.users)).toHaveLength(2);
    await app.register(cookie);
    const io = { in: () => ({ disconnectSockets() {} }) };
    const outbox = createTestMailOutbox();
    const options = {
      enabled: true,
      sessionTtlDays: 3,
      cookieSecure: false,
      accountCookieName: "arken_account",
      gameCookieName: "arken_session",
      csrfCookieName: "arken_account_csrf",
      webOrigin: origin,
    };
    registerAccountAuthRoutes(app as never, db as never, io, {
      ...options,
      registrationEnabled: false,
      legacyDevEnabled: false,
      campaignLinkAccessEnabled: false,
      campaignCreationEnabled: true,
      publicUrl: origin,
      mailRuntimeEnabled: false,
      mail: outbox.adapter,
      mailKeyring: createTestMailKeyring(),
    });
    registerAccountCampaignRoutes(app as never, db as never, io, {
      ...options,
      creationEnabled: true,
      creationLimit: 2,
    });
    await app.ready();
    const login = (login: string, secret: string) =>
      app.inject({
        method: "POST",
        url: "/api/account/login",
        headers: { origin },
        payload: { login, password: secret },
      });
    expect((await login("alpha", "synthetic-wrong-password")).statusCode).toBe(
      401,
    );
    const response = await login("alpha", password);
    expect(response.statusCode, response.body).toBe(200);
    expect(response.json().account).toMatchObject({
      identityKind: "HOSTED",
      login: "alpha",
      email: null,
      verified: false,
      passwordChangeRequired: true,
    });
    const cookiesOf = (result: typeof response) => {
      const value = result.headers["set-cookie"],
        values = Array.isArray(value) ? value : value ? [value] : [];
      return values.map((item) => item.split(";")[0]).join("; ");
    };
    let cookies = cookiesOf(response),
      csrf = response.json().csrfToken as string;
    expect(
      (
        await app.inject({
          method: "GET",
          url: "/api/account/campaigns",
          headers: { cookie: cookies },
        })
      ).statusCode,
    ).toBe(401);
    const change = (next: string) =>
      app.inject({
        method: "POST",
        url: "/api/account/password/change",
        headers: { origin, cookie: cookies, "x-csrf-token": csrf },
        payload: { currentPassword: password, newPassword: next },
      });
    expect((await change(password)).statusCode).toBe(400);
    const newPassword = "synthetic-new-password";
    const changed = await change(newPassword);
    expect(changed.statusCode, changed.body).toBe(200);
    expect((await login("alpha", password)).statusCode).toBe(401);
    const renewed = await login("alpha", newPassword);
    expect(renewed.statusCode, renewed.body).toBe(200);
    expect(renewed.json().account.passwordChangeRequired).toBe(false);
    cookies = cookiesOf(renewed);
    csrf = renewed.json().csrfToken as string;
    const listed = await app.inject({
      method: "GET",
      url: "/api/account/campaigns",
      headers: { cookie: cookies },
    });
    expect(listed.statusCode, listed.body).toBe(200);
    expect(
      listed
        .json()
        .campaigns.map((c: { id: string }) => c.id)
        .sort(),
    ).toEqual([c1, c2].sort());
    const select = (campaignId: string) =>
      app.inject({
        method: "POST",
        url: "/api/account/campaigns/select",
        headers: { origin, cookie: cookies, "x-csrf-token": csrf },
        payload: { campaignId },
      });
    expect((await select(c3)).statusCode).toBe(404);
    expect((await select(c1)).statusCode).toBe(200);
    const create = await app.inject({
      method: "POST",
      url: "/api/account/campaigns",
      headers: { origin, cookie: cookies, "x-csrf-token": csrf },
      payload: { name: "Forbidden", idempotencyKey: id() },
    });
    expect(create.statusCode, create.body).toBe(403);
  } finally {
    await app.close();
    await pg.close();
  }
}, 120_000);

it("isolates hosted and local credentials even when login names match", async () => {
  const pg = await createMigratedPglite(),
    db = drizzle(pg, { schema });
  const hosted = Fastify(),
    local = Fastify(),
    instanceId = id(),
    campaignId = id(),
    memberId = id();
  const hostedPassword = "synthetic-hosted-secret",
    localPassword = "synthetic-local-secret";
  try {
    await db
      .insert(schema.campaigns)
      .values({ id: campaignId, name: "Synthetic" });
    await db.insert(schema.memberships).values({
      id: memberId,
      campaignId,
      role: "PLAYER",
      displayName: "Synthetic",
    });
    await provisionHostedAccounts(db as never, [
      {
        login: "same-login",
        password: hostedPassword,
        memberships: [
          {
            membershipId: memberId,
            campaignId,
            role: "PLAYER",
            displayName: "Synthetic",
          },
        ],
      },
    ]);
    const { hashPassword } = await import("./password-security.js");
    await db.insert(schema.users).values({
      identityKind: "LOCAL",
      localInstanceId: instanceId,
      localLogin: "same-login",
      localApprovedAt: new Date(),
      passwordHash: await hashPassword(localPassword),
      emailNormalized: null,
      emailDisplay: null,
      verifiedAt: null,
    });
    const io = { in: () => ({ disconnectSockets() {} }) },
      outbox = createTestMailOutbox();
    const opts = {
      enabled: true,
      registrationEnabled: false,
      legacyDevEnabled: false,
      campaignLinkAccessEnabled: false,
      campaignCreationEnabled: false,
      sessionTtlDays: 3,
      cookieSecure: false,
      accountCookieName: "arken_account",
      gameCookieName: "arken_session",
      csrfCookieName: "arken_account_csrf",
      webOrigin: origin,
      publicUrl: origin,
      mailRuntimeEnabled: false,
      mail: outbox.adapter,
      mailKeyring: createTestMailKeyring(),
    };
    await hosted.register(cookie);
    await local.register(cookie);
    registerAccountAuthRoutes(hosted as never, db as never, io, opts);
    registerAccountAuthRoutes(local as never, db as never, io, {
      ...opts,
      localInstanceId: instanceId,
    });
    await hosted.ready();
    await local.ready();
    const login = (app: typeof hosted, password: string) =>
      app.inject({
        method: "POST",
        url: "/api/account/login",
        headers: { origin },
        payload: { login: "same-login", password },
      });
    expect((await login(hosted, localPassword)).statusCode).toBe(401);
    expect((await login(local, hostedPassword)).statusCode).toBe(401);
    const a = await login(hosted, hostedPassword),
      b = await login(local, localPassword);
    expect(a.statusCode, a.body).toBe(200);
    expect(a.json().account.identityKind).toBe("HOSTED");
    expect(b.statusCode, b.body).toBe(200);
    expect(b.json().account.identityKind).toBe("LOCAL");
  } finally {
    await hosted.close();
    await local.close();
    await pg.close();
  }
}, 120_000);

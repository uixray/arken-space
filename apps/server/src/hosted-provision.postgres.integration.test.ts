import { readdir, readFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import { resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import * as schema from "@arken/db";
import { provisionHostedAccounts } from "./hosted-account-provisioning.js";

const url = process.env.HOSTED_PROVISION_PG_URL;
const suite = url ? describe : describe.skip;
suite("hosted account provisioning on dedicated PostgreSQL", () => {
  let resources: ReturnType<typeof schema.createDatabase>;
  beforeAll(async () => {
    const u = new URL(url!);
    if (
      u.hostname !== "127.0.0.1" ||
      u.port !== "15487" ||
      u.username !== "arkenqa" ||
      !/^\/arken_hosted_qa_[0-9]+$/.test(u.pathname)
    )
      throw new Error("Not the dedicated hosted-account QA database");
    resources = schema.createDatabase(url!);
    const [settings] =
      await resources.client`select current_setting('data_directory') as dir, current_database() as name`;
    if (
      String(settings?.dir).replaceAll("\\", "/").toLowerCase() !==
        "d:/ai/personal/experiments/arken-space/.data/backlog-goal-20261101/pg-lock-qa" ||
      settings?.name !== u.pathname.slice(1)
    )
      throw new Error("Wrong QA cluster");
    const [objects] =
      await resources.client`select count(*)::int as n from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relkind in ('r','p','v','m')`;
    if (objects?.n !== 0) throw new Error("QA database not empty");
    const folder = new URL("../../../packages/db/drizzle/", import.meta.url);
    for (const file of (await readdir(folder))
      .filter((x) => x.endsWith(".sql"))
      .sort()) {
      const source = await readFile(new URL(file, folder), "utf8");
      for (const statement of source
        .split("--> statement-breakpoint")
        .map((x) => x.trim())
        .filter(Boolean))
        await resources.client.unsafe(statement);
    }
  }, 120_000);
  afterAll(async () => {
    await resources?.client.end({ timeout: 2 });
  });
  it("commits at most one account when two operators claim the same membership", async () => {
    const campaignId = crypto.randomUUID(),
      memberId = crypto.randomUUID(),
      characterId = crypto.randomUUID();
    await resources.db
      .insert(schema.campaigns)
      .values({ id: campaignId, name: "Synthetic" });
    await resources.db
      .insert(schema.memberships)
      .values({
        id: memberId,
        campaignId,
        role: "PLAYER",
        displayName: "Synthetic",
      });
    await resources.db
      .insert(schema.characters)
      .values({
        id: characterId,
        campaignId,
        ownerMembershipId: memberId,
        name: "Synthetic",
      });
    const spec = {
      membershipId: memberId,
      campaignId,
      role: "PLAYER" as const,
      displayName: "Synthetic",
    };
    let locked!: () => void, release!: () => void;
    const ready = new Promise<void>((resolve) => {
      locked = resolve;
    });
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const holder = resources.client.begin(async (sql) => {
      await sql`select id from memberships where id=${memberId} for update`;
      locked();
      await gate;
    });
    await ready;
    const run = (login: string) =>
      provisionHostedAccounts(resources.db, [
        { login, password: "synthetic-account-password", memberships: [spec] },
      ]).then(
        (value) => ({ ok: true as const, value }),
        () => ({ ok: false as const }),
      );
    const a = run("qa-alpha"),
      b = run("qa-bravo");
    try {
      let waiting = 0;
      for (let i = 0; i < 200 && waiting < 2; i++) {
        const [row] =
          await resources.client`select count(*)::int as n from pg_stat_activity where datname=current_database() and wait_event_type='Lock'`;
        waiting = Number(row?.n);
        if (waiting < 2)
          await new Promise((resolve) => setTimeout(resolve, 50));
      }
      expect(waiting).toBeGreaterThanOrEqual(2);
    } finally {
      release();
    }
    await holder;
    const results = await Promise.all([a, b]);
    expect(results.filter((r) => r.ok)).toHaveLength(1);
    const users = await resources.db.select().from(schema.users);
    expect(users).toHaveLength(1);
    const [member] = await resources.db
      .select()
      .from(schema.memberships)
      .where(eq(schema.memberships.id, memberId));
    const [character] = await resources.db
      .select()
      .from(schema.characters)
      .where(eq(schema.characters.id, characterId));
    expect(member?.userId).toBe(users[0]!.id);
    expect(member?.role).toBe("PLAYER");
    expect(character?.ownerMembershipId).toBe(memberId);
  }, 60_000);
  it("runs the built guarded operator command without emitting temporary secrets", async () => {
    const campaignId = crypto.randomUUID(),
      memberId = crypto.randomUUID(),
      password = "synthetic-cli-temporary";
    await resources.db
      .insert(schema.campaigns)
      .values({ id: campaignId, name: "Synthetic CLI" });
    await resources.db
      .insert(schema.memberships)
      .values({
        id: memberId,
        campaignId,
        role: "PLAYER",
        displayName: "Synthetic CLI",
      });
    const input = [
      {
        login: "qa-cli",
        password,
        memberships: [
          {
            membershipId: memberId,
            campaignId,
            role: "PLAYER",
            displayName: "Synthetic CLI",
          },
        ],
      },
    ];
    const command = (expectedHost: string) =>
      new Promise<{ code: number | null; output: string }>((done, reject) => {
        const child = spawn(
          process.execPath,
          [resolve("apps/server/dist/hosted-account-provision-cli.js")],
          {
            env: {
              ...process.env,
              DATABASE_URL: url!,
              DEPLOYMENT_MODE: "HOSTED",
              ARKEN_HOSTED_PROVISION_CONFIRM:
                "reviewed-memberships-and-private-input",
              ARKEN_PROVISION_EXPECTED_HOST: expectedHost,
              ARKEN_PROVISION_EXPECTED_DATABASE: new URL(url!).pathname.slice(
                1,
              ),
            },
            stdio: ["pipe", "pipe", "pipe"],
            windowsHide: true,
          },
        );
        let output = "";
        child.stdout.on("data", (chunk) => {
          output += String(chunk);
        });
        child.stderr.on("data", (chunk) => {
          output += String(chunk);
        });
        child.on("error", reject);
        child.on("close", (code) => done({ code, output }));
        child.stdin.end(JSON.stringify(input));
      });
    const denied = await command("wrong-host");
    expect(denied.code).toBe(1);
    expect(denied.output).not.toContain(password);
    const [before] = await resources.db
      .select()
      .from(schema.memberships)
      .where(eq(schema.memberships.id, memberId));
    expect(before?.userId).toBeNull();
    const result = await command("127.0.0.1");
    expect(result.code, result.output).toBe(0);
    expect(result.output).toContain("Provisioned 1 accounts.");
    expect(result.output).not.toContain(password);
    const [member] = await resources.db
      .select()
      .from(schema.memberships)
      .where(eq(schema.memberships.id, memberId));
    const [user] = await resources.db
      .select()
      .from(schema.users)
      .where(eq(schema.users.id, member!.userId!));
    expect(user).toMatchObject({
      identityKind: "HOSTED",
      passwordChangeRequired: true,
      verifiedAt: null,
    });
    expect(user?.passwordHash).not.toContain(password);
  }, 60_000);
});

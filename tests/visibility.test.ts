import { readdir, readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import * as schema from "../packages/db/src/schema.js";
import { editableToken } from "../apps/server/src/realtime.js";
import { buildSnapshot } from "../apps/server/src/snapshot.js";

const ids = {
  campaign: "00000000-0000-4000-8000-000000000001",
  gm: "00000000-0000-4000-8000-000000000002",
  player: "00000000-0000-4000-8000-000000000003",
  otherPlayer: "00000000-0000-4000-8000-000000000004",
  activeScene: "00000000-0000-4000-8000-000000000005",
  closedScene: "00000000-0000-4000-8000-000000000006",
  playerCharacter: "00000000-0000-4000-8000-000000000007",
  otherCharacter: "00000000-0000-4000-8000-000000000008",
  publicToken: "00000000-0000-4000-8000-000000000009",
  hiddenToken: "00000000-0000-4000-8000-000000000010",
  closedToken: "00000000-0000-4000-8000-000000000011",
  publicMessage: "00000000-0000-4000-8000-000000000012",
  gmMessage: "00000000-0000-4000-8000-000000000013",
  ownGmMessage: "00000000-0000-4000-8000-000000000014",
  publicAsset: "00000000-0000-4000-8000-000000000015",
  hiddenAsset: "00000000-0000-4000-8000-000000000016",
};

let database: PGlite;

beforeEach(async () => {
  database = new PGlite();
  const migrationsUrl = new URL("../packages/db/drizzle/", import.meta.url);
  for (const file of (await readdir(migrationsUrl))
    .filter((name) => name.endsWith(".sql"))
    .sort()) {
    const sql = (
      await readFile(new URL(file, migrationsUrl), "utf8")
    ).replaceAll("--> statement-breakpoint", "");
    await database.exec(sql);
  }
  await database.exec(`
    insert into campaigns (id, name, active_scene_id) values ('${ids.campaign}', 'Test', null);
    insert into memberships (id, campaign_id, role, display_name) values
      ('${ids.gm}', '${ids.campaign}', 'GM', 'GM'),
      ('${ids.player}', '${ids.campaign}', 'PLAYER', 'Player'),
      ('${ids.otherPlayer}', '${ids.campaign}', 'PLAYER', 'Other');
    insert into assets (id, campaign_id, uploaded_by_membership_id, kind, name, storage_key, mime_type, size_bytes) values
      ('${ids.publicAsset}', '${ids.campaign}', '${ids.gm}', 'TOKEN', 'Public', 'public.webp', 'image/webp', 10),
      ('${ids.hiddenAsset}', '${ids.campaign}', '${ids.gm}', 'TOKEN', 'Secret', 'secret.webp', 'image/webp', 10);
    insert into characters (id, campaign_id, owner_membership_id, name, stats, skills, spells, notes) values
      ('${ids.playerCharacter}', '${ids.campaign}', '${ids.player}', 'Player character', '{}', '[]', '[]', 'player notes'),
      ('${ids.otherCharacter}', '${ids.campaign}', '${ids.otherPlayer}', 'Other character', '{}', '[]', '[]', 'secret notes');
    insert into scenes (id, campaign_id, name, grid) values
      ('${ids.activeScene}', '${ids.campaign}', 'Active', '{"enabled":true,"size":64,"offsetX":0,"offsetY":0,"color":"#fff","opacity":0.2}'),
      ('${ids.closedScene}', '${ids.campaign}', 'Closed', '{"enabled":true,"size":64,"offsetX":0,"offsetY":0,"color":"#fff","opacity":0.2}');
    update campaigns set active_scene_id = '${ids.activeScene}' where id = '${ids.campaign}';
    insert into tokens (id, scene_id, owner_membership_id, asset_id, name, x, y, visible) values
      ('${ids.publicToken}', '${ids.activeScene}', '${ids.player}', '${ids.publicAsset}', 'Public', 1, 1, true),
      ('${ids.hiddenToken}', '${ids.activeScene}', '${ids.gm}', '${ids.hiddenAsset}', 'Hidden', 2, 2, false),
      ('${ids.closedToken}', '${ids.closedScene}', '${ids.gm}', '${ids.hiddenAsset}', 'Closed', 3, 3, true);
    insert into chat_messages (id, campaign_id, membership_id, visibility, body) values
      ('${ids.publicMessage}', '${ids.campaign}', '${ids.gm}', 'PUBLIC', 'public'),
      ('${ids.gmMessage}', '${ids.campaign}', '${ids.gm}', 'GM_ONLY', 'gm secret'),
      ('${ids.ownGmMessage}', '${ids.campaign}', '${ids.player}', 'GM_ONLY', 'own secret');
  `);
});

afterEach(async () => {
  await database.close();
});

describe("role-filtered snapshots", () => {
  it("does not expose GM state to a player", async () => {
    const db = drizzle(database, { schema });
    const snapshot = await buildSnapshot(db as never, {
      membershipId: ids.player,
      campaignId: ids.campaign,
      role: "PLAYER",
      displayName: "Player",
    });

    expect(snapshot.scenes.map((item) => item.id)).toEqual([ids.activeScene]);
    expect(snapshot.tokens.map((item) => item.id)).toEqual([ids.publicToken]);
    expect(snapshot.characters.map((item) => item.id)).toEqual([
      ids.playerCharacter,
    ]);
    expect(new Set(snapshot.messages.map((item) => item.id))).toEqual(
      new Set([ids.publicMessage, ids.ownGmMessage]),
    );
    expect(snapshot.assets.map((item) => item.id)).toEqual([ids.publicAsset]);
    expect(JSON.stringify(snapshot)).not.toContain("secret notes");
    expect(JSON.stringify(snapshot)).not.toContain("gm secret");
  });

  it("keeps complete campaign state available to the GM", async () => {
    const db = drizzle(database, { schema });
    const snapshot = await buildSnapshot(db as never, {
      membershipId: ids.gm,
      campaignId: ids.campaign,
      role: "GM",
      displayName: "GM",
    });

    expect(snapshot.scenes).toHaveLength(2);
    expect(snapshot.tokens).toHaveLength(3);
    expect(snapshot.characters).toHaveLength(2);
    expect(snapshot.messages).toHaveLength(3);
    expect(snapshot.assets).toHaveLength(2);
  });
});

describe("direct realtime token authorization", () => {
  it("allows a player to move only their visible token on the active scene", async () => {
    const db = drizzle(database, { schema });
    const auth = {
      membershipId: ids.player,
      campaignId: ids.campaign,
      role: "PLAYER" as const,
      displayName: "Player",
    };

    await expect(
      editableToken(db as never, auth, ids.publicToken),
    ).resolves.toMatchObject({
      id: ids.publicToken,
    });
    await expect(
      editableToken(db as never, auth, ids.hiddenToken),
    ).resolves.toBeNull();
    await expect(
      editableToken(db as never, auth, ids.closedToken),
    ).resolves.toBeNull();
  });

  it("allows the GM to operate hidden and inactive-scene tokens", async () => {
    const db = drizzle(database, { schema });
    const auth = {
      membershipId: ids.gm,
      campaignId: ids.campaign,
      role: "GM" as const,
      displayName: "GM",
    };

    await expect(
      editableToken(db as never, auth, ids.hiddenToken),
    ).resolves.toMatchObject({
      id: ids.hiddenToken,
    });
    await expect(
      editableToken(db as never, auth, ids.closedToken),
    ).resolves.toMatchObject({
      id: ids.closedToken,
    });
  });

  it("keeps a GM-layer placement inaccessible even to its player controller", async () => {
    const db = drizzle(database, { schema });
    await db
      .update(schema.tokens)
      .set({ layer: "GM" })
      .where(eq(schema.tokens.id, ids.publicToken));
    const player = {
      membershipId: ids.player,
      campaignId: ids.campaign,
      role: "PLAYER" as const,
      displayName: "Player",
    };
    const gm = {
      membershipId: ids.gm,
      campaignId: ids.campaign,
      role: "GM" as const,
      displayName: "GM",
    };
    await expect(
      editableToken(db as never, player, ids.publicToken),
    ).resolves.toBeNull();
    await expect(
      editableToken(db as never, gm, ids.publicToken),
    ).resolves.toMatchObject({ id: ids.publicToken, layer: "GM" });
    const snapshot = await buildSnapshot(db as never, player);
    expect(snapshot.tokens.some((token) => token.id === ids.publicToken)).toBe(
      false,
    );
  });
});

import { readdir, readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import * as schema from "../../../packages/db/src/schema.js";
import { buildSnapshot } from "./snapshot.js";

/**
 * UIX-454 — публичная личность персонажа в снапшоте.
 *
 * До неё игрок получал только своих персонажей, и чужой бросок подписывался
 * словом «Персонаж». Расширение видимости узкое и намеренное: имя и портрет
 * тех, у кого есть владелец или управляющий, — и ничего сверх.
 */
const ids = {
  campaign: crypto.randomUUID(),
  gm: crypto.randomUUID(),
  player: crypto.randomUUID(),
  other: crypto.randomUUID(),
  mine: crypto.randomUUID(),
  theirs: crypto.randomUUID(),
  npc: crypto.randomUUID(),
  portrait: crypto.randomUUID(),
  npcPortrait: crypto.randomUUID(),
};

let database: PGlite;
let db: ReturnType<typeof drizzle<typeof schema>>;

const snapshotFor = (membershipId: string, role: "GM" | "PLAYER") =>
  buildSnapshot(
    db as never,
    {
      membershipId,
      campaignId: ids.campaign,
      role,
      displayName: role === "GM" ? "Мастер" : "Игрок",
    } as never,
  );

beforeEach(async () => {
  database = new PGlite();
  const migrations = new URL("../../../packages/db/drizzle/", import.meta.url);
  for (const file of (await readdir(migrations))
    .filter((name) => name.endsWith(".sql"))
    .sort())
    await database.exec(
      (await readFile(new URL(file, migrations), "utf8")).replaceAll(
        "--> statement-breakpoint",
        "",
      ),
    );
  db = drizzle(database, { schema });
  await db
    .insert(schema.campaigns)
    .values({ id: ids.campaign, name: "Кампания" });
  await db.insert(schema.memberships).values([
    {
      id: ids.gm,
      campaignId: ids.campaign,
      role: "GM",
      displayName: "Мастер",
    },
    {
      id: ids.player,
      campaignId: ids.campaign,
      role: "PLAYER",
      displayName: "Игрок",
    },
    {
      id: ids.other,
      campaignId: ids.campaign,
      role: "PLAYER",
      displayName: "Сосед",
    },
  ]);
  await db.insert(schema.assets).values([
    {
      id: ids.portrait,
      campaignId: ids.campaign,
      kind: "PORTRAIT",
      storageKey: "portrait-theirs",
      mimeType: "image/webp",
      name: "Портрет",
      sizeBytes: 100,
      uploadedByMembershipId: ids.other,
    },
    {
      id: ids.npcPortrait,
      campaignId: ids.campaign,
      kind: "PORTRAIT",
      storageKey: "portrait-npc",
      mimeType: "image/webp",
      name: "Портрет",
      sizeBytes: 100,
      uploadedByMembershipId: ids.gm,
    },
  ]);
  await db.insert(schema.characters).values([
    {
      id: ids.mine,
      campaignId: ids.campaign,
      name: "Ллойд",
      ownerMembershipId: ids.player,
    },
    {
      id: ids.theirs,
      campaignId: ids.campaign,
      name: "Шейла",
      ownerMembershipId: ids.other,
      portraitAssetId: ids.portrait,
    },
    {
      id: ids.npc,
      campaignId: ids.campaign,
      name: "Лучник в кустах",
      portraitAssetId: ids.npcPortrait,
    },
  ]);
});

afterEach(async () => {
  await database.close();
});

describe("публичная личность персонажа", () => {
  it("даёт игроку имя и портрет чужого персонажа за столом", async () => {
    // Ради этого всё и делалось: у чужого броска должен быть аватар, а не
    // плашка со словом «Персонаж».
    const snapshot = await snapshotFor(ids.player, "PLAYER");
    expect(
      snapshot.characterIdentities.find((item) => item.id === ids.theirs),
    ).toMatchObject({ name: "Шейла", portraitAssetId: ids.portrait });
  });

  it("не отдаёт NPC мастера, у которого нет управляющего", async () => {
    // Бросок за скрытого «Лучника в кустах» подписан именем мастера — как и
    // был. Иначе панель раскрывала бы состав засады именами.
    const snapshot = await snapshotFor(ids.player, "PLAYER");
    expect(
      snapshot.characterIdentities.some((item) => item.id === ids.npc),
    ).toBe(false);
    expect(JSON.stringify(snapshot.characterIdentities)).not.toContain(
      "Лучник",
    );
  });

  it("не превращается в карточку чужого персонажа", async () => {
    // Ровно четыре поля: три прежних и миниатюра токена, добавленная по
    // решению мастера в UIX-467. Любое пятое — уже утечка характеристик,
    // ресурсов или заметок, которые фильтр `visibleCharacters` держит
    // закрытыми. Список остаётся точным, а не «содержит хотя бы».
    const snapshot = await snapshotFor(ids.player, "PLAYER");
    const theirs = snapshot.characterIdentities.find(
      (item) => item.id === ids.theirs,
    );
    expect(Object.keys(theirs ?? {}).sort()).toEqual([
      "id",
      "name",
      "portraitAssetId",
      "tokenAssetId",
    ]);
    expect(snapshot.characters.some((item) => item.id === ids.theirs)).toBe(
      false,
    );
  });

  it("пропускает портрет чужого персонажа в видимые ассеты", async () => {
    // Без этого аватар пришёл бы идентификатором, который игроку нечем
    // загрузить: сам портрет остался бы за фильтром ассетов.
    const snapshot = await snapshotFor(ids.player, "PLAYER");
    expect(snapshot.assets.some((asset) => asset.id === ids.portrait)).toBe(
      true,
    );
    expect(snapshot.assets.some((asset) => asset.id === ids.npcPortrait)).toBe(
      false,
    );
  });

  it("мастеру отдаёт тех же, кого и игроку", async () => {
    // Набор описывает «кто за столом», а не «что мне видно»: он не должен
    // расходиться по ролям, иначе подпись броска у мастера и игрока разная.
    const gm = await snapshotFor(ids.gm, "GM");
    expect(gm.characterIdentities.map((item) => item.name).sort()).toEqual([
      "Ллойд",
      "Шейла",
    ]);
  });
});

import { readdir, readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import * as schema from "../packages/db/src/schema.js";
import { editableToken } from "../apps/server/src/realtime.js";
import {
  buildSnapshot,
  loadCampaignReadSet,
  SNAPSHOT_MESSAGES_PER_THREAD,
} from "../apps/server/src/snapshot.js";

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

beforeAll(async () => {
  database = new PGlite();
  const migrationsUrl = new URL("../packages/db/drizzle/", import.meta.url);
  const migrations = (await readdir(migrationsUrl))
    .filter((name) => name.endsWith(".sql"))
    .sort();
  // Only 0009's backfill is skipped (expensive, and migration.test.ts already
  // covers it) — every other migration runs in its real numeric order so
  // later migrations can depend on schema objects (indexes, columns) that
  // earlier ones created, exactly like a real deployment. A previous version
  // of this fixture additionally deferred 0017-0021 to run last "for no
  // documented reason beyond 0009", which broke once 0029/0030 added
  // composite foreign keys to a unique index that 0017 creates — those FKs
  // ran (alphabetically) before 0017 did. Keep 0009 as the only special case.
  const preBackfill = migrations.filter((file) => file < "0009_");
  const postBackfill = migrations.filter(
    (file) => !file.startsWith("0009_") && file > "0009_",
  );
  for (const file of preBackfill) {
    const sql = (
      await readFile(new URL(file, migrationsUrl), "utf8")
    ).replaceAll("--> statement-breakpoint", "");
    await database.exec(sql);
  }
  // The production 0009 backfill is covered by migration.test.ts. Visibility
  // fixtures start empty, so use the equivalent final column shape without
  // repeatedly running the expensive PGlite backfill procedure.
  await database.exec(`
    alter table chat_messages add column sequence bigint not null;
    create unique index chat_sequence_idx on chat_messages (sequence);
    create index chat_campaign_sequence_idx on chat_messages (campaign_id, sequence);
  `);
  for (const file of postBackfill) {
    const sql = (
      await readFile(new URL(file, migrationsUrl), "utf8")
    ).replaceAll("--> statement-breakpoint", "");
    await database.exec(sql);
  }
});

beforeEach(async () => {
  await database.exec(`
    update campaigns set active_scene_id = null;
    delete from chat_messages;
    delete from tokens;
    delete from characters;
    delete from assets;
    delete from scenes;
    delete from memberships;
    delete from campaigns;
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
    insert into chat_messages (id, campaign_id, membership_id, visibility, body, sequence) values
      ('${ids.publicMessage}', '${ids.campaign}', '${ids.gm}', 'PUBLIC', 'public', 1),
      ('${ids.gmMessage}', '${ids.campaign}', '${ids.gm}', 'GM_ONLY', 'gm secret', 2),
      ('${ids.ownGmMessage}', '${ids.campaign}', '${ids.player}', 'GM_ONLY', 'own secret', 3);
  `);
});

afterAll(async () => {
  await database.close();
});

describe("role-filtered snapshots", () => {
  it("keeps malformed stored dice history readable", async () => {
    await database.exec(`
      update chat_messages
      set kind = 'DICE', dice = '{"total":20}'
      where id = '${ids.publicMessage}';
    `);
    const db = drizzle(database, { schema });
    const snapshot = await buildSnapshot(db as never, {
      membershipId: ids.player,
      campaignId: ids.campaign,
      role: "PLAYER",
      displayName: "Player",
    });

    expect(snapshot.messages).toContainEqual(
      expect.objectContaining({
        id: ids.publicMessage,
        kind: "DICE",
        dice: null,
      }),
    );
  });

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

  it("shows PUBLIC STORY to players but keeps legacy GM_ONLY hidden", async () => {
    await database.exec(`
      insert into chat_messages (campaign_id,membership_id,thread_id,visibility,body,sequence)
      select '${ids.campaign}','${ids.gm}',id,'PUBLIC','public story',10
      from chat_threads where campaign_id='${ids.campaign}' and stream='STORY';
      insert into chat_messages (campaign_id,membership_id,thread_id,visibility,body,sequence)
      select '${ids.campaign}','${ids.gm}',id,'GM_ONLY','secret story',11
      from chat_threads where campaign_id='${ids.campaign}' and stream='STORY';
    `);
    const db = drizzle(database, { schema });
    const snapshot = await buildSnapshot(db as never, {
      membershipId: ids.player,
      campaignId: ids.campaign,
      role: "PLAYER",
      displayName: "Player",
    });

    expect(snapshot.chatThreads.map((thread) => thread.stream)).toContain(
      "STORY",
    );
    expect(snapshot.messages.map((message) => message.body)).toContain(
      "public story",
    );
    expect(snapshot.messages.map((message) => message.body)).not.toContain(
      "secret story",
    );
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

  it("везёт последние сообщения потока, а не всю историю", async () => {
    await database.exec(`
      delete from chat_messages where campaign_id = '${ids.campaign}';
      insert into chat_messages (campaign_id,membership_id,thread_id,visibility,body,created_at,sequence)
      select '${ids.campaign}','${ids.gm}',thread.id,'PUBLIC','table-' || value,'2026-01-01T00:00:00Z',value
      from generate_series(1, 202) value
      cross join chat_threads thread
      where thread.campaign_id='${ids.campaign}' and thread.stream='TABLE';
      insert into chat_messages (campaign_id,membership_id,thread_id,visibility,body,created_at,sequence)
      select '${ids.campaign}','${ids.gm}',thread.id,'PUBLIC','story-' || value,'2026-01-01T00:00:00Z',1000 + value
      from generate_series(1, 202) value
      cross join chat_threads thread
      where thread.campaign_id='${ids.campaign}' and thread.stream='STORY';
    `);
    const db = drizzle(database, { schema });
    const snapshot = await buildSnapshot(db as never, {
      membershipId: ids.player,
      campaignId: ids.campaign,
      role: "PLAYER",
      displayName: "Player",
    });
    const table = snapshot.messages.filter(
      (message) => message.stream === "TABLE",
    );
    const story = snapshot.messages.filter(
      (message) => message.stream === "STORY",
    );
    // UIX-450: было 200 на поток, и это давало две трети трафика рассылки —
    // 1 726 КБ из 2 580 на боевых данных. Теперь последние 20, остальное
    // подгружается маршрутом истории.
    expect(table).toHaveLength(SNAPSHOT_MESSAGES_PER_THREAD);
    expect(story).toHaveLength(SNAPSHOT_MESSAGES_PER_THREAD);
    // Именно **последние**: обрезка с того конца сделала бы ленту при
    // подключении показывающей начало кампании вместо того, что происходит.
    expect(table.at(-1)?.body).toBe("table-202");
    expect(story.at(-1)?.body).toBe("story-202");
    expect(table[0]?.body).toBe("table-183");
    expect(
      snapshot.chatThreadStates.find((state) => state.stream === "TABLE"),
    ).toMatchObject({ latestSequence: 202, unreadCount: 202 });
    expect(
      snapshot.chatThreadStates.find((state) => state.stream === "STORY"),
    ).toMatchObject({ latestSequence: 1202, unreadCount: 202 });
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

/**
 * UIX-408/409, этап 1. Эти тесты пишутся **до** оптимизации рассылки и обязаны
 * быть зелёными сразу: тест, написанный после, — это тест, подогнанный под
 * поведение, которое он должен был проверять.
 *
 * Прикрывают они ровно ту дыру, из-за которой формулировка «строить снапшот
 * один раз на роль» опасна: у двух игроков одной роли снапшоты различаются
 * четырнадцатью полями верхнего уровня, а единственная перекрёстная проверка
 * живёт в мультиплеерном прогоне под Docker — то есть любая реализация «одного
 * снапшота на роль» прошла бы весь быстрый набор зелёной.
 */
const snapshotFor = (
  db: ReturnType<typeof drizzle<typeof schema>>,
  membershipId: string,
  role: "GM" | "PLAYER",
) =>
  buildSnapshot(db as never, {
    membershipId,
    campaignId: ids.campaign,
    role,
    displayName: role,
  });

describe("снапшоты двух игроков не смешиваются", () => {
  it("не отдаёт игроку ничего, принадлежащего другому игроку", async () => {
    const db = drizzle(database, { schema });
    const mine = await snapshotFor(db, ids.player, "PLAYER");
    const theirs = await snapshotFor(db, ids.otherPlayer, "PLAYER");

    expect(mine.me.id).toBe(ids.player);
    expect(theirs.me.id).toBe(ids.otherPlayer);

    // Карточка чужого игрока не приезжает: в его заметках лежит «secret
    // notes», и это ровно то, что проверяет мультиплеерный прогон — только
    // здесь оно проверяется за секунды.
    expect(mine.characters.map((character) => character.id)).toEqual([
      ids.playerCharacter,
    ]);
    expect(JSON.stringify(mine)).not.toContain("secret notes");

    // И симметрично: правка, «случайно» отдающая всё всем, обязана уронить обе
    // стороны, а не одну.
    expect(theirs.characters.map((character) => character.id)).toEqual([
      ids.otherCharacter,
    ]);
    expect(JSON.stringify(theirs)).not.toContain("player notes");

    /**
     * UIX-454: идентификатор чужого персонажа теперь появляется — но ровно в
     * одном месте и ровно тремя полями. Прежняя проверка «не встречается
     * нигде» стала неверной, поэтому она не ослаблена, а заменена на точную:
     * где именно позволено, и что там лежит.
     *
     * Мастер решил показывать аватары бросающих; всё остальное о чужом
     * персонаже остаётся закрытым, и это здесь и закреплено.
     */
    const identity = mine.characterIdentities.find(
      (item) => item.id === ids.otherCharacter,
    );
    expect(Object.keys(identity ?? {}).sort()).toEqual([
      "id",
      "name",
      "portraitAssetId",
      "tokenAssetId",
    ]);
    const withoutIdentities = JSON.stringify({
      ...mine,
      characterIdentities: [],
    });
    expect(withoutIdentities).not.toContain(ids.otherCharacter);
  });

  it("схлопывает списки участников каждому под себя", async () => {
    const db = drizzle(database, { schema });
    const mine = await snapshotFor(db, ids.player, "PLAYER");
    const theirs = await snapshotFor(db, ids.otherPlayer, "PLAYER");

    // `members` игроку — только он сам, а `directChatContacts` — «все, кроме
    // меня». У двух игроков одной роли эти списки разные, и общий снапшот
    // выдал бы каждому чужой.
    expect(mine.members.map((member) => member.id)).toEqual([ids.player]);
    expect(theirs.members.map((member) => member.id)).toEqual([
      ids.otherPlayer,
    ]);
    expect(
      mine.directChatContacts.map((contact) => contact.membershipId),
    ).not.toContain(ids.player);
    expect(
      theirs.directChatContacts.map((contact) => contact.membershipId),
    ).not.toContain(ids.otherPlayer);
  });

  it("не отдаёт чужое приватное сообщение мастеру", async () => {
    const db = drizzle(database, { schema });
    const mine = await snapshotFor(db, ids.player, "PLAYER");
    const theirs = await snapshotFor(db, ids.otherPlayer, "PLAYER");

    // «own secret» написал первый игрок в режиме «только мастеру». Второй
    // игрок не должен видеть его никогда.
    expect(JSON.stringify(mine)).toContain("own secret");
    expect(JSON.stringify(theirs)).not.toContain("own secret");
  });
});

describe("туман и рисунки в снапшоте", () => {
  const activeFog = "00000000-0000-4000-8000-000000000101";
  const closedFog = "00000000-0000-4000-8000-000000000102";
  const activeDrawing = "00000000-0000-4000-8000-000000000201";
  const closedDrawing = "00000000-0000-4000-8000-000000000202";

  beforeEach(async () => {
    await database.exec(`
      delete from drawings;
      delete from fog_reveals;
      insert into fog_reveals (id, scene_id, x, y, width, height, geometry, bbox, sequence) values
        ('${activeFog}', '${ids.activeScene}', 0, 0, 10, 10,
         '{"type":"RECT","x":0,"y":0,"width":10,"height":10}',
         '{"x":0,"y":0,"width":10,"height":10}', 1),
        ('${closedFog}', '${ids.closedScene}', 0, 0, 10, 10,
         '{"type":"RECT","x":0,"y":0,"width":10,"height":10}',
         '{"x":0,"y":0,"width":10,"height":10}', 2);
      insert into drawings (id, scene_id, author_membership_id, points) values
        ('${activeDrawing}', '${ids.activeScene}', '${ids.gm}', '[0,0,10,10]'),
        ('${closedDrawing}', '${ids.closedScene}', '${ids.gm}', '[20,20,30,30]');
    `);
  });

  it("игроку приезжают туман и рисунки только активной сцены", async () => {
    // Покрытия у тумана в снапшоте не было вовсе, а сужение выборки — ровно то,
    // что делает следующий этап. Без этого теста регрессию поймал бы только
    // Docker-прогон.
    const db = drizzle(database, { schema });
    const snapshot = await snapshotFor(db, ids.player, "PLAYER");
    expect(snapshot.fogReveals.map((fog) => fog.id)).toEqual([activeFog]);
    expect(snapshot.drawings.map((drawing) => drawing.id)).toEqual([
      activeDrawing,
    ]);
  });

  it("мастеру без просматриваемой сцены — тоже только активная", async () => {
    // UIX-408: раньше сюда приезжал туман всех шести сцен, и лишнее
    // отсеивалось уже в DTO. На боевых данных это 270 записей тумана и 114
    // рисунков, читаемых на каждый из семи сокетов при каждом действии.
    const db = drizzle(database, { schema });
    const snapshot = await snapshotFor(db, ids.gm, "GM");
    expect(snapshot.fogReveals.map((fog) => fog.id)).toEqual([activeFog]);
    expect(snapshot.drawings.map((drawing) => drawing.id)).toEqual([
      activeDrawing,
    ]);
  });

  it("мастеру с просматриваемой сценой — обе", async () => {
    // Мастер готовит сцену, не переключая игроков. Без её тумана он рисовал бы
    // поверх якобы пустой сцены, а ключ подгрузки истории отмен считался бы по
    // пустым массивам.
    const db = drizzle(database, { schema });
    const snapshot = await buildSnapshot(
      db as never,
      {
        membershipId: ids.gm,
        campaignId: ids.campaign,
        role: "GM",
        displayName: "GM",
      },
      [ids.closedScene],
    );
    expect(snapshot.fogReveals.map((fog) => fog.id).sort()).toEqual(
      [activeFog, closedFog].sort(),
    );
    expect(snapshot.drawings.map((drawing) => drawing.id).sort()).toEqual(
      [activeDrawing, closedDrawing].sort(),
    );
  });

  it("не отдаёт игроку канвас сцены, которую он якобы рассматривает", async () => {
    // Список дополнительных сцен приходит с сокета, и принять его от игрока
    // значило бы дать способ запросить туман закрытой сцены.
    //
    // Проверяется здесь **исход**, а не конкретная защита: их две. Выборка
    // сужается по роли, и независимо от неё DTO отсеивает всё, чего нет в
    // `visibleSceneIds`. Снятие любой одной этот тест не роняет — проверено
    // диверсией, — и это осознанная избыточность на границе приватности, а не
    // недосмотр. Роняет его только снятие обеих.
    const db = drizzle(database, { schema });
    const snapshot = await buildSnapshot(
      db as never,
      {
        membershipId: ids.player,
        campaignId: ids.campaign,
        role: "PLAYER",
        displayName: "Player",
      },
      [ids.closedScene],
    );
    expect(snapshot.fogReveals.map((fog) => fog.id)).toEqual([activeFog]);
    expect(snapshot.drawings.map((drawing) => drawing.id)).toEqual([
      activeDrawing,
    ]);
  });
});

/**
 * UIX-409, замки безопасности. Оптимизация рассылки строит семь снапшотов из
 * одного набора кампанийных чтений, и цена ошибки здесь несимметрична: неверные
 * данные заметят и починят, а чужой лист персонажа в чужом браузере можно не
 * заметить годами.
 */
describe("общий набор чтений кампании", () => {
  it("даёт ту же проекцию, что и чтение на месте", async () => {
    // Формальное доказательство, что оптимизация ничего не поменяла: для всех
    // трёх ролей-персон результат совпадает с точностью до времени ответа.
    const db = drizzle(database, { schema });
    const readSet = await loadCampaignReadSet(db as never, ids.campaign);
    for (const [membershipId, role] of [
      [ids.gm, "GM"],
      [ids.player, "PLAYER"],
      [ids.otherPlayer, "PLAYER"],
    ] as const) {
      const auth = {
        membershipId,
        campaignId: ids.campaign,
        role,
        displayName: role,
      };
      const alone = await buildSnapshot(db as never, auth);
      const shared = await buildSnapshot(db as never, auth, [], readSet);
      for (const key of Object.keys(alone) as (keyof typeof alone)[]) {
        // `serverTime` — момент ответа, `audio.updatedAt` — метка строки,
        // которую путь чтения трогает сам (нормализация дедлайнов пишет в БД).
        // Оба — время, а не проекция; сравнивать их между двумя
        // последовательными сборками значит сравнивать часы.
        if (key === "serverTime" || key === "audio") continue;
        expect({ [key]: shared[key] }, `${role} ${String(key)}`).toEqual({
          [key]: alone[key],
        });
      }
      expect(
        { ...shared.audio, updatedAt: "" },
        `${role} audio без метки времени`,
      ).toEqual({ ...alone.audio, updatedAt: "" });
    }
  });

  it("не даёт применить набор одной кампании к другой", async () => {
    // Межкампанийное переиспользование не должно происходить молча: набор
    // помнит свою кампанию, а сверка — единственное, что стоит между ошибкой
    // вызова и чужими данными в чужом браузере.
    const db = drizzle(database, { schema });
    const readSet = await loadCampaignReadSet(db as never, ids.campaign);
    await expect(
      buildSnapshot(
        db as never,
        {
          membershipId: ids.gm,
          campaignId: "00000000-0000-4000-8000-0000000009ff",
          role: "GM",
          displayName: "GM",
        },
        [],
        readSet,
      ),
    ).rejects.toThrow("CAMPAIGN_READ_SET_MISMATCH");
  });

  it("не может отфильтровать по членству — этого нет в сигнатуре", async () => {
    // Замок проверяется типом, а не внимательностью: набор строится по одной
    // кампании и ничего не знает о том, кому он пойдёт. Тест фиксирует
    // намерение, чтобы `auth` не добавили в сигнатуру «для удобства».
    const db = drizzle(database, { schema });
    const readSet = await loadCampaignReadSet(db as never, ids.campaign);
    expect(Object.keys(readSet)).not.toContain("auth");
    expect(Object.keys(readSet)).not.toContain("membershipId");
    // Персонажи в наборе — все активные: персонализация происходит позже, в
    // проекции, и это ровно то, что делает набор общим.
    expect(readSet.characterRows.length).toBeGreaterThan(1);
  });
});

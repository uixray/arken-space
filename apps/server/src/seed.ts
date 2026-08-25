import { eq, sql } from "drizzle-orm";
import {
  campaignAudioTracks,
  campaigns,
  characters,
  gmAccessCredentials,
  memberships,
  scenes,
} from "@arken/db";
import { createStarterCharacter } from "@arken/system";
import { env } from "./env.js";
import { hashToken } from "./security.js";

type Database = ReturnType<typeof import("@arken/db").createDatabase>["db"];

export async function reconcileTokenOwnership(db: Database) {
  await db.execute(sql`
    update tokens as token
    set owner_membership_id = character.owner_membership_id,
        updated_at = now()
    from characters as character
    where token.character_id = character.id
      and token.owner_membership_id is distinct from character.owner_membership_id
  `);
}

/**
 * UIX-518: наполнение одной конкретной кампании.
 *
 * Раньше это было частью `ensureSeed`, которая всегда работала с «первой»
 * кампанией. Выделено, чтобы ту же стартовую обстановку можно было создать
 * для отдельной кампании — e2e нужен собственный стол на каждый тест, иначе
 * тесты, меняющие состояние, влияют на соседей.
 *
 * Идемпотентна: каждый кусок добавляется, только если его ещё нет.
 */
export async function seedCampaignContent(
  db: Database,
  campaign: typeof campaigns.$inferSelect,
  gmAccessToken: string,
) {
  await db
    .insert(gmAccessCredentials)
    .values({
      campaignId: campaign.id,
      tokenHash: hashToken(gmAccessToken),
    })
    .onConflictDoNothing();

  let [gm] = await db
    .select()
    .from(memberships)
    .where(eq(memberships.campaignId, campaign.id))
    .limit(1);
  if (!gm) {
    [gm] = await db
      .insert(memberships)
      .values({ campaignId: campaign.id, role: "GM", displayName: "Мастер" })
      .returning();
  }

  let [scene] = await db
    .select()
    .from(scenes)
    .where(eq(scenes.campaignId, campaign.id))
    .limit(1);
  if (!scene) {
    [scene] = await db
      .insert(scenes)
      .values({
        campaignId: campaign.id,
        name: "Первая сцена",
        grid: {
          enabled: true,
          size: 64,
          offsetX: 0,
          offsetY: 0,
          color: "#c8b78b",
          opacity: 0.22,
        },
      })
      .returning();
    if (scene)
      await db
        .update(campaigns)
        .set({ activeSceneId: scene.id })
        .where(eq(campaigns.id, campaign.id));
  }

  const [character] = await db
    .select()
    .from(characters)
    .where(eq(characters.campaignId, campaign.id))
    .limit(1);
  if (!character) {
    const starter = createStarterCharacter();
    await db
      .insert(characters)
      .values({ campaignId: campaign.id, name: "Путник", ...starter });
  }

  const [existingTrack] = await db
    .select({ id: campaignAudioTracks.id })
    .from(campaignAudioTracks)
    .where(eq(campaignAudioTracks.campaignId, campaign.id))
    .limit(1);
  if (!existingTrack) {
    await db.insert(campaignAudioTracks).values({ campaignId: campaign.id });
  }

  return { campaign, gm };
}

/**
 * Отдельная кампания со своим GM-токеном и той же стартовой обстановкой.
 *
 * Нужна e2e (UIX-518): все браузерные тесты работали с одной кампанией, и те
 * из них, что меняют состояние, роняли соседей через прогон. Ни один route
 * этого наружу не выставляет — кампания создаётся только процессом, у которого
 * уже есть доступ к базе.
 */
export async function createCampaignWithGmAccess(
  db: Database,
  name: string,
  gmAccessToken: string,
) {
  const [campaign] = await db.insert(campaigns).values({ name }).returning();
  if (!campaign) throw new Error("Could not create campaign");
  return seedCampaignContent(db, campaign, gmAccessToken);
}

export async function ensureSeed(db: Database) {
  /* `limit(1)` без сортировки возвращал произвольную строку. Пока кампания
     была одна, это не было видно; e2e создают свои, и «первая» стала зависеть
     от плана запроса. Порядок задан явно. */
  let [campaign] = await db
    .select()
    .from(campaigns)
    .orderBy(campaigns.createdAt)
    .limit(1);
  if (!campaign) {
    [campaign] = await db
      .insert(campaigns)
      .values({ name: "Arken — первая кампания" })
      .returning();
  }
  if (!campaign) throw new Error("Could not create campaign");

  const seeded = await seedCampaignContent(db, campaign, env.GM_ACCESS_TOKEN);
  await reconcileTokenOwnership(db);
  return seeded;
}

import { and, asc, eq, ilike, inArray, sql } from "drizzle-orm";
import type {
  StoryEntityLink,
  StoryEntityLinkKind,
  StoryLinkTargetDto,
} from "@arken/contracts";
import {
  campaigns,
  scenes,
  storyPosts,
  worldContent,
  worldMapLocations,
  worldMaps,
} from "@arken/db";
import type { AuthContext } from "./auth.js";
import {
  canViewWorldMap,
  canViewWorldMapLocation,
} from "./world-map-access.js";

type Database = ReturnType<typeof import("@arken/db").createDatabase>["db"];
type Transaction = Parameters<Parameters<Database["transaction"]>[0]>[0];
type StoryDatabase = Database | Transaction;

/**
 * UIX-245: ссылки записи летописи на сущности. Цель ссылки хранится как
 * `{kind, entityId}`; подпись и видимость вычисляются при чтении, поэтому
 * переименование или скрытие цели сразу отражается в летописи. Игрок не
 * получает ни подписи, ни идентификатора цели, которую ему не видно.
 */
type ResolvedTarget = { label: string; playerVisible: boolean };

const linkKey = (link: StoryEntityLink) => `${link.kind}:${link.entityId}`;

async function resolveTargets(
  db: StoryDatabase,
  campaignId: string,
  links: readonly StoryEntityLink[],
) {
  const ids = new Map<StoryEntityLinkKind, Set<string>>();
  for (const link of links) {
    const set = ids.get(link.kind) ?? new Set<string>();
    set.add(link.entityId);
    ids.set(link.kind, set);
  }
  const wanted = (kind: StoryEntityLinkKind) => [...(ids.get(kind) ?? [])];
  const resolved = new Map<string, ResolvedTarget>();
  const put = (kind: StoryEntityLinkKind, id: string, target: ResolvedTarget) =>
    resolved.set(`${kind}:${id}`, target);
  const playerAuth = { role: "PLAYER" } as AuthContext;

  const mapIds = wanted("WORLD_MAP");
  if (mapIds.length)
    for (const map of await db
      .select({
        id: worldMaps.id,
        name: worldMaps.name,
        lifecycle: worldMaps.lifecycle,
        visibility: worldMaps.visibility,
      })
      .from(worldMaps)
      .where(
        and(
          eq(worldMaps.campaignId, campaignId),
          inArray(worldMaps.id, mapIds),
        ),
      ))
      put("WORLD_MAP", map.id, {
        label: map.name,
        playerVisible: canViewWorldMap(map, playerAuth),
      });

  const locationIds = wanted("LOCATION");
  if (locationIds.length)
    for (const row of await db
      .select({
        id: worldMapLocations.id,
        name: worldMapLocations.name,
        visibility: worldMapLocations.visibility,
        mapLifecycle: worldMaps.lifecycle,
        mapVisibility: worldMaps.visibility,
      })
      .from(worldMapLocations)
      .innerJoin(
        worldMaps,
        and(
          eq(worldMaps.id, worldMapLocations.mapId),
          eq(worldMaps.campaignId, worldMapLocations.campaignId),
        ),
      )
      .where(
        and(
          eq(worldMapLocations.campaignId, campaignId),
          inArray(worldMapLocations.id, locationIds),
        ),
      ))
      put("LOCATION", row.id, {
        label: row.name,
        // Точка видна игроку только на карте, которую ему видно.
        playerVisible:
          canViewWorldMapLocation(row, playerAuth) &&
          canViewWorldMap(
            { lifecycle: row.mapLifecycle, visibility: row.mapVisibility },
            playerAuth,
          ),
      });

  const sceneIds = wanted("SCENE");
  if (sceneIds.length) {
    const [campaign] = await db
      .select({ activeSceneId: campaigns.activeSceneId })
      .from(campaigns)
      .where(eq(campaigns.id, campaignId))
      .limit(1);
    for (const scene of await db
      .select({ id: scenes.id, name: scenes.name })
      .from(scenes)
      .where(
        and(eq(scenes.campaignId, campaignId), inArray(scenes.id, sceneIds)),
      ))
      put("SCENE", scene.id, {
        label: scene.name,
        // Как в снимке: игрок знает только активную сцену.
        playerVisible: scene.id === campaign?.activeSceneId,
      });
  }

  const postIds = wanted("CHRONICLE");
  if (postIds.length)
    for (const post of await db
      .select({
        id: storyPosts.id,
        title: storyPosts.title,
        lifecycle: storyPosts.lifecycle,
        visibility: storyPosts.visibility,
      })
      .from(storyPosts)
      .where(
        and(
          eq(storyPosts.campaignId, campaignId),
          inArray(storyPosts.id, postIds),
        ),
      ))
      put("CHRONICLE", post.id, {
        label: post.title || "Запись летописи",
        playerVisible:
          post.visibility === "PUBLIC" &&
          (post.lifecycle === "PUBLISHED" || post.lifecycle === "CORRECTED"),
      });

  const entityIds = wanted("WORLD_ENTITY");
  if (entityIds.length)
    for (const entity of await db
      .select({
        id: worldContent.id,
        name: worldContent.name,
        lifecycle: worldContent.lifecycle,
      })
      .from(worldContent)
      .where(inArray(worldContent.id, entityIds)))
      put("WORLD_ENTITY", entity.id, {
        label: entity.name,
        playerVisible: entity.lifecycle === "PUBLISHED",
      });

  return resolved;
}

/**
 * Подписанные ссылки для набора записей. У мастера — все ссылки (удалённая
 * цель приходит с `label: null`), у игрока — только видимые цели.
 */
export async function storyLinkTargetsFor(
  db: StoryDatabase,
  auth: Pick<AuthContext, "campaignId" | "role">,
  posts: ReadonlyArray<{ id: string; entityLinks: unknown }>,
) {
  const linksByPost = new Map(
    posts.map((post) => [post.id, post.entityLinks as StoryEntityLink[]]),
  );
  const resolved = await resolveTargets(
    db,
    auth.campaignId,
    [...linksByPost.values()].flat(),
  );
  const result = new Map<string, StoryLinkTargetDto[]>();
  for (const [postId, links] of linksByPost) {
    const views: StoryLinkTargetDto[] = [];
    for (const link of links) {
      const target = resolved.get(linkKey(link));
      if (auth.role !== "GM" && !target?.playerVisible) continue;
      views.push({
        kind: link.kind,
        entityId: link.entityId,
        label: target?.label ?? null,
        playerVisible: target?.playerVisible ?? false,
      });
    }
    result.set(postId, views);
  }
  return result;
}

/**
 * Проверка ссылок при записи: дубликаты запрещены, а каждая новая цель
 * должна существовать в этой кампании (сущность мира — в каноне). Уже
 * сохранённые ссылки не перепроверяются: удаление цели не должно мешать
 * исправить текст записи.
 */
export async function assertStoryLinkTargets(
  db: StoryDatabase,
  campaignId: string,
  links: readonly StoryEntityLink[],
  existing: readonly StoryEntityLink[] = [],
) {
  const keys = new Set<string>();
  for (const link of links) {
    const key = linkKey(link);
    if (keys.has(key)) throw new Error("STORY_LINKS_INVALID");
    keys.add(key);
  }
  const known = new Set(existing.map(linkKey));
  const added = links.filter((link) => !known.has(linkKey(link)));
  if (!added.length) return;
  const resolved = await resolveTargets(db, campaignId, added);
  if (added.some((link) => !resolved.has(linkKey(link))))
    throw new Error("STORY_LINKS_INVALID");
}

const TARGETS_PER_KIND = 10;

function nameMatch(column: Parameters<typeof ilike>[0], q?: string) {
  if (!q) return sql`true`;
  return ilike(column, `%${q.replace(/[\\%_]/g, (char) => `\\${char}`)}%`);
}

/** GM-only: кандидаты для ссылок, до десяти на каждый вид. */
export async function searchStoryLinkTargets(
  db: StoryDatabase,
  campaignId: string,
  q?: string,
) {
  const [maps, locations, sceneRows, posts, entities] = await Promise.all([
    db
      .select({ id: worldMaps.id })
      .from(worldMaps)
      .where(
        and(eq(worldMaps.campaignId, campaignId), nameMatch(worldMaps.name, q)),
      )
      .orderBy(asc(worldMaps.name))
      .limit(TARGETS_PER_KIND),
    db
      .select({ id: worldMapLocations.id })
      .from(worldMapLocations)
      .where(
        and(
          eq(worldMapLocations.campaignId, campaignId),
          nameMatch(worldMapLocations.name, q),
        ),
      )
      .orderBy(asc(worldMapLocations.name))
      .limit(TARGETS_PER_KIND),
    db
      .select({ id: scenes.id })
      .from(scenes)
      .where(and(eq(scenes.campaignId, campaignId), nameMatch(scenes.name, q)))
      .orderBy(asc(scenes.name))
      .limit(TARGETS_PER_KIND),
    db
      .select({ id: storyPosts.id })
      .from(storyPosts)
      .where(
        and(
          eq(storyPosts.campaignId, campaignId),
          nameMatch(storyPosts.title, q),
        ),
      )
      .orderBy(asc(storyPosts.title))
      .limit(TARGETS_PER_KIND),
    db
      .select({ id: worldContent.id })
      .from(worldContent)
      .where(nameMatch(worldContent.name, q))
      .orderBy(asc(worldContent.name))
      .limit(TARGETS_PER_KIND),
  ]);
  const links: StoryEntityLink[] = [
    ...entities.map(({ id }) => ({
      kind: "WORLD_ENTITY" as const,
      entityId: id,
    })),
    ...locations.map(({ id }) => ({ kind: "LOCATION" as const, entityId: id })),
    ...maps.map(({ id }) => ({ kind: "WORLD_MAP" as const, entityId: id })),
    ...sceneRows.map(({ id }) => ({ kind: "SCENE" as const, entityId: id })),
    ...posts.map(({ id }) => ({ kind: "CHRONICLE" as const, entityId: id })),
  ];
  const resolved = await resolveTargets(db, campaignId, links);
  return links.flatMap((link): StoryLinkTargetDto[] => {
    const target = resolved.get(linkKey(link));
    return target ? [{ ...link, ...target }] : [];
  });
}

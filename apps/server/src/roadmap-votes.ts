import { randomUUID } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { and, count, eq } from "drizzle-orm";
import { publicRoadmapVotes } from "@arken/db";

type Database = ReturnType<typeof import("@arken/db").createDatabase>["db"];

/** Curated public roadmap only. Never populated from Linear at request time. */
export const publicRoadmapItems = [
  { id: "floating-ui", title: "Плавающие окна поверх карты" },
  { id: "service-routine", title: "Перенос рутины механик на сервис" },
  { id: "bestiary-encounters", title: "Конструктор энкаунтеров и бестиарий" },
  { id: "uix-526", title: "Знакомство с игрой для новых участников" },
  { id: "uix-245", title: "Энциклопедия мира и хроники" },
  { id: "uix-382", title: "Микшер дорожек саундтрека" },
  { id: "uix-512", title: "Общий звуковой пульт" },
  { id: "uix-588", title: "Ресурс вдохновения" },
  { id: "uix-625", title: "Полноценная игровая сессия на телефоне" },
  { id: "uix-264", title: "Управление мирами и кампаниями мастера" },
  { id: "uix-379", title: "Достижения" },
] as const;

const allowedIds = new Set<string>(publicRoadmapItems.map(({ id }) => id));
const voterCookieName = "arken_roadmap_voter";
const validVoterId = (value: unknown): value is string =>
  typeof value === "string" &&
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    value,
  );

function voterIdFor(request: { cookies: Record<string, unknown> }): string {
  const existing = request.cookies[voterCookieName];
  return validVoterId(existing) ? existing : randomUUID();
}

function setVoterCookie(
  reply: {
    setCookie: (name: string, value: string, options: object) => unknown;
  },
  voterId: string,
  secure: boolean,
) {
  reply.setCookie(voterCookieName, voterId, {
    httpOnly: true,
    sameSite: "lax",
    secure,
    path: "/",
    maxAge: 60 * 60 * 24 * 365,
  });
}

export function registerPublicRoadmapVoteRoutes(
  app: FastifyInstance,
  db: Database,
) {
  app.get(
    "/api/public/roadmap-votes",
    { config: { rateLimit: { max: 30, timeWindow: "1 minute" } } },
    async (request, reply) => {
      const voterId = voterIdFor(request);
      if (!validVoterId(request.cookies[voterCookieName]))
        setVoterCookie(reply, voterId, request.protocol === "https");

      const rows = await db
        .select({ itemId: publicRoadmapVotes.itemId, total: count() })
        .from(publicRoadmapVotes)
        .groupBy(publicRoadmapVotes.itemId);
      const counts = new Map(rows.map(({ itemId, total }) => [itemId, total]));
      const myVotes = await db
        .select({ itemId: publicRoadmapVotes.itemId })
        .from(publicRoadmapVotes)
        .where(eq(publicRoadmapVotes.voterId, voterId));
      const voted = new Set(myVotes.map(({ itemId }) => itemId));

      reply.header("cache-control", "no-store, private");
      reply.header("vary", "cookie");
      return {
        items: publicRoadmapItems.map((item) => ({
          ...item,
          count: counts.get(item.id) ?? 0,
          voted: voted.has(item.id),
        })),
        anonymousCookieLimit:
          "Голос привязан к анонимной cookie: после её удаления можно проголосовать повторно.",
      };
    },
  );

  app.post<{ Params: { itemId: string } }>(
    "/api/public/roadmap-votes/:itemId",
    { config: { rateLimit: { max: 30, timeWindow: "1 minute" } } },
    async (request, reply) => {
      const itemId = request.params.itemId;
      if (!allowedIds.has(itemId))
        return reply.code(404).send({ error: "ROADMAP_ITEM_NOT_FOUND" });

      const currentCookie = request.cookies[voterCookieName];
      const voterId = voterIdFor(request);
      if (!validVoterId(currentCookie))
        setVoterCookie(reply, voterId, request.protocol === "https");

      // Delete-returning and insert-on-conflict form a serialized toggle under
      // the unique voter/item constraint, even for concurrent requests.
      const removed = await db
        .delete(publicRoadmapVotes)
        .where(
          and(
            eq(publicRoadmapVotes.itemId, itemId),
            eq(publicRoadmapVotes.voterId, voterId),
          ),
        )
        .returning({ id: publicRoadmapVotes.id });
      const voted = removed.length === 0;
      if (voted)
        await db
          .insert(publicRoadmapVotes)
          .values({ itemId, voterId })
          .onConflictDoNothing({
            target: [publicRoadmapVotes.itemId, publicRoadmapVotes.voterId],
          });

      const [aggregate] = await db
        .select({ total: count() })
        .from(publicRoadmapVotes)
        .where(eq(publicRoadmapVotes.itemId, itemId));
      reply.header("cache-control", "no-store, private");
      return { id: itemId, count: aggregate?.total ?? 0, voted };
    },
  );
}

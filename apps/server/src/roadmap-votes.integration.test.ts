import { readdir, readFile } from "node:fs/promises";
import Fastify from "fastify";
import cookie from "@fastify/cookie";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { afterAll, beforeAll, expect, it } from "vitest";
import * as schema from "@arken/db";
import {
  publicRoadmapItems,
  registerPublicRoadmapVoteRoutes,
} from "./roadmap-votes.js";

let database: PGlite;
let app: ReturnType<typeof Fastify>;
let db: ReturnType<typeof drizzle<typeof schema>>;

beforeAll(async () => {
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
  app = Fastify();
  await app.register(cookie);
  registerPublicRoadmapVoteRoutes(app, db as never);
  await app.ready();
});

afterAll(async () => {
  await app.close();
  await database.close();
});

it("projects only curated public roadmap items and toggles a persistent anonymous vote", async () => {
  const first = await app.inject({
    method: "GET",
    url: "/api/public/roadmap-votes",
  });
  expect(first.statusCode, first.body).toBe(200);
  const cookieHeader = first.headers["set-cookie"]?.split(";")[0];
  expect(cookieHeader).toMatch(/^arken_roadmap_voter=[0-9a-f-]{36}$/i);
  const body = first.json();
  expect(body.items.map((item: { id: string }) => item.id)).toEqual(
    publicRoadmapItems.map(({ id }) => id),
  );
  expect(body.items[0]).toEqual({
    ...publicRoadmapItems[0],
    count: 0,
    voted: false,
  });
  expect(body.anonymousCookieLimit).toContain("удаления");
  expect(first.headers["cache-control"]).toContain("no-store");

  const vote = await app.inject({
    method: "POST",
    url: "/api/public/roadmap-votes/floating-ui",
    headers: { cookie: cookieHeader },
  });
  expect(vote.statusCode).toBe(200);
  expect(vote.json()).toEqual({ id: "floating-ui", count: 1, voted: true });

  const persisted = await app.inject({
    method: "GET",
    url: "/api/public/roadmap-votes",
    headers: { cookie: cookieHeader },
  });
  expect(persisted.json().items[0]).toMatchObject({ count: 1, voted: true });

  const remove = await app.inject({
    method: "POST",
    url: "/api/public/roadmap-votes/floating-ui",
    headers: { cookie: cookieHeader },
  });
  expect(remove.json()).toEqual({ id: "floating-ui", count: 0, voted: false });
});

it("rejects non-allowlisted IDs and replaces malformed voter cookies", async () => {
  const unknown = await app.inject({
    method: "POST",
    url: "/api/public/roadmap-votes/uix-999",
  });
  expect(unknown.statusCode).toBe(404);
  expect(unknown.json()).toEqual({ error: "ROADMAP_ITEM_NOT_FOUND" });

  const malformed = await app.inject({
    method: "GET",
    url: "/api/public/roadmap-votes",
    headers: { cookie: "arken_roadmap_voter=not-a-uuid" },
  });
  expect(malformed.headers["set-cookie"]).toMatch(
    /^arken_roadmap_voter=[0-9a-f-]{36}; Max-Age=\d+; Path=\/; HttpOnly; SameSite=Lax/i,
  );
});

it("enforces the unique voter/item key under concurrent repeated toggles", async () => {
  const initial = await app.inject({
    method: "GET",
    url: "/api/public/roadmap-votes",
  });
  const cookieHeader = initial.headers["set-cookie"]?.split(";")[0];
  const request = () =>
    app.inject({
      method: "POST",
      url: "/api/public/roadmap-votes/uix-526",
      headers: { cookie: cookieHeader },
    });
  const responses = await Promise.all([request(), request()]);
  expect(
    responses.map(({ statusCode, body }) => ({ statusCode, body })),
  ).toEqual([
    { statusCode: 200, body: expect.any(String) },
    { statusCode: 200, body: expect.any(String) },
  ]);
  expect(responses.every(({ statusCode }) => statusCode === 200)).toBe(true);
  const state = await app.inject({
    method: "GET",
    url: "/api/public/roadmap-votes",
    headers: { cookie: cookieHeader },
  });
  expect(
    state.json().items.find((item: { id: string }) => item.id === "uix-526"),
  ).toMatchObject({ count: 1, voted: true });
});

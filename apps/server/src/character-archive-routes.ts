import type { FastifyInstance } from "fastify";
import { and, desc, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import {
  archiveCharacterSchema,
  restoreCharacterSchema,
} from "@arken/contracts";
import {
  characterCatalogEntries,
  characterControllers,
  characters,
} from "@arken/db";
import { requireAuth } from "./auth.js";
import { characterDto } from "./character-dto.js";
import {
  archiveCharacter,
  restoreCharacter,
} from "./character-archive-service.js";

type Database = ReturnType<typeof import("@arken/db").createDatabase>["db"];
type BroadcastSnapshots = (campaignId: string) => Promise<void>;

export function registerCharacterArchiveRoutes(
  app: FastifyInstance,
  db: Database,
  broadcastSnapshots: BroadcastSnapshots,
) {
  /** GM-only archived roster. Keep archived rows out of gameplay snapshots. */
  app.get("/api/characters/archived", async (request, reply) => {
    const auth = await requireAuth(request, reply, db);
    if (!auth) return;
    if (auth.role !== "GM")
      return reply.code(403).send({ error: "GM_REQUIRED" });
    const rows = await db
      .select()
      .from(characters)
      .where(
        and(
          eq(characters.campaignId, auth.campaignId),
          eq(characters.lifecycle, "ARCHIVED"),
        ),
      )
      .orderBy(desc(characters.archivedAt));
    if (rows.length === 0) return reply.send([]);
    const entryRows = await db
      .select()
      .from(characterCatalogEntries)
      .where(
        inArray(
          characterCatalogEntries.characterId,
          rows.map((row) => row.id),
        ),
      );
    const controllerRows = await db
      .select()
      .from(characterControllers)
      .where(
        inArray(
          characterControllers.characterId,
          rows.map((row) => row.id),
        ),
      );
    const entriesByCharacter = new Map<string, typeof entryRows>();
    for (const entry of entryRows) {
      const list = entriesByCharacter.get(entry.characterId) ?? [];
      list.push(entry);
      entriesByCharacter.set(entry.characterId, list);
    }
    const controllersByCharacter = new Map<string, string[]>();
    for (const controller of controllerRows) {
      const list = controllersByCharacter.get(controller.characterId) ?? [];
      list.push(controller.membershipId);
      controllersByCharacter.set(controller.characterId, list);
    }
    return reply.send(
      rows.map((row) =>
        characterDto(
          row,
          entriesByCharacter.get(row.id) ?? [],
          controllersByCharacter.get(row.id) ?? [],
        ),
      ),
    );
  });

  /**
   * Archive is a soft-delete. The service owns the campaign-scoped revision
   * CAS, event replay, and atomic dependent detachment. Historical chat,
   * catalog, media, and audit references remain untouched.
   */
  app.post("/api/characters/:id/archive", async (request, reply) => {
    const auth = await requireAuth(request, reply, db);
    if (!auth) return;
    if (auth.role !== "GM")
      return reply.code(403).send({ error: "GM_REQUIRED" });
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params);
    const body = archiveCharacterSchema.parse(request.body);
    const outcome = await archiveCharacter(db, {
      campaignId: auth.campaignId,
      membershipId: auth.membershipId,
      characterId: id,
      revision: body.revision,
      actionId: body.actionId,
    });
    if (outcome.kind === "duplicate")
      return reply.code(200).send({ duplicate: true });
    if (outcome.kind === "not-found")
      return reply.code(404).send({ error: "CHARACTER_NOT_FOUND" });
    if (outcome.kind === "conflict")
      return reply.code(409).send({ error: "CHARACTER_CONFLICT" });
    await broadcastSnapshots(auth.campaignId);
    return reply.send(characterDto(outcome.character, [], []));
  });

  /** Restore does not reinstate detached controllers, token links, or invites. */
  app.post("/api/characters/:id/restore", async (request, reply) => {
    const auth = await requireAuth(request, reply, db);
    if (!auth) return;
    if (auth.role !== "GM")
      return reply.code(403).send({ error: "GM_REQUIRED" });
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params);
    const body = restoreCharacterSchema.parse(request.body);
    const outcome = await restoreCharacter(db, {
      campaignId: auth.campaignId,
      membershipId: auth.membershipId,
      characterId: id,
      revision: body.revision,
      actionId: body.actionId,
    });
    if (outcome.kind === "duplicate")
      return reply.code(200).send({ duplicate: true });
    if (outcome.kind === "not-found")
      return reply.code(404).send({ error: "CHARACTER_NOT_FOUND" });
    if (outcome.kind === "conflict")
      return reply.code(409).send({ error: "CHARACTER_CONFLICT" });
    await broadcastSnapshots(auth.campaignId);
    const [entries, controllers] = await Promise.all([
      db
        .select()
        .from(characterCatalogEntries)
        .where(eq(characterCatalogEntries.characterId, id)),
      db
        .select({ membershipId: characterControllers.membershipId })
        .from(characterControllers)
        .where(eq(characterControllers.characterId, id)),
    ]);
    return reply.send(
      characterDto(
        outcome.character,
        entries,
        controllers.map((row) => row.membershipId),
      ),
    );
  });
}

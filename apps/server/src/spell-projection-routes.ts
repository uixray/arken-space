import { and, asc, eq, gt, max } from "drizzle-orm";
import type { FastifyInstance, FastifyReply } from "fastify";
import { z } from "zod";
import {
  spellAssignmentSnapshotSchema,
  spellProgressionQuerySchema,
} from "@arken/contracts";
import {
  characterControllers,
  characters,
  characterSpellAssignmentVersions,
  spellPackVersions,
} from "@arken/db";
import { requireAuth, type AuthContext } from "./auth.js";
import {
  loadCurrentSpellAssignmentVersions,
  type CurrentSpellAssignmentVersion,
} from "./spell-assignment-storage.js";
import { validateSpellGraphSnapshot } from "./spell-pack-storage.js";
import { buildSpellProgressionProjections } from "./spell-projection.js";

type Database = ReturnType<typeof import("@arken/db").createDatabase>["db"];

const characterParamsSchema = z
  .object({
    characterId: z
      .string()
      .uuid()
      .transform((value) => value.toLowerCase()),
  })
  .strict();

function fail(reply: FastifyReply, status: number, error: string) {
  return reply.code(status).send({ error });
}

async function loadCharacter(
  db: Database,
  auth: AuthContext,
  characterId: string,
) {
  const [character] = await db
    .select({
      id: characters.id,
      lifecycle: characters.lifecycle,
      ownerMembershipId: characters.ownerMembershipId,
      controllerMembershipId: characterControllers.membershipId,
    })
    .from(characters)
    .leftJoin(
      characterControllers,
      and(
        eq(characterControllers.characterId, characters.id),
        eq(characterControllers.membershipId, auth.membershipId),
      ),
    )
    .where(
      and(
        eq(characters.campaignId, auth.campaignId),
        eq(characters.id, characterId),
      ),
    )
    .limit(1);
  return character ?? null;
}

function playerCanReadCharacter(
  auth: AuthContext,
  character: NonNullable<Awaited<ReturnType<typeof loadCharacter>>>,
): boolean {
  return (
    character.lifecycle === "ACTIVE" &&
    (character.ownerMembershipId === auth.membershipId ||
      character.controllerMembershipId === auth.membershipId)
  );
}

async function loadVersion(
  db: Database,
  auth: AuthContext,
  packId: string,
  packVersionId: string,
) {
  const [version] = await db
    .select()
    .from(spellPackVersions)
    .where(
      and(
        eq(spellPackVersions.campaignId, auth.campaignId),
        eq(spellPackVersions.packId, packId),
        eq(spellPackVersions.id, packVersionId),
      ),
    )
    .limit(1);
  if (!version) return null;
  return {
    row: version,
    graph: validateSpellGraphSnapshot(version.graph).graph,
  };
}

function playerHasVersionAnchor(
  currentAssignments: readonly CurrentSpellAssignmentVersion[],
  packId: string,
  packVersionId: string,
): boolean {
  return currentAssignments.some(
    ({ snapshot }) =>
      snapshot.packId === packId && snapshot.packVersionId === packVersionId,
  );
}

async function projectionContext(
  request: Parameters<typeof requireAuth>[0],
  reply: FastifyReply,
  db: Database,
  gmOnly: boolean,
) {
  const auth = await requireAuth(request, reply, db);
  if (!auth) return null;
  if (gmOnly && auth.role !== "GM") {
    fail(reply, 403, "GM_REQUIRED");
    return null;
  }

  const params = characterParamsSchema.safeParse(request.params);
  const query = spellProgressionQuerySchema.safeParse(request.query);
  if (!params.success || !query.success) {
    fail(reply, 400, "INVALID_REQUEST");
    return null;
  }

  const character = await loadCharacter(db, auth, params.data.characterId);
  if (
    !character ||
    (auth.role === "PLAYER" && !playerCanReadCharacter(auth, character))
  ) {
    fail(reply, 404, "CHARACTER_NOT_FOUND");
    return null;
  }

  const version = await loadVersion(
    db,
    auth,
    query.data.packId,
    query.data.packVersionId,
  );
  if (!version) {
    fail(reply, 404, "SPELL_PACK_VERSION_NOT_FOUND");
    return null;
  }

  const currentAssignments = await loadCurrentSpellAssignmentVersions(
    db,
    auth.campaignId,
    character.id,
  );
  if (
    auth.role === "PLAYER" &&
    (version.row.lifecycle !== "ACTIVE" ||
      version.graph.lifecycle !== "ACTIVE" ||
      !playerHasVersionAnchor(
        currentAssignments,
        query.data.packId,
        query.data.packVersionId,
      ))
  ) {
    fail(reply, 404, "SPELL_PACK_VERSION_NOT_FOUND");
    return null;
  }

  return {
    auth,
    character,
    projections: buildSpellProgressionProjections({
      characterId: character.id,
      graph: version.graph,
      currentAssignments,
    }),
  };
}

export function registerSpellProjectionRoutes(
  app: FastifyInstance,
  db: Database,
) {
  app.get(
    "/api/characters/:characterId/spell-branches",
    async (request, reply) => {
      reply.header("Cache-Control", "private, no-store");
      const auth = await requireAuth(request, reply, db);
      if (!auth) return;
      const params = characterParamsSchema.safeParse(request.params);
      const query = z
        .object({ afterAssignmentId: z.string().uuid().optional() })
        .strict()
        .safeParse(request.query);
      if (!params.success || !query.success)
        return fail(reply, 400, "INVALID_REQUEST");

      const character = await loadCharacter(db, auth, params.data.characterId);
      if (
        !character ||
        character.lifecycle !== "ACTIVE" ||
        (auth.role === "PLAYER" && !playerCanReadCharacter(auth, character))
      )
        return fail(reply, 404, "CHARACTER_NOT_FOUND");

      // Keyset over current assignment identities. The grouped subquery picks
      // exactly the latest append-only version for each assignment; the
      // cursor paginates assignments (including NODE-only rows) so no SCHOOL
      // grant can be silently truncated by a fixed response cap.
      const latestAssignments = db
        .select({
          assignmentId: characterSpellAssignmentVersions.assignmentId,
          version: max(characterSpellAssignmentVersions.version).as(
            "latest_version",
          ),
        })
        .from(characterSpellAssignmentVersions)
        .where(
          and(
            eq(characterSpellAssignmentVersions.campaignId, auth.campaignId),
            eq(characterSpellAssignmentVersions.characterId, character.id),
          ),
        )
        .groupBy(characterSpellAssignmentVersions.assignmentId)
        .as("latest_spell_assignment");
      const rowConditions = [
        eq(characterSpellAssignmentVersions.campaignId, auth.campaignId),
        eq(characterSpellAssignmentVersions.characterId, character.id),
      ];
      if (query.data.afterAssignmentId)
        rowConditions.push(
          gt(
            characterSpellAssignmentVersions.assignmentId,
            query.data.afterAssignmentId,
          ),
        );
      const rows = await db
        .select({ row: characterSpellAssignmentVersions })
        .from(characterSpellAssignmentVersions)
        .innerJoin(
          latestAssignments,
          and(
            eq(
              characterSpellAssignmentVersions.assignmentId,
              latestAssignments.assignmentId,
            ),
            eq(
              characterSpellAssignmentVersions.version,
              latestAssignments.version,
            ),
          ),
        )
        .where(and(...rowConditions))
        .orderBy(asc(characterSpellAssignmentVersions.assignmentId))
        .limit(51);
      const page = rows.slice(0, 50).map(({ row }) => row);
      const branches = [];
      for (const row of page) {
        if (row.kind !== "SCHOOL") continue;
        const snapshot = spellAssignmentSnapshotSchema.parse(row.snapshot);
        if (snapshot.kind !== "SCHOOL") continue;
        const loaded = await loadVersion(
          db,
          auth,
          row.packId,
          row.packVersionId,
        );
        if (
          !loaded ||
          loaded.row.lifecycle !== "ACTIVE" ||
          loaded.graph.lifecycle !== "ACTIVE"
        )
          continue;
        const school = loaded.graph.schools.find(
          (candidate) => candidate.id === snapshot.schoolId,
        );
        if (!school || (auth.role === "PLAYER" && school.visibilityPolicy === "GM_ONLY"))
          continue;
        branches.push({
          packId: row.packId,
          packVersionId: row.packVersionId,
          packVersion: loaded.row.version,
          schoolId: school.id,
          schoolName: school.displayName,
        });
      }
      const hasMore = rows.length > 50;
      return reply.send({
        branches,
        nextCursor: hasMore ? page.at(-1)?.assignmentId ?? null : null,
      });
    },
  );

  app.get(
    "/api/characters/:characterId/spell-progression",
    async (request, reply) => {
      const context = await projectionContext(request, reply, db, false);
      if (!context) return;
      return reply
        .header("Cache-Control", "private, no-store")
        .send(context.projections.player);
    },
  );

  app.get(
    "/api/gm/characters/:characterId/spell-progression",
    async (request, reply) => {
      const context = await projectionContext(request, reply, db, true);
      if (!context) return;
      return reply
        .header("Cache-Control", "private, no-store")
        .send(context.projections.gm);
    },
  );
}

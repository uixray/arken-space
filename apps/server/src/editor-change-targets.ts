import { and, asc, eq, isNull, sql } from "drizzle-orm";
import {
  catalogEntries,
  characters,
  feedbackReports,
  gameEvents,
  storyPosts,
} from "@arken/db";
import {
  catalogEntryCommandSchema,
  characterCommandSchema,
  createCharacterSchema,
  createStoryPostSchema,
} from "@arken/contracts";
import { createStarterCharacter } from "@arken/system";
import type { AuthContext } from "./auth.js";
import {
  persistCatalogEdit,
  persistCharacterEdit,
} from "./character-routes.js";
import type { EditorTransaction } from "./editor-change.js";
import type { EditorTarget } from "./editor-change.js";
import { createEditorStoryDraft, persistEditorStoryDraft } from "./story.js";
import { env } from "./env.js";
import { z } from "zod";

type Database = ReturnType<typeof import("@arken/db").createDatabase>["db"];
type Transaction = Parameters<Parameters<Database["transaction"]>[0]>[0];

export async function searchEditorTargets(
  db: Database,
  campaignId: string,
  kind: EditorTarget["kind"],
  query: string,
) {
  switch (kind) {
    case "bug-report":
      return [];
    case "character-stat":
      return db
        .select({
          id: characters.id,
          name: characters.name,
          revision: characters.revision,
        })
        .from(characters)
        .where(
          and(
            eq(characters.campaignId, campaignId),
            isNull(characters.archivedAt),
            sql`strpos(lower(${characters.name}), lower(${query})) > 0`,
          ),
        )
        .orderBy(asc(characters.name), asc(characters.id))
        .limit(10);
    case "skill":
      return db
        .select({
          id: catalogEntries.id,
          name: catalogEntries.name,
          revision: catalogEntries.revision,
        })
        .from(catalogEntries)
        .where(
          and(
            eq(catalogEntries.campaignId, campaignId),
            eq(catalogEntries.kind, "SKILL"),
            sql`strpos(lower(${catalogEntries.name}), lower(${query})) > 0`,
          ),
        )
        .orderBy(asc(catalogEntries.name), asc(catalogEntries.id))
        .limit(10);
    case "material":
      return db
        .select({
          id: storyPosts.id,
          name: storyPosts.title,
          revision: storyPosts.revision,
        })
        .from(storyPosts)
        .where(
          and(
            eq(storyPosts.campaignId, campaignId),
            eq(storyPosts.lifecycle, "DRAFT"),
            sql`strpos(lower(${storyPosts.title}), lower(${query})) > 0`,
          ),
        )
        .orderBy(asc(storyPosts.title), asc(storyPosts.id))
        .limit(10);
  }
}
const skillPatch = catalogEntryCommandSchema
  .pick({ name: true, description: true })
  .partial()
  .strict();
const materialPatch = z
  .object({
    title: z.string().trim().max(160),
    body: z.string().trim().max(20000),
  })
  .partial()
  .strict();

const creationSchemas = {
  "character-stat": createCharacterSchema.pick({ name: true }).strict(),
  skill: catalogEntryCommandSchema
    .pick({ name: true, description: true })
    .strict(),
  material: z
    .strictObject({
      title: createStoryPostSchema.shape.title,
      body: createStoryPostSchema.shape.body,
    })
    .refine(({ title, body }) => Boolean(title || body)),
  "bug-report": z
    .object({
      title: z.string().trim().min(1).max(160),
      steps: z.string().trim().min(1).max(3000),
      expected: z.string().trim().min(1).max(1500),
      actual: z.string().trim().min(1).max(3000),
    })
    .strict(),
};

export function editorCreationValues(
  kind: EditorTarget["kind"],
  values: unknown,
) {
  const parsed = creationSchemas[kind].safeParse(values);
  return parsed.success ? parsed.data : null;
}

export function validEditorPatch(
  target: { kind: EditorTarget["kind"] },
  values: Record<string, unknown>,
): boolean {
  if (target.kind === "bug-report") return false;
  const schema =
    target.kind === "character-stat"
      ? characterCommandSchema.shape.stats
      : target.kind === "skill"
        ? skillPatch
        : materialPatch;
  const result = schema.safeParse(values);
  return (
    result.success &&
    Object.keys(values).length > 0 &&
    Object.entries(result.data ?? {}).every(
      ([key, value]) => values[key] === value,
    )
  );
}

export function editorTargets(
  tx: Transaction,
  actor: AuthContext,
): Pick<EditorTransaction, "read" | "write" | "create"> {
  async function load(target: Parameters<EditorTransaction["read"]>[0]) {
    if (target.campaignId !== actor.campaignId || actor.role !== "GM")
      return null;
    const { id, campaignId } = target;
    switch (target.kind) {
      case "bug-report":
        return null;
      case "character-stat": {
        const [row] = await tx
          .select()
          .from(characters)
          .where(
            and(
              eq(characters.id, id),
              eq(characters.campaignId, campaignId),
              isNull(characters.archivedAt),
            ),
          );
        return row ? ({ kind: target.kind, row } as const) : null;
      }
      case "skill": {
        const [row] = await tx
          .select()
          .from(catalogEntries)
          .where(
            and(
              eq(catalogEntries.id, id),
              eq(catalogEntries.campaignId, campaignId),
              eq(catalogEntries.kind, "SKILL"),
            ),
          );
        return row ? ({ kind: target.kind, row } as const) : null;
      }
      case "material": {
        const [row] = await tx
          .select()
          .from(storyPosts)
          .where(
            and(
              eq(storyPosts.id, id),
              eq(storyPosts.campaignId, campaignId),
              eq(storyPosts.lifecycle, "DRAFT"),
            ),
          );
        return row ? ({ kind: target.kind, row } as const) : null;
      }
    }
  }

  return {
    async create(draft) {
      const { target, after } = draft;
      if (target.campaignId !== actor.campaignId || actor.role !== "GM")
        throw new Error("EDITOR_CREATION_SCOPE_INVALID");
      const common = { id: target.id, campaignId: actor.campaignId };
      switch (target.kind) {
        case "material":
          return createEditorStoryDraft(
            tx,
            actor,
            target.id,
            draft.id,
            creationSchemas.material.parse(after),
          );
        case "bug-report": {
          const report = creationSchemas["bug-report"].parse(after);
          await tx.insert(feedbackReports).values({
            ...common,
            kind: "BUG",
            actorMembershipId: actor.membershipId,
            title: report.title,
            description: `Шаги\n${report.steps}\n\nОжидалось\n${report.expected}\n\nПроизошло\n${report.actual}`,
            buildVersion: env.APP_VERSION,
            buildRevision: env.BUILD_REVISION,
            requestId: draft.id,
          });
          return 0;
        }
        case "character-stat": {
          const starter = createStarterCharacter();
          const { name } = creationSchemas["character-stat"].parse(after);
          await tx.insert(characters).values({
            ...common,
            name,
            stats: starter.stats,
            skills: starter.skills,
            spells: starter.spells,
            resources: {
              ...starter.resources,
              inspiration: { current: 0, maximum: 1 },
            },
          });
          break;
        }
        case "skill":
          await tx.insert(catalogEntries).values({
            ...common,
            kind: "SKILL",
            ...creationSchemas.skill.parse(after),
          });
          break;
      }
      const character = target.kind === "character-stat";
      await tx.insert(gameEvents).values({
        campaignId: actor.campaignId,
        membershipId: actor.membershipId,
        actionId: draft.id,
        type: character ? "character.created" : "catalog.created",
        entityType: character ? "character" : "catalog_entry",
        entityId: target.id,
        entityRevision: 0,
        ...(character && { payload: { characterId: target.id } }),
      });
      return 0;
    },
    async read(target) {
      const loaded = await load(target);
      if (!loaded) return null;
      const { row, kind } = loaded;
      if (kind === "character-stat")
        return { revision: row.revision, values: row.stats, name: row.name };
      const values: Record<string, string> =
        kind === "skill"
          ? { name: row.name, description: row.description }
          : { title: row.title, body: row.body };
      return {
        revision: row.revision,
        values,
        name: kind === "skill" ? row.name : row.title,
      };
    },
    async write(target, revision, values, draft) {
      const loaded = await load(target);
      if (!loaded || loaded.row.revision !== revision) return null;
      if (loaded.kind === "character-stat") {
        const stats = characterCommandSchema.shape.stats.parse(values);
        const updated = await persistCharacterEdit(
          tx,
          actor,
          loaded.row,
          { stats: { ...loaded.row.stats, ...stats } },
          draft.id,
        );
        return updated?.next.revision ?? null;
      }
      if (loaded.kind === "skill") {
        const patch = skillPatch.parse(values);
        const updated = await persistCatalogEdit(
          tx,
          actor,
          loaded.row,
          patch,
          draft.id,
        );
        return updated?.revision ?? null;
      }
      const updated = await persistEditorStoryDraft(
        tx,
        actor,
        loaded.row,
        draft.id,
        materialPatch.parse(values),
      );
      return updated.post.revision;
    },
  };
}

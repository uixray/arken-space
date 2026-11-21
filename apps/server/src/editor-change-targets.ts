import { and, asc, eq, isNull, sql } from "drizzle-orm";
import { catalogEntries, characters, storyPosts } from "@arken/db";
import {
  catalogEntryCommandSchema,
  characterCommandSchema,
} from "@arken/contracts";
import type { AuthContext } from "./auth.js";
import {
  persistCatalogEdit,
  persistCharacterEdit,
} from "./character-routes.js";
import type { EditorTransaction } from "./editor-change.js";
import type { EditorTarget } from "./editor-change.js";
import { persistEditorStoryDraft } from "./story.js";
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

export function validEditorPatch(
  target: { kind: "character-stat" | "skill" | "material" },
  values: Record<string, unknown>,
): boolean {
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
): Pick<EditorTransaction, "read" | "write"> {
  async function load(target: Parameters<EditorTransaction["read"]>[0]) {
    if (target.campaignId !== actor.campaignId || actor.role !== "GM")
      return null;
    const { id, campaignId } = target;
    switch (target.kind) {
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
    async read(target) {
      const loaded = await load(target);
      if (!loaded) return null;
      const { row, kind } = loaded;
      if (kind === "character-stat")
        return { revision: row.revision, values: row.stats };
      const values: Record<string, string> =
        kind === "skill"
          ? { name: row.name, description: row.description }
          : { title: row.title, body: row.body };
      return { revision: row.revision, values };
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

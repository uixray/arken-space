import { and, desc, eq } from "drizzle-orm";
import { z } from "zod";
import { spellPackVersions, spellPacks } from "@arken/db";
import {
  spellProgressionGraphSchema,
  validateSpellProgressionGraph,
  type SpellGraphValidationIssue,
  type SpellProgressionGraph,
} from "@arken/contracts";

type Database = ReturnType<typeof import("@arken/db").createDatabase>["db"];

export type SpellPackStorageErrorCode =
  | "SPELL_GRAPH_SCHEMA_INVALID"
  | "SPELL_GRAPH_SEMANTIC_INVALID"
  | "SPELL_PACK_INITIAL_VERSION_REQUIRED"
  | "SPELL_PACK_NOT_FOUND"
  | "SPELL_PACK_VERSION_SEQUENCE_INVALID";

/** A domain error that future HTTP routes can map without inspecting text. */
export class SpellPackStorageError extends Error {
  constructor(
    readonly code: SpellPackStorageErrorCode,
    readonly details?: unknown,
  ) {
    super(code);
    this.name = "SpellPackStorageError";
  }
}

export interface SpellPackWriteInput {
  campaignId: string;
  graph: unknown;
}

export interface ValidatedSpellGraph {
  graph: SpellProgressionGraph;
  warnings: SpellGraphValidationIssue[];
}

const campaignIdSchema = z.string().uuid();

/** Runtime validation is mandatory: the JSONB `$type` in Drizzle is TS-only. */
export function validateSpellGraphSnapshot(
  input: unknown,
): ValidatedSpellGraph {
  const parsed = spellProgressionGraphSchema.safeParse(input);
  if (!parsed.success)
    throw new SpellPackStorageError(
      "SPELL_GRAPH_SCHEMA_INVALID",
      parsed.error.issues,
    );

  const validation = validateSpellProgressionGraph(parsed.data);
  if (validation.errors.length > 0)
    throw new SpellPackStorageError(
      "SPELL_GRAPH_SEMANTIC_INVALID",
      validation.errors,
    );

  return { graph: parsed.data, warnings: validation.warnings };
}

/** Creates stable pack identity and immutable version 1 atomically. */
export async function createSpellPack(
  db: Database,
  input: SpellPackWriteInput,
) {
  const campaignId = campaignIdSchema.parse(input.campaignId);
  const validated = validateSpellGraphSnapshot(input.graph);
  if (validated.graph.version !== 1)
    throw new SpellPackStorageError("SPELL_PACK_INITIAL_VERSION_REQUIRED", {
      actualVersion: validated.graph.version,
    });

  const saved = await db.transaction(async (tx) => {
    const [pack] = await tx
      .insert(spellPacks)
      .values({ id: validated.graph.packId, campaignId })
      .returning();
    if (!pack) throw new Error("SPELL_PACK_CREATE_FAILED");

    const [version] = await tx
      .insert(spellPackVersions)
      .values({
        id: validated.graph.versionId,
        campaignId,
        packId: validated.graph.packId,
        version: validated.graph.version,
        lifecycle: validated.graph.lifecycle,
        graph: validated.graph,
      })
      .returning();
    if (!version) throw new Error("SPELL_PACK_VERSION_CREATE_FAILED");

    return { pack, version: { ...version, graph: validated.graph } };
  });

  return { ...saved, warnings: validated.warnings };
}

/**
 * Appends exactly the next immutable version. Locking the stable parent makes
 * concurrent writers serialize before reading the current maximum.
 */
export async function appendSpellPackVersion(
  db: Database,
  input: SpellPackWriteInput,
) {
  const campaignId = campaignIdSchema.parse(input.campaignId);
  const validated = validateSpellGraphSnapshot(input.graph);

  const version = await db.transaction(async (tx) => {
    const [pack] = await tx
      .select({ id: spellPacks.id })
      .from(spellPacks)
      .where(
        and(
          eq(spellPacks.campaignId, campaignId),
          eq(spellPacks.id, validated.graph.packId),
        ),
      )
      .limit(1)
      .for("update");
    if (!pack) throw new SpellPackStorageError("SPELL_PACK_NOT_FOUND");

    const [latest] = await tx
      .select({ version: spellPackVersions.version })
      .from(spellPackVersions)
      .where(
        and(
          eq(spellPackVersions.campaignId, campaignId),
          eq(spellPackVersions.packId, validated.graph.packId),
        ),
      )
      .orderBy(desc(spellPackVersions.version))
      .limit(1);
    const expectedVersion = (latest?.version ?? 0) + 1;
    if (validated.graph.version !== expectedVersion)
      throw new SpellPackStorageError("SPELL_PACK_VERSION_SEQUENCE_INVALID", {
        expectedVersion,
        actualVersion: validated.graph.version,
      });

    const [created] = await tx
      .insert(spellPackVersions)
      .values({
        id: validated.graph.versionId,
        campaignId,
        packId: validated.graph.packId,
        version: validated.graph.version,
        lifecycle: validated.graph.lifecycle,
        graph: validated.graph,
      })
      .returning();
    if (!created) throw new Error("SPELL_PACK_VERSION_CREATE_FAILED");
    return { ...created, graph: validated.graph };
  });

  return { version, warnings: validated.warnings };
}

import { and, desc, eq, sql, type SQL } from "drizzle-orm";
import { worldContent } from "@arken/db";
import type {
  WorldContentDto,
  WorldContentPlayerDto,
} from "@arken/contracts";

/**
 * Server-side ACL core for World Content (UIX-245 Stage 1, AC4/AC10).
 *
 * This module intentionally has no HTTP routes: later GM-manager and
 * player-encyclopedia stages are expected to call `worldContentVisibility`
 * for list/query filtering (mirrors `visibility()` in ./player-requests.ts
 * and `characterMediaVisibility()` in ./character-media.ts) and
 * `canViewWorldContent` for single-row authorization once a row has already
 * been loaded.
 *
 * World Content has no `campaignId` (see `worldContent` in
 * `packages/db/src/schema.ts`), so authorization here keys only on the
 * requester's role — not on any campaign membership. A later, blocked stage
 * layers campaign-scoped discovery on top of this without ever widening
 * what a non-GM can see here.
 */

export interface WorldContentAuthContext {
  role: "GM" | "PLAYER";
}

/** The minimal shape needed to decide access to one canonical entity. */
export interface WorldContentSubject {
  lifecycle: (typeof worldContent.$inferSelect)["lifecycle"];
}

/**
 * AC4 + AC10 decision matrix:
 *  - GM: sees every entity regardless of lifecycle (including DRAFT and
 *    ARCHIVED), and `gmOnlyText` (see `toGmDto`, which selects every
 *    column — never call it from a non-GM code path).
 *  - Non-GM (player): sees PUBLISHED entities only. DRAFT and ARCHIVED
 *    entities do not exist for a player, full stop — not merely
 *    "invisible content on a visible row".
 */
export function canViewWorldContent(
  auth: WorldContentAuthContext,
  subject: WorldContentSubject,
): boolean {
  if (auth.role === "GM") return true;
  return subject.lifecycle === "PUBLISHED";
}

/**
 * SQL predicate for listing/filtering `world_content` rows, analogous to
 * `visibility()` in ./player-requests.ts and `characterMediaVisibility()`
 * in ./character-media.ts.
 */
export function worldContentVisibility(auth: WorldContentAuthContext): SQL {
  if (auth.role === "GM") return sql`true`;
  return eq(worldContent.lifecycle, "PUBLISHED");
}

type WorldContentRow = typeof worldContent.$inferSelect;

/**
 * GM projection: every column, including `gmOnlyText` and provenance.
 * Callers must gate this behind `auth.role === "GM"` — this function does
 * not itself check the role, so it must never be reachable from a non-GM
 * code path (see `worldContentPlayerColumns`/`toPlayerDto` for the safe
 * non-GM shape).
 */
export function toGmDto(row: WorldContentRow): WorldContentDto {
  return {
    id: row.id,
    slug: row.slug,
    type: row.type,
    subtype: row.subtype,
    name: row.name,
    aliases: row.aliases,
    summary: row.summary,
    publicText: row.publicText,
    gmOnlyText: row.gmOnlyText,
    tags: row.tags,
    lifecycle: row.lifecycle,
    coverAssetId: row.coverAssetId,
    provenance: {
      sourceUrl: row.sourceUrl,
      sourceExternalId: row.sourceExternalId,
      retrievedAt: row.retrievedAt ? row.retrievedAt.toISOString() : null,
      rawContentHash: row.rawContentHash,
      attribution: row.attribution,
      rightsReviewStatus: row.rightsReviewStatus,
      editorialApprovalStatus: row.editorialApprovalStatus,
    },
    revision: row.revision,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

/**
 * The exact column list a non-GM query is allowed to select. `gm_only_text`
 * and every provenance column are deliberately absent from this object, not
 * merely dropped when building the DTO — a caller cannot leak the field by
 * accident because it was never fetched from the database (AC4: "cannot be
 * discovered through search, API, snapshot, DOM").
 *
 * Usage: `db.select(worldContentPlayerColumns).from(worldContent).where(and(worldContentVisibility(auth), ...))`.
 */
export const worldContentPlayerColumns = {
  id: worldContent.id,
  slug: worldContent.slug,
  type: worldContent.type,
  subtype: worldContent.subtype,
  name: worldContent.name,
  aliases: worldContent.aliases,
  summary: worldContent.summary,
  publicText: worldContent.publicText,
  tags: worldContent.tags,
  lifecycle: worldContent.lifecycle,
  coverAssetId: worldContent.coverAssetId,
  revision: worldContent.revision,
  updatedAt: worldContent.updatedAt,
} as const;

type WorldContentPlayerRow = {
  id: string;
  slug: string;
  type: WorldContentRow["type"];
  subtype: string | null;
  name: string;
  aliases: string[];
  summary: string;
  publicText: string;
  tags: string[];
  lifecycle: WorldContentRow["lifecycle"];
  coverAssetId: string | null;
  revision: number;
  updatedAt: Date;
};

/** Builds the player-facing DTO from a row already narrowed to `worldContentPlayerColumns` — there is no `gmOnlyText` to accidentally include. */
export function toPlayerDto(
  row: WorldContentPlayerRow,
): WorldContentPlayerDto {
  return {
    id: row.id,
    slug: row.slug,
    type: row.type,
    subtype: row.subtype,
    name: row.name,
    aliases: row.aliases,
    summary: row.summary,
    publicText: row.publicText,
    tags: row.tags,
    coverAssetId: row.coverAssetId,
    revision: row.revision,
    updatedAt: row.updatedAt.toISOString(),
  };
}

/** Sort helper shared by list queries: newest edits first. */
export const worldContentDefaultOrder = desc(worldContent.updatedAt);

/** Convenience combinator for a single-entity lookup gated by role visibility. */
export function worldContentByIdVisibleTo(
  auth: WorldContentAuthContext,
  id: string,
): SQL {
  return and(worldContentVisibility(auth), eq(worldContent.id, id))!;
}

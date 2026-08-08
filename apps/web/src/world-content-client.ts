import type {
  WorldContentDto,
  WorldContentLifecycle,
  WorldContentMediaDto,
  WorldContentRelationDto,
  WorldContentType,
} from "@arken/contracts";
import { api } from "./api";

/**
 * GM entity manager client slice (UIX-245 Stage 3). Pairs with the HTTP API
 * in `apps/server/src/world-content-routes.ts`, which this file does not
 * modify. Pure/testable helpers live here (labels, slug validation, the
 * lifecycle-transition table) so `WorldContentWorkspace.tsx` stays a thin
 * rendering layer, mirroring `world-map-workspace-state.ts`.
 */

export const WORLD_CONTENT_TYPE_LABELS: Record<WorldContentType, string> = {
  LOCATION: "Локация",
  PERSON: "Персонаж",
  MONSTER: "Монстр",
  DEITY: "Божество",
  FACTION: "Фракция",
  ITEM: "Предмет",
  ARTICLE: "Статья",
};

export const WORLD_CONTENT_TYPES = Object.keys(
  WORLD_CONTENT_TYPE_LABELS,
) as WorldContentType[];

export const WORLD_CONTENT_LIFECYCLE_LABELS: Record<
  WorldContentLifecycle,
  string
> = {
  DRAFT: "Черновик",
  PUBLISHED: "Опубликовано",
  ARCHIVED: "Архив",
};

export const WORLD_CONTENT_LIFECYCLES = Object.keys(
  WORLD_CONTENT_LIFECYCLE_LABELS,
) as WorldContentLifecycle[];

/**
 * Mirrors `LEGAL_LIFECYCLE_TRANSITIONS` in
 * `apps/server/src/world-content-routes.ts` exactly — kept in sync by hand
 * since that table isn't exported from the server package. The server
 * remains authoritative; this only decides which transition buttons the UI
 * offers (never leave a stale, since-rejected transition clickable).
 */
const LEGAL_WORLD_CONTENT_TRANSITIONS: Record<
  WorldContentLifecycle,
  WorldContentLifecycle[]
> = {
  DRAFT: ["PUBLISHED", "ARCHIVED"],
  PUBLISHED: ["ARCHIVED"],
  ARCHIVED: ["PUBLISHED"],
};

export function legalWorldContentTransitions(
  lifecycle: WorldContentLifecycle,
): WorldContentLifecycle[] {
  return LEGAL_WORLD_CONTENT_TRANSITIONS[lifecycle];
}

/**
 * Mirrors `worldContentSlugSchema` in `packages/contracts/src/index.ts`
 * (kebab-case lowercase, 1-160 chars). That schema isn't exported, so the
 * regex is duplicated here deliberately — this only gives fast client-side
 * feedback before submit; the server schema stays authoritative and will
 * reject anything this misses.
 */
const WORLD_CONTENT_SLUG_PATTERN = /^[a-z0-9]+(-[a-z0-9]+)*$/;

export function isValidWorldContentSlug(slug: string): boolean {
  const trimmed = slug.trim();
  return (
    trimmed.length > 0 &&
    trimmed.length <= 160 &&
    WORLD_CONTENT_SLUG_PATTERN.test(trimmed)
  );
}

/** Best-effort slug suggestion from a display name; the user can still override it. */
export function slugifyWorldContentName(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 160);
}

/** Splits a free-text tag/alias field on commas, trims, drops empties and duplicates. */
export function parseTagList(input: string): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const raw of input.split(",")) {
    const value = raw.trim();
    if (!value || seen.has(value)) continue;
    seen.add(value);
    result.push(value);
  }
  return result;
}

/** Stable display order for a gallery: primarily `ordering`, tie-broken by `id` so equal orderings don't jitter. */
export function sortWorldContentMedia(
  items: readonly WorldContentMediaDto[],
): WorldContentMediaDto[] {
  return [...items].sort((a, b) => {
    if (a.ordering !== b.ordering) return a.ordering - b.ordering;
    return a.id.localeCompare(b.id);
  });
}

/**
 * Computes the pair of (id, new ordering) writes needed to swap a gallery
 * entry with its neighbor. Unlike `computeAdjacentSwap` in
 * `character-media-gallery-state.ts`, `world_content_media` carries no
 * `revision` column (see `updateWorldContentMediaSchema`'s doc comment in
 * contracts), so there is no CAS token to thread through here. Returns null
 * when the entry is at the boundary or not found.
 */
export function computeWorldContentMediaSwap(
  items: readonly WorldContentMediaDto[],
  id: string,
  direction: "up" | "down",
): [{ id: string; ordering: number }, { id: string; ordering: number }] | null {
  const sorted = sortWorldContentMedia(items);
  const index = sorted.findIndex((item) => item.id === id);
  if (index === -1) return null;
  const neighborIndex = direction === "up" ? index - 1 : index + 1;
  if (neighborIndex < 0 || neighborIndex >= sorted.length) return null;
  const current = sorted[index]!;
  const neighbor = sorted[neighborIndex]!;
  return [
    { id: current.id, ordering: neighbor.ordering },
    { id: neighbor.id, ordering: current.ordering },
  ];
}

export type WorldContentListQuery = {
  type?: WorldContentType;
  tags?: string[];
  q?: string;
};

function listQueryString(query: WorldContentListQuery): string {
  const params = new URLSearchParams();
  if (query.type) params.set("type", query.type);
  if (query.tags && query.tags.length > 0) params.set("tags", query.tags.join(","));
  if (query.q) params.set("q", query.q);
  const qs = params.toString();
  return qs ? `?${qs}` : "";
}

export const fetchWorldContentList = (query: WorldContentListQuery = {}) =>
  api<WorldContentDto[]>(`/api/world-content${listQueryString(query)}`);

export const fetchWorldContentDetail = (id: string) =>
  api<WorldContentDto>(`/api/world-content/${encodeURIComponent(id)}`);

export type CreateWorldContentInput = {
  slug: string;
  type: WorldContentType;
  subtype?: string | null;
  name: string;
  aliases?: string[];
  summary?: string;
  publicText?: string;
  gmOnlyText?: string;
  tags?: string[];
  coverAssetId?: string | null;
};

export const createWorldContent = (input: CreateWorldContentInput) =>
  api<WorldContentDto>("/api/world-content", {
    method: "POST",
    body: JSON.stringify({ ...input, actionId: crypto.randomUUID() }),
  });

export type UpdateWorldContentInput = {
  revision: number;
  subtype?: string | null;
  name?: string;
  aliases?: string[];
  summary?: string;
  publicText?: string;
  gmOnlyText?: string;
  tags?: string[];
  coverAssetId?: string | null;
};

export const updateWorldContent = (id: string, input: UpdateWorldContentInput) =>
  api<WorldContentDto>(`/api/world-content/${encodeURIComponent(id)}`, {
    method: "PATCH",
    body: JSON.stringify({ ...input, actionId: crypto.randomUUID() }),
  });

export const transitionWorldContentLifecycle = (
  id: string,
  revision: number,
  lifecycle: WorldContentLifecycle,
) =>
  api<WorldContentDto>(`/api/world-content/${encodeURIComponent(id)}/lifecycle`, {
    method: "POST",
    body: JSON.stringify({ revision, lifecycle, actionId: crypto.randomUUID() }),
  });

export const archiveWorldContent = (id: string, revision: number) =>
  api<WorldContentDto>(`/api/world-content/${encodeURIComponent(id)}`, {
    method: "DELETE",
    body: JSON.stringify({ revision, actionId: crypto.randomUUID() }),
  });

export const createWorldContentRelation = (
  fromId: string,
  input: { toWorldContentId: string; relationType: string; note?: string | null },
) =>
  api<WorldContentRelationDto>(
    `/api/world-content/${encodeURIComponent(fromId)}/relations`,
    {
      method: "POST",
      body: JSON.stringify({ ...input, actionId: crypto.randomUUID() }),
    },
  );

export const deleteWorldContentRelation = (relationId: string) =>
  api<void>(`/api/world-content/relations/${encodeURIComponent(relationId)}`, {
    method: "DELETE",
    body: JSON.stringify({ actionId: crypto.randomUUID() }),
  });

export const addWorldContentMedia = (
  id: string,
  input: { assetId: string; caption?: string | null },
) =>
  api<WorldContentMediaDto>(`/api/world-content/${encodeURIComponent(id)}/media`, {
    method: "POST",
    body: JSON.stringify({ ...input, actionId: crypto.randomUUID() }),
  });

export const updateWorldContentMedia = (
  worldContentId: string,
  mediaId: string,
  input: { caption?: string | null; ordering?: number },
) =>
  api<WorldContentMediaDto>(
    `/api/world-content/${encodeURIComponent(worldContentId)}/media/${encodeURIComponent(mediaId)}`,
    {
      method: "PATCH",
      body: JSON.stringify({ ...input, actionId: crypto.randomUUID() }),
    },
  );

export const removeWorldContentMedia = (
  worldContentId: string,
  mediaId: string,
) =>
  api<void>(
    `/api/world-content/${encodeURIComponent(worldContentId)}/media/${encodeURIComponent(mediaId)}`,
    {
      method: "DELETE",
      body: JSON.stringify({ actionId: crypto.randomUUID() }),
    },
  );

import {
  PUBLISHED_PLAYER_THEME_DEFINITIONS,
  type PersonalThemeDto,
  type PublishedPlayerThemeDto,
} from "@arken/contracts";

/** Server-owned published projection; no web runtime import and no private data. */
export const publishedPlayerThemes: readonly PublishedPlayerThemeDto[] =
  PUBLISHED_PLAYER_THEME_DEFINITIONS;

const defaultIds = publishedPlayerThemes
  .filter(({ id }) => id !== "classic-v1")
  .map(({ id }) => id);
const publishedIds = new Set(publishedPlayerThemes.map(({ id }) => id));

export function isPublishedPlayerThemeId(value: string): boolean {
  return publishedIds.has(value);
}
export function isAssignablePlayerThemeDefault(value: string): boolean {
  return publishedIds.has(value);
}
export function defaultThemeForMembership(membershipId: string): string {
  const prefix = membershipId.replace(/-/g, "").slice(0, 8);
  return (
    defaultIds[Number.parseInt(prefix, 16) % defaultIds.length] ?? "forest"
  );
}
export function personalThemeDto(row: {
  id: string;
  selectedThemeId: string | null;
  defaultThemeId: string;
  themeRevision: number;
}): PersonalThemeDto {
  return {
    scopeKey: row.id,
    selectedThemeId: row.selectedThemeId,
    defaultThemeId: row.defaultThemeId,
    revision: row.themeRevision,
    publishedThemes: [...publishedPlayerThemes],
  };
}

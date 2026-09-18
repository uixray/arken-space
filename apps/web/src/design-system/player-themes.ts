import { PLAYER_THEME_DEFINITIONS } from "./player-themes.generated";

export type PlayerThemeColorScheme = "dark" | "light";

export type PlayerThemeDefinition = Readonly<{
  id: string;
  name: string;
  colorScheme: PlayerThemeColorScheme;
  version: number;
}>;

export type PlayerThemeId = (typeof PLAYER_THEME_DEFINITIONS)[number]["id"];

/** Configuration only: no profile, account, or persistence boundary lives here. */
export const PLAYER_THEMES: readonly PlayerThemeDefinition[] = Object.freeze(
  PLAYER_THEME_DEFINITIONS.map((definition) =>
    Object.freeze({ ...definition }),
  ),
);

const playerThemeIds = new Set<string>(PLAYER_THEMES.map(({ id }) => id));

export function isPlayerThemeId(value: unknown): value is PlayerThemeId {
  return typeof value === "string" && playerThemeIds.has(value);
}

/**
 * Resolves only supplied configuration. `system` deliberately means the
 * existing baseline without a data-player-theme attribute, never forest.
 */
export function resolvePlayerThemeId({
  selectedThemeId,
  defaultThemeId,
  publishedThemeIds = playerThemeIds,
}: {
  selectedThemeId?: string | null;
  defaultThemeId?: string | null;
  publishedThemeIds?: ReadonlySet<string>;
}): PlayerThemeId | "system" {
  // Explicit baseline choice is different from clearing the override (null).
  // A profile default must not silently replace the user's selected system theme.
  if (selectedThemeId === "system") return "system";
  if (selectedThemeId != null)
    return isPlayerThemeId(selectedThemeId) &&
      publishedThemeIds.has(selectedThemeId)
      ? selectedThemeId
      : "system";
  if (isPlayerThemeId(defaultThemeId) && publishedThemeIds.has(defaultThemeId))
    return defaultThemeId;
  return "system";
}

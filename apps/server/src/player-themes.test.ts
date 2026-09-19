import { describe, expect, it } from "vitest";
import {
  defaultThemeForMembership,
  isAssignablePlayerThemeDefault,
  isPublishedPlayerThemeId,
  personalThemeDto,
  publishedPlayerThemes,
} from "./player-themes.js";

describe("membership player themes", () => {
  it("projects only the published catalog and assigns a stable UUID-derived personal default", () => {
    const id = "00000000-0000-4000-8000-00000000000f";
    const first = defaultThemeForMembership(id);
    expect(defaultThemeForMembership(id)).toBe(first);
    expect(publishedPlayerThemes).toHaveLength(8);
    expect(isAssignablePlayerThemeDefault(first)).toBe(true);
    expect(isAssignablePlayerThemeDefault("classic-v1")).toBe(true);
    expect(isPublishedPlayerThemeId("removed")).toBe(false);
    expect(
      personalThemeDto({
        id,
        selectedThemeId: "system",
        defaultThemeId: first,
        themeRevision: 4,
      }),
    ).toEqual(
      expect.objectContaining({
        scopeKey: id,
        selectedThemeId: "system",
        defaultThemeId: first,
        revision: 4,
      }),
    );
  });
});

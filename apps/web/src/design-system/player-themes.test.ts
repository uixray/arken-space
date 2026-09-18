import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import {
  PLAYER_THEMES,
  isPlayerThemeId,
  resolvePlayerThemeId,
} from "./player-themes";
import { PLAYER_THEME_DEFINITIONS } from "./player-themes.generated";

describe("player theme configuration", () => {
  it("contains the approved seven palettes plus the versioned classic id and generated configuration metadata", async () => {
    expect(PLAYER_THEMES.map(({ id }) => id)).toEqual([
      "forest",
      "dragons",
      "ice",
      "fire",
      "gold",
      "silver",
      "light",
      "classic-v1",
    ]);
    expect(PLAYER_THEMES).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "light",
          colorScheme: "light",
          version: 1,
        }),
      ]),
    );
    const firstTheme = PLAYER_THEMES[0];
    if (!firstTheme) throw new Error("Theme registry must not be empty");
    expect(Object.keys(firstTheme).sort()).toEqual([
      "colorScheme",
      "id",
      "name",
      "version",
    ]);
    const source: {
      themes: Record<
        string,
        { name: string; colorScheme: string; version: number }
      >;
    } = JSON.parse(
      await readFile(
        new URL(
          "../../../../tokens/player-themes/player-themes.tokens.json",
          import.meta.url,
        ),
        "utf8",
      ),
    );
    source.themes["classic-v1"] = JSON.parse(
      await readFile(
        new URL(
          "../../../../tokens/player-themes/classic-v1.tokens.json",
          import.meta.url,
        ),
        "utf8",
      ),
    );
    expect(PLAYER_THEME_DEFINITIONS).toEqual(
      Object.entries(source.themes).map(([id, theme]) => ({
        id,
        name: theme.name,
        colorScheme: theme.colorScheme,
        version: theme.version,
      })),
    );
  });

  it("uses a published override, a default only for no override, or baseline system", () => {
    expect(
      resolvePlayerThemeId({ selectedThemeId: "ice", defaultThemeId: "gold" }),
    ).toBe("ice");
    expect(
      resolvePlayerThemeId({
        selectedThemeId: "unknown",
        defaultThemeId: "gold",
      }),
    ).toBe("system");
    expect(
      resolvePlayerThemeId({
        selectedThemeId: "unknown",
        defaultThemeId: "removed",
      }),
    ).toBe("system");
    expect(isPlayerThemeId("forest")).toBe(true);
    expect(isPlayerThemeId("system")).toBe(false);
  });

  it("never uses an unpublished override or default from the local registry", () => {
    const publishedThemeIds = new Set(["forest"]);
    expect(
      resolvePlayerThemeId({
        selectedThemeId: "ice",
        defaultThemeId: "forest",
        publishedThemeIds,
      }),
    ).toBe("system");
    expect(
      resolvePlayerThemeId({
        selectedThemeId: null,
        defaultThemeId: "ice",
        publishedThemeIds,
      }),
    ).toBe("system");
    expect(
      resolvePlayerThemeId({
        selectedThemeId: null,
        defaultThemeId: "forest",
        publishedThemeIds,
      }),
    ).toBe("forest");
  });

  it.each(PLAYER_THEMES.map(({ id }) => id))(
    "preserves an explicit system choice over the %s profile default",
    (defaultThemeId) => {
      // Simulate serialization of a supplied preference, not a storage adapter.
      const preference = JSON.parse(
        JSON.stringify({ selectedThemeId: "system" }),
      );
      expect(resolvePlayerThemeId({ ...preference, defaultThemeId })).toBe(
        "system",
      );
      expect(
        resolvePlayerThemeId({ selectedThemeId: null, defaultThemeId }),
      ).toBe(defaultThemeId);
      expect(
        resolvePlayerThemeId({ selectedThemeId: undefined, defaultThemeId }),
      ).toBe(defaultThemeId);
    },
  );

  it("does not mutate configuration while resolving", () => {
    const before = JSON.stringify(PLAYER_THEMES);
    resolvePlayerThemeId({ selectedThemeId: "fire" });
    resolvePlayerThemeId({ defaultThemeId: "light" });
    expect(JSON.stringify(PLAYER_THEMES)).toBe(before);
    expect(Object.isFrozen(PLAYER_THEMES)).toBe(true);
    expect(Object.isFrozen(PLAYER_THEMES[0])).toBe(true);
  });

  it("maps the actual UIKit text-control focus hooks and error ink", async () => {
    // Structural guard only. Native keyboard/cascade/contrast are checked in
    // the real-controls browser gate, not proved by reading this stylesheet.
    const bridge = await readFile(
      new URL("./player-theme-gravity.css", import.meta.url),
      "utf8",
    );
    expect(bridge).toContain(
      'html[data-player-theme]:not([data-player-theme="classic-v1"]) .g-root {',
    );
    expect(bridge).toContain(
      "--g-color-line-generic-active: var(--color-focus);",
    );
    const foundation = await readFile(
      new URL("../ui/gravity-foundation.css", import.meta.url),
      "utf8",
    );
    for (const name of [
      "g-text-input-focus-outline-color",
      "g-text-area-focus-outline-color",
    ]) {
      expect(foundation).toContain(`--${name}: var(--color-focus);`);
      expect(bridge).not.toContain(`--${name}:`);
    }
    for (const name of ["g-color-text-danger", "g-color-line-danger"]) {
      expect(bridge).toContain(`--${name}: var(--state-error-ink);`);
    }
  });

  it("keeps game success and school semantics outside personal-theme CSS", async () => {
    const css = await readFile(
      new URL("./player-themes.generated.css", import.meta.url),
      "utf8",
    );
    expect(css).toContain('html[data-player-theme="forest"]');
    expect(css).not.toMatch(/--(?:color-success|game-(?:school|critical)-)/);
    const allowed = new Set([
      "color-accent",
      "color-text-accent",
      "color-surface-selected",
      "color-canvas",
      "color-surface",
      "color-surface-raised",
      "color-border",
      "color-border-hover",
      "color-focus-strong",
      "color-text",
      "color-text-muted",
      "color-text-faint",
      "color-danger",
      "color-danger-ink",
      "color-danger-surface",
      "color-shadow",
      "color-control-border",
      "color-focus",
      "color-accent-ink",
      "color-overlay",
      "color-surface-hover",
      "color-surface-active",
      "color-accent-hover",
      "color-accent-active",
      "button-primary-background",
      "button-primary-ink",
      "field-background",
      "field-border",
      "field-ink",
      "state-error-ink",
      "focus-color",
    ]);
    const variables = [...css.matchAll(/^\s*--([a-z-]+):/gm)].map((match) => {
      const name = match[1];
      if (!name) throw new Error("Expected a captured CSS variable name");
      return name;
    });
    expect(variables).not.toHaveLength(0);
    expect(variables.every((name) => allowed.has(name))).toBe(true);
    expect(css.match(/color-scheme: light/g)).toHaveLength(1);
    expect(css.match(/color-scheme: dark/g)).toHaveLength(7);
  });
});

it("keeps classic-v1 frozen and distinct from the mutable system fallback", async () => {
  const classic = JSON.parse(
    await readFile(
      new URL(
        "../../../../tokens/player-themes/classic-v1.tokens.json",
        import.meta.url,
      ),
      "utf8",
    ),
  );
  expect(classic.version).toBe(1);
  expect(classic.colorScheme).toBe("dark");
  expect(Object.keys(classic.tokens)).toHaveLength(16);
  // Immutable v1 source: change version/migration, not this historical digest,
  // when intentionally defining a different classic appearance.
  expect(
    createHash("sha256").update(JSON.stringify(classic.tokens)).digest("hex"),
  ).toBe("52de2d2139e554c0b6961524a7a4790ccc38a23197af9bcdade5ce4b42d73563");
  expect(
    resolvePlayerThemeId({
      selectedThemeId: "classic-v1",
      defaultThemeId: "light",
    }),
  ).toBe("classic-v1");
  expect(resolvePlayerThemeId({ defaultThemeId: "classic-v1" })).toBe(
    "classic-v1",
  );
  expect(
    resolvePlayerThemeId({
      selectedThemeId: "system",
      defaultThemeId: "classic-v1",
    }),
  ).toBe("system");
  const css = await readFile(
    new URL("./player-themes.generated.css", import.meta.url),
    "utf8",
  );
  const block = css
    .split('html[data-player-theme="classic-v1"] {')[1]
    ?.split("}")[0];
  expect(block).toBeDefined();
  expect(block).not.toContain("var(");
  expect(block).not.toMatch(
    /--(?:game-|color-success|color-card-|size-|arken-layer-)/,
  );
  for (const [name, token] of Object.entries(classic.tokens)) {
    expect(block).toContain(
      `--${name}: ${(token as { $value: string }).$value};`,
    );
  }
});

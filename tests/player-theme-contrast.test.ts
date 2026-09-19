import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

type Color = readonly [number, number, number, number];
type Tokens = Record<string, { $value: string }>;
const source: { themes: Record<string, { tokens: Tokens }> } = JSON.parse(
  await readFile(
    new URL(
      "../tokens/player-themes/player-themes.tokens.json",
      import.meta.url,
    ),
    "utf8",
  ),
);

function color(value: string): Color {
  if (/^#[0-9a-f]{6}$/i.test(value)) {
    return [
      parseInt(value.slice(1, 3), 16),
      parseInt(value.slice(3, 5), 16),
      parseInt(value.slice(5, 7), 16),
      1,
    ];
  }
  const match = /^rgba\((\d+), (\d+), (\d+), (0|1|0\.\d+|1\.0+)\)$/.exec(value);
  if (!match) throw new Error(`Unsupported color: ${value}`);
  const result: Color = [
    Number(match[1]),
    Number(match[2]),
    Number(match[3]),
    Number(match[4]),
  ];
  if (result.slice(0, 3).some((channel) => channel > 255) || result[3] > 1)
    throw new Error(`Invalid color: ${value}`);
  return result;
}
function over(foreground: Color, background: Color): Color {
  if (background[3] !== 1)
    throw new Error("Resolve the backing surface before compositing");
  const a = foreground[3];
  return [
    foreground[0] * a + background[0] * (1 - a),
    foreground[1] * a + background[1] * (1 - a),
    foreground[2] * a + background[2] * (1 - a),
    1,
  ];
}
function luminance(c: Color) {
  const linear = (v: number) => {
    const s = v / 255;
    return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return linear(c[0]) * 0.2126 + linear(c[1]) * 0.7152 + linear(c[2]) * 0.0722;
}
function ratio(a: Color, b: Color) {
  const x = luminance(a),
    y = luminance(b);
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
}

it("baseline text accent stays readable on every base surface, unlike fill accent", async () => {
  const base = JSON.parse(
    await readFile(
      new URL("../tokens/color.tokens.json", import.meta.url),
      "utf8",
    ),
  ) as {
    color: Tokens;
    palette: Record<string, Tokens>;
  };
  const resolve = (role: string) => {
    const reference = /^\{palette\.([^.]+)\.([^}]+)\}$/.exec(
      base.color[role].$value,
    );
    if (!reference) throw new Error(`Unsupported baseline reference: ${role}`);
    return color(base.palette[reference[1]][reference[2]].$value);
  };
  for (const surface of [
    "canvas",
    "surface",
    "surface-raised",
    "surface-hover",
    "surface-active",
  ])
    expect(
      ratio(resolve("text-accent"), resolve(surface)),
      surface,
    ).toBeGreaterThanOrEqual(4.5);
  // Negative control: the actual original fill accent is unsuitable for text.
  expect(ratio(resolve("accent"), resolve("surface"))).toBeLessThan(4.5);
});
function matrix(tokens: Tokens) {
  const get = (key: string) => {
    const token = tokens[key];
    if (!token) throw new Error(`Missing theme token: ${key}`);
    return color(token.$value);
  };
  const surface = over(get("color-surface"), get("color-canvas"));
  const checks: {
    foreground: string;
    background: string;
    ratio: number;
    minimum: number;
  }[] = [];
  const check = (foreground: string, background: string, minimum: number) => {
    const backing = over(get(background), surface);
    checks.push({
      foreground,
      background,
      minimum,
      ratio: ratio(over(get(foreground), backing), backing),
    });
  };
  for (const background of [
    "color-canvas",
    "color-surface",
    "color-surface-raised",
    "color-overlay",
    "color-surface-hover",
    "color-surface-active",
    "color-surface-selected",
  ]) {
    for (const foreground of [
      "color-text",
      "color-text-muted",
      "color-text-faint",
      "color-text-accent",
    ])
      check(foreground, background, 4.5);
    check("color-focus", background, 3);
  }
  // Error copy is contracted on the form/overlay surface, not arbitrary tinted selections.
  for (const background of [
    "color-surface",
    "color-surface-raised",
    "color-overlay",
  ])
    check("state-error-ink", background, 4.5);
  // Preserve the original root-suite cases while consolidating the guards.
  check("state-error-ink", "color-canvas", 4.5);
  check("field-border", "color-surface", 3);
  check("color-danger-ink", "color-danger", 4.5);
  check("field-ink", "field-background", 4.5);
  check("field-border", "field-background", 3);
  check("focus-color", "field-background", 3);
  for (const background of [
    "button-primary-background",
    "color-accent-hover",
    "color-accent-active",
  ])
    check("button-primary-ink", background, 4.5);
  return checks;
}

it("migrated small labels use text accent, leaving selected resize borders decorative", async () => {
  const css = await readFile(
    new URL("../apps/web/src/styles.css", import.meta.url),
    "utf8",
  );
  const selectors = [
    '.resize-settings-popover button[aria-pressed="true"]',
    ".slash-command-suggestions code",
    ".message-character",
    ".landing-kicker",
    ".landing-roadmap li::before",
    ".story-post__media-fallback",
    ".quick-roll-panel__gm-only",
  ];
  for (const selector of selectors) {
    const block = css
      .split(`${selector} {`)
      .slice(1)
      .map((part) => part.split("}")[0])
      .join(";");
    expect(block, selector).toMatch(
      /(?:^|;)\s*color: var\(--color-text-accent\);/,
    );
  }
  expect(css.split(`${selectors[0]} {`)[1]?.split("}")[0]).toContain(
    "border-color: var(--accent);",
  );
});
function requireContrast(tokens: Tokens) {
  const failed = matrix(tokens).filter((check) => check.ratio < check.minimum);
  if (failed.length) throw new Error(JSON.stringify(failed));
}

it("uses checked semantic error surfaces and does not recolor game success", async () => {
  const css = await readFile(
    new URL("../apps/web/src/styles.css", import.meta.url),
    "utf8",
  );
  // A class can have a shared geometry rule before its semantic state rule.
  // Collect its exact selector lines, not an arbitrary first substring hit.
  const block = (selector: string) =>
    [
      ...css.matchAll(
        new RegExp(
          `^${selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")} \\{([^}]*)\\}`,
          "gm",
        ),
      ),
    ]
      .map((match) => match[1])
      .join("\n");
  for (const selector of [".error-box", ".toast"]) {
    expect(block(selector)).toContain("background: var(--surface);");
    expect(block(selector)).toContain(
      "color: var(--state-error-ink, var(--danger));",
    );
    expect(block(selector)).not.toContain("color-mix");
  }
  for (const selector of [
    ".field-error",
    ".danger-link",
    ".asset-picker__warning",
  ])
    expect(block(selector)).toContain(
      "color: var(--state-error-ink, var(--danger));",
    );
  for (const selector of [".field-notice", ".world-map-lifecycle--published"])
    expect(block(selector)).toContain("color: var(--text);");
  expect(css).not.toContain("var(--surface-active)");
  expect(css).toContain("--ok: var(--color-success);");
});

it("uses readable light-theme ink for critical roll text without recoloring game outcomes", async () => {
  const bridge = await readFile(
    new URL(
      "../apps/web/src/design-system/player-theme-gravity.css",
      import.meta.url,
    ),
    "utf8",
  );
  const normalized = bridge.replace(/\s+/g, " ");
  const textTargets =
    ":is(.roll-total, .skill-chat-card__result > strong, .roll-critical-label)";
  const lightFailure = normalized.split(
    `html[data-player-theme="light"] .roll-result--critical-failure ${textTargets} {`,
  )[1];
  const lightSuccess = normalized.split(
    `html[data-player-theme="light"] .roll-result--critical-success ${textTargets} {`,
  )[1];
  expect(lightFailure?.split("}")[0]).toContain(
    "color: var(--state-error-ink);",
  );
  expect(lightSuccess?.split("}")[0]).toContain("color: var(--color-text);");
  expect(normalized).not.toContain(
    'html[data-player-theme="light"] .roll-result--critical-success {',
  );
  expect(normalized).not.toContain(
    'html[data-player-theme="light"] .roll-result--critical-failure {',
  );
});

it("resolves legacy entity-state text from the active canonical theme", async () => {
  const bridge = await readFile(
    new URL(
      "../apps/web/src/design-system/player-theme-gravity.css",
      import.meta.url,
    ),
    "utf8",
  );
  const block =
    bridge
      .split(
        'html[data-player-theme]:not([data-player-theme="classic-v1"]) {',
      )[1]
      ?.split("}")[0] ?? "";
  expect(block).toContain("--arken-ui-text: var(--color-text);");
  expect(block).toContain("--arken-ui-muted: var(--color-text-muted);");
  expect(block).toContain("--arken-ui-border: var(--color-control-border);");
});

describe("personal theme semantic contrast (flat token surfaces only)", () => {
  it("checks known luminance endpoints without rounding away failures", () => {
    expect(ratio(color("#000000"), color("#ffffff"))).toBe(21);
    expect(ratio(color("#787878"), color("#787878"))).toBe(1);
    expect(over(color("rgba(0, 0, 0, 0.5)"), color("#ffffff"))).toEqual([
      127.5, 127.5, 127.5, 1,
    ]);
    expect(ratio(color("#777777"), color("#ffffff"))).toBeLessThan(4.5);
    expect(ratio(color("#767676"), color("#ffffff"))).toBeGreaterThan(4.5);
  });
  it("composites alpha before contrast and refuses unresolved backgrounds", () => {
    expect(over(color("rgba(255, 0, 0, 0.5)"), color("#000000"))).toEqual([
      127.5, 0, 0, 1,
    ]);
    expect(() => over(color("#ffffff"), color("rgba(0, 0, 0, 0.5)"))).toThrow(
      /backing surface/,
    );
    expect(() => color("rgba(300, 0, 0, 0.5)")).toThrow(/Invalid color/);
  });
  it.each(Object.entries(source.themes))(
    "%s meets its 47 declared text/control/focus pairs",
    (_id, theme) => {
      expect(matrix(theme.tokens)).toHaveLength(47);
      expect(() => requireContrast(theme.tokens)).not.toThrow();
    },
  );
  it.each(["field-ink", "focus-color"])(
    "rejects a low-contrast regression in %s",
    (foreground) => {
      const theme = source.themes.light;
      if (!theme) throw new Error("Missing light theme");
      const tokens = structuredClone(theme.tokens);
      tokens[foreground] = { $value: "#f7f3ea" };
      expect(() => requireContrast(tokens)).toThrow(foreground);
    },
  );
  it("does not silently ignore missing role tokens", () => {
    const theme = source.themes.forest;
    if (!theme) throw new Error("Missing forest theme");
    const tokens = structuredClone(theme.tokens);
    delete tokens["field-border"];
    expect(() => requireContrast(tokens)).toThrow(
      "Missing theme token: field-border",
    );
  });
});

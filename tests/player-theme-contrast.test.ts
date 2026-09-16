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
function requireContrast(tokens: Tokens) {
  const failed = matrix(tokens).filter((check) => check.ratio < check.minimum);
  if (failed.length) throw new Error(JSON.stringify(failed));
}

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

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

type RGB = readonly [number, number, number];
function paint(value: string, backdrop: RGB): RGB {
  const hex = /^#([\da-f]{6})$/i.exec(value);
  if (hex)
    return [0, 2, 4].map((offset) =>
      parseInt(hex[1]!.slice(offset, offset + 2), 16),
    ) as unknown as RGB;
  const rgba = /^rgba\((\d+),\s*(\d+),\s*(\d+),\s*([\d.]+)\)$/.exec(value);
  if (!rgba) throw new Error(`Unsupported theme color: ${value}`);
  const alpha = Number(rgba[4]);
  if (alpha < 0 || alpha > 1) throw new Error("Invalid alpha");
  return [1, 2, 3].map(
    (index, channel) =>
      Number(rgba[index]) * alpha + backdrop[channel]! * (1 - alpha),
  ) as unknown as RGB;
}
function contrast(a: RGB, b: RGB) {
  const luminance = (rgb: RGB) =>
    rgb
      .map((value) => {
        const channel = value / 255;
        return channel <= 0.04045
          ? channel / 12.92
          : ((channel + 0.055) / 1.055) ** 2.4;
      })
      .reduce(
        (sum, value, index) => sum + value * [0.2126, 0.7152, 0.0722][index]!,
        0,
      );
  const x = luminance(a),
    y = luminance(b);
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
}
const source = JSON.parse(
  readFileSync(
    new URL(
      "../tokens/player-themes/player-themes.tokens.json",
      import.meta.url,
    ),
    "utf8",
  ),
) as { themes: Record<string, { tokens: Record<string, { $value: string }> }> };

describe("UIX-317 settled theme token contrast", () => {
  it("uses linear luminance and composites translucent surfaces before comparison", () => {
    expect(contrast([0, 0, 0], [255, 255, 255])).toBe(21);
    expect(contrast([120, 120, 120], [120, 120, 120])).toBe(1);
    expect(paint("rgba(0, 0, 0, 0.5)", [255, 255, 255])).toEqual([
      127.5, 127.5, 127.5,
    ]);
    expect(contrast(paint("#777777", [0, 0, 0]), [255, 255, 255])).toBeLessThan(
      4.5,
    );
  });
  for (const [id, theme] of Object.entries(source.themes)) {
    it(`${id}: text, fields, enabled actions and focus keep required contrast`, () => {
      const value = (name: string) => {
        const token = theme.tokens[name];
        if (!token) throw new Error(`${id} missing ${name}`);
        return token.$value;
      };
      const canvas = paint(value("color-canvas"), [0, 0, 0]);
      const surface = paint(value("color-surface"), canvas);
      const check = (
        ink: string,
        background: RGB,
        minimum: number,
        label: string,
      ) =>
        expect(
          contrast(paint(value(ink), background), background),
          `${id} ${label}`,
        ).toBeGreaterThanOrEqual(minimum);
      // Solid configured roles only. Browser cascade, transitions, textures and
      // disabled exemptions are deliberately not inferred from these numbers.
      for (const backgroundName of [
        "color-canvas",
        "color-surface",
        "color-overlay",
        "color-surface-raised",
      ]) {
        const background = paint(value(backgroundName), surface);
        for (const ink of [
          "color-text",
          "color-text-muted",
          "color-text-faint",
          "state-error-ink",
        ])
          check(ink, background, 4.5, `${ink} on ${backgroundName}`);
        check("color-focus", background, 3, `focus on ${backgroundName}`);
      }
      const field = paint(value("field-background"), surface);
      check("field-ink", field, 4.5, "field text");
      check(
        "field-border",
        surface,
        3,
        "field border against surrounding surface",
      );
      for (const backgroundName of [
        "button-primary-background",
        "color-accent-hover",
        "color-accent-active",
      ])
        check(
          "button-primary-ink",
          paint(value(backgroundName), surface),
          4.5,
          `primary text on ${backgroundName}`,
        );
      check(
        "color-danger-ink",
        paint(value("color-danger"), surface),
        4.5,
        "filled danger text",
      );
    });
  }
});

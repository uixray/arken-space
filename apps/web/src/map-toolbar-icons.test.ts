import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const styles = readFileSync(
  fileURLToPath(new URL("./styles.css", import.meta.url)),
  "utf8",
);
const toolbarSources = [
  readFileSync(fileURLToPath(new URL("./App.tsx", import.meta.url)), "utf8"),
  readFileSync(
    fileURLToPath(new URL("./MapToolbar.tsx", import.meta.url)),
    "utf8",
  ),
  readFileSync(
    fileURLToPath(new URL("./ui/CursorPresenceMenu.tsx", import.meta.url)),
    "utf8",
  ),
];

const toolbarToolIds = [
  ...new Set(
    toolbarSources.flatMap((source) =>
      [...source.matchAll(/\bdata-tool="([A-Z_]+)"/g)].map(
        (match) => match[1]!,
      ),
    ),
  ),
].sort();

const decodeCssGlyph = (value: string) =>
  value
    .replace(/\\([0-9a-f]{1,6})\s?/gi, (_, codePoint: string) =>
      String.fromCodePoint(Number.parseInt(codePoint, 16)),
    )
    .replace(/\\(.)/g, "$1");

describe("map toolbar icon styles", () => {
  it("provides a non-empty glyph for every current toolbar data-tool", () => {
    expect(toolbarToolIds).toEqual(
      expect.arrayContaining([
        "FOG_BRUSH",
        "COVER_BRUSH",
        "FOG_POLYGON",
        "COVER_POLYGON",
        "ENCOUNTER_START",
        "ENCOUNTER_END",
      ]),
    );
    expect(toolbarToolIds.length).toBeGreaterThan(6);

    for (const tool of toolbarToolIds) {
      const rule = styles.match(
        new RegExp(
          `\\[data-tool="${tool}"\\]::before\\s*\\{[^}]*?content:\\s*(["'])(.*?)\\1\\s*;`,
        ),
      );
      expect(rule, `${tool} must have a quoted ::before content rule`).not.toBe(
        null,
      );

      const glyph = decodeCssGlyph(rule?.[2] ?? "");
      expect(
        [...glyph].some(
          (character) =>
            character.trim().length > 0 && character.codePointAt(0) !== 0,
        ),
        `${tool} must render a real, non-whitespace glyph`,
      ).toBe(true);
    }
  });
});

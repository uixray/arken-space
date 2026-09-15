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

describe("map toolbar icon styles", () => {
  it("does not duplicate the rendered SVG icons with CSS glyphs", () => {
    expect(toolbarToolIds).toEqual(
      expect.arrayContaining([
        "FOG_BRUSH",
        "COVER_BRUSH",
        "FOG_POLYGON",
        "COVER_POLYGON",
      ]),
    );
    expect(toolbarToolIds.length).toBeGreaterThan(6);

    for (const tool of toolbarToolIds) {
      const rule = styles.match(
        new RegExp(
          `\\[data-tool="${tool}"\\]::before\\s*\\{[^}]*?content:\\s*(["'])(.*?)\\1\\s*;`,
        ),
      );
      // Actual SVG presence/geometry is checked by MapToolbar DOM and App E2E.
      expect(rule, `${tool} must not generate a second icon via CSS`).toBe(
        null,
      );
    }
  });
});

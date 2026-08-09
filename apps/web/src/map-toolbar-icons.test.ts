import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const styles = readFileSync(
  fileURLToPath(new URL("./styles.css", import.meta.url)),
  "utf8",
);

describe("map toolbar icon styles", () => {
  it("provides visible glyphs for every non-original toolbar action", () => {
    for (const tool of [
      "FOG_BRUSH",
      "COVER_BRUSH",
      "FOG_POLYGON",
      "COVER_POLYGON",
      "ENCOUNTER_START",
      "ENCOUNTER_END",
    ]) {
      expect(styles).toMatch(
        new RegExp(`\\[data-tool="${tool}"\\]::before\\s*\\{\\s*content:`),
      );
    }
  });
});

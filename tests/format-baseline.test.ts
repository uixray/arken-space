import { describe, expect, it } from "vitest";
import {
  assessFormatting,
  contentHash,
} from "../scripts/check-format-baseline.mjs";

const legacy = {
  path: "src/intentional.ts",
  text: "const x={a:1};\n",
  formatted: false,
};
const baseline = { [legacy.path]: contentHash(legacy.text) };

describe("owner-approved formatting baseline", () => {
  it("accepts only unchanged recorded violations", () => {
    expect(assessFormatting([legacy], baseline)).toEqual({
      failures: [],
      accepted: 1,
    });
    expect(
      assessFormatting([{ ...legacy, text: "const x={a:2};\n" }], baseline)
        .failures,
    ).toEqual(["NEW_OR_CHANGED_FORMATTING: src/intentional.ts"]);
  });

  it("permits transport EOL differences but never layout/whitespace changes", () => {
    expect(
      assessFormatting(
        [{ ...legacy, text: legacy.text.replaceAll("\n", "\r\n") }],
        baseline,
      ).failures,
    ).toEqual([]);
    expect(contentHash(legacy.text + " ")).not.toEqual(
      contentHash(legacy.text),
    );
    expect(contentHash(legacy.text.replace("={", "= {"))).not.toEqual(
      contentHash(legacy.text),
    );
  });

  it("rejects new violations while accepting new formatted files", () => {
    expect(
      assessFormatting([{ ...legacy, path: "src/new.ts" }], {}).failures,
    ).toEqual(["NEW_OR_CHANGED_FORMATTING: src/new.ts"]);
    expect(
      assessFormatting(
        [{ ...legacy, path: "src/new.ts", formatted: true }],
        {},
      ),
    ).toEqual({ failures: [], accepted: 0 });
  });

  it("requires explicit removal of entries once formatted, deleted or ignored", () => {
    expect(
      assessFormatting([{ ...legacy, formatted: true }], baseline).failures,
    ).toEqual(["STALE_BASELINE: src/intentional.ts"]);
    expect(assessFormatting([], baseline).failures).toEqual([
      "MISSING_OR_IGNORED_BASELINE: src/intentional.ts",
    ]);
  });
});

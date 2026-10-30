import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { createWorldContentSchema } from "../packages/contracts/src/index.js";
import { createHash } from "node:crypto";

/** UIX-263: the bundled artbook reference stays importable and traceable. */
const source = JSON.parse(
  readFileSync(
    new URL("../docs/content/world-artbook.json", import.meta.url),
    "utf8",
  ),
) as {
  записи: Array<{
    slug: string;
    type: string;
    name: string;
    summary: string;
    cover: string | null;
    sourceUrl: string;
    rawContentHash: string;
  }>;
};

describe("world artbook reference", () => {
  it("has 78 unique records that the create command accepts", () => {
    expect(source.записи).toHaveLength(78);
    const slugs = source.записи.map((record) => record.slug);
    expect(new Set(slugs).size).toBe(slugs.length);
    for (const record of source.записи)
      expect(
        createWorldContentSchema.safeParse({
          actionId: "00000000-0000-4000-8000-000000000001",
          slug: record.slug,
          type: record.type,
          name: record.name,
          summary: record.summary,
          provenance: {
            sourceUrl: record.sourceUrl,
            sourceExternalId: record.slug,
            retrievedAt: "2026-10-22T00:00:00.000Z",
            rawContentHash: record.rawContentHash,
            attribution: "x",
            rightsReviewStatus: "APPROVED",
            editorialApprovalStatus: "PENDING",
          },
        }).success,
        record.slug,
      ).toBe(true);
  });

  it("hashes exactly the imported text and maps every record to a cover", () => {
    for (const record of source.записи) {
      const hash = createHash("sha256")
        .update(`${record.name}\n${record.summary}`)
        .digest("hex");
      expect(record.rawContentHash).toBe(`sha256:${hash}`);
      expect(record.cover, record.name).toMatch(
        /^(Пантеон|Локации|Персонажи|Существа)\//,
      );
    }
  });
});

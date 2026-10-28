import { describe, expect, it } from "vitest";
import { modifierSourceSchema } from "../packages/contracts/src/index";

describe("SKILL modifier references", () => {
  it("requires UUIDs for catalog-backed entries but preserves arbitrary legacy keys", () => {
    expect(
      modifierSourceSchema.safeParse({
        type: "SKILL",
        scope: "CATALOG",
        key: "11111111-1111-4111-8111-111111111111",
      }).success,
    ).toBe(true);
    expect(
      modifierSourceSchema.safeParse({
        type: "SKILL",
        scope: "CHARACTER_ENTRY",
        key: "not-a-uuid",
      }).success,
    ).toBe(false);
    expect(
      modifierSourceSchema.safeParse({
        type: "SKILL",
        scope: "LEGACY",
        key: "old-skill-key/with-existing-format",
      }).success,
    ).toBe(true);
  });
});

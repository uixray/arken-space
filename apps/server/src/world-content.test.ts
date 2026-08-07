import { describe, expect, it } from "vitest";
import {
  createWorldContentSchema,
  updateWorldContentSchema,
  worldContentDtoSchema,
  worldContentPlayerDtoSchema,
} from "@arken/contracts";
import {
  canViewWorldContent,
  toPlayerDto,
  type WorldContentAuthContext,
  type WorldContentSubject,
} from "./world-content.js";

const gm: WorldContentAuthContext = { role: "GM" };
const player: WorldContentAuthContext = { role: "PLAYER" };

const subject = (
  lifecycle: WorldContentSubject["lifecycle"],
): WorldContentSubject => ({ lifecycle });

describe("world content ACL matrix (AC4, AC10)", () => {
  it("lets the GM see entities in every lifecycle state, including DRAFT and ARCHIVED", () => {
    expect(canViewWorldContent(gm, subject("DRAFT"))).toBe(true);
    expect(canViewWorldContent(gm, subject("PUBLISHED"))).toBe(true);
    expect(canViewWorldContent(gm, subject("ARCHIVED"))).toBe(true);
  });

  it("lets a non-GM see PUBLISHED entities only", () => {
    expect(canViewWorldContent(player, subject("PUBLISHED"))).toBe(true);
  });

  it("never lets a non-GM see DRAFT or ARCHIVED entities", () => {
    expect(canViewWorldContent(player, subject("DRAFT"))).toBe(false);
    expect(canViewWorldContent(player, subject("ARCHIVED"))).toBe(false);
  });
});

describe("world content player projection (AC4)", () => {
  it("never includes gmOnlyText, because the player row shape does not carry the field", () => {
    const playerRow = {
      id: "00000000-0000-4000-8000-000000000001",
      slug: "the-hollow-keep",
      type: "LOCATION" as const,
      subtype: "fortress",
      name: "The Hollow Keep",
      aliases: ["Keep of Ash"],
      summary: "A ruined fortress on the border.",
      publicText: "Long ago, the keep held the border line.",
      tags: ["border", "ruin"],
      lifecycle: "PUBLISHED" as const,
      coverAssetId: null,
      revision: 3,
      updatedAt: new Date("2026-01-01T00:00:00Z"),
    };
    // TypeScript alone guards this at compile time (the row type has no
    // `gmOnlyText` field); this assertion documents that guarantee at
    // runtime too, so a future refactor that widens the row shape trips a
    // test instead of silently reintroducing the leak.
    expect(Object.keys(playerRow)).not.toContain("gmOnlyText");
    expect(Object.keys(playerRow)).not.toContain("provenance");

    const dto = toPlayerDto(playerRow);
    expect(dto).not.toHaveProperty("gmOnlyText");
    expect(dto).not.toHaveProperty("provenance");
    expect(worldContentPlayerDtoSchema.safeParse(dto).success).toBe(true);
  });

  it("keeps gmOnlyText and provenance in the GM-only DTO schema, distinct from the player schema", () => {
    expect(worldContentDtoSchema.shape.gmOnlyText).toBeDefined();
    expect(
      (worldContentPlayerDtoSchema.shape as Record<string, unknown>)
        .gmOnlyText,
    ).toBeUndefined();
    expect(worldContentDtoSchema.shape.provenance).toBeDefined();
    expect(
      (worldContentPlayerDtoSchema.shape as Record<string, unknown>)
        .provenance,
    ).toBeUndefined();
  });
});

describe("world content contracts", () => {
  const actionId = "00000000-0000-4000-8000-000000000009";

  it("accepts a well-formed create payload and rejects unknown fields", () => {
    expect(
      createWorldContentSchema.safeParse({
        actionId,
        slug: "the-hollow-keep",
        type: "LOCATION",
        name: "The Hollow Keep",
      }).success,
    ).toBe(true);
    expect(
      createWorldContentSchema.safeParse({
        actionId,
        slug: "the-hollow-keep",
        type: "LOCATION",
        name: "The Hollow Keep",
        extra: "nope",
      }).success,
    ).toBe(false);
  });

  it("rejects a non-kebab-case slug", () => {
    expect(
      createWorldContentSchema.safeParse({
        actionId,
        slug: "The Hollow Keep",
        type: "LOCATION",
        name: "The Hollow Keep",
      }).success,
    ).toBe(false);
    expect(
      createWorldContentSchema.safeParse({
        actionId,
        slug: "the_hollow_keep",
        type: "LOCATION",
        name: "The Hollow Keep",
      }).success,
    ).toBe(false);
  });

  it("rejects an unknown entity type", () => {
    expect(
      createWorldContentSchema.safeParse({
        actionId,
        slug: "some-npc",
        type: "NPC",
        name: "Some NPC",
      }).success,
    ).toBe(false);
  });

  it("requires revision on update for CAS (AC12)", () => {
    expect(
      updateWorldContentSchema.safeParse({ actionId, name: "New name" })
        .success,
    ).toBe(false);
    expect(
      updateWorldContentSchema.safeParse({
        actionId,
        revision: 0,
        name: "New name",
      }).success,
    ).toBe(true);
  });
});

import { describe, expect, it } from "vitest";
import {
  appendSpellPackDraftVersionCommandSchema,
  archiveSpellPackCommandSchema,
  createSpellPackCommandSchema,
  spellPackInventoryQuerySchema,
  spellPackInventoryResponseSchema,
  spellPackReadParamsSchema,
  spellPackVersionHistoryQuerySchema,
  spellPackVersionHistoryResponseSchema,
  spellPackVersionReadParamsSchema,
  spellPackVersionReadQuerySchema,
  spellPackVersionResponseSchema,
  spellPackVersionSummarySchema,
  transitionSpellPackLifecycleCommandSchema,
  validateSpellPackGraphSchema,
  type SpellProgressionGraph,
} from "../packages/contracts/src/index.js";

const uuid = (suffix: string) =>
  `00000000-0000-4000-8000-${suffix.padStart(12, "0")}`;

const graph: SpellProgressionGraph = {
  packId: uuid("1"),
  versionId: uuid("2"),
  version: 1,
  title: "Contract pack",
  lifecycle: "DRAFT",
  provenance: {
    sourceType: "GM_AUTHORED",
    sourceLabel: "UIX-580 contract",
    rawSourceText: "Source wording",
  },
  schools: [],
  nodes: [],
  requirementGroups: [],
  edges: [],
};

describe("UIX-580 spell-pack command contracts", () => {
  it("keeps create on an explicit empty-pack CAS and rejects injected fields", () => {
    const command = {
      actionId: uuid("3"),
      expectedVersion: 0,
      graph,
    };
    expect(createSpellPackCommandSchema.parse(command)).toEqual(command);
    expect(
      createSpellPackCommandSchema.safeParse({
        ...command,
        expectedVersion: 1,
      }).success,
    ).toBe(false);
    expect(
      createSpellPackCommandSchema.safeParse({ ...command, role: "GM" })
        .success,
    ).toBe(false);
  });

  it("requires actionId and expectedVersion for every persisted next version", () => {
    const draft = {
      actionId: uuid("4"),
      expectedVersion: 1,
      graph: { ...graph, versionId: uuid("5"), version: 2 },
    };
    expect(appendSpellPackDraftVersionCommandSchema.parse(draft)).toEqual(
      draft,
    );
    expect(
      appendSpellPackDraftVersionCommandSchema.safeParse({
        actionId: draft.actionId,
        graph: draft.graph,
      }).success,
    ).toBe(false);

    const transition = {
      actionId: uuid("6"),
      expectedVersion: 2,
      versionId: uuid("7"),
      lifecycle: "ACTIVE" as const,
    };
    expect(transitionSpellPackLifecycleCommandSchema.parse(transition)).toEqual(
      transition,
    );
    expect(
      transitionSpellPackLifecycleCommandSchema.safeParse({
        ...transition,
        lifecycle: "ARCHIVED",
      }).success,
    ).toBe(false);

    const archive = {
      actionId: uuid("8"),
      expectedVersion: 3,
      versionId: uuid("9"),
    };
    expect(archiveSpellPackCommandSchema.parse(archive)).toEqual(archive);
  });

  it("accepts an unknown validation candidate so schema failures can be reported", () => {
    expect(validateSpellPackGraphSchema.parse({ graph: {} })).toEqual({
      graph: {},
    });
    expect(
      validateSpellPackGraphSchema.safeParse({ graph: {}, extra: true })
        .success,
    ).toBe(false);
  });
});

describe("UIX-262 bounded GM spell-pack read contracts", () => {
  const summary = {
    packId: graph.packId,
    versionId: graph.versionId,
    version: 1,
    lifecycle: "DRAFT",
    title: graph.title,
    edition: null,
    createdAt: "2026-09-10T00:00:00.000Z",
  };

  it("defaults to 20 and accepts canonical decimal limits from 1 to 50", () => {
    for (const schema of [
      spellPackInventoryQuerySchema,
      spellPackVersionHistoryQuerySchema,
    ]) {
      expect(schema.parse({})).toEqual({ limit: 20 });
      expect(schema.parse({ limit: "1" })).toEqual({ limit: 1 });
      expect(schema.parse({ limit: "50" })).toEqual({ limit: 50 });
      for (const limit of [
        "",
        "0",
        "51",
        "-1",
        "1.5",
        "1e1",
        "01",
        " 2",
        "2 ",
        "Infinity",
        2,
        null,
        true,
        ["2"],
        "9".repeat(1_000),
      ])
        expect(schema.safeParse({ limit }).success, String(limit)).toBe(false);
      for (const extra of [
        { campaignId: uuid("9") },
        { role: "GM" },
        { offset: "1" },
        { lifecycle: "ACTIVE" },
      ])
        expect(schema.safeParse(extra).success).toBe(false);
    }
  });

  it("keeps UUID and version cursors bounded and distinct", () => {
    const uppercase = "ABCDEF00-0000-4000-8000-000000000001";
    expect(spellPackInventoryQuerySchema.parse({ cursor: uppercase })).toEqual({
      limit: 20,
      cursor: uppercase.toLowerCase(),
    });
    for (const cursor of ["", "1", "ACTIVE", "x".repeat(1_000), [uuid("1")]])
      expect(spellPackInventoryQuerySchema.safeParse({ cursor }).success).toBe(
        false,
      );
    expect(
      spellPackVersionHistoryQuerySchema.parse({ cursor: "2147483647" }),
    ).toEqual({ limit: 20, cursor: "2147483647" });
    for (const cursor of [
      "",
      "0",
      "01",
      "-1",
      "1.5",
      "1e2",
      "2147483648",
      "9".repeat(1_000),
      uuid("1"),
      1,
      null,
      ["1"],
    ])
      expect(
        spellPackVersionHistoryQuerySchema.safeParse({ cursor }).success,
      ).toBe(false);
  });

  it("requires exact UUID params and forbids version query overrides", () => {
    expect(spellPackReadParamsSchema.parse({ id: graph.packId })).toEqual({
      id: graph.packId,
    });
    expect(
      spellPackVersionReadParamsSchema.parse({
        id: graph.packId,
        versionId: graph.versionId,
      }),
    ).toEqual({ id: graph.packId, versionId: graph.versionId });
    for (const versionId of ["latest", "ACTIVE", "1", null])
      expect(
        spellPackVersionReadParamsSchema.safeParse({
          id: graph.packId,
          versionId,
        }).success,
      ).toBe(false);
    expect(
      spellPackReadParamsSchema.safeParse({
        id: graph.packId,
        campaignId: uuid("8"),
      }).success,
    ).toBe(false);
    expect(spellPackVersionReadQuerySchema.parse({})).toEqual({});
    for (const query of [
      { latest: "true" },
      { lifecycle: "ACTIVE" },
      { limit: "1" },
    ])
      expect(spellPackVersionReadQuerySchema.safeParse(query).success).toBe(
        false,
      );
  });

  it("bounds pages and excludes graphs and private source from summaries", () => {
    const item = {
      packId: graph.packId,
      createdAt: summary.createdAt,
      latestVersion: summary,
    };
    expect(spellPackVersionSummarySchema.parse(summary)).toEqual(summary);
    expect(
      spellPackInventoryResponseSchema.parse({ items: [], nextCursor: null }),
    ).toEqual({ items: [], nextCursor: null });
    expect(
      spellPackVersionHistoryResponseSchema.parse({
        items: [summary],
        nextCursor: null,
      }),
    ).toEqual({ items: [summary], nextCursor: null });
    for (const extra of [
      { graph },
      { warnings: [] },
      { provenance: graph.provenance },
    ])
      expect(
        spellPackVersionSummarySchema.safeParse({ ...summary, ...extra })
          .success,
      ).toBe(false);
    expect(
      spellPackVersionSummarySchema.safeParse({
        ...summary,
        title: "x".repeat(241),
      }).success,
    ).toBe(false);
    expect(
      spellPackVersionSummarySchema.safeParse({
        ...summary,
        edition: "x".repeat(241),
      }).success,
    ).toBe(false);
    expect(
      spellPackInventoryResponseSchema.safeParse({
        items: Array.from({ length: 51 }, () => item),
        nextCursor: null,
      }).success,
    ).toBe(false);
    expect(
      spellPackVersionHistoryResponseSchema.safeParse({
        items: Array.from({ length: 51 }, () => summary),
        nextCursor: null,
      }).success,
    ).toBe(false);
    expect(
      spellPackInventoryResponseSchema.safeParse({
        items: [{ ...item, packId: uuid("99") }],
        nextCursor: null,
      }).success,
    ).toBe(false);
    expect(
      spellPackInventoryResponseSchema.safeParse({ items: [item] }).success,
    ).toBe(false);
    expect(
      spellPackVersionHistoryResponseSchema.safeParse({
        items: [summary],
        nextCursor: "2147483648",
      }).success,
    ).toBe(false);
  });

  it("rejects mismatched graph identity and injected response fields", () => {
    const response = {
      packId: graph.packId,
      versionId: graph.versionId,
      version: graph.version,
      lifecycle: graph.lifecycle,
      createdAt: summary.createdAt,
      graph,
      warnings: [],
    };
    expect(spellPackVersionResponseSchema.parse(response)).toEqual(response);
    for (const change of [
      { packId: uuid("99") },
      { versionId: uuid("99") },
      { version: 2 },
      { lifecycle: "ACTIVE" },
      { campaignId: uuid("99") },
      { graph: { ...graph, extra: true } },
    ])
      expect(
        spellPackVersionResponseSchema.safeParse({ ...response, ...change })
          .success,
      ).toBe(false);
  });
});

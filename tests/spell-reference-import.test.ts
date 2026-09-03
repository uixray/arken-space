import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  previewSpellReferenceImportCommandSchema,
  spellProgressionGraphSchema,
  spellReferenceImportPreviewResponseSchema,
  validateSpellProgressionGraph,
  type PreviewSpellReferenceImportCommand,
  type SpellReferenceImportSource,
} from "../packages/contracts/src/index.js";
import { previewSpellReferenceImport } from "../apps/server/src/spell-reference-import.js";

const packId = "00000000-0000-4000-8000-000000009001";
const versionId = "00000000-0000-4000-8000-000000009002";
const fixtureText = readFileSync(
  new URL("../docs/content/magic-schools.json", import.meta.url),
  "utf8",
);
const fixture = JSON.parse(fixtureText) as SpellReferenceImportSource;

function command(
  overrides: Partial<PreviewSpellReferenceImportCommand> = {},
): PreviewSpellReferenceImportCommand {
  return {
    packId,
    versionId,
    version: 1,
    source: fixture,
    ...overrides,
  };
}

describe("2024 spell reference preview", () => {
  it("persists the exact 13/145/114 source as REFERENCE with 31+6 review warnings", () => {
    const preview = previewSpellReferenceImport(command());
    const parsed = spellReferenceImportPreviewResponseSchema.parse(preview);

    expect(parsed.graph).toMatchObject({
      packId,
      versionId,
      version: 1,
      lifecycle: "REFERENCE",
    });
    expect(parsed.graph.schools).toHaveLength(13);
    expect(parsed.graph.nodes).toHaveLength(145);
    expect(parsed.graph.edges).toHaveLength(114);
    expect(
      parsed.graph.nodes.every((node) => node.lifecycle === "REFERENCE"),
    ).toBe(true);

    const importWarnings = parsed.graph.importWarnings ?? [];
    expect(importWarnings).toHaveLength(31);
    expect(
      importWarnings.every(
        (warning) =>
          warning.code === "SOURCE_AMBIGUITY" && warning.status === "OPEN",
      ),
    ).toBe(true);
    expect(parsed.validation).toMatchObject({ valid: true, errors: [] });
    expect(
      parsed.validation.warnings.filter(
        (issue) => issue.code === "OPEN_IMPORT_WARNING",
      ),
    ).toHaveLength(31);
    expect(
      parsed.validation.warnings.filter(
        (issue) => issue.code === "UNRESOLVED_REQUIREMENT_GROUP",
      ),
    ).toHaveLength(6);

    expect(parsed.graph.provenance.rawSourceText.length).toBeGreaterThan(
      50_000,
    );
    expect(JSON.parse(parsed.graph.provenance.rawSourceText)).toEqual(fixture);
    expect(
      parsed.graph.requirementGroups.every((group) => group.sourceNote),
    ).toBe(true);
  });

  it("uses stable child UUIDs without random preview noise", () => {
    const first = previewSpellReferenceImport(command());
    const second = previewSpellReferenceImport(command());
    expect(second).toEqual(first);

    const childIds = [
      ...first.graph.schools.map((school) => school.id),
      ...first.graph.nodes.map((node) => node.id),
      ...first.graph.requirementGroups.map((group) => group.id),
      ...first.graph.edges.map((edge) => edge.id),
      ...(first.graph.importWarnings ?? []).map((warning) => warning.id),
    ];
    expect(new Set(childIds).size).toBe(childIds.length);

    const nextVersion = previewSpellReferenceImport(
      command({ versionId: "00000000-0000-4000-8000-000000009003" }),
    );
    expect(nextVersion.graph.nodes[0]!.id).not.toBe(first.graph.nodes[0]!.id);

    const reorderedSource = structuredClone(fixture);
    reorderedSource.требуетУточнения.reverse();
    const reordered = previewSpellReferenceImport(
      command({ source: reorderedSource }),
    );
    const warningIdByMessage = new Map(
      (first.graph.importWarnings ?? []).map((warning) => [
        warning.message,
        warning.id,
      ]),
    );
    for (const warning of reordered.graph.importWarnings ?? [])
      expect(warning.id).toBe(warningIdByMessage.get(warning.message));
  });

  it("keeps ACTIVE outside the strict preview input and rejects oversized sources", () => {
    expect(
      previewSpellReferenceImportCommandSchema.safeParse({
        ...command(),
        lifecycle: "ACTIVE",
      }).success,
    ).toBe(false);

    const oversizedSource: SpellReferenceImportSource = {
      источник: {
        описания: "Bound test",
        деревья: "Bound test",
        предупреждение: "Bound test",
      },
      школы: [
        {
          ключ: "bounded",
          название: "Bounded",
          узлы: Array.from({ length: 6 }, (_, index) => ({
            название: `Node ${index}`,
            вариантНаСхеме: null,
            стоимостьМаны: null,
            частота: null,
            описание: "x".repeat(45_000),
          })),
          связи: [],
          безСвязей: [],
        },
      ],
      требуетУточнения: [],
    };
    expect(
      previewSpellReferenceImportCommandSchema.safeParse({
        ...command(),
        source: oversizedSource,
      }).success,
    ).toBe(false);
  });

  it("treats OPEN markers as ACTIVE errors and requires a resolution reason", () => {
    const preview = previewSpellReferenceImport(command());
    const activeGraph = structuredClone(preview.graph);
    activeGraph.lifecycle = "ACTIVE";
    const activeValidation = validateSpellProgressionGraph(activeGraph);
    expect(
      activeValidation.errors.filter(
        (issue) => issue.code === "OPEN_IMPORT_WARNING",
      ),
    ).toHaveLength(31);

    const blankResolution = structuredClone(preview.graph);
    blankResolution.importWarnings = (blankResolution.importWarnings ?? []).map(
      (warning) => ({
        ...warning,
        status: "RESOLVED" as const,
        resolutionReason: " ",
      }),
    );
    expect(spellProgressionGraphSchema.safeParse(blankResolution).success).toBe(
      false,
    );

    const resolved = structuredClone(preview.graph);
    resolved.lifecycle = "ACTIVE";
    resolved.importWarnings = (resolved.importWarnings ?? []).map(
      (warning) => ({
        ...warning,
        status: "RESOLVED" as const,
        resolutionReason:
          "Confirmed by the GM in a new immutable draft version",
      }),
    );
    const resolvedValidation = validateSpellProgressionGraph(
      spellProgressionGraphSchema.parse(resolved),
    );
    expect(
      resolvedValidation.errors.filter(
        (issue) => issue.code === "OPEN_IMPORT_WARNING",
      ),
    ).toEqual([]);
  });

  it("does not read or name the repository fixture from runtime code", () => {
    const runtimeSource = readFileSync(
      new URL("../apps/server/src/spell-reference-import.ts", import.meta.url),
      "utf8",
    );
    const serverDockerfile = readFileSync(
      new URL("../Dockerfile.server", import.meta.url),
      "utf8",
    );
    expect(runtimeSource).not.toContain("node:fs");
    expect(runtimeSource).not.toContain("magic-schools.json");
    expect(serverDockerfile).not.toMatch(/^COPY\s+docs(?:\/|\s)/mu);
  });
});

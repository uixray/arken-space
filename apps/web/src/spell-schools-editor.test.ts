import { describe, expect, it } from "vitest";
import {
  spellProgressionGraphSchema,
  validateSpellProgressionGraph,
} from "@arken/contracts";
import {
  createEmptySpellDraft,
  createPrerequisiteEdge,
  createPrerequisite,
  createRequirementGroup,
  createSpellNode,
  createSpellSchool,
  nextSpellDraftVersion,
} from "./spell-schools-editor";

describe("spell school draft editor model", () => {
  it("supports an empty school and disconnected nodes without inventing a link", () => {
    const empty = createEmptySpellDraft("Private draft");
    const school = createSpellSchool(empty, "Искры");
    const graph = { ...empty, schools: [school] };
    const first = createSpellNode(graph, school.id, "Огонёк");
    const second = createSpellNode(graph, school.id, "Светляк");
    const edited = { ...graph, nodes: [first, second] };
    expect(edited.edges).toEqual([]);
    expect(edited.requirementGroups).toEqual([]);
    expect(
      validateSpellProgressionGraph(spellProgressionGraphSchema.parse(edited))
        .errors,
    ).toEqual([]);
  });

  it("represents directed prerequisite groups and leaves invalid endpoints for validation", () => {
    const empty = createEmptySpellDraft("Draft");
    const school = createSpellSchool(empty, "Школа");
    const base = { ...empty, schools: [school] };
    const source = createSpellNode(base, school.id, "Начало");
    const target = createSpellNode(base, school.id, "Продолжение");
    const graph = { ...base, nodes: [source, target] };
    const relation = createPrerequisite(graph, source.id, target.id, "ANY");
    const linked = {
      ...graph,
      requirementGroups: [relation.group],
      edges: [relation.edge],
    };
    expect(linked.edges[0]).toMatchObject({
      sourceNodeId: source.id,
      targetNodeId: target.id,
      requirementGroupId: linked.requirementGroups[0]!.id,
    });
    expect(linked.requirementGroups[0]!.mode).toBe("ANY");
    expect(
      validateSpellProgressionGraph(spellProgressionGraphSchema.parse(linked))
        .errors,
    ).toEqual([]);

    const dangling = {
      ...linked,
      edges: [
        {
          ...relation.edge,
          sourceNodeId: "00000000-0000-4000-8000-000000000000",
        },
      ],
    };
    expect(
      validateSpellProgressionGraph(spellProgressionGraphSchema.parse(dangling))
        .errors.length,
    ).toBeGreaterThan(0);
  });

  it("adds multiple prerequisite edges to one explicit group and keeps group removal addressable", () => {
    const empty = createEmptySpellDraft("Draft");
    const school = createSpellSchool(empty, "Школа");
    const base = { ...empty, schools: [school] };
    const first = createSpellNode(base, school.id, "Первая ветка");
    const second = createSpellNode(base, school.id, "Вторая ветка");
    const target = createSpellNode(base, school.id, "Цель");
    const graph = { ...base, nodes: [first, second, target] };
    const group = createRequirementGroup(graph, target.id, "ANY");
    const grouped = { ...graph, requirementGroups: [group] };
    const firstEdge = createPrerequisiteEdge(grouped, first.id, group.id);
    const secondEdge = createPrerequisiteEdge(
      { ...grouped, edges: [firstEdge] },
      second.id,
      group.id,
    );
    const result = { ...grouped, edges: [firstEdge, secondEdge] };
    expect(result.requirementGroups).toHaveLength(1);
    expect(result.edges.map((edge) => edge.requirementGroupId)).toEqual([
      group.id,
      group.id,
    ]);
    expect(
      validateSpellProgressionGraph(spellProgressionGraphSchema.parse(result))
        .errors,
    ).toEqual([]);
  });

  it("appends a new DRAFT version while preserving advanced fields and provenance", () => {
    const empty = createEmptySpellDraft("Draft");
    const school = createSpellSchool(empty, "Школа");
    const node = createSpellNode(
      { ...empty, schools: [school] },
      school.id,
      "Узел",
    );
    const source = {
      ...empty,
      provenance: {
        ...empty.provenance,
        attribution: "Explicit source note",
        sourceUrl: "https://example.test/source",
      },
      importWarnings: [
        {
          id: crypto.randomUUID(),
          code: "SOURCE_AMBIGUITY" as const,
          path: "nodes[0]",
          message: "Review later",
          status: "OPEN" as const,
          entityId: node.id,
        },
      ],
      layout: {
        schools: [{ schoolId: school.id, position: { x: 8, y: 12 }, order: 1 }],
      },
      compatibility: { schemaVersion: 1, minimumClientVersion: "0.1.0" },
      schools: [school],
      nodes: [
        {
          ...node,
          costs: [
            {
              resource: "Mana",
              amount: { kind: "FORMULA" as const, formula: "rank + 1" },
              timing: "PER_TURN" as const,
              rawText: "advanced cost",
            },
          ],
          usageLimit: {
            maxUses: 2,
            cadence: {
              kind: "CUSTOM" as const,
              rawText: "when the moon is full",
            },
          },
        },
      ],
    };
    const next = nextSpellDraftVersion(source, crypto.randomUUID());
    expect(next.version).toBe(source.version + 1);
    expect(next.lifecycle).toBe("DRAFT");
    expect(next.provenance).toEqual(source.provenance);
    expect(next.importWarnings).toEqual(source.importWarnings);
    expect(next.layout).toEqual(source.layout);
    expect(next.compatibility).toEqual(source.compatibility);
    expect(next.nodes[0]!.costs).toEqual(source.nodes[0]!.costs);
    expect(next.nodes[0]!.usageLimit).toEqual(source.nodes[0]!.usageLimit);
    expect(next.nodes[0]!.packVersionId).toBe(next.versionId);
  });
});

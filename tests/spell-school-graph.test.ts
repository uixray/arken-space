import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  spellPackLifecycleSchema,
  spellProgressionGraphSchema,
  spellRequirementGroupModeSchema,
  spellSchoolVisibilityPolicySchema,
  spellUsageCadenceSchema,
  validateSpellProgressionGraph,
  type SpellGraphValidationIssue,
  type SpellProgressionGraph,
  type SpellReferenceImportSource,
} from "../packages/contracts/src/index.js";
import { previewSpellReferenceImport } from "../apps/server/src/spell-reference-import.js";

const uuid = (value: number): string =>
  `00000000-0000-4000-8000-${value.toString().padStart(12, "0")}`;

const ids = {
  pack: uuid(1),
  version: uuid(2),
  school: uuid(10),
  emptySchool: uuid(11),
  root: uuid(100),
  left: uuid(101),
  right: uuid(102),
  allTarget: uuid(103),
  anyTarget: uuid(104),
  isolated: uuid(105),
  groupLeft: uuid(200),
  groupRight: uuid(201),
  groupAll: uuid(202),
  groupAny: uuid(203),
  edgeRootLeft: uuid(300),
  edgeRootRight: uuid(301),
  edgeLeftAll: uuid(302),
  edgeRightAll: uuid(303),
  edgeLeftAny: uuid(304),
  edgeRightAny: uuid(305),
};

type SpellNode = SpellProgressionGraph["nodes"][number];

function node(
  id: string,
  sourceName: string,
  activation: SpellNode["activation"] = {
    passive: true,
    triggers: [],
  },
  schoolId = ids.school,
): SpellNode {
  return {
    packId: ids.pack,
    packVersionId: ids.version,
    id,
    schoolId,
    sourceName,
    displayName: sourceName,
    rawSourceText: `${sourceName}: исходная формулировка`,
    narrativeText: `${sourceName}: описание`,
    mechanicsText: `${sourceName}: механика`,
    lifecycle: "ACTIVE",
    revision: 0,
    revisionProvenance: {
      sourceRevision: "synthetic-v1",
      changeNote: "Исходная версия синтетического графа",
    },
    activation,
    costs: [],
    usageLimit: null,
  };
}

function graphFixture(): SpellProgressionGraph {
  const graph: SpellProgressionGraph = {
    packId: ids.pack,
    versionId: ids.version,
    version: 1,
    title: "Проверочный набор школ",
    lifecycle: "ACTIVE",
    provenance: {
      sourceType: "GM_AUTHORED",
      sourceLabel: "Synthetic test fixture",
      rawSourceText: "Synthetic test fixture",
    },
    schools: [
      {
        packId: ids.pack,
        packVersionId: ids.version,
        id: ids.school,
        slug: "synthetic",
        sourceName: "Проверочная школа",
        displayName: "Проверочная школа",
        description: "Школа с развилкой и двумя видами схождения.",
        visibilityPolicy: "PUBLIC",
        order: 0,
        visualTheme: { primaryColor: "#4338ca", accentColor: "#c4b5fd" },
      },
      {
        packId: ids.pack,
        packVersionId: ids.version,
        id: ids.emptySchool,
        slug: "zero-edge",
        sourceName: "Школа без связей",
        displayName: "Школа без связей",
        description: "В этой школе допустим один изолированный узел.",
        visibilityPolicy: "DISCOVERED",
        order: 1,
      },
    ],
    nodes: [
      node(ids.root, "Корень"),
      {
        ...node(ids.left, "Левая ветка", {
          passive: false,
          triggers: [{ kind: "ACTION" }],
        }),
        costs: [
          {
            resource: "Мана",
            amount: { kind: "FIXED", value: 5 },
            timing: "ON_ACTIVATE",
          },
        ],
        usageLimit: { maxUses: 1, cadence: { kind: "DAY" } },
      },
      {
        ...node(ids.right, "Правая ветка", {
          passive: true,
          triggers: [{ kind: "REACTION", label: "После попадания" }],
        }),
        costs: [
          {
            resource: "Мана",
            amount: { kind: "FORMULA", formula: "rank * 2" },
            timing: "ON_SUCCESS",
          },
        ],
        usageLimit: { maxUses: 2, cadence: { kind: "COMBAT" } },
      },
      node(ids.allTarget, "Схождение ALL"),
      node(ids.anyTarget, "Схождение ANY", {
        passive: false,
        triggers: [{ kind: "RITUAL" }],
      }),
      node(ids.isolated, "Изолированный узел", undefined, ids.emptySchool),
    ],
    requirementGroups: [
      {
        packId: ids.pack,
        packVersionId: ids.version,
        id: ids.groupLeft,
        schoolId: ids.school,
        targetNodeId: ids.left,
        mode: "ALL",
      },
      {
        packId: ids.pack,
        packVersionId: ids.version,
        id: ids.groupRight,
        schoolId: ids.school,
        targetNodeId: ids.right,
        mode: "ALL",
      },
      {
        packId: ids.pack,
        packVersionId: ids.version,
        id: ids.groupAll,
        schoolId: ids.school,
        targetNodeId: ids.allTarget,
        mode: "ALL",
      },
      {
        packId: ids.pack,
        packVersionId: ids.version,
        id: ids.groupAny,
        schoolId: ids.school,
        targetNodeId: ids.anyTarget,
        mode: "ANY",
      },
    ],
    edges: [
      {
        packId: ids.pack,
        packVersionId: ids.version,
        id: ids.edgeRootLeft,
        schoolId: ids.school,
        requirementGroupId: ids.groupLeft,
        sourceNodeId: ids.root,
        targetNodeId: ids.left,
      },
      {
        packId: ids.pack,
        packVersionId: ids.version,
        id: ids.edgeRootRight,
        schoolId: ids.school,
        requirementGroupId: ids.groupRight,
        sourceNodeId: ids.root,
        targetNodeId: ids.right,
      },
      {
        packId: ids.pack,
        packVersionId: ids.version,
        id: ids.edgeLeftAll,
        schoolId: ids.school,
        requirementGroupId: ids.groupAll,
        sourceNodeId: ids.left,
        targetNodeId: ids.allTarget,
      },
      {
        packId: ids.pack,
        packVersionId: ids.version,
        id: ids.edgeRightAll,
        schoolId: ids.school,
        requirementGroupId: ids.groupAll,
        sourceNodeId: ids.right,
        targetNodeId: ids.allTarget,
      },
      {
        packId: ids.pack,
        packVersionId: ids.version,
        id: ids.edgeLeftAny,
        schoolId: ids.school,
        requirementGroupId: ids.groupAny,
        sourceNodeId: ids.left,
        targetNodeId: ids.anyTarget,
      },
      {
        packId: ids.pack,
        packVersionId: ids.version,
        id: ids.edgeRightAny,
        schoolId: ids.school,
        requirementGroupId: ids.groupAny,
        sourceNodeId: ids.right,
        targetNodeId: ids.anyTarget,
      },
    ],
  };
  return graph;
}

function errorCodes(graph: SpellProgressionGraph): string[] {
  return validateSpellProgressionGraph(graph).errors.map((issue) => issue.code);
}

function appendGroupAndEdge(
  graph: SpellProgressionGraph,
  sourceNodeId: string,
  targetNodeId: string,
): void {
  const groupId = uuid(800);
  graph.requirementGroups.push({
    packId: ids.pack,
    packVersionId: ids.version,
    id: groupId,
    schoolId: ids.school,
    targetNodeId,
    mode: "ALL",
  });
  graph.edges.push({
    packId: ids.pack,
    packVersionId: ids.version,
    id: uuid(801),
    schoolId: ids.school,
    requirementGroupId: groupId,
    sourceNodeId,
    targetNodeId,
  });
}

describe("spell-school graph contracts", () => {
  it("exports a versioned graph schema and explicit lifecycle/group enums", () => {
    expect(spellPackLifecycleSchema.options).toEqual([
      "DRAFT",
      "REFERENCE",
      "ACTIVE",
      "ARCHIVED",
    ]);
    expect(spellRequirementGroupModeSchema.options).toEqual([
      "ALL",
      "ANY",
      "UNRESOLVED",
    ]);
    expect(spellSchoolVisibilityPolicySchema.options).toEqual([
      "PUBLIC",
      "DISCOVERED",
      "GM_ONLY",
    ]);

    const graph: SpellProgressionGraph = graphFixture();
    const parsed = spellProgressionGraphSchema.parse(graph);
    expect(parsed).toEqual(graph);
    expect(
      parsed.schools.map(({ visibilityPolicy, order }) => ({
        visibilityPolicy,
        order,
      })),
    ).toEqual([
      { visibilityPolicy: "PUBLIC", order: 0 },
      { visibilityPolicy: "DISCOVERED", order: 1 },
    ]);
  });

  it("accepts branching, ALL/ANY convergence, isolated nodes, and a zero-edge school", () => {
    const graph = graphFixture();
    const result = validateSpellProgressionGraph(graph);

    expect(result).toEqual({ errors: [], warnings: [] });
    expect(
      graph.edges.filter((edge) => edge.sourceNodeId === ids.root),
    ).toHaveLength(2);
    expect(
      graph.edges.filter((edge) => edge.requirementGroupId === ids.groupAll),
    ).toHaveLength(2);
    expect(
      graph.edges.filter((edge) => edge.requirementGroupId === ids.groupAny),
    ).toHaveLength(2);
    expect(
      graph.edges.some(
        (edge) =>
          edge.sourceNodeId === ids.isolated ||
          edge.targetNodeId === ids.isolated,
      ),
    ).toBe(false);
  });

  it("represents passive-only, active-only, and hybrid abilities", () => {
    const parsed = spellProgressionGraphSchema.parse(graphFixture());
    expect(parsed.nodes[0]!.activation).toEqual({
      passive: true,
      triggers: [],
    });
    expect(parsed.nodes[1]!.activation).toEqual({
      passive: false,
      triggers: [{ kind: "ACTION" }],
    });
    expect(parsed.nodes[2]!.activation).toEqual({
      passive: true,
      triggers: [{ kind: "REACTION", label: "После попадания" }],
    });

    const invalid = graphFixture();
    invalid.nodes[0]!.activation = { passive: false, triggers: [] };
    expect(spellProgressionGraphSchema.safeParse(invalid).success).toBe(false);
  });

  it("requires explicit wording for an OTHER activation", () => {
    const graph = graphFixture();
    graph.nodes[0]!.activation = {
      passive: false,
      triggers: [{ kind: "OTHER" }],
    };

    const parsed = spellProgressionGraphSchema.safeParse(graph);
    expect(parsed.success).toBe(false);
    if (!parsed.success)
      expect(parsed.error.issues).toEqual([
        expect.objectContaining({
          path: ["nodes", 0, "activation", "triggers", 0, "rawText"],
        }),
      ]);
  });

  it("keeps lifecycle and revision provenance on each node", () => {
    const graph = graphFixture();
    graph.nodes[0]!.lifecycle = "REFERENCE";
    graph.nodes[0]!.revision = 3;
    graph.nodes[0]!.revisionProvenance = {
      sourceRevision: "docx:sha256:abc123",
      changedAt: "2026-09-01T07:00:00.000Z",
      changedBy: "Мастер",
      changeNote: "Уточнена формулировка по исходнику",
    };

    const parsed = spellProgressionGraphSchema.parse(graph);
    expect(parsed.nodes[0]).toMatchObject({
      lifecycle: "REFERENCE",
      revision: 3,
      revisionProvenance: {
        sourceRevision: "docx:sha256:abc123",
        changedBy: "Мастер",
      },
    });

    graph.nodes[0]!.revision = -1;
    expect(spellProgressionGraphSchema.safeParse(graph).success).toBe(false);
  });

  it("supports every bounded cadence and preserves custom cadence wording", () => {
    const standardKinds = [
      "TURN",
      "COMBAT",
      "SHORT_REST",
      "LONG_REST",
      "DAY",
      "WEEK",
      "SESSION",
      "CAMPAIGN",
      "MONTH",
    ] as const;

    for (const kind of standardKinds) {
      const cadence = { kind };
      expect(spellUsageCadenceSchema.parse(cadence)).toEqual(cadence);
      const graph = graphFixture();
      graph.nodes[0]!.usageLimit = { maxUses: 1, cadence };
      expect(spellProgressionGraphSchema.safeParse(graph).success).toBe(true);
    }

    const custom = { kind: "CUSTOM" as const, rawText: "1 раз в час" };
    expect(spellUsageCadenceSchema.parse(custom)).toEqual(custom);
    expect(spellUsageCadenceSchema.safeParse({ kind: "CUSTOM" }).success).toBe(
      false,
    );
  });

  it.each([
    {
      label: "school id",
      code: "DUPLICATE_SCHOOL_ID",
      mutate(graph: SpellProgressionGraph) {
        graph.schools.push({ ...graph.schools[0]!, slug: "duplicate-school" });
      },
    },
    {
      label: "node id",
      code: "DUPLICATE_NODE_ID",
      mutate(graph: SpellProgressionGraph) {
        graph.nodes.push({ ...graph.nodes[0]!, displayName: "Дубликат" });
      },
    },
    {
      label: "requirement-group id",
      code: "DUPLICATE_REQUIREMENT_GROUP_ID",
      mutate(graph: SpellProgressionGraph) {
        graph.requirementGroups.push({ ...graph.requirementGroups[0]! });
      },
    },
    {
      label: "edge id",
      code: "DUPLICATE_EDGE_ID",
      mutate(graph: SpellProgressionGraph) {
        graph.edges.push({ ...graph.edges[0]! });
      },
    },
  ])("rejects a duplicate $label", ({ code, mutate }) => {
    const graph = graphFixture();
    mutate(graph);
    expect(errorCodes(graph)).toContain(code);
  });

  it("rejects a duplicate prerequisite even when the edge ids differ", () => {
    const graph = graphFixture();
    graph.edges.push({ ...graph.edges[0]!, id: uuid(802) });
    expect(errorCodes(graph)).toContain("DUPLICATE_EDGE");
  });

  it("rejects the same source-to-target prerequisite across different groups", () => {
    const graph = graphFixture();
    const duplicateGroupId = uuid(803);
    graph.requirementGroups.push({
      packId: ids.pack,
      packVersionId: ids.version,
      id: duplicateGroupId,
      schoolId: ids.school,
      targetNodeId: ids.left,
      mode: "ANY",
    });
    graph.edges.push({
      ...graph.edges[0]!,
      id: uuid(804),
      requirementGroupId: duplicateGroupId,
    });

    expect(errorCodes(graph)).toContain("DUPLICATE_EDGE");
  });

  it("rejects a requirement group without any prerequisite edge", () => {
    const graph = graphFixture();
    graph.requirementGroups.push({
      packId: ids.pack,
      packVersionId: ids.version,
      id: uuid(805),
      schoolId: ids.emptySchool,
      targetNodeId: ids.isolated,
      mode: "ALL",
    });

    expect(errorCodes(graph)).toContain("EMPTY_REQUIREMENT_GROUP");
  });

  it.each([
    {
      label: "school",
      code: "DANGLING_SCHOOL",
      mutate(graph: SpellProgressionGraph) {
        graph.nodes[0]!.schoolId = uuid(900);
      },
    },
    {
      label: "requirement group",
      code: "DANGLING_REQUIREMENT_GROUP",
      mutate(graph: SpellProgressionGraph) {
        graph.edges[0]!.requirementGroupId = uuid(901);
      },
    },
    {
      label: "source node",
      code: "DANGLING_SOURCE_NODE",
      mutate(graph: SpellProgressionGraph) {
        graph.edges[0]!.sourceNodeId = uuid(902);
      },
    },
    {
      label: "target node",
      code: "DANGLING_TARGET_NODE",
      mutate(graph: SpellProgressionGraph) {
        graph.edges[0]!.targetNodeId = uuid(903);
      },
    },
  ])("rejects a dangling $label reference", ({ code, mutate }) => {
    const graph = graphFixture();
    mutate(graph);
    expect(errorCodes(graph)).toContain(code);
  });

  it("rejects self edges and directed cycles", () => {
    const selfEdgeGraph = graphFixture();
    appendGroupAndEdge(selfEdgeGraph, ids.root, ids.root);
    expect(errorCodes(selfEdgeGraph)).toContain("SELF_EDGE");

    const cyclicGraph = graphFixture();
    appendGroupAndEdge(cyclicGraph, ids.allTarget, ids.root);
    expect(errorCodes(cyclicGraph)).toContain("CYCLE");
  });

  it.each([
    {
      label: "school in another pack",
      code: "CROSS_PACK",
      mutate(graph: SpellProgressionGraph) {
        graph.schools[0]!.packId = uuid(910);
      },
    },
    {
      label: "node from another version",
      code: "CROSS_VERSION",
      mutate(graph: SpellProgressionGraph) {
        graph.nodes[0]!.packVersionId = uuid(911);
      },
    },
    {
      label: "group in another pack",
      code: "CROSS_PACK",
      mutate(graph: SpellProgressionGraph) {
        graph.requirementGroups[0]!.packId = uuid(912);
      },
    },
    {
      label: "edge from another version",
      code: "CROSS_VERSION",
      mutate(graph: SpellProgressionGraph) {
        graph.edges[0]!.packVersionId = uuid(913);
      },
    },
  ])("rejects a $label", ({ code, mutate }) => {
    const graph = graphFixture();
    mutate(graph);
    expect(errorCodes(graph)).toContain(code);
  });

  it("rejects cross-school edges and group/edge target disagreement", () => {
    const crossSchool = graphFixture();
    crossSchool.edges[0]!.schoolId = ids.emptySchool;
    expect(errorCodes(crossSchool)).toContain("CROSS_SCHOOL");

    const mismatchedTarget = graphFixture();
    mismatchedTarget.edges[0]!.targetNodeId = ids.right;
    expect(errorCodes(mismatchedTarget)).toContain("GROUP_TARGET_MISMATCH");
  });

  it("keeps UNRESOLVED as review debt and blocks it in ACTIVE", () => {
    const reference = graphFixture();
    reference.lifecycle = "REFERENCE";
    reference.requirementGroups[2]!.mode = "UNRESOLVED";
    expect(validateSpellProgressionGraph(reference)).toMatchObject({
      errors: [],
      warnings: [{ code: "UNRESOLVED_REQUIREMENT_GROUP" }],
    });

    for (const lifecycle of ["DRAFT", "ARCHIVED"] as const) {
      const reviewable = structuredClone(reference);
      reviewable.lifecycle = lifecycle;
      expect(validateSpellProgressionGraph(reviewable).warnings).toEqual([
        expect.objectContaining({ code: "UNRESOLVED_REQUIREMENT_GROUP" }),
      ]);
    }

    const active = structuredClone(reference);
    active.lifecycle = "ACTIVE";
    expect(validateSpellProgressionGraph(active)).toMatchObject({
      errors: [{ code: "UNRESOLVED_REQUIREMENT_GROUP" }],
      warnings: [],
    });
  });

  it("does not derive prerequisite semantics from presentation layout", () => {
    const graph = graphFixture();
    const withoutLayout = validateSpellProgressionGraph(graph);
    graph.layout = {
      schools: [{ schoolId: ids.school, position: { x: -50_000, y: 90_000 } }],
      nodes: [
        { nodeId: ids.root, position: { x: 10_000, y: -20_000 }, order: 99 },
        {
          nodeId: ids.allTarget,
          position: { x: -10_000, y: 20_000 },
          tier: 42,
        },
      ],
      edges: [
        {
          edgeId: ids.edgeRootLeft,
          controlPoints: [
            { x: 999, y: -999 },
            { x: -999, y: 999 },
          ],
        },
      ],
    };

    expect(spellProgressionGraphSchema.safeParse(graph).success).toBe(true);
    expect(validateSpellProgressionGraph(graph)).toEqual(withoutLayout);
  });

  it("is pure and returns issues in a deterministic order", () => {
    const graph = graphFixture();
    graph.lifecycle = "REFERENCE";
    graph.requirementGroups[0]!.mode = "UNRESOLVED";
    graph.schools.push({ ...graph.schools[0]!, slug: "duplicate-school" });
    graph.nodes[0]!.packId = uuid(920);
    graph.edges[0]!.requirementGroupId = uuid(921);
    graph.edges[1]!.sourceNodeId = uuid(922);
    const before = structuredClone(graph);

    const first = validateSpellProgressionGraph(graph);
    const second = validateSpellProgressionGraph(graph);
    expect(second).toEqual(first);
    expect(graph).toEqual(before);

    const issueKey = (issue: SpellGraphValidationIssue): string =>
      [issue.code, issue.path, issue.entityId ?? "", issue.message].join("|");
    for (const issues of [first.errors, first.warnings]) {
      const keys = issues.map(issueKey);
      expect(keys).toEqual([...keys].sort());
    }
  });
});

const referenceSourceText = readFileSync(
  new URL("../docs/content/magic-schools.json", import.meta.url),
  "utf8",
);
const referenceFixture = JSON.parse(
  referenceSourceText,
) as SpellReferenceImportSource;

function adaptReferenceFixture(): SpellProgressionGraph {
  return previewSpellReferenceImport({
    packId: uuid(9_001),
    versionId: uuid(9_002),
    version: 1,
    source: referenceFixture,
  }).graph;
}

function auditRawReference(): {
  dangling: string[];
  duplicateEdges: string[];
  cycles: string[];
} {
  const dangling: string[] = [];
  const duplicateEdges: string[] = [];
  const cycles: string[] = [];

  for (const school of referenceFixture.школы) {
    const canonicalBySourceName = new Map<string, string>();
    for (const node of school.узлы) {
      canonicalBySourceName.set(node.название, node.название);
      if (node.вариантНаСхеме)
        canonicalBySourceName.set(node.вариантНаСхеме, node.название);
    }

    const adjacency = new Map<string, string[]>();
    for (const node of school.узлы) adjacency.set(node.название, []);
    const seenEdges = new Set<string>();
    for (const edge of school.связи) {
      const source = canonicalBySourceName.get(edge.откуда);
      const target = canonicalBySourceName.get(edge.куда);
      if (!source || !target) {
        dangling.push(`${school.ключ}:${edge.откуда}->${edge.куда}`);
        continue;
      }
      const identity = `${source}->${target}`;
      if (seenEdges.has(identity))
        duplicateEdges.push(`${school.ключ}:${identity}`);
      seenEdges.add(identity);
      adjacency.get(source)!.push(target);
    }

    const visiting = new Set<string>();
    const visited = new Set<string>();
    const visit = (nodeName: string): void => {
      if (visiting.has(nodeName)) {
        cycles.push(`${school.ключ}:${nodeName}`);
        return;
      }
      if (visited.has(nodeName)) return;
      visiting.add(nodeName);
      for (const target of adjacency.get(nodeName) ?? []) visit(target);
      visiting.delete(nodeName);
      visited.add(nodeName);
    };
    for (const nodeName of adjacency.keys()) visit(nodeName);
  }

  return { dangling, duplicateEdges, cycles };
}

describe("docs/content/magic-schools.json reference", () => {
  it("has the measured 13/145/114 shape and no raw structural defect", () => {
    expect(referenceFixture.школы).toHaveLength(13);
    expect(
      referenceFixture.школы.reduce(
        (total, school) => total + school.узлы.length,
        0,
      ),
    ).toBe(145);
    expect(
      referenceFixture.школы.reduce(
        (total, school) => total + school.связи.length,
        0,
      ),
    ).toBe(114);
    expect(referenceFixture.требуетУточнения).toHaveLength(31);
    expect(auditRawReference()).toEqual({
      dangling: [],
      duplicateEdges: [],
      cycles: [],
    });
  });

  it("adapts as REFERENCE without inventing convergence semantics", () => {
    const graph = adaptReferenceFixture();
    const parsed = spellProgressionGraphSchema.parse(graph);
    const result = validateSpellProgressionGraph(parsed);

    expect(parsed.lifecycle).toBe("REFERENCE");
    expect(parsed.schools).toHaveLength(13);
    expect(parsed.nodes).toHaveLength(145);
    expect(parsed.edges).toHaveLength(114);
    expect(result.errors).toEqual([]);
    expect(result.warnings).toHaveLength(37);
    expect(
      result.warnings.filter(
        (issue) => issue.code === "UNRESOLVED_REQUIREMENT_GROUP",
      ),
    ).toHaveLength(6);
    expect(
      result.warnings.filter((issue) => issue.code === "OPEN_IMPORT_WARNING"),
    ).toHaveLength(31);

    const incomingCountByGroup = new Map<string, number>();
    for (const edge of parsed.edges)
      incomingCountByGroup.set(
        edge.requirementGroupId,
        (incomingCountByGroup.get(edge.requirementGroupId) ?? 0) + 1,
      );
    for (const group of parsed.requirementGroups) {
      const incomingCount = incomingCountByGroup.get(group.id) ?? 0;
      expect(group.mode).toBe(incomingCount === 1 ? "ALL" : "UNRESOLVED");
    }

    const rawNodes = referenceFixture.школы.flatMap((school) => school.узлы);
    expect(
      parsed.nodes.map((spellNode) => ({
        sourceName: spellNode.sourceName,
        rawSourceText: spellNode.rawSourceText,
      })),
    ).toEqual(
      rawNodes.map((rawNode) => ({
        sourceName: rawNode.название,
        rawSourceText: rawNode.описание,
      })),
    );

    const waterSchool = parsed.schools.find(
      (school) => school.slug === "voda",
    )!;
    expect(
      parsed.nodes.filter((spellNode) => spellNode.schoolId === waterSchool.id),
    ).toHaveLength(11);
    expect(
      parsed.edges.filter((edge) => edge.schoolId === waterSchool.id),
    ).toHaveLength(0);
  });
});

import { describe, expect, it } from "vitest";
import {
  gmSpellProgressionProjectionSchema,
  playerSpellProgressionProjectionSchema,
  spellPrerequisiteFailureSchema,
  spellProgressionQuerySchema,
  spellProgressionGraphSchema,
} from "../packages/contracts/src/index.js";

const id = () => crypto.randomUUID();

function contractFixture() {
  const characterId = id();
  const packId = id();
  const packVersionId = id();
  const schoolId = id();
  const nodeId = id();
  const school = {
    packId,
    packVersionId,
    id: schoolId,
    slug: "contract-school",
    sourceName: "Private source name",
    displayName: "Contract school",
    description: "Private school description",
    rawSourceText: "Private school source",
    visibilityPolicy: "PUBLIC" as const,
    order: 0,
  };
  const node = {
    packId,
    packVersionId,
    schoolId,
    id: nodeId,
    sourceName: "Private node source name",
    displayName: "Contract node",
    rawSourceText: "Private node source",
    narrativeText: "Private narrative",
    mechanicsText: "Allowed mechanics",
    lifecycle: "ACTIVE" as const,
    revision: 2,
    revisionProvenance: { changedBy: "Private actor" },
    activation: { passive: true, triggers: [] },
    costs: [],
    usageLimit: null,
  };
  const graph = spellProgressionGraphSchema.parse({
    packId,
    versionId: packVersionId,
    version: 1,
    title: "Contract graph",
    lifecycle: "ACTIVE",
    provenance: {
      sourceType: "GM_AUTHORED",
      sourceLabel: "Private provenance",
      rawSourceText: "Private graph source",
    },
    schools: [school],
    nodes: [node],
    requirementGroups: [],
    edges: [],
    layout: {
      nodes: [{ nodeId, position: { x: 1, y: 2 } }],
    },
  });
  return {
    characterId,
    packId,
    packVersionId,
    schoolId,
    nodeId,
    school,
    node,
    graph,
  };
}

describe("UIX-578 spell projection contracts", () => {
  it("normalizes explicit immutable-version queries and rejects extra selectors", () => {
    const packId = id();
    const packVersionId = id();
    expect(
      spellProgressionQuerySchema.parse({
        packId: packId.toUpperCase(),
        packVersionId: packVersionId.toUpperCase(),
      }),
    ).toEqual({ packId, packVersionId });
    expect(
      spellProgressionQuerySchema.safeParse({
        packId,
        packVersionId,
        latest: true,
      }).success,
    ).toBe(false);
  });

  it("keeps LOCKED identity-only and forbids HIDDEN nodes in player DTOs", () => {
    const fixture = contractFixture();
    const base = {
      characterId: fixture.characterId,
      packId: fixture.packId,
      packVersionId: fixture.packVersionId,
      schools: [
        { id: fixture.schoolId, displayName: fixture.school.displayName },
      ],
      nodes: [
        {
          id: fixture.nodeId,
          schoolId: fixture.schoolId,
          displayName: fixture.node.displayName,
          state: "LOCKED" as const,
        },
      ],
      edges: [],
    };
    expect(playerSpellProgressionProjectionSchema.parse(base)).toEqual(base);
    expect(
      playerSpellProgressionProjectionSchema.safeParse({
        ...base,
        nodes: [{ ...base.nodes[0], mechanicsText: "must not leak" }],
      }).success,
    ).toBe(false);
    expect(
      playerSpellProgressionProjectionSchema.safeParse({
        ...base,
        nodes: [{ ...base.nodes[0], state: "HIDDEN" }],
      }).success,
    ).toBe(false);
    expect(
      playerSpellProgressionProjectionSchema.safeParse({
        ...base,
        schools: [{ ...base.schools[0], sourceName: "must not leak" }],
      }).success,
    ).toBe(false);
    expect(
      playerSpellProgressionProjectionSchema.safeParse({
        ...base,
        graph: fixture.graph,
      }).success,
    ).toBe(false);
  });

  it("accepts only allowlisted gameplay fields for AVAILABLE and DISCOVERED", () => {
    const fixture = contractFixture();
    const safeNode = {
      id: fixture.nodeId,
      schoolId: fixture.schoolId,
      displayName: fixture.node.displayName,
      state: "AVAILABLE" as const,
      mechanicsText: fixture.node.mechanicsText,
      activation: fixture.node.activation,
      costs: fixture.node.costs,
      usageLimit: fixture.node.usageLimit,
    };
    const payload = {
      characterId: fixture.characterId,
      packId: fixture.packId,
      packVersionId: fixture.packVersionId,
      schools: [
        { id: fixture.schoolId, displayName: fixture.school.displayName },
      ],
      nodes: [safeNode],
      edges: [],
    };
    expect(playerSpellProgressionProjectionSchema.parse(payload)).toEqual(
      payload,
    );
    for (const forbidden of [
      { sourceName: fixture.node.sourceName },
      { rawSourceText: fixture.node.rawSourceText },
      { narrativeText: fixture.node.narrativeText },
      { revision: fixture.node.revision },
      { revisionProvenance: fixture.node.revisionProvenance },
    ])
      expect(
        playerSpellProgressionProjectionSchema.safeParse({
          ...payload,
          nodes: [{ ...safeNode, ...forbidden }],
        }).success,
      ).toBe(false);
  });

  it("keeps full GM graph, orphan snapshots and structured failures", () => {
    const fixture = contractFixture();
    const orphanSchoolId = id();
    const orphanNodeId = id();
    const orphanSchool = {
      ...fixture.school,
      id: orphanSchoolId,
      slug: "orphan-contract-school",
      displayName: "Orphan contract school",
    };
    const orphanNode = {
      ...fixture.node,
      id: orphanNodeId,
      schoolId: orphanSchoolId,
      displayName: "Orphan contract node",
    };
    const failure = {
      code: "SOURCE_NODE_RANK_TOO_LOW" as const,
      groupId: id(),
      edgeId: id(),
      sourceNodeId: id(),
      requiredRank: 2,
      actualRank: 1,
    };
    expect(spellPrerequisiteFailureSchema.parse(failure)).toEqual(failure);
    const gmPayload = {
      characterId: fixture.characterId,
      packId: fixture.packId,
      packVersionId: fixture.packVersionId,
      graph: fixture.graph,
      nodes: [
        {
          school: fixture.school,
          node: fixture.node,
          state: "AVAILABLE" as const,
          prerequisiteFailures: [],
        },
        {
          school: orphanSchool,
          node: orphanNode,
          state: "DISCOVERED" as const,
          prerequisiteFailures: [failure],
        },
      ],
    };
    expect(gmSpellProgressionProjectionSchema.parse(gmPayload)).toEqual(
      gmPayload,
    );
    expect(
      spellPrerequisiteFailureSchema.safeParse({
        code: "SOURCE_NODE_MISSING",
        groupId: id(),
        sourceNodeId: id(),
      }).success,
    ).toBe(false);
  });
});

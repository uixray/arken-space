import { describe, expect, it } from "vitest";
import {
  spellAssignmentSnapshotSchema,
  spellProgressionGraphSchema,
  type SpellAssignmentSnapshot,
  type SpellNode,
  type SpellProgressionGraph,
  type SpellRequirementEdge,
  type SpellRequirementGroup,
  type SpellSchool,
} from "@arken/contracts";
import {
  evaluateSpellAssignmentPrerequisites,
  evaluateSpellPrerequisites,
  type CurrentSpellAssignmentVersion,
} from "./spell-assignment-storage.js";
import { buildSpellProgressionProjections } from "./spell-projection.js";

const id = () => crypto.randomUUID();

function school(
  packId: string,
  packVersionId: string,
  input: {
    id: string;
    slug: string;
    displayName: string;
    visibilityPolicy: SpellSchool["visibilityPolicy"];
    order: number;
  },
): SpellSchool {
  return {
    packId,
    packVersionId,
    id: input.id,
    slug: input.slug,
    sourceName: `${input.displayName} SOURCE_NAME_SECRET`,
    displayName: input.displayName,
    description: `${input.displayName} DESCRIPTION_SECRET`,
    rawSourceText: `${input.displayName} RAW_SCHOOL_SECRET`,
    visibilityPolicy: input.visibilityPolicy,
    order: input.order,
  };
}

function node(
  packId: string,
  packVersionId: string,
  schoolId: string,
  nodeId: string,
  displayName: string,
  mechanicsText: string,
): SpellNode {
  return {
    packId,
    packVersionId,
    schoolId,
    id: nodeId,
    sourceName: `${displayName} SOURCE_NAME_SECRET`,
    displayName,
    rawSourceText: `${displayName} RAW_NODE_SECRET`,
    narrativeText: `${displayName} NARRATIVE_SECRET`,
    mechanicsText,
    lifecycle: "ACTIVE",
    revision: 7,
    revisionProvenance: {
      changedBy: `${displayName} ACTOR_SECRET`,
      changeNote: `${displayName} GM_NOTE_SECRET`,
    },
    activation: { passive: true, triggers: [] },
    costs: [],
    usageLimit: null,
  };
}

function current(
  snapshot: SpellAssignmentSnapshot,
): CurrentSpellAssignmentVersion {
  return { row: {} as never, snapshot };
}

function schoolAssignment(
  graph: SpellProgressionGraph,
  assignedSchool: SpellSchool,
  version: { id: string; number: number } = {
    id: graph.versionId,
    number: graph.version,
  },
): CurrentSpellAssignmentVersion {
  const assignmentId = id();
  const snapshotSchool = { ...assignedSchool, packVersionId: version.id };
  return current(
    spellAssignmentSnapshotSchema.parse({
      schemaVersion: 1,
      assignmentId,
      assignmentVersionId: id(),
      assignmentVersion: 1,
      packId: graph.packId,
      packVersionId: version.id,
      packVersion: version.number,
      packLifecycle: "ACTIVE",
      provenance: graph.provenance,
      kind: "SCHOOL",
      schoolId: snapshotSchool.id,
      school: snapshotSchool,
      nodeId: null,
      rank: null,
      node: null,
      requirementGroups: [],
      edges: [],
    }),
  );
}

function nodeAssignment(input: {
  graph: SpellProgressionGraph;
  school: SpellSchool;
  node: SpellNode;
  rank?: number;
  requirementGroups?: SpellRequirementGroup[];
  edges?: SpellRequirementEdge[];
}): CurrentSpellAssignmentVersion {
  const assignmentId = id();
  return current(
    spellAssignmentSnapshotSchema.parse({
      schemaVersion: 1,
      assignmentId,
      assignmentVersionId: id(),
      assignmentVersion: 1,
      packId: input.graph.packId,
      packVersionId: input.graph.versionId,
      packVersion: input.graph.version,
      packLifecycle: "ACTIVE",
      provenance: input.graph.provenance,
      kind: "NODE",
      schoolId: input.school.id,
      school: input.school,
      nodeId: input.node.id,
      rank: input.rank ?? 1,
      node: input.node,
      requirementGroups: input.requirementGroups ?? [],
      edges: input.edges ?? [],
    }),
  );
}

function fixture() {
  const characterId = id();
  const packId = id();
  const packVersionId = id();
  const schoolIds = {
    publicGranted: id(),
    publicNoGrant: id(),
    discoveredAssigned: id(),
    discoveredHidden: id(),
    gmOnly: id(),
    orphan: id(),
  };
  const nodeIds = {
    source: id(),
    available: id(),
    rankLocked: id(),
    anyAvailable: id(),
    publicNoGrant: id(),
    discoveredAssigned: id(),
    discoveredLocked: id(),
    discoveredHidden: id(),
    gmOnlySource: id(),
    gmOnlyTarget: id(),
    orphan: id(),
    orphanMissingSource: id(),
  };
  const schools = {
    publicGranted: school(packId, packVersionId, {
      id: schoolIds.publicGranted,
      slug: "public-granted",
      displayName: "Public granted",
      visibilityPolicy: "PUBLIC",
      order: 10,
    }),
    publicNoGrant: school(packId, packVersionId, {
      id: schoolIds.publicNoGrant,
      slug: "public-no-grant",
      displayName: "Public no grant",
      visibilityPolicy: "PUBLIC",
      order: 20,
    }),
    discoveredAssigned: school(packId, packVersionId, {
      id: schoolIds.discoveredAssigned,
      slug: "discovered-assigned",
      displayName: "Discovered assigned",
      visibilityPolicy: "DISCOVERED",
      order: 30,
    }),
    discoveredHidden: school(packId, packVersionId, {
      id: schoolIds.discoveredHidden,
      slug: "discovered-hidden",
      displayName: "Discovered hidden",
      visibilityPolicy: "DISCOVERED",
      order: 40,
    }),
    gmOnly: school(packId, packVersionId, {
      id: schoolIds.gmOnly,
      slug: "gm-only",
      displayName: "GM ONLY SCHOOL SECRET",
      visibilityPolicy: "GM_ONLY",
      order: 50,
    }),
    orphan: school(packId, packVersionId, {
      id: schoolIds.orphan,
      slug: "orphan-school",
      displayName: "Orphan school",
      visibilityPolicy: "PUBLIC",
      order: 60,
    }),
  };
  const nodes = {
    source: node(
      packId,
      packVersionId,
      schoolIds.publicGranted,
      nodeIds.source,
      "Source",
      "GRAPH_SOURCE_MECHANICS_SHOULD_LOSE",
    ),
    available: node(
      packId,
      packVersionId,
      schoolIds.publicGranted,
      nodeIds.available,
      "Available",
      "AVAILABLE_MECHANICS",
    ),
    rankLocked: node(
      packId,
      packVersionId,
      schoolIds.publicGranted,
      nodeIds.rankLocked,
      "Rank locked",
      "LOCKED_MECHANICS_SECRET",
    ),
    anyAvailable: node(
      packId,
      packVersionId,
      schoolIds.publicGranted,
      nodeIds.anyAvailable,
      "Any available",
      "ANY_AVAILABLE_MECHANICS",
    ),
    publicNoGrant: node(
      packId,
      packVersionId,
      schoolIds.publicNoGrant,
      nodeIds.publicNoGrant,
      "Public no grant",
      "PUBLIC_NO_GRANT_LOCKED_SECRET",
    ),
    discoveredAssigned: node(
      packId,
      packVersionId,
      schoolIds.discoveredAssigned,
      nodeIds.discoveredAssigned,
      "Discovered assigned",
      "GRAPH_DISCOVERED_MECHANICS_SHOULD_LOSE",
    ),
    discoveredLocked: node(
      packId,
      packVersionId,
      schoolIds.discoveredAssigned,
      nodeIds.discoveredLocked,
      "Discovered branch locked",
      "DISCOVERED_BRANCH_LOCKED_SECRET",
    ),
    discoveredHidden: node(
      packId,
      packVersionId,
      schoolIds.discoveredHidden,
      nodeIds.discoveredHidden,
      "DISCOVERED_HIDDEN_NODE_SECRET",
      "DISCOVERED_HIDDEN_MECHANICS_SECRET",
    ),
    gmOnlySource: node(
      packId,
      packVersionId,
      schoolIds.gmOnly,
      nodeIds.gmOnlySource,
      "GM_ONLY_SOURCE_SECRET",
      "GM_ONLY_SOURCE_MECHANICS_SECRET",
    ),
    gmOnlyTarget: node(
      packId,
      packVersionId,
      schoolIds.gmOnly,
      nodeIds.gmOnlyTarget,
      "GM_ONLY_TARGET_SECRET",
      "GM_ONLY_ASSIGNED_GRAPH_SECRET",
    ),
    orphan: node(
      packId,
      packVersionId,
      schoolIds.orphan,
      nodeIds.orphan,
      "Orphan assigned",
      "ORPHAN_SNAPSHOT_MECHANICS",
    ),
  };
  const groups = {
    rank: {
      packId,
      packVersionId,
      id: id(),
      schoolId: schoolIds.publicGranted,
      targetNodeId: nodeIds.rankLocked,
      mode: "ALL" as const,
    },
    any: {
      packId,
      packVersionId,
      id: id(),
      schoolId: schoolIds.publicGranted,
      targetNodeId: nodeIds.anyAvailable,
      mode: "ANY" as const,
    },
    gmOnly: {
      packId,
      packVersionId,
      id: id(),
      schoolId: schoolIds.gmOnly,
      targetNodeId: nodeIds.gmOnlyTarget,
      mode: "ALL" as const,
    },
    orphan: {
      packId,
      packVersionId,
      id: id(),
      schoolId: schoolIds.orphan,
      targetNodeId: nodeIds.orphan,
      mode: "ALL" as const,
    },
  } satisfies Record<string, SpellRequirementGroup>;
  const edges = {
    rank: {
      packId,
      packVersionId,
      id: id(),
      schoolId: schoolIds.publicGranted,
      requirementGroupId: groups.rank.id,
      sourceNodeId: nodeIds.source,
      targetNodeId: nodeIds.rankLocked,
      minimumRank: 2,
      threshold: 12,
      gmGrantCondition: "RANK_TARGET_GM_CONDITION_SECRET",
    },
    anyMissing: {
      packId,
      packVersionId,
      id: id(),
      schoolId: schoolIds.publicGranted,
      requirementGroupId: groups.any.id,
      sourceNodeId: nodeIds.rankLocked,
      targetNodeId: nodeIds.anyAvailable,
    },
    anySatisfied: {
      packId,
      packVersionId,
      id: id(),
      schoolId: schoolIds.publicGranted,
      requirementGroupId: groups.any.id,
      sourceNodeId: nodeIds.source,
      targetNodeId: nodeIds.anyAvailable,
    },
    gmOnly: {
      packId,
      packVersionId,
      id: id(),
      schoolId: schoolIds.gmOnly,
      requirementGroupId: groups.gmOnly.id,
      sourceNodeId: nodeIds.gmOnlySource,
      targetNodeId: nodeIds.gmOnlyTarget,
    },
    orphan: {
      packId,
      packVersionId,
      id: id(),
      schoolId: schoolIds.orphan,
      requirementGroupId: groups.orphan.id,
      sourceNodeId: nodeIds.orphanMissingSource,
      targetNodeId: nodeIds.orphan,
    },
  } satisfies Record<string, SpellRequirementEdge>;

  const graph = spellProgressionGraphSchema.parse({
    packId,
    versionId: packVersionId,
    version: 3,
    title: "Projection graph",
    lifecycle: "ACTIVE",
    provenance: {
      sourceType: "GM_AUTHORED",
      sourceLabel: "GRAPH_SOURCE_LABEL_SECRET",
      rawSourceText: "GRAPH_PROVENANCE_RAW_SECRET",
    },
    schools: [
      schools.publicGranted,
      schools.publicNoGrant,
      schools.discoveredAssigned,
      schools.discoveredHidden,
      schools.gmOnly,
    ],
    nodes: [
      nodes.source,
      nodes.available,
      nodes.rankLocked,
      nodes.anyAvailable,
      nodes.publicNoGrant,
      nodes.discoveredAssigned,
      nodes.discoveredLocked,
      nodes.discoveredHidden,
      nodes.gmOnlySource,
      nodes.gmOnlyTarget,
    ],
    requirementGroups: [groups.rank, groups.any, groups.gmOnly],
    edges: [edges.rank, edges.anyMissing, edges.anySatisfied, edges.gmOnly],
    layout: {
      schools: [
        { schoolId: schoolIds.gmOnly, position: { x: 91_001, y: 91_002 } },
      ],
      nodes: [
        { nodeId: nodeIds.gmOnlyTarget, position: { x: 92_001, y: 92_002 } },
      ],
    },
    notes: "GRAPH_GM_NOTES_SECRET",
  });

  const sourceSnapshot = {
    ...nodes.source,
    mechanicsText: "SOURCE_SNAPSHOT_MECHANICS_WINS",
    revision: 1,
  };
  const discoveredSnapshot = {
    ...nodes.discoveredAssigned,
    mechanicsText: "DISCOVERED_SNAPSHOT_MECHANICS_WINS",
    revision: 1,
  };
  const gmOnlySnapshot = {
    ...nodes.gmOnlyTarget,
    mechanicsText: "GM_ONLY_ASSIGNED_SNAPSHOT_SECRET",
    revision: 1,
  };
  const currentAssignments = [
    schoolAssignment(graph, schools.publicGranted, { id: id(), number: 2 }),
    nodeAssignment({
      graph,
      school: schools.publicGranted,
      node: sourceSnapshot,
      rank: 1,
    }),
    nodeAssignment({
      graph,
      school: schools.discoveredAssigned,
      node: discoveredSnapshot,
    }),
    nodeAssignment({
      graph,
      school: schools.gmOnly,
      node: gmOnlySnapshot,
      requirementGroups: [groups.gmOnly],
      edges: [edges.gmOnly],
    }),
    nodeAssignment({
      graph,
      school: schools.orphan,
      node: nodes.orphan,
      requirementGroups: [groups.orphan],
      edges: [edges.orphan],
    }),
  ];

  return {
    characterId,
    graph,
    currentAssignments,
    schools,
    nodes,
    nodeIds,
    schoolIds,
    groups,
    edges,
  };
}

function stateMap(nodes: readonly { node: SpellNode; state: string }[]) {
  return Object.fromEntries(nodes.map(({ node, state }) => [node.id, state]));
}

describe("UIX-578 spell progression projection", () => {
  it("calculates branch, discovery, prerequisite and visibility states deterministically", () => {
    const input = fixture();
    const { player, gm } = buildSpellProgressionProjections(input);
    const playerStates = Object.fromEntries(
      player.nodes.map(({ id: nodeId, state }) => [nodeId, state]),
    );

    expect(playerStates).toMatchObject({
      [input.nodeIds.source]: "DISCOVERED",
      [input.nodeIds.available]: "AVAILABLE",
      [input.nodeIds.rankLocked]: "LOCKED",
      [input.nodeIds.anyAvailable]: "AVAILABLE",
      [input.nodeIds.publicNoGrant]: "LOCKED",
      [input.nodeIds.discoveredAssigned]: "DISCOVERED",
      [input.nodeIds.discoveredLocked]: "LOCKED",
      [input.nodeIds.orphan]: "DISCOVERED",
    });
    expect(input.currentAssignments[0]?.snapshot.packVersionId).not.toBe(
      input.graph.versionId,
    );
    expect(playerStates[input.nodeIds.available]).toBe("AVAILABLE");

    const stableGrant = input.currentAssignments[0];
    if (!stableGrant || stableGrant.snapshot.kind !== "SCHOOL")
      throw new Error("SPELL_SCHOOL_GRANT_FIXTURE_MISSING");
    const foreignPackId = id();
    const crossPackGrant = current(
      spellAssignmentSnapshotSchema.parse({
        ...stableGrant.snapshot,
        packId: foreignPackId,
        school: { ...stableGrant.snapshot.school, packId: foreignPackId },
      }),
    );
    const withoutOwnPackGrant = buildSpellProgressionProjections({
      ...input,
      currentAssignments: [
        crossPackGrant,
        ...input.currentAssignments.slice(1),
      ],
    });
    expect(
      withoutOwnPackGrant.player.nodes.find(
        ({ id: nodeId }) => nodeId === input.nodeIds.available,
      )?.state,
    ).toBe("LOCKED");
    expect(playerStates).not.toHaveProperty(input.nodeIds.discoveredHidden);
    expect(playerStates).not.toHaveProperty(input.nodeIds.gmOnlySource);
    expect(playerStates).not.toHaveProperty(input.nodeIds.gmOnlyTarget);

    expect(stateMap(gm.nodes)).toMatchObject({
      [input.nodeIds.discoveredHidden]: "HIDDEN",
      [input.nodeIds.gmOnlySource]: "HIDDEN",
      [input.nodeIds.gmOnlyTarget]: "HIDDEN",
      [input.nodeIds.orphan]: "DISCOVERED",
    });
    expect(
      gm.nodes
        .find(
          ({ node: projected }) => projected.id === input.nodeIds.rankLocked,
        )
        ?.prerequisiteFailures.map(({ code }) => code),
    ).toEqual([
      "SOURCE_NODE_RANK_TOO_LOW",
      "THRESHOLD_NOT_EVALUABLE",
      "GM_GRANT_REQUIRED",
    ]);
    expect(
      gm.nodes.find(
        ({ node: projected }) => projected.id === input.nodeIds.anyAvailable,
      )?.prerequisiteFailures,
    ).toEqual([]);
  });

  it("does not reuse snapshot mechanics when a node UUID moves between schools", () => {
    const input = fixture();
    const oldVersionId = id();
    const oldHiddenSchool = school(input.graph.packId, oldVersionId, {
      id: id(),
      slug: "old-hidden-school",
      displayName: "OLD_HIDDEN_SCHOOL_SECRET",
      visibilityPolicy: "GM_ONLY",
      order: 99,
    });
    const oldHiddenNode = node(
      input.graph.packId,
      oldVersionId,
      oldHiddenSchool.id,
      input.nodeIds.publicNoGrant,
      "OLD_HIDDEN_NODE_SECRET",
      "OLD_HIDDEN_MECHANICS_SECRET",
    );
    const oldGraph = spellProgressionGraphSchema.parse({
      ...input.graph,
      versionId: oldVersionId,
      version: input.graph.version - 1,
      schools: [oldHiddenSchool],
      nodes: [oldHiddenNode],
      requirementGroups: [],
      edges: [],
      layout: undefined,
    });
    const oldAssignment = nodeAssignment({
      graph: oldGraph,
      school: oldHiddenSchool,
      node: oldHiddenNode,
    });

    const { player } = buildSpellProgressionProjections({
      ...input,
      currentAssignments: [oldAssignment, ...input.currentAssignments],
    });
    expect(
      player.nodes.find(
        ({ id: nodeId }) => nodeId === input.nodeIds.publicNoGrant,
      ),
    ).toEqual({
      id: input.nodeIds.publicNoGrant,
      schoolId: input.schoolIds.publicNoGrant,
      displayName: "Public no grant",
      state: "LOCKED",
    });
    expect(JSON.stringify(player)).not.toContain("OLD_HIDDEN");
  });

  it("uses immutable assignment mechanics and keeps orphan nodes without inventing player edges", () => {
    const input = fixture();
    const { player, gm } = buildSpellProgressionProjections(input);
    const discovered = player.nodes.find(
      ({ id: nodeId }) => nodeId === input.nodeIds.source,
    );
    const orphan = player.nodes.find(
      ({ id: nodeId }) => nodeId === input.nodeIds.orphan,
    );
    expect(discovered).toMatchObject({
      state: "DISCOVERED",
      mechanicsText: "SOURCE_SNAPSHOT_MECHANICS_WINS",
    });
    expect(orphan).toMatchObject({
      state: "DISCOVERED",
      mechanicsText: "ORPHAN_SNAPSHOT_MECHANICS",
    });
    expect(
      gm.nodes.find(
        ({ node: projected }) => projected.id === input.nodeIds.source,
      )?.node.mechanicsText,
    ).toBe("SOURCE_SNAPSHOT_MECHANICS_WINS");
    expect(
      gm.graph.nodes.find(({ id: nodeId }) => nodeId === input.nodeIds.source)
        ?.mechanicsText,
    ).toBe("GRAPH_SOURCE_MECHANICS_SHOULD_LOSE");
    expect(
      player.edges.some(
        ({ sourceNodeId, targetNodeId }) =>
          sourceNodeId === input.nodeIds.orphan ||
          targetNodeId === input.nodeIds.orphan,
      ),
    ).toBe(false);
  });

  it("omits hidden IDs, locked mechanics and every GM-only field from the player allowlist", () => {
    const input = fixture();
    const { player } = buildSpellProgressionProjections(input);
    const locked = player.nodes.find(
      ({ id: nodeId }) => nodeId === input.nodeIds.rankLocked,
    );
    expect(locked).toEqual({
      id: input.nodeIds.rankLocked,
      schoolId: input.schoolIds.publicGranted,
      displayName: "Rank locked",
      state: "LOCKED",
    });
    expect(
      player.edges.every(
        (edge) =>
          Object.keys(edge).sort().join(",") === "sourceNodeId,targetNodeId",
      ),
    ).toBe(true);

    const serialized = JSON.stringify(player);
    for (const secret of [
      input.schoolIds.gmOnly,
      input.nodeIds.gmOnlySource,
      input.nodeIds.gmOnlyTarget,
      input.schoolIds.discoveredHidden,
      input.nodeIds.discoveredHidden,
      "GM_ONLY_ASSIGNED_SNAPSHOT_SECRET",
      "DISCOVERED_HIDDEN_MECHANICS_SECRET",
      "LOCKED_MECHANICS_SECRET",
      "GRAPH_PROVENANCE_RAW_SECRET",
      "GRAPH_GM_NOTES_SECRET",
      "RANK_TARGET_GM_CONDITION_SECRET",
      "ACTOR_SECRET",
      "RAW_NODE_SECRET",
      "SOURCE_NAME_SECRET",
      "NARRATIVE_SECRET",
      "91001",
      "92001",
    ])
      expect(serialized).not.toContain(secret);
  });

  it("does not read layout when calculating states and uses the same prerequisite evaluator as mutation", () => {
    const input = fixture();
    const baseline = buildSpellProgressionProjections(input);
    const withDifferentLayout = buildSpellProgressionProjections({
      ...input,
      graph: {
        ...input.graph,
        layout: {
          schools: input.graph.schools.map(({ id: schoolId }, index) => ({
            schoolId,
            position: { x: index * -98_765, y: index * 54_321 },
          })),
          nodes: input.graph.nodes.map(({ id: nodeId }, index) => ({
            nodeId,
            position: { x: index * 12_345, y: index * -67_890 },
            tier: 100 - index,
          })),
        },
      },
      currentAssignments: [...input.currentAssignments].reverse(),
    });
    expect(withDifferentLayout.player).toEqual(baseline.player);
    expect(stateMap(withDifferentLayout.gm.nodes)).toEqual(
      stateMap(baseline.gm.nodes),
    );

    const rankGroup = input.groups.rank;
    const rankEdge = input.edges.rank;
    const targetSnapshot = nodeAssignment({
      graph: input.graph,
      school: input.schools.publicGranted,
      node: input.nodes.rankLocked,
      requirementGroups: [rankGroup],
      edges: [rankEdge],
    }).snapshot;
    expect(targetSnapshot.kind).toBe("NODE");
    expect(
      evaluateSpellAssignmentPrerequisites(
        targetSnapshot,
        input.currentAssignments,
      ),
    ).toEqual(
      evaluateSpellPrerequisites(
        {
          packId: input.graph.packId,
          schoolId: input.schoolIds.publicGranted,
          requirementGroups: [rankGroup],
          edges: [rankEdge],
        },
        input.currentAssignments,
      ),
    );
  });
});

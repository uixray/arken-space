import {
  gmSpellProgressionProjectionSchema,
  playerSpellProgressionProjectionSchema,
  type GmSpellProgressionProjection,
  type PlayerSpellProgressionProjection,
  type PlayerSpellProjectionNode,
  type SpellNode,
  type SpellPrerequisiteFailure,
  type SpellProgressionGraph,
  type SpellProjectionNodeState,
  type SpellRequirementEdge,
  type SpellRequirementGroup,
  type SpellSchool,
} from "@arken/contracts";
import {
  evaluateSpellPrerequisites,
  type CurrentSpellAssignmentVersion,
} from "./spell-assignment-storage.js";

export interface BuildSpellProgressionProjectionsInput {
  characterId: string;
  graph: SpellProgressionGraph;
  currentAssignments: readonly CurrentSpellAssignmentVersion[];
}

export interface SpellProgressionProjections {
  player: PlayerSpellProgressionProjection;
  gm: GmSpellProgressionProjection;
}

interface ProjectedNode {
  school: SpellSchool;
  identityNode: SpellNode;
  mechanicsNode: SpellNode;
  state: SpellProjectionNodeState;
  prerequisiteFailures: SpellPrerequisiteFailure[];
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function compareSchools(left: SpellSchool, right: SpellSchool): number {
  return left.order - right.order || compareText(left.id, right.id);
}

function compareProjectedNodes(left: ProjectedNode, right: ProjectedNode) {
  return (
    compareSchools(left.school, right.school) ||
    compareText(left.identityNode.id, right.identityNode.id)
  );
}

function compareCurrentAssignments(
  left: CurrentSpellAssignmentVersion,
  right: CurrentSpellAssignmentVersion,
): number {
  return (
    left.snapshot.assignmentVersion - right.snapshot.assignmentVersion ||
    compareText(left.snapshot.assignmentId, right.snapshot.assignmentId) ||
    compareText(
      left.snapshot.assignmentVersionId,
      right.snapshot.assignmentVersionId,
    )
  );
}

function nodeIdentityKey(schoolId: string, nodeId: string): string {
  return `${schoolId}\u0000${nodeId}`;
}

function currentNodeAssignments(
  assignments: readonly CurrentSpellAssignmentVersion[],
): Map<string, CurrentSpellAssignmentVersion> {
  const byNodeIdentity = new Map<string, CurrentSpellAssignmentVersion>();
  for (const assignment of [...assignments].sort(compareCurrentAssignments)) {
    if (assignment.snapshot.kind !== "NODE") continue;
    byNodeIdentity.set(
      nodeIdentityKey(assignment.snapshot.schoolId, assignment.snapshot.nodeId),
      assignment,
    );
  }
  return byNodeIdentity;
}

function indexPrerequisites(graph: SpellProgressionGraph) {
  const groupsByNodeId = new Map<string, SpellRequirementGroup[]>();
  for (const group of graph.requirementGroups) {
    const groups = groupsByNodeId.get(group.targetNodeId) ?? [];
    groups.push(group);
    groupsByNodeId.set(group.targetNodeId, groups);
  }

  const edgesByGroupId = new Map<string, SpellRequirementEdge[]>();
  for (const edge of graph.edges) {
    const edges = edgesByGroupId.get(edge.requirementGroupId) ?? [];
    edges.push(edge);
    edgesByGroupId.set(edge.requirementGroupId, edges);
  }
  return { groupsByNodeId, edgesByGroupId };
}

function nodePrerequisites(
  graph: SpellProgressionGraph,
  node: SpellNode,
  currentAssignments: readonly CurrentSpellAssignmentVersion[],
  groupsByNodeId: ReadonlyMap<string, SpellRequirementGroup[]>,
  edgesByGroupId: ReadonlyMap<string, SpellRequirementEdge[]>,
): SpellPrerequisiteFailure[] {
  const requirementGroups = groupsByNodeId.get(node.id) ?? [];
  const edges = requirementGroups.flatMap(
    (group) => edgesByGroupId.get(group.id) ?? [],
  );
  return evaluateSpellPrerequisites(
    {
      packId: graph.packId,
      schoolId: node.schoolId,
      requirementGroups,
      edges,
    },
    currentAssignments,
  );
}

function schoolIsPlayerVisible(
  school: SpellSchool,
  assignedSchoolIds: ReadonlySet<string>,
): boolean {
  if (school.visibilityPolicy === "GM_ONLY") return false;
  return (
    school.visibilityPolicy === "PUBLIC" || assignedSchoolIds.has(school.id)
  );
}

function nodeState(
  school: SpellSchool,
  assignedSchoolIds: ReadonlySet<string>,
  branchGrantedSchoolIds: ReadonlySet<string>,
  assignedNode: CurrentSpellAssignmentVersion | undefined,
  prerequisiteFailures: readonly SpellPrerequisiteFailure[],
): SpellProjectionNodeState {
  if (!schoolIsPlayerVisible(school, assignedSchoolIds)) return "HIDDEN";
  if (assignedNode) return "DISCOVERED";
  if (
    branchGrantedSchoolIds.has(school.id) &&
    prerequisiteFailures.length === 0
  )
    return "AVAILABLE";
  return "LOCKED";
}

function playerGameplayNode(
  projected: ProjectedNode,
): PlayerSpellProjectionNode {
  const { identityNode, mechanicsNode, state } = projected;
  if (state === "LOCKED")
    return {
      id: identityNode.id,
      schoolId: identityNode.schoolId,
      displayName: identityNode.displayName,
      state,
    };
  if (state !== "AVAILABLE" && state !== "DISCOVERED")
    throw new Error("HIDDEN_SPELL_NODE_CANNOT_ENTER_PLAYER_PROJECTION");
  return {
    id: identityNode.id,
    schoolId: identityNode.schoolId,
    displayName: identityNode.displayName,
    state,
    mechanicsText: mechanicsNode.mechanicsText,
    activation: mechanicsNode.activation,
    costs: mechanicsNode.costs,
    usageLimit: mechanicsNode.usageLimit,
    durationText: mechanicsNode.durationText,
    rangeText: mechanicsNode.rangeText,
    targetText: mechanicsNode.targetText,
    areaText: mechanicsNode.areaText,
    rollActions: mechanicsNode.rollActions,
    effects: mechanicsNode.effects,
  };
}

function buildProjectedNodes(
  graph: SpellProgressionGraph,
  currentAssignments: readonly CurrentSpellAssignmentVersion[],
): ProjectedNode[] {
  // Assignment snapshots deliberately survive pack-version changes. Stable
  // school/node identities keep grants and discoveries while their mechanics
  // remain pinned to the immutable assignment snapshot.
  const assignments = currentAssignments.filter(
    ({ snapshot }) => snapshot.packId === graph.packId,
  );
  const assignedSchoolIds = new Set(
    assignments.map(({ snapshot }) => snapshot.schoolId),
  );
  const branchGrantedSchoolIds = new Set(
    assignments
      .filter(({ snapshot }) => snapshot.kind === "SCHOOL")
      .map(({ snapshot }) => snapshot.schoolId),
  );
  const nodeAssignments = currentNodeAssignments(assignments);
  const schoolsById = new Map(
    graph.schools.map((school) => [school.id, school] as const),
  );
  const graphNodeIdentities = new Set(
    graph.nodes.map((node) => nodeIdentityKey(node.schoolId, node.id)),
  );
  const { groupsByNodeId, edgesByGroupId } = indexPrerequisites(graph);

  const projected = graph.nodes.map((node): ProjectedNode => {
    const school = schoolsById.get(node.schoolId);
    if (!school) throw new Error("SPELL_PROJECTION_SCHOOL_NOT_FOUND");
    const assignment = nodeAssignments.get(
      nodeIdentityKey(node.schoolId, node.id),
    );
    const prerequisiteFailures = nodePrerequisites(
      graph,
      node,
      assignments,
      groupsByNodeId,
      edgesByGroupId,
    );
    return {
      school,
      identityNode: node,
      mechanicsNode:
        assignment?.snapshot.kind === "NODE" ? assignment.snapshot.node : node,
      state: nodeState(
        school,
        assignedSchoolIds,
        branchGrantedSchoolIds,
        assignment,
        prerequisiteFailures,
      ),
      prerequisiteFailures,
    };
  });

  for (const assignment of nodeAssignments.values()) {
    const snapshot = assignment.snapshot;
    if (snapshot.kind !== "NODE") continue;
    if (
      graphNodeIdentities.has(
        nodeIdentityKey(snapshot.schoolId, snapshot.nodeId),
      )
    )
      continue;
    const school = schoolsById.get(snapshot.schoolId) ?? snapshot.school;
    const prerequisiteFailures = evaluateSpellPrerequisites(
      {
        packId: snapshot.packId,
        schoolId: snapshot.schoolId,
        requirementGroups: snapshot.requirementGroups,
        edges: snapshot.edges,
      },
      assignments,
    );
    projected.push({
      school,
      identityNode: snapshot.node,
      mechanicsNode: snapshot.node,
      state: school.visibilityPolicy === "GM_ONLY" ? "HIDDEN" : "DISCOVERED",
      prerequisiteFailures,
    });
  }

  return projected.sort(compareProjectedNodes);
}

function buildPlayerProjection(
  characterId: string,
  graph: SpellProgressionGraph,
  projectedNodes: readonly ProjectedNode[],
  currentAssignments: readonly CurrentSpellAssignmentVersion[],
): PlayerSpellProgressionProjection {
  const visibleNodes = projectedNodes.filter(({ state }) => state !== "HIDDEN");
  const visibleSchoolIds = new Set(visibleNodes.map(({ school }) => school.id));
  const assignedSchoolIds = new Set(
    currentAssignments
      .filter(({ snapshot }) => snapshot.packId === graph.packId)
      .map(({ snapshot }) => snapshot.schoolId),
  );
  for (const school of graph.schools)
    if (schoolIsPlayerVisible(school, assignedSchoolIds))
      visibleSchoolIds.add(school.id);

  const schoolsById = new Map<string, SpellSchool>();
  for (const school of graph.schools)
    if (visibleSchoolIds.has(school.id)) schoolsById.set(school.id, school);
  for (const { school } of visibleNodes)
    if (!schoolsById.has(school.id)) schoolsById.set(school.id, school);

  const nodes = visibleNodes.map(playerGameplayNode);
  const visibleNodeIds = new Set(nodes.map((node) => node.id));
  const edges = graph.edges
    .filter(
      (edge) =>
        visibleNodeIds.has(edge.sourceNodeId) &&
        visibleNodeIds.has(edge.targetNodeId),
    )
    .map(({ sourceNodeId, targetNodeId }) => ({
      sourceNodeId,
      targetNodeId,
    }))
    .sort(
      (left, right) =>
        compareText(left.sourceNodeId, right.sourceNodeId) ||
        compareText(left.targetNodeId, right.targetNodeId),
    );

  return playerSpellProgressionProjectionSchema.parse({
    characterId,
    packId: graph.packId,
    packVersionId: graph.versionId,
    schools: [...schoolsById.values()]
      .sort(compareSchools)
      .map(({ id, displayName }) => ({ id, displayName })),
    nodes,
    edges,
  });
}

export function buildSpellProgressionProjections({
  characterId,
  graph,
  currentAssignments,
}: BuildSpellProgressionProjectionsInput): SpellProgressionProjections {
  const projectedNodes = buildProjectedNodes(graph, currentAssignments);
  const player = buildPlayerProjection(
    characterId,
    graph,
    projectedNodes,
    currentAssignments,
  );
  const gm = gmSpellProgressionProjectionSchema.parse({
    characterId,
    packId: graph.packId,
    packVersionId: graph.versionId,
    graph,
    nodes: projectedNodes.map(
      ({ school, mechanicsNode: node, state, prerequisiteFailures }) => ({
        school,
        node,
        state,
        prerequisiteFailures,
      }),
    ),
  });
  return { player, gm };
}

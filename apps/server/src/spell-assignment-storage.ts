import { and, asc, desc, eq } from "drizzle-orm";
import {
  spellAssignmentSnapshotSchema,
  type SpellAssignmentSnapshot,
  type SpellAssignmentTarget,
  type SpellPrerequisiteFailure,
  type SpellProgressionGraph,
  type SpellRequirementEdge,
  type SpellRequirementGroup,
} from "@arken/contracts";
import { characterSpellAssignmentVersions, spellPackVersions } from "@arken/db";
import {
  validateSpellGraphSnapshot,
  type SpellPackTransaction,
} from "./spell-pack-storage.js";

type AssignmentVersionRow =
  typeof characterSpellAssignmentVersions.$inferSelect;

export type SpellAssignmentDomainErrorCode =
  | "SPELL_PACK_VERSION_NOT_FOUND"
  | "SPELL_PACK_VERSION_NOT_ACTIVE"
  | "SPELL_SCHOOL_NOT_FOUND"
  | "SPELL_NODE_NOT_FOUND"
  | "SPELL_NODE_NOT_ACTIVE";

export class SpellAssignmentDomainError extends Error {
  constructor(readonly code: SpellAssignmentDomainErrorCode) {
    super(code);
    this.name = "SpellAssignmentDomainError";
  }
}

export interface SpellAssignmentSnapshotIdentity {
  assignmentId: string;
  assignmentVersionId: string;
  assignmentVersion: number;
}

export interface LoadedSpellGraph {
  graph: SpellProgressionGraph;
  packVersion: number;
}

export interface CurrentSpellAssignmentVersion {
  row: AssignmentVersionRow;
  snapshot: SpellAssignmentSnapshot;
}

export type SpellAssignmentReadExecutor = Pick<SpellPackTransaction, "select">;

export type { SpellPrerequisiteFailure } from "@arken/contracts";

export interface SpellPrerequisiteTarget {
  packId: string;
  schoolId: string;
  requirementGroups: readonly SpellRequirementGroup[];
  edges: readonly SpellRequirementEdge[];
}

export async function loadActiveSpellGraph(
  tx: SpellPackTransaction,
  campaignId: string,
  packId: string,
  packVersionId: string,
): Promise<LoadedSpellGraph> {
  const [row] = await tx
    .select()
    .from(spellPackVersions)
    .where(
      and(
        eq(spellPackVersions.campaignId, campaignId),
        eq(spellPackVersions.packId, packId),
        eq(spellPackVersions.id, packVersionId),
      ),
    )
    .limit(1);
  if (!row)
    throw new SpellAssignmentDomainError("SPELL_PACK_VERSION_NOT_FOUND");
  const validated = validateSpellGraphSnapshot(row.graph);
  if (row.lifecycle !== "ACTIVE" || validated.graph.lifecycle !== "ACTIVE")
    throw new SpellAssignmentDomainError("SPELL_PACK_VERSION_NOT_ACTIVE");
  return { graph: validated.graph, packVersion: row.version };
}

export function buildSpellAssignmentSnapshot(
  loaded: LoadedSpellGraph,
  identity: SpellAssignmentSnapshotIdentity,
  target: SpellAssignmentTarget,
): SpellAssignmentSnapshot {
  const { graph, packVersion } = loaded;
  const school = graph.schools.find(
    (candidate) => candidate.id === target.schoolId,
  );
  if (!school) throw new SpellAssignmentDomainError("SPELL_SCHOOL_NOT_FOUND");

  if (target.kind === "SCHOOL")
    return spellAssignmentSnapshotSchema.parse({
      schemaVersion: 1,
      ...identity,
      packId: graph.packId,
      packVersionId: graph.versionId,
      packVersion,
      packLifecycle: "ACTIVE",
      provenance: graph.provenance,
      kind: "SCHOOL",
      schoolId: school.id,
      school,
      nodeId: null,
      rank: null,
      node: null,
      requirementGroups: [],
      edges: [],
    });

  const node = graph.nodes.find(
    (candidate) =>
      candidate.id === target.nodeId && candidate.schoolId === target.schoolId,
  );
  if (!node) throw new SpellAssignmentDomainError("SPELL_NODE_NOT_FOUND");
  if (node.lifecycle !== "ACTIVE")
    throw new SpellAssignmentDomainError("SPELL_NODE_NOT_ACTIVE");
  const requirementGroups = graph.requirementGroups.filter(
    (group) => group.targetNodeId === node.id,
  );
  const groupIds = new Set(requirementGroups.map((group) => group.id));
  const edges = graph.edges.filter((edge) =>
    groupIds.has(edge.requirementGroupId),
  );
  return spellAssignmentSnapshotSchema.parse({
    schemaVersion: 1,
    ...identity,
    packId: graph.packId,
    packVersionId: graph.versionId,
    packVersion,
    packLifecycle: "ACTIVE",
    provenance: graph.provenance,
    kind: "NODE",
    schoolId: school.id,
    school,
    nodeId: node.id,
    rank: target.rank,
    node,
    requirementGroups,
    edges,
  });
}

export async function loadCurrentSpellAssignmentVersions(
  tx: SpellAssignmentReadExecutor,
  campaignId: string,
  characterId: string,
  excludeAssignmentId?: string,
): Promise<CurrentSpellAssignmentVersion[]> {
  const rows = await tx
    .select()
    .from(characterSpellAssignmentVersions)
    .where(
      and(
        eq(characterSpellAssignmentVersions.campaignId, campaignId),
        eq(characterSpellAssignmentVersions.characterId, characterId),
      ),
    )
    .orderBy(
      asc(characterSpellAssignmentVersions.assignmentId),
      desc(characterSpellAssignmentVersions.version),
    );
  const seen = new Set<string>();
  const current: CurrentSpellAssignmentVersion[] = [];
  for (const row of rows) {
    if (row.assignmentId === excludeAssignmentId || seen.has(row.assignmentId))
      continue;
    seen.add(row.assignmentId);
    current.push({
      row,
      snapshot: spellAssignmentSnapshotSchema.parse(row.snapshot),
    });
  }
  return current;
}

export function hasDuplicateCurrentTarget(
  candidate: SpellAssignmentSnapshot,
  current: readonly CurrentSpellAssignmentVersion[],
): boolean {
  return current.some(({ snapshot }) => {
    if (
      snapshot.packId !== candidate.packId ||
      snapshot.schoolId !== candidate.schoolId ||
      snapshot.kind !== candidate.kind
    )
      return false;
    return snapshot.kind === "SCHOOL" || snapshot.nodeId === candidate.nodeId;
  });
}

function failureForEdge(
  groupId: string,
  edge: SpellRequirementEdge,
  knownRanks: ReadonlyMap<string, number>,
): SpellPrerequisiteFailure[] {
  const failures: SpellPrerequisiteFailure[] = [];
  const actualRank = knownRanks.get(edge.sourceNodeId);
  if (actualRank === undefined)
    failures.push({
      code: "SOURCE_NODE_MISSING",
      groupId,
      edgeId: edge.id,
      sourceNodeId: edge.sourceNodeId,
    });
  else if (edge.minimumRank !== undefined && actualRank < edge.minimumRank)
    failures.push({
      code: "SOURCE_NODE_RANK_TOO_LOW",
      groupId,
      edgeId: edge.id,
      sourceNodeId: edge.sourceNodeId,
      requiredRank: edge.minimumRank,
      actualRank,
    });
  if (edge.threshold !== undefined)
    failures.push({
      code: "THRESHOLD_NOT_EVALUABLE",
      groupId,
      edgeId: edge.id,
      sourceNodeId: edge.sourceNodeId,
    });
  if (edge.gmGrantCondition !== undefined)
    failures.push({
      code: "GM_GRANT_REQUIRED",
      groupId,
      edgeId: edge.id,
      sourceNodeId: edge.sourceNodeId,
    });
  return failures;
}

export function evaluateSpellPrerequisites(
  target: SpellPrerequisiteTarget,
  current: readonly CurrentSpellAssignmentVersion[],
): SpellPrerequisiteFailure[] {
  const knownRanks = new Map<string, number>();
  for (const { snapshot } of current) {
    if (
      snapshot.kind !== "NODE" ||
      snapshot.packId !== target.packId ||
      snapshot.schoolId !== target.schoolId
    )
      continue;
    knownRanks.set(
      snapshot.nodeId,
      Math.max(knownRanks.get(snapshot.nodeId) ?? 0, snapshot.rank),
    );
  }

  const edgesByGroup = new Map<string, SpellRequirementEdge[]>();
  for (const edge of target.edges) {
    const groupEdges = edgesByGroup.get(edge.requirementGroupId) ?? [];
    groupEdges.push(edge);
    edgesByGroup.set(edge.requirementGroupId, groupEdges);
  }

  const failures: SpellPrerequisiteFailure[] = [];
  for (const group of target.requirementGroups) {
    if (group.mode === "UNRESOLVED") {
      failures.push({ code: "UNRESOLVED_GROUP", groupId: group.id });
      continue;
    }
    const edgeFailures = (edgesByGroup.get(group.id) ?? []).map((edge) =>
      failureForEdge(group.id, edge, knownRanks),
    );
    if (
      group.mode === "ANY" &&
      edgeFailures.some((edgeFailure) => edgeFailure.length === 0)
    )
      continue;
    for (const edgeFailure of edgeFailures) failures.push(...edgeFailure);
  }
  return failures;
}

export function evaluateSpellAssignmentPrerequisites(
  candidate: SpellAssignmentSnapshot,
  current: readonly CurrentSpellAssignmentVersion[],
): SpellPrerequisiteFailure[] {
  if (candidate.kind === "SCHOOL") return [];
  return evaluateSpellPrerequisites(candidate, current);
}

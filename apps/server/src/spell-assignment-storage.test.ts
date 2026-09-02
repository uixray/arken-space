import { describe, expect, it } from "vitest";
import {
  spellAssignmentSnapshotSchema,
  type SpellAssignmentSnapshot,
  type SpellRequirementEdge,
  type SpellRequirementGroup,
} from "@arken/contracts";
import {
  evaluateSpellAssignmentPrerequisites,
  type CurrentSpellAssignmentVersion,
} from "./spell-assignment-storage.js";

const id = () => crypto.randomUUID();
const ids = {
  pack: id(),
  version: id(),
  school: id(),
  source: id(),
  target: id(),
};

function nodeSnapshot(
  nodeId: string,
  rank: number,
  requirementGroups: SpellRequirementGroup[] = [],
  edges: SpellRequirementEdge[] = [],
): SpellAssignmentSnapshot {
  const assignmentId = id();
  const assignmentVersionId = id();
  return spellAssignmentSnapshotSchema.parse({
    schemaVersion: 1,
    assignmentId,
    assignmentVersionId,
    assignmentVersion: 1,
    packId: ids.pack,
    packVersionId: ids.version,
    packVersion: 1,
    packLifecycle: "ACTIVE",
    provenance: {
      sourceType: "GM_AUTHORED",
      sourceLabel: "UIX-577 prerequisite test",
      rawSourceText: "Prerequisite source",
    },
    kind: "NODE",
    schoolId: ids.school,
    school: {
      id: ids.school,
      packId: ids.pack,
      packVersionId: ids.version,
      slug: "prerequisite-test",
      sourceName: "Prerequisite test",
      displayName: "Prerequisite test",
      description: "",
      visibilityPolicy: "PUBLIC",
      order: 0,
    },
    nodeId,
    rank,
    node: {
      id: nodeId,
      packId: ids.pack,
      packVersionId: ids.version,
      schoolId: ids.school,
      sourceName: "Node",
      displayName: "Node",
      rawSourceText: "Source",
      narrativeText: "Narrative",
      mechanicsText: "Mechanics",
      lifecycle: "ACTIVE",
      revision: 0,
      revisionProvenance: {},
      activation: { passive: true, triggers: [] },
      costs: [],
      usageLimit: null,
    },
    requirementGroups,
    edges,
  });
}

function current(snapshot: SpellAssignmentSnapshot) {
  return [
    { snapshot, row: {} as never },
  ] satisfies CurrentSpellAssignmentVersion[];
}

function prerequisite(
  mode: SpellRequirementGroup["mode"],
  edgeInputs: Array<
    Partial<SpellRequirementEdge> & Pick<SpellRequirementEdge, "sourceNodeId">
  >,
) {
  const groupId = id();
  const group: SpellRequirementGroup = {
    id: groupId,
    packId: ids.pack,
    packVersionId: ids.version,
    schoolId: ids.school,
    targetNodeId: ids.target,
    mode,
  };
  const edges: SpellRequirementEdge[] = edgeInputs.map((input) => ({
    id: id(),
    packId: ids.pack,
    packVersionId: ids.version,
    schoolId: ids.school,
    requirementGroupId: groupId,
    targetNodeId: ids.target,
    ...input,
  }));
  return nodeSnapshot(ids.target, 1, [group], edges);
}

describe("UIX-577 assignment prerequisite evaluation", () => {
  it("fails closed for rank, threshold, GM condition and unresolved text", () => {
    const known = current(nodeSnapshot(ids.source, 1));
    const simultaneous = evaluateSpellAssignmentPrerequisites(
      prerequisite("ALL", [
        {
          sourceNodeId: ids.source,
          minimumRank: 2,
          threshold: 12,
          gmGrantCondition: "Only after omen",
        },
      ]),
      known,
    );
    expect(simultaneous.map(({ code }) => code)).toEqual([
      "SOURCE_NODE_RANK_TOO_LOW",
      "THRESHOLD_NOT_EVALUABLE",
      "GM_GRANT_REQUIRED",
    ]);
    expect(simultaneous[0]).toMatchObject({
      code: "SOURCE_NODE_RANK_TOO_LOW",
      sourceNodeId: ids.source,
      requiredRank: 2,
      actualRank: 1,
    });
    expect(
      evaluateSpellAssignmentPrerequisites(
        prerequisite("UNRESOLVED", []),
        known,
      )[0]?.code,
    ).toBe("UNRESOLVED_GROUP");
  });

  it("accepts an ANY group when at least one edge is satisfied", () => {
    const known = current(nodeSnapshot(ids.source, 1));
    expect(
      evaluateSpellAssignmentPrerequisites(
        prerequisite("ANY", [
          { sourceNodeId: ids.source, minimumRank: 2 },
          { sourceNodeId: ids.source },
        ]),
        known,
      ),
    ).toEqual([]);
  });
});

import { describe, expect, it } from "vitest";
import {
  appendSpellAssignmentVersionCommandSchema,
  createSpellAssignmentCommandSchema,
  spellAssignmentSnapshotSchema,
} from "../packages/contracts/src/index.js";

const id = () => crypto.randomUUID();

function commandFixture() {
  return {
    actionId: id(),
    assignmentId: id(),
    assignmentVersionId: id(),
    expectedVersion: 0 as const,
    packId: id(),
    packVersionId: id(),
    target: { kind: "SCHOOL" as const, schoolId: id() },
  };
}

function nodeSnapshot() {
  const assignmentId = id();
  const assignmentVersionId = id();
  const packId = id();
  const packVersionId = id();
  const schoolId = id();
  const sourceNodeId = id();
  const nodeId = id();
  const groupId = id();
  const node = {
    id: nodeId,
    packId,
    packVersionId,
    schoolId,
    sourceName: "Target",
    displayName: "Target",
    rawSourceText: "Target source",
    narrativeText: "Target narrative",
    mechanicsText: "Private mechanics",
    lifecycle: "ACTIVE" as const,
    revision: 0,
    revisionProvenance: {},
    activation: { passive: true, triggers: [] },
    costs: [],
    usageLimit: null,
  };
  return {
    schemaVersion: 1 as const,
    assignmentId,
    assignmentVersionId,
    assignmentVersion: 1,
    packId,
    packVersionId,
    packVersion: 4,
    packLifecycle: "ACTIVE" as const,
    provenance: {
      sourceType: "GM_AUTHORED" as const,
      sourceLabel: "Contract test",
      rawSourceText: "Private source",
    },
    kind: "NODE" as const,
    schoolId,
    school: {
      id: schoolId,
      packId,
      packVersionId,
      slug: "contract-school",
      sourceName: "Contract school",
      displayName: "Contract school",
      description: "",
      visibilityPolicy: "PUBLIC" as const,
      order: 0,
    },
    nodeId,
    rank: 2,
    node,
    requirementGroups: [
      {
        id: groupId,
        packId,
        packVersionId,
        schoolId,
        targetNodeId: nodeId,
        mode: "ALL" as const,
      },
    ],
    edges: [
      {
        id: id(),
        packId,
        packVersionId,
        schoolId,
        requirementGroupId: groupId,
        sourceNodeId,
        targetNodeId: nodeId,
        minimumRank: 2,
      },
    ],
  };
}

describe("UIX-577 spell assignment contracts", () => {
  it("keeps create and append envelopes strict with explicit CAS", () => {
    const create = commandFixture();
    expect(createSpellAssignmentCommandSchema.safeParse(create).success).toBe(
      true,
    );
    expect(
      createSpellAssignmentCommandSchema.safeParse({ ...create, extra: true })
        .success,
    ).toBe(false);
    expect(
      createSpellAssignmentCommandSchema.safeParse({
        ...create,
        expectedVersion: 1,
      }).success,
    ).toBe(false);

    const { assignmentId: _assignmentId, ...append } = create;
    expect(
      appendSpellAssignmentVersionCommandSchema.safeParse({
        ...append,
        expectedVersion: 1,
        target: { kind: "NODE", schoolId: id(), nodeId: id(), rank: 1 },
      }).success,
    ).toBe(true);
    expect(
      appendSpellAssignmentVersionCommandSchema.safeParse({
        ...append,
        expectedVersion: 0,
      }).success,
    ).toBe(false);
    expect(
      appendSpellAssignmentVersionCommandSchema.safeParse({
        ...append,
        expectedVersion: 1,
        target: { kind: "NODE", schoolId: id(), nodeId: id(), rank: 0 },
      }).success,
    ).toBe(false);
  });

  it("rejects empty override reasons before a command can reach persistence", () => {
    const command = commandFixture();
    for (const overrideReason of ["", "   "])
      expect(
        createSpellAssignmentCommandSchema.safeParse({
          ...command,
          overrideReason,
        }).success,
      ).toBe(false);
  });

  it("accepts a self-contained immutable node rules snapshot", () => {
    const snapshot = nodeSnapshot();
    expect(spellAssignmentSnapshotSchema.parse(snapshot)).toEqual(snapshot);
    expect(snapshot).not.toHaveProperty("layout");
  });

  it("rejects mixed school, node and requirement identities", () => {
    const snapshot = nodeSnapshot();
    expect(
      spellAssignmentSnapshotSchema.safeParse({
        ...snapshot,
        school: { ...snapshot.school, packVersionId: id() },
      }).success,
    ).toBe(false);
    expect(
      spellAssignmentSnapshotSchema.safeParse({
        ...snapshot,
        edges: [
          { ...snapshot.edges[0], requirementGroupId: crypto.randomUUID() },
        ],
      }).success,
    ).toBe(false);
  });
});

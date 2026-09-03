import { describe, expect, it } from "vitest";
import {
  appendSpellPackDraftVersionCommandSchema,
  archiveSpellPackCommandSchema,
  createSpellPackCommandSchema,
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

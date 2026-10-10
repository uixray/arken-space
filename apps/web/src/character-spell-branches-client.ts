import type { CreateSpellAssignmentCommand } from "@arken/contracts";
import {
  assignSpellSchool,
  fetchAssignableSpellSchools,
  fetchCharacterSpellBranches,
  type AssignableSpellSchool,
  type CharacterSpellBranch,
} from "./spell-schools-client";

export type { AssignableSpellSchool, CharacterSpellBranch };

export type PendingSchoolAssignment = CreateSpellAssignmentCommand;

const newId = () => globalThis.crypto.randomUUID();

export function createSchoolAssignmentEnvelope(
  school: AssignableSpellSchool,
): PendingSchoolAssignment {
  return {
    actionId: newId(),
    assignmentId: newId(),
    assignmentVersionId: newId(),
    expectedVersion: 0,
    packId: school.packId,
    packVersionId: school.packVersionId,
    target: { kind: "SCHOOL", schoolId: school.schoolId },
  };
}

export async function loadCharacterSchoolBranches(
  characterId: string,
): Promise<CharacterSpellBranch[]> {
  return fetchCharacterSpellBranches(characterId);
}

export async function loadAssignableSchools(): Promise<AssignableSpellSchool[]> {
  return fetchAssignableSpellSchools();
}

export function submitSchoolAssignment(
  characterId: string,
  command: PendingSchoolAssignment,
) {
  return assignSpellSchool(characterId, command);
}

export async function reconcileSchoolAssignment(
  characterId: string,
  command: PendingSchoolAssignment,
) {
  const branches = await fetchCharacterSpellBranches(characterId);
  return branches.some(
    (branch) =>
      branch.packId === command.packId &&
      branch.packVersionId === command.packVersionId &&
      branch.schoolId === command.target.schoolId,
  );
}


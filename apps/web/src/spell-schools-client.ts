import type {
  CreateSpellAssignmentCommand,
  SpellAssignmentVersionDto,
  SpellPackLifecycle,
  SpellPackValidationResponse,
  SpellPackVersionDto,
  SpellProgressionGraph,
  TransitionSpellPackLifecycleCommand,
} from "@arken/contracts";
import { api } from "./api";

export type SpellPackSummary = {
  id: string;
  latestVersionId: string;
  latestVersion: number;
  lifecycle: SpellPackLifecycle;
  title: string;
  createdAt: string;
};

export type AssignableSpellSchool = {
  packId: string;
  packVersionId: string;
  packVersion: number;
  packTitle: string;
  schoolId: string;
  schoolName: string;
  visibilityPolicy: "PUBLIC" | "ASSIGNED_ONLY" | "GM_ONLY";
};

export type CharacterSpellBranch = {
  packId: string;
  packVersionId: string;
  packVersion: number;
  schoolId: string;
  schoolName: string;
};

export const fetchSpellPackList = async () =>
  (await api<{ packs: SpellPackSummary[] }>("/api/spell-packs")).packs;

export const fetchSpellPackVersion = (packId: string, versionId: string) =>
  api<SpellPackVersionDto>(
    `/api/spell-packs/${encodeURIComponent(packId)}/versions/${encodeURIComponent(versionId)}`,
  );

export const validateSpellPackDraft = (graph: SpellProgressionGraph) =>
  api<SpellPackValidationResponse>("/api/spell-packs/validate", {
    method: "POST",
    body: JSON.stringify({ graph }),
  });

export const createSpellPackDraft = (
  graph: SpellProgressionGraph,
  actionId: string,
) =>
  api<SpellPackVersionDto>("/api/spell-packs", {
    method: "POST",
    body: JSON.stringify({ actionId, expectedVersion: 0, graph }),
  });

export const appendSpellPackDraftVersion = (
  graph: SpellProgressionGraph,
  expectedVersion: number,
  actionId: string,
) =>
  api<SpellPackVersionDto>(
    `/api/spell-packs/${encodeURIComponent(graph.packId)}/versions`,
    {
      method: "POST",
      body: JSON.stringify({ actionId, expectedVersion, graph }),
    },
  );

export const promoteSpellPackToActive = (
  packId: string,
  command: TransitionSpellPackLifecycleCommand,
) =>
  api<SpellPackVersionDto>(
    `/api/spell-packs/${encodeURIComponent(packId)}/lifecycle`,
    { method: "POST", body: JSON.stringify(command) },
  );

export async function fetchAssignableSpellSchools(): Promise<
  AssignableSpellSchool[]
> {
  const schools: AssignableSpellSchool[] = [];
  let afterVersionId: string | undefined;
  do {
    const query = afterVersionId
      ? `?afterVersionId=${encodeURIComponent(afterVersionId)}`
      : "";
    const page = await api<{
      schools: AssignableSpellSchool[];
      nextCursor: string | null;
    }>(`/api/spell-assignable-schools${query}`);
    schools.push(...page.schools);
    afterVersionId = page.nextCursor ?? undefined;
  } while (afterVersionId);
  return schools;
}

export async function fetchCharacterSpellBranches(
  characterId: string,
): Promise<CharacterSpellBranch[]> {
  const branches: CharacterSpellBranch[] = [];
  let afterAssignmentId: string | undefined;
  do {
    const query = afterAssignmentId
      ? `?afterAssignmentId=${encodeURIComponent(afterAssignmentId)}`
      : "";
    const page = await api<{
      branches: CharacterSpellBranch[];
      nextCursor: string | null;
    }>(
      `/api/characters/${encodeURIComponent(characterId)}/spell-branches${query}`,
    );
    branches.push(...page.branches);
    afterAssignmentId = page.nextCursor ?? undefined;
  } while (afterAssignmentId);
  return branches;
}

export const assignSpellSchool = (
  characterId: string,
  command: CreateSpellAssignmentCommand,
) =>
  api<SpellAssignmentVersionDto>(
    `/api/characters/${encodeURIComponent(characterId)}/spell-assignments`,
    { method: "POST", body: JSON.stringify(command) },
  );

import type {
  SpellPackLifecycle,
  SpellPackValidationResponse,
  SpellPackVersionDto,
  SpellProgressionGraph,
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

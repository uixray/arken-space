import type {
  SpellNode,
  SpellProgressionGraph,
  SpellRequirementEdge,
  SpellRequirementGroup,
  SpellSchool,
} from "@arken/contracts";

const createId = () => globalThis.crypto.randomUUID();

export function createEmptySpellDraft(title: string): SpellProgressionGraph {
  const packId = createId();
  const versionId = createId();
  return {
    packId,
    versionId,
    version: 1,
    title: title.trim(),
    lifecycle: "DRAFT",
    provenance: {
      sourceType: "GM_AUTHORED",
      sourceLabel: "GM draft",
      rawSourceText: "",
    },
    schools: [],
    nodes: [],
    requirementGroups: [],
    edges: [],
  };
}

export function createSpellSchool(
  graph: SpellProgressionGraph,
  name: string,
): SpellSchool {
  const displayName = name.trim();
  const baseSlug =
    displayName
      .toLowerCase()
      .normalize("NFKD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 150) || "school";
  const usedSlugs = new Set(graph.schools.map((school) => school.slug));
  let slug = baseSlug;
  let suffix = 2;
  while (usedSlugs.has(slug)) slug = `${baseSlug}-${suffix++}`;
  return {
    id: createId(),
    packId: graph.packId,
    packVersionId: graph.versionId,
    slug,
    sourceName: displayName,
    displayName,
    description: "",
    visibilityPolicy: "GM_ONLY",
    order: graph.schools.length,
  };
}

export function createSpellNode(
  graph: SpellProgressionGraph,
  schoolId: string,
  name: string,
): SpellNode {
  const displayName = name.trim();
  return {
    id: createId(),
    packId: graph.packId,
    packVersionId: graph.versionId,
    schoolId,
    sourceName: displayName,
    displayName,
    rawSourceText: "",
    narrativeText: "",
    mechanicsText: "",
    lifecycle: "DRAFT",
    revision: 0,
    revisionProvenance: {},
    activation: { passive: true, triggers: [] },
    costs: [],
    usageLimit: null,
  };
}

export function createPrerequisite(
  graph: SpellProgressionGraph,
  sourceNodeId: string,
  targetNodeId: string,
  mode: SpellRequirementGroup["mode"],
): { group: SpellRequirementGroup; edge: SpellRequirementEdge } {
  const target = graph.nodes.find((node) => node.id === targetNodeId);
  if (!target) throw new Error("Целевой узел не найден в черновике");
  const groupId = createId();
  const shared = {
    packId: graph.packId,
    packVersionId: graph.versionId,
    schoolId: target.schoolId,
  };
  return {
    group: {
      ...shared,
      id: groupId,
      targetNodeId,
      mode,
    },
    edge: {
      ...shared,
      id: createId(),
      requirementGroupId: groupId,
      sourceNodeId,
      targetNodeId,
    },
  };
}

export function createRequirementGroup(
  graph: SpellProgressionGraph,
  targetNodeId: string,
  mode: SpellRequirementGroup["mode"],
): SpellRequirementGroup {
  const target = graph.nodes.find((node) => node.id === targetNodeId);
  if (!target) throw new Error("Целевой узел не найден в черновике");
  return {
    id: createId(),
    packId: graph.packId,
    packVersionId: graph.versionId,
    schoolId: target.schoolId,
    targetNodeId,
    mode,
  };
}

export function createPrerequisiteEdge(
  graph: SpellProgressionGraph,
  sourceNodeId: string,
  groupId: string,
): SpellRequirementEdge {
  const group = graph.requirementGroups.find((item) => item.id === groupId);
  if (!group) throw new Error("Группа условий не найдена");
  return {
    id: createId(),
    packId: graph.packId,
    packVersionId: graph.versionId,
    schoolId: group.schoolId,
    requirementGroupId: group.id,
    sourceNodeId,
    targetNodeId: group.targetNodeId,
  };
}

/** Prepare an append-only DRAFT snapshot while retaining optional/advanced fields. */
export function nextSpellDraftVersion(
  source: SpellProgressionGraph,
  versionId = createId(),
): SpellProgressionGraph {
  return {
    ...source,
    versionId,
    version: source.version + 1,
    lifecycle: "DRAFT",
    schools: source.schools.map((school) => ({
      ...school,
      packVersionId: versionId,
    })),
    nodes: source.nodes.map((node) => ({
      ...node,
      packVersionId: versionId,
      lifecycle: node.lifecycle === "ARCHIVED" ? "ARCHIVED" : "DRAFT",
    })),
    requirementGroups: source.requirementGroups.map((group) => ({
      ...group,
      packVersionId: versionId,
    })),
    edges: source.edges.map((edge) => ({
      ...edge,
      packVersionId: versionId,
    })),
  };
}

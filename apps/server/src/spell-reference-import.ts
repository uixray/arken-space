import { createHash } from "node:crypto";
import {
  previewSpellReferenceImportCommandSchema,
  spellReferenceImportPreviewResponseSchema,
  validateSpellProgressionGraph,
  type PreviewSpellReferenceImportCommand,
  type SpellProgressionGraph,
  type SpellReferenceImportPreviewResponse,
  type SpellReferenceImportSource,
  type SpellUsageCadence,
} from "@arken/contracts";

function deterministicUuid(parts: readonly string[]): string {
  const bytes = createHash("sha256")
    .update(parts.join("\u0000"), "utf8")
    .digest()
    .subarray(0, 16);
  bytes[6] = (bytes[6]! & 0x0f) | 0x50;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  const hex = bytes.toString("hex");
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    hex.slice(12, 16),
    hex.slice(16, 20),
    hex.slice(20),
  ].join("-");
}

function childId(
  command: Pick<PreviewSpellReferenceImportCommand, "packId" | "versionId">,
  kind: string,
  identity: string,
): string {
  return deterministicUuid([
    "arken-spell-reference-2024",
    command.packId,
    command.versionId,
    kind,
    identity,
  ]);
}

function cadenceFromRaw(rawText: string): SpellUsageCadence {
  const normalized = rawText.toLocaleLowerCase("ru");
  if (/\u0440\u0430\u0443\u043d\u0434/u.test(normalized))
    return { kind: "TURN" };
  if (/\u0431\u043e\u0439|\u0431\u0438\u0442\u0432/u.test(normalized))
    return { kind: "COMBAT" };
  if (
    /\u043a\u043e\u0440\u043e\u0442\u043a.*\u043e\u0442\u0434\u044b\u0445/u.test(
      normalized,
    )
  )
    return { kind: "SHORT_REST" };
  if (
    /\u0434\u043b\u0438\u043d\u043d.*\u043e\u0442\u0434\u044b\u0445/u.test(
      normalized,
    )
  )
    return { kind: "LONG_REST" };
  if (/\u0434\u0435\u043d\u044c|\u0434\u043d\u044f/u.test(normalized))
    return { kind: "DAY" };
  if (/\u043d\u0435\u0434\u0435\u043b/u.test(normalized))
    return { kind: "WEEK" };
  if (
    /\u0438\u0433\u0440|\u043f\u0430\u0440\u0442\u0438|\u0441\u0435\u0441\u0441\u0438/u.test(
      normalized,
    )
  )
    return { kind: "SESSION" };
  if (/\u043a\u0430\u043c\u043f\u0430\u043d/u.test(normalized))
    return { kind: "CAMPAIGN" };
  if (/\u043c\u0435\u0441\u044f\u0446/u.test(normalized))
    return { kind: "MONTH" };
  return { kind: "CUSTOM", rawText };
}

type ReferenceSchool = SpellReferenceImportSource["школы"][number];

function canonicalNamesForSchool(school: ReferenceSchool): Map<string, string> {
  const canonical = new Map<string, string>();
  for (const node of school.узлы) {
    canonical.set(node.название, node.название);
    if (node.вариантНаСхеме) canonical.set(node.вариантНаСхеме, node.название);
  }
  return canonical;
}

/**
 * Builds a review-only candidate from an explicitly supplied source payload.
 * This module deliberately performs no filesystem or network access.
 */
export function previewSpellReferenceImport(
  input: PreviewSpellReferenceImportCommand,
): SpellReferenceImportPreviewResponse {
  const command = previewSpellReferenceImportCommandSchema.parse(input);
  const { source } = command;
  const rawSourceText = JSON.stringify(source);
  const schools: SpellProgressionGraph["schools"] = [];
  const nodes: SpellProgressionGraph["nodes"] = [];
  const requirementGroups: SpellProgressionGraph["requirementGroups"] = [];
  const edges: SpellProgressionGraph["edges"] = [];
  const nodeIdBySchoolAndName = new Map<string, string>();
  const nodeIdBySchoolDisplayAndName = new Map<string, string>();

  for (const [schoolIndex, rawSchool] of source.школы.entries()) {
    const schoolId = childId(command, "school", rawSchool.ключ);
    schools.push({
      packId: command.packId,
      packVersionId: command.versionId,
      id: schoolId,
      slug: rawSchool.ключ,
      sourceName: rawSchool.название,
      displayName: rawSchool.название,
      description: rawSchool.название,
      rawSourceText: JSON.stringify({
        ключ: rawSchool.ключ,
        название: rawSchool.название,
      }),
      visibilityPolicy: "PUBLIC",
      order: schoolIndex,
    });

    const canonicalName = canonicalNamesForSchool(rawSchool);
    for (const rawNode of rawSchool.узлы) {
      const nodeId = childId(
        command,
        "node",
        `${rawSchool.ключ}\u0000${rawNode.название}`,
      );
      nodeIdBySchoolAndName.set(
        `${rawSchool.ключ}\u0000${rawNode.название}`,
        nodeId,
      );
      nodeIdBySchoolDisplayAndName.set(
        `${rawSchool.название}\u0000${rawNode.название}`,
        nodeId,
      );

      const passive =
        rawNode.стоимостьМаны === null && rawNode.частота === null;
      const firstNumber = rawNode.частота?.match(/\d+/u)?.[0];
      nodes.push({
        packId: command.packId,
        packVersionId: command.versionId,
        id: nodeId,
        schoolId,
        sourceName: rawNode.название,
        displayName: rawNode.название,
        rawSourceText: rawNode.описание,
        narrativeText: rawNode.описание,
        mechanicsText: rawNode.описание,
        lifecycle: "REFERENCE",
        revision: 0,
        revisionProvenance: {
          sourceRevision: "arken-har-magic-reference-2024",
          changeNote: rawNode.вариантНаСхеме
            ? `Review-only transcription; scheme name: ${rawNode.вариантНаСхеме}`
            : "Review-only transcription",
        },
        activation: {
          passive,
          triggers: passive
            ? []
            : [
                {
                  kind: "OTHER",
                  rawText: rawNode.частота ?? rawNode.описание,
                },
              ],
        },
        costs:
          rawNode.стоимостьМаны === null
            ? []
            : [
                {
                  resource: "Мана",
                  amount: {
                    kind: "FIXED",
                    value: rawNode.стоимостьМаны,
                  },
                  timing: "ON_ACTIVATE",
                  rawText: `${rawNode.стоимостьМаны} мп`,
                },
              ],
        usageLimit:
          rawNode.частота === null
            ? null
            : {
                maxUses: firstNumber ? Number(firstNumber) : 1,
                cadence: cadenceFromRaw(rawNode.частота),
              },
      });
    }

    const incomingByTargetName = new Map<string, string[]>();
    for (const rawEdge of rawSchool.связи) {
      const targetName = canonicalName.get(rawEdge.куда)!;
      const incoming = incomingByTargetName.get(targetName) ?? [];
      incoming.push(canonicalName.get(rawEdge.откуда)!);
      incomingByTargetName.set(targetName, incoming);
    }

    const groupIdByTargetName = new Map<string, string>();
    for (const [targetName, incoming] of incomingByTargetName) {
      const groupId = childId(
        command,
        "requirement-group",
        `${rawSchool.ключ}\u0000${targetName}`,
      );
      groupIdByTargetName.set(targetName, groupId);
      requirementGroups.push({
        packId: command.packId,
        packVersionId: command.versionId,
        id: groupId,
        schoolId,
        targetNodeId: nodeIdBySchoolAndName.get(
          `${rawSchool.ключ}\u0000${targetName}`,
        )!,
        mode: incoming.length === 1 ? "ALL" : "UNRESOLVED",
        sourceNote: source.источник.предупреждение,
      });
    }

    for (const rawEdge of rawSchool.связи) {
      const sourceName = canonicalName.get(rawEdge.откуда)!;
      const targetName = canonicalName.get(rawEdge.куда)!;
      edges.push({
        packId: command.packId,
        packVersionId: command.versionId,
        id: childId(
          command,
          "edge",
          `${rawSchool.ключ}\u0000${sourceName}\u0000${targetName}`,
        ),
        schoolId,
        requirementGroupId: groupIdByTargetName.get(targetName)!,
        sourceNodeId: nodeIdBySchoolAndName.get(
          `${rawSchool.ключ}\u0000${sourceName}`,
        )!,
        targetNodeId: nodeIdBySchoolAndName.get(
          `${rawSchool.ключ}\u0000${targetName}`,
        )!,
        sourceNote: source.источник.предупреждение,
      });
    }
  }

  const importWarnings: NonNullable<SpellProgressionGraph["importWarnings"]> =
    source.требуетУточнения.map((message, index) => {
      const identity = message.match(/^([^:]+): «([^»]+)»/u);
      const entityId = identity
        ? nodeIdBySchoolDisplayAndName.get(`${identity[1]}\u0000${identity[2]}`)
        : undefined;
      return {
        id: childId(command, "import-warning", message),
        code: "SOURCE_AMBIGUITY",
        status: "OPEN",
        path: `source.требуетУточнения[${index}]`,
        message,
        ...(entityId ? { entityId } : {}),
      };
    });

  const graph: SpellProgressionGraph = {
    packId: command.packId,
    versionId: command.versionId,
    version: command.version,
    title: "Школы магии Аркен-Хара — референс 2024",
    edition: "2024 review-only",
    lifecycle: "REFERENCE",
    provenance: {
      sourceType: "TRANSCRIBED",
      sourceLabel: source.источник.описания,
      sourceExternalId: "arken-har-magic-schools-2024",
      rawSourceText,
    },
    schools,
    nodes,
    requirementGroups,
    edges,
    importWarnings,
    compatibility: { schemaVersion: 1 },
  };
  const parsedGraph =
    spellReferenceImportPreviewResponseSchema.shape.graph.parse(graph);
  const validation = validateSpellProgressionGraph(parsedGraph);
  return spellReferenceImportPreviewResponseSchema.parse({
    graph: parsedGraph,
    validation: {
      valid: validation.errors.length === 0,
      errors: validation.errors,
      warnings: validation.warnings,
    },
  });
}

import { z } from "zod";

const spellIdSchema = z
  .string()
  .uuid()
  .transform((value) => value.toLowerCase());
const spellLabelSchema = z.string().trim().min(1).max(240);
const spellLongTextSchema = z.string().max(50_000);
export const SPELL_REFERENCE_IMPORT_MAX_SOURCE_CHARS = 250_000;
const spellRawSourcePayloadSchema = z
  .string()
  .max(SPELL_REFERENCE_IMPORT_MAX_SOURCE_CHARS);

/** Lifecycle of one immutable spell-pack version. */
export const spellPackLifecycleSchema = z.enum([
  "DRAFT",
  "REFERENCE",
  "ACTIVE",
  "ARCHIVED",
]);
export type SpellPackLifecycle = z.infer<typeof spellPackLifecycleSchema>;

export const spellSourceTypeSchema = z.enum([
  "GM_AUTHORED",
  "IMPORTED",
  "TRANSCRIBED",
]);
export type SpellSourceType = z.infer<typeof spellSourceTypeSchema>;

/**
 * Version-level source metadata. `rawSourceText` deliberately keeps the
 * source wording alongside normalized mechanics instead of replacing it.
 */
export const spellGraphProvenanceSchema = z
  .object({
    sourceType: spellSourceTypeSchema,
    sourceLabel: spellLabelSchema,
    sourceUrl: z.string().url().nullable().optional(),
    sourceExternalId: z.string().trim().min(1).max(500).nullable().optional(),
    capturedAt: z.string().datetime().nullable().optional(),
    attribution: z.string().trim().min(1).max(1_000).nullable().optional(),
    rawSourceText: spellRawSourcePayloadSchema,
  })
  .strict();
export type SpellGraphProvenance = z.infer<typeof spellGraphProvenanceSchema>;

export const spellActivationTriggerKindSchema = z.enum([
  "ACTION",
  "BONUS_ACTION",
  "REACTION",
  "RITUAL",
  "OTHER",
]);
export type SpellActivationTriggerKind = z.infer<
  typeof spellActivationTriggerKindSchema
>;

export const spellActivationTriggerSchema = z
  .object({
    kind: spellActivationTriggerKindSchema,
    label: spellLabelSchema.optional(),
    rawText: z.string().trim().min(1).max(2_000).optional(),
  })
  .strict()
  .superRefine((trigger, context) => {
    if (trigger.kind === "OTHER" && !trigger.label && !trigger.rawText)
      context.addIssue({
        code: "custom",
        path: ["rawText"],
        message: "OTHER activation requires a label or source wording",
      });
  });
export type SpellActivationTrigger = z.infer<
  typeof spellActivationTriggerSchema
>;

/**
 * A node can be passive-only, trigger-only, or hybrid. A node with neither
 * form is rejected at the schema boundary because it has no activation
 * semantics at all.
 */
export const spellActivationSchema = z
  .object({
    passive: z.boolean(),
    triggers: z.array(spellActivationTriggerSchema).max(20),
  })
  .strict()
  .superRefine((activation, context) => {
    if (!activation.passive && activation.triggers.length === 0)
      context.addIssue({
        code: "custom",
        path: ["triggers"],
        message: "A spell node must be passive, triggered, or both",
      });
  });
export type SpellActivation = z.infer<typeof spellActivationSchema>;

export const spellCostAmountSchema = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("FIXED"),
      value: z.number().finite().positive(),
    })
    .strict(),
  z
    .object({
      kind: z.literal("FORMULA"),
      formula: z.string().trim().min(1).max(500),
    })
    .strict(),
]);
export type SpellCostAmount = z.infer<typeof spellCostAmountSchema>;

export const spellCostTimingSchema = z.enum([
  "ON_ACTIVATE",
  "ON_SUCCESS",
  "PER_TURN",
]);
export type SpellCostTiming = z.infer<typeof spellCostTimingSchema>;

/** A cost is structured, while optional `rawText` preserves unusual wording. */
export const spellCostSchema = z
  .object({
    resource: z.string().trim().min(1).max(120),
    amount: spellCostAmountSchema,
    timing: spellCostTimingSchema,
    rawText: z.string().trim().min(1).max(2_000).optional(),
  })
  .strict();
export type SpellCost = z.infer<typeof spellCostSchema>;

export const spellUsageCadenceKindSchema = z.enum([
  "TURN",
  "COMBAT",
  "SHORT_REST",
  "LONG_REST",
  "DAY",
  "WEEK",
  "SESSION",
  "CAMPAIGN",
  "MONTH",
  "CUSTOM",
]);
export type SpellUsageCadenceKind = z.infer<typeof spellUsageCadenceKindSchema>;

const standardSpellUsageCadenceSchema = z
  .object({
    kind: z.enum([
      "TURN",
      "COMBAT",
      "SHORT_REST",
      "LONG_REST",
      "DAY",
      "WEEK",
      "SESSION",
      "CAMPAIGN",
      "MONTH",
    ]),
  })
  .strict();

const customSpellUsageCadenceSchema = z
  .object({
    kind: z.literal("CUSTOM"),
    rawText: z.string().trim().min(1).max(2_000),
  })
  .strict();

export const spellUsageCadenceSchema = z.discriminatedUnion("kind", [
  standardSpellUsageCadenceSchema,
  customSpellUsageCadenceSchema,
]);
export type SpellUsageCadence = z.infer<typeof spellUsageCadenceSchema>;

export const spellUsageLimitSchema = z
  .object({
    maxUses: z.number().int().positive(),
    cadence: spellUsageCadenceSchema,
  })
  .strict();
export type SpellUsageLimit = z.infer<typeof spellUsageLimitSchema>;

export const spellRollActionSchema = z
  .object({
    id: spellIdSchema,
    label: spellLabelSchema,
    formula: z.string().trim().min(1).max(500),
    purpose: z.string().trim().min(1).max(500).optional(),
  })
  .strict();
export type SpellRollAction = z.infer<typeof spellRollActionSchema>;

export const spellEffectSchema = z
  .object({
    id: spellIdSchema,
    kind: z.string().trim().min(1).max(120),
    label: spellLabelSchema,
    value: z.number().finite().optional(),
    unit: z.string().trim().min(1).max(120).optional(),
    rawText: z.string().trim().min(1).max(2_000).optional(),
  })
  .strict();
export type SpellEffect = z.infer<typeof spellEffectSchema>;

const spellVersionLinkSchema = {
  packId: spellIdSchema,
  packVersionId: spellIdSchema,
};

export const spellSchoolVisibilityPolicySchema = z.enum([
  "PUBLIC",
  "DISCOVERED",
  "GM_ONLY",
]);
export type SpellSchoolVisibilityPolicy = z.infer<
  typeof spellSchoolVisibilityPolicySchema
>;

export const spellSchoolVisualThemeSchema = z
  .object({
    primaryColor: z
      .string()
      .regex(/^#[0-9a-f]{6}$/i, "Color must be a six-digit hex value")
      .optional(),
    accentColor: z
      .string()
      .regex(/^#[0-9a-f]{6}$/i, "Color must be a six-digit hex value")
      .optional(),
    iconAssetId: spellIdSchema.nullable().optional(),
  })
  .strict();
export type SpellSchoolVisualTheme = z.infer<
  typeof spellSchoolVisualThemeSchema
>;

export const spellSchoolSchema = z
  .object({
    ...spellVersionLinkSchema,
    id: spellIdSchema,
    slug: z
      .string()
      .trim()
      .min(1)
      .max(160)
      .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "Slug must be kebab-case lowercase"),
    sourceName: spellLabelSchema,
    displayName: spellLabelSchema,
    description: spellLongTextSchema,
    rawSourceText: spellLongTextSchema.optional(),
    visibilityPolicy: spellSchoolVisibilityPolicySchema,
    order: z.number().int().nonnegative(),
    visualTheme: spellSchoolVisualThemeSchema.optional(),
  })
  .strict();
export type SpellSchool = z.infer<typeof spellSchoolSchema>;

export const spellNodeRevisionProvenanceSchema = z
  .object({
    sourceRevision: z.string().trim().min(1).max(500).nullable().optional(),
    changedAt: z.string().datetime().nullable().optional(),
    changedBy: z.string().trim().min(1).max(240).nullable().optional(),
    changeNote: z.string().trim().min(1).max(2_000).nullable().optional(),
  })
  .strict();
export type SpellNodeRevisionProvenance = z.infer<
  typeof spellNodeRevisionProvenanceSchema
>;

export const spellNodeSchema = z
  .object({
    ...spellVersionLinkSchema,
    id: spellIdSchema,
    schoolId: spellIdSchema,
    sourceName: spellLabelSchema,
    displayName: spellLabelSchema,
    rawSourceText: spellLongTextSchema,
    narrativeText: spellLongTextSchema,
    mechanicsText: spellLongTextSchema,
    lifecycle: spellPackLifecycleSchema,
    revision: z.number().int().nonnegative(),
    revisionProvenance: spellNodeRevisionProvenanceSchema,
    iconAssetId: spellIdSchema.nullable().optional(),
    activation: spellActivationSchema,
    costs: z.array(spellCostSchema).max(50),
    usageLimit: spellUsageLimitSchema.nullable(),
    durationText: z.string().max(2_000).nullable().optional(),
    rangeText: z.string().max(2_000).nullable().optional(),
    targetText: z.string().max(2_000).nullable().optional(),
    areaText: z.string().max(2_000).nullable().optional(),
    rollActions: z.array(spellRollActionSchema).max(50).optional(),
    effects: z.array(spellEffectSchema).max(100).optional(),
  })
  .strict();
export type SpellNode = z.infer<typeof spellNodeSchema>;

/**
 * All groups targeting a node are combined with AND. `mode` controls only
 * the edges inside one group; UNRESOLVED records review material honestly.
 */
export const spellRequirementGroupModeSchema = z.enum([
  "ALL",
  "ANY",
  "UNRESOLVED",
]);
export type SpellRequirementGroupMode = z.infer<
  typeof spellRequirementGroupModeSchema
>;

export const spellRequirementGroupSchema = z
  .object({
    ...spellVersionLinkSchema,
    id: spellIdSchema,
    schoolId: spellIdSchema,
    targetNodeId: spellIdSchema,
    mode: spellRequirementGroupModeSchema,
    sourceNote: z.string().trim().min(1).max(2_000).optional(),
  })
  .strict();
export type SpellRequirementGroup = z.infer<typeof spellRequirementGroupSchema>;

/** Directed prerequisite edge: source must be known before target. */
export const spellRequirementEdgeSchema = z
  .object({
    ...spellVersionLinkSchema,
    id: spellIdSchema,
    schoolId: spellIdSchema,
    requirementGroupId: spellIdSchema,
    sourceNodeId: spellIdSchema,
    targetNodeId: spellIdSchema,
    sourceNote: z.string().trim().min(1).max(2_000).optional(),
    minimumRank: z.number().int().positive().optional(),
    threshold: z.number().finite().optional(),
    gmGrantCondition: z.string().trim().min(1).max(2_000).optional(),
  })
  .strict();
export type SpellRequirementEdge = z.infer<typeof spellRequirementEdgeSchema>;

export const spellLayoutPointSchema = z
  .object({ x: z.number().finite(), y: z.number().finite() })
  .strict();
export type SpellLayoutPoint = z.infer<typeof spellLayoutPointSchema>;

/** Presentation-only metadata; the graph validator never reads this object. */
export const spellGraphLayoutSchema = z
  .object({
    schools: z
      .array(
        z
          .object({
            schoolId: spellIdSchema,
            position: spellLayoutPointSchema,
            order: z.number().int().optional(),
          })
          .strict(),
      )
      .optional(),
    nodes: z
      .array(
        z
          .object({
            nodeId: spellIdSchema,
            position: spellLayoutPointSchema,
            order: z.number().int().optional(),
            tier: z.number().int().nonnegative().optional(),
          })
          .strict(),
      )
      .optional(),
    edges: z
      .array(
        z
          .object({
            edgeId: spellIdSchema,
            controlPoints: z.array(spellLayoutPointSchema).max(50),
          })
          .strict(),
      )
      .optional(),
  })
  .strict();
export type SpellGraphLayout = z.infer<typeof spellGraphLayoutSchema>;

export const spellGraphCompatibilitySchema = z
  .object({
    schemaVersion: z.number().int().positive(),
    minimumClientVersion: z.string().trim().min(1).max(120).optional(),
    legacyCatalogKinds: z
      .array(z.string().trim().min(1).max(120))
      .max(50)
      .optional(),
  })
  .strict();
export type SpellGraphCompatibility = z.infer<
  typeof spellGraphCompatibilitySchema
>;

export const spellImportWarningCodeSchema = z.literal("SOURCE_AMBIGUITY");
export type SpellImportWarningCode = z.infer<
  typeof spellImportWarningCodeSchema
>;

export const spellImportWarningStatusSchema = z.enum(["OPEN", "RESOLVED"]);
export type SpellImportWarningStatus = z.infer<
  typeof spellImportWarningStatusSchema
>;

const spellImportWarningIdentityFields = {
  id: spellIdSchema,
  code: spellImportWarningCodeSchema,
  path: z.string().trim().min(1).max(1_000),
  message: z.string().trim().min(1).max(5_000),
  entityId: spellIdSchema.optional(),
};

const openSpellImportWarningSchema = z
  .object({
    ...spellImportWarningIdentityFields,
    status: z.literal("OPEN"),
  })
  .strict();

const resolvedSpellImportWarningSchema = z
  .object({
    ...spellImportWarningIdentityFields,
    status: z.literal("RESOLVED"),
    resolutionReason: z.string().trim().min(1).max(2_000),
  })
  .strict();

/**
 * Review markers are part of an immutable graph version. Resolving one means
 * appending a new graph whose marker carries an explicit reason; mutating the
 * original warning in place is never valid.
 */
export const spellImportWarningSchema = z.discriminatedUnion("status", [
  openSpellImportWarningSchema,
  resolvedSpellImportWarningSchema,
]);
export type SpellImportWarning = z.infer<typeof spellImportWarningSchema>;

/** One immutable, flat, normalized spell-pack version. */
export const spellProgressionGraphSchema = z
  .object({
    packId: spellIdSchema,
    versionId: spellIdSchema,
    version: z.number().int().positive(),
    title: spellLabelSchema,
    edition: z.string().trim().min(1).max(240).nullable().optional(),
    lifecycle: spellPackLifecycleSchema,
    provenance: spellGraphProvenanceSchema,
    schools: z.array(spellSchoolSchema),
    nodes: z.array(spellNodeSchema),
    requirementGroups: z.array(spellRequirementGroupSchema),
    edges: z.array(spellRequirementEdgeSchema),
    /** Optional for immutable versions created before import review markers existed. */
    importWarnings: z.array(spellImportWarningSchema).max(2_000).optional(),
    layout: spellGraphLayoutSchema.optional(),
    notes: spellLongTextSchema.optional(),
    compatibility: spellGraphCompatibilitySchema.optional(),
  })
  .strict();
export type SpellProgressionGraph = z.infer<typeof spellProgressionGraphSchema>;

/** An immutable version must always be selected explicitly for projection. */
export const spellProgressionQuerySchema = z
  .object({
    packId: spellIdSchema,
    packVersionId: spellIdSchema,
  })
  .strict();
export type SpellProgressionQuery = z.infer<typeof spellProgressionQuerySchema>;

export const spellProjectionNodeStateSchema = z.enum([
  "DISCOVERED",
  "AVAILABLE",
  "LOCKED",
  "HIDDEN",
]);
export type SpellProjectionNodeState = z.infer<
  typeof spellProjectionNodeStateSchema
>;

export const spellPrerequisiteFailureCodeSchema = z.enum([
  "SOURCE_NODE_MISSING",
  "SOURCE_NODE_RANK_TOO_LOW",
  "THRESHOLD_NOT_EVALUABLE",
  "GM_GRANT_REQUIRED",
  "UNRESOLVED_GROUP",
]);
export type SpellPrerequisiteFailureCode = z.infer<
  typeof spellPrerequisiteFailureCodeSchema
>;

const spellPrerequisiteEdgeFailureFields = {
  groupId: spellIdSchema,
  edgeId: spellIdSchema,
  sourceNodeId: spellIdSchema,
};

export const spellPrerequisiteFailureSchema = z.discriminatedUnion("code", [
  z
    .object({
      code: z.literal("SOURCE_NODE_MISSING"),
      ...spellPrerequisiteEdgeFailureFields,
    })
    .strict(),
  z
    .object({
      code: z.literal("SOURCE_NODE_RANK_TOO_LOW"),
      ...spellPrerequisiteEdgeFailureFields,
      requiredRank: z.number().int().positive().max(1_000),
      actualRank: z.number().int().positive().max(1_000),
    })
    .strict(),
  z
    .object({
      code: z.literal("THRESHOLD_NOT_EVALUABLE"),
      ...spellPrerequisiteEdgeFailureFields,
    })
    .strict(),
  z
    .object({
      code: z.literal("GM_GRANT_REQUIRED"),
      ...spellPrerequisiteEdgeFailureFields,
    })
    .strict(),
  z
    .object({
      code: z.literal("UNRESOLVED_GROUP"),
      groupId: spellIdSchema,
    })
    .strict(),
]);
export type SpellPrerequisiteFailure = z.infer<
  typeof spellPrerequisiteFailureSchema
>;

const playerSpellSchoolSchema = z
  .object({
    id: spellIdSchema,
    displayName: spellLabelSchema,
  })
  .strict();

const playerSpellNodeIdentityFields = {
  id: spellIdSchema,
  schoolId: spellIdSchema,
  displayName: spellLabelSchema,
};

const playerSpellNodeGameplayFields = {
  mechanicsText: spellLongTextSchema,
  activation: spellActivationSchema,
  costs: z.array(spellCostSchema).max(50),
  usageLimit: spellUsageLimitSchema.nullable(),
  durationText: z.string().max(2_000).nullable().optional(),
  rangeText: z.string().max(2_000).nullable().optional(),
  targetText: z.string().max(2_000).nullable().optional(),
  areaText: z.string().max(2_000).nullable().optional(),
  rollActions: z.array(spellRollActionSchema).max(50).optional(),
  effects: z.array(spellEffectSchema).max(100).optional(),
};

const playerLockedSpellNodeSchema = z
  .object({
    ...playerSpellNodeIdentityFields,
    state: z.literal("LOCKED"),
  })
  .strict();

const playerAvailableSpellNodeSchema = z
  .object({
    ...playerSpellNodeIdentityFields,
    ...playerSpellNodeGameplayFields,
    state: z.literal("AVAILABLE"),
  })
  .strict();

const playerDiscoveredSpellNodeSchema = z
  .object({
    ...playerSpellNodeIdentityFields,
    ...playerSpellNodeGameplayFields,
    state: z.literal("DISCOVERED"),
  })
  .strict();

export const playerSpellProjectionNodeSchema = z.discriminatedUnion("state", [
  playerLockedSpellNodeSchema,
  playerAvailableSpellNodeSchema,
  playerDiscoveredSpellNodeSchema,
]);
export type PlayerSpellProjectionNode = z.infer<
  typeof playerSpellProjectionNodeSchema
>;

export const playerSpellProgressionProjectionSchema = z
  .object({
    characterId: spellIdSchema,
    packId: spellIdSchema,
    packVersionId: spellIdSchema,
    schools: z.array(playerSpellSchoolSchema),
    nodes: z.array(playerSpellProjectionNodeSchema),
    edges: z.array(
      z
        .object({
          sourceNodeId: spellIdSchema,
          targetNodeId: spellIdSchema,
        })
        .strict(),
    ),
  })
  .strict();
export type PlayerSpellProgressionProjection = z.infer<
  typeof playerSpellProgressionProjectionSchema
>;

const gmSpellProjectionNodeSchema = z
  .object({
    school: spellSchoolSchema,
    node: spellNodeSchema,
    state: spellProjectionNodeStateSchema,
    prerequisiteFailures: z.array(spellPrerequisiteFailureSchema),
  })
  .strict();

export const gmSpellProgressionProjectionSchema = z
  .object({
    characterId: spellIdSchema,
    packId: spellIdSchema,
    packVersionId: spellIdSchema,
    graph: spellProgressionGraphSchema,
    nodes: z.array(gmSpellProjectionNodeSchema),
  })
  .strict();
export type GmSpellProgressionProjection = z.infer<
  typeof gmSpellProgressionProjectionSchema
>;

const spellReferenceNodeSourceSchema = z
  .object({
    название: spellLabelSchema,
    вариантНаСхеме: spellLabelSchema.nullable(),
    стоимостьМаны: z.number().finite().positive().nullable(),
    частота: z.string().trim().min(1).max(2_000).nullable(),
    описание: z.string().min(1).max(50_000),
  })
  .strict();

const spellReferenceEdgeSourceSchema = z
  .object({
    откуда: spellLabelSchema,
    куда: spellLabelSchema,
  })
  .strict();

const spellReferenceSchoolSourceSchema = z
  .object({
    ключ: z
      .string()
      .trim()
      .min(1)
      .max(160)
      .regex(
        /^[a-z0-9]+(?:-[a-z0-9]+)*$/,
        "School key must be kebab-case lowercase",
      ),
    название: spellLabelSchema,
    узлы: z.array(spellReferenceNodeSourceSchema).max(2_000),
    связи: z.array(spellReferenceEdgeSourceSchema).max(10_000),
    безСвязей: z.array(spellLabelSchema).max(2_000),
  })
  .strict();

export const spellReferenceImportSourceSchema = z
  .object({
    источник: z
      .object({
        описания: z.string().trim().min(1).max(5_000),
        деревья: z.string().trim().min(1).max(5_000),
        предупреждение: z.string().trim().min(1).max(5_000),
      })
      .strict(),
    школы: z.array(spellReferenceSchoolSourceSchema).max(100),
    требуетУточнения: z.array(z.string().trim().min(1).max(5_000)).max(2_000),
  })
  .strict()
  .superRefine((source, context) => {
    if (JSON.stringify(source).length > SPELL_REFERENCE_IMPORT_MAX_SOURCE_CHARS)
      context.addIssue({
        code: "custom",
        path: [],
        message: `Reference source exceeds ${SPELL_REFERENCE_IMPORT_MAX_SOURCE_CHARS} characters`,
      });

    const schoolKeys = new Set<string>();
    source.школы.forEach((school, schoolIndex) => {
      if (schoolKeys.has(school.ключ))
        context.addIssue({
          code: "custom",
          path: ["школы", schoolIndex, "ключ"],
          message: `Duplicate school key: ${school.ключ}`,
        });
      schoolKeys.add(school.ключ);

      const canonicalBySourceName = new Map<string, string>();
      school.узлы.forEach((node, nodeIndex) => {
        const priorNode = canonicalBySourceName.get(node.название);
        if (priorNode && priorNode !== node.название)
          context.addIssue({
            code: "custom",
            path: ["школы", schoolIndex, "узлы", nodeIndex, "название"],
            message: `Node name collides with an existing scheme alias: ${node.название}`,
          });
        else if (canonicalBySourceName.has(node.название))
          context.addIssue({
            code: "custom",
            path: ["школы", schoolIndex, "узлы", nodeIndex, "название"],
            message: `Duplicate node name: ${node.название}`,
          });
        canonicalBySourceName.set(node.название, node.название);

        if (!node.вариантНаСхеме) return;
        const priorAlias = canonicalBySourceName.get(node.вариантНаСхеме);
        if (priorAlias && priorAlias !== node.название)
          context.addIssue({
            code: "custom",
            path: ["школы", schoolIndex, "узлы", nodeIndex, "вариантНаСхеме"],
            message: `Scheme alias maps to multiple nodes: ${node.вариантНаСхеме}`,
          });
        canonicalBySourceName.set(node.вариантНаСхеме, node.название);
      });

      const seenEdges = new Set<string>();
      school.связи.forEach((edge, edgeIndex) => {
        const sourceName = canonicalBySourceName.get(edge.откуда);
        const targetName = canonicalBySourceName.get(edge.куда);
        if (!sourceName)
          context.addIssue({
            code: "custom",
            path: ["школы", schoolIndex, "связи", edgeIndex, "откуда"],
            message: `Unknown source node: ${edge.откуда}`,
          });
        if (!targetName)
          context.addIssue({
            code: "custom",
            path: ["школы", schoolIndex, "связи", edgeIndex, "куда"],
            message: `Unknown target node: ${edge.куда}`,
          });
        if (!sourceName || !targetName) return;
        const identity = `${sourceName}\u0000${targetName}`;
        if (seenEdges.has(identity))
          context.addIssue({
            code: "custom",
            path: ["школы", schoolIndex, "связи", edgeIndex],
            message: `Duplicate reference edge: ${edge.откуда} -> ${edge.куда}`,
          });
        seenEdges.add(identity);
      });

      school.безСвязей.forEach((nodeName, nodeIndex) => {
        if (!canonicalBySourceName.has(nodeName))
          context.addIssue({
            code: "custom",
            path: ["школы", schoolIndex, "безСвязей", nodeIndex],
            message: `Unknown isolated node: ${nodeName}`,
          });
      });
    });

    const ambiguityMessages = new Set<string>();
    source.требуетУточнения.forEach((message, index) => {
      if (ambiguityMessages.has(message))
        context.addIssue({
          code: "custom",
          path: ["требуетУточнения", index],
          message: `Duplicate source ambiguity: ${message}`,
        });
      ambiguityMessages.add(message);
    });
  });
export type SpellReferenceImportSource = z.infer<
  typeof spellReferenceImportSourceSchema
>;

/** Stateless review preview. Lifecycle is intentionally absent and forced by the adapter. */
export const previewSpellReferenceImportCommandSchema = z
  .object({
    packId: spellIdSchema,
    versionId: spellIdSchema,
    version: z.number().int().positive(),
    source: spellReferenceImportSourceSchema,
  })
  .strict();
export type PreviewSpellReferenceImportCommand = z.infer<
  typeof previewSpellReferenceImportCommandSchema
>;

const spellPackExpectedVersionSchema = z.number().int().nonnegative();

/** Read-only GM validation. `graph` stays unknown so malformed candidates receive a useful report. */
export const validateSpellPackGraphSchema = z
  .object({ graph: z.unknown() })
  .strict();
export type ValidateSpellPackGraph = z.infer<
  typeof validateSpellPackGraphSchema
>;

/** Creates stable identity and immutable version 1 under an explicit empty-pack CAS. */
export const createSpellPackCommandSchema = z
  .object({
    actionId: spellIdSchema,
    expectedVersion: z.literal(0),
    graph: spellProgressionGraphSchema,
  })
  .strict();
export type CreateSpellPackCommand = z.infer<
  typeof createSpellPackCommandSchema
>;

/** Replaces no history: a full next DRAFT snapshot is appended under version CAS. */
export const appendSpellPackDraftVersionCommandSchema = z
  .object({
    actionId: spellIdSchema,
    expectedVersion: spellPackExpectedVersionSchema,
    graph: spellProgressionGraphSchema,
  })
  .strict();
export type AppendSpellPackDraftVersionCommand = z.infer<
  typeof appendSpellPackDraftVersionCommandSchema
>;

/** Lifecycle promotion clones the latest snapshot into a new immutable version. */
export const transitionSpellPackLifecycleCommandSchema = z
  .object({
    actionId: spellIdSchema,
    expectedVersion: spellPackExpectedVersionSchema,
    versionId: spellIdSchema,
    lifecycle: z.enum(["REFERENCE", "ACTIVE"]),
  })
  .strict();
export type TransitionSpellPackLifecycleCommand = z.infer<
  typeof transitionSpellPackLifecycleCommandSchema
>;

/** Archive is separate from promotion and also appends a new immutable version. */
export const archiveSpellPackCommandSchema = z
  .object({
    actionId: spellIdSchema,
    expectedVersion: spellPackExpectedVersionSchema,
    versionId: spellIdSchema,
  })
  .strict();
export type ArchiveSpellPackCommand = z.infer<
  typeof archiveSpellPackCommandSchema
>;

export const spellGraphValidationIssueCodeSchema = z.enum([
  "DUPLICATE_SCHOOL_ID",
  "DUPLICATE_NODE_ID",
  "DUPLICATE_REQUIREMENT_GROUP_ID",
  "DUPLICATE_EDGE_ID",
  "DUPLICATE_IMPORT_WARNING_ID",
  "DUPLICATE_EDGE",
  "EMPTY_REQUIREMENT_GROUP",
  "DANGLING_SCHOOL",
  "DANGLING_REQUIREMENT_GROUP",
  "DANGLING_SOURCE_NODE",
  "DANGLING_TARGET_NODE",
  "SELF_EDGE",
  "CROSS_PACK",
  "CROSS_VERSION",
  "CROSS_SCHOOL",
  "GROUP_TARGET_MISMATCH",
  "CYCLE",
  "UNRESOLVED_REQUIREMENT_GROUP",
  "OPEN_IMPORT_WARNING",
]);
export type SpellGraphValidationIssueCode = z.infer<
  typeof spellGraphValidationIssueCodeSchema
>;

export const spellGraphValidationIssueSchema = z
  .object({
    code: spellGraphValidationIssueCodeSchema,
    path: z.string(),
    message: z.string(),
    entityId: spellIdSchema.optional(),
  })
  .strict();
export type SpellGraphValidationIssue = z.infer<
  typeof spellGraphValidationIssueSchema
>;

export interface SpellGraphValidationResult {
  errors: SpellGraphValidationIssue[];
  warnings: SpellGraphValidationIssue[];
}

export const spellGraphSchemaIssueSchema = z
  .object({
    code: z.literal("SCHEMA_INVALID"),
    path: z.string(),
    message: z.string(),
  })
  .strict();
export type SpellGraphSchemaIssue = z.infer<typeof spellGraphSchemaIssueSchema>;

export const spellPackValidationResponseSchema = z
  .object({
    valid: z.boolean(),
    errors: z.array(
      z.union([spellGraphSchemaIssueSchema, spellGraphValidationIssueSchema]),
    ),
    warnings: z.array(spellGraphValidationIssueSchema),
  })
  .strict();
export type SpellPackValidationResponse = z.infer<
  typeof spellPackValidationResponseSchema
>;

export const spellReferenceImportPreviewResponseSchema = z
  .object({
    graph: spellProgressionGraphSchema,
    validation: spellPackValidationResponseSchema,
  })
  .strict();
export type SpellReferenceImportPreviewResponse = z.infer<
  typeof spellReferenceImportPreviewResponseSchema
>;

/** Full mechanics are intentionally a GM-only HTTP response, never a player projection. */
export interface SpellPackVersionDto {
  packId: string;
  versionId: string;
  version: number;
  lifecycle: SpellPackLifecycle;
  graph: SpellProgressionGraph;
  warnings: SpellGraphValidationIssue[];
  createdAt: string;
}

export const spellAssignmentKindSchema = z.enum(["SCHOOL", "NODE"]);
export type SpellAssignmentKind = z.infer<typeof spellAssignmentKindSchema>;

export const spellSchoolAssignmentTargetSchema = z
  .object({
    kind: z.literal("SCHOOL"),
    schoolId: spellIdSchema,
  })
  .strict();

export const spellNodeAssignmentTargetSchema = z
  .object({
    kind: z.literal("NODE"),
    schoolId: spellIdSchema,
    nodeId: spellIdSchema,
    rank: z.number().int().positive().max(1_000),
  })
  .strict();

export const spellAssignmentTargetSchema = z.discriminatedUnion("kind", [
  spellSchoolAssignmentTargetSchema,
  spellNodeAssignmentTargetSchema,
]);
export type SpellAssignmentTarget = z.infer<typeof spellAssignmentTargetSchema>;

const spellAssignmentOverrideReasonSchema = z.string().trim().min(1).max(2_000);

const spellAssignmentCommandFields = {
  actionId: spellIdSchema,
  assignmentVersionId: spellIdSchema,
  packId: spellIdSchema,
  packVersionId: spellIdSchema,
  target: spellAssignmentTargetSchema,
  overrideReason: spellAssignmentOverrideReasonSchema.optional(),
};

/** Creates stable assignment identity and immutable state version 1. */
export const createSpellAssignmentCommandSchema = z
  .object({
    ...spellAssignmentCommandFields,
    assignmentId: spellIdSchema,
    expectedVersion: z.literal(0),
  })
  .strict();
export type CreateSpellAssignmentCommand = z.infer<
  typeof createSpellAssignmentCommandSchema
>;

/** Appends a reassignment, pack-version move, or rank upgrade under CAS. */
export const appendSpellAssignmentVersionCommandSchema = z
  .object({
    ...spellAssignmentCommandFields,
    expectedVersion: z.number().int().positive(),
  })
  .strict();
export type AppendSpellAssignmentVersionCommand = z.infer<
  typeof appendSpellAssignmentVersionCommandSchema
>;

const spellAssignmentSnapshotIdentityFields = {
  schemaVersion: z.literal(1),
  assignmentId: spellIdSchema,
  assignmentVersionId: spellIdSchema,
  assignmentVersion: z.number().int().positive(),
  packId: spellIdSchema,
  packVersionId: spellIdSchema,
  packVersion: z.number().int().positive(),
  packLifecycle: z.literal("ACTIVE"),
  provenance: spellGraphProvenanceSchema,
  schoolId: spellIdSchema,
  school: spellSchoolSchema,
};

const spellSchoolAssignmentSnapshotSchema = z
  .object({
    ...spellAssignmentSnapshotIdentityFields,
    kind: z.literal("SCHOOL"),
    nodeId: z.null(),
    rank: z.null(),
    node: z.null(),
    requirementGroups: z.array(spellRequirementGroupSchema).max(0),
    edges: z.array(spellRequirementEdgeSchema).max(0),
  })
  .strict();

const spellNodeAssignmentSnapshotSchema = z
  .object({
    ...spellAssignmentSnapshotIdentityFields,
    kind: z.literal("NODE"),
    nodeId: spellIdSchema,
    rank: z.number().int().positive().max(1_000),
    node: spellNodeSchema,
    requirementGroups: z.array(spellRequirementGroupSchema),
    edges: z.array(spellRequirementEdgeSchema),
  })
  .strict();

/**
 * Immutable server-built rules snapshot. It deliberately contains no layout
 * and accepts no client-authored mechanics.
 */
export const spellAssignmentSnapshotSchema = z
  .discriminatedUnion("kind", [
    spellSchoolAssignmentSnapshotSchema,
    spellNodeAssignmentSnapshotSchema,
  ])
  .superRefine((snapshot, context) => {
    if (
      snapshot.school.id !== snapshot.schoolId ||
      snapshot.school.packId !== snapshot.packId ||
      snapshot.school.packVersionId !== snapshot.packVersionId
    )
      context.addIssue({
        code: "custom",
        path: ["school"],
        message: "School identity must match the assignment snapshot",
      });

    if (snapshot.kind === "SCHOOL") return;
    if (
      snapshot.node.id !== snapshot.nodeId ||
      snapshot.node.schoolId !== snapshot.schoolId ||
      snapshot.node.packId !== snapshot.packId ||
      snapshot.node.packVersionId !== snapshot.packVersionId
    )
      context.addIssue({
        code: "custom",
        path: ["node"],
        message: "Node identity must match the assignment snapshot",
      });

    const groupIds = new Set(
      snapshot.requirementGroups.map((group) => group.id),
    );
    for (const [index, group] of snapshot.requirementGroups.entries())
      if (
        group.packId !== snapshot.packId ||
        group.packVersionId !== snapshot.packVersionId ||
        group.schoolId !== snapshot.schoolId ||
        group.targetNodeId !== snapshot.nodeId
      )
        context.addIssue({
          code: "custom",
          path: ["requirementGroups", index],
          message: "Requirement group must target the assignment node",
        });
    for (const [index, edge] of snapshot.edges.entries())
      if (
        edge.packId !== snapshot.packId ||
        edge.packVersionId !== snapshot.packVersionId ||
        edge.schoolId !== snapshot.schoolId ||
        edge.targetNodeId !== snapshot.nodeId ||
        !groupIds.has(edge.requirementGroupId)
      )
        context.addIssue({
          code: "custom",
          path: ["edges", index],
          message: "Requirement edge must belong to a snapshot group",
        });
  });
export type SpellAssignmentSnapshot = z.infer<
  typeof spellAssignmentSnapshotSchema
>;

export interface SpellAssignmentVersionDto {
  assignmentId: string;
  assignmentVersionId: string;
  version: number;
  characterId: string;
  packId: string;
  packVersionId: string;
  kind: SpellAssignmentKind;
  schoolId: string;
  nodeId: string | null;
  rank: number | null;
  snapshot: SpellAssignmentSnapshot;
  overrideReason: string | null;
  assignedByMembershipId: string;
  createdAt: string;
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function compareIssues(
  left: SpellGraphValidationIssue,
  right: SpellGraphValidationIssue,
): number {
  return (
    compareText(left.code, right.code) ||
    compareText(left.path, right.path) ||
    compareText(left.entityId ?? "", right.entityId ?? "") ||
    compareText(left.message, right.message)
  );
}

function pushDuplicateIssues(
  values: readonly { id: string }[],
  collectionPath: string,
  code: SpellGraphValidationIssueCode,
  label: string,
  errors: SpellGraphValidationIssue[],
): void {
  const seen = new Set<string>();
  values.forEach((value, index) => {
    if (seen.has(value.id)) {
      errors.push({
        code,
        path: `${collectionPath}[${index}].id`,
        entityId: value.id,
        message: `Duplicate ${label} id: ${value.id}`,
      });
    }
    seen.add(value.id);
  });
}

interface VersionLinkedEntity {
  id: string;
  packId: string;
  packVersionId: string;
}

function pushVersionLinkIssues(
  entity: VersionLinkedEntity,
  path: string,
  graph: SpellProgressionGraph,
  errors: SpellGraphValidationIssue[],
): void {
  if (entity.packId !== graph.packId)
    errors.push({
      code: "CROSS_PACK",
      path: `${path}.packId`,
      entityId: entity.id,
      message: `Entity ${entity.id} belongs to pack ${entity.packId}, expected ${graph.packId}`,
    });
  if (entity.packVersionId !== graph.versionId)
    errors.push({
      code: "CROSS_VERSION",
      path: `${path}.packVersionId`,
      entityId: entity.id,
      message: `Entity ${entity.id} belongs to version ${entity.packVersionId}, expected ${graph.versionId}`,
    });
}

function cycleIssues(
  graph: SpellProgressionGraph,
  nodesById: ReadonlyMap<string, SpellNode>,
): SpellGraphValidationIssue[] {
  const adjacency = new Map<string, Set<string>>();
  for (const nodeId of nodesById.keys()) adjacency.set(nodeId, new Set());

  for (const edge of graph.edges) {
    const source = nodesById.get(edge.sourceNodeId);
    const target = nodesById.get(edge.targetNodeId);
    if (
      !source ||
      !target ||
      source.id === target.id ||
      source.schoolId !== target.schoolId ||
      edge.schoolId !== source.schoolId
    )
      continue;
    adjacency.get(source.id)?.add(target.id);
  }

  let nextIndex = 0;
  const indexByNode = new Map<string, number>();
  const lowLinkByNode = new Map<string, number>();
  const stack: string[] = [];
  const onStack = new Set<string>();
  const components: string[][] = [];

  const visit = (nodeId: string): void => {
    indexByNode.set(nodeId, nextIndex);
    lowLinkByNode.set(nodeId, nextIndex);
    nextIndex += 1;
    stack.push(nodeId);
    onStack.add(nodeId);

    const targets = [...(adjacency.get(nodeId) ?? [])].sort(compareText);
    for (const targetId of targets) {
      if (!indexByNode.has(targetId)) {
        visit(targetId);
        lowLinkByNode.set(
          nodeId,
          Math.min(lowLinkByNode.get(nodeId)!, lowLinkByNode.get(targetId)!),
        );
      } else if (onStack.has(targetId)) {
        lowLinkByNode.set(
          nodeId,
          Math.min(lowLinkByNode.get(nodeId)!, indexByNode.get(targetId)!),
        );
      }
    }

    if (lowLinkByNode.get(nodeId) !== indexByNode.get(nodeId)) return;
    const component: string[] = [];
    let member: string;
    do {
      member = stack.pop()!;
      onStack.delete(member);
      component.push(member);
    } while (member !== nodeId);
    if (component.length > 1) components.push(component.sort(compareText));
  };

  for (const nodeId of [...nodesById.keys()].sort(compareText))
    if (!indexByNode.has(nodeId)) visit(nodeId);

  return components
    .sort((left, right) => compareText(left.join("|"), right.join("|")))
    .map((component) => ({
      code: "CYCLE" as const,
      path: "edges",
      entityId: component[0],
      message: `Cycle contains nodes: ${component.join(", ")}`,
    }));
}

/**
 * Validates semantic graph integrity without mutating the graph. The input is
 * expected to have passed `spellProgressionGraphSchema`; this function reports
 * cross-entity problems that a field-level schema cannot establish.
 */
export function validateSpellProgressionGraph(
  graph: SpellProgressionGraph,
): SpellGraphValidationResult {
  const errors: SpellGraphValidationIssue[] = [];
  const warnings: SpellGraphValidationIssue[] = [];

  pushDuplicateIssues(
    graph.schools,
    "schools",
    "DUPLICATE_SCHOOL_ID",
    "school",
    errors,
  );
  pushDuplicateIssues(
    graph.nodes,
    "nodes",
    "DUPLICATE_NODE_ID",
    "node",
    errors,
  );
  pushDuplicateIssues(
    graph.requirementGroups,
    "requirementGroups",
    "DUPLICATE_REQUIREMENT_GROUP_ID",
    "requirement group",
    errors,
  );
  pushDuplicateIssues(
    graph.edges,
    "edges",
    "DUPLICATE_EDGE_ID",
    "edge",
    errors,
  );
  pushDuplicateIssues(
    graph.importWarnings ?? [],
    "importWarnings",
    "DUPLICATE_IMPORT_WARNING_ID",
    "import warning",
    errors,
  );

  (graph.importWarnings ?? []).forEach((warning, index) => {
    if (warning.status !== "OPEN") return;
    const issue: SpellGraphValidationIssue = {
      code: "OPEN_IMPORT_WARNING",
      path: `importWarnings[${index}].status`,
      entityId: warning.id,
      message: warning.message,
    };
    if (graph.lifecycle === "ACTIVE") errors.push(issue);
    else warnings.push(issue);
  });

  const schoolsById = new Map(
    graph.schools.map((school) => [school.id, school] as const),
  );
  const nodesById = new Map(
    graph.nodes.map((node) => [node.id, node] as const),
  );
  const groupsById = new Map(
    graph.requirementGroups.map((group) => [group.id, group] as const),
  );
  const edgeCountByGroupId = new Map<string, number>();
  for (const edge of graph.edges)
    edgeCountByGroupId.set(
      edge.requirementGroupId,
      (edgeCountByGroupId.get(edge.requirementGroupId) ?? 0) + 1,
    );

  graph.schools.forEach((school, index) =>
    pushVersionLinkIssues(school, `schools[${index}]`, graph, errors),
  );

  graph.nodes.forEach((node, index) => {
    const path = `nodes[${index}]`;
    pushVersionLinkIssues(node, path, graph, errors);
    if (!schoolsById.has(node.schoolId))
      errors.push({
        code: "DANGLING_SCHOOL",
        path: `${path}.schoolId`,
        entityId: node.id,
        message: `Node ${node.id} references unknown school ${node.schoolId}`,
      });
  });

  graph.requirementGroups.forEach((group, index) => {
    const path = `requirementGroups[${index}]`;
    pushVersionLinkIssues(group, path, graph, errors);
    if (!schoolsById.has(group.schoolId))
      errors.push({
        code: "DANGLING_SCHOOL",
        path: `${path}.schoolId`,
        entityId: group.id,
        message: `Requirement group ${group.id} references unknown school ${group.schoolId}`,
      });

    const target = nodesById.get(group.targetNodeId);
    if (!target)
      errors.push({
        code: "DANGLING_TARGET_NODE",
        path: `${path}.targetNodeId`,
        entityId: group.id,
        message: `Requirement group ${group.id} references unknown target node ${group.targetNodeId}`,
      });
    else if (target.schoolId !== group.schoolId)
      errors.push({
        code: "CROSS_SCHOOL",
        path: `${path}.targetNodeId`,
        entityId: group.id,
        message: `Requirement group ${group.id} and target ${target.id} belong to different schools`,
      });

    if ((edgeCountByGroupId.get(group.id) ?? 0) === 0)
      errors.push({
        code: "EMPTY_REQUIREMENT_GROUP",
        path,
        entityId: group.id,
        message: `Requirement group ${group.id} has no prerequisite edges`,
      });

    if (group.mode === "UNRESOLVED") {
      const issue: SpellGraphValidationIssue = {
        code: "UNRESOLVED_REQUIREMENT_GROUP",
        path: `${path}.mode`,
        entityId: group.id,
        message: `Requirement group ${group.id} has unresolved ALL/ANY semantics`,
      };
      if (graph.lifecycle === "ACTIVE") errors.push(issue);
      else warnings.push(issue);
    }
  });

  const seenEdges = new Set<string>();
  graph.edges.forEach((edge, index) => {
    const path = `edges[${index}]`;
    pushVersionLinkIssues(edge, path, graph, errors);

    const identity = [edge.sourceNodeId, edge.targetNodeId].join("|");
    if (seenEdges.has(identity))
      errors.push({
        code: "DUPLICATE_EDGE",
        path,
        entityId: edge.id,
        message: `Duplicate prerequisite edge ${edge.sourceNodeId} -> ${edge.targetNodeId}`,
      });
    seenEdges.add(identity);

    const group = groupsById.get(edge.requirementGroupId);
    const source = nodesById.get(edge.sourceNodeId);
    const target = nodesById.get(edge.targetNodeId);

    if (!schoolsById.has(edge.schoolId))
      errors.push({
        code: "DANGLING_SCHOOL",
        path: `${path}.schoolId`,
        entityId: edge.id,
        message: `Edge ${edge.id} references unknown school ${edge.schoolId}`,
      });
    if (!group)
      errors.push({
        code: "DANGLING_REQUIREMENT_GROUP",
        path: `${path}.requirementGroupId`,
        entityId: edge.id,
        message: `Edge ${edge.id} references unknown requirement group ${edge.requirementGroupId}`,
      });
    if (!source)
      errors.push({
        code: "DANGLING_SOURCE_NODE",
        path: `${path}.sourceNodeId`,
        entityId: edge.id,
        message: `Edge ${edge.id} references unknown source node ${edge.sourceNodeId}`,
      });
    if (!target)
      errors.push({
        code: "DANGLING_TARGET_NODE",
        path: `${path}.targetNodeId`,
        entityId: edge.id,
        message: `Edge ${edge.id} references unknown target node ${edge.targetNodeId}`,
      });
    if (edge.sourceNodeId === edge.targetNodeId)
      errors.push({
        code: "SELF_EDGE",
        path,
        entityId: edge.id,
        message: `Edge ${edge.id} points node ${edge.sourceNodeId} to itself`,
      });

    if (group) {
      if (group.schoolId !== edge.schoolId)
        errors.push({
          code: "CROSS_SCHOOL",
          path: `${path}.requirementGroupId`,
          entityId: edge.id,
          message: `Edge ${edge.id} and group ${group.id} belong to different schools`,
        });
      if (group.targetNodeId !== edge.targetNodeId)
        errors.push({
          code: "GROUP_TARGET_MISMATCH",
          path: `${path}.targetNodeId`,
          entityId: edge.id,
          message: `Edge ${edge.id} targets ${edge.targetNodeId}, but group ${group.id} targets ${group.targetNodeId}`,
        });
    }
    if (source && source.schoolId !== edge.schoolId)
      errors.push({
        code: "CROSS_SCHOOL",
        path: `${path}.sourceNodeId`,
        entityId: edge.id,
        message: `Edge ${edge.id} and source ${source.id} belong to different schools`,
      });
    if (target && target.schoolId !== edge.schoolId)
      errors.push({
        code: "CROSS_SCHOOL",
        path: `${path}.targetNodeId`,
        entityId: edge.id,
        message: `Edge ${edge.id} and target ${target.id} belong to different schools`,
      });
  });

  errors.push(...cycleIssues(graph, nodesById));

  return {
    errors: errors.sort(compareIssues),
    warnings: warnings.sort(compareIssues),
  };
}

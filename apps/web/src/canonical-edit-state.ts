import type { WorldContentDto } from "@arken/contracts";
import {
  parseTagList,
  type UpdateWorldContentInput,
} from "./world-content-client";

export type CanonicalEntityDraft = {
  name: string;
  subtype: string;
  aliases: string;
  summary: string;
  publicText: string;
  gmOnlyText: string;
  tags: string;
  coverAssetId: string;
};

export type CanonicalEditPatch = Partial<
  Omit<UpdateWorldContentInput, "revision">
>;

export type CanonicalEditEnvelope = Readonly<{
  entityId: string;
  actionId: string;
  revision: number;
  payload: Readonly<CanonicalEditPatch>;
}>;

export function canonicalDraftFromEntity(
  entity: WorldContentDto,
): CanonicalEntityDraft {
  return {
    name: entity.name,
    subtype: entity.subtype ?? "",
    aliases: entity.aliases.join(", "),
    summary: entity.summary,
    publicText: entity.publicText,
    gmOnlyText: entity.gmOnlyText,
    tags: entity.tags.join(", "),
    coverAssetId: entity.coverAssetId ?? "",
  };
}

const sameStrings = (left: readonly string[], right: readonly string[]) =>
  left.length === right.length &&
  left.every((value, index) => value === right[index]);

/** Capture only fields intentionally changed from the edit base. */
export function canonicalEditPatch(
  base: WorldContentDto,
  draft: CanonicalEntityDraft,
): CanonicalEditPatch {
  const patch: CanonicalEditPatch = {};
  const name = draft.name.trim();
  const subtype = draft.subtype.trim() || null;
  const aliases = parseTagList(draft.aliases);
  const tags = parseTagList(draft.tags);
  const coverAssetId = draft.coverAssetId || null;

  if (name !== base.name) patch.name = name;
  if (subtype !== base.subtype) patch.subtype = subtype;
  if (!sameStrings(aliases, base.aliases)) patch.aliases = aliases;
  if (draft.summary !== base.summary) patch.summary = draft.summary;
  if (draft.publicText !== base.publicText) patch.publicText = draft.publicText;
  if (draft.gmOnlyText !== base.gmOnlyText) patch.gmOnlyText = draft.gmOnlyText;
  if (!sameStrings(tags, base.tags)) patch.tags = tags;
  if (coverAssetId !== base.coverAssetId) patch.coverAssetId = coverAssetId;
  return patch;
}

export function createCanonicalEditEnvelope(
  base: WorldContentDto,
  payload: CanonicalEditPatch,
  actionId: string,
): CanonicalEditEnvelope {
  const copy = { ...payload };
  if (copy.aliases) copy.aliases = Object.freeze([...copy.aliases]) as string[];
  if (copy.tags) copy.tags = Object.freeze([...copy.tags]) as string[];
  return Object.freeze({
    entityId: base.id,
    actionId,
    revision: base.revision,
    payload: Object.freeze(copy),
  });
}

/** Start from latest server fields, then carry only explicitly selected changes. */
export function reapplyCanonicalEditPatch(
  latest: WorldContentDto,
  payload: CanonicalEditPatch,
): CanonicalEntityDraft {
  return {
    ...canonicalDraftFromEntity(latest),
    ...(payload.name !== undefined ? { name: payload.name } : {}),
    ...(payload.subtype !== undefined
      ? { subtype: payload.subtype ?? "" }
      : {}),
    ...(payload.aliases !== undefined
      ? { aliases: payload.aliases.join(", ") }
      : {}),
    ...(payload.summary !== undefined ? { summary: payload.summary } : {}),
    ...(payload.publicText !== undefined
      ? { publicText: payload.publicText }
      : {}),
    ...(payload.gmOnlyText !== undefined
      ? { gmOnlyText: payload.gmOnlyText }
      : {}),
    ...(payload.tags !== undefined ? { tags: payload.tags.join(", ") } : {}),
    ...(payload.coverAssetId !== undefined
      ? { coverAssetId: payload.coverAssetId ?? "" }
      : {}),
  };
}

export function canonicalEditFieldLabel(
  field: keyof CanonicalEditPatch,
): string {
  const labels: Record<keyof CanonicalEditPatch, string> = {
    name: "Название",
    subtype: "Подтип",
    aliases: "Алиасы",
    summary: "Краткое описание",
    publicText: "Текст для игроков",
    gmOnlyText: "Текст только для мастера",
    tags: "Теги",
    coverAssetId: "Обложка",
  };
  return labels[field];
}

export function canonicalEditFieldValue(
  entity: WorldContentDto,
  field: keyof CanonicalEditPatch,
): string {
  const values: Record<keyof CanonicalEditPatch, string | string[] | null> = {
    name: entity.name,
    subtype: entity.subtype,
    aliases: entity.aliases,
    summary: entity.summary,
    publicText: entity.publicText,
    gmOnlyText: entity.gmOnlyText,
    tags: entity.tags,
    coverAssetId: entity.coverAssetId,
  };
  return canonicalEditValue(values[field]);
}

export function canonicalEditValue(
  value: CanonicalEditPatch[keyof CanonicalEditPatch] | null | undefined,
): string {
  if (value == null) return "—";
  return Array.isArray(value) ? value.join(", ") || "—" : String(value);
}

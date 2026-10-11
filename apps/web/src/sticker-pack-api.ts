import { api } from "./api";

export type StickerPackSubject = "CHARACTER" | "PLAYER" | "NPC" | "CREATURE";
export type StickerPackAudience = "CAMPAIGN" | "GM_ONLY";
export type StickerPackSendPolicy = "ALL_MEMBERS" | "GM_ONLY";
export type StickerProvenance = "ORIGINAL" | "COMMISSIONED" | "IMPORTED";

export interface CreateStickerPackInput {
  name: string;
  subject: StickerPackSubject;
  subjectCharacterId: string | null;
  subjectMembershipId: string | null;
  subjectLabel: string | null;
  audience: StickerPackAudience;
  sendPolicy: StickerPackSendPolicy;
}

export interface StickerPackMutationResult {
  id: string;
  name: string;
  lifecycle: "DRAFT" | "ACTIVE" | "DEPRECATED" | "ARCHIVED";
  revision: number;
}

export interface StickerUploadMetadata {
  name: string;
  altText: string;
  provenanceType: StickerProvenance;
  sourceReference?: string;
  authorCredit?: string;
  licenseNote?: string;
}

export interface StickerUploadResult {
  id: string;
  packId: string;
  mediaId: string;
  name: string;
  altText: string;
  provenanceType: StickerProvenance;
}

export interface StickerPackAdminSummary extends StickerPackMutationResult {
  subject: StickerPackSubject;
  subjectCharacterId: string | null;
  subjectMembershipId: string | null;
  subjectLabel: string | null;
  audience: StickerPackAudience;
  sendPolicy: StickerPackSendPolicy;
  createdAt: string;
  updatedAt: string;
  playerConsentStatus: "GRANTED" | "REVOKED" | null;
  stickerCount: number;
}

export interface StickerPackAdminSticker extends StickerUploadResult {
  sourceReference: string | null;
  authorCredit: string | null;
  licenseNote: string | null;
  sha256: string;
  mimeType: string;
  sizeBytes: number;
  width: number;
  height: number;
}

export interface StickerPackAdminDetail extends StickerPackAdminSummary {
  stickers: StickerPackAdminSticker[];
}

export function listStickerPacks() {
  return api<StickerPackAdminSummary[]>("/api/gm/sticker-packs");
}

export function getStickerPack(packId: string) {
  return api<StickerPackAdminDetail>(
    `/api/gm/sticker-packs/${encodeURIComponent(packId)}`,
  );
}

export function createStickerPack(input: CreateStickerPackInput) {
  return api<StickerPackMutationResult>("/api/sticker-packs", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export function uploadSticker(
  packId: string,
  file: File,
  metadata: StickerUploadMetadata,
) {
  const query = new URLSearchParams({
    name: metadata.name,
    altText: metadata.altText,
    provenanceType: metadata.provenanceType,
  });
  for (const key of [
    "sourceReference",
    "authorCredit",
    "licenseNote",
  ] as const) {
    const value = metadata[key]?.trim();
    if (value) query.set(key, value);
  }
  const form = new FormData();
  form.append("file", file, file.name);
  return api<StickerUploadResult>(
    `/api/sticker-packs/${encodeURIComponent(packId)}/stickers?${query.toString()}`,
    { method: "POST", body: form },
  );
}

export function publishStickerPack(packId: string) {
  return api<StickerPackMutationResult>(
    `/api/sticker-packs/${encodeURIComponent(packId)}/publish`,
    { method: "POST", body: JSON.stringify({}) },
  );
}

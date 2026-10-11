import { createHash } from "node:crypto";
import type {
  AssetKind,
  AudioPurpose,
  AssetDto,
  AssetUsageDto,
  AssetUsageResponseDto,
  DeleteAssetResponseDto,
} from "@arken/contracts";

/** Stable opaque validator for one concrete blob revision. */
export function assetContentVersion(storageKey: string) {
  return `"${createHash("sha256").update(storageKey).digest("hex")}"`;
}

/** Compare upload idempotency receipts without letting purpose drift on replay. */
export function assetUploadActionMatches(
  payload: { kind?: string; audioPurpose?: string | null } | null,
  kind: AssetKind,
  audioPurpose: AudioPurpose | null,
) {
  if (payload?.kind !== kind) return false;
  if (kind !== "AUDIO") return payload.audioPurpose == null && audioPurpose === null;
  return (payload.audioPurpose ?? "MUSIC") === (audioPurpose ?? "MUSIC");
}

export const ASSET_DEPENDENCY_REGISTRY = [
  "SCENE_BACKGROUND",
  "TOKEN_DEFINITION",
  "TOKEN_INSTANCE",
  "CHARACTER_PORTRAIT",
  "CHARACTER_RESOURCE",
  "CHARACTER_MEDIA",
  "WORLD_MAP_BACKGROUND",
  "AUDIO_TRACK",
  "WORLD_CONTENT_COVER",
  "WORLD_CONTENT_MEDIA",
  "WORLD_CONTENT_INSTANCE_PORTRAIT",
  "GENERATED_TOKEN_SOURCE",
] as const;

export interface AssetMetadata extends Omit<AssetDto, "url" | "createdAt"> {
  createdAt: Date;
  storageKey: string;
}

export function assetDto(asset: AssetMetadata): AssetDto {
  return {
    id: asset.id,
    kind: asset.kind,
    audioPurpose: asset.audioPurpose,
    name: asset.name,
    mimeType: asset.mimeType,
    sizeBytes: asset.sizeBytes,
    width: asset.width,
    height: asset.height,
    durationSeconds: asset.durationSeconds,
    url: `/api/assets/${asset.id}/content?v=${assetContentVersion(asset.storageKey).slice(1, -1)}`,
    createdAt: asset.createdAt.toISOString(),
  };
}

export function assetUsagePolicy(
  asset: AssetMetadata,
  usages: AssetUsageDto[],
  auth: { role: "GM" | "PLAYER" },
): AssetUsageResponseDto {
  const blockingUsageCount = usages.filter(
    (usage) => usage.deletionPolicy === "BLOCK",
  ).length;
  if (auth.role === "GM")
    return {
      asset: assetDto(asset),
      inUse: usages.length > 0,
      usages,
      hiddenUsageCount: 0,
      canDelete: blockingUsageCount === 0,
      deletionBlockedReason: blockingUsageCount ? "ASSET_IN_USE" : null,
    };
  return {
    asset: assetDto(asset),
    inUse: usages.length > 0,
    usages: [],
    hiddenUsageCount: usages.length,
    canDelete: false,
    deletionBlockedReason: "GM_REQUIRED",
  };
}

export interface AssetDeletionAdapter {
  deleteMetadata(): Promise<void>;
  removeBlob(): Promise<void>;
}

/** Metadata-first deletion makes every partial failure inaccessible and explicit. */
export async function deleteUnusedAsset(
  assetId: string,
  usages: AssetUsageDto[],
  adapter: AssetDeletionAdapter,
): Promise<DeleteAssetResponseDto> {
  if (usages.some((usage) => usage.deletionPolicy === "BLOCK"))
    throw new Error("ASSET_IN_USE");
  await adapter.deleteMetadata();
  try {
    await adapter.removeBlob();
    return { assetId, deleted: true, blobCleanupPending: false };
  } catch {
    return { assetId, deleted: true, blobCleanupPending: true };
  }
}

import { describe, expect, it, vi } from "vitest";
import type { AssetUsageDto } from "@arken/contracts";
import {
  ASSET_DEPENDENCY_REGISTRY,
  assetUsagePolicy,
  assetDto,
  assetContentVersion,
  assetUploadActionMatches,
  deleteUnusedAsset,
} from "./asset-lifecycle.js";
import { postgresErrorCode } from "./database-errors.js";

const asset = {
  id: "00000000-0000-4000-8000-000000000001",
  campaignId: "00000000-0000-4000-8000-000000000002",
  uploadedByMembershipId: "00000000-0000-4000-8000-000000000003",
  kind: "IMAGE" as const,
  name: "Forest",
  storageKey: "opaque.webp",
  mimeType: "image/webp",
  sizeBytes: 42,
  width: 10,
  height: 10,
  durationSeconds: null,
  createdAt: new Date("2026-07-31T00:00:00.000Z"),
};
const usage = (kind: AssetUsageDto["kind"]): AssetUsageDto => ({
  kind,
  entityId: "00000000-0000-4000-8000-000000000010",
  label: "Safe label",
  visibility: "GM_ONLY",
  deletionPolicy:
    kind === "GENERATED_TOKEN_SOURCE" ? "RETAIN_HISTORY" : "DETACH",
});

describe("asset dependency registry", () => {
  it("covers every schema-confirmed asset relation and audit provenance", () => {
    expect(ASSET_DEPENDENCY_REGISTRY).toEqual([
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
    ]);
  });
});

it("extracts a wrapped PostgreSQL unique-conflict code safely", () => {
  expect(postgresErrorCode({ cause: { code: "23505" } })).toBe("23505");
  expect(postgresErrorCode({ cause: { cause: { code: "23503" } } })).toBe("23503");
  const cyclic: { cause?: unknown; code?: string } = {};
  cyclic.cause = cyclic;
  expect(postgresErrorCode(cyclic)).toBeUndefined();
});

describe("asset usage policy", () => {
  it("allows a GM to delete an unused same-campaign asset", () => {
    expect(assetUsagePolicy(asset, [], { role: "GM" })).toMatchObject({
      inUse: false,
      usages: [],
      hiddenUsageCount: 0,
      canDelete: true,
      deletionBlockedReason: null,
    });
  });

  it("returns detachable dependencies to a GM and permits a safe detach-and-delete", () => {
    const usages = [usage("SCENE_BACKGROUND"), usage("AUDIO_TRACK")];
    expect(assetUsagePolicy(asset, usages, { role: "GM" })).toMatchObject({
      inUse: true,
      usages,
      canDelete: true,
      deletionBlockedReason: null,
    });
  });

  it("keeps audit provenance without blocking deletion", () => {
    expect(
      assetUsagePolicy(asset, [usage("GENERATED_TOKEN_SOURCE")], {
        role: "GM",
      }),
    ).toMatchObject({
      inUse: true,
      canDelete: true,
      deletionBlockedReason: null,
    });
  });

  it("never reveals GM-only dependency details to a player", () => {
    const result = assetUsagePolicy(asset, [usage("SCENE_BACKGROUND")], {
      role: "PLAYER",
    });
    expect(result).toMatchObject({
      inUse: true,
      usages: [],
      hiddenUsageCount: 1,
      canDelete: false,
      deletionBlockedReason: "GM_REQUIRED",
    });
    expect(JSON.stringify(result)).not.toContain("Safe label");
    expect(JSON.stringify(result)).not.toContain("opaque.webp");
  });
});

describe("asset deletion orchestration", () => {
  it("rejects a dependency without touching metadata or content", async () => {
    const deleteMetadata = vi.fn();
    const removeBlob = vi.fn();
    await expect(
      deleteUnusedAsset(asset.id, [{ ...usage("TOKEN_DEFINITION"), deletionPolicy: "BLOCK" }], {
        deleteMetadata,
        removeBlob,
      }),
    ).rejects.toThrow("ASSET_IN_USE");
    expect(deleteMetadata).not.toHaveBeenCalled();
    expect(removeBlob).not.toHaveBeenCalled();
  });

  it("deletes metadata before content for a successful delete", async () => {
    const order: string[] = [];
    await expect(
      deleteUnusedAsset(asset.id, [], {
        deleteMetadata: async () => {
          order.push("metadata");
        },
        removeBlob: async () => {
          order.push("blob");
        },
      }),
    ).resolves.toEqual({
      assetId: asset.id,
      deleted: true,
      blobCleanupPending: false,
    });
    expect(order).toEqual(["metadata", "blob"]);
  });

  it("retains historical provenance while allowing content deletion", async () => {
    const deleteMetadata = vi.fn();
    const removeBlob = vi.fn();
    await expect(
      deleteUnusedAsset(asset.id, [usage("GENERATED_TOKEN_SOURCE")], {
        deleteMetadata,
        removeBlob,
      }),
    ).resolves.toMatchObject({ deleted: true });
    expect(deleteMetadata).toHaveBeenCalledOnce();
    expect(removeBlob).toHaveBeenCalledOnce();
  });

  it("does not touch content when the database operation fails", async () => {
    const removeBlob = vi.fn();
    await expect(
      deleteUnusedAsset(asset.id, [], {
        deleteMetadata: async () => {
          throw new Error("DATABASE_FAILURE");
        },
        removeBlob,
      }),
    ).rejects.toThrow("DATABASE_FAILURE");
    expect(removeBlob).not.toHaveBeenCalled();
  });

  it("reports an inaccessible orphan when filesystem cleanup fails", async () => {
    await expect(
      deleteUnusedAsset(asset.id, [], {
        deleteMetadata: async () => undefined,
        removeBlob: async () => {
          throw new Error("FILESYSTEM_FAILURE");
        },
      }),
    ).resolves.toEqual({
      assetId: asset.id,
      deleted: true,
      blobCleanupPending: true,
    });
  });
});

it("changes rendered content URL only when blob version changes, retaining canonical identity and hiding storage keys", () => {
  const original = assetDto(asset);
  const renamed = assetDto({ ...asset, name: "New name" });
  const replaced = assetDto({ ...asset, storageKey: "new-private-blob.webp" });
  expect(renamed.url).toBe(original.url);
  expect(replaced.url).not.toBe(original.url);
  expect(replaced.id).toBe(original.id);
  const url = new URL(replaced.url, "https://example.invalid");
  expect(url.pathname).toBe(`/api/assets/${asset.id}/content`);
  expect(url.searchParams.get("v")).toBe(
    assetContentVersion("new-private-blob.webp").slice(1, -1),
  );
  expect(JSON.stringify(replaced)).not.toContain("new-private-blob");
});

it("binds upload action replay to audio purpose while retaining the legacy MUSIC default", () => {
  expect(assetUploadActionMatches({ kind: "AUDIO" }, "AUDIO", "MUSIC")).toBe(true);
  expect(assetUploadActionMatches({ kind: "AUDIO", audioPurpose: "SOUND_EFFECT" }, "AUDIO", "SOUND_EFFECT")).toBe(true);
  expect(assetUploadActionMatches({ kind: "AUDIO", audioPurpose: "MUSIC" }, "AUDIO", "SOUND_EFFECT")).toBe(false);
  expect(assetUploadActionMatches({ kind: "IMAGE" }, "IMAGE", null)).toBe(true);
  expect(assetUploadActionMatches({ kind: "IMAGE", audioPurpose: "MUSIC" }, "IMAGE", null)).toBe(false);
});

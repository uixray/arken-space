import { describe, expect, it, vi } from "vitest";
import type { AssetUsageDto } from "@arken/contracts";
import {
  ASSET_DEPENDENCY_REGISTRY,
  assetUsagePolicy,
  deleteUnusedAsset,
} from "./asset-lifecycle.js";

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
    kind === "GENERATED_TOKEN_SOURCE" ? "RETAIN_HISTORY" : "BLOCK",
});

describe("asset dependency registry", () => {
  it("covers every schema-confirmed asset relation and audit provenance", () => {
    expect(ASSET_DEPENDENCY_REGISTRY).toEqual([
      "SCENE_BACKGROUND",
      "TOKEN_DEFINITION",
      "CHARACTER_PORTRAIT",
      "CHARACTER_MEDIA",
      "WORLD_MAP_BACKGROUND",
      "AUDIO_TRACK",
      "WORLD_CONTENT_COVER",
      "WORLD_CONTENT_MEDIA",
      "GENERATED_TOKEN_SOURCE",
    ]);
  });
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

  it("returns multiple dependencies to a GM and blocks deletion", () => {
    const usages = [usage("SCENE_BACKGROUND"), usage("AUDIO_TRACK")];
    expect(assetUsagePolicy(asset, usages, { role: "GM" })).toMatchObject({
      inUse: true,
      usages,
      canDelete: false,
      deletionBlockedReason: "ASSET_IN_USE",
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
      deleteUnusedAsset(asset.id, [usage("TOKEN_DEFINITION")], {
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

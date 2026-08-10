import { useMemo } from "react";
import type { AssetDto, AssetKind } from "@arken/contracts";
import { api } from "./api";
import type { Props as SidebarProps } from "./Sidebar";

/**
 * UIX-398 — asset upload and token-image generation.
 *
 * Uploads carry their idempotency key in the `x-action-id` header rather than
 * the body, because the body is `FormData` carrying the file itself.
 *
 * Both refetch the snapshot afterwards: a new asset has to appear in the
 * asset lists that pickers read from, and unlike the story feed those lists
 * are part of the snapshot.
 */
export interface AssetActions {
  uploadAsset: (file: File, kind: AssetKind) => Promise<AssetDto>;
  // Derived rather than restated: the transform carries a frame preset union
  // that a hand-written copy got wrong once already.
  generateTokenImage: SidebarProps["onGenerateTokenImage"];
}

export function useAssetActions(dependencies: {
  /** Stable — `useCallback` with an empty dependency list in App. */
  load: () => Promise<void>;
}): AssetActions {
  const { load } = dependencies;

  return useMemo<AssetActions>(
    () => ({
      uploadAsset: async (file, kind) => {
        const form = new FormData();
        form.append("file", file);
        const asset = await api<AssetDto>(`/api/assets?kind=${kind}`, {
          method: "POST",
          headers: { "x-action-id": crypto.randomUUID() },
          body: form,
        });
        await load();
        // The upload response omits the content URL and returns createdAt as
        // a Date, while everything downstream expects the snapshot's shape.
        return {
          ...asset,
          url: `/api/assets/${asset.id}/content`,
          createdAt: String(asset.createdAt),
        };
      },

      generateTokenImage: async ({ sourceAssetId, ...transform }) => {
        const asset = await api<AssetDto>(
          `/api/assets/${sourceAssetId}/token`,
          {
            method: "POST",
            headers: { "x-action-id": crypto.randomUUID() },
            body: JSON.stringify(transform),
          },
        );
        await load();
        return asset;
      },
    }),
    [load],
  );
}

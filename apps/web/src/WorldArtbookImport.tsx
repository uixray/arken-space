import { useState } from "react";
import type { AssetDto, WorldContentType } from "@arken/contracts";
import { api, formatApiError } from "./api";
import { Button } from "./design-system/Button";
import {
  addWorldContentMedia,
  createWorldContent,
  fetchWorldContentList,
  updateWorldContent,
} from "./world-content-client";

/** UIX-263: bundled artbook reference (`docs/content/world-artbook.json`). */
export type ArtbookRecord = {
  slug: string;
  type: WorldContentType;
  name: string;
  summary: string;
  cover: string | null;
  gallery: string[];
  sourceUrl: string;
  rawContentHash: string;
};
export type ArtbookSource = {
  источник: {
    получено: string;
    атрибуция: string;
  };
  записи: ArtbookRecord[];
  картинкиБезТекста: string[];
};

/** Loaded on demand: only the GM import needs it. */
const loadArtbook = async () =>
  (await import("../../../docs/content/world-artbook.json"))
    .default as unknown as ArtbookSource;

/** Path of a picked file inside the chosen artbook folder, without the folder itself. */
export const artbookRelativePath = (file: File) =>
  (file.webkitRelativePath || file.name).split("/").slice(1).join("/") ||
  file.name;

async function uploadImage(file: File) {
  const form = new FormData();
  form.append("file", file);
  return api<AssetDto>("/api/assets?kind=IMAGE", {
    method: "POST",
    headers: { "x-action-id": crypto.randomUUID() },
    body: form,
  });
}

type Progress = {
  done: number;
  total: number;
  skipped: number;
  failed: number;
};

/**
 * GM-only import of the Arken Khar artbook into world canon. Step 1 creates
 * DRAFT entities with provenance (source URL, retrieval date, raw hash,
 * attribution, rights APPROVED by the owner, editorial PENDING) and skips
 * slugs that already exist — no source silently overwrites canon. Step 2 is
 * optional: pick the exported artbook folder and covers/galleries are
 * uploaded for imported entities that have no cover yet.
 */
export function WorldArtbookImport({ onChanged }: { onChanged: () => void }) {
  const [pending, setPending] = useState<"texts" | "images" | null>(null);
  const [progress, setProgress] = useState<Progress | null>(null);
  const [error, setError] = useState("");

  async function importTexts() {
    setPending("texts");
    setError("");
    try {
      const source = await loadArtbook();
      const existing = new Set(
        (await fetchWorldContentList()).map((item) => item.slug),
      );
      const state: Progress = {
        done: 0,
        total: source.записи.length,
        skipped: 0,
        failed: 0,
      };
      setProgress({ ...state });
      for (const record of source.записи) {
        if (existing.has(record.slug)) state.skipped += 1;
        else {
          try {
            await createWorldContent({
              slug: record.slug,
              type: record.type,
              name: record.name,
              summary: record.summary,
              provenance: {
                sourceUrl: record.sourceUrl,
                sourceExternalId: record.slug,
                retrievedAt: `${source.источник.получено}T00:00:00.000Z`,
                rawContentHash: record.rawContentHash,
                attribution: source.источник.атрибуция,
                rightsReviewStatus: "APPROVED",
                editorialApprovalStatus: "PENDING",
              },
            });
          } catch {
            state.failed += 1;
          }
        }
        state.done += 1;
        setProgress({ ...state });
      }
      onChanged();
    } catch (reason) {
      setError(formatApiError(reason, "Не удалось импортировать артбук."));
    } finally {
      setPending(null);
    }
  }

  async function importImages(files: FileList | null) {
    if (!files?.length) return;
    setPending("images");
    setError("");
    try {
      const source = await loadArtbook();
      const byPath = new Map(
        [...files].map((file) => [artbookRelativePath(file), file]),
      );
      const bySlug = new Map(
        (await fetchWorldContentList()).map((item) => [item.slug, item]),
      );
      const targets = source.записи.filter(
        (record) =>
          record.cover &&
          byPath.has(record.cover) &&
          bySlug.get(record.slug)?.coverAssetId === null,
      );
      const state: Progress = {
        done: 0,
        total: targets.length,
        skipped: 0,
        failed: 0,
      };
      setProgress({ ...state });
      for (const record of targets) {
        try {
          const entity = bySlug.get(record.slug)!;
          const cover = await uploadImage(byPath.get(record.cover!)!);
          await updateWorldContent(entity.id, {
            revision: entity.revision,
            coverAssetId: cover.id,
          });
          for (const path of record.gallery) {
            const file = byPath.get(path);
            if (!file) continue;
            const asset = await uploadImage(file);
            await addWorldContentMedia(entity.id, { assetId: asset.id });
          }
        } catch {
          state.failed += 1;
        }
        state.done += 1;
        setProgress({ ...state });
      }
      onChanged();
    } catch (reason) {
      setError(formatApiError(reason, "Не удалось загрузить картинки."));
    } finally {
      setPending(null);
    }
  }

  return (
    <section
      className="world-artbook-import"
      aria-label="Импорт артбука Аркен-Хара"
    >
      <h3>Артбук Аркен-Хара</h3>
      <p className="muted">
        Боги, локации, персонажи и существа из артбука. Каждая запись создаётся
        черновиком с источником; уже существующие пропускаются.
      </p>
      <Button disabled={pending !== null} onClick={() => void importTexts()}>
        {pending === "texts" ? "Импортируем…" : "1. Импортировать тексты"}
      </Button>
      <label className="world-artbook-import__folder">
        2. Картинки: выберите папку «Артбук»
        <input
          type="file"
          multiple
          accept="image/png,image/jpeg,image/webp"
          disabled={pending !== null}
          // Folder picking keeps the section subfolders in webkitRelativePath.
          {...{ webkitdirectory: "" }}
          onChange={(event) => {
            const picked = event.target.files;
            void importImages(picked);
            event.currentTarget.value = "";
          }}
        />
      </label>
      {progress && (
        <p role="status">
          {`Готово ${progress.done} из ${progress.total}; пропущено: ${progress.skipped}; ошибок: ${progress.failed}.`}
        </p>
      )}
      {error && (
        <p className="field-error" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}

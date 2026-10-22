import type { WorldContentType } from "@arken/contracts";

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
export const loadArtbook = async () =>
  (await import("../../../docs/content/world-artbook.json"))
    .default as unknown as ArtbookSource;

/** Path of a picked file inside the chosen artbook folder, without the folder itself. */
export const artbookRelativePath = (file: File) =>
  (file.webkitRelativePath || file.name).split("/").slice(1).join("/") ||
  file.name;

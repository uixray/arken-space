import type { WorldContentDto, WorldContentType } from "@arken/contracts";

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
  источник: { получено: string; атрибуция: string };
  записи: ArtbookRecord[];
  картинкиБезТекста: string[];
};

export type ArtbookTextPlanItem = {
  record: ArtbookRecord;
  sourceId: string;
  retrievedAt: string;
  attribution: string;
  status: "create" | "matched" | "conflict" | "blocked";
  reason?: string;
  targetIds?: string[];
};

export type ArtbookMediaProposal = {
  slug: string;
  path: string;
  role: "cover" | "gallery";
  exception: boolean;
};

/** Loaded on demand: only the GM import needs it. */
export const loadArtbook = async () =>
  (await import("../../../docs/content/world-artbook.json"))
    .default as unknown as ArtbookSource;

/** Path of a picked file inside the chosen artbook folder, without the folder itself. */
export const artbookRelativePath = (file: File) =>
  (file.webkitRelativePath || file.name).split("/").slice(1).join("/") ||
  file.name;

export const artbookProvenance = (
  source: ArtbookSource,
  record: ArtbookRecord,
) => ({
  sourceUrl: record.sourceUrl,
  sourceExternalId: record.slug,
  retrievedAt: `${source.источник.получено}T00:00:00.000Z`,
  rawContentHash: record.rawContentHash,
  attribution: source.источник.атрибуция,
  rightsReviewStatus: "APPROVED" as const,
  editorialApprovalStatus: "PENDING" as const,
});

export function planArtbookTextImport(
  source: ArtbookSource,
  existing: readonly WorldContentDto[],
): ArtbookTextPlanItem[] {
  const bySlug = new Map<string, WorldContentDto[]>();
  const bySource = new Map<string, WorldContentDto[]>();
  for (const entity of existing) {
    const matches = bySlug.get(entity.slug) ?? [];
    matches.push(entity);
    bySlug.set(entity.slug, matches);
    if (entity.provenance?.sourceUrl && entity.provenance.sourceExternalId) {
      const key = `${entity.provenance.sourceUrl}\n${entity.provenance.sourceExternalId}`;
      const sourceMatches = bySource.get(key) ?? [];
      sourceMatches.push(entity);
      bySource.set(key, sourceMatches);
    }
  }
  const incomingCounts = new Map<string, number>();
  const incomingSlugCounts = new Map<string, number>();
  for (const record of source.записи) {
    const key = `${record.sourceUrl}\n${record.slug}`;
    incomingCounts.set(key, (incomingCounts.get(key) ?? 0) + 1);
    incomingSlugCounts.set(
      record.slug,
      (incomingSlugCounts.get(record.slug) ?? 0) + 1,
    );
  }
  return source.записи.map((record) => {
    const retrievedAt = `${source.источник.получено}T00:00:00.000Z`;
    const sourceId = record.slug;
    const provenance = artbookProvenance(source, record);
    const sourceKey = `${record.sourceUrl}\n${record.slug}`;
    if (
      (incomingCounts.get(sourceKey) ?? 0) > 1 ||
      (incomingSlugCounts.get(record.slug) ?? 0) > 1
    )
      return {
        record,
        sourceId,
        retrievedAt,
        attribution: source.источник.атрибуция,
        status: "blocked",
        reason: "Повтор slug или source identity во входном источнике.",
      };
    const matches = bySlug.get(record.slug) ?? [];
    if (matches.length > 1)
      return {
        record,
        sourceId,
        retrievedAt,
        attribution: source.источник.атрибуция,
        status: "conflict",
        reason: "В каноне найдено несколько записей с этим slug.",
        targetIds: matches.map((entity) => entity.id),
      };
    const current = matches[0];
    const sourceMatches = bySource.get(sourceKey) ?? [];
    if (sourceMatches.length > 1)
      return {
        record,
        sourceId,
        retrievedAt,
        attribution: source.источник.атрибуция,
        status: "conflict",
        reason: "Несколько канонических записей имеют этот source identity.",
        targetIds: sourceMatches.map((entity) => entity.id),
      };
    if (sourceMatches.length === 1 && sourceMatches[0]!.slug !== record.slug)
      return {
        record,
        sourceId,
        retrievedAt,
        attribution: source.источник.атрибуция,
        status: "conflict",
        reason: `Источник уже привязан к slug ${sourceMatches[0]!.slug}; автоматическое переименование запрещено.`,
        targetIds: [sourceMatches[0]!.id],
      };
    if (!current && sourceMatches.length === 0)
      return {
        record,
        sourceId,
        retrievedAt,
        attribution: source.источник.атрибуция,
        status: "create",
      };
    if (sourceMatches.length === 1 && sourceMatches[0]!.id !== current!.id)
      return {
        record,
        sourceId,
        retrievedAt,
        attribution: source.источник.атрибуция,
        status: "conflict",
        reason:
          "Slug и source identity указывают на разные канонические записи.",
        targetIds: [current!.id, sourceMatches[0]!.id],
      };
    const exactProvenance =
      current!.provenance?.sourceUrl === provenance.sourceUrl &&
      current!.provenance?.sourceExternalId === provenance.sourceExternalId &&
      current!.provenance?.retrievedAt === provenance.retrievedAt &&
      current!.provenance?.rawContentHash === provenance.rawContentHash &&
      current!.provenance?.attribution === provenance.attribution &&
      current!.provenance?.rightsReviewStatus ===
        provenance.rightsReviewStatus &&
      current!.provenance?.editorialApprovalStatus ===
        provenance.editorialApprovalStatus;
    const exactContent =
      current!.type === record.type &&
      current!.name === record.name &&
      current!.summary === record.summary;
    if (exactProvenance && exactContent && current!.lifecycle === "DRAFT")
      return {
        record,
        sourceId,
        retrievedAt,
        attribution: source.источник.атрибуция,
        status: "matched",
      };
    const reason =
      current!.lifecycle !== "DRAFT"
        ? `Запись имеет статус ${current!.lifecycle}; импорт не изменяет её.`
        : !exactProvenance
          ? "Источник или provenance отличаются; требуется ручная сверка."
          : "Текст канона отличается от текста источника; импорт не перезаписывает его.";
    return {
      record,
      sourceId,
      retrievedAt,
      attribution: source.источник.атрибуция,
      status: "conflict",
      reason,
    };
  });
}

const curatedExceptions = new Set(["Локации/Темная башня.png"]);

export function proposeArtbookMedia(
  source: ArtbookSource,
): ArtbookMediaProposal[] {
  return source.записи.flatMap((record) => [
    ...(record.cover
      ? [
          {
            slug: record.slug,
            path: record.cover,
            role: "cover" as const,
            exception: curatedExceptions.has(record.cover),
          },
        ]
      : []),
    ...record.gallery.map((path) => ({
      slug: record.slug,
      path,
      role: "gallery" as const,
      exception: curatedExceptions.has(path),
    })),
  ]);
}

/** Deterministic UUIDv8 custom id: bytes are SHA-256-bound, never filename-only. */
export async function artbookActionId(input: {
  campaignId: string;
  sourceUrl: string;
  sourceId: string;
  relativePath: string;
  binarySha256: string;
  operation: "upload" | "cover" | "gallery" | "text";
  entityId?: string;
  assetId?: string;
}) {
  const identity = JSON.stringify([
    "arken-artbook-import-v1",
    input.operation,
    input.campaignId,
    input.sourceUrl,
    input.sourceId,
    input.relativePath,
    input.binarySha256,
    input.entityId ?? null,
    input.assetId ?? null,
  ]);
  const digest = new Uint8Array(
    await crypto.subtle.digest("SHA-256", new TextEncoder().encode(identity)),
  );
  const bytes = digest.slice(0, 16);
  bytes[6] = (bytes[6]! & 0x0f) | 0x80;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  const hex = [...bytes]
    .map((part) => part.toString(16).padStart(2, "0"))
    .join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export async function artbookFileSha256(file: File) {
  const bytes = await file.arrayBuffer();
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
  return [...digest].map((part) => part.toString(16).padStart(2, "0")).join("");
}

export type ArtbookImageInspection =
  | {
      status: "valid";
      mimeType: "image/png" | "image/jpeg" | "image/webp";
      sha256: string;
    }
  | { status: "blocked"; reason: string };

const MAX_ARTBOOK_IMAGE_BYTES = 20 * 1024 * 1024;
const ARTBOOK_IMAGE_MIME = new Set(["image/png", "image/jpeg", "image/webp"]);

function detectedArtbookImageMime(
  bytes: Uint8Array,
): "image/png" | "image/jpeg" | "image/webp" | undefined {
  const ascii = (start: number, value: string) =>
    [...value].every(
      (char, index) => bytes[start + index] === char.charCodeAt(0),
    );
  const uint32le = (offset: number) =>
    (bytes[offset]! |
      (bytes[offset + 1]! << 8) |
      (bytes[offset + 2]! << 16) |
      (bytes[offset + 3]! << 24)) >>>
    0;
  const uint32be = (offset: number) =>
    ((bytes[offset]! << 24) |
      (bytes[offset + 1]! << 16) |
      (bytes[offset + 2]! << 8) |
      bytes[offset + 3]!) >>>
    0;
  const crc32 = (data: Uint8Array) => {
    let crc = 0xffffffff;
    for (const byte of data) {
      crc ^= byte;
      for (let bit = 0; bit < 8; bit++)
        crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
    }
    return (crc ^ 0xffffffff) >>> 0;
  };
  const validPngDepth = (depth: number, color: number) => {
    const allowed: Record<number, number[]> = {
      0: [1, 2, 4, 8, 16],
      2: [8, 16],
      3: [1, 2, 4, 8],
      4: [8, 16],
      6: [8, 16],
    };
    return allowed[color]?.includes(depth) ?? false;
  };

  if (
    bytes.length >= 33 &&
    [137, 80, 78, 71, 13, 10, 26, 10].every(
      (value, index) => bytes[index] === value,
    ) &&
    uint32be(8) === 13 &&
    ascii(12, "IHDR") &&
    uint32be(16) > 0 &&
    uint32be(20) > 0 &&
    validPngDepth(bytes[24]!, bytes[25]!) &&
    bytes[26] === 0 &&
    bytes[27] === 0 &&
    (bytes[28] === 0 || bytes[28] === 1) &&
    crc32(bytes.slice(12, 29)) === uint32be(29)
  ) {
    let offset = 8;
    let foundData = false;
    let foundEnd = false;
    while (offset + 12 <= bytes.length) {
      const length = uint32be(offset);
      const end = offset + 12 + length;
      if (end > bytes.length) break;
      const type = String.fromCharCode(...bytes.slice(offset + 4, offset + 8));
      if (
        crc32(bytes.slice(offset + 4, offset + 8 + length)) !==
        uint32be(offset + 8 + length)
      )
        break;
      if (offset === 8 && type !== "IHDR") break;
      if (type === "IDAT" && length > 0) foundData = true;
      if (type === "IEND") {
        foundEnd = length === 0 && end === bytes.length;
        break;
      }
      offset = end;
    }
    if (foundData && foundEnd) return "image/png";
  }

  if (bytes.length >= 12 && bytes[0] === 0xff && bytes[1] === 0xd8) {
    let offset = 2;
    let frame = false;
    while (offset + 4 <= bytes.length) {
      if (bytes[offset] !== 0xff) break;
      while (bytes[offset] === 0xff) offset++;
      const marker = bytes[offset++]!;
      if (marker === 0xd9) return undefined;
      if (marker === 0xda) {
        // A complete scan must terminate in EOI; the server still performs full decode.
        const scanLength =
          offset + 2 <= bytes.length
            ? (bytes[offset]! << 8) | bytes[offset + 1]!
            : 0;
        return frame &&
          scanLength >= 6 &&
          offset + scanLength <= bytes.length - 2 &&
          bytes[bytes.length - 2] === 0xff &&
          bytes[bytes.length - 1] === 0xd9
          ? "image/jpeg"
          : undefined;
      }
      if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) continue;
      if (offset + 2 > bytes.length) break;
      const length = (bytes[offset]! << 8) | bytes[offset + 1]!;
      if (length < 2 || offset + length > bytes.length) break;
      if (
        [
          0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd,
          0xce, 0xcf,
        ].includes(marker)
      ) {
        frame =
          length >= 8 &&
          ((bytes[offset + 3]! << 8) | bytes[offset + 4]!) > 0 &&
          ((bytes[offset + 5]! << 8) | bytes[offset + 6]!) > 0;
      }
      offset += length;
    }
  }

  if (
    bytes.length >= 30 &&
    ascii(0, "RIFF") &&
    uint32le(4) === bytes.length - 8 &&
    ascii(8, "WEBP")
  ) {
    const validImageChunk = (type: string, start: number, size: number) => {
      if (type === "VP8 ")
        return (
          size >= 10 &&
          bytes[start + 3] === 0x9d &&
          bytes[start + 4] === 0x01 &&
          bytes[start + 5] === 0x2a
        );
      return type === "VP8L" && size >= 5 && bytes[start] === 0x2f;
    };
    const hasFrameImage = (start: number, size: number) => {
      if (size < 16) return false;
      const frameEnd = start + size;
      let frameOffset = start + 16;
      let found = false;
      while (frameOffset + 8 <= frameEnd) {
        const type = String.fromCharCode(
          bytes[frameOffset]!,
          bytes[frameOffset + 1]!,
          bytes[frameOffset + 2]!,
          bytes[frameOffset + 3]!,
        );
        const chunkSize = uint32le(frameOffset + 4);
        const dataStart = frameOffset + 8;
        const paddedSize = chunkSize + (chunkSize % 2);
        if (dataStart + paddedSize > frameEnd) return false;
        if (validImageChunk(type, dataStart, chunkSize)) found = true;
        frameOffset = dataStart + paddedSize;
      }
      return found && frameOffset === frameEnd;
    };
    let offset = 12;
    let foundImageChunk = false;
    let hasExtendedHeader = false;
    let isAnimated = false;
    let hasAnimationControl = false;
    let hasAnimationFrame = false;
    while (offset + 8 <= bytes.length) {
      const chunkType = String.fromCharCode(
        bytes[offset]!,
        bytes[offset + 1]!,
        bytes[offset + 2]!,
        bytes[offset + 3]!,
      );
      const chunkSize = uint32le(offset + 4);
      const dataStart = offset + 8;
      const paddedSize = chunkSize + (chunkSize % 2);
      if (dataStart + paddedSize > bytes.length) break;
      if (validImageChunk(chunkType, dataStart, chunkSize))
        foundImageChunk = true;
      if (chunkType === "VP8X") {
        if (chunkSize !== 10 || hasExtendedHeader || offset !== 12) break;
        hasExtendedHeader = true;
        isAnimated = (bytes[dataStart]! & 0x02) !== 0;
      }
      if (chunkType === "ANIM") {
        if (chunkSize !== 6 || hasAnimationControl) break;
        hasAnimationControl = true;
      }
      if (chunkType === "ANMF") {
        if (
          !isAnimated ||
          !hasAnimationControl ||
          !hasFrameImage(dataStart, chunkSize)
        )
          break;
        hasAnimationFrame = true;
      }
      offset = dataStart + paddedSize;
    }
    const validAnimation =
      isAnimated && hasAnimationControl && hasAnimationFrame;
    const validStill =
      !isAnimated &&
      foundImageChunk &&
      !hasAnimationControl &&
      !hasAnimationFrame;
    if (offset === bytes.length && (validStill || validAnimation))
      return "image/webp";
  }
  return undefined;
}

/** Conservative importer-only signature/structure check; server decode remains authoritative. */
export async function inspectArtbookImage(
  file: File,
): Promise<ArtbookImageInspection> {
  if (file.size === 0) return { status: "blocked", reason: "Файл пустой." };
  if (file.size > MAX_ARTBOOK_IMAGE_BYTES)
    return { status: "blocked", reason: "Файл превышает лимит 20 МиБ." };
  let originalBuffer: ArrayBuffer;
  let bytes: Uint8Array<ArrayBuffer>;
  try {
    originalBuffer = await file.arrayBuffer();
    bytes = new Uint8Array(originalBuffer);
  } catch {
    return { status: "blocked", reason: "Не удалось прочитать файл." };
  }
  if (bytes.length !== file.size)
    return {
      status: "blocked",
      reason: "Прочитанный размер не совпадает с размером файла.",
    };
  if (bytes.length === 0) return { status: "blocked", reason: "Файл пустой." };
  if (bytes.length > MAX_ARTBOOK_IMAGE_BYTES)
    return { status: "blocked", reason: "Файл превышает лимит 20 МиБ." };
  const mimeType = detectedArtbookImageMime(bytes);
  if (!mimeType)
    return {
      status: "blocked",
      reason:
        "Содержимое не является поддерживаемым изображением PNG, JPEG или WebP.",
    };
  if (
    file.type &&
    (!ARTBOOK_IMAGE_MIME.has(file.type) || file.type !== mimeType)
  ) {
    return {
      status: "blocked",
      reason: "Заявленный MIME-тип не совпадает с содержимым файла.",
    };
  }
  if (typeof createImageBitmap === "function") {
    let bitmap: ImageBitmap | undefined;
    try {
      bitmap = await createImageBitmap(file.slice(0, file.size, mimeType));
      if (bitmap.width < 1 || bitmap.height < 1)
        return { status: "blocked", reason: "Изображение не декодируется." };
    } catch {
      return { status: "blocked", reason: "Изображение не декодируется." };
    } finally {
      bitmap?.close();
    }
  }
  const digest = new Uint8Array(
    await crypto.subtle.digest("SHA-256", originalBuffer),
  );
  return {
    status: "valid",
    mimeType,
    sha256: [...digest]
      .map((part) => part.toString(16).padStart(2, "0"))
      .join(""),
  };
}

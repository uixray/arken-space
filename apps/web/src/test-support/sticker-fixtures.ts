import type { StickerPackDto } from "@arken/contracts";

/** Synthetic authorized catalog; no user artwork or campaign metadata. */
export function stickerPack(count = 1): StickerPackDto {
  const packId = "10000000-0000-4000-8000-000000000000";
  return {
    id: packId,
    name: "Проверка стикеров",
    subject: "COMMON",
    subjectCharacterId: null,
    subjectMembershipId: null,
    subjectLabel: "Общие",
    lifecycle: "ACTIVE",
    canSend: true,
    stickers: Array.from({ length: count }, (_, index) => ({
      id: `10000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`,
      packId,
      name: `Стикер ${index + 1}`,
      altText: `Стикер ${index + 1}`,
      url: `/api/stickers/fixture-${index + 1}/content`,
      width: 128,
      height: 128,
      attribution: { authorCredit: null, licenseNote: null },
    })),
  };
}

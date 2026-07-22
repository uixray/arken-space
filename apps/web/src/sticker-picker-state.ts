import type { StickerPackDto, StickerPackSubject } from "@arken/contracts";

export type StickerPickerCategory = StickerPackSubject | "COMMON";

export function filterStickerPacks(
  packs: readonly StickerPackDto[],
  category: StickerPickerCategory,
  query: string,
) {
  const needle = query.trim().toLocaleLowerCase("ru");
  return packs
    .filter(
      (pack) =>
        pack.canSend && (category === "COMMON" || pack.subject === category),
    )
    .flatMap((pack) => pack.stickers.map((sticker) => ({ pack, sticker })))
    .filter(({ pack, sticker }) =>
      [pack.name, pack.subjectLabel, sticker.name, sticker.altText]
        .filter(Boolean)
        .some((value) => value!.toLocaleLowerCase("ru").includes(needle)),
    );
}

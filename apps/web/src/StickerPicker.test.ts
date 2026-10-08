import { describe, expect, it } from "vitest";
import type { StickerPackDto } from "@arken/contracts";
import { filterStickerPacks } from "./sticker-picker-state";

const pack = (
  subject: StickerPackDto["subject"],
  canSend = true,
): StickerPackDto => ({
  id: `${subject}-pack`,
  name: "Arken heroes",
  subject,
  subjectCharacterId: null,
  subjectMembershipId: null,
  subjectLabel: "Lyra",
  lifecycle: "ACTIVE",
  canSend,
  stickers: [
    {
      id: `${subject}-sticker`,
      packId: `${subject}-pack`,
      name: "Greeting",
      altText: "Lyra waves hello",
      url: `/api/stickers/${subject}/content`,
      width: 128,
      height: 128,
      attribution: { authorCredit: null, licenseNote: null },
    },
  ],
});

describe("filterStickerPacks", () => {
  it("never exposes non-sendable or another category", () => {
    const result = filterStickerPacks(
      [pack("CHARACTER"), pack("PLAYER"), pack("NPC", false)],
      "PLAYER",
      "",
    );
    expect(result.map(({ sticker }) => sticker.id)).toEqual(["PLAYER-sticker"]);
  });
  it("searches authorized metadata case-insensitively", () => {
    const packs = [pack("CHARACTER")];
    expect(filterStickerPacks(packs, "CHARACTER", "Lyra")).toHaveLength(1);
    expect(filterStickerPacks(packs, "CHARACTER", "WAVES")).toHaveLength(1);
    expect(filterStickerPacks(packs, "CHARACTER", "missing")).toEqual([]);
    expect(filterStickerPacks(packs, "CHARACTER", "Greeting")).toEqual([]);
  });
  it("treats public global packs as COMMON, not as campaign character packs", () => {
    const global = {
      ...pack("CHARACTER"),
      id: "global-pack",
      scope: "GLOBAL_PUBLIC" as const,
      subject: "COMMON" as const,
    };
    expect(filterStickerPacks([global], "COMMON", "")).toHaveLength(1);
    expect(filterStickerPacks([global], "CHARACTER", "")).toEqual([]);
  });
});

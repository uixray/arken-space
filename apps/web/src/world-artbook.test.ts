import { describe, expect, it, vi } from "vitest";
import { actionIdSchema, type WorldContentDto } from "@arken/contracts";
import {
  artbookActionId,
  artbookFileSha256,
  inspectArtbookImage,
  artbookProvenance,
  loadArtbook,
  planArtbookTextImport,
  proposeArtbookMedia,
} from "./world-artbook";
import { artbookImageFixtureBytes } from "./artbook-image-test-fixtures";

describe("world artbook review planner", () => {
  it("uses the stable base PNG when no variant is requested", async () => {
    const base = artbookImageFixtureBytes.png();
    expect(base).toEqual(artbookImageFixtureBytes.png(0));
    expect(base).not.toEqual(artbookImageFixtureBytes.png(1));
    expect(await artbookFileSha256(new File([base], "base.png"))).not.toBe(
      await artbookFileSha256(
        new File([artbookImageFixtureBytes.png(1)], "variant.png"),
      ),
    );
  });

  it("inspects real PNG, JPEG and WebP bytes with blank or matching MIME and hashes the original bytes", async () => {
    for (const [mimeType, bytes] of [
      ["image/png", artbookImageFixtureBytes.png()],
      ["image/png", artbookImageFixtureBytes.interlacedPng()],
      ["image/jpeg", artbookImageFixtureBytes.jpeg()],
      ["image/webp", artbookImageFixtureBytes.webp()],
      ["image/webp", artbookImageFixtureBytes.animatedWebp()],
    ] as const) {
      for (const declaredType of ["", mimeType]) {
        const file = new File([bytes], `image.${mimeType.split("/")[1]}`, {
          type: declaredType,
        });
        const result = await inspectArtbookImage(file);
        expect(result).toMatchObject({ status: "valid", mimeType });
        if (result.status === "valid")
          expect(result.sha256).toBe(await artbookFileSha256(file));
      }
    }
  });

  it("rejects mismatched, spoofed, truncated, empty and over-limit images before allowing an identity", async () => {
    const cases = [
      new File([artbookImageFixtureBytes.png()], "fake.jpg", {
        type: "image/jpeg",
      }),
      new File(
        [
          (() => {
            const bytes = artbookImageFixtureBytes.png().slice();
            bytes[29] = bytes[29]! ^ 1;
            return bytes;
          })(),
        ],
        "bad-crc.png",
        { type: "" },
      ),
      new File([new TextEncoder().encode("<svg></svg>")], "photo.png", {
        type: "image/png",
      }),
      new File([new TextEncoder().encode("GIF89a")], "photo.gif", { type: "" }),
      new File([new TextEncoder().encode("%PDF-1.7")], "photo.pdf", {
        type: "",
      }),
      new File([new TextEncoder().encode("<!doctype html>")], "photo.png", {
        type: "",
      }),
      new File([artbookImageFixtureBytes.png().slice(0, 24)], "cut.png", {
        type: "",
      }),
      new File([artbookImageFixtureBytes.jpeg().slice(0, 24)], "cut.jpg", {
        type: "",
      }),
      new File([artbookImageFixtureBytes.webp().slice(0, 24)], "cut.webp", {
        type: "",
      }),
      new File(
        [
          (() => {
            const bytes = artbookImageFixtureBytes.jpeg().slice();
            bytes[bytes.length - 1] = 0;
            return bytes;
          })(),
        ],
        "bad-scan.jpg",
        { type: "" },
      ),
      new File(
        [artbookImageFixtureBytes.jpegWithInvalidFrame()],
        "bad-frame.jpg",
        { type: "" },
      ),
      new File(
        [
          (() => {
            const bytes = artbookImageFixtureBytes.webp().slice();
            new DataView(bytes.buffer).setUint32(16, 0xffffffff, true);
            return bytes;
          })(),
        ],
        "bad-riff.webp",
        { type: "" },
      ),
      new File(
        [
          (() => {
            const bytes = artbookImageFixtureBytes.webp().slice();
            new DataView(bytes.buffer).setUint32(4, bytes.length - 9, true);
            return bytes;
          })(),
        ],
        "bad-riff-length.webp",
        { type: "" },
      ),
      new File(
        [artbookImageFixtureBytes.pngWithInvalidInterlaceMethod()],
        "invalid-interlace.png",
        { type: "" },
      ),
      new File([artbookImageFixtureBytes.png()], "declared-unsupported.png", {
        type: "image/gif",
      }),
      new File([new TextEncoder().encode("not an image")], "fake.jpg", {
        type: "",
      }),
      new File([], "empty.png", { type: "image/png" }),
      new File([new Uint8Array(20 * 1024 * 1024 + 1)], "large.png", {
        type: "image/png",
      }),
    ];
    for (const file of cases)
      expect((await inspectArtbookImage(file)).status).toBe("blocked");
    const oversizedRead = vi.spyOn(File.prototype, "arrayBuffer");
    try {
      await inspectArtbookImage(
        cases.find((file) => file.name === "empty.png")!,
      );
      await inspectArtbookImage(cases.at(-1)!);
      expect(oversizedRead).not.toHaveBeenCalled();
    } finally {
      oversizedRead.mockRestore();
    }
    const readFailure = vi
      .spyOn(File.prototype, "arrayBuffer")
      .mockRejectedValueOnce(new Error("read failed"));
    try {
      expect(
        await inspectArtbookImage(
          new File([artbookImageFixtureBytes.png()], "read.png"),
        ),
      ).toMatchObject({
        status: "blocked",
        reason: "Не удалось прочитать файл.",
      });
    } finally {
      readFailure.mockRestore();
    }
    const shortRead = vi
      .spyOn(File.prototype, "arrayBuffer")
      .mockResolvedValueOnce(
        artbookImageFixtureBytes.png().slice(0, 32).buffer,
      );
    try {
      expect(
        await inspectArtbookImage(
          new File([artbookImageFixtureBytes.png()], "short-read.png"),
        ),
      ).toMatchObject({
        status: "blocked",
        reason: "Прочитанный размер не совпадает с размером файла.",
      });
    } finally {
      shortRead.mockRestore();
    }
  });

  it("accepts exactly the 20 MiB importer limit", async () => {
    const exactLimit = 20 * 1024 * 1024;
    const file = new File(
      [artbookImageFixtureBytes.pngAtExactSize(exactLimit)],
      "exact-limit.png",
      { type: "image/png" },
    );
    expect(file.size).toBe(exactLimit);
    expect(await inspectArtbookImage(file)).toMatchObject({
      status: "valid",
      mimeType: "image/png",
    });
  });

  it("uses native image decode when available and closes every created bitmap", async () => {
    const close = vi.fn();
    const decode = vi.fn(async (blob: Blob) => {
      expect(blob.type).toBe("image/png");
      return { width: 1, height: 1, close } as ImageBitmap;
    });
    vi.stubGlobal("createImageBitmap", decode);
    try {
      expect(
        await inspectArtbookImage(
          new File([artbookImageFixtureBytes.png()], "valid.png"),
        ),
      ).toMatchObject({ status: "valid", mimeType: "image/png" });
      expect(decode).toHaveBeenCalledTimes(1);
      expect(close).toHaveBeenCalledTimes(1);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("blocks decoder rejection and zero dimensions, closes obtained bitmaps, and falls back only when decoder is absent", async () => {
    const rejected = vi.fn().mockRejectedValue(new Error("decode failed"));
    vi.stubGlobal("createImageBitmap", rejected);
    try {
      expect(
        await inspectArtbookImage(
          new File([artbookImageFixtureBytes.png()], "invalid.png"),
        ),
      ).toMatchObject({
        status: "blocked",
        reason: "Изображение не декодируется.",
      });
    } finally {
      vi.unstubAllGlobals();
    }

    const close = vi.fn();
    vi.stubGlobal(
      "createImageBitmap",
      vi.fn(async () => ({ width: 0, height: 1, close }) as ImageBitmap),
    );
    try {
      expect(
        await inspectArtbookImage(
          new File([artbookImageFixtureBytes.png()], "zero.png"),
        ),
      ).toMatchObject({
        status: "blocked",
        reason: "Изображение не декодируется.",
      });
      expect(close).toHaveBeenCalledTimes(1);
    } finally {
      vi.unstubAllGlobals();
    }

    vi.stubGlobal("createImageBitmap", undefined);
    try {
      expect(
        await inspectArtbookImage(
          new File([artbookImageFixtureBytes.png()], "fallback.png"),
        ),
      ).toMatchObject({ status: "valid", mimeType: "image/png" });
    } finally {
      vi.unstubAllGlobals();
    }
  });
  it("blocks duplicate incoming slugs even when source URLs differ", async () => {
    const source = await loadArtbook();
    const record = source.записи[0]!;
    const second = { ...record, sourceUrl: `${record.sourceUrl}?duplicate=1` };
    const plan = planArtbookTextImport(
      { ...source, записи: [record, second] },
      [],
    );
    expect(plan.map((item) => item.status)).toEqual(["blocked", "blocked"]);
  });

  it("classifies every bundled record and distinguishes exact matches from source/text conflicts", async () => {
    const source = await loadArtbook();
    const [record] = source.записи;
    expect(source.записи).toHaveLength(78);
    const matching = {
      id: crypto.randomUUID(),
      slug: record!.slug,
      type: record!.type,
      name: record!.name,
      summary: record!.summary,
      lifecycle: "DRAFT",
      provenance: artbookProvenance(source, record!),
    } as WorldContentDto;
    const differentSource = {
      ...matching,
      provenance: { ...matching.provenance!, sourceExternalId: "foreign-id" },
    } as WorldContentDto;
    const differentText = {
      ...matching,
      summary: "edited text",
    } as WorldContentDto;
    const archived = { ...matching, lifecycle: "ARCHIVED" } as WorldContentDto;
    const plan = planArtbookTextImport(source, [matching]);
    expect(plan).toHaveLength(78);
    expect(plan[0]).toMatchObject({
      status: "matched",
      record: { slug: record!.slug },
    });
    expect(plan[1]?.status).toBe("create");
    expect(plan.slice(1).every((item) => item.status === "create")).toBe(true);
    expect(planArtbookTextImport(source, [differentSource])[0]?.status).toBe(
      "conflict",
    );
    expect(planArtbookTextImport(source, [differentText])[0]?.status).toBe(
      "conflict",
    );
    expect(planArtbookTextImport(source, [archived])[0]?.status).toBe(
      "conflict",
    );

    const duplicate = planArtbookTextImport(
      { ...source, записи: [record!, record!] },
      [],
    );
    expect(duplicate.map((item) => item.status)).toEqual([
      "blocked",
      "blocked",
    ]);

    const renamed = {
      ...matching,
      id: crypto.randomUUID(),
      slug: "renamed-canon",
    };
    expect(planArtbookTextImport(source, [renamed])[0]).toMatchObject({
      status: "conflict",
      targetIds: [renamed.id],
    });
    const duplicateIdentity = { ...renamed, id: crypto.randomUUID() };
    expect(
      planArtbookTextImport(source, [renamed, duplicateIdentity])[0],
    ).toMatchObject({
      status: "conflict",
      targetIds: [renamed.id, duplicateIdentity.id],
    });
    expect(planArtbookTextImport(source, [differentSource])[0]?.status).toBe(
      "conflict",
    );
  });

  it("uses only exact paths, shows curated exception, and keeps image-only files inventoried", async () => {
    const source = await loadArtbook();
    const proposals = proposeArtbookMedia(source);
    expect(
      proposals.some(
        (item) => item.exception && item.path.includes("Темная башня"),
      ),
    ).toBe(true);
    expect(source.картинкиБезТекста).toHaveLength(7);
    expect(
      proposals.some(
        (item) =>
          item.path === "Пантеон/Яро.png" && item.slug === "artbook-yaro",
      ),
    ).toBe(true);
    const paths = proposals.map((item) => item.path);
    expect(
      paths.filter((path) => path === "Персонажи/Рейн Фаркрат-младший.png"),
    ).toHaveLength(2);
  });

  it("creates a deterministic valid UUID bound to campaign/source/path/bytes and never mutates input bytes", async () => {
    const bytes = artbookImageFixtureBytes.png();
    const file = new File([bytes], "same-name.png", { type: "image/png" });
    const before = [...new Uint8Array(await file.arrayBuffer())];
    const changedFile = new File(
      [artbookImageFixtureBytes.png(1)],
      "same-name.png",
      { type: "image/png" },
    );
    const changedBytesHash = await artbookFileSha256(changedFile);
    expect(changedBytesHash).not.toBe(await artbookFileSha256(file));
    const base = {
      campaignId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      sourceUrl: "https://arc.framer.photos/#x",
      sourceId: "artbook-x",
      relativePath: "Раздел/same-name.png",
      binarySha256: await artbookFileSha256(file),
      operation: "upload" as const,
    };
    const first = await artbookActionId(base);
    expect(actionIdSchema.safeParse(first).success).toBe(true);
    expect(first).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-8[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
    expect(await artbookActionId(base)).toBe(first);
    expect(
      await artbookActionId({ ...base, campaignId: crypto.randomUUID() }),
    ).not.toBe(first);
    expect(
      await artbookActionId({ ...base, relativePath: "Other/same-name.png" }),
    ).not.toBe(first);
    expect(
      await artbookActionId({ ...base, binarySha256: changedBytesHash }),
    ).not.toBe(first);
    const target = {
      ...base,
      operation: "gallery" as const,
      entityId: crypto.randomUUID(),
      assetId: crypto.randomUUID(),
    };
    const targetActionId = await artbookActionId(target);
    expect(await artbookActionId(target)).toBe(targetActionId);
    expect(
      await artbookActionId({ ...target, entityId: crypto.randomUUID() }),
    ).not.toBe(targetActionId);
    expect(
      await artbookActionId({ ...target, assetId: crypto.randomUUID() }),
    ).not.toBe(targetActionId);
    expect([...new Uint8Array(await file.arrayBuffer())]).toEqual(before);
  });
});

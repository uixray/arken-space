import { describe, expect, it } from "vitest";
import { loadStampCatalog } from "./terrain-stamp-routes.js";

const stamps = [{ key: "forest", title: "Лес", file: "forest.png" }];

describe("terrain stamp catalog (UIX-706)", () => {
  it("ships the built-in manifest with stamps and an optional textures list", () => {
    const catalog = loadStampCatalog();
    expect([...catalog.stamps.keys()]).toEqual(
      expect.arrayContaining(["forest", "mountains", "clouds"]),
    );
    expect(catalog.textures).toBeInstanceOf(Map);
  });

  it("reads tileable textures as data in their own key space", () => {
    const catalog = loadStampCatalog({
      packId: "builtin-terrain-v1",
      stamps,
      textures: [
        { key: "forest", title: "Лесная подстилка", file: "forest-floor.webp" },
      ],
    });
    expect(catalog.textures.get("forest")).toMatchObject({
      title: "Лесная подстилка",
      contentType: "image/webp",
    });
    expect(catalog.stamps.get("forest")?.title).toBe("Лес");
  });

  it("rejects duplicate keys and path-like file names", () => {
    const texture = { key: "soil", title: "Почва", file: "soil.png" };
    expect(() =>
      loadStampCatalog({
        packId: "builtin-terrain-v1",
        stamps,
        textures: [texture, texture],
      }),
    ).toThrow(/Duplicate texture key/);
    expect(() =>
      loadStampCatalog({
        packId: "builtin-terrain-v1",
        stamps,
        textures: [{ ...texture, file: "../soil.png" }],
      }),
    ).toThrow();
  });
});

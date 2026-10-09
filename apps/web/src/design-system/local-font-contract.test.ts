import { readFile } from "node:fs/promises";
import { inflateSync } from "node:zlib";
import { describe, expect, it } from "vitest";

const repoFile = (path: string) =>
  new URL(`../../../../${path}`, import.meta.url);

async function readWoffTable(tag: string) {
  const bytes = await readFile(
    repoFile("apps/web/public/assets/pragmatica-next_vf.woff"),
  );
  expect(bytes.toString("ascii", 0, 4)).toBe("wOFF");
  const tableCount = bytes.readUInt16BE(12);
  for (let index = 0; index < tableCount; index += 1) {
    const record = 44 + index * 20;
    if (bytes.toString("ascii", record, record + 4) !== tag) continue;
    const offset = bytes.readUInt32BE(record + 4);
    const compressedLength = bytes.readUInt32BE(record + 8);
    const originalLength = bytes.readUInt32BE(record + 12);
    const data = bytes.subarray(offset, offset + compressedLength);
    return compressedLength === originalLength ? data : inflateSync(data);
  }
  throw new Error(`WOFF table ${tag} not found`);
}

describe("local Pragmatica Next font contract", () => {
  it("keeps token source, generated CSS, and font asset aligned", async () => {
    const source = JSON.parse(
      await readFile(repoFile("tokens/typography.tokens.json"), "utf8"),
    );
    const generated = await readFile(
      repoFile("apps/web/src/design-system/tokens.generated.css"),
      "utf8",
    );
    expect(source.font.family.sans.$value[0]).toBe("Pragmatica Next");
    expect(generated).toMatch(/--font-family-sans:\s*"Pragmatica Next"/);
  });

  it("declares the actual variable-font axes instead of synthesizing weights", async () => {
    const fvar = await readWoffTable("fvar");
    const axesOffset = fvar.readUInt16BE(4);
    const axisSize = fvar.readUInt16BE(10);
    const axisCount = fvar.readUInt16BE(8);
    const axes = new Map<string, [number, number, number]>();
    for (let index = 0; index < axisCount; index += 1) {
      const offset = axesOffset + index * axisSize;
      axes.set(fvar.toString("ascii", offset, offset + 4), [
        fvar.readInt32BE(offset + 4) / 65536,
        fvar.readInt32BE(offset + 8) / 65536,
        fvar.readInt32BE(offset + 12) / 65536,
      ]);
    }
    expect(axes.get("wght")).toEqual([100, 400, 900]);
    expect(axes.get("wdth")).toEqual([10, 100, 400]);
  });

  it("uses the local font for app and Gravity typography without Google imports", async () => {
    const [entry, styles, gravity] = await Promise.all(
      [
        "apps/web/src/main.tsx",
        "apps/web/src/styles.css",
        "apps/web/src/ui/gravity-foundation.css",
      ].map((path) => readFile(repoFile(path), "utf8")),
    );
    expect(entry).not.toContain("@gravity-ui/uikit/styles/fonts.css");
    expect(styles).toMatch(
      /src:\s*url\("\/assets\/pragmatica-next_vf\.woff"\)/,
    );
    expect(styles).toContain(".g-root {");
    expect(styles).toContain(
      "--g-text-body-font-family: var(--font-family-sans)",
    );
    expect(gravity).toContain(
      "--arken-font-sans: var(--font-family-sans, system-ui, sans-serif)",
    );
  });
});

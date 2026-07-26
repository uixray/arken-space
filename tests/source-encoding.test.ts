import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const windows1251 = new TextDecoder("windows-1251");
const russianAlphabet = [
  ...Array.from({ length: 32 }, (_, index) =>
    String.fromCodePoint(0x410 + index),
  ),
  String.fromCodePoint(0x401),
  ...Array.from({ length: 32 }, (_, index) =>
    String.fromCodePoint(0x430 + index),
  ),
  String.fromCodePoint(0x451),
];

function decodeWindows1251Byte(byte: number): string {
  return byte === 0x98
    ? String.fromCodePoint(byte)
    : windows1251.decode(Uint8Array.of(byte));
}

const mojibakeFragments = russianAlphabet.map((letter) =>
  [...Buffer.from(letter, "utf8")].map(decodeWindows1251Byte).join(""),
);

describe("web source encoding", () => {
  it("contains no Windows-1251 mojibake fragments in UTF-8 source", () => {
    const root = path.join(process.cwd(), "apps", "web", "src");
    const files = [
      path.join(root, "App.tsx"),
      path.join(root, "renderers", "Orthographic2DRenderer.tsx"),
    ];
    const findings = files.flatMap((file) => {
      const source = readFileSync(file, "utf8");
      return mojibakeFragments
        .filter((fragment) => source.includes(fragment))
        .map(
          (fragment) =>
            `${path.relative(process.cwd(), file)}: ${JSON.stringify(fragment)}`,
        );
    });

    expect(findings).toEqual([]);
  });

  it("keeps the workspace heading readable", () => {
    const expected = [
      0x420, 0x430, 0x431, 0x43e, 0x447, 0x435, 0x435, 0x20, 0x43f, 0x440,
      0x43e, 0x441, 0x442, 0x440, 0x430, 0x43d, 0x441, 0x442, 0x432, 0x43e,
    ]
      .map((codePoint) => String.fromCodePoint(codePoint))
      .join("");
    const source = readFileSync(
      path.join(process.cwd(), "apps", "web", "src", "App.tsx"),
      "utf8",
    );
    expect(source).toContain(expected);
  });
});

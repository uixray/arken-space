import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const windows1251 = new TextDecoder("windows-1251");
function sourceFiles(root: string): string[] {
  return readdirSync(root, { withFileTypes: true }).flatMap((entry) => {
    const target = path.join(root, entry.name);
    if (entry.isDirectory()) return sourceFiles(target);
    return /\.(?:ts|tsx)$/.test(entry.name) ? [target] : [];
  });
}

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
    const files = sourceFiles(root);
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

  it("contains no escaped Cyrillic or replacement placeholders in UI source", () => {
    const root = path.join(process.cwd(), "apps", "web", "src");
    const files = sourceFiles(root);
    const findings = files.flatMap((file) => {
      const source = readFileSync(file, "utf8");
      const matches =
        source.match(/\\u04[0-9a-f]{2}|\?{4,}|\u0413\u2014|\u0420 (?=[\u0430-\u044f])|"\?"\s*:\s*"\?"|\u0417\u0430\u0433\u0440\u0443\u0437\u043a\u0430\?| \? \u0432\u044b\u0431\u0440\u0430\u043d|join\(" \? "\)/g) ?? [];
      return matches.map(
        (match) =>
          `${path.relative(process.cwd(), file)}: ${JSON.stringify(match)}`,
      );
    });
    const e2eFindings = sourceFiles(
      path.join(process.cwd(), "tests", "e2e"),
    ).flatMap((file) => {
      const source = readFileSync(file, "utf8");
      return (source.match(/\?{4,}/g) ?? []).map(
        (match) =>
          `${path.relative(process.cwd(), file)}: ${JSON.stringify(match)}`,
      );
    });
    expect([...findings, ...e2eFindings]).toEqual([]);
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

  it("keeps character and scene feedback copy readable", () => {
    const root = path.join(process.cwd(), "apps", "web", "src");
    const sidebar = readFileSync(path.join(root, "Sidebar.tsx"), "utf8");
    const app = readFileSync(path.join(root, "App.tsx"), "utf8");
    expect(sidebar).toContain("\u0421\u043e\u0437\u0434\u0430\u0442\u044c \u043f\u0435\u0440\u0441\u043e\u043d\u0430\u0436\u0430");
    expect(sidebar).toContain("\u0417\u0430\u043a\u0440\u044b\u0442\u044c \u0440\u0430\u0431\u043e\u0447\u0435\u0435 \u043f\u0440\u043e\u0441\u0442\u0440\u0430\u043d\u0441\u0442\u0432\u043e \u043f\u0435\u0440\u0441\u043e\u043d\u0430\u0436\u0435\u0439");
    expect(sidebar).toContain("\u0412\u044b\u0431\u0435\u0440\u0438\u0442\u0435 \u043f\u043e\u043b\u0443\u0447\u0430\u0442\u0435\u043b\u044f, \u0447\u0442\u043e\u0431\u044b \u043d\u0430\u0447\u0430\u0442\u044c \u043b\u0438\u0447\u043d\u044b\u0439 \u0434\u0438\u0430\u043b\u043e\u0433.");
    expect(app).toContain("\u0418\u0433\u0440\u043e\u043a\u0438 \u043f\u0435\u0440\u0435\u043c\u0435\u0449\u0435\u043d\u044b");
    const catalog = readFileSync(path.join(root, "CatalogEntryForm.tsx"), "utf8");
    const rollMode = readFileSync(path.join(root, "RollModeControl.tsx"), "utf8");
    expect(catalog).toContain("\u0420\u0435\u0441\u0443\u0440\u0441");
    expect(catalog).toContain("\u0411\u0435\u0437 \u0441\u0442\u043e\u0438\u043c\u043e\u0441\u0442\u0438");
    expect(catalog).toContain("\u041a\u043e\u043b\u0438\u0447\u0435\u0441\u0442\u0432\u043e");
    expect(rollMode).toContain("\u2191");
    expect(rollMode).toContain("\u2193");
    expect(rollMode).toContain("\u25cf");
  });
});

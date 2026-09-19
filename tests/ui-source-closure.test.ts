import {
  mkdtempSync,
  mkdirSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { collectUiSourceClosure } from "../scripts/ui-source-closure.mjs";
import {
  protectedSourceFiles,
  scanProtectedSources,
} from "../scripts/ui-icon-policy.mjs";

const roots: string[] = [];

function fixture() {
  const root = mkdtempSync(path.join(tmpdir(), "arken-ui-closure-"));
  roots.push(root);
  const write = (relative: string, source: string) => {
    const target = path.join(root, relative);
    mkdirSync(path.dirname(target), { recursive: true });
    writeFileSync(target, source);
  };
  return { root, write };
}

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true });
});

describe("UIX-645 reachable UI source coverage", () => {
  it("follows source imports, barrels, literal lazy UI, CSS and assets once", () => {
    const { root, write } = fixture();
    write(
      "apps/web/src/main.tsx",
      `import "react";
       import "./screen.js";
       import "./app.css";
       export * from "./nested";
       export const load = () => import("./lazy.tsx?screen");`,
    );
    write(
      "apps/web/src/screen.tsx",
      `import "./types.js";
       import "./poster.webp?url";
       export const Screen = () => <button>Открыть</button>;`,
    );
    write("apps/web/src/types.ts", "export const id = <T>(value: T) => value;");
    write("apps/web/src/nested/index.ts", 'export * from "../screen.js";');
    write("apps/web/src/lazy.tsx", 'export { Screen } from "./screen.js";');
    write("apps/web/src/poster.webp", "fixture asset, not executable source");
    write("apps/web/src/app.css", '@import "./nested/theme.css";');
    write("apps/web/src/nested/theme.css", "@IMPORT url(../app.css);");
    write(
      "apps/web/src/dormant.tsx",
      "export const Old = () => <button>↑</button>;",
    );

    const result = collectUiSourceClosure(root);
    expect(result.findings).toEqual([]);
    expect(result.files).toEqual(
      [
        "apps/web/src/main.tsx",
        "apps/web/src/screen.tsx",
        "apps/web/src/types.ts",
        "apps/web/src/nested/index.ts",
        "apps/web/src/lazy.tsx",
        "apps/web/src/poster.webp",
        "apps/web/src/app.css",
        "apps/web/src/nested/theme.css",
      ].sort(),
    );
  });

  it("automatically includes a newly wired screen without a policy-list edit", () => {
    const { root, write } = fixture();
    write("apps/web/src/main.tsx", "export const App = () => null;");
    write("apps/web/src/new-screen.tsx", "export const Screen = () => null;");
    expect(collectUiSourceClosure(root).files).not.toContain(
      "apps/web/src/new-screen.tsx",
    );
    write("apps/web/src/main.tsx", 'export * from "./new-screen";');
    expect(collectUiSourceClosure(root)).toEqual({
      files: ["apps/web/src/main.tsx", "apps/web/src/new-screen.tsx"],
      findings: [],
    });
  });

  it("fails closed when a relative UI dependency cannot be resolved", () => {
    const { root, write } = fixture();
    write("apps/web/src/main.tsx", 'import "./missing-screen";');
    const result = collectUiSourceClosure(root);
    expect(result.findings.join("\n")).toContain("missing-screen");
  });

  it("resolves a TypeScript extensionless dotted basename but not a missing one", () => {
    const { root, write } = fixture();
    write(
      "apps/web/src/main.tsx",
      'import { themes } from "./player-themes.generated"; void themes;',
    );
    write(
      "apps/web/src/player-themes.generated.ts",
      'export const themes = ["classic-v1"] as const;',
    );

    expect(collectUiSourceClosure(root)).toEqual({
      files: [
        "apps/web/src/main.tsx",
        "apps/web/src/player-themes.generated.ts",
      ],
      findings: [],
    });

    write("apps/web/src/main.tsx", 'import "./missing.generated";');
    const missing = collectUiSourceClosure(root);
    expect(missing.files).toEqual(["apps/web/src/main.tsx"]);
    expect(missing.findings.join("\n")).toContain("missing.generated");
  });

  it("the integrated guard rejects a glyph in a newly connected screen and stylesheet", () => {
    const { root, write } = fixture();
    for (const file of protectedSourceFiles)
      write(file, "// retained migration source");
    write("apps/web/src/main.tsx", 'import "./new-screen";');
    write(
      "apps/web/src/new-screen.tsx",
      'import "./new-screen.css"; export const Screen = () => <button>↑</button>;',
    );
    write(
      "apps/web/src/new-screen.css",
      '.new-action::after { content: "×"; }',
    );
    const findings = scanProtectedSources(root).join("\n");
    expect(findings).toContain("new-screen.tsx:1: text glyph");
    expect(findings).toContain(
      "new-screen.css: .new-action::after has glyph content",
    );
  });

  it("does not read imports outside the project root", () => {
    const { root, write } = fixture();
    write("apps/web/src/main.tsx", 'import "../../../../outside.ts";');
    const result = collectUiSourceClosure(root);
    expect(result.findings.length).toBeGreaterThan(0);
    expect(result.files).toEqual(["apps/web/src/main.tsx"]);
  });

  it("rejects an outside directory reached through an in-project symlink", () => {
    const outside = fixture();
    outside.write("screen.tsx", "export const Screen = () => null;");
    const { root, write } = fixture();
    write("apps/web/src/main.tsx", 'import "./linked/screen.tsx";');
    symlinkSync(
      outside.root,
      path.join(root, "apps/web/src/linked"),
      "junction",
    );
    const result = collectUiSourceClosure(root);
    expect(result.findings.length).toBeGreaterThan(0);
    expect(result.files).not.toContain("apps/web/src/linked/screen.tsx");
  });

  it("reports malformed source and a missing entry rather than claiming coverage", () => {
    const { root, write } = fixture();
    expect(collectUiSourceClosure(root).findings.length).toBeGreaterThan(0);
    write("apps/web/src/main.tsx", "const = ;");
    expect(collectUiSourceClosure(root).findings.length).toBeGreaterThan(0);
  });
});

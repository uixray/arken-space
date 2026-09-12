import { readFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { describe, expect, it } from "vitest";
import {
  decodeCssHexEscapes,
  decodeHtmlEntities,
  protectedSourceFiles,
  scanProtectedSources,
  scanScopedCss,
  scanUiSource,
} from "../scripts/ui-icon-policy.mjs";

function expectFinding(source: string, expected: string, file?: string) {
  expect(scanUiSource(source, file).join("\n")).toContain(expected);
}

describe("UIX-645 icon source policy", () => {
  it("guards the exact migrated sources and scoped CSS selectors", () => {
    expect(protectedSourceFiles).toEqual([
      "apps/web/src/App.tsx",
      "apps/web/src/ui/ArkenDialog.tsx",
      "apps/web/src/Sidebar.tsx",
      "apps/web/src/MapToolbar.tsx",
      "apps/web/src/MusicBar.tsx",
      "apps/web/src/GamePauseOverlay.tsx",
      "apps/web/src/ui/CursorPresenceMenu.tsx",
      "apps/web/src/renderers/GridSettings.tsx",
      "apps/web/src/renderers/CanvasHistoryControls.tsx",
      "apps/web/src/ui/icons.ts",
      "apps/web/src/ui/AppIcon.tsx",
    ]);
    expect(scanProtectedSources()).toEqual([]);
  });

  it("UIX645_APP_SHELL_GLYPH_RETURN detects a diversion of the actual source", () => {
    const file = "apps/web/src/App.tsx";
    const source = readFileSync(path.join(process.cwd(), file), "utf8");
    const anchor = "<AppIcon icon={AddIcon} />";
    expect(source.split(anchor)).toHaveLength(2);
    expect(scanUiSource(source, file)).toEqual([]);
    const diverted = source.replace(anchor, "<span>＋</span>");
    expect(scanUiSource(diverted, file).join("\n")).toContain("text glyph");
  });

  it("rejects literal JSX glyphs, HTML entities, config literals, and templates", () => {
    expect(scanUiSource("const view = <button>→</button>;").join("\n")).toContain(
      "text glyph",
    );
    expect(scanUiSource("const view = <button>&rarr;</button>;").join("\n")).toContain(
      "text glyph",
    );
    expect(scanUiSource('const item = { icon: "×" };').join("\n")).toContain(
      "literal glyph",
    );
    expect(scanUiSource("const label = `•`; ").join("\n")).toContain(
      "literal glyph",
    );
    expect(scanUiSource("const icon = '⚔';").join("\n")).toContain(
      "literal glyph",
    );
    expect(scanUiSource("const icon = 'Ⅱ';").join("\n")).toContain(
      "literal glyph",
    );
    expect(
      scanUiSource(
        "const view = <button>&#x203a;</button>; const history = '&#8630;';",
      ).join("\n"),
    ).toContain("glyph");
    expect(decodeHtmlEntities("&#x2192; &times; &bull;")).toBe("→ × •");
  });

  it("rejects scoped CSS content glyphs, including CSS hex escapes", () => {
    expect(
      scanScopedCss(
        '.map-toolbar::before { content: "\\2192 " !important; }',
      ).join("\n"),
    ).toContain("glyph content");
    expect(
      scanScopedCss('.grid-settings::before { content: "\\2316 "; }').join(
        "\n",
      ),
    ).toContain("glyph content");
    expect(
      scanScopedCss('.grid-settings::after { content: "#"; }').join("\n"),
    ).toContain("glyph content");
    expect(decodeCssHexEscapes("\\00d7 ")).toBe("×");
  });

  it("rejects namespace, default, dynamic, and CDN icon imports", () => {
    expectFinding(
      'import * as Icons from "lucide-react";',
      "named bindings only",
      "apps/web/src/ui/icons.ts",
    );
    expectFinding(
      'import Icon from "lucide-react";',
      "named bindings only",
      "apps/web/src/ui/icons.ts",
    );
    expectFinding('const module = import("lucide-react");', "dynamic Lucide");
    expectFinding(
      'const module = import("lucide-react/dynamic");',
      "dynamic Lucide",
    );
    expectFinding(
      'import { DynamicIcon } from "lucide-react/dynamic";',
      "subpath import",
    );
    expectFinding('export * from "lucide-react";', "named bindings only");
    expectFinding(
      'export { default as Icons } from "lucide-react";',
      "catalog export",
      "apps/web/src/ui/icons.ts",
    );
    expectFinding(
      'export { DynamicIcon } from "lucide-react/dynamic";',
      "subpath export",
      "apps/web/src/ui/icons.ts",
    );
    expectFinding('const module = import(moduleName);', "dynamic Lucide");
    expectFinding(
      'import "https://unpkg.com/lucide-react";',
      "CDN icon import",
    );
    expectFinding(
      'import { icons } from "lucide-react";',
      "catalog import",
      "apps/web/src/ui/icons.ts",
    );
    expectFinding(
      'import { DynamicIcon as Icon } from "lucide-react";',
      "catalog import",
      "apps/web/src/ui/icons.ts",
    );
  });

  it("allows named Lucide exports and ordinary math, prose, hotkeys, and comments", () => {
    expect(
      scanUiSource(
        'export { X as CloseIcon } from "lucide-react";',
        "apps/web/src/ui/icons.ts",
      ),
    ).toEqual([]);
    expect(
      scanUiSource(
        'const formula = "2×3"; const prose = "Перейдите → дальше 🎲"; const hotkey = "Ctrl+K"; // →',
      ),
    ).toEqual([]);
    expect(
      scanUiSource(
        "const view = <input disabled />; const blank = <div>{}</div>; export { view };",
      ),
    ).toEqual([]);
    expect(scanUiSource('const module = import("unrelated-feature");')).toEqual(
      [],
    );
    expect(scanUiSource('const separator = " · ";')).toEqual([]);
    expect(scanUiSource('const text = "&#x110000;";')).toEqual([]);
    expect(decodeCssHexEscapes("\\110000 ")).toBe("\\110000 ");
    expectFinding("const = ;", "invalid TypeScript/TSX syntax");
  });
});

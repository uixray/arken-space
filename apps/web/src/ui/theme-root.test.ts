import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * UIX-709: Gravity's styles.css used to define every `--g-*` root variable.
 * theme-root.css now carries only the subset the app reads, so a newly used
 * variable without a definition would silently resolve to nothing. Every
 * `var(--g-…)` without a fallback must be defined in the app's own CSS.
 */
const sourceRoot = fileURLToPath(new URL("..", import.meta.url));

function cssFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return cssFiles(path);
    return entry.name.endsWith(".css") ? [path] : [];
  });
}

const sources = cssFiles(sourceRoot).map((path) => readFileSync(path, "utf8"));
const defined = new Set(
  sources.flatMap((css) =>
    [...css.matchAll(/(--g-[\w-]+)\s*:/g)].map((match) => match[1]),
  ),
);

function unresolved(css: string) {
  return [...css.matchAll(/var\((--g-[\w-]+)\s*\)/g)]
    .map((match) => match[1]!)
    .filter((name) => !defined.has(name));
}

describe("theme root variables", () => {
  it("defines every --g-* variable the app reads without a fallback", () => {
    expect([...new Set(sources.flatMap(unresolved))].sort()).toEqual([]);
  });

  it("defines both colour schemes the player themes use", () => {
    const themeRoot = readFileSync(
      join(sourceRoot, "ui/theme-root.css"),
      "utf8",
    );
    expect(themeRoot).toContain(".g-root_theme_dark {");
    expect(themeRoot).toContain(".g-root_theme_light {");
    expect(themeRoot).toMatch(/--g-color-base-background:/);
  });

  it("flags a read variable that nothing defines", () => {
    expect(unresolved("a { color: var(--g-color-text-missing); }")).toEqual([
      "--g-color-text-missing",
    ]);
  });
});

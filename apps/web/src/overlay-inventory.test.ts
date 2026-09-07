import { readFileSync, readdirSync } from "node:fs";
import { join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { describe, expect, it } from "vitest";

interface SourceText {
  file: string;
  source: string;
}

interface OverlaySiteCount {
  file: string;
  kind: string;
  count: number;
}

const overlayTags = new Set([
  "details",
  "select",
  "FormSelect",
  "Select",
  "AssetPicker",
  "Popup",
  "Popover",
]);
const overlayRoles = new Set(["listbox", "menu", "combobox"]);

function isApplicationTsx(file: string): boolean {
  return (
    file.endsWith(".tsx") &&
    !/(?:^|\/)(?:__tests__|__stories__|tests|stories|test-support)(?:\/|$)/.test(
      file,
    ) &&
    !/\.(?:test|spec|stories|story)\.tsx$/.test(file)
  );
}

function readApplicationSources(root: string): SourceText[] {
  const sources: SourceText[] = [];
  function visit(directory: string) {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) visit(path);
      else if (entry.isFile()) {
        const file = `apps/web/src/${relative(root, path).split(sep).join("/")}`;
        if (isApplicationTsx(file))
          sources.push({ file, source: readFileSync(path, "utf8") });
      }
    }
  }
  visit(root);
  return sources;
}

/** Static discovery only: no component execution, alias resolution or CSS scan. */
function discoverOverlaySites(
  sources: readonly SourceText[],
): OverlaySiteCount[] {
  const sites: OverlaySiteCount[] = [];
  for (const { file, source } of sources) {
    if (!isApplicationTsx(file)) continue;
    const counts = new Map<string, number>();
    const count = (kind: string) =>
      counts.set(kind, (counts.get(kind) ?? 0) + 1);
    const syntax = ts.createSourceFile(
      file,
      source,
      ts.ScriptTarget.Latest,
      true,
      ts.ScriptKind.TSX,
    );
    function visit(node: ts.Node) {
      if (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) {
        const tag = ts.isPropertyAccessExpression(node.tagName)
          ? node.tagName.name.text
          : node.tagName.getText(syntax);
        if (overlayTags.has(tag)) count(`tag:${tag}`);
        for (const attribute of node.attributes.properties) {
          if (
            !ts.isJsxAttribute(attribute) ||
            attribute.name.getText(syntax) !== "role"
          )
            continue;
          const value = attribute.initializer;
          const expression =
            value && ts.isJsxExpression(value) ? value.expression : value;
          if (
            expression &&
            (ts.isStringLiteral(expression) ||
              ts.isNoSubstitutionTemplateLiteral(expression)) &&
            overlayRoles.has(expression.text)
          )
            count(`role:${expression.text}`);
        }
      }
      ts.forEachChild(node, visit);
    }
    visit(syntax);
    for (const [kind, count] of counts) sites.push({ file, kind, count });
  }
  return sites.sort((a, b) => {
    const left = `${a.file}\0${a.kind}`;
    const right = `${b.file}\0${b.kind}`;
    return left < right ? -1 : left > right ? 1 : 0;
  });
}

function requireReviewedSiteIndex(
  actual: readonly OverlaySiteCount[],
  reviewed: readonly OverlaySiteCount[],
) {
  if (JSON.stringify(actual) !== JSON.stringify(reviewed))
    throw new Error(
      "Overlay inventory drift: review added/removed/count-changed sites, then update docs/plans/uix-644-overlay-sites.json and the human inventory. This is not a runtime acceptance gate.",
    );
}

describe("UIX-644 static overlay inventory", () => {
  it("matches the reviewed registry across all application TSX files", () => {
    const sourceRoot = fileURLToPath(new URL(".", import.meta.url));
    const registryPath = resolve(
      sourceRoot,
      "../../../docs/plans/uix-644-overlay-sites.json",
    );
    const registry = JSON.parse(readFileSync(registryPath, "utf8")) as {
      schemaVersion: number;
      sites: OverlaySiteCount[];
    };
    expect(registry.schemaVersion).toBe(1);
    requireReviewedSiteIndex(
      discoverOverlaySites(readApplicationSources(sourceRoot)),
      registry.sites,
    );
  });

  const original: SourceText = {
    file: "apps/web/src/Existing.tsx",
    source: "const menu = <details><Select /></details>;",
  };
  const reviewed: OverlaySiteCount[] = [
    { file: original.file, kind: "tag:Select", count: 1 },
    { file: original.file, kind: "tag:details", count: 1 },
  ];

  // Negative source fixtures are the diversions: the same guard used above
  // must reject each changed index. No production files or registry are edited.
  it.each([
    {
      change: "a new TSX file in a new directory",
      sources: [
        original,
        {
          file: "apps/web/src/new/Picker.tsx",
          source: "const picker = <FormSelect />;",
        },
      ],
      expected: [
        ...reviewed,
        {
          file: "apps/web/src/new/Picker.tsx",
          kind: "tag:FormSelect",
          count: 1,
        },
      ],
    },
    {
      change: "another site of an existing kind",
      sources: [
        {
          ...original,
          source: "const menu = <details><Select /><Select /></details>;",
        },
      ],
      expected: [{ ...reviewed[0]!, count: 2 }, reviewed[1]!],
    },
    {
      change: "removal of an existing site",
      sources: [{ ...original, source: "const menu = <details />;" }],
      expected: [reviewed[1]!],
    },
  ])("rejects $change without a registry update", ({ sources, expected }) => {
    const changed = discoverOverlaySites(sources);
    expect(changed).toEqual(expected);
    expect(() => requireReviewedSiteIndex(changed, reviewed)).toThrow(
      "Overlay inventory drift",
    );
  });

  it("finds literal JSX sites without counting comments, dynamic roles or support files", () => {
    const file = "apps/web/src/Fixture.tsx";
    const source = `
      // <Popup role="menu" /> is only a comment.
      const text = '<Select role="listbox" />';
      const view = <details>
        <select /><FormSelect /><Select /><AssetPicker /><UI.Popup /><Popover />
        <div role="listbox" /><div role={"menu"} /><div role={\`combobox\`} />
        <div role={enabled ? "menu" : "listbox"} />
      </details>;
    `;
    const excludedFiles = [
      "Fixture.test.tsx",
      "Fixture.spec.tsx",
      "Fixture.stories.tsx",
      "Fixture.story.tsx",
      "test-support/Fixture.tsx",
      "tests/Fixture.tsx",
      "__tests__/Fixture.tsx",
      "stories/Fixture.tsx",
      "__stories__/Fixture.tsx",
      "Fixture.ts",
    ];
    const discovered = discoverOverlaySites([
      { file, source },
      ...excludedFiles.map((name) => ({
        file: `apps/web/src/${name}`,
        source,
      })),
    ]);
    expect(discovered).toEqual(
      [
        "role:combobox",
        "role:listbox",
        "role:menu",
        "tag:AssetPicker",
        "tag:FormSelect",
        "tag:Popover",
        "tag:Popup",
        "tag:Select",
        "tag:details",
        "tag:select",
      ].map((kind) => ({ file, kind, count: 1 })),
    );
    expect(discoverOverlaySites([original])).toEqual(reviewed);
    expect(() => requireReviewedSiteIndex(reviewed, reviewed)).not.toThrow();
  });
});

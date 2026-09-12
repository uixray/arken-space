/**
 * Narrow source guard for UIX-645's Lucide migration.  This intentionally
 * protects only the listed migration files; it is not a repository-wide icon
 * linter and does not try to classify ordinary prose, hotkeys, or formulae.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import ts from "typescript";

export const protectedSourceFiles = [
  "apps/web/src/App.tsx",
  "apps/web/src/ui/ArkenDialog.tsx",
  "apps/web/src/Sidebar.tsx",
  "apps/web/src/MapToolbar.tsx",
  "apps/web/src/MusicBar.tsx",
  "apps/web/src/GamePauseOverlay.tsx",
  "apps/web/src/sidebar/CharacterWorkspace.tsx",
  "apps/web/src/sidebar/StatLayoutCard.tsx",
  "apps/web/src/RollModeControl.tsx",
  "apps/web/src/sidebar/QuickRollPanel.tsx",
  "apps/web/src/sidebar/DiceTrayPanel.tsx",
  "apps/web/src/sidebar/ResourceCounters.tsx",
  "apps/web/src/sidebar/SetupPanel.tsx",
  "apps/web/src/WorldMapsWorkspace.tsx",
  "apps/web/src/WorldContentWorkspace.tsx",
  "apps/web/src/sidebar/CharacterMediaGallery.tsx",
  "apps/web/src/renderers/TokenConditionMenu.tsx",
  "apps/web/src/renderers/Orthographic2DRenderer.tsx",
  "apps/web/src/ui/SelectionActions.tsx",
  "apps/web/src/ui/ImageUploadField.tsx",
  "apps/web/src/ui/GravityFoundationPreview.tsx",
  "apps/web/src/ui/CursorPresenceMenu.tsx",
  "apps/web/src/renderers/GridSettings.tsx",
  "apps/web/src/renderers/CanvasHistoryControls.tsx",
  "apps/web/src/ui/icons.ts",
  "apps/web/src/ui/AppIcon.tsx",
];

export const protectedCssSelectors = [
  ".map-toolbar",
  ".grid-settings",
  ".resize-settings",
];

const namedEntities = new Map([
  ["larr", "←"],
  ["uarr", "↑"],
  ["rarr", "→"],
  ["darr", "↓"],
  ["harr", "↔"],
  ["times", "×"],
  ["bull", "•"],
  ["middot", "·"],
  ["laquo", "«"],
  ["raquo", "»"],
]);

// Symbol-only values are UI-icon candidates.  Embedded symbols remain prose
// or math (for example "2×3"), which this scoped guard deliberately ignores.
const glyphOnly =
  /^[\s›‹«»•×Ⅱ\uFF0B\u2190-\u2BFF\u{1F000}-\u{1FAFF}\u200D\uFE0E\uFE0F]+$/u;

function codePointOr(value, fallback) {
  return Number.isInteger(value) && value >= 0 && value <= 0x10ffff
    ? String.fromCodePoint(value)
    : fallback;
}

export function decodeHtmlEntities(value) {
  return value.replace(
    /&(#x[\da-f]+|#\d+|[a-z]+);/giu,
    (whole, entity) => {
      const lower = entity.toLowerCase();
      if (lower.startsWith("#x")) {
        return codePointOr(Number.parseInt(lower.slice(2), 16), whole);
      }
      if (lower.startsWith("#")) {
        return codePointOr(Number.parseInt(lower.slice(1), 10), whole);
      }
      return namedEntities.get(lower) ?? whole;
    },
  );
}

export function decodeCssHexEscapes(value) {
  return value.replace(/\\([\da-f]{1,6})(?:\s|\\n|\\r\\n)?/giu, (whole, hex) =>
    codePointOr(Number.parseInt(hex, 16), whole),
  );
}

export function isStandaloneUiGlyph(value) {
  const decoded = decodeHtmlEntities(value).trim();
  return decoded.length > 0 && glyphOnly.test(decoded);
}

function finding(file, message, node) {
  const line = node
    ?.getSourceFile?.()
    .getLineAndCharacterOfPosition(node.getStart()).line;
  return `${file}${line === undefined ? "" : `:${line + 1}`}: ${message}`;
}

function literalValue(node) {
  if (!node) return null;
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
    return node.text;
  }
  return null;
}

function propertyName(node) {
  if (!node.name) return null;
  return ts.isIdentifier(node.name) || ts.isStringLiteral(node.name)
    ? node.name.text
    : null;
}

function hasCatalogBinding(bindings) {
  return bindings?.some((binding) =>
    /^(?:default|icons|lucideicons|dynamicicon)$/i.test(
      binding.propertyName?.text ?? binding.name.text,
    ),
  ) ?? false;
}

// Standalone operators are icons inside buttons, not in ordinary formula text.
function isControlOperator(value, node) {
  if (!/^[+-]$/.test(decodeHtmlEntities(value).trim())) return false;
  for (let parent = node.parent; parent; parent = parent.parent) {
    if (
      ts.isJsxElement(parent) &&
      /^(?:button|Button)$/.test(parent.openingElement.tagName.getText())
    ) {
      return true;
    }
  }
  return false;
}

/** Scan TSX source AST; comments are not AST nodes and are intentionally ignored. */
export function scanUiSource(source, file = "<inline>.tsx") {
  const tree = ts.createSourceFile(
    file,
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );
  const findings = [];
  if (tree.parseDiagnostics.length > 0) {
    findings.push(`${file}: invalid TypeScript/TSX syntax`);
    return findings;
  }
  const visit = (node) => {
    if (
      ts.isJsxText(node) &&
      (isStandaloneUiGlyph(node.getText(tree)) ||
        isControlOperator(node.getText(tree), node))
    ) {
      findings.push(
        finding(
          file,
          `text glyph ${JSON.stringify(
            decodeHtmlEntities(node.getText(tree)).trim(),
          )}`,
          node,
        ),
      );
    }
    const value = literalValue(node);
    if (
      value !== null &&
      (isStandaloneUiGlyph(value) || isControlOperator(value, node))
    ) {
      findings.push(
        finding(
          file,
          `literal glyph ${JSON.stringify(decodeHtmlEntities(value).trim())}`,
          node,
        ),
      );
    }
    if (ts.isJsxAttribute(node) && /^(?:icon|glyph)$/i.test(node.name.text)) {
      const candidate = node.initializer && ts.isJsxExpression(node.initializer)
        ? literalValue(node.initializer.expression) : literalValue(node.initializer);
      if (candidate !== null && isStandaloneUiGlyph(candidate)) {
        findings.push(finding(file, `${node.name.text} attribute uses glyph value`, node));
      }
    }
    if (
      ts.isPropertyAssignment(node) &&
      /^(?:icon|glyph)$/i.test(propertyName(node) ?? "")
    ) {
      const candidate = literalValue(node.initializer);
      if (candidate !== null && isStandaloneUiGlyph(candidate)) {
        findings.push(finding(file, `${propertyName(node)} property uses glyph value`, node));
      }
    }
    if (ts.isImportDeclaration(node)) {
      const moduleName = ts.isStringLiteral(node.moduleSpecifier)
        ? node.moduleSpecifier.text
        : "";
      const clause = node.importClause;
      if (moduleName === "@gravity-ui/icons") {
        findings.push(finding(file, "migrated UI must use the Lucide pack", node));
      }
      if (moduleName.startsWith("lucide-react/")) {
        findings.push(finding(file, "Lucide subpath import is not allowed", node));
      }
      if (moduleName === "lucide-react") {
        if (!file.replaceAll("\\", "/").endsWith("apps/web/src/ui/icons.ts")) {
          findings.push(finding(file, "Lucide imports must be routed through ui/icons.ts", node));
        }
        if (
          !clause ||
          clause.name ||
          clause.namedBindings?.kind === ts.SyntaxKind.NamespaceImport
        ) {
          findings.push(finding(file, "Lucide import must use named bindings only", node));
        }
        if (
          clause?.namedBindings &&
          ts.isNamedImports(clause.namedBindings) &&
          hasCatalogBinding(clause.namedBindings.elements)
        ) {
          findings.push(finding(file, "Lucide icon catalog import is not allowed", node));
        }
      }
      if (/^https?:\/\/.+?(?:lucide|unpkg|jsdelivr)/i.test(moduleName)) {
        findings.push(finding(file, "CDN icon import is not allowed", node));
      }
    }
    if (
      ts.isExportDeclaration(node) &&
      node.moduleSpecifier &&
      ts.isStringLiteral(node.moduleSpecifier) &&
      node.moduleSpecifier.text.startsWith("lucide-react/")
    ) {
      findings.push(finding(file, "Lucide subpath export is not allowed", node));
    }
    if (
      ts.isExportDeclaration(node) &&
      node.moduleSpecifier &&
      ts.isStringLiteral(node.moduleSpecifier) &&
      node.moduleSpecifier.text === "lucide-react"
    ) {
      const inRegistry = file.replaceAll("\\", "/").endsWith("apps/web/src/ui/icons.ts");
      if (!inRegistry) {
        findings.push(
          finding(file, "Lucide exports must be routed through ui/icons.ts", node),
        );
      }
      if (!node.exportClause || !ts.isNamedExports(node.exportClause)) {
        findings.push(finding(file, "Lucide export must use named bindings only", node));
      }
      if (
        node.exportClause &&
        ts.isNamedExports(node.exportClause) &&
        hasCatalogBinding(node.exportClause.elements)
      ) {
        findings.push(finding(file, "Lucide icon catalog export is not allowed", node));
      }
    }
    if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword) {
      const moduleName = literalValue(node.arguments[0]);
      if (
        moduleName === null ||
        /^lucide-react(?:\/|$)/.test(moduleName) ||
        /^https?:\/\//.test(moduleName)
      ) {
        findings.push(finding(file, "dynamic Lucide import is not allowed", node));
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(tree);
  return findings;
}

function stripCssComments(source) {
  return source.replace(/\/\*[\s\S]*?\*\//g, "");
}

/** Bounded rule scanner: only migration-related toolbar/grid/resize selectors. */
export function scanScopedCss(source, file = "apps/web/src/styles.css") {
  const findings = [];
  const css = stripCssComments(source);
  const rule = /([^{}]+)\{([^{}]*)\}/g;
  for (let match; (match = rule.exec(css));) {
    const [, selectors, declarations] = match;
    if (!protectedCssSelectors.some((selector) => selectors.includes(selector))) continue;
    const content = /\bcontent\s*:\s*(["'])(.*?)\1/giu;
    for (let declaration; (declaration = content.exec(declarations));) {
      const raw = declaration[2];
      const value = decodeCssHexEscapes(raw);
      if (isStandaloneUiGlyph(value) || value.trim() === "#") {
        findings.push(
          `${file}: ${selectors
            .trim()
            .replace(/\s+/g, " ")} has glyph content ${JSON.stringify(value)}`,
        );
      }
    }
  }
  return findings;
}

export function scanProtectedSources(root = process.cwd()) {
  const findings = protectedSourceFiles.flatMap((relative) =>
    scanUiSource(readFileSync(path.join(root, relative), "utf8"), relative),
  );
  const cssFile = "apps/web/src/styles.css";
  findings.push(...scanScopedCss(readFileSync(path.join(root, cssFile), "utf8"), cssFile));
  return findings;
}

import { readFileSync, realpathSync, statSync } from "node:fs";
import path from "node:path";
import ts from "typescript";

const sourceExtensions = /\.(?:[cm]?[jt]sx?)$/i;
const exists = (file) => {
  try {
    return statSync(file).isFile();
  } catch {
    return false;
  }
};
const inside = (root, file) => {
  const relative = path.relative(root, file);
  return (
    relative !== ".." &&
    !relative.startsWith(`..${path.sep}`) &&
    !path.isAbsolute(relative)
  );
};

/** Local source/asset closure only: never resolves packages or traverses node_modules. */
export function collectUiSourceClosure(root, entry = "apps/web/src/main.tsx") {
  root = path.resolve(root);
  const realRoot = realpathSync(root);
  const files = new Set();
  const visitedRealFiles = new Set();
  const findings = [];
  const relative = (file) => path.relative(root, file).replaceAll("\\", "/");
  const visit = (file) => {
    if (
      !inside(root, file) ||
      relative(file).split("/").includes("node_modules")
    ) {
      findings.push(
        `${relative(file)}: relative import escapes local source boundary`,
      );
      return;
    }
    if (files.has(relative(file))) return;
    if (!exists(file)) {
      findings.push(`${relative(file)}: unresolved source entry`);
      return;
    }
    const realFile = realpathSync(file);
    if (
      !inside(realRoot, realFile) ||
      path.relative(realRoot, realFile).split(path.sep).includes("node_modules")
    ) {
      findings.push(
        `${relative(file)}: source symlink escapes local source boundary`,
      );
      return;
    }
    files.add(relative(file));
    if (visitedRealFiles.has(realFile)) return;
    visitedRealFiles.add(realFile);
    if (!sourceExtensions.test(file) && !file.endsWith(".css")) return;
    const source = readFileSync(file, "utf8");
    const imports = [];
    if (file.endsWith(".css")) {
      const css = source.replace(/\/\*[\s\S]*?\*\//g, "");
      for (const match of css.matchAll(
        /@import\s+(?:url\(\s*(?:["']([^"']+)["']|([^\s)"']+))\s*\)|["']([^"']+)["'])/gi,
      ))
        imports.push(match[1] ?? match[2] ?? match[3]);
    } else {
      const tree = ts.createSourceFile(
        file,
        source,
        ts.ScriptTarget.Latest,
        true,
      );
      if (tree.parseDiagnostics.length)
        findings.push(
          `${relative(file)}: invalid source syntax in import closure`,
        );
      const walk = (node) => {
        if (
          (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) &&
          node.moduleSpecifier &&
          ts.isStringLiteral(node.moduleSpecifier)
        )
          imports.push(node.moduleSpecifier.text);
        if (
          ts.isCallExpression(node) &&
          node.expression.kind === ts.SyntaxKind.ImportKeyword &&
          node.arguments[0] &&
          (ts.isStringLiteral(node.arguments[0]) ||
            ts.isNoSubstitutionTemplateLiteral(node.arguments[0]))
        )
          imports.push(node.arguments[0].text);
        ts.forEachChild(node, walk);
      };
      walk(tree);
    }
    for (const specifier of imports) {
      if (!/^\.\.?\//.test(specifier)) continue;
      const clean = specifier.split(/[?#]/, 1)[0];
      const target = path.resolve(path.dirname(file), clean);
      if (
        !inside(root, target) ||
        relative(target).split("/").includes("node_modules")
      ) {
        findings.push(
          `${relative(file)}: relative import ${JSON.stringify(specifier)} escapes local source boundary`,
        );
        continue;
      }
      const extension = path.extname(target);
      const candidates = [target];
      if (/\.(?:js|jsx|mjs|cjs)$/.test(extension)) {
        const stem = target.slice(0, -extension.length);
        candidates.push(
          ...[".ts", ".tsx", ".mts", ".cts"].map((ext) => stem + ext),
        );
      }
      if (!extension) {
        const extensions = [
          ".ts",
          ".tsx",
          ".js",
          ".jsx",
          ".mts",
          ".mjs",
          ".cts",
          ".cjs",
          ".css",
        ];
        candidates.push(
          ...extensions.map((ext) => target + ext),
          ...extensions.map((ext) => path.join(target, "index" + ext)),
        );
      }
      const resolved = candidates.find(exists);
      if (!resolved)
        findings.push(
          `${relative(file)}: unresolved relative source import ${JSON.stringify(specifier)}`,
        );
      else visit(resolved);
    }
  };
  visit(path.resolve(root, entry));
  return { files: [...files].sort(), findings: [...new Set(findings)].sort() };
}

import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import * as prettier from "prettier";

// Only transport EOL differences are equivalent; whitespace/layout is preserved.
export const contentHash = (text) =>
  createHash("sha256").update(text.replaceAll("\r\n", "\n")).digest("hex");

export function assessFormatting(files, baseline) {
  const failures = [];
  let accepted = 0;
  const seen = new Set();
  for (const file of files) {
    seen.add(file.path);
    const recorded = baseline[file.path];
    if (file.formatted) {
      if (recorded) failures.push(`STALE_BASELINE: ${file.path}`);
    } else if (recorded === contentHash(file.text)) {
      accepted++;
    } else {
      failures.push(`NEW_OR_CHANGED_FORMATTING: ${file.path}`);
    }
  }
  for (const path of Object.keys(baseline)) {
    if (!seen.has(path)) failures.push(`MISSING_OR_IGNORED_BASELINE: ${path}`);
  }
  return { failures, accepted };
}

export async function collectFormatting(root) {
  const paths = execFileSync(
    "git",
    ["ls-files", "--cached", "--others", "--exclude-standard", "-z"],
    { cwd: root, encoding: "utf8" },
  )
    .split("\0")
    .filter(Boolean);
  const files = [];
  for (const path of [...new Set(paths)].sort()) {
    const absolute = resolve(root, path);
    const info = await prettier.getFileInfo(absolute, {
      ignorePath: resolve(root, ".prettierignore"),
      withNodeModules: false,
    });
    if (info.ignored || !info.inferredParser) continue;
    const text = await readFile(absolute, "utf8");
    const config = await prettier.resolveConfig(absolute);
    files.push({
      path,
      text,
      formatted: await prettier.check(text, { ...config, filepath: absolute }),
    });
  }
  return files;
}

async function policyHash(root) {
  const policy = await Promise.all(
    [".prettierrc.json", ".prettierignore", ".gitattributes"].map(async (p) =>
      contentHash(await readFile(resolve(root, p), "utf8")),
    ),
  );
  return contentHash(JSON.stringify([prettier.version, ...policy]));
}

export async function run(root, { initialize = false } = {}) {
  const path = resolve(root, ".prettier-baseline.json");
  const policy = await policyHash(root);
  if (initialize) {
    // Explicit, reviewable creation only; never refresh an existing baseline.
    const files = await collectFormatting(root);
    const revision = execFileSync("git", ["rev-parse", "HEAD"], {
      cwd: root,
      encoding: "utf8",
    }).trim();
    const baseline = {
      version: 1,
      revision,
      policyHash: policy,
      files: Object.fromEntries(
        files
          .filter((f) => !f.formatted)
          .map((f) => [f.path, contentHash(f.text)]),
      ),
    };
    const formatted = await prettier.format(JSON.stringify(baseline), {
      parser: "json",
      ...(await prettier.resolveConfig(path)),
    });
    await writeFile(path, formatted, { flag: "wx" });
    console.log(
      `Created explicit formatting baseline: ${Object.keys(baseline.files).length} files at ${revision}`,
    );
    return;
  }
  const baseline = JSON.parse(await readFile(path, "utf8"));
  if (
    baseline.version !== 1 ||
    !/^[a-f0-9]{40}$/.test(baseline.revision) ||
    baseline.policyHash !== policy
  ) {
    throw new Error(
      "Formatting policy changed or baseline invalid; review required",
    );
  }
  for (const [path, hash] of Object.entries(baseline.files)) {
    if (
      path.startsWith("/") ||
      path.includes("\\") ||
      path.split("/").includes("..") ||
      !/^[a-f0-9]{64}$/.test(hash)
    ) {
      throw new Error("Invalid formatting baseline entry");
    }
  }
  const result = assessFormatting(
    await collectFormatting(root),
    baseline.files,
  );
  for (const failure of result.failures) console.error(failure);
  if (result.failures.length)
    throw new Error(
      `${result.failures.length} formatting violations; baseline was not modified`,
    );
  console.log(
    `Formatting PASS; ${result.accepted} unchanged owner-approved baseline files (not reformatted)`,
  );
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const args = process.argv.slice(2);
  if (args.some((arg) => arg !== "--initialize-owner-approved-baseline"))
    throw new Error("Unknown argument");
  await run(process.cwd(), {
    initialize: args.includes("--initialize-owner-approved-baseline"),
  });
}

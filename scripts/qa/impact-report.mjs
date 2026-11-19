import { execFileSync } from "node:child_process";
import { readFileSync, realpathSync } from "node:fs";
import { isAbsolute, relative, resolve, sep } from "node:path";
import { pathToFileURL } from "node:url";
import {
  isCanonicalRepositoryPath,
  selectImpact,
  UIX694_IMPACT_MAP,
} from "./impact-map.mjs";

const git = (args, cwd) =>
  execFileSync(
    "git",
    ["-c", "core.fsmonitor=false", "-c", "core.safecrlf=false", ...args],
    {
      cwd,
      encoding: "utf8",
      maxBuffer: 16 * 1024 * 1024,
      windowsHide: true,
    },
  );

/** No test execution: just diff against an explicitly resolved commit and include local new files. */
export function collectImpactInputs(base, cwd, runGit = git) {
  if (
    typeof base !== "string" ||
    !base ||
    base.startsWith("-") ||
    /[\0\r\n]/.test(base)
  )
    throw new TypeError("Pass a Git commit or ref as --base.");
  const root = runGit(["rev-parse", "--show-toplevel"], cwd).trim();
  if (!isAbsolute(root))
    throw new Error("Git did not return an absolute root.");
  const revision = runGit(
    ["rev-parse", "--verify", "--end-of-options", base + "^{commit}"],
    root,
  ).trim();
  if (!/^(?:[0-9a-f]{40}|[0-9a-f]{64})$/.test(revision))
    throw new Error("Git did not return a full commit ID.");
  const changed = runGit(
    ["diff", "--name-only", "-z", "--no-renames", revision, "--"],
    root,
  );
  const newPaths = runGit(
    ["ls-files", "--others", "--exclude-standard", "-z", "--"],
    root,
  );
  return {
    root,
    revision,
    paths: [
      ...new Set(
        [...changed.split("\0"), ...newPaths.split("\0")].filter(Boolean),
      ),
    ].sort(),
  };
}

export function repositoryReader(root) {
  const realRoot = realpathSync(root);
  return (path) => {
    if (!isCanonicalRepositoryPath(path)) return undefined;
    const file = realpathSync(resolve(realRoot, path));
    const scoped = relative(realRoot, file);
    if (
      !scoped ||
      isAbsolute(scoped) ||
      scoped === ".." ||
      scoped.startsWith(".." + sep)
    )
      return undefined;
    return readFileSync(file, "utf8");
  };
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  try {
    const [flag, base, ...rest] = process.argv.slice(2);
    if (flag !== "--base" || rest.length)
      throw new Error(
        "Usage: node scripts/qa/impact-report.mjs --base <commit-or-ref>",
      );
    const { root, revision, paths } = collectImpactInputs(base, process.cwd());
    const result = selectImpact(UIX694_IMPACT_MAP, paths, {
      readText: repositoryReader(root),
    });
    process.stdout.write(
      JSON.stringify(
        { baseRevision: revision, changedPaths: paths, ...result },
        null,
        2,
      ) + "\n",
    );
    if (result.validationErrors.length) process.exitCode = 2;
  } catch (error) {
    process.stderr.write(
      String(error instanceof Error ? error.message : error) + "\n",
    );
    process.exitCode = 2;
  }
}

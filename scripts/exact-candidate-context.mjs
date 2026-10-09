import { createHash } from "node:crypto";
import { lstatSync, mkdirSync, realpathSync, writeFileSync } from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

const shaPattern = /^[0-9a-f]{40}$/i;
const forbiddenPath =
  /(?:^|\/)(?:\.data|\.tmp|\.git|\.env(?:\.[^/]*)?|node_modules|dist|tests?|fixtures?|[^/]*private[^/]*|secrets?|credentials?)(?:\/|$)|(?:^|\/)(?:id_rsa|id_ed25519|service-account(?:\.[^/]*)?)(?:$|\.)|\.(?:pem|key|p12|pfx|crt|cer|db|sqlite|dump)$/i;
const allowedRootFiles = new Set([
  "Dockerfile.server",
  "Dockerfile.web",
  "package.json",
  "pnpm-lock.yaml",
  "pnpm-workspace.yaml",
  "tsconfig.base.json",
]);

export function validateCandidateContextRequest({
  sha,
  files,
  requiredImports = [],
  historicalFiles = [],
}) {
  if (!shaPattern.test(sha ?? ""))
    throw new Error("A full immutable 40-character commit SHA is required");
  if (!Array.isArray(files) || files.length === 0)
    throw new Error("Positive file allowlist is required");
  const normalized = files.map((file) => {
    if (
      typeof file !== "string" ||
      !file ||
      file.startsWith("/") ||
      file.includes("\\") ||
      file.split("/").some((part) => !part || part === "." || part === "..") ||
      forbiddenPath.test(file) ||
      !(
        allowedRootFiles.has(file) ||
        /^(?:apps|packages|infra|scripts)\//.test(file)
      )
    )
      throw new Error("Unsafe candidate context path");
    return file;
  });
  if (new Set(normalized).size !== normalized.length)
    throw new Error("Duplicate candidate context path");
  const listed = new Set(normalized);
  for (const imported of requiredImports)
    if (!listed.has(imported))
      throw new Error(`Required import missing from allowlist: ${imported}`);
  const historical = new Set(historicalFiles);
  const additions = normalized.filter((file) => !historical.has(file)).sort();
  return { sha: sha.toLowerCase(), files: normalized.toSorted(), additions };
}

function git(args, { maxBuffer = 32 * 1024 * 1024, cwd } = {}) {
  const result = spawnSync("git", args, {
    cwd,
    shell: false,
    encoding: null,
    maxBuffer,
    stdio: ["ignore", "pipe", "pipe"],
    env: {
      PATH: process.env.PATH ?? "",
      SYSTEMROOT: process.env.SYSTEMROOT ?? "",
      WINDIR: process.env.WINDIR ?? "",
      GIT_OPTIONAL_LOCKS: "0",
      GIT_TERMINAL_PROMPT: "0",
      GIT_CONFIG_NOSYSTEM: "1",
    },
  });
  if (result.error || result.status !== 0)
    throw new Error(
      "Git could not read the supplied immutable candidate commit",
    );
  return result.stdout;
}

export function exportExactCandidateContext({
  sha,
  files,
  requiredImports,
  historicalFiles = [],
  repositoryRoot,
  artifactRoot,
  outputDirectory,
  write = false,
}) {
  const request = validateCandidateContextRequest({
    sha,
    files,
    requiredImports,
    historicalFiles,
  });
  if (!write) return { ...request, mode: "plan", blobs: [] };
  if (
    ![repositoryRoot, artifactRoot, outputDirectory].every((value) =>
      path.isAbsolute(value ?? ""),
    )
  )
    throw new Error(
      "Repository, approved artifact root, and context output must be explicit absolute paths",
    );
  const repo = path.resolve(repositoryRoot);
  const artifacts = path.resolve(artifactRoot);
  const root = path.resolve(outputDirectory);
  if (
    !path.isAbsolute(repositoryRoot) ||
    !path.isAbsolute(artifactRoot) ||
    !path.isAbsolute(outputDirectory)
  )
    throw new Error("Repository and output paths must be absolute");
  const inside = (parent, child) =>
    child === parent || child.startsWith(parent + path.sep);
  if (
    !inside(path.resolve(repo, ".data", "qa-prep"), artifacts) ||
    !inside(artifacts, root) ||
    root === artifacts
  )
    throw new Error(
      "Context output must be a dedicated child of the approved .data/qa-prep artifact root",
    );
  const repoReal = realpathSync(repo);
  if (repoReal !== repo)
    throw new Error(
      "Repository root must not be reached through a symlink or reparse point",
    );
  const artifactStat = lstatSync(artifacts);
  if (artifactStat.isSymbolicLink() || !artifactStat.isDirectory())
    throw new Error("Approved artifact root must be a real directory");
  for (const target of [artifacts, root]) {
    let current = repo;
    for (const component of path
      .relative(repo, target)
      .split(path.sep)
      .filter(Boolean)) {
      current = path.join(current, component);
      try {
        if (lstatSync(current).isSymbolicLink())
          throw new Error(
            "Symlink or reparse point in candidate artifact path is forbidden",
          );
      } catch (error) {
        if (error?.code !== "ENOENT") throw error;
      }
    }
  }
  try {
    lstatSync(root);
    throw new Error(
      "Candidate context output must be a new exclusive directory",
    );
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
  const resolved = git(["rev-parse", "--verify", `${request.sha}^{commit}`], {
    cwd: repo,
  })
    .toString("utf8")
    .trim();
  if (resolved.toLowerCase() !== request.sha)
    throw new Error("Supplied SHA did not resolve to the exact commit");
  const listing = git(
    ["ls-tree", "-rz", "--full-tree", request.sha, "--", ...request.files],
    { cwd: repo },
  ).toString("utf8");
  const entries = listing
    .split("\0")
    .filter(Boolean)
    .map((entry) => {
      const match = /^(100644|100755|120000) blob ([0-9a-f]{40})\t(.+)$/.exec(
        entry,
      );
      if (!match)
        throw new Error(
          "Candidate context contains a non-regular or unsupported Git entry",
        );
      return { mode: match[1], object: match[2], file: match[3] };
    });
  if (
    entries.length !== request.files.length ||
    entries.some((entry) => entry.mode === "120000") ||
    entries
      .map((e) => e.file)
      .toSorted()
      .join("\n") !== request.files.join("\n")
  )
    throw new Error(
      "Git tree does not exactly match the positive regular-file allowlist",
    );
  mkdirSync(root);
  const blobs = entries.map((entry) => {
    const bytes = git(["cat-file", "blob", `${request.sha}:${entry.file}`], {
      cwd: repo,
    });
    const target = path.resolve(root, ...entry.file.split("/"));
    if (target !== root && !target.startsWith(root + path.sep))
      throw new Error("Candidate path escaped output root");
    mkdirSync(path.dirname(target), { recursive: true });
    let parent = root;
    for (const part of entry.file.split("/").slice(0, -1)) {
      parent = path.join(parent, part);
      if (
        lstatSync(parent).isSymbolicLink() ||
        !lstatSync(parent).isDirectory()
      )
        throw new Error("Symlink or non-directory in exported candidate path");
    }
    writeFileSync(target, bytes, { flag: "wx" });
    return {
      path: entry.file,
      bytes: bytes.length,
      sha256: createHash("sha256").update(bytes).digest("hex"),
    };
  });
  const digest = createHash("sha256")
    .update(JSON.stringify(blobs))
    .digest("hex");
  return { ...request, mode: "exported", blobs, contextSha256: digest };
}

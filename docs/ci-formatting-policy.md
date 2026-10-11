# CI formatting policy

Owner decision, 2026-10-11 (UIX-686): perform one reviewed repository-wide formatting pass and enforce ordinary Prettier checks afterwards. This supersedes the temporary 289-file baseline; no per-change baseline updates remain.

`pnpm format:check` is read-only (`prettier --check . --ignore-unknown`). `pnpm format` writes supported, non-ignored files.

Keep `.prettierrc.json` `endOfLine: auto` and `.gitattributes` LF rules for deployment scripts, Dockerfiles, configuration and YAML. Line-ending compatibility is distinct from wrapping and indentation.

Historical SQL migrations and metadata are excluded. Raw migration bytes are bound to ledger hashes and must never be rewritten for formatting. Existing generated-artifact, dependency, local-worktree and private-tool exclusions remain.

Formatting does not authorize deployment. Runtime, security and release gates still apply to the exact release revision.

# CI formatting policy

Owner decision, 2026-10-11 (UIX-686): preserve the existing intentional layout; prohibit new formatting violations without mass-formatting the release.

`pnpm format:check` runs `scripts/check-format-baseline.mjs`. The explicit `.prettier-baseline.json` records 289 existing discrepancies, their content hashes, the reference revision and formatter-policy identity. It is not a claim that those files are Prettier-formatted.

- An unchanged recorded discrepancy is accepted. Only CRLF/LF transport differences are equivalent in the content hash; spaces, wrapping and code changes are not.
- New or changed unformatted files fail. New formatted files pass normally.
- When a recorded file is formatted, removed or ignored, remove its stale entry through a reviewed change. Stale entries fail rather than silently hiding debt.
- Formatter-version, ignore-file, EOL-policy or Git-attributes changes require explicit baseline-policy review.
- The checker never updates the baseline. Its initialization command refuses to overwrite an existing file. Do not regenerate it to silence failures.
- Newly introduced test/probe formatting discrepancies were fixed before recording the original 289; they are not grandfathered in.
- Git tracked files and non-ignored new files are checked. Prettier's existing ignore rules and parser support apply.

The intentional `endOfLine: auto` and LF deployment-script rules remain unchanged. Database migration bytes and historical ledger hashes must not be normalized or rewritten to satisfy formatting checks. This formatting-only hash policy does not change migration-integrity verification.

`pnpm format` remains the explicit repository-wide formatter; do not run it automatically under this policy. Format only new/changed files when appropriate, and preserve intentional existing layout unless the owner approves otherwise.

Tests in `tests/format-baseline.test.ts` cover unchanged/edited/new violations, permitted EOL transport, forbidden whitespace changes, and stale/missing entries.

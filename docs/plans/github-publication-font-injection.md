# Local font injection for publication-safe builds

Status: sanitized source snapshot at `8916874946a55cc719fa72f301630aa1ec0dd706`; audit candidate only, not a release acceptance or push authorization.

The candidate is a single snapshot commit based on the existing public `origin/main` commit `9d441bdfca9325ca1b0de273f5b40360821df53d`. It includes committed source through the identified SHA and excludes the two owner-supplied Pragmatica WOFF files pending redistribution-rights confirmation. Those files remain local and are excluded by exact `.gitignore` paths.

The production stylesheet and terrain-stamp prototype still reference their respective local font paths. Inject the authorized font only into isolated local build contexts at these exact relative paths; do not commit the files or publish filesystem paths or private receipts. The local-font contract test requires the fixture and remains unavailable without authorized local injection; do not weaken or skip it.

This source snapshot intentionally excludes ignored `.data` QA/runtime content and current uncommitted worktree changes. It is a public review snapshot only, not a release PASS.

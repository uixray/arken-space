# UIX-506 — bounded post-publication web correction

The full web/server pool was published as85ff8f647e36a69bae5abead5b88a9f7cbcaf90e.
Operational checks confirmed API/database, all13 new migration hashes, preserved
telemetry, a real heartbeat with matching client/server revisions, public assets,
WebSocket transport and the two neighbour sites. No test qualification was run.

Browser observation then exposed inherited light-theme text/mark on a hard-coded
dark landing background. This preexisting surface mismatch also obscured the new
accepted identity. The correction uses the existing theme canvas token for landing
and loading surfaces, and allows the brand/badge/navigation header to wrap. Accepted
SVG/font bytes and gameplay code remain unchanged; no redesign or new feature.

The manual release-web workflow builds an exact main SHA of Dockerfile.web only.
It does not run tests or deploy anything. Publication replaces only the web image;
the existing API image/revision85ff8f64, database/schema81, telemetry bind, settings
and other containers remain unchanged. Web and API revisions are recorded separately,
not presented as a single rebuilt revision. No additional server-image rebuild,
backup, deletion or API restart is part of this correction.

Evidence/receipts: `.data/web-identity-contrast-20261102/` in the primary checkout.
The existing public registration flag remains false; enabling email registration
was not inferred from the verified-account campaign creation policy. Telegram intake
also stays disabled. Those operational/product boundaries are not silently closed.

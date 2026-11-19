# Legacy HTTPS redirect on the Docker gateway

The legacy host must redirect to the canonical Arken host, preserving path and
query without logging bearer-bearing request targets. The Docker gateway overlay
is `infra/nginx/arken-legacy-edge.conf`; the native installation template and
its loopback TLS listener remain separate and unchanged.

## Bounded manual release

1. Recheck DNS for the legacy host, active gateway mounts/config hash/inode,
   existing certificates, main assets/health, service identities and ledger.
   A certificate for the canonical host does not cover the legacy name.
2. Freeze and review the overlay. Append only its marked HTTP block to the
   existing gateway file, preserving its original prefix and inode. Validate
   `nginx -t`, gracefully reload the existing container and independently check
   an exact temporary HTTP-01 readiness file. Do not recreate the shared edge.
3. Obtain a **separate manual** HTTP-01 certificate using the existing Certbot
   account. Do not change DNS, replace the canonical/wildcard certificate, add
   authentication/deploy hooks, or enable automatic renewal. Never copy private
   keys to the workstation or repository. Do not invoke the native installer:
   its backup and renewal behavior is not this release's authorization.
4. After validating the issued leaf's exact hostname, validity and chain, append
   only the marked HTTPS block. Recheck the staged file hash/inode and existing
   services, validate `nginx -t`, and gracefully reload.
5. Check strict TLS and redirect status/Location from an independent network;
   include ordinary paths and synthetic bearer-shaped/escaped paths. Verify main
   assets, API health/WebSocket, personal-host reachability, unchanged service
   identities, ledger and canonical certificate. Do not use real player tokens.
6. Remove only exact challenge/readiness files created by this operation after
   their names/content have been checked. Record actual certificate expiry and
   manual-renewal requirements. Existing planned canonical/wildcard renewal is
   not completed or rescheduled by this separate legacy-host fix.

## Rollback without a new backup

Record only the existing prefix hash/length/inode and hashes of our appended
blocks. Do not copy the live gateway file, existing keys, databases or campaigns.
Before truncating an appended block, require the exact expected whole-file hash
and the unchanged prefix hash/inode. On drift, stop rather than erasing another
operator's edits. Validate and reload the restored configuration. Existing
certificates, rollback images and backups remain in place.

Local source checks and operational syntax/reload/HTTPS checks are distinct from
CI or full qualification; report every failed stage and the actual runtime scope.

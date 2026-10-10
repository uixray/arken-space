# Claude source-audit correction pool — 2026-10-10

Source reviewed by Claude: public audit b188a1dc7a8b36403f6a36111457e4401da78b47 (application source 8916874). Local baseline 4cf493269a97c48b9c848d50c9b822a7996f7cb6. Source-only report, not runtime acceptance.

## Decisions
- Existing campaign GM/PLAYER links remain enabled beside production account auth. SMTP/registration deferred by owner; no verification bypass.
- Public GitHub excludes licensed WOFF; service image must include exact approved local WOFF, verified after build.
- New server uses target-specific /opt package; old release.sh hardcodes another production root/domain and is not the new-host execution path.
- No deployment before actual current image/runtime, retained migration, independent local restore and rollback gates. Authorization already granted; no repeated deployment approval.

## Connected corrections
- Backup worker: compose manifest/image parity; digest-pinned copied snapshot mapping and offline restore tests.
- Font worker: public CI CSS/token test without private binary; explicit source+dist hash gate; private .data/.env build-context exclusions.
- Package worker: Compose auth flag forwarding and env validation before migration; Docker web post-build font gate. Existing 4cf contexts are preparation only and will be superseded after corrections commit.

## Verified evidence
- Synthetic actual PostgreSQL/Drizzle 57 to58: 58 ordered SQL hashes, replay idempotence, dangling cleanup plus real SET NULL/CASCADE; own resources removed. Not retained-data acceptance.
- DNS A andreykindesign.pserver.space resolves to80.85.154.36. No AAAA address returned. DNS unchanged; HTTPS/host routing still pending.
- Root SSH key not yet accepted; owner given additive authorized_keys instructions with backup. No password logged.

## Timing / next
Correction forecast30-45min, then sequential limited build/runtime/recovery. Earlier package prep produced exact positive contexts but no images; do not count as release. Next: integrate bounded source/test results, commit exact files, regenerate immutable contexts, build sequentially, verify retained-state recovery, then target deployment. All operational docs remain local unless separate public-doc permission is granted.

## Correction source gate results
- Font: public CSS/tokens3PASS, Node2PASS plus actual local font fixtures; explicit post-build hash guard wired into web Dockerfile. Forecast15-20min, actual~7min.
- Release configuration:3PASS; production env rejected by synthetic check with sanitized output, compiled env preflight before migration. No current container-start proof.
- Restore:13PASS/1platformSKIP; synthetic Bash capture7stageassertionsPASS; syntax and whitespacePASS. Real encrypted capture/copy/load remains pending.
- Production domain corrected by owner to arken-khar.space. LiveA remains51.250.26.16; no DNS change until new-host verification. Earlier4cf pserver contexts are historical/stale.
- Exact changed source files belong to the three bounded workers; local operational checkpoints not authorized for public push. Next commit source corrections, regenerate positive contexts from newSHA, build sequentially.

# WAV MIME repair / bounded web smoke — 2026-10-09

Confirmed actual frozen web image 8c0a0f7 served both starter audio files with exact expected bytes; OGG was audio/ogg, WAV was application/octet-stream. Initial finite web smoke therefore FAILED before privacy checks. Do not claim the original image passed the complete web gate.

Root changed only infra/nginx/container.conf: explicit WAV static audio/wav type with strict file existence, leaving sensitive-path privacy rewrite intact. nginx -t passed using exact web image with new config mounted read-only in a separate network-none helper.

Actual corrected-config web container arken-smoke-8c0a0f7-20261009185134483-web-fixed on the owned internal network (no published ports) passed SPA/health, both starter payload comparisons against frozen Git blobs, audio/ogg and audio/wav MIME, normal+encoded synthetic sensitive paths with no-referrer and no synthetic marker in stdout/stderr logs. Graceful stop exit0, no OOM. This is **old image + explicit config override** proof, not a rebuilt image or packaged revision. Private ignored safe receipt remains under root smoke directory; its sourceSha refers to source assets/image, not override identity.

Other Luna map/PATCH dirty files remain preserved. No real data/credentials, external requests, deploy/push/merge. Original failed web container and root PG retained pending ownership-checked cleanup. Latest package must include committed config bytes and a fresh immutable web image; actual gameplay/socket/SMTP/device gates remain unproved.

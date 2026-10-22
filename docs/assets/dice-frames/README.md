# Dice-frame source originals — UIX-457

This is the canonical, repository-relative **source-only** pack for future dice-frame work. It is not a runtime asset library, an upload-ready derivative, or completed UIX-457 functionality.

## Inventory and preservation

- 24 owner-supplied APNG files, retaining the original `.png` extension.
- 28,344,819 bytes in total; 8–151 animation frames per file.
- 23 images are 224 × 224 pixels; `magic-square` is 225 × 225.
- `originals/` contains byte-for-byte copies. No decoding, resizing, optimization, metadata stripping, format conversion, or animation flattening was performed.
- `catalog.json` records stable generic IDs, relative paths, SHA-256, byte sizes, IHDR dimensions, acTL frame/play counts, frame-duration totals, and chunk inventories. `playCount: 0` means infinite looping.
- `checksums.sha256` covers every original. PNG signatures, every chunk CRC, APNG frame-control counts/sequence numbers, and frame bounds were checked during intake on 2026-10-18. Destination bytes and hashes matched their sources; no duplicate hashes were found.
- These are structural and preservation checks, not decoded-frame visual acceptance or runtime/browser performance evidence.

The token-oriented `blood-circle-token` is retained as a source reference, not silently enrolled as a dice-frame choice. Generic filenames do not imply participant assignments or product availability.

## Provenance and publication boundary

Source: owner-supplied local originals, received 2026-10-18. Original creators and licenses have **not** been verified. On 2026-10-18, the owner **approved inclusion of all 24 originals in a public source-only PR**. This publication approval does not verify third-party rights or establish an open license.

Personal original filenames, source-machine paths, and source-to-slug mapping are deliberately absent from the tracked catalog and this document. They are retained only in the operator's ignored local intake evidence. Fourteen originals contain textual or Exif metadata; all embedded metadata is preserved unchanged. Generic filenames and owner publication approval do not replace verification of third-party rights.

The pack lives outside the web public directory and server runtime asset directories. The exact `docs/assets/dice-frames` exclusion in the root `.dockerignore` keeps these source originals and their catalog out of Docker build contexts, including broad `COPY . .` steps. They remain part of the approved public Git source pack, not server-runtime packaging. Other documentation and `scripts/verify-dice-frame-sources.py` are not excluded by this rule; run that verifier against the source checkout, where the pack exists. There are no serving routes, imports, player selections, skill/school bindings, persistence changes, or migrations in this intake. Local availability is confirmed; availability in future clones begins only after the approved source-only PR is actually published. No publication or product integration is claimed by this local receipt.

## Recheck after copying or cloning

From the repository root, run the deterministic Python standard-library verifier (no image libraries, network, or desktop source paths required):

```sh
python scripts/verify-dice-frame-sources.py
```

It checks the exact inventory, catalog/manifest hashes, all PNG chunk CRCs, APNG frame counts/sequence, dimensions, frame bounds and animation metadata without decoding or modifying files. A failure exits nonzero.

For a checksum-only check from this directory:

```sh
sha256sum --check checksums.sha256
```

Every one of the 24 entries must match. Paths in the catalog and manifest are relative to this directory and require no desktop folder or private source mapping.

## Before product integration

Keep these originals immutable and create any derivatives separately. The earlier UIX-457 investigation found that the then-current sharp path flattened APNG to a single frame; do not assume an upload/conversion path preserves animation. Select and qualify an animation-aware delivery/derivative strategy independently, including all frames, reduced motion, loading cost, and applicable rights. Source precedence already has a contract helper/test, but player/skill/school persistence, configuration UI, and runtime application remain separate work.

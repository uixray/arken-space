"""Verify the source-only UIX-457 APNG pack without decoding or modifying images."""

import collections
import hashlib
import json
from pathlib import Path
import re
import struct
import sys
import zlib


PACK = Path(__file__).resolve().parents[1] / "docs/assets/dice-frames"


def require(condition, message):
    if not condition:
        raise ValueError(message)


def inspect_apng(data):
    require(data[:8] == b"\x89PNG\r\n\x1a\n", "Invalid PNG signature")
    offset, chunks, frames, sequence = 8, [], [], []
    width = height = frame_count = play_count = None
    depth = color_type = interlace = None
    while offset < len(data):
        require(offset + 12 <= len(data), "Truncated chunk header")
        length = struct.unpack_from(">I", data, offset)[0]
        kind = data[offset + 4:offset + 8]
        payload = data[offset + 8:offset + 8 + length]
        require(offset + 12 + length <= len(data), "Truncated PNG chunk")
        crc = struct.unpack_from(">I", data, offset + 8 + length)[0]
        require(zlib.crc32(kind + payload) & 0xffffffff == crc, "PNG CRC mismatch")
        chunks.append(kind.decode("ascii"))
        if kind == b"IHDR":
            require(length == 13 and width is None, "Invalid or duplicate IHDR")
            width, height, depth, color_type, compression, filtering, interlace = struct.unpack(
                ">IIBBBBB", payload
            )
            require(width and height and compression == filtering == 0, "Invalid IHDR")
        elif kind == b"acTL":
            require(length == 8 and frame_count is None and "IDAT" not in chunks, "Invalid acTL")
            frame_count, play_count = struct.unpack(">II", payload)
            require(frame_count > 0, "Empty APNG animation")
        elif kind == b"fcTL":
            require(length == 26 and frame_count is not None, "Invalid fcTL")
            n, fw, fh, x, y, numerator, denominator, dispose, blend = struct.unpack(
                ">IIIIIHHBB", payload
            )
            require(width is not None and height is not None, "fcTL precedes IHDR")
            require(fw > 0 and fh > 0 and x + fw <= width and y + fh <= height, "Frame outside canvas")
            require(dispose in (0, 1, 2) and blend in (0, 1), "Invalid frame operations")
            sequence.append(n)
            frames.append(numerator / (denominator or 100) * 1000)
        elif kind == b"fdAT":
            require(length >= 4 and frames, "Invalid fdAT")
            sequence.append(struct.unpack_from(">I", payload)[0])
        offset += length + 12
        if kind == b"IEND":
            require(length == 0 and offset == len(data), "Trailing PNG bytes")
            break
    require(chunks and chunks[0] == "IHDR" and chunks[-1] == "IEND", "Missing PNG boundary chunks")
    require("IDAT" in chunks, "Missing PNG image data")
    require(frame_count is not None and frame_count == len(frames), "acTL/fcTL frame count mismatch")
    require(sequence == list(range(len(sequence))), "APNG sequence mismatch")
    return {
        "format": "APNG", "width": width, "height": height, "bitDepth": depth,
        "colorType": color_type, "interlace": interlace, "frameCount": frame_count,
        "playCount": play_count, "oneCycleDurationMs": round(sum(frames), 3),
        "chunkCounts": dict(sorted(collections.Counter(chunks).items())),
    }


def verify_pack(pack=PACK):
    catalog = json.loads((pack / "catalog.json").read_text(encoding="utf-8"))
    require(catalog["schemaVersion"] == 1, "Unsupported catalog schema")
    assets = catalog["assets"]
    require(catalog["fileCount"] == len(assets) == 24, "Expected exactly 24 source assets")
    manifest = {}
    for line in (pack / "checksums.sha256").read_text(encoding="ascii").splitlines():
        match = re.fullmatch(r"([a-f0-9]{64})  (originals/[a-z0-9-]+\.png)", line)
        require(match is not None, "Invalid checksum manifest entry")
        sha, file = match.groups()
        require(file not in manifest, "Duplicate checksum manifest path")
        manifest[file] = sha
    require(len(manifest) == 24, "Expected exactly 24 checksum entries")
    seen_ids, seen_paths, hashes = set(), set(), set()
    total_bytes = 0
    for asset in assets:
        slug, file = asset["id"], asset["file"]
        require(re.fullmatch(r"[a-z0-9]+(?:-[a-z0-9]+)*", slug) is not None, "Invalid generic asset ID")
        require(file == f"originals/{slug}.png", "Noncanonical source path")
        require(slug not in seen_ids and file not in seen_paths, "Duplicate catalog entry")
        seen_ids.add(slug)
        seen_paths.add(file)
        path = pack / file
        require(not path.is_symlink() and path.resolve().is_relative_to(pack.resolve()), "Source escapes pack")
        data = path.read_bytes()
        sha = hashlib.sha256(data).hexdigest()
        require(sha == asset["sha256"] == manifest.get(file), f"{slug}: SHA-256 mismatch")
        require(len(data) == asset["bytes"], f"{slug}: byte count mismatch")
        require(sha not in hashes, "Unexpected duplicate source bytes")
        hashes.add(sha)
        for key, value in inspect_apng(data).items():
            require(asset.get(key) == value, f"{slug}: catalog {key} mismatch")
        total_bytes += len(data)
    actual_paths = {p.relative_to(pack).as_posix() for p in (pack / "originals").rglob("*") if p.is_file()}
    require(actual_paths == seen_paths == set(manifest), "Source/catalog/manifest inventory mismatch")
    require(total_bytes == catalog["totalBytes"], "Catalog total byte count mismatch")
    return {"files": len(assets), "totalBytes": total_bytes, "sha256": "PASS", "apngStructure": "PASS"}


if __name__ == "__main__":
    try:
        print(json.dumps(verify_pack(), sort_keys=True))
    except (ValueError, KeyError, OSError, TypeError, struct.error) as error:
        print(f"Dice-frame source verification failed: {error}", file=sys.stderr)
        sys.exit(1)

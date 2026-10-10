import assert from "node:assert/strict";
import fs from "node:fs";
import process from "node:process";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
const hash = (path) =>
  createHash("sha256").update(fs.readFileSync(path)).digest("hex");
assert.equal(process.arch, "x64");
const manifest = JSON.parse(
  fs.readFileSync("/opt/arken-native/native-runtime-manifest.json", "utf8"),
);
assert.equal(manifest.arch, "x64");
assert.equal(manifest.elfMachine, 62);
assert.equal(manifest.maxDimension, 65500);
assert.equal(manifest.heifPluginLoading, false);
for (const [name, version] of Object.entries({
  sharp: "0.35.4",
  vips: "8.18.6",
  heif: "1.23.2",
  uhdr: "2.0.2",
}))
  assert.equal(manifest.versions[name], version);
for (const [name, source] of Object.entries({
  vips: "3c41e1d5458081bfa4a5bc54e116c46259c75c6760a18027764555632b9dda3e",
  heif: "8bd5d41d19dc84536d118b04774709f244df6104ef66d623dad5fa4650143405",
  uhdr: "5a7b6347a4a32c6936b81392cd6394250649380202f86c8214042aa645cc385c",
}))
  assert.equal(manifest.sources[name], source);
for (const name of ["vips", "vips-cpp", "heif", "uhdr", "vips-heif"])
  assert.ok(
    manifest.nativeLibraries[name],
    "Required native component missing",
  );
const sharp = createRequire("/app/apps/server/package.json")("sharp");
assert.equal(sharp.versions.sharp, "0.35.4");
assert.equal(sharp.versions.vips, "8.18.6");
sharp.concurrency(1);
await sharp({ create: { width: 1, height: 1, channels: 3, background: "red" } })
  .avif()
  .toBuffer();
const addon = fs.realpathSync(
  "/app/apps/server/node_modules/sharp/src/build/Release/sharp-linux-x64-0.35.4.node",
);
const elf = fs.readFileSync(addon);
assert.equal(elf.subarray(0, 4).toString("hex"), "7f454c46");
assert.equal(elf[4], 2);
assert.equal(elf[5], 1);
assert.equal(elf.readUInt16LE(18), 62);
assert.equal(hash(addon), manifest.addonSha256);
const maps = fs.readFileSync("/proc/self/maps", "utf8");
assert.ok(maps.includes(addon), "Reviewed addon not actually loaded");
for (const entry of Object.values(manifest.nativeLibraries)) {
  const path = fs.realpathSync(entry.path);
  assert.ok(maps.includes(path), "Reviewed library not actually loaded");
  assert.equal(hash(path), entry.sha256);
}

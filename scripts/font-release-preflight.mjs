import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const EXPECTED_FONT_SHA256 =
  "7b4e50ec50c782077ee147ca5d8db8c4843bc7dd72ff8f133c2458e45347252d";
const fontRelativePath = "assets/pragmatica-next_vf.woff";
export async function verifyReleaseFont({ sourceRoot, distRoot }) {
  for (const [label, root] of [
    ["private source", sourceRoot],
    ["built dist", distRoot],
  ]) {
    const path = resolve(root, fontRelativePath);
    let bytes;
    try {
      bytes = await readFile(path);
    } catch {
      throw new Error(`Missing required ${label} font: ${path}`);
    }
    if (bytes.toString("ascii", 0, 4) !== "wOFF")
      throw new Error(`Invalid WOFF signature: ${label}`);
    const hash = createHash("sha256").update(bytes).digest("hex");
    if (hash !== EXPECTED_FONT_SHA256)
      throw new Error(`Font SHA-256 mismatch: ${label}`);
  }
  return {
    font: fontRelativePath,
    sha256: EXPECTED_FONT_SHA256,
    sourceVerified: true,
    distVerified: true,
  };
}
if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const args = process.argv.slice(2);
  if (args.length !== 0 && args.length !== 2) {
    console.error(
      "Usage: node scripts/font-release-preflight.mjs [public-root dist-root]",
    );
    process.exitCode = 1;
  } else {
    try {
      console.log(
        JSON.stringify(
          await verifyReleaseFont({
            sourceRoot: args[0] ?? "apps/web/public",
            distRoot: args[1] ?? "apps/web/dist",
          }),
        ),
      );
    } catch (error) {
      console.error(error.message);
      process.exitCode = 1;
    }
  }
}

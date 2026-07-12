import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

let root: string;
let openStoredFile: typeof import("../apps/server/src/storage.js").openStoredFile;

beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), "arken-storage-"));
  process.env.MEDIA_ROOT = root;
  ({ openStoredFile } = await import("../apps/server/src/storage.js"));
  await writeFile(join(root, "track.mp3"), Buffer.from("0123456789"));
});

afterAll(async () => {
  await rm(root, { recursive: true, force: true });
});

async function streamText(stream: NodeJS.ReadableStream) {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks).toString("utf8");
}

describe("media range responses", () => {
  it("returns the requested inclusive byte range", async () => {
    const file = await openStoredFile("track.mp3", "bytes=2-5");
    expect(file).toMatchObject({ partial: true, start: 2, end: 5, size: 10 });
    await expect(streamText(file.stream)).resolves.toBe("2345");
  });

  it("supports seeking from an offset to the end", async () => {
    const file = await openStoredFile("track.mp3", "bytes=7-");
    expect(file).toMatchObject({ partial: true, start: 7, end: 9, size: 10 });
    await expect(streamText(file.stream)).resolves.toBe("789");
  });

  it("rejects invalid ranges and storage traversal", async () => {
    await expect(openStoredFile("track.mp3", "bytes=20-")).rejects.toThrow(
      "INVALID_RANGE",
    );
    await expect(openStoredFile("../secret", undefined)).rejects.toThrow(
      "INVALID_STORAGE_KEY",
    );
  });
});

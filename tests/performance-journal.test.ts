import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  createPerformanceJournal,
  RETENTION_MS,
} from "../apps/server/src/performance-journal.js";

const directories: string[] = [];
async function directory() {
  const dir = await mkdtemp(join(tmpdir(), "arken-performance-"));
  directories.push(dir);
  return dir;
}
afterEach(async () => {
  await Promise.all(
    directories
      .splice(0)
      .map((dir) => rm(dir, { recursive: true, force: true })),
  );
});
const names = async (dir: string) =>
  (await readdir(dir)).filter((name) => name.startsWith("performance-"));
describe("persistent performance journal", () => {
  it("retains old records across writer recreation and serializes concurrent appends", async () => {
    const dir = await directory();
    const first = createPerformanceJournal({ directory: dir, minFreeBytes: 0 });
    await Promise.all(
      Array.from({ length: 10 }, (_, id) => first.append({ id })),
    );
    const next = createPerformanceJournal({ directory: dir, minFreeBytes: 0 });
    await next.append({ id: 10 });
    const lines = (
      await Promise.all(
        (await names(dir)).map((name) => readFile(join(dir, name), "utf8")),
      )
    )
      .flatMap((text) => text.trim().split("\n"))
      .map((line) => JSON.parse(line));
    expect(lines.map((row) => row.id).sort((a, b) => a - b)).toEqual(
      Array.from({ length: 11 }, (_, i) => i),
    );
  });
  it("rotates at the size cap, expires own segments, and preserves unrelated files", async () => {
    const dir = await directory();
    let now = 1_800_000_000_000;
    const writer = createPerformanceJournal({
      directory: dir,
      minFreeBytes: 0,
      now: () => now,
      maxBytes: 100,
      segmentBytes: 60,
    });
    await writeFile(join(dir, "keep.txt"), "keep");
    for (let id = 0; id < 10; id++) {
      now++;
      await writer.append({ id, value: "1234567890" });
    }
    const total = (
      await Promise.all(
        (await names(dir)).map((name) => readFile(join(dir, name))),
      )
    ).reduce((sum, b) => sum + b.length, 0);
    expect(total).toBeLessThanOrEqual(100);
    now += RETENTION_MS + 1;
    await writer.maintenance();
    expect(await names(dir)).toEqual([]);
    expect(await readFile(join(dir, "keep.txt"), "utf8")).toBe("keep");
  });
  it("rejects writes below the reserve without poisoning the next queued operation", async () => {
    const dir = await directory();
    const writer = createPerformanceJournal({
      directory: dir,
      minFreeBytes: Number.MAX_SAFE_INTEGER,
    });
    await expect(writer.append({ id: 1 })).rejects.toThrow(
      "PERFORMANCE_DISK_RESERVE",
    );
    await writer.maintenance();
    expect(await names(dir)).toEqual([]);
  });
  it("does not append after an incomplete record from an earlier process", async () => {
    const dir = await directory();
    const old = `performance-${Date.now()}-11111111-1111-4111-8111-111111111111.jsonl`;
    await writeFile(join(dir, old), '{"partial":');
    await createPerformanceJournal({ directory: dir, minFreeBytes: 0 }).append({
      complete: true,
    });
    expect(await readFile(join(dir, old), "utf8")).toBe('{"partial":');
    expect((await names(dir)).length).toBe(2);
  });
});

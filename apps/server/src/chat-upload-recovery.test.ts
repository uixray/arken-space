import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { ChatUploadRecovery } from "./chat-upload-recovery.js";
import { createChatUploadLease } from "./chat-upload-lease.js";
const roots: string[] = [],
  workers: ChatUploadRecovery[] = [];
afterEach(async () => {
  for (const worker of workers.splice(0)) await worker.stop();
  for (const root of roots.splice(0)) {
    if (!root.startsWith(resolve(tmpdir(), "arken-chat-recovery-")))
      throw Error("Unsafe test cleanup");
    await rm(root, { recursive: true, force: true });
  }
});
async function fixture() {
  const root = await mkdtemp(resolve(tmpdir(), "arken-chat-recovery-"));
  roots.push(root);
  return root;
}
function worker(options: ConstructorParameters<typeof ChatUploadRecovery>[0]) {
  const result = new ChatUploadRecovery(options);
  workers.push(result);
  return result;
}
describe("bounded upload recovery", () => {
  it("accepts a missing journal directory and stops idempotently", async () => {
    const reconcile = vi.fn();
    const w = worker({ root: await fixture(), reconcile });
    expect((await w.runOnce()).scanned).toBe(0);
    await w.stop();
    await w.stop();
    expect((await w.runOnce()).scanned).toBe(0);
    expect(reconcile).not.toHaveBeenCalled();
  });
  it("walks past invalid and fresh records with a persistent bounded cursor", async () => {
    const root = await fixture(),
      campaign = randomUUID();
    for (let i = 0; i < 8; i++) await createChatUploadLease(root, campaign);
    const old = await createChatUploadLease(root, campaign);
    await writeFile(
      resolve(root, "chat-upload-leases", `${old.id}.json`),
      JSON.stringify({ ...old, createdAt: "2000-01-01T00:00:00.000Z" }),
    );
    await writeFile(resolve(root, "chat-upload-leases", "invalid.json"), "{");
    const reconcile = vi.fn().mockResolvedValue("PENDING");
    const w = worker({ root, reconcile, scanLimit: 2, workLimit: 1 });
    let scanned = 0;
    for (let i = 0; i < 8; i++) {
      const stats = await w.runOnce();
      expect(stats.scanned).toBeLessThanOrEqual(2);
      scanned += stats.scanned;
    }
    expect(scanned).toBeGreaterThanOrEqual(10);
    expect(reconcile).toHaveBeenCalledWith(
      campaign,
      `chat-files/${old.id}/content.webp`,
    );
  });
  it("deduplicates overlapping passes and stop waits for the active pass", async () => {
    const root = await fixture();
    await createChatUploadLease(root, randomUUID());
    let release!: (value: "PENDING") => void;
    let entered!: () => void;
    const entry = new Promise<void>((r) => {
      entered = r;
    });
    const reconcile = vi.fn(() => {
      entered();
      return new Promise<"PENDING">((r) => {
        release = r;
      });
    });
    const w = worker({ root, reconcile, graceMs: 0 });
    const first = w.runOnce();
    await entry;
    expect(w.runOnce()).toBe(first);
    let stopped = false;
    const stop = w.stop().then(() => {
      stopped = true;
    });
    await Promise.resolve();
    expect(stopped).toBe(false);
    release("PENDING");
    await stop;
    expect(reconcile).toHaveBeenCalledTimes(1);
  });
});

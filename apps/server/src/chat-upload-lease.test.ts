import { afterEach, describe, expect, it } from "vitest";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { randomUUID } from "node:crypto";
import {
  chatLeaseStorageKey,
  createChatUploadLease,
  finishChatUploadLease,
  readChatUploadLease,
  writeChatUploadLease,
} from "./chat-upload-lease.js";

const roots: string[] = [];
afterEach(async () => {
  for (const root of roots.splice(0)) {
    if (!root.startsWith(resolve(tmpdir(), "arken-chat-lease-")))
      throw Error("Unsafe test cleanup");
    await rm(root, { recursive: true, force: true });
  }
});
async function fixture() {
  const root = await mkdtemp(resolve(tmpdir(), "arken-chat-lease-"));
  roots.push(root);
  return root;
}
describe("durable chat upload journal primitives", () => {
  it("persists a bounded journal before data and finalizes without deleting referenced bytes", async () => {
    const root = await fixture(),
      campaign = randomUUID();
    const lease = await createChatUploadLease(root, campaign);
    expect(await readChatUploadLease(root, `${lease.id}.json`)).toEqual(lease);
    const dataPath = resolve(root, chatLeaseStorageKey(lease.id));
    await expect(readFile(dataPath)).rejects.toMatchObject({ code: "ENOENT" });
    await writeChatUploadLease(root, lease, Buffer.from("image"));
    await expect(
      writeChatUploadLease(root, lease, Buffer.from("replace")),
    ).rejects.toMatchObject({ code: "EEXIST" });
    await finishChatUploadLease(root, lease.id);
    await finishChatUploadLease(root, lease.id);
    expect((await readFile(dataPath)).toString()).toBe("image");
  });
  it("rejects path injection and case aliases", async () => {
    const root = await fixture();
    expect(() => chatLeaseStorageKey("../outside")).toThrow(
      "INVALID_CHAT_LEASE",
    );
    expect(() =>
      chatLeaseStorageKey("AAAAAAAA-AAAA-AAAA-AAAA-AAAAAAAAAAAA"),
    ).toThrow();
    expect(await readChatUploadLease(root, "../outside.json")).toBeNull();
  });
  it("preserves malformed, oversized, mismatched and foreign-version records", async () => {
    const root = await fixture(),
      lease = await createChatUploadLease(root, randomUUID());
    const marker = resolve(root, "chat-upload-leases", `${lease.id}.json`);
    for (const data of [
      "{",
      "x".repeat(2049),
      JSON.stringify({ ...lease, id: randomUUID() }),
      JSON.stringify({ ...lease, version: 2 }),
      JSON.stringify({ ...lease, storageKey: "../secret" }),
    ]) {
      await writeFile(marker, data);
      expect(await readChatUploadLease(root, `${lease.id}.json`)).toBeNull();
      expect(await readFile(marker, "utf8")).toBe(data);
    }
  });
});

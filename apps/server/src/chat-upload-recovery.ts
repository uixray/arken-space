import type { Dir } from "node:fs";
import { opendir } from "node:fs/promises";
import { resolve } from "node:path";
import {
  chatLeaseStorageKey,
  readChatUploadLease,
} from "./chat-upload-lease.js";

type Outcome = "REMOVED" | "REFERENCED" | "PENDING";
type Stats = {
  scanned: number;
  invalid: number;
  fresh: number;
  removed: number;
  referenced: number;
  pending: number;
};

/** Cursor survives bounded passes: invalid or fresh records cannot starve later
 * records. Only the journal namespace is visited; committed media is not scanned. */
export class ChatUploadRecovery {
  private directory?: Dir;
  private flight?: Promise<Stats>;
  private timer?: ReturnType<typeof setInterval>;
  private stopped = false;
  constructor(
    private readonly options: {
      root: string;
      reconcile: (campaignId: string, storageKey: string) => Promise<Outcome>;
      now?: () => number;
      graceMs?: number;
      scanLimit?: number;
      workLimit?: number;
    },
  ) {}

  runOnce(): Promise<Stats> {
    if (this.flight) return this.flight;
    this.flight = this.scan().finally(() => {
      this.flight = undefined;
    });
    return this.flight;
  }

  private async scan(): Promise<Stats> {
    const stats: Stats = {
      scanned: 0,
      invalid: 0,
      fresh: 0,
      removed: 0,
      referenced: 0,
      pending: 0,
    };
    if (this.stopped) return stats;
    try {
      this.directory ??= await opendir(
        resolve(this.options.root, "chat-upload-leases"),
      );
      let work = 0;
      while (
        stats.scanned < (this.options.scanLimit ?? 256) &&
        work < (this.options.workLimit ?? 25)
      ) {
        const entry = await this.directory.read();
        if (!entry) {
          await this.directory.close();
          this.directory = undefined;
          break;
        }
        stats.scanned++;
        if (!entry.isFile() || entry.isSymbolicLink()) {
          stats.invalid++;
          continue;
        }
        try {
          const lease = await readChatUploadLease(
            this.options.root,
            entry.name,
          );
          if (!lease) {
            stats.invalid++;
            continue;
          }
          const age =
            (this.options.now?.() ?? Date.now()) - Date.parse(lease.createdAt);
          if (age < (this.options.graceMs ?? 120000)) {
            stats.fresh++;
            continue;
          }
          work++;
          const result = await this.options.reconcile(
            lease.campaignId,
            chatLeaseStorageKey(lease.id),
          );
          if (result === "REMOVED") stats.removed++;
          else if (result === "REFERENCED") stats.referenced++;
          else stats.pending++;
        } catch (error) {
          // A concurrent successful request may already have removed its marker.
          if ((error as NodeJS.ErrnoException)?.code !== "ENOENT")
            stats.pending++;
        }
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException)?.code !== "ENOENT") {
        stats.pending++;
        await this.directory?.close().catch(() => {});
        this.directory = undefined;
      }
    }
    return stats;
  }

  start() {
    if (this.timer || this.stopped) return;
    const tick = () => {
      void this.runOnce().catch(() => {
        process.emitWarning("chat_upload.recovery_pending", {
          code: "ARKEN_CHAT_UPLOAD_RECOVERY_PENDING",
        });
      });
    };
    tick();
    this.timer = setInterval(tick, 30000);
    this.timer.unref();
  }

  async stop() {
    this.stopped = true;
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
    await this.flight;
    await this.directory?.close();
    this.directory = undefined;
  }
}

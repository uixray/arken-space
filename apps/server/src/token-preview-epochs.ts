import { randomUUID } from "node:crypto";

/** Ephemeral process-local preview barrier. A restart changes all epochs. */
export class TokenPreviewEpochs {
  private readonly epochs = new Map<string, string>();
  private readonly visible = new Map<string, { campaignId: string; ids: Set<string> }>();
  current(campaignId: string): string {
    let epoch = this.epochs.get(campaignId);
    if (!epoch) { epoch = randomUUID(); this.epochs.set(campaignId, epoch); }
    return epoch;
  }
  forget(socket: string): void { this.visible.delete(socket); }
  snapshot(socket: string, campaignId: string, ids: Iterable<string>): { epoch: string; changed: boolean } {
    const next = new Set(ids);
    const previous = this.visible.get(socket);
    const changed = !!previous && previous.campaignId === campaignId && [...previous.ids].some(id => !next.has(id));
    if (changed) this.epochs.set(campaignId, randomUUID());
    this.visible.set(socket, { campaignId, ids: next });
    return { epoch: this.current(campaignId), changed };
  }
}
export const tokenPreviewEpochs = new TokenPreviewEpochs();

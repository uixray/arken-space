import type { ServerToClientEvents } from "@arken/contracts";
type Movement = Parameters<ServerToClientEvents["token:moving"]>[0];
type Entry = { sequence: number; at: number; movement: Movement };
/** Ephemeral hints only: no credentials, snapshots, durable commands or auto-replay. */
export class LocalTokenPreviewBuffer {
  private nextSequence = 0;
  private readonly campaigns = new Map<
    string,
    { sequence: number; floor: number; entries: Entry[] }
  >();
  constructor(private readonly now: () => number = Date.now) {}
  publish(campaignId: string, movement: Movement) {
    let state = this.campaigns.get(campaignId);
    if (!state) {
      if (this.campaigns.size >= 256)
        this.campaigns.delete(this.campaigns.keys().next().value!);
      state = { sequence: this.nextSequence, floor:this.nextSequence, entries: [] };
      this.campaigns.set(campaignId, state);
    }
    state.entries = state.entries.filter(entry=>{if(this.now()-entry.at<3000)return true;state.floor=Math.max(state.floor,entry.sequence);return false;});
    state.sequence = ++this.nextSequence;
    state.entries.push({
      sequence: state.sequence,
      at: this.now(),
      movement: { ...movement },
    });
    if(state.entries.length>128){const removed=state.entries.splice(0,state.entries.length-128);state.floor=Math.max(state.floor,removed.at(-1)!.sequence);}
  }
  read(campaignId: string, after: number) {
    const state = this.campaigns.get(campaignId);
    if (!state)
      return { cursor: 0, reset: after !== 0, entries: [] as Entry[] };
    state.entries = state.entries.filter(entry=>{if(this.now()-entry.at<3000)return true;state.floor=Math.max(state.floor,entry.sequence);return false;});
    const reset = after > state.sequence || (after !== 0 && after < state.floor);
    return {
      cursor: state.sequence,
      reset,
      entries: reset
        ? []
        : state.entries.filter((entry) => entry.sequence > after),
    };
  }
}
export const localTokenPreviews = new LocalTokenPreviewBuffer();

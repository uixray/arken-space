import {
  localPreviewPollSchema,
  type LocalPreviewBatch,
} from "@arken/contracts";
import { withLocalPeer } from "./local-session-authority.js";
import { tokenPreviewForRecipient } from "./realtime.js";
import { localTokenPreviews } from "./local-token-preview-buffer.js";
import { tokenPreviewEpochs } from "./token-preview-epochs.js";
type Database = ReturnType<typeof import("@arken/db").createDatabase>["db"];
/** Thin response: no GM snapshot/rooms. Revoke and current fog checks share a fence. */
export async function pollLocalTokenPreviews(
  db: Database,
  input: unknown,
): Promise<LocalPreviewBatch> {
  const request = localPreviewPollSchema.parse(input);
  return withLocalPeer(db, request.peer, async (tx, auth, authority) => {
    const batch = localTokenPreviews.read(auth.campaignId, request.cursor),
      epoch = tokenPreviewEpochs.current(auth.campaignId);
    const events: LocalPreviewBatch["events"] = [];
    // A missed hint burst triggers canonical resync instead of replaying an old drag.
    const reset = batch.reset || batch.entries.length > 32;
    if (!reset)
      for (const entry of batch.entries) {
        const event = await tokenPreviewForRecipient(tx, auth, entry.movement);
        if (event) events.push(event);
      }
    const currentEpoch=tokenPreviewEpochs.current(auth.campaignId),epochChanged=currentEpoch!==epoch;
    return {
      authority,
      membershipId: auth.membershipId,
      epoch:currentEpoch,
      cursor: batch.cursor,
      reset:reset||epochChanged,
      events:epochChanged?[]:events,
    };
  });
}

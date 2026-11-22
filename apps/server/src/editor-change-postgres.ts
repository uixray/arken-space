import { sql } from "drizzle-orm";
import type {
  EditorChange,
  EditorDraft,
  EditorTransaction,
} from "./editor-change.js";

type Database = ReturnType<typeof import("@arken/db").createDatabase>["db"];
type Transaction = Parameters<Parameters<Database["transaction"]>[0]>[0];
type TargetOperations = Pick<EditorTransaction, "read" | "write">;

/**
 * Bind entity reads and writes to the same transaction as the editor ledger.
 * Target adapters own domain validation and revision comparison on writes.
 */
export function postgresEditorTransaction(
  tx: Transaction,
  targets: TargetOperations,
): EditorTransaction {
  return {
    read: targets.read,
    write: targets.write,
    async lockDraft(campaignId, id) {
      const rows = await tx.execute<{ draft: EditorDraft }>(sql`
        select draft from editor_changes
        where campaign_id = ${campaignId} and id = ${id}
        for update
      `);
      return rows[0]?.draft ?? null;
    },
    async saveDraft(draft) {
      await tx.execute(sql`
        insert into editor_changes (id, campaign_id, draft)
        values (${draft.id}, ${draft.target.campaignId}, ${JSON.stringify(draft)}::jsonb)
      `);
    },
    async readChange(campaignId, id) {
      const rows = await tx.execute<{ receipt: EditorChange | null }>(sql`
        select receipt from editor_changes
        where campaign_id = ${campaignId} and id = ${id}
      `);
      return rows[0]?.receipt ?? null;
    },
    async append(change) {
      const rows = await tx.execute<{ id: string }>(sql`
        update editor_changes
        set receipt = ${JSON.stringify(change)}::jsonb, confirmed_at = now()
        where campaign_id = ${change.target.campaignId} and id = ${change.id}
          and receipt is null
        returning id
      `);
      if (rows.length !== 1) throw new Error("EDITOR_LEDGER_WRITE_FAILED");
    },
  };
}

export async function listEditorHistory(
  db: Database,
  campaignId: string,
  target: { kind: EditorChange["target"]["kind"]; id: string },
) {
  const rows = await db.execute<{
    receipt: EditorChange;
    confirmed_at: Date;
  }>(sql`
    select receipt, confirmed_at from editor_changes
    where campaign_id = ${campaignId} and confirmed_at is not null
      and draft #>> '{target,kind}' = ${target.kind}
      and draft #>> '{target,id}' = ${target.id}
    order by confirmed_at desc, id desc limit 50
  `);
  return rows.map(({ receipt, confirmed_at }) => ({
    ...receipt,
    confirmedAt: confirmed_at,
  }));
}

import {LAYERED_DRAWING_KINDS} from "./drawing-kinds.js";
import {actionJournal,tokens,tokenDefinitions,tokenControllers} from "@arken/db";
import {and,asc,eq,inArray} from "drizzle-orm";
type CanvasTransaction=import("./campaign-pause-guard.js").CampaignCanvasTransaction;
/** History ownership is not a permanent grant of control over a token. */
export async function playerCanReplayTokens(
  tx: CanvasTransaction,
  command: typeof actionJournal.$inferSelect,
  campaignId: string,
  membershipId: string,
) {
  if (command.targetType !== "TOKEN" && command.targetType !== "CANVAS_BULK")
    return true;
  const record = (value: unknown): Record<string, unknown> | null =>
    value && typeof value === "object" && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : null;
  const historical = new Map<string, Record<string, unknown>>();
  if (command.targetType === "TOKEN") {
    for (const value of [command.before, command.after]) {
      const row = record(value);
      if (row && typeof row.definitionId === "string")
        historical.set(command.targetId, row);
    }
  } else {
    for (const value of [command.before, command.after]) {
      const snapshot = record(value);
      if (!snapshot || !Array.isArray(snapshot.tokens)) return false;
      for (const value of snapshot.tokens) {
        const row = record(value);
        if (
          !row ||
          typeof row.id !== "string" ||
          typeof row.definitionId !== "string"
        )
          return false;
        historical.set(row.id, row);
      }
    }
  }
  const ids =
    command.targetType === "TOKEN"
      ? [command.targetId]
      : [...historical.keys()];
  if (!ids.length) return true;
  const current = await tx.select().from(tokens).where(inArray(tokens.id, ids));
  const currentById = new Map(current.map((row) => [row.id, row]));
  const definitionIds = new Set<string>();
  for (const id of ids) {
    const row = currentById.get(id) ?? historical.get(id);
    if (
      !row ||
      typeof row.definitionId !== "string" ||
      row.sceneId !== command.sceneId ||
      row.visible !== true ||
      row.layer !== "PLAYER" ||
      (row.locked !== false && command.type !== "TOKEN_CONDITIONS")
    )
      return false;
    definitionIds.add(row.definitionId);
  }
  const ordered = [...definitionIds].sort();
  const definitions = await tx
    .select({ id: tokenDefinitions.id })
    .from(tokenDefinitions)
    .where(
      and(
        eq(tokenDefinitions.campaignId, campaignId),
        inArray(tokenDefinitions.id, ordered),
      ),
    )
    .orderBy(asc(tokenDefinitions.id))
    .for("share");
  if (definitions.length !== ordered.length) return false;
  const controllers = await tx
    .select({ id: tokenControllers.tokenDefinitionId })
    .from(tokenControllers)
    .where(
      and(
        inArray(tokenControllers.tokenDefinitionId, ordered),
        eq(tokenControllers.membershipId, membershipId),
      ),
    );
  const controlled = new Set(controllers.map((row) => row.id));
  return ordered.every((id) => controlled.has(id));
}


export function historyContainsStamp(command: typeof actionJournal.$inferSelect) {
  const snapshots = [command.before, command.after];
  if (command.targetType === "DRAWING")
    return snapshots.some(
      (snapshot) =>
        typeof snapshot === "object" &&
        snapshot !== null &&
        "kind" in snapshot &&
        LAYERED_DRAWING_KINDS.includes(snapshot.kind),
    );
  if (command.targetType !== "CANVAS_BULK") return false;
  return snapshots.some((snapshot) => {
    if (
      typeof snapshot !== "object" ||
      snapshot === null ||
      !("drawings" in snapshot)
    )
      return false;
    const rows = snapshot.drawings;
    return (
      Array.isArray(rows) &&
      rows.some(
        (row) =>
          typeof row === "object" &&
          row !== null &&
          "kind" in row &&
          LAYERED_DRAWING_KINDS.includes(row.kind),
      )
    );
  });
}

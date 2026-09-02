import { randomUUID } from "node:crypto";
import {
  tokensInBattleZone,
  type BattleZone,
  type InitiativeParticipant,
} from "@arken/contracts";
import { scenes, tokens } from "@arken/db";
import { and, eq } from "drizzle-orm";
import { recruitFromZone } from "./initiative.js";

type Database = ReturnType<typeof import("@arken/db").createDatabase>["db"];
type StoredInitiativeParticipant = Omit<InitiativeParticipant, "pinned"> & {
  pinned?: boolean;
};
type StoredInitiativeOrder = StoredInitiativeParticipant[];

/**
 * Собирает очередь из сохранённого состава и токенов в зоне боя.
 *
 * Возвращает `null`, если сцена зоны больше не принадлежит кампании. Это
 * отличает удалённую/чужую сцену от честной пустой зоны: начинать бой с
 * молчаливо пустой очередью в первом случае нельзя.
 */
export async function recruitFromBattleZone(
  db: Database,
  campaignId: string,
  zone: BattleZone,
  existing: StoredInitiativeOrder,
): Promise<StoredInitiativeOrder | null> {
  const [scene] = await db
    .select({ id: scenes.id })
    .from(scenes)
    .where(and(eq(scenes.id, zone.sceneId), eq(scenes.campaignId, campaignId)))
    .limit(1);
  if (!scene) return null;

  const placed = await db
    .select({
      id: tokens.id,
      sceneId: tokens.sceneId,
      x: tokens.x,
      y: tokens.y,
      width: tokens.width,
      height: tokens.height,
    })
    .from(tokens)
    .where(eq(tokens.sceneId, zone.sceneId));

  return recruitFromZone(
    existing,
    tokensInBattleZone(placed, zone),
    (tokenId) => ({
      id: randomUUID(),
      tokenId,
      // Имя наследуется от токена, а не копируется: переименование дойдёт до
      // очереди само (UIX-400).
      name: null,
      initiative: null,
      pinned: false,
    }),
  );
}

import type { FastifyInstance } from "fastify";
import { createHash } from "node:crypto";
import { and, eq, inArray, or } from "drizzle-orm";
import { z } from "zod";
import {
  campaignClockCommandSchema,
  renameCampaignSchema,
  setOwnInitiativeSchema,
  setBattleZoneSchema,
  orderInitiative,
  updateInitiativeSchema,
  updateStatLayoutSchema,
  updateCharacterStatLayoutSchema,
  revisionCommandSchema,
} from "@arken/contracts";
import {
  characterControllers,
  campaigns,
  characters,
  chatMessages,
  encounters,
  gameEvents,
  scenes,
  tokens,
  tokenDefinitions,
} from "@arken/db";
import { requireAuth } from "./auth.js";
import { resolveStatLayout } from "./snapshot.js";
import { resolveCharacterStatLayout } from "./character-dto.js";
import {
  rejectDestructiveLayoutChange,
  removedStatKeys,
} from "./stat-layout.js";
import { findAction } from "./action-lookup.js";
import {
  type Resources,
  applyCharacterRest,
  collectCharacterStatReferenceSources,
  collectStatReferenceSources,
} from "./character-rules.js";
import { recruitFromBattleZone } from "./battle-initiative.js";
import {
  campaignRechargeAnchorsNeedReset,
  rechargeCampaignCatalogEntries,
  resetCampaignRechargeAnchors,
} from "./campaign-clock.js";
import { ensureStreamThread } from "./chat.js";
import { normalizeLegacyStats } from "./entry-data.js";

type Database = ReturnType<typeof import("@arken/db").createDatabase>["db"];

/**
 * Campaign state: clock and day, rename, stat layouts (campaign and
 * personal), initiative and the battle zone. Moved out of routes.ts
 * unchanged (legacy cleanup after the 15.10 audit).
 */
export function registerCampaignRoutes(
  app: FastifyInstance,
  db: Database,
  { broadcast }: { broadcast: (campaignId: string) => Promise<void> },
) {
  app.post("/api/campaign/clock", async (request, reply) => {
    const auth = await requireAuth(request, reply, db);
    if (!auth) return;
    if (auth.role !== "GM")
      return reply.code(403).send({ error: "GM_REQUIRED" });
    const body = campaignClockCommandSchema.parse(request.body);
    if (await findAction(db, auth.campaignId, body.actionId))
      return reply.code(200).send({ duplicate: true });
    const [current] = await db
      .select()
      .from(campaigns)
      .where(eq(campaigns.id, auth.campaignId))
      .limit(1);
    if (!current) return reply.code(404).send({ error: "CAMPAIGN_NOT_FOUND" });
    if (current.revision !== body.revision)
      return reply
        .code(409)
        .send({ error: "CAMPAIGN_CONFLICT", revision: current.revision });
    const resetsClock = body.command === "RESET_CLOCK";
    const legacyBattleCommand =
      body.command === "START_BATTLE" || body.command === "END_BATTLE";
    const [activeEncounter] =
      resetsClock || legacyBattleCommand
        ? await db
            .select({ id: encounters.id })
            .from(encounters)
            .where(
              and(
                eq(encounters.campaignId, auth.campaignId),
                eq(encounters.status, "ACTIVE"),
              ),
            )
            .limit(1)
        : [];
    if (legacyBattleCommand && activeEncounter)
      return reply.code(409).send({ error: "ENCOUNTER_ACTIVE" });
    if (resetsClock) {
      if (current.battleActive || activeEncounter)
        return reply.code(409).send({ error: "BATTLE_ACTIVE" });
      const anchorsNeedReset = await campaignRechargeAnchorsNeedReset(
        db,
        auth.campaignId,
      );
      if (
        current.day === 1 &&
        current.battleCounter === 0 &&
        current.initiative.length === 0 &&
        !anchorsNeedReset
      )
        return reply.code(400).send({ error: "CLOCK_ALREADY_RESET" });
    }
    if (body.command === "START_BATTLE" && current.battleActive)
      return reply.code(409).send({ error: "BATTLE_ALREADY_ACTIVE" });
    if (body.command === "END_BATTLE" && !current.battleActive)
      return reply.code(409).send({ error: "BATTLE_NOT_ACTIVE" });
    const advancesDay =
      body.command === "ADVANCE_DAY" || body.command === "LONG_REST";
    const nextDay = resetsClock ? 1 : current.day + (advancesDay ? 1 : 0);
    const nextBattle = resetsClock
      ? 0
      : current.battleCounter + (body.command === "START_BATTLE" ? 1 : 0);
    /**
     * UIX-466 п. 3 — начало боя собирает состав по зоне.
     *
     * Снимок, а не живой состав: вошедший в рамку позже не появляется в очереди
     * сам, вышедший из неё не исчезает. Живой пересчёт означал бы, что случайно
     * задетая мышью фигура меняет порядок ходов посреди хода. Подтянуть
     * опоздавших мастер может отдельным действием.
     *
     * Зона не задана — начало боя работает как раньше: состав собирается рамкой
     * выделения. Отказывать здесь нельзя, иначе бой стал бы невозможен, пока
     * поле не обведено.
     */
    const recruited =
      body.command === "START_BATTLE" && current.battleZone
        ? await recruitFromBattleZone(
            db,
            auth.campaignId,
            current.battleZone,
            current.initiative.map((participant) => ({
              ...participant,
              initiative: null,
            })),
          )
        : null;
    const tableThread = await ensureStreamThread(db, auth.campaignId, "TABLE");
    let result;
    try {
      result = await db.transaction(async (tx) => {
        const [updated] = await tx
          .update(campaigns)
          .set({
            day: nextDay,
            battleActive: resetsClock
              ? false
              : body.command === "START_BATTLE"
                ? true
                : body.command === "END_BATTLE"
                  ? false
                  : current.battleActive,
            battleCounter: nextBattle,
            /**
             * UIX-431: новый бой обнуляет броски, но сохраняет состав.
             *
             * Те же противники часто дерутся снова, и собирать очередь заново
             * каждый раз — работа руками посреди игры. А вот старые числа,
             * оставшись, выглядели бы как уже сделанные броски: мастер повёл бы
             * бой по прошлой инициативе, не заметив подмены.
             *
             * UIX-466: `END_BATTLE` теперь очищает очередь целиком. Прежде она
             * сохранялась — на случай, что состав пригодится снова. На игре это
             * решение не сработало: между боями в очереди оставались убитые и
             * ушедшие, и следующий бой начинался с вычёркивания прошлого. Состав
             * собирается заново — рамкой на карте это несколько секунд.
             */
            initiative: resetsClock
              ? []
              : body.command === "START_BATTLE"
                ? (recruited ??
                  current.initiative.map((participant) => ({
                    ...participant,
                    initiative: null,
                  })))
                : body.command === "END_BATTLE"
                  ? []
                  : current.initiative,
            revision: current.revision + 1,
            updatedAt: new Date(),
          })
          .where(
            and(
              eq(campaigns.id, auth.campaignId),
              eq(campaigns.revision, current.revision),
            ),
          )
          .returning();
        if (!updated) throw new Error("CAMPAIGN_CONFLICT");
        const rechargeTrigger =
          body.command === "ADVANCE_DAY" ||
          body.command === "LONG_REST" ||
          body.command === "END_BATTLE"
            ? body.command
            : null;
        const recharged = rechargeTrigger
          ? await rechargeCampaignCatalogEntries(tx, auth.campaignId, {
              trigger: rechargeTrigger,
              day: nextDay,
              battleCounter: nextBattle,
            })
          : 0;
        const rebasedEntries = resetsClock
          ? await resetCampaignRechargeAnchors(tx, auth.campaignId)
          : 0;
        let restoredCharacters = 0;
        if (body.command === "LONG_REST") {
          const characterRows = await tx
            .select()
            .from(characters)
            .where(eq(characters.campaignId, auth.campaignId));
          for (const character of characterRows) {
            const beforeResources = character.resources as Resources;
            const afterResources = applyCharacterRest(
              beforeResources,
              "LONG",
              normalizeLegacyStats(character.stats),
            );
            if (
              JSON.stringify(beforeResources) === JSON.stringify(afterResources)
            )
              continue;
            const [restoredCharacter] = await tx
              .update(characters)
              .set({
                resources: afterResources,
                revision: character.revision + 1,
                updatedAt: new Date(),
              })
              .where(
                and(
                  eq(characters.id, character.id),
                  eq(characters.revision, character.revision),
                ),
              )
              .returning({ id: characters.id });
            if (!restoredCharacter) throw new Error("CHARACTER_CONFLICT");
            restoredCharacters++;
          }
        }
        const label =
          body.command === "RESET_CLOCK"
            ? "Время кампании сброшено: день 1, боёв 0"
            : body.command === "LONG_REST"
              ? "Длинный отдых завершён"
              : body.command === "ADVANCE_DAY"
                ? `День кампании: ${nextDay}`
                : body.command === "START_BATTLE"
                  ? `Бой #${nextBattle} начат`
                  : `Бой #${current.battleCounter} завершён`;
        const [message] = await tx
          .insert(chatMessages)
          .values({
            campaignId: auth.campaignId,
            membershipId: auth.membershipId,
            kind: "SYSTEM",
            threadId: tableThread.id,
            visibility: "PUBLIC",
            body:
              recharged > 0
                ? `${label}. Перезаряжено: ${recharged}.`
                : `${label}.`,
          })
          .returning();
        await tx.insert(gameEvents).values({
          campaignId: auth.campaignId,
          actionId: body.actionId,
          membershipId: auth.membershipId,
          type: "campaign.clock",
          entityType: "campaign",
          entityId: auth.campaignId,
          entityRevision: updated.revision,
          payload: {
            command: body.command,
            previousDay: current.day,
            previousBattleCounter: current.battleCounter,
            day: nextDay,
            battleCounter: nextBattle,
            recharged,
            rebasedEntries,
            restoredCharacters,
          },
        });
        return { updated, message };
      });
    } catch (error) {
      if (
        error instanceof Error &&
        (error.message === "CAMPAIGN_CONFLICT" ||
          error.message === "ENTRY_CONFLICT" ||
          error.message === "CHARACTER_CONFLICT")
      )
        return reply.code(409).send({ error: error.message });
      throw error;
    }
    await broadcast(auth.campaignId);
    return result.updated;
  });

  app.patch("/api/campaign", async (request, reply) => {
    const auth = await requireAuth(request, reply, db);
    if (!auth) return;
    if (auth.role !== "GM")
      return reply.code(403).send({ error: "GM_REQUIRED" });
    const body = renameCampaignSchema.parse(request.body);
    const duplicate = await findAction(db, auth.campaignId, body.actionId);
    if (duplicate) {
      const [replayed] = await db
        .select()
        .from(campaigns)
        .where(eq(campaigns.id, auth.campaignId))
        .limit(1);
      return replayed
        ? reply.code(200).send(replayed)
        : reply.code(404).send({ error: "CAMPAIGN_NOT_FOUND" });
    }
    const [current] = await db
      .select()
      .from(campaigns)
      .where(eq(campaigns.id, auth.campaignId))
      .limit(1);
    if (!current) return reply.code(404).send({ error: "CAMPAIGN_NOT_FOUND" });
    if (current.revision !== body.revision)
      return reply
        .code(409)
        .send({ error: "CAMPAIGN_CONFLICT", revision: current.revision });
    const updated = await db.transaction(async (tx) => {
      const [next] = await tx
        .update(campaigns)
        .set({
          name: body.name,
          revision: current.revision + 1,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(campaigns.id, auth.campaignId),
            eq(campaigns.revision, current.revision),
          ),
        )
        .returning();
      if (!next) return null;
      await tx.insert(gameEvents).values({
        campaignId: auth.campaignId,
        actionId: body.actionId,
        membershipId: auth.membershipId,
        type: "campaign.renamed",
        entityType: "campaign",
        entityId: auth.campaignId,
        entityRevision: next.revision,
        payload: { name: next.name },
      });
      return next;
    });
    if (!updated) return reply.code(409).send({ error: "CAMPAIGN_CONFLICT" });
    await broadcast(auth.campaignId);
    return updated;
  });

  /**
   * UIX-682 C01: personal stat layout override for one character. Its owner
   * (PLAYER) edits it; UIX-707: the GM may edit it too for any character of
   * the campaign, so GM edits on such a sheet stay out of the campaign layout.
   */
  app.patch(
    "/api/characters/:characterId/stat-layout",
    async (request, reply) => {
      const auth = await requireAuth(request, reply, db);
      if (!auth) return;
      if (auth.role !== "PLAYER" && auth.role !== "GM")
        return reply.code(403).send({ error: "PLAYER_REQUIRED" });
      const isGm = auth.role === "GM";
      const { characterId } = z
        .object({ characterId: z.string().uuid() })
        .parse(request.params);
      const body = updateCharacterStatLayoutSchema.parse(request.body);
      const fingerprint = createHash("sha256")
        .update(
          JSON.stringify({ revision: body.revision, layout: body.layout }),
        )
        .digest("hex");
      const [character] = await db
        .select()
        .from(characters)
        .where(
          and(
            eq(characters.id, characterId),
            eq(characters.campaignId, auth.campaignId),
          ),
        )
        .limit(1);
      if (!character)
        return reply.code(404).send({ error: "CHARACTER_NOT_FOUND" });
      // Check the entity owner before examining an action receipt: another
      // player must not learn whether a private command/replay exists.
      if (!isGm && character.ownerMembershipId !== auth.membershipId)
        return reply.code(403).send({ error: "CHARACTER_FORBIDDEN" });
      // A PLAYER's writes stay pinned to characters it owns; the GM's to the
      // campaign (already part of every predicate below).
      const ownerGuard = isGm
        ? []
        : [eq(characters.ownerMembershipId, auth.membershipId)];

      const replay = (
        action: NonNullable<Awaited<ReturnType<typeof findAction>>>,
      ) => {
        const payload =
          action.payload && typeof action.payload === "object"
            ? (action.payload as { fingerprint?: unknown })
            : null;
        if (
          action.membershipId !== auth.membershipId ||
          action.type !== "character.stat-layout.updated" ||
          action.entityType !== "character" ||
          action.entityId !== characterId ||
          payload?.fingerprint !== fingerprint ||
          action.entityRevision === null
        )
          return reply.code(409).send({ error: "ACTION_ID_REUSED" });
        return reply.code(200).send({
          characterId,
          revision: action.entityRevision,
        });
      };
      const prior = await findAction(db, auth.campaignId, body.actionId);
      if (prior) return replay(prior);

      const [campaign] = await db
        .select({ statLayout: campaigns.statLayout })
        .from(campaigns)
        .where(eq(campaigns.id, auth.campaignId))
        .limit(1);
      if (!campaign)
        return reply.code(404).send({ error: "CAMPAIGN_NOT_FOUND" });
      const currentLayout = resolveCharacterStatLayout(
        character.statLayout,
        resolveStatLayout(campaign.statLayout),
      );
      if (character.revision !== body.revision) {
        const raced = await findAction(db, auth.campaignId, body.actionId);
        if (raced) return replay(raced);
        return reply.code(409).send({
          error: "CHARACTER_CONFLICT",
          revision: character.revision,
        });
      }
      const removed = removedStatKeys(currentLayout, body.layout);
      const rejection = rejectDestructiveLayoutChange(
        currentLayout,
        body.layout,
        removed.length
          ? await collectCharacterStatReferenceSources(
              db,
              auth.campaignId,
              character,
            )
          : { characters: [], catalogEntries: [] },
      );
      if (rejection) return reply.code(409).send(rejection);

      const updated = await db.transaction(async (tx) => {
        const [next] = await tx
          .update(characters)
          .set({
            statLayout: body.layout,
            revision: character.revision + 1,
            updatedAt: new Date(),
          })
          .where(
            and(
              eq(characters.id, characterId),
              eq(characters.campaignId, auth.campaignId),
              ...ownerGuard,
              eq(characters.revision, character.revision),
            ),
          )
          .returning({ id: characters.id, revision: characters.revision });
        if (!next) return null;
        await tx.insert(gameEvents).values({
          campaignId: auth.campaignId,
          actionId: body.actionId,
          membershipId: auth.membershipId,
          type: "character.stat-layout.updated",
          entityType: "character",
          entityId: characterId,
          entityRevision: next.revision,
          payload: {
            fingerprint,
            keys: body.layout.flatMap((group) =>
              group.rows.map((row) => row.key),
            ),
          },
        });
        return next;
      });
      if (!updated) {
        const raced = await findAction(db, auth.campaignId, body.actionId);
        if (raced) return replay(raced);
        const [latest] = await db
          .select({ revision: characters.revision })
          .from(characters)
          .where(
            and(
              eq(characters.id, characterId),
              eq(characters.campaignId, auth.campaignId),
              ...ownerGuard,
            ),
          )
          .limit(1);
        return reply.code(409).send({
          error: "CHARACTER_CONFLICT",
          ...(latest ? { revision: latest.revision } : {}),
        });
      }
      await broadcast(auth.campaignId);
      return reply.code(200).send({ characterId, revision: updated.revision });
    },
  );

  /**
   * UIX-424, шаг 5 — правка раскладки характеристик кампании.
   *
   * Раскладка одна на всех, поэтому это команда мастера под ревизией кампании,
   * рядом с переименованием. Что именно разрешено менять — в
   * `rejectDestructiveLayoutChange`: пока набор ключей может только расти.
   */
  app.patch("/api/campaign/stat-layout", async (request, reply) => {
    const auth = await requireAuth(request, reply, db);
    if (!auth) return;
    if (auth.role !== "GM")
      return reply.code(403).send({ error: "GM_REQUIRED" });
    const body = updateStatLayoutSchema.parse(request.body);
    const duplicate = await findAction(db, auth.campaignId, body.actionId);
    if (duplicate) {
      const [replayed] = await db
        .select()
        .from(campaigns)
        .where(eq(campaigns.id, auth.campaignId))
        .limit(1);
      return replayed
        ? reply.code(200).send(replayed)
        : reply.code(404).send({ error: "CAMPAIGN_NOT_FOUND" });
    }
    const [current] = await db
      .select()
      .from(campaigns)
      .where(eq(campaigns.id, auth.campaignId))
      .limit(1);
    if (!current) return reply.code(404).send({ error: "CAMPAIGN_NOT_FOUND" });
    if (current.revision !== body.revision)
      return reply
        .code(409)
        .send({ error: "CAMPAIGN_CONFLICT", revision: current.revision });
    // Сравнение с **разрешённой** раскладкой, а не с сохранённой: у кампании,
    // которая раскладку ни разу не правила, в базе пусто, а видит она
    // стартовую. Сравнив с пустым, сервер пропустил бы удаление любой строки.
    const resolved = resolveStatLayout(current.statLayout);
    const rejection = rejectDestructiveLayoutChange(
      resolved,
      body.layout,
      // Ссылки ищутся только когда что-то удаляют: обычная правка раскладки —
      // добавление и переименование, и тянуть ради неё всех персонажей с их
      // записями значило бы платить за редкий случай на каждом нажатии.
      removedStatKeys(resolved, body.layout).length > 0
        ? await collectStatReferenceSources(db, auth.campaignId)
        : { characters: [], catalogEntries: [] },
    );
    if (rejection) return reply.code(409).send(rejection);
    const updatedLayout = await db.transaction(async (tx) => {
      const [next] = await tx
        .update(campaigns)
        .set({
          statLayout: body.layout,
          revision: current.revision + 1,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(campaigns.id, auth.campaignId),
            eq(campaigns.revision, current.revision),
          ),
        )
        .returning();
      if (!next) return null;
      await tx.insert(gameEvents).values({
        campaignId: auth.campaignId,
        actionId: body.actionId,
        membershipId: auth.membershipId,
        type: "campaign.stat-layout.updated",
        entityType: "campaign",
        entityId: auth.campaignId,
        entityRevision: next.revision,
        // Ключи, а не раскладка целиком: журнал должен отвечать на вопрос
        // «когда появилась эта строка», не храня копию всей структуры.
        payload: {
          keys: body.layout.flatMap((group) =>
            group.rows.map((row) => row.key),
          ),
        },
      });
      return next;
    });
    if (!updatedLayout)
      return reply.code(409).send({ error: "CAMPAIGN_CONFLICT" });
    await broadcast(auth.campaignId);
    return updatedLayout;
  });

  /**
   * UIX-431 — очередь ходов правится целиком и только мастером.
   *
   * Список приходит с клиента, поэтому каждая ссылка на токен проверяется здесь:
   * рамка выделения на карте отбирает токены по правам на клиенте, но это
   * удобство, а не защита. Токен чужой кампании в очереди дал бы мастеру строку
   * с именем из другой игры.
   */
  app.patch("/api/campaign/initiative", async (request, reply) => {
    const auth = await requireAuth(request, reply, db);
    if (!auth) return;
    // Состав очереди ведёт мастер. Игрок вносит только своё значение — узкой
    // операцией `/api/campaign/initiative/self` ниже.
    if (auth.role !== "GM")
      return reply.code(403).send({ error: "GM_REQUIRED" });
    const body = updateInitiativeSchema.parse(request.body);
    const duplicate = await findAction(db, auth.campaignId, body.actionId);
    if (duplicate) {
      const [replayed] = await db
        .select()
        .from(campaigns)
        .where(eq(campaigns.id, auth.campaignId))
        .limit(1);
      return replayed
        ? reply.code(200).send(replayed)
        : reply.code(404).send({ error: "CAMPAIGN_NOT_FOUND" });
    }
    const [current] = await db
      .select()
      .from(campaigns)
      .where(eq(campaigns.id, auth.campaignId))
      .limit(1);
    if (!current) return reply.code(404).send({ error: "CAMPAIGN_NOT_FOUND" });
    if (current.revision !== body.revision)
      return reply
        .code(409)
        .send({ error: "CAMPAIGN_CONFLICT", revision: current.revision });
    const referenced = body.participants
      .map((participant) => participant.tokenId)
      .filter((tokenId): tokenId is string => Boolean(tokenId));
    if (referenced.length > 0) {
      const known = await db
        .select({ id: tokens.id })
        .from(tokens)
        .innerJoin(scenes, eq(tokens.sceneId, scenes.id))
        .where(
          and(
            eq(scenes.campaignId, auth.campaignId),
            inArray(tokens.id, referenced),
          ),
        );
      const knownIds = new Set(known.map((row) => row.id));
      const foreign = referenced.filter((tokenId) => !knownIds.has(tokenId));
      if (foreign.length > 0)
        return reply
          .code(400)
          .send({ error: "TOKEN_NOT_FOUND", tokenIds: foreign });
    }
    /**
     * UIX-466: порядок — производная от введённых значений, а не отдельное
     * намерение. Раньше его собирали руками, а сортировка была кнопкой; теперь
     * очередь пересобирается после каждой правки.
     *
     * Исключение — строки, закреплённые мастером (`pinned`): они держат своё
     * место, остальные сортируются вокруг них. Закрепление приезжает в составе
     * очереди, поэтому отдельной операции «переставить» нет — есть присланный
     * порядок, который сервер обязан воспроизвести ровно там, где его закрепили.
     *
     * Сортировка живёт здесь, а не на клиенте: значения вносят и мастер, и
     * игрок, и порядок обязан получиться один и тот же у всех — независимо от
     * того, чей клиент прислал правку.
     */
    const ordered = orderInitiative(body.participants);
    const updated = await db.transaction(async (tx) => {
      const [next] = await tx
        .update(campaigns)
        .set({
          initiative: ordered,
          revision: current.revision + 1,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(campaigns.id, auth.campaignId),
            eq(campaigns.revision, current.revision),
          ),
        )
        .returning();
      if (!next) return null;
      await tx.insert(gameEvents).values({
        campaignId: auth.campaignId,
        actionId: body.actionId,
        membershipId: auth.membershipId,
        type: "campaign.initiative.updated",
        entityType: "campaign",
        entityId: auth.campaignId,
        entityRevision: next.revision,
        payload: { participants: body.participants.length },
      });
      return next;
    });
    if (!updated) return reply.code(409).send({ error: "CAMPAIGN_CONFLICT" });
    await broadcast(auth.campaignId);
    return updated;
  });

  /**
   * UIX-466 — «поставить своей строке значение».
   *
   * Отдельно от маршрута выше, потому что тот принимает очередь целиком, а
   * игрок видит её отфильтрованной: строк противников у него нет, и прислать
   * полный состав он не может физически. Первая попытка дать ему общий маршрут
   * так и провалилась — сервер видел «участники исчезли» и отвечал отказом.
   *
   * Здесь передаётся только намерение, а состав и порядок остаются серверными.
   * Мастеру этот маршрут тоже открыт: свой персонаж есть и у него.
   */
  app.patch("/api/campaign/initiative/self", async (request, reply) => {
    const auth = await requireAuth(request, reply, db);
    if (!auth) return;
    const body = setOwnInitiativeSchema.parse(request.body);
    const duplicate = await findAction(db, auth.campaignId, body.actionId);
    if (duplicate) return reply.code(200).send({ duplicate: true });
    const [current] = await db
      .select()
      .from(campaigns)
      .where(eq(campaigns.id, auth.campaignId))
      .limit(1);
    if (!current) return reply.code(404).send({ error: "CAMPAIGN_NOT_FOUND" });
    if (current.revision !== body.revision)
      return reply
        .code(409)
        .send({ error: "CAMPAIGN_CONFLICT", revision: current.revision });

    const roster = current.initiative ?? [];
    const target = roster.find((row) => row.id === body.participantId);
    if (!target)
      return reply.code(404).send({ error: "PARTICIPANT_NOT_FOUND" });

    /**
     * Право проверяется по персонажу, стоящему за токеном строки, а не по тому,
     * что прислал клиент. Мастеру разрешено всё: он ведёт и NPC.
     */
    if (auth.role !== "GM") {
      if (!target.tokenId)
        return reply.code(403).send({ error: "NOT_YOUR_PARTICIPANT" });
      const [owned] = await db
        .select({ id: tokens.id })
        .from(tokens)
        .innerJoin(
          tokenDefinitions,
          eq(tokens.definitionId, tokenDefinitions.id),
        )
        .innerJoin(characters, eq(tokenDefinitions.characterId, characters.id))
        .leftJoin(
          characterControllers,
          eq(characterControllers.characterId, characters.id),
        )
        .where(
          and(
            eq(tokens.id, target.tokenId),
            eq(characters.campaignId, auth.campaignId),
            or(
              eq(characters.ownerMembershipId, auth.membershipId),
              eq(characterControllers.membershipId, auth.membershipId),
            ),
          ),
        )
        .limit(1);
      if (!owned)
        return reply.code(403).send({ error: "NOT_YOUR_PARTICIPANT" });
    }

    const ordered = orderInitiative(
      roster.map((row) =>
        row.id === body.participantId
          ? { ...row, initiative: body.initiative }
          : row,
      ),
    );
    const updatedSelf = await db.transaction(async (tx) => {
      const [next] = await tx
        .update(campaigns)
        .set({
          initiative: ordered,
          revision: current.revision + 1,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(campaigns.id, auth.campaignId),
            eq(campaigns.revision, current.revision),
          ),
        )
        .returning();
      if (!next) return null;
      await tx.insert(gameEvents).values({
        campaignId: auth.campaignId,
        actionId: body.actionId,
        membershipId: auth.membershipId,
        type: "campaign.initiative.updated",
        entityType: "campaign",
        entityId: auth.campaignId,
        entityRevision: next.revision,
        payload: { participants: ordered.length },
      });
      return next;
    });
    if (!updatedSelf)
      return reply.code(409).send({ error: "CAMPAIGN_CONFLICT" });
    await broadcast(auth.campaignId);
    return updatedSelf;
  });

  /**
   * UIX-466 п. 4 — мастер обводит поле боя.
   *
   * Зона живёт отдельно от очереди и переживает бой: `END_BATTLE` очищает
   * состав, но не рамку. На той же карте следующий бой начинается с уже
   * обведённым полем.
   *
   * Сцена в теле не принимается на веру — она обязана существовать и
   * принадлежать этой кампании, иначе зона указывала бы на чужую карту, а
   * пополнение состава по ней молча не находило бы никого.
   */
  app.put("/api/campaign/battle-zone", async (request, reply) => {
    const auth = await requireAuth(request, reply, db);
    if (!auth) return;
    // Поле боя обводит мастер. Игроку эта ручка не нужна и опасна: зоной
    // задаётся, кто вообще участвует в бою.
    if (auth.role !== "GM")
      return reply.code(403).send({ error: "GM_REQUIRED" });
    const body = setBattleZoneSchema.parse(request.body);
    const duplicate = await findAction(db, auth.campaignId, body.actionId);
    if (duplicate) return reply.code(200).send({ duplicate: true });
    const [current] = await db
      .select()
      .from(campaigns)
      .where(eq(campaigns.id, auth.campaignId))
      .limit(1);
    if (!current) return reply.code(404).send({ error: "CAMPAIGN_NOT_FOUND" });
    if (current.revision !== body.revision)
      return reply
        .code(409)
        .send({ error: "CAMPAIGN_CONFLICT", revision: current.revision });
    if (body.zone) {
      const [scene] = await db
        .select({ id: scenes.id })
        .from(scenes)
        .where(
          and(
            eq(scenes.id, body.zone.sceneId),
            eq(scenes.campaignId, auth.campaignId),
          ),
        )
        .limit(1);
      if (!scene) return reply.code(404).send({ error: "SCENE_NOT_FOUND" });
    }
    const updatedZone = await db.transaction(async (tx) => {
      const [next] = await tx
        .update(campaigns)
        .set({
          battleZone: body.zone,
          revision: current.revision + 1,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(campaigns.id, auth.campaignId),
            eq(campaigns.revision, current.revision),
          ),
        )
        .returning();
      if (!next) return null;
      await tx.insert(gameEvents).values({
        campaignId: auth.campaignId,
        actionId: body.actionId,
        membershipId: auth.membershipId,
        type: "campaign.battle_zone.updated",
        entityType: "campaign",
        entityId: auth.campaignId,
        entityRevision: next.revision,
        payload: { cleared: body.zone === null },
      });
      return next;
    });
    if (!updatedZone)
      return reply.code(409).send({ error: "CAMPAIGN_CONFLICT" });
    await broadcast(auth.campaignId);
    return updatedZone;
  });

  /**
   * UIX-466 п. 3 — пополнить очередь теми, кто сейчас в зоне.
   *
   * **Добавляет, но не выбрасывает.** Вышедший из зоны остаётся в бою: он мог
   * отступить, а не выйти из боя, и стирать его строку вместе с уже внесённым
   * броском значило бы наказывать за отступление. Убирает участников мастер
   * сам — крестиком в строке.
   *
   * Отдельная операция, а не пересчёт на каждое движение токена: живой состав
   * означал бы, что случайно задетая мышью фигура меняет очередь посреди хода.
   */
  app.post("/api/campaign/initiative/from-zone", async (request, reply) => {
    const auth = await requireAuth(request, reply, db);
    if (!auth) return;
    if (auth.role !== "GM")
      return reply.code(403).send({ error: "GM_REQUIRED" });
    const body = revisionCommandSchema.parse(request.body);
    const duplicate = await findAction(db, auth.campaignId, body.actionId);
    if (duplicate) return reply.code(200).send({ duplicate: true });
    const [current] = await db
      .select()
      .from(campaigns)
      .where(eq(campaigns.id, auth.campaignId))
      .limit(1);
    if (!current) return reply.code(404).send({ error: "CAMPAIGN_NOT_FOUND" });
    if (current.revision !== body.revision)
      return reply
        .code(409)
        .send({ error: "CAMPAIGN_CONFLICT", revision: current.revision });
    if (!current.battleZone)
      return reply.code(409).send({ error: "BATTLE_ZONE_NOT_SET" });
    const roster = await recruitFromBattleZone(
      db,
      auth.campaignId,
      current.battleZone,
      current.initiative,
    );
    // Сцена зоны исчезла между её установкой и этим вызовом. Пустой состав
    // выглядел бы как «в зоне никого», и мастер начал бы бой без противников.
    if (!roster)
      return reply.code(409).send({ error: "BATTLE_ZONE_SCENE_MISSING" });
    const updatedRoster = await db.transaction(async (tx) => {
      const [next] = await tx
        .update(campaigns)
        .set({
          initiative: roster,
          revision: current.revision + 1,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(campaigns.id, auth.campaignId),
            eq(campaigns.revision, current.revision),
          ),
        )
        .returning();
      if (!next) return null;
      await tx.insert(gameEvents).values({
        campaignId: auth.campaignId,
        actionId: body.actionId,
        membershipId: auth.membershipId,
        type: "campaign.initiative.updated",
        entityType: "campaign",
        entityId: auth.campaignId,
        entityRevision: next.revision,
        payload: {
          participants: roster.length,
          added: roster.length - current.initiative.length,
        },
      });
      return next;
    });
    if (!updatedRoster)
      return reply.code(409).send({ error: "CAMPAIGN_CONFLICT" });
    await broadcast(auth.campaignId);
    return updatedRoster;
  });
}

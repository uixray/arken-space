import {cancelEntryApplication,EntryApplicationStateError} from "./entry-application-state.js";
import {
  updateCharacterCounters,
  CharacterCountersError,
} from "./character-counters-command.js";
import { executeCharacterEntry, EntryRollError } from "./entry-roll-command.js";
import {
  rechargeCharacterEntry,
  EntryRechargeError,
} from "./entry-recharge-command.js";
import { submitDiceRoll, DiceCommandError } from "./dice-command.js";
import { sameInspiration } from "./character-extras-routes.js";
import { postgresErrorCode } from "./database-errors.js";
import { applyAbilityArea } from "./ability-area-apply.js";
import { cancelAbilityArea } from "./ability-area-state.js";
import {
  undoApplication,
  undoApplicationCommandSchema,
} from "./undo-application.js";
import type { FastifyInstance } from "fastify";
import type { Server } from "socket.io";
import type {
  CharacterDto,
  ChatMessageDto,
  ClientToServerEvents,
  ServerToClientEvents,
} from "@arken/contracts";
import { randomInt } from "node:crypto";
import { and, asc, desc, eq, inArray, or, sql } from "drizzle-orm";
import {
  assertCreationEntryUsable,
  lockBoundCreationEntry,
} from "./creation-runtime-state.js";
import { requireCreationMember } from "./creation-state.js";
import { lockInventoryGraph } from "./inventory-assignment.js";
import { consumeCreationApplication } from "./creation-consumption.js";
import { lockEntryApplication } from "./entry-application-state.js";
import { z } from "zod";
import {
  diceRequestSchema,
  entryDataSchema,
  entryRollRequestSchema,
  characterCountersCommandSchema,
  rechargeEntryCommandSchema,
  abilityAreaApplySchema,
} from "@arken/contracts";
import {
  characterCatalogEntries,
  catalogEntries,
  characterControllers,
  campaigns,
  characters,
  chatMessages,
  gameEvents,
} from "@arken/db";
import { requireAuth } from "./auth.js";
import { DiceFormulaError, rollFormulaWithMode } from "./dice.js";
import { selectDiceFrame } from "./dice-frame-selection.js";
import { resolveStatLayout } from "./snapshot.js";
import {
  characterDto,
  loadCharacterEntries,
  characterRollStats,
  normalizeCharacterResources,
  normalizeCharacterWallet,
} from "./character-dto.js";
import { findAction } from "./action-lookup.js";
import {
  type Resources,
  type WalletAuditSystemData,
  WALLET_AUDIT_BURST_MS,
  applyCharacterRest,
  formatResourceChanges,
  formatWalletChanges,
  isWalletAuditSystemData,
  resourceLabelsFromLayout,
} from "./character-rules.js";
import { campaignRoom, gmRoom, memberRoom } from "./rooms.js";
import {
  canAccessCharacter,
  campaignDefaultStatLayout,
  characterControllerIds,
  sameResourceImages,
} from "./character-access.js";
import { rechargeCampaignCatalogEntries } from "./campaign-clock.js";
import {
  chatBroadcastAudience,
  chatMessageDto,
  ensureStreamThread,
} from "./chat.js";
import {
  normalizeLegacyEntryData,
  normalizeLegacyFormula,
  normalizeLegacyStats,
} from "./entry-data.js";

type Database = ReturnType<typeof import("@arken/db").createDatabase>["db"];
type RealtimeServer = Server<ClientToServerEvents, ServerToClientEvents>;

function numericSkillValue(data: unknown): number | undefined {
  if (!data || typeof data !== "object" || !("skillValue" in data))
    return undefined;
  const value = data.skillValue;
  return typeof value === "number" &&
    Number.isInteger(value) &&
    value >= -1000 &&
    value <= 1000
    ? value
    : undefined;
}

/**
 * Character play: counters (HP, resources, wallet, rests), ability recharge
 * and rolls, free dice. Moved out of routes.ts unchanged (legacy cleanup
 * after the 15.10 audit).
 */
export function registerCharacterPlayRoutes(
  app: FastifyInstance,
  db: Database,
  io: RealtimeServer,
  {
    broadcast,
    publishCharacter,
  }: {
    broadcast: (campaignId: string) => Promise<void>;
    /** UIX-412: a character change as a point event to those who see it. */
    publishCharacter: (
      campaignId: string,
      change: {
        character: { ownerMembershipId: string | null };
        controllerIds: string[];
        project: (visibleControllerIds: string[]) => CharacterDto;
        message: ChatMessageDto | null;
        envelope: { sequence: number; actionId: string; emittedAt: string };
      },
    ) => Promise<void>;
  },
) {
  app.post("/api/chat/application-undo", async (request, reply) => {
    const auth = await requireAuth(request, reply, db);
    if (!auth) return;
    const parsed = undoApplicationCommandSchema.safeParse(request.body);
    if (!parsed.success)
      return reply.code(400).send({ error: "INVALID_UNDO_COMMAND" });
    try {
      const result = await undoApplication(db, auth, parsed.data);
      if (result.duplicate) return reply.send({ duplicate: true });
      const dto = chatMessageDto(result.message!, auth.displayName, "ROLLS");
      const envelope = {
        sequence: Number(result.event!.sequence),
        actionId: parsed.data.actionId,
        emittedAt: result.event!.createdAt.toISOString(),
        data: dto,
        cancelledApplicationMessageId: parsed.data.messageId,
      };
      if (chatBroadcastAudience(result.message!.visibility) === "CAMPAIGN")
        io.to(campaignRoom(auth.campaignId)).emit("chat:created", envelope);
      else {
        io.to(gmRoom(auth.campaignId)).emit("chat:created", envelope);
        io.to(memberRoom(result.originalAuthorId!)).emit(
          "chat:created",
          envelope,
        );
      }
      await broadcast(auth.campaignId);
      return reply.send({ ok: true });
    } catch (error) {
      const dbCode = postgresErrorCode(error);
      if (dbCode === "40001" || dbCode === "40P01")
        return reply.code(409).send({
          error: "UNDO_CONFLICT",
          message:
            "Данные одновременно изменились; обновите их перед повтором.",
        });
      if (dbCode === "23505")
        return reply.code(409).send({ error: "ACTION_CONFLICT" });
      const code = error instanceof Error ? error.message : "";
      if (code === "UNDO_FORBIDDEN")
        return reply
          .code(403)
          .send({ error: code, message: "Нет доступа к этому применению." });
      if (code === "UNDO_NOT_AVAILABLE")
        return reply.code(409).send({
          error: code,
          message:
            "Для этого старого применения нет безопасных данных для отмены.",
        });
      if (code === "UNDO_CONFLICT")
        return reply.code(409).send({
          error: code,
          message:
            "Данные уже изменились после применения; автоматическая отмена невозможна.",
        });
      if (code === "ACTION_CONFLICT")
        return reply.code(409).send({ error: code });
      throw error;
    }
  });
  app.post("/api/abilities/area/cancel", async (request, reply) => {
    const auth = await requireAuth(request, reply, db);
    if (!auth) return;
    if (
      request.headers["x-entry-campaign"] !== auth.campaignId ||
      request.headers["x-entry-member"] !== auth.membershipId
    )
      return reply.code(409).send({ error: "ENTRY_CONTEXT_CHANGED" });
    const parsed = abilityAreaApplySchema.safeParse(request.body);
    if (!parsed.success)
      return reply.code(400).send({ error: "INVALID_AREA_COMMAND" });
    try {
      return await cancelAbilityArea(db, auth, parsed.data);
    } catch (error) {
      if (error instanceof Error && error.message === "ACTION_CONFLICT")
        return reply.code(409).send({ error: "ACTION_CONFLICT" });
      if (error instanceof Error && error.message === "AREA_FORBIDDEN")
        return reply.code(403).send({ error: "AREA_FORBIDDEN" });
      throw error;
    }
  });

  app.post("/api/abilities/area/apply", async (request, reply) => {
    const auth = await requireAuth(request, reply, db);
    if (!auth) return;
    if (
      (request.headers["x-entry-campaign"] !== undefined &&
        request.headers["x-entry-campaign"] !== auth.campaignId) ||
      (request.headers["x-entry-member"] !== undefined &&
        request.headers["x-entry-member"] !== auth.membershipId)
    )
      return reply.code(409).send({ error: "ENTRY_CONTEXT_CHANGED" });
    const parsed = abilityAreaApplySchema.safeParse(request.body);
    if (!parsed.success)
      return reply.code(400).send({
        error: "INVALID_AREA_COMMAND",
        message: "Проверьте параметры применения области.",
      });
    let result: Awaited<ReturnType<typeof applyAbilityArea>>;
    try {
      result = await applyAbilityArea(db, auth, parsed.data);
    } catch (reason) {
      const code = reason instanceof Error ? reason.message : "";
      const failures: Record<string, [number, string]> = {
        AREA_FORBIDDEN: [403, "Нет доступа к применяющему персонажу."],
        ACTION_CONFLICT: [
          409,
          "Этот код действия уже занят. Обновите страницу.",
        ],
        CAMPAIGN_PAUSED: [409, "Игра на перерыве. Применение не выполнено."],
        AREA_SCENE_UNAVAILABLE: [
          409,
          "Сцена больше недоступна. Выберите способность заново.",
        ],
        AREA_SCENE_CHANGED: [
          409,
          "Сцена изменилась. Просмотрите область заново.",
        ],
        AREA_ORIGIN_UNAVAILABLE: [
          409,
          "Фигурка применяющего недоступна на этой сцене.",
        ],
        AREA_ORIGIN_CHANGED: [
          409,
          "Фигурка переместилась. Просмотрите область заново.",
        ],
        ENTRY_CONFLICT: [409, "Способность изменилась. Выберите её заново."],
        CREATION_CONSUMPTION_UNAVAILABLE: [
          409,
          "Одноразовый созданный предмет пока нельзя применить с отменой.",
        ],
        CREATION_APPROVAL_REQUIRED: [409, "Допуск мастера к версии отозван."],
        CREATION_OBJECT_UNAVAILABLE: [
          409,
          "Созданный объект больше недоступен.",
        ],
        CREATION_DATA_UNAVAILABLE: [
          409,
          "Версия объекта не соответствует сохранённой записи.",
        ],
        AREA_SCALE_REQUIRED: [
          409,
          "Мастер должен задать метров в клетке для этой сцены.",
        ],
        AREA_PROJECTION_UNSUPPORTED: [
          400,
          "Область пока поддерживается на обычной 2D-карте.",
        ],
        AREA_EFFECT_REQUIRED: [
          400,
          "У способности не настроен эффект области.",
        ],
        ABILITY_ACTION_COST_MISMATCH: [
          400,
          "Укажите единую стоимость применения способности.",
        ],
        ABILITY_USES_EXHAUSTED: [409, "Не осталось использований способности."],
        INSUFFICIENT_CHARACTER_RESOURCE: [
          409,
          "Не хватает ресурса на применение способности.",
        ],
        AREA_TARGETS_EMPTY: [
          409,
          "Нет подходящих персонажей игроков в области.",
        ],
        AREA_CAMPAIGN_LIMIT: [
          400,
          "Слишком много персонажей для применения области.",
        ],
        AREA_SCENE_LIMIT: [
          400,
          "Слишком много фигурок на сцене для применения области.",
        ],
      };
      const failure = failures[code];
      if (failure)
        return reply.code(failure[0]).send({
          error: code,
          message: failure[1],
          // Authorization failure cannot disprove an earlier committed request
          // after that actor lost access. Do not erase an ambiguous client receipt.
          notApplied: !["AREA_FORBIDDEN", "ACTION_CONFLICT"].includes(code),
        });
      if (reason instanceof z.ZodError)
        return reply.code(400).send({
          error: "AREA_CONFIGURATION_INVALID",
          notApplied: true,
          message:
            "Проверьте настройки способности и ресурс маны у участников. Изменения не применены.",
        });
      // Drizzle may wrap PostgreSQL errors. A failed transaction is not a new
      // roll: offer an explicit retry of the exact same action, never auto-retry.
      let cause: unknown = reason;
      for (
        let depth = 0;
        depth < 3 && cause && typeof cause === "object";
        depth++
      ) {
        if (
          "code" in cause &&
          ["40001", "40P01", "23505"].includes(String(cause.code))
        )
          return reply.code(409).send({
            error: "AREA_RETRY",
            message:
              "Состояние изменилось одновременно. Повторите тот же запрос.",
          });
        cause = "cause" in cause ? cause.cause : null;
      }
      request.log.error({
        event: "ability.area.failed",
        actionId: parsed.data.actionId,
      });
      return reply.code(500).send({
        error: "AREA_RESULT_UNKNOWN",
        message:
          "Результат не подтверждён. Повторите тот же запрос, не создавая новое применение.",
      });
    }
    // Commit has already succeeded. Projection failure must not turn it into an
    // apparently failed mutation. Full snapshots retain role/owner filtering.
    try {
      await broadcast(auth.campaignId);
    } catch {
      request.log.warn({
        event: "ability.area.broadcast_failed",
        actionId: parsed.data.actionId,
      });
    }
    return result;
  });

  app.patch("/api/characters/:id/counters", async (request, reply) => {
    const auth = await requireAuth(request, reply, db);
    if (!auth) return;
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params);
    let saved;
    try {
      saved = await updateCharacterCounters(db, auth, id, request.body);
    } catch (error) {
      if (error instanceof CharacterCountersError)
        return reply.code(error.status).send(error.details);
      throw error;
    }
    if (!saved.duplicate) {
      try {
        if (saved.notification.full) await broadcast(auth.campaignId);
        else await publishCharacter(auth.campaignId, saved.notification.change);
      } catch {
        request.log.warn("character.counters.broadcast_pending");
      }
    }
    return saved.value;
  });

  app.post(
    "/api/characters/:characterId/catalog/:entryId/recharge",
    async (request, reply) => {
      const auth = await requireAuth(request, reply, db);
      if (!auth) return;
      const params = z
        .object({ characterId: z.string().uuid(), entryId: z.string().uuid() })
        .parse(request.params);
      let result;
      try {
        result = await rechargeCharacterEntry(
          db,
          auth,
          params.characterId,
          params.entryId,
          request.body,
        );
      } catch (error) {
        if (error instanceof EntryRechargeError)
          return reply
            .code(error.status)
            .send({
              error: error.message,
              ...(error.revision !== undefined
                ? { revision: error.revision }
                : {}),
            });
        throw error;
      }
      if (result.duplicate) return reply.code(200).send({ duplicate: true });
      // The mutation has committed; a projection failure cannot invalidate it.
      try {
        await broadcast(auth.campaignId);
      } catch {
        request.log.warn("entry.recharge.broadcast_pending");
      }
      return result.updated;
    },
  );

  app.post("/api/characters/:characterId/catalog/:entryId/roll/cancel",async(request,reply)=>{
    const auth=await requireAuth(request,reply,db);if(!auth)return;
    if(request.headers["x-entry-campaign"]!==auth.campaignId||request.headers["x-entry-member"]!==auth.membershipId)return reply.code(409).send({error:"ENTRY_CONTEXT_CHANGED"});
    const params=z.object({characterId:z.string().uuid(),entryId:z.string().uuid()}).safeParse(request.params),body=entryRollRequestSchema.safeParse(request.body);if(!params.success||!body.success)return reply.code(400).send({error:"INVALID_ENTRY_COMMAND"});
    if(request.headers["x-action-id"]!==undefined&&request.headers["x-action-id"]!==body.data.actionId)return reply.code(409).send({error:"ACTION_ID_CONFLICT"});
    try{return await cancelEntryApplication(db,auth,params.data.characterId,params.data.entryId,body.data);}catch(e){if(e instanceof EntryApplicationStateError)return reply.code(e.status).send({error:e.code});if(["40001","40P01"].includes(postgresErrorCode(e)??""))return reply.code(409).send({error:"ENTRY_RETRY"});if(postgresErrorCode(e)==="23505")return reply.code(409).send({error:"ACTION_ID_CONFLICT"});throw e;}
  });

  app.post(
    "/api/characters/:characterId/catalog/:entryId/roll",
    async (request, reply) => {
      const auth = await requireAuth(request, reply, db);
      if (!auth) return;
      const scoped=request.headers["x-entry-campaign"]!==undefined||request.headers["x-entry-member"]!==undefined;
      if(scoped&&(request.headers["x-entry-campaign"]!==auth.campaignId||request.headers["x-entry-member"]!==auth.membershipId))return reply.code(409).send({error:"ENTRY_CONTEXT_CHANGED"});
      const action=z.object({actionId:z.string().uuid()}).safeParse(request.body);
      if(request.headers["x-action-id"]!==undefined&&(!action.success||request.headers["x-action-id"]!==action.data.actionId))return reply.code(409).send({error:"ACTION_ID_CONFLICT"});
      const params = z
        .object({ characterId: z.string().uuid(), entryId: z.string().uuid() })
        .parse(request.params);
      let saved;
      try {
        saved = await executeCharacterEntry(
          db,
          auth,
          params.characterId,
          params.entryId,
          request.body,
        );
      } catch (error) {
        if (error instanceof EntryRollError)
          return reply.code(error.status).send(error.details);
        throw error;
      }
      if(saved.duplicate){
        if(scoped)return reply.code(200).send({...saved.receipt,duplicate:true});
        if("cancelled" in saved.receipt)return reply.code(409).send({error:"ENTRY_APPLICATION_CANCELLED"});
        return reply.code(200).send({duplicate:true});
      }
      const envelope = {
        sequence: Number(saved.event.sequence),
        actionId: saved.event.actionId,
        emittedAt: saved.event.createdAt.toISOString(),
        data: saved.dto,
      };
      try {
        if (chatBroadcastAudience(saved.dto.visibility) === "CAMPAIGN")
          io.to(campaignRoom(auth.campaignId)).emit("chat:created", envelope);
        else {
          io.to(gmRoom(auth.campaignId)).emit("chat:created", envelope);
          io.to(memberRoom(auth.membershipId)).emit("chat:created", envelope);
        }
        await broadcast(auth.campaignId);
      } catch {
        request.log.warn("entry.roll.broadcast_pending");
      }
      return reply.code(201).send(scoped?{...saved.value,...saved.receipt}:saved.value);
    },
  );

  app.post("/api/dice", async (request, reply) => {
    const auth = await requireAuth(request, reply, db);
    if (!auth) return;
    const body = diceRequestSchema.parse(request.body);
    try {
      const saved = await submitDiceRoll(db, auth, body);
      if (saved.duplicate) return reply.code(200).send({ duplicate: true });
      const { row, dto, event } = saved;
      const envelope = {
        sequence: Number(event.sequence),
        actionId: body.actionId,
        emittedAt: event.createdAt.toISOString(),
        data: dto,
      };
      if (chatBroadcastAudience(row.visibility) === "CAMPAIGN")
        io.to(campaignRoom(auth.campaignId)).emit("chat:created", envelope);
      else {
        io.to(gmRoom(auth.campaignId)).emit("chat:created", envelope);
        io.to(memberRoom(auth.membershipId)).emit("chat:created", envelope);
      }
      return reply.code(201).send(dto);
    } catch (error) {
      if (error instanceof DiceCommandError)
        return reply.code(error.status).send({ error: error.message });
      if (error instanceof DiceFormulaError)
        return reply
          .code(400)
          .send({ error: "INVALID_DICE_FORMULA", message: error.message });
      throw error;
    }
  });
}

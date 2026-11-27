import type { FastifyInstance } from "fastify";
import { and, asc, eq, gt, ilike, or, sql } from "drizzle-orm";
import { characters, characterControllers, gameEvents, memberships, sessions, worldContent } from "@arken/db";
import type { ChatMessageDto, GameSnapshot } from "@arken/contracts";
import { authFromSessionToken, sessionIsActive } from "./auth.js";
import { canAccessCharacter } from "./character-access.js";
import { buildSnapshot } from "./snapshot.js";
import { env } from "./env.js";
import { hashToken, randomToken } from "./security.js";
import { z } from "zod";
import { worldContentPlayerVisibleIn } from "./world-content.js";

type Database = ReturnType<typeof import("@arken/db").createDatabase>["db"];
const uuid = z.string().uuid();
class CampaignBotRejection extends Error {}

export function campaignBotCommand(text: string) {
  const match = /^\/([a-z_]+)(?:@[a-z0-9_]+)?(?:\s+([\s\S]*))?$/i.exec(text.trim());
  return match ? { name: match[1]!.toLowerCase(), argument: match[2]?.trim() ?? "" } : null;
}

const help = [
  "/campaign — текущая кампания",
  "/ask вопрос — справка о работе с кампанией",
  "/characters — доступные вам персонажи (в личном диалоге)",
  "/character UUID — характеристики персонажа (в личном диалоге)",
  "/roll формула — публичный бросок через сервер",
  "/change UUID описание — заявка мастеру на изменение персонажа (в личном диалоге)",
  "/bug описание — баг в согласованной группе багов; вложения идут в очередь проверки",
  "/unlink — отключить свою привязку (в личном диалоге)",
].join("\n");

function answerQuestion(question: string) {
  if (/пригла|подключ|войти|регистрац/i.test(question))
    return "Мастер создаёт личную ссылку в «Моих кампаниях». Игрок входит в свой аккаунт, принимает приглашение и открывает стол. Не публикуйте приглашения в открытом чате.";
  if (/персонаж|характерист|навык|умени/i.test(question))
    return "Лист создаётся в «Персонажах». Бот показывает только доступные вам карточки. /change отправляет мастеру приватную заявку: сама команда не меняет значения. Мастер подтверждает и применяет изменения в приложении.";
  if (/куб|брос|формул/i.test(question))
    return "Используйте /roll и формулу, например /roll 1d20+2. Результат вычисляет сервер и сохраняет в журнале. Команда бота делает публичный бросок; приватные броски выполняйте в приложении.";
  if (/сцен|карт|туман|музык/i.test(question))
    return "Мастер управляет сценами, туманом и музыкой в приложении. Бот не раскрывает скрытые сцены или заметки и не меняет карту.";
  return null;
}

/** Use the canonical HTTP mutations with a short-lived, backend-only delegate.
 * No browser token is stored in Telegram tables or passed to Telegram. All
 * provenance is cloned, not invented; parent account/grant revocation still applies.
 */
export async function runCampaignBotCommand(
  app: FastifyInstance,
  db: Database,
  input: { sessionId: string; campaignId: string; actionId: string; text: string; privateChat: boolean },
): Promise<string> {
  const command = campaignBotCommand(input.text);
  if (!command) return "Используйте /help для списка команд.";
  if (!(await sessionIsActive(db, input.sessionId))) throw new Error("BOT_LINK_EXPIRED");
  const [source] = await db.select().from(sessions).where(eq(sessions.id, input.sessionId)).limit(1);
  if (!source) throw new Error("BOT_LINK_EXPIRED");
  const [member] = await db.select().from(memberships)
    .where(eq(memberships.id, source.membershipId)).limit(1);
  if (!member || member.campaignId !== input.campaignId) throw new Error("BOT_LINK_EXPIRED");
  const token = randomToken();
  const [delegate] = await db.insert(sessions).values({
    membershipId: source.membershipId,
    accountSessionId: source.accountSessionId,
    authSource: source.authSource,
    gmCredentialCampaignId: source.gmCredentialCampaignId,
    gmCredentialRevision: source.gmCredentialRevision,
    playerAccessGrantId: source.playerAccessGrantId,
    playerAccessGrantRevision: source.playerAccessGrantRevision,
    legacyInviteId: source.legacyInviteId,
    tokenHash: hashToken(token),
    expiresAt: new Date(Math.min(source.expiresAt.getTime(), Date.now() + 30_000)),
  }).returning({ id: sessions.id });
  if (!delegate) throw new Error("BOT_SESSION_UNAVAILABLE");
  try {
    const auth = await authFromSessionToken(db, token);
    if (!auth || !(await sessionIsActive(db, input.sessionId))) throw new Error("BOT_LINK_EXPIRED");
    const invoke = async (url: string, payload: Record<string, unknown>) => {
      const response = await app.inject({ method: "POST", url, payload,
        headers: { cookie: `${env.SESSION_COOKIE_NAME}=${token}`,
          "x-arken-campaign-id": auth.campaignId, origin: env.WEB_ORIGIN },
      });
      if (response.statusCode >= 400 && response.statusCode < 500)
        throw new CampaignBotRejection("BOT_COMMAND_REJECTED");
      if (response.statusCode >= 500) throw new Error("BOT_COMMAND_UNCONFIRMED");
      return response.json() as unknown;
    };
    if (["help", "start"].includes(command.name)) return help;
    if (command.name === "ask") {
      if (!command.argument || command.argument.length > 250)
        return "Добавьте вопрос о кампании (до 250 символов).";
      const known = answerQuestion(command.argument);
      if (known) return known;
      const stopWords = new Set(["кто", "что", "это", "такой", "такая", "такое", "про", "расскажи", "пожалуйста"]);
      const words = command.argument.toLowerCase().split(/[^\p{L}\p{N}-]+/u)
        .filter(word => word.length >= 2 && !stopWords.has(word)).slice(0, 6);
      if (words.length) {
        const clauses = words.map(word => {
          const pattern = `%${word.replace(/[\\%_]/g, "\\$&")}%`;
          return or(ilike(worldContent.name, pattern), ilike(worldContent.summary, pattern));
        });
        const articles = await db.select({ name: worldContent.name,
          summary: worldContent.summary, text: worldContent.publicText,
        }).from(worldContent).where(and(
          // Even a GM's group command must not publish a GM-only projection.
          worldContentPlayerVisibleIn(auth.campaignId), or(...clauses),
        )).limit(3);
        if (articles.length) return articles.map(row =>
          `${row.name}\n${(row.summary || row.text).slice(0, 700)}`).join("\n\n");
      }
      return "В доступных материалах кампании нет подтверждённого ответа. Уточните его у мастера.";
    }
    if (!input.privateChat && ["characters", "character", "change"].includes(command.name))
      return "Карточки и заявки доступны только в личном диалоге с ботом.";
    if (command.name === "campaign") {
      const snapshot = await buildSnapshot(db, auth);
      return `${snapshot.campaign.name}\nИгровой день: ${snapshot.campaign.day}`;
    }
    if (command.name === "characters" || command.name === "character" || command.name === "change") {
      if (command.name === "characters" && command.argument && !uuid.safeParse(command.argument).success)
        return "Используйте /characters или команду следующей страницы из предыдущего ответа.";
      const id = command.argument.split(/\s+/, 1)[0];
      if (command.name !== "characters" && !uuid.safeParse(id).success)
        return "Укажите UUID персонажа из /characters.";
      const rows = await db.select().from(characters).where(and(
        eq(characters.campaignId, auth.campaignId),
        command.name === "characters" && command.argument ? gt(characters.id, command.argument) : undefined,
        auth.role === "GM" ? undefined : or(eq(characters.ownerMembershipId, auth.membershipId),
          sql`exists (select 1 from ${characterControllers} where ${characterControllers.characterId} = ${characters.id}
            and ${characterControllers.membershipId} = ${auth.membershipId})`),
        ...(command.name === "characters" ? [] : [eq(characters.id, id!)]),
      )).orderBy(asc(characters.id)).limit(command.name === "characters" ? 21 : 1);
      const allowed: typeof rows = [];
      for (const row of rows) if (await canAccessCharacter(db, auth, row)) allowed.push(row);
      if (command.name === "characters") {
        const page = allowed.slice(0, 20);
        return page.length ? page.map(row => `${row.name} — ${row.id}`).join("\n") +
          (allowed.length > 20 ? `\nДалее: /characters ${page.at(-1)!.id}` : "") : "Нет доступных персонажей.";
      }
      const character = allowed[0];
      if (!character) return "Персонаж недоступен.";
      if (command.name === "change") {
        if (auth.role === "GM")
          return "Мастер применяет изменения в приложении. /change предназначена для приватных заявок игроков мастеру.";
        const description = command.argument.slice(id!.length).trim();
        if (!description || description.length > 3500) return "Добавьте описание изменений (до 3500 символов).";
        // Reuse the existing durable request and its own idempotency/CAS flow.
        await invoke("/api/player-requests", { actionId: input.actionId,
          audience: "GM_ONLY", horizon: "NOW", characterId: character.id,
          title: "Изменения персонажа из Telegram", body: description });
        return "Приватная заявка передана мастеру. Значения ещё не изменены: мастер подтверждает и применяет их в приложении.";
      }
      const snapshot: GameSnapshot = await buildSnapshot(db, auth);
      const dto = snapshot.characters.find(row => row.id === character.id);
      if (!dto) return "Персонаж недоступен.";
      // Deliberate narrow projection: never serialize a raw character/GM note.
      return `${dto.name}\nХарактеристики: ${JSON.stringify(dto.stats)}\nНавыки: ${dto.skills.map(skill => `${skill.name}: ${skill.rank}`).join(", ") || "не заданы"}`;
    }
    if (command.name === "roll") {
      if (!command.argument || command.argument.length > 160) return "Пример: /roll 1d20+2";
      // Serializes duplicate workers while the existing canonical action is run.
      return await db.transaction(async tx => {
        await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${"telegram-roll:" + auth.campaignId + ":" + input.actionId}, 0))`);
        const resultForAction = async () => {
          const [row] = await db.select({ payload: gameEvents.payload }).from(gameEvents).where(and(
            eq(gameEvents.campaignId, auth.campaignId), eq(gameEvents.actionId, input.actionId),
            eq(gameEvents.membershipId, auth.membershipId), eq(gameEvents.type, "dice.created"),
          )).limit(1);
          return row?.payload as ChatMessageDto | undefined;
        };
        let result = await resultForAction();
        if (!result) {
          await invoke("/api/dice", { actionId: input.actionId, formula: command.argument,
            visibility: "PUBLIC", rollMode: "NORMAL" });
          result = await resultForAction();
        }
        if (!result?.dice) throw new Error("BOT_ROLL_RESULT_UNAVAILABLE");
        return `${result.body}\nИтог: ${result.dice.total}\nРезультат сервера: ${JSON.stringify(result.dice)}`;
      });
    }
    return "Неизвестная команда. Используйте /help.";
  } catch (error) {
    if (error instanceof CampaignBotRejection)
      return "Сервер отклонил команду. Проверьте формулу, права и состояние персонажа; исправленную команду отправьте новым сообщением.";
    throw error;
  } finally {
    await db.delete(sessions).where(eq(sessions.id, delegate.id));
  }
}

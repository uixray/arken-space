import { and, desc, eq, inArray, lt } from "drizzle-orm";
import {
  chatAttachments,
  chatAttachmentUploads,
  chatMessages,
  chatThreads,
  playerLikenessConsents,
  stickerPacks,
  stickers,
} from "@arken/db";
import type { ChatMessageDto } from "@arken/contracts";
import type { AuthContext } from "./auth.js";
import { normalizeDiceResult, normalizeSkillCard } from "./dice-result.js";
import { revokedStickerTombstone } from "./sticker-access.js";
import {
  canAccessStream,
  chatVisibilityFilter,
  unknownPlayerDisplayName,
} from "./chat.js";

type Database = ReturnType<typeof import("@arken/db").createDatabase>["db"];
type MessageRow = typeof chatMessages.$inferSelect;
type ThreadRow = typeof chatThreads.$inferSelect;

/**
 * UIX-450 — превращение строк сообщений в DTO.
 *
 * Вынесено из `snapshot.ts` затем, чтобы маршрут истории отдавал **ровно то
 * же**, что снапшот. Проекция сообщения — это не отображение полей, а четыре
 * проверки видимости: кому виден стикер, не отозвано ли согласие на чужое
 * лицо, видна ли заявка мастеру, за которую зацеплено сообщение, и какие
 * вложения человеку показывать. Вторая копия этого набора рано или поздно
 * разошлась бы с первой, и разошлась бы в сторону «показали лишнее».
 *
 * Фильтр `chatVisibilityFilter` остаётся на вызывающем: он часть SQL-запроса,
 * а не постобработки, и в снапшоте с маршрутом запросы разные.
 */
export async function projectChatMessages(
  db: Database,
  auth: AuthContext,
  input: {
    rows: readonly { message: MessageRow; thread: ThreadRow }[];
    memberNameById: ReadonlyMap<string, string>;
    /** Заявки мастеру, видимые этому человеку. */
    visiblePlayerRequestIds: ReadonlySet<string>;
  },
): Promise<ChatMessageDto[]> {
  const rows = input.rows.filter(
    ({ message }) =>
      // Стикер с ограниченным кругом зрителей: не в списке — сообщения нет.
      (!message.stickerViewerMembershipIds ||
        message.stickerViewerMembershipIds.includes(auth.membershipId)) &&
      // Сообщение-заявка живёт ровно столько, сколько видна сама заявка.
      (!message.playerRequestId ||
        input.visiblePlayerRequestIds.has(message.playerRequestId)),
  );

  const stickerIds = rows.flatMap(({ message }) =>
    message.stickerId ? [message.stickerId] : [],
  );
  const revokedStickerRows = stickerIds.length
    ? await db
        .select({ id: stickers.id })
        .from(stickers)
        .innerJoin(
          stickerPacks,
          and(
            eq(stickerPacks.id, stickers.packId),
            eq(stickerPacks.campaignId, stickers.campaignId),
          ),
        )
        .innerJoin(
          playerLikenessConsents,
          and(
            eq(playerLikenessConsents.packId, stickerPacks.id),
            eq(playerLikenessConsents.campaignId, stickerPacks.campaignId),
          ),
        )
        .where(
          and(
            eq(stickers.campaignId, auth.campaignId),
            inArray(stickers.id, stickerIds),
            eq(stickerPacks.subject, "PLAYER"),
            eq(playerLikenessConsents.status, "REVOKED"),
          ),
        )
    : [];
  const revokedStickerIds = new Set(revokedStickerRows.map((row) => row.id));

  const messageIds = rows.map(({ message }) => message.id);
  const attachmentRows = messageIds.length
    ? await db
        .select({ attachment: chatAttachments, upload: chatAttachmentUploads })
        .from(chatAttachments)
        .innerJoin(
          chatAttachmentUploads,
          and(
            eq(chatAttachmentUploads.campaignId, chatAttachments.campaignId),
            eq(chatAttachmentUploads.contentId, chatAttachments.contentId),
          ),
        )
        .where(
          and(
            eq(chatAttachments.campaignId, auth.campaignId),
            inArray(chatAttachments.messageId, messageIds),
          ),
        )
    : [];
  const attachmentsByMessage = new Map<string, typeof attachmentRows>();
  for (const item of attachmentRows) {
    const items = attachmentsByMessage.get(item.attachment.messageId) ?? [];
    items.push(item);
    attachmentsByMessage.set(item.attachment.messageId, items);
  }

  return rows
    .sort((left, right) => left.message.sequence - right.message.sequence)
    .map(({ message, thread }) => ({
      id: message.id,
      sequence: message.sequence,
      membershipId: message.membershipId,
      displayName:
        input.memberNameById.get(message.membershipId) ??
        unknownPlayerDisplayName,
      characterId: message.characterId,
      body: message.body,
      playerRequestId: message.playerRequestId,
      visibility: message.visibility,
      kind: message.kind,
      threadId: message.threadId,
      stream: thread.stream,
      dice: normalizeDiceResult(message.dice),
      skillCard: normalizeSkillCard(message.dice),
      // Отозванное согласие превращает стикер в надгробие, а не прячет
      // сообщение: собеседник должен видеть, что тут что-то было.
      stickerId:
        message.stickerId && revokedStickerIds.has(message.stickerId)
          ? null
          : message.stickerId,
      stickerPresentation:
        message.stickerId && revokedStickerIds.has(message.stickerId)
          ? revokedStickerTombstone
          : message.stickerPresentation,
      attachments: (attachmentsByMessage.get(message.id) ?? []).map(
        ({ upload }) => ({
          contentId: upload.contentId,
          fileName: upload.fileName,
          mimeType: upload.mimeType,
          sizeBytes: upload.sizeBytes,
          width: upload.width,
          height: upload.height,
          createdAt: upload.createdAt.toISOString(),
        }),
      ),
      createdAt: message.createdAt.toISOString(),
    })) as ChatMessageDto[];
}

/**
 * Страница истории одного потока.
 *
 * Существует потому, что до UIX-450 истории неоткуда было взяться, кроме
 * снапшота: маршрута чата не было вовсе. Именно поэтому снапшот и вёз по 200
 * сообщений на поток каждому при каждом действии.
 *
 * Курсор — `sequence`, а не дата: он монотонный и уникальный в кампании, а две
 * записи с одной меткой времени дали бы либо дубль, либо пропуск на границе
 * страницы.
 */
export async function loadThreadHistory(
  db: Database,
  auth: AuthContext,
  input: {
    threadId: string;
    /** Отдаются сообщения строго старше этого номера; без него — самые новые. */
    before?: number;
    limit: number;
    memberNameById: ReadonlyMap<string, string>;
    visiblePlayerRequestIds: ReadonlySet<string>;
  },
): Promise<{ messages: ChatMessageDto[]; hasMore: boolean }> {
  const [thread] = await db
    .select()
    .from(chatThreads)
    .where(
      and(
        eq(chatThreads.id, input.threadId),
        eq(chatThreads.campaignId, auth.campaignId),
      ),
    )
    .limit(1);
  if (!thread) return { messages: [], hasMore: false };

  // Доступ к потоку — то же правило, что в снапшоте: поток общий и открыт по
  // роли, либо личный и открыт участнику.
  const allowed =
    thread.type === "DIRECT"
      ? thread.participantAMembershipId === auth.membershipId ||
        thread.participantBMembershipId === auth.membershipId
      : thread.stream !== null && canAccessStream(auth, thread.stream);
  if (!allowed) return { messages: [], hasMore: false };

  // Берётся на одну строку больше запрошенного: так «есть ли ещё» — это факт,
  // а не догадка по длине страницы.
  const rows = await db
    .select()
    .from(chatMessages)
    .where(
      and(
        eq(chatMessages.campaignId, auth.campaignId),
        eq(chatMessages.threadId, thread.id),
        chatVisibilityFilter(auth),
        ...(input.before === undefined
          ? []
          : [lt(chatMessages.sequence, input.before)]),
      ),
    )
    .orderBy(desc(chatMessages.sequence))
    .limit(input.limit + 1);

  const page = rows.slice(0, input.limit);
  return {
    messages: await projectChatMessages(db, auth, {
      rows: page.map((message) => ({ message, thread })),
      memberNameById: input.memberNameById,
      visiblePlayerRequestIds: input.visiblePlayerRequestIds,
    }),
    hasMore: rows.length > input.limit,
  };
}

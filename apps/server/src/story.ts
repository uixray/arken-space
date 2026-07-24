import { createHash } from "node:crypto";
import type { FastifyInstance } from "fastify";
import type { Server } from "socket.io";
import { and, desc, eq, gt, inArray, isNull, lt, or } from "drizzle-orm";
import {
  commitTelegramStoryImportSchema,
  createStoryPostSchema,
  dryRunTelegramStoryImportSchema,
  listStoryPostsSchema,
  storyPostTransitionSchema,
  updateStoryPostSchema,
  type ClientToServerEvents,
  type ServerToClientEvents,
  type StoryEntityLink,
  type StoryPostAdminDto,
  type StoryPostDto,
} from "@arken/contracts";
import {
  chatAttachmentUploads,
  gameEvents,
  storyImportBatches,
  storyImportSources,
  storyPostMedia,
  storyPostRevisions,
  storyPosts,
} from "@arken/db";
import type { AuthContext } from "./auth.js";
import { requireAuth } from "./auth.js";
import { ensureStreamThread } from "./chat.js";
import { openStoredFile } from "./storage.js";

type Database = ReturnType<typeof import("@arken/db").createDatabase>["db"];
type Transaction = Parameters<Parameters<Database["transaction"]>[0]>[0];
type StoryDatabase = Database | Transaction;
type RealtimeServer = Server<ClientToServerEvents, ServerToClientEvents>;
const campaignRoom = (id: string) => `campaign:${id}`;
const gmRoom = (id: string) => `campaign:${id}:gm`;

type Post = typeof storyPosts.$inferSelect;
type MediaInput = {
  contentId: string;
  order: number;
  altText: string;
  caption: string;
};

export function isPlayerVisible(post: Post) {
  return (
    post.visibility === "PUBLIC" &&
    (post.lifecycle === "PUBLISHED" || post.lifecycle === "CORRECTED")
  );
}

function storyError(
  reply: { code: (code: number) => { send: (body: unknown) => unknown } },
  code: string,
  status = 400,
) {
  return reply.code(status).send({ error: code });
}

type StoryReplay =
  | { kind: "MISS" }
  | { kind: "MATCH"; payload: unknown }
  | { kind: "CONFLICT" };

type StoredStoryEventPayload = {
  commandHash: string;
  response: unknown;
};

function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`)
    .join(",")}}`;
}

function storyCommandHash(type: string, command: unknown) {
  return createHash("sha256")
    .update(canonicalJson({ type, command }))
    .digest("hex");
}

function storedStoryEventPayload(value: unknown): StoredStoryEventPayload | null {
  if (!value || typeof value !== "object") return null;
  const payload = value as Partial<StoredStoryEventPayload>;
  return typeof payload.commandHash === "string" && "response" in payload
    ? (payload as StoredStoryEventPayload)
    : null;
}

async function actionReplay(
  db: Database,
  auth: AuthContext,
  actionId: string,
  type: string,
  commandHash: string,
): Promise<StoryReplay> {
  const [event] = await db
    .select()
    .from(gameEvents)
    .where(
      and(
        eq(gameEvents.campaignId, auth.campaignId),
        eq(gameEvents.actionId, actionId),
      ),
    )
    .limit(1);
  if (!event) return { kind: "MISS" };
  const payload = storedStoryEventPayload(event.payload);
  if (
    event.membershipId !== auth.membershipId ||
    event.type !== type ||
    !payload ||
    payload.commandHash !== commandHash
  )
    return { kind: "CONFLICT" };
  return { kind: "MATCH", payload: payload.response };
}

function decodeStoryCursor(cursor: string) {
  try {
    const value = JSON.parse(
      Buffer.from(cursor, "base64url").toString("utf8"),
    ) as { updatedAt?: unknown; id?: unknown };
    if (typeof value.updatedAt !== "string" || typeof value.id !== "string")
      throw new Error("invalid cursor");
    const updatedAt = new Date(value.updatedAt);
    if (Number.isNaN(updatedAt.getTime())) throw new Error("invalid cursor");
    return { updatedAt, id: value.id };
  } catch {
    throw new Error("STORY_CURSOR_INVALID");
  }
}

function encodeStoryCursor(post: Post) {
  return Buffer.from(
    JSON.stringify({ updatedAt: post.updatedAt.toISOString(), id: post.id }),
  ).toString("base64url");
}

export function mergedContent(
  post: Post,
  patch: {
    title?: string;
    body?: string;
    entityLinks?: StoryEntityLink[];
    media?: MediaInput[];
  },
  currentMedia: MediaInput[],
) {
  const next = {
    title: patch.title ?? post.title,
    body: patch.body ?? post.body,
    entityLinks: patch.entityLinks ?? (post.entityLinks as StoryEntityLink[]),
    media: patch.media ?? currentMedia,
  };
  if (!next.body.trim() && !next.media.length)
    throw new Error("STORY_POST_EMPTY");
  const orders = new Set<number>();
  const ids = new Set<string>();
  for (const media of next.media) {
    if (orders.has(media.order) || ids.has(media.contentId))
      throw new Error("STORY_MEDIA_INVALID");
    orders.add(media.order);
    ids.add(media.contentId);
  }
  const links = new Set<string>();
  for (const link of next.entityLinks) {
    const key = `${link.kind}:${link.entityId}`;
    if (links.has(key)) throw new Error("STORY_LINKS_INVALID");
    links.add(key);
  }
  return next;
}

async function mediaForRevision(
  db: StoryDatabase,
  campaignId: string,
  postId: string,
  revision: number,
) {
  return db
    .select({ media: storyPostMedia, upload: chatAttachmentUploads })
    .from(storyPostMedia)
    .innerJoin(
      chatAttachmentUploads,
      and(
        eq(chatAttachmentUploads.campaignId, storyPostMedia.campaignId),
        eq(chatAttachmentUploads.contentId, storyPostMedia.contentId),
      ),
    )
    .where(
      and(
        eq(storyPostMedia.campaignId, campaignId),
        eq(storyPostMedia.postId, postId),
        eq(storyPostMedia.revision, revision),
      ),
    )
    .orderBy(storyPostMedia.sortOrder);
}

function dto(
  post: Post,
  mediaRows: Awaited<ReturnType<typeof mediaForRevision>>,
  admin: boolean,
  source?: typeof storyImportSources.$inferSelect | null,
): StoryPostDto | StoryPostAdminDto {
  const base = {
    id: post.id,
    threadId: post.threadId,
    authorMembershipId: post.authorMembershipId,
    title: post.title,
    body: post.body,
    revision: post.revision,
    entityLinks: post.entityLinks as StoryEntityLink[],
    media: mediaRows.map(({ media, upload }) => ({
      contentId: media.contentId,
      order: media.sortOrder,
      altText: media.altText,
      caption: media.caption,
      fileName: upload.fileName,
      mimeType: upload.mimeType,
      sizeBytes: upload.sizeBytes,
      width: upload.width,
      height: upload.height,
      createdAt: upload.createdAt.toISOString(),
    })),
    createdAt: post.createdAt.toISOString(),
    updatedAt: post.updatedAt.toISOString(),
  };
  if (!admin)
    return {
      ...base,
      lifecycle: post.lifecycle as "PUBLISHED" | "CORRECTED",
      publishedAt: post.publishedAt!.toISOString(),
      correctedAt: post.correctedAt?.toISOString() ?? null,
    };
  return {
    ...base,
    lifecycle: post.lifecycle,
    publishedAt: post.publishedAt?.toISOString() ?? null,
    correctedAt: post.correctedAt?.toISOString() ?? null,
    archivedAt: post.archivedAt?.toISOString() ?? null,
    gmNotes: post.gmNotes,
    importProvenance: source
      ? {
          provider: source.provider,
          sourceMessageId: source.sourceMessageId,
          sourceAuthor: source.sourceAuthor,
          sourceTimestamp: source.sourceTimestamp.toISOString(),
          sourceUrl: source.sourceUrl,
          rightsStatus: source.rightsStatus,
        }
      : null,
  };
}

async function loadPost(db: Database, auth: AuthContext, postId: string) {
  const [post] = await db
    .select()
    .from(storyPosts)
    .where(
      and(
        eq(storyPosts.campaignId, auth.campaignId),
        eq(storyPosts.id, postId),
      ),
    )
    .limit(1);
  return post;
}

async function assertStoryThread(db: Database, campaignId: string) {
  return ensureStreamThread(db, campaignId, "STORY");
}

/** Atomically consume only new staged uploads owned by this GM. */
async function claimNewMedia(
  tx: StoryDatabase,
  auth: AuthContext,
  media: MediaInput[],
  existing: MediaInput[] = [],
) {
  const existingIds = new Set(existing.map((item) => item.contentId));
  const ids = [
    ...new Set(
      media
        .map((item) => item.contentId)
        .filter((contentId) => !existingIds.has(contentId)),
    ),
  ];
  if (!ids.length) return;
  const claimed = await tx
    .update(chatAttachmentUploads)
    .set({ status: "CLAIMED" })
    .where(
      and(
        eq(chatAttachmentUploads.campaignId, auth.campaignId),
        eq(chatAttachmentUploads.uploadedByMembershipId, auth.membershipId),
        eq(chatAttachmentUploads.status, "STAGED"),
        gt(chatAttachmentUploads.expiresAt, new Date()),
        inArray(chatAttachmentUploads.contentId, ids),
      ),
    )
    .returning({ contentId: chatAttachmentUploads.contentId });
  if (claimed.length !== ids.length) throw new Error("STORY_MEDIA_NOT_FOUND");
}

async function persistRevision(
  tx: StoryDatabase,
  post: Post,
  changedByMembershipId: string,
  values: {
    title: string;
    body: string;
    gmNotes: string;
    entityLinks: StoryEntityLink[];
    lifecycle: Post["lifecycle"];
    media: MediaInput[];
  },
  revision: number,
) {
  await tx.insert(storyPostRevisions).values({
    campaignId: post.campaignId,
    postId: post.id,
    revision,
    lifecycle: values.lifecycle,
    title: values.title,
    body: values.body,
    gmNotes: values.gmNotes,
    entityLinks: values.entityLinks,
    changedByMembershipId,
  });
  if (values.media.length)
    await tx.insert(storyPostMedia).values(
      values.media.map((media) => ({
        campaignId: post.campaignId,
        postId: post.id,
        revision,
        contentId: media.contentId,
        sortOrder: media.order,
        altText: media.altText,
        caption: media.caption,
      })),
    );
}

async function recordEvent(
  tx: StoryDatabase,
  auth: AuthContext,
  actionId: string,
  type: string,
  post: Post,
  payload: unknown,
  commandHash: string,
) {
  const [event] = await tx
    .insert(gameEvents)
    .values({
      campaignId: auth.campaignId,
      actionId,
      membershipId: auth.membershipId,
      type,
      entityType: "story_post",
      entityId: post.id,
      entityRevision: post.revision,
      payload: { response: payload, commandHash },
    })
    .returning();
  if (!event) throw new Error("EVENT_RECORD_FAILED");
  return event;
}

function emitStory(io: RealtimeServer, post: Post) {
  const event = { campaignId: post.campaignId, postId: post.id };
  if (isPlayerVisible(post))
    io.to(campaignRoom(post.campaignId)).emit("story:changed", event);
  else io.to(gmRoom(post.campaignId)).emit("story:changed", event);
}

export function registerStoryRoutes(
  app: FastifyInstance,
  db: Database,
  io: RealtimeServer,
) {
  app.get("/api/story/posts", async (request, reply) => {
    const auth = await requireAuth(request, reply, db);
    if (!auth) return;
    const query = listStoryPostsSchema.parse(request.query);
    let cursor: ReturnType<typeof decodeStoryCursor> | undefined;
    try {
      cursor = query.cursor ? decodeStoryCursor(query.cursor) : undefined;
    } catch (error) {
      return storyError(
        reply,
        error instanceof Error ? error.message : "STORY_CURSOR_INVALID",
      );
    }
    const clauses = [eq(storyPosts.campaignId, auth.campaignId)];
    if (auth.role !== "GM") {
      clauses.push(eq(storyPosts.visibility, "PUBLIC"));
      clauses.push(
        or(
          eq(storyPosts.lifecycle, "PUBLISHED"),
          eq(storyPosts.lifecycle, "CORRECTED"),
        )!,
      );
    }
    if (cursor)
      clauses.push(
        or(
          lt(storyPosts.updatedAt, cursor.updatedAt),
          and(
            eq(storyPosts.updatedAt, cursor.updatedAt),
            lt(storyPosts.id, cursor.id),
          ),
        )!,
      );
    const posts = await db
      .select()
      .from(storyPosts)
      .where(and(...clauses))
      .orderBy(desc(storyPosts.updatedAt), desc(storyPosts.id))
      .limit(query.limit + 1);
    const page = posts.slice(0, query.limit);
    const sources =
      auth.role === "GM" && page.length
        ? await db
            .select()
            .from(storyImportSources)
            .where(
              and(
                eq(storyImportSources.campaignId, auth.campaignId),
                inArray(
                  storyImportSources.postId,
                  page.map((post) => post.id),
                ),
              ),
            )
        : [];
    const sourceByPost = new Map(
      sources.map((source) => [source.postId, source]),
    );
    const entries = await Promise.all(
      page.map(async (post) =>
        dto(
          post,
          await mediaForRevision(db, auth.campaignId, post.id, post.revision),
          auth.role === "GM",
          sourceByPost.get(post.id),
        ),
      ),
    );
    return {
      posts: entries,
      nextCursor:
        posts.length > query.limit && page.at(-1)
          ? encodeStoryCursor(page.at(-1)!)
          : null,
    };
  });

  app.post("/api/story/posts", async (request, reply) => {
    const auth = await requireAuth(request, reply, db);
    if (!auth) return;
    if (auth.role !== "GM") return storyError(reply, "GM_REQUIRED", 403);
    const body = createStoryPostSchema.parse(request.body);
    const commandHash = storyCommandHash("story.created", body);
    const replay = await actionReplay(
      db,
      auth,
      body.actionId,
      "story.created",
      commandHash,
    );
    if (replay.kind === "MATCH") return reply.code(200).send(replay.payload);
    if (replay.kind === "CONFLICT")
      return storyError(reply, "ACTION_ID_CONFLICT", 409);
    try {
      const thread = await assertStoryThread(db, auth.campaignId);
      const now = new Date();
      const saved = await db.transaction(async (tx) => {
        const [post] = await tx
          .insert(storyPosts)
          .values({
            campaignId: auth.campaignId,
            threadId: thread.id,
            authorMembershipId: auth.membershipId,
            title: body.title,
            body: body.body,
            gmNotes: body.gmNotes,
            entityLinks: body.entityLinks,
            createdAt: now,
            updatedAt: now,
          })
          .returning();
        if (!post) throw new Error("STORY_POST_CREATE_FAILED");
        await claimNewMedia(tx, auth, body.media);
        await persistRevision(
          tx,
          post,
          auth.membershipId,
          { ...body, lifecycle: "DRAFT" },
          0,
        );

        const result = dto(
          post,
          await mediaForRevision(tx, auth.campaignId, post.id, 0),
          true,
        );
        const event = await recordEvent(
          tx,
          auth,
          body.actionId,
          "story.created",
          post,
          result,
          commandHash,
        );
        return { post, result, event };
      });
      emitStory(io, saved.post);
      return reply.code(201).send(saved.result);
    } catch (error) {
      const retry = await actionReplay(
        db,
        auth,
        body.actionId,
        "story.created",
        commandHash,
      );
      if (retry.kind === "MATCH") return reply.code(200).send(retry.payload);
      if (retry.kind === "CONFLICT")
        return storyError(reply, "ACTION_ID_CONFLICT", 409);
      const code =
        error instanceof Error ? error.message : "STORY_POST_CREATE_FAILED";
      return storyError(
        reply,
        code,
        code === "STORY_MEDIA_NOT_FOUND" ? 404 : 400,
      );
    }
  });

  app.patch("/api/story/posts/:postId", async (request, reply) => {
    const auth = await requireAuth(request, reply, db);
    if (!auth) return;
    if (auth.role !== "GM") return storyError(reply, "GM_REQUIRED", 403);
    const body = updateStoryPostSchema.parse({
      ...(request.body as object),
      ...(request.params as object),
    });
    const commandHash = storyCommandHash("story.updated", body);
    const replay = await actionReplay(
      db,
      auth,
      body.actionId,
      "story.updated",
      commandHash,
    );
    if (replay.kind === "MATCH") return reply.code(200).send(replay.payload);
    if (replay.kind === "CONFLICT")
      return storyError(reply, "ACTION_ID_CONFLICT", 409);
    const current = await loadPost(db, auth, body.postId);
    if (!current) return storyError(reply, "STORY_POST_NOT_FOUND", 404);
    if (current.revision !== body.revision)
      return storyError(reply, "STORY_POST_CONFLICT", 409);
    if (current.lifecycle === "ARCHIVED")
      return storyError(reply, "STORY_POST_ARCHIVED", 409);
    try {
      const currentMedia = (
        await mediaForRevision(
          db,
          auth.campaignId,
          current.id,
          current.revision,
        )
      ).map(({ media }) => ({
        contentId: media.contentId,
        order: media.sortOrder,
        altText: media.altText,
        caption: media.caption,
      }));
      const content = mergedContent(current, body, currentMedia);

      const nextRevision = current.revision + 1;
      const nextLifecycle =
        current.lifecycle === "PUBLISHED" ? "CORRECTED" : current.lifecycle;
      const saved = await db.transaction(async (tx) => {
        await claimNewMedia(tx, auth, content.media, currentMedia);
        const [post] = await tx
          .update(storyPosts)
          .set({
            title: content.title,
            body: content.body,
            entityLinks: content.entityLinks,
            gmNotes: body.gmNotes ?? current.gmNotes,
            lifecycle: nextLifecycle,
            correctedAt:
              nextLifecycle === "CORRECTED" ? new Date() : current.correctedAt,
            revision: nextRevision,
            updatedAt: new Date(),
          })
          .where(
            and(
              eq(storyPosts.id, current.id),
              eq(storyPosts.revision, current.revision),
            ),
          )
          .returning();
        if (!post) throw new Error("STORY_POST_CONFLICT");
        await persistRevision(
          tx,
          post,
          auth.membershipId,
          { ...content, gmNotes: post.gmNotes, lifecycle: post.lifecycle },
          nextRevision,
        );

        const result = dto(
          post,
          await mediaForRevision(tx, auth.campaignId, post.id, nextRevision),
          true,
        );
        const event = await recordEvent(
          tx,
          auth,
          body.actionId,
          "story.updated",
          post,
          result,
          commandHash,
        );
        return { post, result, event };
      });
      emitStory(io, saved.post);
      return saved.result;
    } catch (error) {
      const retry = await actionReplay(
        db,
        auth,
        body.actionId,
        "story.updated",
        commandHash,
      );
      if (retry.kind === "MATCH") return reply.code(200).send(retry.payload);
      if (retry.kind === "CONFLICT")
        return storyError(reply, "ACTION_ID_CONFLICT", 409);
      const code =
        error instanceof Error ? error.message : "STORY_POST_UPDATE_FAILED";
      return storyError(
        reply,
        code,
        code === "STORY_POST_CONFLICT"
          ? 409
          : code === "STORY_MEDIA_NOT_FOUND"
            ? 404
            : 400,
      );
    }
  });

  for (const [path, target] of [
    ["/api/story/posts/:postId/publish", "PUBLISHED"],
    ["/api/story/posts/:postId/archive", "ARCHIVED"],
  ] as const)
    app.post(path, async (request, reply) => {
      const auth = await requireAuth(request, reply, db);
      if (!auth) return;
      if (auth.role !== "GM") return storyError(reply, "GM_REQUIRED", 403);
      const body = storyPostTransitionSchema.parse({
        ...(request.body as object),
        ...(request.params as object),
      });
      const eventType =
        target === "PUBLISHED" ? "story.published" : "story.archived";
      const commandHash = storyCommandHash(eventType, body);
      const replay = await actionReplay(
        db,
        auth,
        body.actionId,
        eventType,
        commandHash,
      );
      if (replay.kind === "MATCH") return reply.code(200).send(replay.payload);
      if (replay.kind === "CONFLICT")
        return storyError(reply, "ACTION_ID_CONFLICT", 409);
      const current = await loadPost(db, auth, body.postId);
      if (!current) return storyError(reply, "STORY_POST_NOT_FOUND", 404);
      if (current.revision !== body.revision)
        return storyError(reply, "STORY_POST_CONFLICT", 409);
      if (target === "PUBLISHED" && current.lifecycle !== "DRAFT")
        return storyError(reply, "STORY_POST_TRANSITION_INVALID", 409);
      if (target === "ARCHIVED" && current.lifecycle === "ARCHIVED")
        return storyError(reply, "STORY_POST_TRANSITION_INVALID", 409);
      try {
        if (target === "PUBLISHED") {
          const [source] = await db
            .select()
            .from(storyImportSources)
            .where(
              and(
                eq(storyImportSources.campaignId, auth.campaignId),
                eq(storyImportSources.postId, current.id),
              ),
            )
            .limit(1);
          if (source && source.rightsStatus !== "APPROVED")
            return storyError(reply, "STORY_RIGHTS_NOT_APPROVED", 409);
        }
        const currentMedia = (
          await mediaForRevision(
            db,
            auth.campaignId,
            current.id,
            current.revision,
          )
        ).map(({ media }) => ({
          contentId: media.contentId,
          order: media.sortOrder,
          altText: media.altText,
          caption: media.caption,
        }));
        const nextRevision = current.revision + 1;
        const now = new Date();
        const saved = await db.transaction(async (tx) => {
          const [post] = await tx
            .update(storyPosts)
            .set({
              lifecycle: target,
              visibility: target === "PUBLISHED" ? "PUBLIC" : "GM_ONLY",
              revision: nextRevision,
              publishedAt: target === "PUBLISHED" ? now : current.publishedAt,
              archivedAt: target === "ARCHIVED" ? now : null,
              updatedAt: now,
            })
            .where(
              and(
                eq(storyPosts.id, current.id),
                eq(storyPosts.revision, current.revision),
              ),
            )
            .returning();
          if (!post) throw new Error("STORY_POST_CONFLICT");
          await persistRevision(
            tx,
            post,
            auth.membershipId,
            {
              title: post.title,
              body: post.body,
              gmNotes: post.gmNotes,
              entityLinks: post.entityLinks as StoryEntityLink[],
              lifecycle: post.lifecycle,
              media: currentMedia,
            },
            nextRevision,
          );
          const result = dto(
            post,
            await mediaForRevision(tx, auth.campaignId, post.id, nextRevision),
            true,
          );
          const event = await recordEvent(
            tx,
            auth,
            body.actionId,
            eventType,
            post,
            result,
            commandHash,
          );
          return { post, result, event };
        });
        if (target === "ARCHIVED")
          io.to(campaignRoom(auth.campaignId)).emit("story:changed", {
            campaignId: auth.campaignId,
            postId: saved.post.id,
          });
        else emitStory(io, saved.post);
        return saved.result;
      } catch (error) {
        const retry = await actionReplay(
          db,
          auth,
          body.actionId,
          eventType,
          commandHash,
        );
        if (retry.kind === "MATCH") return reply.code(200).send(retry.payload);
        if (retry.kind === "CONFLICT")
          return storyError(reply, "ACTION_ID_CONFLICT", 409);
        return storyError(
          reply,
          error instanceof Error
            ? error.message
            : "STORY_POST_TRANSITION_FAILED",
          409,
        );
      }
    });

  app.get("/api/story/media/:contentId", async (request, reply) => {
    const auth = await requireAuth(request, reply, db);
    if (!auth) return;
    const contentId = (request.params as { contentId?: string }).contentId;
    if (!contentId) return storyError(reply, "NOT_FOUND", 404);
    const playerVisibility =
      auth.role === "GM"
        ? undefined
        : and(
            eq(storyPostMedia.revision, storyPosts.revision),
            eq(storyPosts.visibility, "PUBLIC"),
            or(
              eq(storyPosts.lifecycle, "PUBLISHED"),
              eq(storyPosts.lifecycle, "CORRECTED"),
            ),
          );
    const rows = await db
      .select({
        media: storyPostMedia,
        post: storyPosts,
        upload: chatAttachmentUploads,
      })
      .from(storyPostMedia)
      .innerJoin(
        storyPosts,
        and(
          eq(storyPosts.campaignId, storyPostMedia.campaignId),
          eq(storyPosts.id, storyPostMedia.postId),
        ),
      )
      .innerJoin(
        chatAttachmentUploads,
        and(
          eq(chatAttachmentUploads.campaignId, storyPostMedia.campaignId),
          eq(chatAttachmentUploads.contentId, storyPostMedia.contentId),
        ),
      )
      .where(
        and(
          eq(storyPostMedia.campaignId, auth.campaignId),
          eq(storyPostMedia.contentId, contentId),
          playerVisibility,
        ),
      )
      .limit(1);
    const item = rows[0];
    if (!item) return storyError(reply, "NOT_FOUND", 404);
    try {
      const opened = await openStoredFile(item.upload.storageKey, undefined);
      reply.header("Content-Type", item.upload.mimeType);
      reply.header("Content-Length", String(opened.size));
      reply.header("Cache-Control", "private, no-store");
      return reply.send(opened.stream);
    } catch {
      return storyError(reply, "NOT_FOUND", 404);
    }
  });

  app.post("/api/story/imports/telegram/dry-run", async (request, reply) => {
    const auth = await requireAuth(request, reply, db);
    if (!auth) return;
    if (auth.role !== "GM") return storyError(reply, "GM_REQUIRED", 403);
    const body = dryRunTelegramStoryImportSchema.parse(request.body);
    const existing = await db
      .select()
      .from(storyImportSources)
      .where(
        and(
          eq(storyImportSources.campaignId, auth.campaignId),
          inArray(
            storyImportSources.sourceMessageId,
            body.records.map((record) => record.sourceMessageId),
          ),
        ),
      );
    const byId = new Map(
      existing.map((source) => [source.sourceMessageId, source]),
    );
    const importBatchId = crypto.randomUUID();
    await db.insert(storyImportBatches).values({
      id: importBatchId,
      campaignId: auth.campaignId,
      createdByMembershipId: auth.membershipId,
      recordFingerprint: storyCommandHash("story.import.records", body.records),
      expiresAt: new Date(Date.now() + 30 * 60 * 1000),
    });
    return {
      importBatchId,
      provider: "TELEGRAM" as const,
      items: body.records.map((record) => {
        const source = byId.get(record.sourceMessageId);
        return {
          sourceMessageId: record.sourceMessageId,
          action: source
            ? ("ALREADY_IMPORTED" as const)
            : ("CREATE_DRAFT" as const),
          existingPostId: source?.postId ?? null,
          rightsStatus: source?.rightsStatus ?? null,
        };
      }),
    };
  });

  app.post("/api/story/imports/telegram/commit", async (request, reply) => {
    const auth = await requireAuth(request, reply, db);
    if (!auth) return;
    if (auth.role !== "GM") return storyError(reply, "GM_REQUIRED", 403);
    const body = commitTelegramStoryImportSchema.parse(request.body);
    const commandHash = storyCommandHash("story.imported", body);
    const replay = await actionReplay(
      db,
      auth,
      body.actionId,
      "story.imported",
      commandHash,
    );
    if (replay.kind === "MATCH") return reply.code(200).send(replay.payload);
    if (replay.kind === "CONFLICT")
      return storyError(reply, "ACTION_ID_CONFLICT", 409);
    const thread = await assertStoryThread(db, auth.campaignId);
    try {
      const result = await db.transaction(async (tx) => {
        const now = new Date();
        const [batch] = await tx
          .update(storyImportBatches)
          .set({ consumedAt: now })
          .where(
            and(
              eq(storyImportBatches.id, body.importBatchId),
              eq(storyImportBatches.campaignId, auth.campaignId),
              eq(storyImportBatches.createdByMembershipId, auth.membershipId),
              gt(storyImportBatches.expiresAt, now),
              isNull(storyImportBatches.consumedAt),
            ),
          )
          .returning();
        if (!batch) throw new Error("STORY_IMPORT_REVIEW_REQUIRED");
        if (
          batch.recordFingerprint !==
          storyCommandHash("story.import.records", body.records)
        )
          throw new Error("STORY_IMPORT_BATCH_MISMATCH");

        const existing = await tx
          .select()
          .from(storyImportSources)
          .where(
            and(
              eq(storyImportSources.campaignId, auth.campaignId),
              inArray(
                storyImportSources.sourceMessageId,
                body.records.map((record) => record.sourceMessageId),
              ),
            ),
          );
        const byId = new Map(
          existing.map((source) => [source.sourceMessageId, source]),
        );
        const rightById = new Map(
          body.rights.map((right) => [right.sourceMessageId, right.status]),
        );
        const posts: string[] = [];
        let created = 0;
        for (const record of body.records) {
          const previous = byId.get(record.sourceMessageId);
          const rightsStatus = rightById.get(record.sourceMessageId)!;
          if (previous) {
            if (
              storyCommandHash("story.import.record", previous.sourcePayload) !==
              storyCommandHash("story.import.record", record)
            )
              throw new Error("STORY_IMPORT_SOURCE_MISMATCH");
            if (previous.rightsStatus !== rightsStatus)
              await tx
                .update(storyImportSources)
                .set({ rightsStatus })
                .where(eq(storyImportSources.id, previous.id));
            posts.push(previous.postId);
            continue;
          }
          const [post] = await tx
            .insert(storyPosts)
            .values({
              campaignId: auth.campaignId,
              threadId: thread.id,
              authorMembershipId: auth.membershipId,
              body: record.body,
              gmNotes:
                "Imported Telegram record: review rights and media before publishing.",
              entityLinks: [],
              createdAt: now,
              updatedAt: now,
            })
            .returning();
          if (!post) throw new Error("STORY_IMPORT_CREATE_FAILED");
          await persistRevision(
            tx,
            post,
            auth.membershipId,
            {
              title: "",
              body: record.body,
              gmNotes: post.gmNotes,
              entityLinks: [],
              lifecycle: "DRAFT",
              media: [],
            },
            0,
          );
          await tx.insert(storyImportSources).values({
            campaignId: auth.campaignId,
            postId: post.id,
            provider: "TELEGRAM",
            sourceMessageId: record.sourceMessageId,
            sourceAuthor: record.sourceAuthor,
            sourceTimestamp: new Date(record.sourceTimestamp),
            sourceUrl: record.sourceUrl ?? null,
            sourcePayload: record,
            rightsStatus,
            importBatchId: batch.id,
            importedByMembershipId: auth.membershipId,
          });
          posts.push(post.id);
          created += 1;
        }
        const response = { postIds: posts, imported: created };
        const [event] = await tx
          .insert(gameEvents)
          .values({
            campaignId: auth.campaignId,
            actionId: body.actionId,
            membershipId: auth.membershipId,
            type: "story.imported",
            entityType: "story_import",
            entityId: posts[0]!,
            payload: { response, commandHash },
          })
          .returning();
        return { ...response, event };
      });
      io.to(gmRoom(auth.campaignId)).emit("story:changed", {
        campaignId: auth.campaignId,
        postId: null,
      });
      return reply
        .code(201)
        .send({ postIds: result.postIds, imported: result.imported });
    } catch (error) {
      const retry = await actionReplay(
        db,
        auth,
        body.actionId,
        "story.imported",
        commandHash,
      );
      if (retry.kind === "MATCH") return reply.code(200).send(retry.payload);
      if (retry.kind === "CONFLICT")
        return storyError(reply, "ACTION_ID_CONFLICT", 409);
      return storyError(
        reply,
        error instanceof Error ? error.message : "STORY_IMPORT_FAILED",
        409,
      );
    }
  });
}

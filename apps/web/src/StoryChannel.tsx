import { useRef, useState, type FormEvent } from "react";
import type {
  ChatAttachmentMetadata,
  ChatMessageDto,
  StoryEntityLink,
  StoryPostAdminDto,
  StoryPostDto,
} from "@arken/contracts";

export type StoryPostView = StoryPostDto | StoryPostAdminDto;
export type StoryMediaDraft = {
  contentId: string;
  fileName: string;
  altText: string;
  caption: string;
};
export type StoryDraftInput = {
  title: string;
  body: string;
  media: Array<{
    contentId: string;
    order: number;
    altText: string;
    caption: string;
  }>;
  entityLinks: StoryEntityLink[];
  gmNotes: string;
};

import {
  canCreateStoryDraft,
  isStoryAdminPost,
  storyPostMedia,
  storyPostStatus,
} from "./story-channel-helpers";

function imageUrl(contentId: string) {
  return `/api/story/media/${contentId}`;
}

export function StoryPost({
  post,
  isGm,
  onPublish,
  onArchive,
  onUpdate,
  onUploadImage,
  mediaUrl = imageUrl,
}: {
  post: StoryPostView;
  isGm: boolean;
  onPublish?: (post: StoryPostAdminDto) => Promise<void>;
  onArchive?: (post: StoryPostAdminDto) => Promise<void>;
  onUpdate?: (post: StoryPostAdminDto, input: StoryDraftInput) => Promise<void>;
  onUploadImage?: (file: File) => Promise<ChatAttachmentMetadata>;
  mediaUrl?: (contentId: string) => string;
}) {
  const [pending, setPending] = useState<
    "publish" | "archive" | "update" | null
  >(null);
  const [failedMedia, setFailedMedia] = useState<ReadonlySet<string>>(
    () => new Set(),
  );
  const adminPost = isStoryAdminPost(post) ? post : null;
  const [editing, setEditing] = useState(false);
  const [draftTitle, setDraftTitle] = useState(post.title);
  const [draftBody, setDraftBody] = useState(post.body);
  const [draftGmNotes, setDraftGmNotes] = useState(adminPost?.gmNotes ?? "");
  const [draftMedia, setDraftMedia] = useState<StoryMediaDraft[]>(() =>
    storyPostMedia(post).map((item) => ({
      contentId: item.contentId,
      fileName: item.fileName,
      altText: item.altText,
      caption: item.caption,
    })),
  );
  const editFileInputRef = useRef<HTMLInputElement>(null);
  const [replacingMediaId, setReplacingMediaId] = useState<string | null>(null);
  const [updateError, setUpdateError] = useState("");

  async function transition(kind: "publish" | "archive") {
    if (!adminPost) return;
    setPending(kind);
    try {
      await (kind === "publish"
        ? onPublish?.(adminPost)
        : onArchive?.(adminPost));
    } finally {
      setPending(null);
    }
  }

  async function uploadCorrectionImage(
    file: File | undefined,
    replaceContentId: string | null,
  ) {
    if (!file || !onUploadImage || pending !== null) return;
    if (!file.type.startsWith("image/")) {
      setUpdateError("Файл должен быть изображением.");
      return;
    }
    setPending("update");
    setUpdateError("");
    try {
      const attachment = await onUploadImage(file);
      const uploaded = {
        contentId: attachment.contentId,
        fileName: attachment.fileName,
        altText: attachment.fileName,
        caption: "",
      };
      setDraftMedia((current) =>
        replaceContentId
          ? current.map((item) =>
              item.contentId === replaceContentId
                ? {
                    ...uploaded,
                    altText: item.altText || uploaded.altText,
                    caption: item.caption,
                  }
                : item,
            )
          : [...current, uploaded].slice(0, 10),
      );
    } catch (reason) {
      setUpdateError(
        reason instanceof Error
          ? reason.message
          : "Не удалось загрузить изображение.",
      );
    } finally {
      setPending(null);
    }
  }

  function beginEditing() {
    if (!adminPost) return;
    setDraftTitle(adminPost.title);
    setDraftBody(adminPost.body);
    setDraftGmNotes(adminPost.gmNotes);
    setDraftMedia(
      storyPostMedia(adminPost).map((item) => ({
        contentId: item.contentId,
        fileName: item.fileName,
        altText: item.altText,
        caption: item.caption,
      })),
    );
    setUpdateError("");
    setEditing(true);
  }

  async function saveCorrection() {
    if (
      !adminPost ||
      !onUpdate ||
      (!draftBody.trim() && draftMedia.length === 0)
    )
      return;
    setPending("update");
    setUpdateError("");
    try {
      await onUpdate(adminPost, {
        title: draftTitle.trim(),
        body: draftBody.trim(),
        media: draftMedia.map((item, order) => ({
          contentId: item.contentId,
          order,
          altText: item.altText.trim() || item.fileName,
          caption: item.caption.trim(),
        })),
        entityLinks: adminPost.entityLinks,
        gmNotes: draftGmNotes,
      });
      setEditing(false);
    } catch (reason) {
      setUpdateError(
        reason instanceof Error
          ? reason.message
          : "Не удалось сохранить исправление.",
      );
    } finally {
      setPending(null);
    }
  }

  return (
    <article className="story-post" data-story-lifecycle={post.lifecycle}>
      <header className="story-post__header">
        <div>
          <span className="eyebrow">
            {"Сюжет \u00b7 "}
            {storyPostStatus(post)}
          </span>
          {post.title && <strong>{post.title}</strong>}
        </div>
        <time dateTime={post.publishedAt ?? post.createdAt}>
          {new Date(post.publishedAt ?? post.createdAt).toLocaleTimeString([], {
            hour: "2-digit",
            minute: "2-digit",
          })}
        </time>
      </header>
      {editing ? (
        <div className="story-post__edit">
          <label>
            Заголовок
            <input
              value={draftTitle}
              maxLength={160}
              disabled={pending !== null}
              onChange={(event) => setDraftTitle(event.target.value)}
            />
          </label>
          <label>
            Текст записи
            <textarea
              value={draftBody}
              disabled={pending !== null}
              onChange={(event) => setDraftBody(event.target.value)}
              rows={5}
            />
          </label>
          {draftMedia.length > 0 && (
            <ul className="story-composer__attachments">
              {draftMedia.map((item) => (
                <li key={item.contentId}>
                  <span>{item.fileName}</span>
                  <label>
                    Альт-текст
                    <input
                      value={item.altText}
                      maxLength={240}
                      disabled={pending !== null}
                      onChange={(event) =>
                        setDraftMedia((current) =>
                          current.map((candidate) =>
                            candidate.contentId === item.contentId
                              ? { ...candidate, altText: event.target.value }
                              : candidate,
                          ),
                        )
                      }
                    />
                  </label>
                  <label>
                    Подпись
                    <input
                      value={item.caption}
                      maxLength={2000}
                      disabled={pending !== null}
                      onChange={(event) =>
                        setDraftMedia((current) =>
                          current.map((candidate) =>
                            candidate.contentId === item.contentId
                              ? { ...candidate, caption: event.target.value }
                              : candidate,
                          ),
                        )
                      }
                    />
                  </label>
                  <div className="story-post__media-actions">
                    <button
                      type="button"
                      disabled={pending !== null || !onUploadImage}
                      onClick={() => {
                        setReplacingMediaId(item.contentId);
                        editFileInputRef.current?.click();
                      }}
                    >
                      Заменить
                    </button>
                    <button
                      type="button"
                      disabled={pending !== null}
                      onClick={() =>
                        setDraftMedia((current) =>
                          current.filter(
                            (candidate) =>
                              candidate.contentId !== item.contentId,
                          ),
                        )
                      }
                    >
                      Удалить
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}
          {onUploadImage && (
            <>
              <input
                ref={editFileInputRef}
                className="story-composer__file-input"
                type="file"
                accept="image/png,image/jpeg,image/webp"
                disabled={pending !== null}
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  event.currentTarget.value = "";
                  const replaceContentId = replacingMediaId;
                  setReplacingMediaId(null);
                  void uploadCorrectionImage(file, replaceContentId);
                }}
              />
              <button
                type="button"
                disabled={pending !== null || draftMedia.length >= 10}
                onClick={() => {
                  setReplacingMediaId(null);
                  editFileInputRef.current?.click();
                }}
              >
                Добавить изображение
              </button>
            </>
          )}
          <label>
            Заметки мастера
            <textarea
              value={draftGmNotes}
              disabled={pending !== null}
              onChange={(event) => setDraftGmNotes(event.target.value)}
              rows={3}
            />
          </label>
        </div>
      ) : (
        post.body && <p className="story-post__body">{post.body}</p>
      )}
      {!editing &&
        storyPostMedia(post).map((media) =>
          failedMedia.has(media.contentId) ? (
            <a
              className="story-post__media-fallback"
              href={mediaUrl(media.contentId)}
              key={media.contentId}
              target="_blank"
              rel="noreferrer"
            >
              Открыть изображение: {media.fileName}
            </a>
          ) : (
            <figure className="story-post__media" key={media.contentId}>
              <img
                src={mediaUrl(media.contentId)}
                alt={media.altText}
                width={media.width ?? undefined}
                height={media.height ?? undefined}
                loading="lazy"
                onError={() =>
                  setFailedMedia((current) =>
                    new Set(current).add(media.contentId),
                  )
                }
              />
              {media.caption && <figcaption>{media.caption}</figcaption>}
            </figure>
          ),
        )}
      {!editing && isGm && adminPost?.gmNotes && (
        <aside className="story-post__gm-notes">
          <strong>Заметки мастера</strong>
          <p>{adminPost.gmNotes}</p>
        </aside>
      )}
      {updateError && (
        <p className="composer-error" role="alert">
          {updateError}
        </p>
      )}
      {isGm && adminPost && (
        <div className="story-post__actions">
          {(adminPost.lifecycle === "DRAFT" ||
            adminPost.lifecycle === "ARCHIVED") &&
            onPublish && (
              <button
                type="button"
                disabled={pending !== null}
                onClick={() => void transition("publish")}
              >
                {pending === "publish"
                  ? adminPost.lifecycle === "ARCHIVED"
                    ? "Восстанавливаем…"
                    : "Публикуем…"
                  : adminPost.lifecycle === "ARCHIVED"
                    ? "Восстановить"
                    : "Опубликовать"}
              </button>
            )}
          {adminPost.lifecycle !== "ARCHIVED" && onUpdate && !editing && (
            <button
              type="button"
              disabled={pending !== null}
              onClick={beginEditing}
            >
              {" "}
              {"Исправить"}{" "}
            </button>
          )}
          {editing && (
            <>
              <button
                type="button"
                disabled={pending !== null}
                onClick={() => void saveCorrection()}
              >
                {"Сохранить"}
              </button>
              <button
                type="button"
                disabled={pending !== null}
                onClick={() => setEditing(false)}
              >
                {"Отмена"}
              </button>
            </>
          )}
          {adminPost.lifecycle !== "ARCHIVED" && onArchive && (
            <button
              type="button"
              disabled={pending !== null}
              onClick={() => void transition("archive")}
            >
              {pending === "archive" ? "Архивируем\u2026" : "В архив"}
            </button>
          )}
        </div>
      )}
    </article>
  );
}

export function StoryChannel({
  posts,
  legacyMessages = [],
  nextCursor = null,
  onLoadMore,
  isGm,
  pending = false,
  onCreateDraft,
  onPublish,
  onArchive,
  onUpdate,
  onUploadImage,
  mediaUrl,
}: {
  posts: readonly StoryPostView[];
  legacyMessages?: readonly ChatMessageDto[];
  nextCursor?: string | null;
  onLoadMore?: () => Promise<void>;
  isGm: boolean;
  pending?: boolean;
  onCreateDraft?: (input: StoryDraftInput) => Promise<void>;
  onPublish?: (post: StoryPostAdminDto) => Promise<void>;
  onArchive?: (post: StoryPostAdminDto) => Promise<void>;
  onUpdate?: (post: StoryPostAdminDto, input: StoryDraftInput) => Promise<void>;
  onUploadImage?: (file: File) => Promise<ChatAttachmentMetadata>;
  mediaUrl?: (contentId: string) => string;
}) {
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [gmNotes, setGmNotes] = useState("");
  const [media, setMedia] = useState<StoryMediaDraft[]>([]);
  const [localPending, setLocalPending] = useState(false);
  const [error, setError] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);
  const busy = pending || localPending;

  async function upload(file: File | undefined) {
    if (!file || !onUploadImage || busy) return;
    if (!file.type.startsWith("image/")) {
      setError("Можно прикрепить только изображение.");
      return;
    }
    setLocalPending(true);
    setError("");
    try {
      const attachment = await onUploadImage(file);
      setMedia((current) =>
        [
          ...current,
          {
            contentId: attachment.contentId,
            fileName: attachment.fileName,
            altText: attachment.fileName,
            caption: "",
          },
        ].slice(0, 10),
      );
    } catch (reason) {
      setError(
        reason instanceof Error
          ? reason.message
          : "Не удалось загрузить изображение.",
      );
    } finally {
      setLocalPending(false);
    }
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!onCreateDraft || !canCreateStoryDraft({ body, media })) return;
    setLocalPending(true);
    setError("");
    try {
      await onCreateDraft({
        title: title.trim(),
        body: body.trim(),
        media: media.map((item, order) => ({
          contentId: item.contentId,
          order,
          altText: item.altText.trim() || item.fileName,
          caption: item.caption.trim(),
        })),
        entityLinks: [],
        gmNotes,
      });
      setTitle("");
      setBody("");
      setGmNotes("");
      setMedia([]);
    } catch (reason) {
      setError(
        reason instanceof Error
          ? reason.message
          : "Не удалось сохранить черновик.",
      );
    } finally {
      setLocalPending(false);
    }
  }

  return (
    <section
      className="story-channel"
      role="tabpanel"
      id="chat-panel-story"
      aria-labelledby="chat-tab-story"
    >
      <header className="story-channel__header">
        <div>
          <span className="eyebrow">{"Летопись кампании"}</span>
          <h2>{"Сюжет"}</h2>
        </div>
        {!isGm && (
          <span className="story-channel__read-only">
            {"Сюжет ведёт мастер"}
          </span>
        )}
      </header>
      <div className="story-channel__timeline" aria-live="polite">
        {legacyMessages.map((message) => (
          <article className="story-post story-post--legacy" key={message.id}>
            <header className="story-post__header">
              <div>
                <span className="eyebrow">{"Ранее в сюжете"}</span>
                <strong>{message.displayName}</strong>
              </div>
              <time dateTime={message.createdAt}>
                {new Date(message.createdAt).toLocaleTimeString([], {
                  hour: "2-digit",
                  minute: "2-digit",
                })}
              </time>
            </header>
            {message.body && <p className="story-post__body">{message.body}</p>}
          </article>
        ))}
        {posts.length === 0 && legacyMessages.length === 0 ? (
          <p className="chat-empty">
            {"В сюжетной ленте пока нет публикаций."}
          </p>
        ) : (
          posts.map((post) => (
            <StoryPost
              key={post.id}
              post={post}
              isGm={isGm}
              onPublish={onPublish}
              onArchive={onArchive}
              onUpdate={onUpdate}
              onUploadImage={onUploadImage}
              mediaUrl={mediaUrl}
            />
          ))
        )}
      </div>
      {nextCursor && onLoadMore && (
        <button
          type="button"
          className="story-channel__load-more"
          disabled={busy}
          onClick={() => void onLoadMore()}
        >
          {"Показать больше"}
        </button>
      )}
      {isGm && onCreateDraft && (
        <form className="story-composer" onSubmit={submit}>
          <label>
            {"Заголовок"}{" "}
            <input
              value={title}
              disabled={busy}
              maxLength={160}
              onChange={(event) => setTitle(event.target.value)}
            />
          </label>
          <label>
            {"Новая публикация"}
            <textarea
              value={body}
              disabled={busy}
              placeholder="Текст новой публикации…"
              rows={4}
              onChange={(event) => setBody(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter" && !event.shiftKey) {
                  event.preventDefault();
                  event.currentTarget.form?.requestSubmit();
                }
              }}
            />
          </label>
          {media.length > 0 && (
            <ul
              className="story-composer__attachments"
              aria-label="Прикреплённые изображения"
            >
              {media.map((item) => (
                <li key={item.contentId}>
                  <span>{item.fileName}</span>
                  <label>
                    {"Описание"}{" "}
                    <input
                      value={item.altText}
                      disabled={busy}
                      maxLength={240}
                      onChange={(event) =>
                        setMedia((current) =>
                          current.map((candidate) =>
                            candidate.contentId === item.contentId
                              ? { ...candidate, altText: event.target.value }
                              : candidate,
                          ),
                        )
                      }
                    />
                  </label>
                  <label>
                    {"Подпись"}{" "}
                    <input
                      value={item.caption}
                      disabled={busy}
                      maxLength={2000}
                      onChange={(event) =>
                        setMedia((current) =>
                          current.map((candidate) =>
                            candidate.contentId === item.contentId
                              ? { ...candidate, caption: event.target.value }
                              : candidate,
                          ),
                        )
                      }
                    />
                  </label>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() =>
                      setMedia((current) =>
                        current.filter(
                          (candidate) => candidate.contentId !== item.contentId,
                        ),
                      )
                    }
                  >
                    {"Убрать"}
                  </button>
                </li>
              ))}
            </ul>
          )}
          <label className="story-composer__gm-notes">
            {"Заметки мастера"}{" "}
            <textarea
              value={gmNotes}
              disabled={busy}
              onChange={(event) => setGmNotes(event.target.value)}
              rows={2}
            />
          </label>
          <div className="story-composer__actions">
            {onUploadImage && (
              <>
                <input
                  ref={fileInputRef}
                  className="story-composer__file-input"
                  type="file"
                  accept="image/png,image/jpeg,image/webp"
                  disabled={busy}
                  onChange={(event) => {
                    const file = event.target.files?.[0];
                    event.currentTarget.value = "";
                    void upload(file);
                  }}
                />
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => fileInputRef.current?.click()}
                >
                  {"Добавить изображение"}
                </button>
              </>
            )}
            <button
              type="submit"
              disabled={busy || !canCreateStoryDraft({ body, media })}
            >
              {busy ? "Сохраняем\u2026" : "Сохранить черновик"}
            </button>
          </div>
          {error && (
            <p className="composer-error" role="alert">
              {error}
            </p>
          )}
        </form>
      )}
    </section>
  );
}

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
  mediaUrl = imageUrl,
}: {
  post: StoryPostView;
  isGm: boolean;
  onPublish?: (post: StoryPostAdminDto) => Promise<void>;
  onArchive?: (post: StoryPostAdminDto) => Promise<void>;
  onUpdate?: (post: StoryPostAdminDto, input: StoryDraftInput) => Promise<void>;
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
  const [draftBody, setDraftBody] = useState(post.body);
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

  async function saveCorrection() {
    if (!adminPost || !onUpdate || !draftBody.trim()) return;
    setPending("update");
    setUpdateError("");
    try {
      await onUpdate(adminPost, {
        title: adminPost.title,
        body: draftBody.trim(),
        media: adminPost.media.map((item) => ({
          contentId: item.contentId,
          order: item.order,
          altText: item.altText,
          caption: item.caption,
        })),
        entityLinks: adminPost.entityLinks,
        gmNotes: adminPost.gmNotes,
      });
      setEditing(false);
    } catch (reason) {
      setUpdateError(
        reason instanceof Error
          ? reason.message
          : "\u041d\u0435 \u0443\u0434\u0430\u043b\u043e\u0441\u044c \u0441\u043e\u0445\u0440\u0430\u043d\u0438\u0442\u044c \u0438\u0441\u043f\u0440\u0430\u0432\u043b\u0435\u043d\u0438\u0435.",
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
            {"\u0421\u044e\u0436\u0435\u0442 \u00b7 "}
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
        <label className="story-post__edit">
          {
            "\u0422\u0435\u043a\u0441\u0442 \u0441\u044e\u0436\u0435\u0442\u0430"
          }
          <textarea
            value={draftBody}
            disabled={pending !== null}
            onChange={(event) => setDraftBody(event.target.value)}
            rows={5}
          />
        </label>
      ) : (
        post.body && <p className="story-post__body">{post.body}</p>
      )}
      {storyPostMedia(post).map((media) =>
        failedMedia.has(media.contentId) ? (
          <a
            className="story-post__media-fallback"
            href={mediaUrl(media.contentId)}
            key={media.contentId}
            target="_blank"
            rel="noreferrer"
          >
            {
              "\u041e\u0442\u043a\u0440\u044b\u0442\u044c \u0438\u0437\u043e\u0431\u0440\u0430\u0436\u0435\u043d\u0438\u0435: "
            }
            {media.fileName}
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
      {updateError && (
        <p className="composer-error" role="alert">
          {updateError}
        </p>
      )}
      {isGm && adminPost && (
        <div className="story-post__actions">
          {adminPost.lifecycle === "DRAFT" && onPublish && (
            <button
              type="button"
              disabled={pending !== null}
              onClick={() => void transition("publish")}
            >
              {pending === "publish"
                ? "\u041f\u0443\u0431\u043b\u0438\u043a\u0443\u0435\u043c\u2026"
                : "\u041e\u043f\u0443\u0431\u043b\u0438\u043a\u043e\u0432\u0430\u0442\u044c"}
            </button>
          )}
          {adminPost.lifecycle !== "ARCHIVED" && onUpdate && !editing && (
            <button
              type="button"
              disabled={pending !== null}
              onClick={() => {
                setDraftBody(adminPost.body);
                setEditing(true);
              }}
            >
              {" "}
              {
                "\u0418\u0441\u043f\u0440\u0430\u0432\u0438\u0442\u044c"
              }{" "}
            </button>
          )}
          {editing && (
            <>
              <button
                type="button"
                disabled={pending !== null}
                onClick={() => void saveCorrection()}
              >
                {
                  "\u0421\u043e\u0445\u0440\u0430\u043d\u0438\u0442\u044c"
                }
              </button>
              <button
                type="button"
                disabled={pending !== null}
                onClick={() => setEditing(false)}
              >
                {"\u041e\u0442\u043c\u0435\u043d\u0430"}
              </button>
            </>
          )}
          {adminPost.lifecycle !== "ARCHIVED" && onArchive && (
            <button
              type="button"
              disabled={pending !== null}
              onClick={() => void transition("archive")}
            >
              {pending === "archive"
                ? "\u0410\u0440\u0445\u0438\u0432\u0438\u0440\u0443\u0435\u043c\u2026"
                : "\u0412 \u0430\u0440\u0445\u0438\u0432"}
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
      setError(
        "\u041c\u043e\u0436\u043d\u043e \u043f\u0440\u0438\u043a\u0440\u0435\u043f\u0438\u0442\u044c \u0442\u043e\u043b\u044c\u043a\u043e \u0438\u0437\u043e\u0431\u0440\u0430\u0436\u0435\u043d\u0438\u0435.",
      );
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
          : "\u041d\u0435 \u0443\u0434\u0430\u043b\u043e\u0441\u044c \u0437\u0430\u0433\u0440\u0443\u0437\u0438\u0442\u044c \u0438\u0437\u043e\u0431\u0440\u0430\u0436\u0435\u043d\u0438\u0435.",
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
          : "\u041d\u0435 \u0443\u0434\u0430\u043b\u043e\u0441\u044c \u0441\u043e\u0445\u0440\u0430\u043d\u0438\u0442\u044c \u0447\u0435\u0440\u043d\u043e\u0432\u0438\u043a.",
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
          <span className="eyebrow">
            {"\u041b\u0435\u0442\u043e\u043f\u0438\u0441\u044c \u043a\u0430\u043c\u043f\u0430\u043d\u0438\u0438"}
          </span>
          <h2>{"\u0421\u044e\u0436\u0435\u0442"}</h2>
        </div>
        {!isGm && (
          <span className="story-channel__read-only">
            {
              "\u0421\u044e\u0436\u0435\u0442 \u0432\u0435\u0434\u0451\u0442 \u043c\u0430\u0441\u0442\u0435\u0440"
            }
          </span>
        )}
      </header>
      <div className="story-channel__timeline" aria-live="polite">
        {legacyMessages.map((message) => (
          <article className="story-post story-post--legacy" key={message.id}>
            <header className="story-post__header">
              <div>
                <span className="eyebrow">
                  {"\u0420\u0430\u043d\u0435\u0435 \u0432 \u0441\u044e\u0436\u0435\u0442\u0435"}
                </span>
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
            {
              "\u0412 \u0441\u044e\u0436\u0435\u0442\u043d\u043e\u0439 \u043b\u0435\u043d\u0442\u0435 \u043f\u043e\u043a\u0430 \u043d\u0435\u0442 \u043f\u0443\u0431\u043b\u0438\u043a\u0430\u0446\u0438\u0439."
            }
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
          {"\u041f\u043e\u043a\u0430\u0437\u0430\u0442\u044c \u0431\u043e\u043b\u044c\u0448\u0435"}
        </button>
      )}
      {isGm && onCreateDraft && (
        <form className="story-composer" onSubmit={submit}>
          <label>
            {"\u0417\u0430\u0433\u043e\u043b\u043e\u0432\u043e\u043a"}{" "}
            <input
              value={title}
              disabled={busy}
              maxLength={160}
              onChange={(event) => setTitle(event.target.value)}
            />
          </label>
          <label>
            {
              "\u041d\u043e\u0432\u0430\u044f \u043f\u0443\u0431\u043b\u0438\u043a\u0430\u0446\u0438\u044f"
            }
            <textarea
              value={body}
              disabled={busy}
              placeholder="\u041f\u0440\u043e\u0434\u043e\u043b\u0436\u0438\u0442\u044c \u0438\u0441\u0442\u043e\u0440\u0438\u044e\u2026"
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
              aria-label="\u041f\u0440\u0438\u043a\u0440\u0435\u043f\u043b\u0451\u043d\u043d\u044b\u0435 \u0438\u0437\u043e\u0431\u0440\u0430\u0436\u0435\u043d\u0438\u044f"
            >
              {media.map((item) => (
                <li key={item.contentId}>
                  <span>{item.fileName}</span>
                  <label>
                    {"\u041e\u043f\u0438\u0441\u0430\u043d\u0438\u0435"}{" "}
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
                    {"\u041f\u043e\u0434\u043f\u0438\u0441\u044c"}{" "}
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
                    {"\u0423\u0431\u0440\u0430\u0442\u044c"}
                  </button>
                </li>
              ))}
            </ul>
          )}
          <label className="story-composer__gm-notes">
            {
              "\u0417\u0430\u043c\u0435\u0442\u043a\u0438 \u043c\u0430\u0441\u0442\u0435\u0440\u0430"
            }{" "}
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
                  {
                    "\u0414\u043e\u0431\u0430\u0432\u0438\u0442\u044c \u0438\u0437\u043e\u0431\u0440\u0430\u0436\u0435\u043d\u0438\u0435"
                  }
                </button>
              </>
            )}
            <button
              type="submit"
              disabled={busy || !canCreateStoryDraft({ body, media })}
            >
              {busy
                ? "\u0421\u043e\u0445\u0440\u0430\u043d\u044f\u0435\u043c\u2026"
                : "\u0421\u043e\u0445\u0440\u0430\u043d\u0438\u0442\u044c \u0447\u0435\u0440\u043d\u043e\u0432\u0438\u043a"}
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

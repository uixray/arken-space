import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import type {
  ChatAttachmentMetadata,
  ChatStream,
  GameSnapshot,
  MessageVisibility,
} from "@arken/contracts";
import { arkenSystem } from "@arken/system";
import { Button } from "@gravity-ui/uikit";
import { FormInput, FormSelect, FormTextArea } from "../ui/GravityFormControls";
import {
  getSlashCommandSuggestions,
  parseComposerInput,
} from "../chat-composer";
import { buildChatTimeline } from "../chat-date";
import { formatDiceBreakdown, normalizeClientDiceResult } from "../dice-result";
import { getDiceCritical } from "../dice-critical";
import { parseSkillCard, SkillChatCard } from "../SkillCards";
import { StickerPicker } from "../StickerPicker";
import { StoryPost } from "../StoryChannel";
import {
  buildActivityFeed,
  buildActivityTimeline,
  type ActivityStoryPost,
} from "../activity-feed";
import { PlayerRequestChatCard } from "../player-request-chat";
import {
  CHAT_STREAM_LABEL,
  messagesForStream,
  threadForStream,
} from "../chat-state";
import {
  directChatContacts,
  directThreadForPeer,
  directThreadLabel,
  directThreads,
  directUnreadCount,
  messagesForDirectThread,
  persistDirectSelection,
  restoreDirectSelection,
} from "../direct-chat-state";
import {
  charactersAvailableForActivityRolls,
  filterActivityEvents,
  formulaBonus,
  physicalDiceStorageKey,
  physicalRollBonus,
  physicalRollChatRequest,
  type ActivityFilter,
} from "../activity-roll-controls";
import type { Props } from "../Sidebar";

export function ChatMessageBody({
  message,
  catalogEntryIds,
  playerRequests,
  onOpenPlayerRequests,
}: {
  message: GameSnapshot["messages"][number];
  catalogEntryIds?: ReadonlySet<string>;
  playerRequests?: GameSnapshot["playerRequests"];
  onOpenPlayerRequests?: () => void;
}) {
  if (message.playerRequestId)
    return (
      <PlayerRequestChatCard
        message={message}
        requests={playerRequests ?? []}
        onOpen={onOpenPlayerRequests ?? (() => {})}
      />
    );
  if (message.stickerId || message.stickerPresentation) {
    const presentation = message.stickerPresentation;
    if (!message.stickerId || !presentation)
      return (
        <p className="chat-sticker-tombstone">{"Стикер больше недоступен"}</p>
      );
    return (
      <figure className="chat-sticker">
        <img
          src={`/api/stickers/${message.stickerId}/content`}
          alt={presentation.altText}
          width={presentation.width}
          height={presentation.height}
          loading="lazy"
        />
        <figcaption>{presentation.name}</figcaption>
      </figure>
    );
  }
  const skillCard = parseSkillCard(
    message.skillCard ? { skillCard: message.skillCard } : message.dice,
  );
  const dice = normalizeClientDiceResult(message.dice);
  const critical = dice ? getDiceCritical(dice) : null;
  if (message.kind === "DICE" && skillCard)
    return (
      <SkillChatCard
        card={skillCard}
        critical={critical}
        sourceRemoved={
          skillCard.entry.sourceRemoved ||
          Boolean(
            skillCard.entry.sourceCatalogEntryId &&
            catalogEntryIds &&
            !catalogEntryIds.has(skillCard.entry.sourceCatalogEntryId),
          )
        }
      />
    );
  if (message.kind !== "DICE" || !dice) {
    const physicalBonus = physicalRollBonus(message.body);
    return (
      <>
        {physicalBonus && (
          <strong className="physical-roll-bonus">
            Бонус к кубу {physicalBonus}
          </strong>
        )}
        <p>{message.body}</p>
        {message.attachments?.map((attachment) => (
          <figure className="chat-attachment" key={attachment.contentId}>
            <img
              src={`/api/chat/attachments/${attachment.contentId}/content`}
              alt={`Вложение ${attachment.fileName}`}
              loading="lazy"
            />
            <figcaption>{attachment.fileName}</figcaption>
          </figure>
        ))}
      </>
    );
  }
  return (
    <div
      className={`roll-result${critical ? ` roll-result--critical-${critical.kind}` : ""}`}
    >
      <strong className="roll-total" aria-label="Итог броска">
        {dice.total}
      </strong>
      <div className="roll-details">
        <div>{message.body}</div>
        {critical && (
          <span className="roll-critical-label">{critical.label}</span>
        )}
        <small>{formatDiceBreakdown(dice)}</small>
      </div>
    </div>
  );
}

export function ActivityPanel({
  snapshot,
  storyPosts,
  onChat,
  onSticker,
  onRoll,
  focusedMessageId,
  onMessageFocused,
  onOpenPlayerRequestCreate,
}: {
  snapshot: GameSnapshot;
  storyPosts: readonly ActivityStoryPost[];
  onChat: Props["onChat"];
  onSticker: Props["onSticker"];
  onRoll: Props["onRoll"];
  focusedMessageId: string | null;
  onMessageFocused: () => void;
  onOpenPlayerRequestCreate: () => void;
}) {
  const [composer, setComposer] = useState("");
  const [visibility, setVisibility] = useState<MessageVisibility>("PUBLIC");
  const [composerError, setComposerError] = useState("");
  const [slashHelpOpen, setSlashHelpOpen] = useState(false);
  const availableRollCharacters = useMemo(
    () => charactersAvailableForActivityRolls(snapshot),
    [snapshot],
  );
  const [rollCharacterId, setRollCharacterId] = useState(
    () => availableRollCharacters[0]?.id ?? "",
  );
  const rollCharacter =
    availableRollCharacters.find(
      (character) => character.id === rollCharacterId,
    ) ?? availableRollCharacters[0];
  const [physicalDice, setPhysicalDice] = useState(
    () =>
      window.localStorage.getItem(physicalDiceStorageKey(snapshot.me.id)) ===
      "true",
  );
  const [activityFilters, setActivityFilters] = useState<Set<ActivityFilter>>(
    () => new Set(["ROLLS", "STORY", "REFERENCE"]),
  );
  const [quickRollPending, setQuickRollPending] = useState(false);
  const characterStats =
    snapshot.characters.find(
      (character) => character.id === snapshot.me.characterId,
    )?.stats ?? {};
  const slashSuggestions = slashHelpOpen
    ? getSlashCommandSuggestions("/", characterStats)
    : getSlashCommandSuggestions(composer, characterStats);
  const executeActivitySuggestion = (insertion: string) => {
    const intent = parseComposerInput(insertion, characterStats);
    setSlashHelpOpen(false);
    if (intent.kind !== "ROLL") {
      setComposer(insertion);
      return;
    }
    setComposer("");
    setComposerError("");
    void onRoll(
      intent.formula,
      intent.label,
      visibility,
      snapshot.me.characterId,
      "NORMAL",
    ).catch(() =>
      setComposerError("Не удалось выполнить бросок. Повторите попытку."),
    );
  };
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const intent = parseComposerInput(composer, characterStats);
    if (intent.kind === "INVALID") {
      setComposerError(intent.message);
      return;
    }
    setComposerError("");
    try {
      if (intent.kind === "ROLL")
        await onRoll(
          intent.formula,
          intent.label,
          visibility,
          snapshot.me.characterId,
          "NORMAL",
        );
      else await onChat(intent.body, visibility, "TABLE");
      setComposer("");
    } catch {
      setComposerError(
        intent.kind === "ROLL"
          ? "Не удалось выполнить бросок. Проверьте характеристику и повторите попытку."
          : "Не удалось отправить сообщение. Проверьте соединение и повторите попытку.",
      );
    }
  };
  const activityEvents = useMemo(
    () =>
      filterActivityEvents(
        buildActivityFeed(snapshot.messages, snapshot.chatThreads, storyPosts),
        activityFilters,
      ),
    [activityFilters, snapshot.messages, snapshot.chatThreads, storyPosts],
  );
  const submitQuickRoll = async (
    formula: string,
    label: string,
    bonus: number,
  ) => {
    if (!rollCharacter) return;
    setQuickRollPending(true);
    setComposerError("");
    try {
      if (physicalDice) {
        const request = physicalRollChatRequest(label, bonus, rollCharacter.id);
        await onChat(request.body, visibility, "TABLE", request.characterId);
      } else {
        await onRoll(formula, label, visibility, rollCharacter.id, "NORMAL");
      }
    } catch {
      setComposerError("Не удалось выполнить бросок. Повторите попытку.");
    } finally {
      setQuickRollPending(false);
    }
  };
  const timeline = useMemo(
    () => buildActivityTimeline(activityEvents),
    [activityEvents],
  );
  const catalogEntryIds = useMemo(
    () => new Set(snapshot.catalogEntries.map((entry) => entry.id)),
    [snapshot.catalogEntries],
  );
  const listRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!focusedMessageId) return;
    const message = document.getElementById(`chat-message-${focusedMessageId}`);
    if (!message) return;
    const list = listRef.current;
    if (list)
      list.scrollTo({
        top:
          message.offsetTop - list.clientHeight / 2 + message.clientHeight / 2,
      });
    message.focus({ preventScroll: true });
    onMessageFocused();
  }, [focusedMessageId, onMessageFocused, timeline]);
  return (
    <section
      className="chat-panel activity-feed"
      role="tabpanel"
      id="chat-panel-activity"
      aria-labelledby="chat-tab-activity"
    >
      <section className="activity-roll-controls" aria-label="Быстрые броски">
        <div className="activity-roll-controls__heading">
          <strong>Быстрые броски</strong>
          {snapshot.me.role === "GM" && availableRollCharacters.length > 0 && (
            <FormSelect
              aria-label="Персонаж для броска"
              value={rollCharacter?.id ?? ""}
              onChange={(event) => setRollCharacterId(event.target.value)}
            >
              {availableRollCharacters.map((character) => (
                <option key={character.id} value={character.id}>
                  {character.name}
                </option>
              ))}
            </FormSelect>
          )}
          <label className="compact-check">
            <FormInput
              type="checkbox"
              checked={physicalDice}
              onChange={(event) => {
                const enabled = event.target.checked;
                setPhysicalDice(enabled);
                window.localStorage.setItem(
                  physicalDiceStorageKey(snapshot.me.id),
                  String(enabled),
                );
              }}
            />
            Физические кубы
          </label>
        </div>
        {rollCharacter ? (
          <div className="activity-quick-rolls">
            <Button
              disabled={quickRollPending}
              onClick={() =>
                void submitQuickRoll(
                  "1d20 + agility",
                  "Инициатива",
                  rollCharacter.stats.agility ?? 0,
                )
              }
            >
              Инициатива
            </Button>
            {arkenSystem.stats.map((stat) => (
              <Button
                key={stat.key}
                disabled={quickRollPending}
                onClick={() =>
                  void submitQuickRoll(
                    `1d20 + ${stat.key}`,
                    stat.label,
                    rollCharacter.stats[stat.key] ?? stat.defaultValue,
                  )
                }
              >
                {stat.label}
              </Button>
            ))}
            {rollCharacter.skills.map((skill) => (
              <Button
                key={skill.key}
                disabled={quickRollPending}
                onClick={() =>
                  void submitQuickRoll(
                    skill.formula,
                    skill.name,
                    formulaBonus(skill.formula, rollCharacter.stats),
                  )
                }
              >
                {skill.name}
              </Button>
            ))}
          </div>
        ) : (
          <p className="muted">Нет доступного персонажа для броска.</p>
        )}
        <fieldset className="activity-filters">
          <legend>Показывать</legend>
          {(["ROLLS", "STORY", "REFERENCE"] as const).map((filter) => (
            <label className="compact-check" key={filter}>
              <FormInput
                type="checkbox"
                checked={activityFilters.has(filter)}
                onChange={(event) =>
                  setActivityFilters((current) => {
                    const next = new Set(current);
                    if (event.target.checked) next.add(filter);
                    else next.delete(filter);
                    return next;
                  })
                }
              />
              {filter === "ROLLS"
                ? "Броски"
                : filter === "STORY"
                  ? "Сюжет"
                  : "Справочные события"}
            </label>
          ))}
        </fieldset>
      </section>
      <div className="message-list" aria-live="polite" ref={listRef}>
        {timeline.length === 0 && (
          <p className="chat-empty">
            {
              "В ленте событий пока нет сообщений, сюжетных публикаций или бросков."
            }
          </p>
        )}
        {timeline.map((item) => {
          if (item.type === "DATE")
            return (
              <div
                className="chat-date-divider"
                key={`activity-date-${item.key}`}
              >
                <span>{item.label}</span>
              </div>
            );
          if (item.event.type === "STORY_POST")
            return (
              <StoryPost
                key={`activity-story-${item.event.id}`}
                post={item.event.post}
                isGm={false}
              />
            );
          const { message, stream, id, occurredAt } = item.event;
          return (
            <article
              key={`activity-message-${id}`}
              id={`chat-message-${id}`}
              className={`message ${message.kind.toLowerCase()}`}
              data-activity-stream={stream}
              tabIndex={-1}
            >
              <header>
                <strong>{message.displayName}</strong>
                <span className="activity-stream-label">
                  {CHAT_STREAM_LABEL[stream]}
                </span>
                {message.characterId && (
                  <span className="message-character">
                    {snapshot.characters.find(
                      (character) => character.id === message.characterId,
                    )?.name ?? "Персонаж"}
                  </span>
                )}
                <time>
                  {new Date(occurredAt).toLocaleTimeString([], {
                    hour: "2-digit",
                    minute: "2-digit",
                  })}
                </time>
                {message.visibility === "GM_ONLY" && <span>{"мастеру"}</span>}
              </header>
              <ChatMessageBody
                message={message}
                catalogEntryIds={
                  snapshot.me.role === "GM" ? catalogEntryIds : undefined
                }
                playerRequests={snapshot.playerRequests}
                onOpenPlayerRequests={onOpenPlayerRequestCreate}
              />
            </article>
          );
        })}
      </div>
      <form className="chat-compose" onSubmit={submit}>
        <div className="chat-composer-input">
          <FormTextArea
            aria-label="Сообщение или бросок"
            aria-expanded={slashSuggestions.length > 0}
            aria-controls={
              slashSuggestions.length > 0
                ? "activity-slash-suggestions"
                : undefined
            }
            placeholder={"Сообщение? Введите / для быстрых команд"}
            value={composer}
            onChange={(event) => {
              setSlashHelpOpen(false);
              setComposer(event.target.value);
            }}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey) {
                event.preventDefault();
                event.currentTarget.form?.requestSubmit();
              }
            }}
            rows={3}
          />
          <div className="chat-composer-actions">
            {!composer.trim() && (
              <StickerPicker
                iconOnly
                onSelect={(stickerId) =>
                  onSticker({ stream: "TABLE" }, stickerId)
                }
              />
            )}
            <Button
              className="composer-icon composer-slash-action"
              type="button"
              view="flat"
              aria-label="Быстрые команды"
              title="Быстрые команды"
              aria-expanded={slashSuggestions.length > 0}
              onClick={() => setSlashHelpOpen((open) => !open)}
            >
              <span aria-hidden="true">/</span>
            </Button>
          </div>
          {slashSuggestions.length > 0 && (
            <div
              className="slash-command-suggestions"
              id="activity-slash-suggestions"
              role="listbox"
              aria-label="Команды чата"
            >
              {slashSuggestions.map((suggestion) => (
                <button
                  key={suggestion.command}
                  type="button"
                  role="option"
                  aria-selected="false"
                  onClick={() =>
                    executeActivitySuggestion(suggestion.insertion)
                  }
                >
                  <strong>{suggestion.command}</strong>
                  <span>{suggestion.description}</span>
                  <code>{suggestion.example}</code>
                </button>
              ))}
            </div>
          )}
        </div>
        <div className="chat-compose-submit">
          <Button className="primary" type="submit">
            {"Отправить"}
          </Button>
          {snapshot.me.role === "PLAYER" && (
            <Button
              type="button"
              view="flat"
              onClick={onOpenPlayerRequestCreate}
            >
              Заявка
            </Button>
          )}
          <label className="compact-check chat-visibility-check">
            <FormInput
              type="checkbox"
              checked={visibility === "GM_ONLY"}
              onChange={(event) =>
                setVisibility(event.target.checked ? "GM_ONLY" : "PUBLIC")
              }
            />
            <span>{"Только мастер"}</span>
          </label>
        </div>
      </form>
      {composerError && (
        <p className="composer-error" role="alert">
          {composerError}
        </p>
      )}
    </section>
  );
}

export function DirectChatPanel({
  snapshot,
  activeThreadId,
  onActiveThreadChange,
  onCreateThread,
  onDirectChat,
  onSticker,
  onUploadAttachment,
  onMarkChatRead,
}: {
  snapshot: GameSnapshot;
  activeThreadId: string | null;
  onActiveThreadChange: (threadId: string | null) => void;
  onCreateThread: Props["onCreateDirectThread"];
  onDirectChat: Props["onDirectChat"];
  onSticker: Props["onSticker"];
  onUploadAttachment: Props["onUploadChatAttachment"];
  onMarkChatRead: Props["onMarkChatRead"];
}) {
  const threads = directThreads(snapshot);
  const contacts = directChatContacts(snapshot);
  const activeThread =
    threads.find((thread) => thread.id === activeThreadId) ?? null;
  const [selectedPeerId, setSelectedPeerId] = useState(
    () =>
      restoreDirectSelection(window.localStorage, snapshot)?.peerMembershipId ??
      "",
  );
  const [selectingPeer, setSelectingPeer] = useState(false);
  const [composer, setComposer] = useState("");
  const [attachment, setAttachment] = useState<ChatAttachmentMetadata | null>(
    null,
  );
  const [attachmentPreviewUrl, setAttachmentPreviewUrl] = useState("");
  const attachmentPreviewUrlRef = useRef("");
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState("");
  const messages = activeThread
    ? messagesForDirectThread(snapshot, activeThread.id)
    : [];
  const latestSequence = messages.at(-1)?.sequence;

  useEffect(() => {
    attachmentPreviewUrlRef.current = attachmentPreviewUrl;
  }, [attachmentPreviewUrl]);
  useEffect(
    () => () => {
      if (attachmentPreviewUrlRef.current)
        URL.revokeObjectURL(attachmentPreviewUrlRef.current);
    },
    [],
  );

  useEffect(() => {
    const restored = restoreDirectSelection(window.localStorage, snapshot);
    if (!restored) {
      setSelectedPeerId("");
      if (activeThreadId) onActiveThreadChange(null);
      return;
    }
    setSelectedPeerId(restored.peerMembershipId);
    if (activeThreadId !== restored.threadId)
      onActiveThreadChange(restored.threadId);
  }, [activeThreadId, onActiveThreadChange, snapshot]);

  useEffect(() => {
    if (!selectedPeerId) return;
    const thread = directThreadForPeer(snapshot, selectedPeerId);
    if (thread && activeThreadId !== thread.id) {
      onActiveThreadChange(thread.id);
      persistDirectSelection(window.localStorage, snapshot, {
        peerMembershipId: selectedPeerId,
        threadId: thread.id,
      });
    }
  }, [activeThreadId, onActiveThreadChange, selectedPeerId, snapshot]);

  useEffect(() => {
    if (!activeThread || latestSequence === undefined) return;
    const timer = window.setTimeout(
      () => void onMarkChatRead(activeThread.id, latestSequence),
      350,
    );
    return () => window.clearTimeout(timer);
  }, [activeThread, latestSequence, onMarkChatRead]);

  async function selectPeer(peerMembershipId: string) {
    setSelectedPeerId(peerMembershipId);
    setError("");
    if (!peerMembershipId) {
      onActiveThreadChange(null);
      persistDirectSelection(window.localStorage, snapshot, null);
      return;
    }
    const existing = directThreadForPeer(snapshot, peerMembershipId);
    if (existing) {
      onActiveThreadChange(existing.id);
      persistDirectSelection(window.localStorage, snapshot, {
        peerMembershipId,
        threadId: existing.id,
      });
      return;
    }
    setSelectingPeer(true);
    try {
      const thread = await onCreateThread(peerMembershipId);
      onActiveThreadChange(thread.id);
      persistDirectSelection(window.localStorage, snapshot, {
        peerMembershipId,
        threadId: thread.id,
      });
    } catch {
      setSelectedPeerId("");
      onActiveThreadChange(null);
      persistDirectSelection(window.localStorage, snapshot, null);
      setError("Не удалось открыть личный диалог.");
    } finally {
      setSelectingPeer(false);
    }
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    const body = composer.trim();
    if (!activeThread || (!body && !attachment)) return;
    setError("");
    try {
      await onDirectChat(
        activeThread.id,
        body || "Изображение",
        attachment ? [attachment.contentId] : [],
      );
      setComposer("");
      setAttachment(null);
      if (attachmentPreviewUrl) URL.revokeObjectURL(attachmentPreviewUrl);
      setAttachmentPreviewUrl("");
    } catch {
      setError("Не удалось отправить личное сообщение.");
    }
  }

  return (
    <section
      className="chat-panel direct-chat-panel"
      role="tabpanel"
      id="chat-panel-direct"
      aria-labelledby="chat-tab-direct"
    >
      <div className="direct-thread-toolbar">
        <select
          className="direct-peer-select"
          aria-label="Собеседник"
          value={selectedPeerId}
          disabled={selectingPeer || contacts.length === 0}
          onChange={(event) => void selectPeer(event.target.value)}
        >
          <option value="">Выберите собеседника</option>
          {contacts.map((contact) => {
            const thread = directThreadForPeer(snapshot, contact.membershipId);
            const unread = thread ? directUnreadCount(snapshot, thread.id) : 0;
            return (
              <option key={contact.membershipId} value={contact.membershipId}>
                {contact.displayName}
                {unread ? ` ? ${unread}` : ""}
              </option>
            );
          })}
        </select>
      </div>
      <div className="message-list" aria-live="polite">
        {!activeThread && (
          <p className="chat-empty">
            Выберите получателя, чтобы начать личный диалог.
          </p>
        )}
        {activeThread && messages.length === 0 && (
          <p className="chat-empty">
            В диалоге с {directThreadLabel(activeThread, snapshot.me.id)} пока
            нет сообщений.
          </p>
        )}
        {buildChatTimeline(messages).map((item) =>
          item.type === "DATE" ? (
            <div className="chat-date-divider" key={`direct-date-${item.key}`}>
              <span>{item.label}</span>
            </div>
          ) : (
            <article
              key={item.message.id}
              className="message text"
              data-thread-id={activeThread?.id}
            >
              <header>
                <strong>{item.message.displayName}</strong>
                <time>
                  {new Date(item.message.createdAt).toLocaleTimeString([], {
                    hour: "2-digit",
                    minute: "2-digit",
                  })}
                </time>
              </header>
              <ChatMessageBody message={item.message} />
            </article>
          ),
        )}
      </div>
      {activeThread && (
        <form className="chat-compose direct-compose" onSubmit={submit}>
          <div className="chat-composer-input">
            <FormTextArea
              aria-label={`Личное сообщение: ${directThreadLabel(activeThread, snapshot.me.id)}`}
              placeholder={`Сообщение для ${directThreadLabel(activeThread, snapshot.me.id)}…`}
              value={composer}
              onChange={(event) => setComposer(event.target.value)}
              rows={3}
            />
            {attachment && (
              <div className="direct-attachment-preview">
                <img
                  src={attachmentPreviewUrl}
                  alt={`Вложение ${attachment.fileName}`}
                />
                <span>{attachment.fileName}</span>
                <Button
                  view="flat"
                  type="button"
                  onClick={() => {
                    setAttachment(null);
                    if (attachmentPreviewUrl)
                      URL.revokeObjectURL(attachmentPreviewUrl);
                    setAttachmentPreviewUrl("");
                  }}
                >
                  Убрать
                </Button>
              </div>
            )}
          </div>
          <StickerPicker
            disabled={uploading}
            onSelect={(stickerId) =>
              onSticker({ threadId: activeThread.id }, stickerId)
            }
          />
          <label className="direct-attach-button">
            <span>{uploading ? "Загрузка…" : "Изображение"}</span>
            <input
              type="file"
              accept="image/*"
              disabled={uploading}
              onChange={async (event) => {
                const file = event.target.files?.[0];
                event.currentTarget.value = "";
                if (!file) return;
                setUploading(true);
                setError("");
                try {
                  const previewUrl = URL.createObjectURL(file);
                  try {
                    setAttachment(await onUploadAttachment(file));
                    if (attachmentPreviewUrl)
                      URL.revokeObjectURL(attachmentPreviewUrl);
                    setAttachmentPreviewUrl(previewUrl);
                  } catch (error) {
                    URL.revokeObjectURL(previewUrl);
                    throw error;
                  }
                } catch {
                  setError("Не удалось загрузить изображение.");
                } finally {
                  setUploading(false);
                }
              }}
            />
          </label>
          <Button
            className="primary"
            type="submit"
            disabled={uploading || (!composer.trim() && !attachment)}
          >
            Отправить
          </Button>
        </form>
      )}
      {error && (
        <p className="composer-error" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}

export function ChatPanel({
  snapshot,
  onChat,
  onSticker,
  onRoll,
  onMarkChatRead,
  activeStream,
  focusedMessageId,
  onMessageFocused,
  onOpenPlayerRequests,
}: {
  snapshot: GameSnapshot;
  onChat: Props["onChat"];
  onSticker: Props["onSticker"];
  onRoll: Props["onRoll"];
  onMarkChatRead: Props["onMarkChatRead"];
  activeStream: ChatStream;
  focusedMessageId: string | null;
  onMessageFocused: () => void;
  onOpenPlayerRequests: () => void;
}) {
  const [composer, setComposer] = useState("");
  const [visibility, setVisibility] = useState<MessageVisibility>("PUBLIC");
  const [composerError, setComposerError] = useState("");
  const [slashHelpOpen, setSlashHelpOpen] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);
  const followRef = useRef(true);
  const [atBottom, setAtBottom] = useState(true);
  const [newMessageCount, setNewMessageCount] = useState(0);
  const messages = useMemo(
    () =>
      messagesForStream(snapshot.messages, activeStream, snapshot.chatThreads),
    [snapshot.messages, snapshot.chatThreads, activeStream],
  );
  const timeline = buildChatTimeline(messages);
  const catalogEntryIds = useMemo(
    () => new Set(snapshot.catalogEntries.map((entry) => entry.id)),
    [snapshot.catalogEntries],
  );
  const latestMessage = messages.at(-1);
  const thread = threadForStream(snapshot, activeStream);
  const threadId = thread?.id;
  const latestMessageId = latestMessage?.id;
  const latestSequence = latestMessage?.sequence;
  const canCompose =
    activeStream === "TABLE" ||
    (activeStream === "STORY" && snapshot.me.role === "GM");
  const slashSuggestions =
    activeStream === "TABLE"
      ? slashHelpOpen
        ? getSlashCommandSuggestions("/")
        : getSlashCommandSuggestions(composer)
      : [];
  const executeChatSuggestion = (insertion: string) => {
    const intent = parseComposerInput(insertion);
    setSlashHelpOpen(false);
    if (intent.kind !== "ROLL") {
      setComposer(insertion);
      return;
    }
    setComposer("");
    setComposerError("");
    void onRoll(
      intent.formula,
      intent.label,
      visibility,
      snapshot.me.characterId,
      "NORMAL",
    ).catch(() =>
      setComposerError("Не удалось выполнить бросок. Повторите попытку."),
    );
  };

  useEffect(() => {
    followRef.current = true;
    setAtBottom(true);
    setNewMessageCount(0);
    requestAnimationFrame(() => {
      const list = listRef.current;
      if (list) list.scrollTo({ top: list.scrollHeight });
    });
  }, [activeStream]);

  useEffect(() => {
    const list = listRef.current;
    if (!list || !latestMessage) return;
    if (followRef.current) {
      list.scrollTo({ top: list.scrollHeight });
      setNewMessageCount(0);
    } else {
      setNewMessageCount((current) => current + 1);
    }
  }, [latestMessageId, latestMessage]);

  useEffect(() => {
    if (!threadId || latestSequence === undefined || !atBottom) return;
    const timer = window.setTimeout(() => {
      void onMarkChatRead(threadId, latestSequence);
    }, 350);
    return () => window.clearTimeout(timer);
  }, [threadId, latestSequence, atBottom, onMarkChatRead]);

  useEffect(() => {
    if (!focusedMessageId) return;
    const message = document.getElementById(`chat-message-${focusedMessageId}`);
    if (!message) return;
    const list = listRef.current;
    if (list)
      list.scrollTo({
        top:
          message.offsetTop - list.clientHeight / 2 + message.clientHeight / 2,
      });
    message.focus({ preventScroll: true });
    onMessageFocused();
  }, [focusedMessageId, onMessageFocused, activeStream]);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!canCompose) return;
    const intent = parseComposerInput(composer);
    if (intent.kind === "INVALID") {
      setComposerError(intent.message);
      return;
    }
    setComposerError("");
    if (intent.kind === "ROLL" && activeStream === "TABLE")
      await onRoll(
        intent.formula,
        undefined,
        visibility,
        snapshot.me.characterId,
        "NORMAL",
      );
    else if (intent.kind === "TEXT")
      await onChat(intent.body, visibility, activeStream);
    setComposer("");
  };

  return (
    <section
      className="chat-panel"
      role="tabpanel"
      id={`chat-panel-${activeStream.toLowerCase()}`}
      aria-labelledby={`chat-tab-${activeStream.toLowerCase()}`}
    >
      <div
        className="message-list"
        aria-live="polite"
        ref={listRef}
        onScroll={(event) => {
          const list = event.currentTarget;
          const nextAtBottom =
            list.scrollHeight - list.scrollTop - list.clientHeight < 48;
          followRef.current = nextAtBottom;
          setAtBottom(nextAtBottom);
          if (nextAtBottom) setNewMessageCount(0);
        }}
      >
        {timeline.length === 0 && (
          <p className="chat-empty">В этом потоке пока нет сообщений.</p>
        )}
        {timeline.map((item) =>
          item.type === "DATE" ? (
            <div className="chat-date-divider" key={`date-${item.key}`}>
              <span>{item.label}</span>
            </div>
          ) : (
            <article
              key={item.message.id}
              id={`chat-message-${item.message.id}`}
              className={`message ${item.message.kind.toLowerCase()}`}
              tabIndex={-1}
            >
              <header>
                <strong>{item.message.displayName}</strong>
                {item.message.characterId && (
                  <span className="message-character">
                    {snapshot.characters.find(
                      (character) => character.id === item.message.characterId,
                    )?.name ?? "Персонаж"}
                  </span>
                )}
                <time>
                  {new Date(item.message.createdAt).toLocaleTimeString([], {
                    hour: "2-digit",
                    minute: "2-digit",
                  })}
                </time>
                {item.message.visibility === "GM_ONLY" && <span>мастеру</span>}
              </header>
              <ChatMessageBody
                message={item.message}
                catalogEntryIds={
                  snapshot.me.role === "GM" ? catalogEntryIds : undefined
                }
                playerRequests={snapshot.playerRequests}
                onOpenPlayerRequests={onOpenPlayerRequests}
              />
            </article>
          ),
        )}
      </div>
      {newMessageCount > 0 && (
        <Button
          className="new-messages"
          onClick={() => {
            const list = listRef.current;
            if (list)
              list.scrollTo({ top: list.scrollHeight, behavior: "smooth" });
            followRef.current = true;
            setAtBottom(true);
            setNewMessageCount(0);
          }}
        >
          Новые сообщения · {newMessageCount}
        </Button>
      )}
      {activeStream === "ROLLS" && (
        <p className="chat-stream-note">
          {"Броски появляются здесь автоматически."}
        </p>
      )}
      {activeStream === "STORY" && snapshot.me.role !== "GM" && (
        <p className="chat-stream-note">{"Сюжетный поток ведёт мастер."}</p>
      )}
      {canCompose && (
        <>
          <form className="chat-compose" onSubmit={submit}>
            <div className="chat-composer-input">
              <FormTextArea
                aria-label={
                  activeStream === "STORY"
                    ? "Сообщение сюжета"
                    : "Сообщение или бросок"
                }
                aria-expanded={slashSuggestions.length > 0}
                aria-controls={
                  slashSuggestions.length > 0
                    ? "chat-slash-suggestions"
                    : undefined
                }
                placeholder={
                  activeStream === "STORY"
                    ? "Продолжить историю…"
                    : "Сообщение … или /roll 1d20 + agility"
                }
                value={composer}
                onChange={(event) => {
                  setSlashHelpOpen(false);
                  setComposer(event.target.value);
                }}
                onKeyDown={(event) => {
                  if (event.key === "Enter" && !event.shiftKey) {
                    event.preventDefault();
                    event.currentTarget.form?.requestSubmit();
                  }
                }}
                rows={3}
              />
              <div className="chat-composer-actions">
                {!composer.trim() && (
                  <StickerPicker
                    iconOnly
                    onSelect={(stickerId) =>
                      onSticker(
                        { stream: activeStream as "TABLE" | "STORY" },
                        stickerId,
                      )
                    }
                  />
                )}
                <Button
                  className="composer-icon composer-slash-action"
                  type="button"
                  view="flat"
                  aria-label="Быстрые команды"
                  title="Быстрые команды"
                  aria-expanded={slashSuggestions.length > 0}
                  onClick={() => setSlashHelpOpen((open) => !open)}
                >
                  <span aria-hidden="true">/</span>
                </Button>
              </div>
              {slashSuggestions.length > 0 && (
                <div
                  className="slash-command-suggestions"
                  id="chat-slash-suggestions"
                  role="listbox"
                  aria-label={"Команды чата"}
                >
                  {slashSuggestions.map((suggestion) => (
                    <button
                      key={suggestion.command}
                      type="button"
                      role="option"
                      aria-selected="false"
                      onClick={() =>
                        executeChatSuggestion(suggestion.insertion)
                      }
                    >
                      <strong>{suggestion.command}</strong>
                      <span>{suggestion.description}</span>
                      <code>{suggestion.example}</code>
                    </button>
                  ))}
                </div>
              )}
            </div>
            <div className="chat-compose-submit">
              <Button className="primary" type="submit">
                {"Отправить"}
              </Button>
              <label className="compact-check chat-visibility-check">
                <FormInput
                  type="checkbox"
                  checked={visibility === "GM_ONLY"}
                  onChange={(event) =>
                    setVisibility(event.target.checked ? "GM_ONLY" : "PUBLIC")
                  }
                />
                <span>{"Только мастер"}</span>
              </label>
            </div>
          </form>
          {composerError && (
            <p className="composer-error" role="alert">
              {composerError}
            </p>
          )}
        </>
      )}
    </section>
  );
}

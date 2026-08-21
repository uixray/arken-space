import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type ClipboardEvent,
  type FormEvent,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
} from "react";
import type {
  ChatAttachmentMetadata,
  ChatStream,
  GameSnapshot,
  InitiativeParticipantDto,
  MessageVisibility,
} from "@arken/contracts";
import { Button } from "@gravity-ui/uikit";
import { FormInput, FormSelect, FormTextArea } from "../ui/GravityFormControls";
import {
  extractPastedImageFile,
  getSlashCommandSuggestions,
  parseComposerInput,
} from "../chat-composer";
import {
  rollableStatRows,
  statLabelsFromLayout,
  statResourceRowsFromLayout,
  statRowsFromLayout,
} from "../stat-keys";
import { InitiativePanel } from "./InitiativePanel";
import { useDismissibleDetails } from "../ui/dismissible-details";
import {
  ACTIVITY_FILTERS,
  ACTIVITY_FILTER_LABEL,
  activityFilterSummaryTitle,
  hiddenActivityStreamCount,
} from "../activity-filter-menu";
import type { RollMode } from "../roll-mode";
import { RollAvatar } from "./RollAvatar";
import { createRollAvatarSource } from "../roll-avatar-source";
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
import { messagesForStream, threadForStream } from "../chat-state";
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
  physicalDiceStorageKey,
  physicalRollBonus,
  physicalRollChatRequest,
  readRollLogCollapsed,
  rollLogHistoryPresentation,
  writeRollLogCollapsed,
  type ActivityFilter,
} from "../activity-roll-controls";
import type { Props } from "../Sidebar";
import type { ChatActions } from "../use-chat-actions";
import { useFollowScroll } from "../ui/useFollowScroll";
import { decideComposerKeydown } from "../composer-keyboard-intent";
import { DiceTrayPanel } from "./DiceTrayPanel";
import { ApiError } from "../api";
import { useThreadHistory } from "../use-thread-history";
import { QuickRollPanel } from "./QuickRollPanel";
import { ResourceCounters } from "./ResourceCounters";

/**
 * UIX-388: shared tooltip/label text for the composer's send icon so
 * ActivityPanel and ChatPanel stay word-for-word consistent, and a visible
 * (not hover-only) hint so a player can tell which way a message will send
 * *before* pressing Enter, not just discover it via a mouse-hover tooltip.
 */
const SEND_TOOLTIP =
  "Enter — отправить всем. Ctrl+Enter — отправить только мастеру.";
/**
 * UIX-419: подсказка больше не занимает места в композере.
 *
 * Она была видимой строкой рядом с полем ввода — намеренно, чтобы игрок узнал
 * про Ctrl+Enter до нажатия, а не наведением мыши. На узкой боковой панели это
 * обошлось дороже пользы: строка отъедала половину ширины, и вводить сообщение
 * стало неудобно всем и всегда ради подсказки, нужной один раз.
 *
 * Теперь текст остаётся в разметке для программ чтения с экрана (на него
 * ссылается `aria-describedby` у поля ввода), а глазами он читается во
 * всплывающей подсказке кнопки отправки — `SEND_TOOLTIP` выше, слово в слово.
 */
const SEND_HINT = "Enter — всем · Ctrl+Enter — только мастеру";

export function ChatMessageBody({
  message,
  catalogEntryIds,
  playerRequests,
  onOpenPlayerRequests,
  avatar,
}: {
  message: GameSnapshot["messages"][number];
  catalogEntryIds?: ReadonlySet<string>;
  playerRequests?: GameSnapshot["playerRequests"];
  onOpenPlayerRequests?: () => void;
  /** UIX-454: портрет бросающего; у не-бросков не показывается. */
  avatar?: ReactNode;
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
    /**
     * UIX-454: физический бросок рисуется тем же макетом, что обычный. Раньше
     * он выпадал сюда, в обычный текст, и в ленте это выглядело как сообщение
     * другого рода — хотя за столом это тот же бросок, просто кубик настоящий.
     * На месте итога стоит бонус: результата система не знает и не должна
     * делать вид, что знает.
     */
    if (physicalBonus)
      return (
        <div className="roll-result roll-result--physical">
          {avatar}
          <div className="roll-details">
            <div>{message.body}</div>
            <small>Бросьте кубик и прибавьте бонус</small>
          </div>
          <strong className="roll-total" aria-label="Бонус к броску">
            {physicalBonus}
          </strong>
        </div>
      );
    return (
      <>
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
      {avatar}
      <div className="roll-details">
        <div>{message.body}</div>
        {critical && (
          <span className="roll-critical-label">{critical.label}</span>
        )}
        <small>{formatDiceBreakdown(dice)}</small>
      </div>
      {/* Итог справа: глаз ищет число на краю строки, а не в середине, и в
       * ленте из десятка бросков они выстраиваются в столбец. */}
      <strong className="roll-total" aria-label="Итог броска">
        {dice.total}
      </strong>
    </div>
  );
}

export function ActivityPanel({
  snapshot,
  storyPosts,
  activityFilters,
  onActivityFiltersChange,
  onChat,
  onSticker,
  onRoll,
  focusedMessageId,
  onMessageFocused,
  onOpenPlayerRequestCreate,
  onUpdateCounters,
  selectedTokenIds,
  onUpdateInitiative,
  onSetOwnInitiative,
  onRollInitiative,
}: {
  snapshot: GameSnapshot;
  storyPosts: readonly ActivityStoryPost[];
  activityFilters: ReadonlySet<ActivityFilter>;
  onActivityFiltersChange: (filters: Set<ActivityFilter>) => void;
  onChat: ChatActions["onChat"];
  onSticker: ChatActions["onSticker"];
  onRoll: Props["onRoll"];
  focusedMessageId: string | null;
  onMessageFocused: () => void;
  onOpenPlayerRequestCreate: () => void;
  /** UIX-424, шаг 8: счётчики выносливости и маны правят те же `resources`. */
  onUpdateCounters: Props["onUpdateCounters"];
  /** UIX-431: выделенные рамкой токены — из них пополняется очередь ходов. */
  selectedTokenIds: readonly string[];
  onUpdateInitiative: (
    participants: InitiativeParticipantDto[],
    revision: number,
  ) => Promise<void>;
  onSetOwnInitiative: (
    participantId: string,
    initiative: number | null,
    revision: number,
  ) => Promise<void>;
  onRollInitiative: (
    participants: readonly InitiativeParticipantDto[],
    participant: InitiativeParticipantDto,
    revision: number,
    isGm: boolean,
  ) => Promise<void>;
}) {
  const [initiativePending, setInitiativePending] = useState(false);
  const avatarFor = useMemo(() => createRollAvatarSource(snapshot), [snapshot]);
  const [composer, setComposer] = useState("");
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
  const filtersRef = useRef<HTMLDetailsElement>(null);
  useDismissibleDetails(filtersRef);
  const [quickRollPending, setQuickRollPending] = useState(false);
  // UIX-388 follow-up: removing the composer's «Только мастеру» checkbox took
  // the only private-roll affordance with it, leaving stat and skill rolls
  // permanently public -- which quietly removes secret checks (perception,
  // deception) from play. The dice tray already had its own GM-only toggle,
  // so visibility is lifted here and shared with it: one toggle now governs
  // every roll made from the sidebar, rather than two adjacent ones.
  const [rollVisibility, setRollVisibility] =
    useState<MessageVisibility>("PUBLIC");
  // UIX-372: the roll/event log can get long and spammy with quick rolls, so
  // it can be collapsed to a compact "last N entries" view independently of
  // whole-sidebar collapse or width resize.
  const [rollLogCollapsed, setRollLogCollapsed] = useState(() =>
    readRollLogCollapsed(window.localStorage, snapshot.me.id),
  );
  const characterStats =
    snapshot.characters.find(
      (character) => character.id === snapshot.me.characterId,
    )?.stats ?? {};
  // UIX-424: подписи характеристик берутся из раскладки кампании — здесь их
  // копии больше нет.
  const statLabels = useMemo(
    () => statLabelsFromLayout(snapshot.campaign.statLayout),
    [snapshot.campaign.statLayout],
  );
  const slashSuggestions = slashHelpOpen
    ? getSlashCommandSuggestions("/", characterStats, statLabels)
    : getSlashCommandSuggestions(composer, characterStats, statLabels);
  const executeActivitySuggestion = (insertion: string) => {
    const intent = parseComposerInput(insertion, characterStats, statLabels);
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
      "PUBLIC",
      snapshot.me.characterId,
      "NORMAL",
    ).catch(() =>
      setComposerError("Не удалось выполнить бросок. Повторите попытку."),
    );
  };
  // UIX-388: a direct submit with the chosen visibility, not a mode toggle --
  // see composer-keyboard-intent.ts for why. Both the Send button (a normal
  // form submit, always public) and the Enter/Ctrl+Enter keydown handler
  // below call this with an explicit visibility rather than reading it from
  // component state.
  const submitComposer = async (visibility: MessageVisibility) => {
    const intent = parseComposerInput(composer, characterStats, statLabels);
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
  const submit = (event: FormEvent) => {
    event.preventDefault();
    void submitComposer("PUBLIC");
  };
  const onComposerKeyDown = (
    event: ReactKeyboardEvent<HTMLTextAreaElement>,
  ) => {
    const action = decideComposerKeydown({
      key: event.key,
      ctrlKey: event.ctrlKey,
      shiftKey: event.shiftKey,
      isComposing: event.nativeEvent.isComposing,
    });
    if (action === "SEND_PUBLIC") {
      event.preventDefault();
      void submitComposer("PUBLIC");
    } else if (action === "SEND_GM_ONLY") {
      event.preventDefault();
      void submitComposer("GM_ONLY");
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
  const [resourcePending, setResourcePending] = useState(false);
  /**
   * UIX-424, шаг 8. Править ресурсы может тот, кто управляет персонажем, —
   * тратит их он, а не мастер. У мастера доступ есть всегда, он ведёт NPC.
   */
  const canSpendResources = Boolean(
    rollCharacter &&
    (snapshot.me.role === "GM" ||
      rollCharacter.ownerMembershipId === snapshot.me.id ||
      rollCharacter.controllerMembershipIds.includes(snapshot.me.id)),
  );
  /**
   * UIX-468: возвращает промис, а не `void`. Счётчики показывают нажатие сразу,
   * до ответа сервера, и по этому промису узнают об отказе — только так
   * показанное число можно вернуть к серверному, а не оставить враньё на экране.
   */
  const spendResource = (key: string, next: number) => {
    if (!rollCharacter) return Promise.resolve();
    const resource = rollCharacter.resources[key] ?? { current: 0 };
    setResourcePending(true);
    setComposerError("");
    return onUpdateCounters(rollCharacter.id, rollCharacter.revision, {
      resources: {
        ...rollCharacter.resources,
        [key]: { ...resource, current: next },
      },
    })
      .catch((reason) => {
        setComposerError(
          reason instanceof ApiError && reason.code === "CHARACTER_CONFLICT"
            ? "Ресурсы уже изменены в другой сессии. Повторите действие."
            : "Не удалось изменить очки. Проверьте соединение.",
        );
        // Пробрасывается дальше: счётчики отличают отказ от успеха только так.
        throw reason;
      })
      .finally(() => setResourcePending(false));
  };
  const submitQuickRoll = async (
    formula: string,
    label: string,
    bonus: number,
    /**
     * UIX-456: до сих пор здесь стояло жёсткое `"NORMAL"` — броски инициативы
     * и ближнего боя не умели быть с преимуществом вовсе, хотя сервер это
     * считает и переключатель у костей существует.
     */
    mode: RollMode = "NORMAL",
  ) => {
    if (!rollCharacter) return;
    setQuickRollPending(true);
    setComposerError("");
    try {
      if (physicalDice) {
        const request = physicalRollChatRequest(
          label,
          bonus,
          rollCharacter.id,
          mode,
        );
        await onChat(
          request.body,
          rollVisibility,
          "TABLE",
          request.characterId,
        );
      } else {
        await onRoll(formula, label, rollVisibility, rollCharacter.id, mode);
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
  const historyPresentation = rollLogHistoryPresentation(
    timeline.length,
    rollLogCollapsed,
  );
  const visibleTimeline =
    historyPresentation.visibleEntryCount < timeline.length
      ? timeline.slice(-historyPresentation.visibleEntryCount)
      : timeline;
  const catalogEntryIds = useMemo(
    () => new Set(snapshot.catalogEntries.map((entry) => entry.id)),
    [snapshot.catalogEntries],
  );
  // The visible slice always keeps the timeline's tail (see
  // `visibleTimeline` above), so the last full-timeline event id is a
  // reliable "did new content arrive" signal whether the log is collapsed
  // or expanded.
  const latestActivityEventId = activityEvents.at(-1)?.id;
  const { listRef, newItemCount, scrollToBottom, onScroll } = useFollowScroll(
    latestActivityEventId,
  );
  // Jumping to a specific message (e.g. from a notification) must be able to
  // reveal it even if the log is currently collapsed to its compact view.
  useEffect(() => {
    if (focusedMessageId) setRollLogCollapsed(false);
  }, [focusedMessageId]);
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
  }, [focusedMessageId, onMessageFocused, timeline, listRef]);
  return (
    <section
      className="chat-panel activity-feed"
      role="tabpanel"
      id="chat-panel-activity"
      aria-labelledby="chat-tab-activity"
    >
      {snapshot.campaign.battleActive && (
        <InitiativePanel
          participants={snapshot.campaign.initiative}
          isGm={snapshot.me.role === "GM"}
          pending={initiativePending}
          selectedTokenIds={selectedTokenIds}
          onUpdate={(next) => {
            setInitiativePending(true);
            void onUpdateInitiative(next, snapshot.campaign.revision).finally(
              () => setInitiativePending(false),
            );
          }}
          onSetOwnInitiative={(participantId, value) => {
            setInitiativePending(true);
            void onSetOwnInitiative(
              participantId,
              value,
              snapshot.campaign.revision,
            ).finally(() => setInitiativePending(false));
          }}
          onRoll={(participant) => {
            setInitiativePending(true);
            void onRollInitiative(
              snapshot.campaign.initiative,
              participant,
              snapshot.campaign.revision,
              snapshot.me.role === "GM",
            ).finally(() => setInitiativePending(false));
          }}
        />
      )}
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
        <DiceTrayPanel
          characterId={snapshot.me.characterId}
          visibility={rollVisibility}
          onVisibilityChange={setRollVisibility}
          onRoll={onRoll}
        />
        {rollCharacter && (
          <ResourceCounters
            rows={statResourceRowsFromLayout(snapshot.campaign.statLayout)}
            resources={rollCharacter.resources}
            stats={rollCharacter.stats}
            editable={canSpendResources}
            pending={resourcePending}
            onSpend={spendResource}
          />
        )}
        {rollCharacter ? (
          <QuickRollPanel
            rollCharacter={rollCharacter}
            campaignId={snapshot.campaign.id}
            membershipId={snapshot.me.id}
            rows={rollableStatRows(
              statRowsFromLayout(snapshot.campaign.statLayout),
            )}
            quickRollPending={quickRollPending}
            gmOnly={rollVisibility === "GM_ONLY"}
            onQuickRoll={(formula, label, bonus, mode) =>
              void submitQuickRoll(formula, label, bonus, mode)
            }
          />
        ) : (
          <p className="muted">Нет доступного персонажа для броска.</p>
        )}
      </section>
      <div className="activity-log-toolbar">
        <span className="eyebrow">Журнал</span>
        {/* Фильтр относится к самому журналу, поэтому находится напротив его
            заголовка, а не среди быстрых бросков. */}
        <details className="activity-filters-menu" ref={filtersRef}>
          <summary
            className="activity-log-toggle activity-filters-summary"
            aria-label={activityFilterSummaryTitle(activityFilters)}
            title={activityFilterSummaryTitle(activityFilters)}
          >
            <span aria-hidden="true">⋯</span>
            <span className="activity-filters-summary__label">Показывать</span>
            {hiddenActivityStreamCount(activityFilters) > 0 && (
              <span className="activity-filters-badge" aria-hidden="true">
                {hiddenActivityStreamCount(activityFilters)}
              </span>
            )}
          </summary>
          <fieldset className="activity-filters">
            <legend className="visually-hidden">Показывать</legend>
            {ACTIVITY_FILTERS.map((filter) => (
              <label className="compact-check" key={filter}>
                <FormInput
                  type="checkbox"
                  checked={activityFilters.has(filter)}
                  onChange={(event) => {
                    const next = new Set(activityFilters);
                    if (event.target.checked) next.add(filter);
                    else next.delete(filter);
                    onActivityFiltersChange(next);
                  }}
                />
                {ACTIVITY_FILTER_LABEL[filter]}
              </label>
            ))}
          </fieldset>
        </details>
      </div>
      {historyPresentation.showControl && (
        <div className="activity-log-history-control">
          {historyPresentation.truncatedLabel && (
            <span className="activity-log-truncated-note">
              {historyPresentation.truncatedLabel}
            </span>
          )}
          <button
            type="button"
            className="activity-log-toggle"
            aria-expanded={!rollLogCollapsed}
            aria-controls="activity-message-list"
            title={
              rollLogCollapsed
                ? "Показать всю ленту событий"
                : "Показать только последние записи"
            }
            onClick={() => {
              const next = !rollLogCollapsed;
              setRollLogCollapsed(next);
              writeRollLogCollapsed(window.localStorage, snapshot.me.id, next);
            }}
          >
            {historyPresentation.actionLabel}
          </button>
        </div>
      )}
      <div
        className="message-list"
        id="activity-message-list"
        aria-live="polite"
        ref={listRef}
        onScroll={onScroll}
      >
        {timeline.length === 0 && (
          <p className="chat-empty">
            {
              "В ленте событий пока нет сообщений, сюжетных публикаций или бросков."
            }
          </p>
        )}
        {visibleTimeline.map((item) => {
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
                {/* UIX-467: убраны две плашки. «Броски» повторяла на каждом
                 * сообщении то, что и так задано фильтром ленты, а имя
                 * персонажа у чужого броска вырождалось в слово «Персонаж».
                 * Личность теперь читается по миниатюре токена слева. */}
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
                avatar={
                  <RollAvatar
                    {...avatarFor(message.characterId)}
                    fallbackName={message.displayName}
                  />
                }
              />
            </article>
          );
        })}
      </div>
      {newItemCount > 0 && (
        <Button
          className="new-messages"
          onClick={() => scrollToBottom("smooth")}
        >
          Новые события · {newItemCount}
        </Button>
      )}
      <form className="chat-compose chat-compose--single" onSubmit={submit}>
        <div className="chat-composer-input">
          <FormTextArea
            aria-label="Сообщение или бросок"
            aria-describedby="activity-composer-hint"
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
            onKeyDown={onComposerKeyDown}
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
            <Button
              className="composer-icon composer-send-action"
              type="submit"
              view="flat"
              aria-label={`Отправить. ${SEND_TOOLTIP}`}
              title={SEND_TOOLTIP}
            >
              <span aria-hidden="true">{"➤"}</span>
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
        <p
          className="composer-hint visually-hidden"
          id="activity-composer-hint"
        >
          {SEND_HINT}
        </p>
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
  onCreateThread: ChatActions["onCreateDirectThread"];
  onDirectChat: ChatActions["onDirectChat"];
  onSticker: ChatActions["onSticker"];
  onUploadAttachment: ChatActions["onUploadChatAttachment"];
  onMarkChatRead: ChatActions["onMarkChatRead"];
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
  const latestMessage = messages.at(-1);
  const latestSequence = latestMessage?.sequence;
  const { listRef, newItemCount, scrollToBottom, onScroll } = useFollowScroll(
    latestMessage?.id,
    activeThread?.id,
  );

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

  async function attachFile(file: File) {
    setUploading(true);
    setError("");
    try {
      const previewUrl = URL.createObjectURL(file);
      try {
        setAttachment(await onUploadAttachment(file));
        if (attachmentPreviewUrl) URL.revokeObjectURL(attachmentPreviewUrl);
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
  }

  function pasteImageFromClipboard(event: ClipboardEvent<HTMLTextAreaElement>) {
    const file = extractPastedImageFile(event.clipboardData);
    if (!file) return;
    event.preventDefault();
    void attachFile(file);
  }

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
      <div
        className="message-list"
        aria-live="polite"
        ref={listRef}
        onScroll={onScroll}
      >
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
      {newItemCount > 0 && (
        <Button
          className="new-messages"
          onClick={() => scrollToBottom("smooth")}
        >
          Новые сообщения · {newItemCount}
        </Button>
      )}
      {activeThread && (
        <form className="chat-compose direct-compose" onSubmit={submit}>
          <div className="chat-composer-input">
            <FormTextArea
              aria-label={`Личное сообщение: ${directThreadLabel(activeThread, snapshot.me.id)}`}
              placeholder={`Сообщение для ${directThreadLabel(activeThread, snapshot.me.id)}…`}
              value={composer}
              onChange={(event) => setComposer(event.target.value)}
              onPaste={pasteImageFromClipboard}
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
                await attachFile(file);
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
  onChat: ChatActions["onChat"];
  onSticker: ChatActions["onSticker"];
  onRoll: Props["onRoll"];
  onMarkChatRead: ChatActions["onMarkChatRead"];
  activeStream: ChatStream;
  focusedMessageId: string | null;
  onMessageFocused: () => void;
  onOpenPlayerRequests: () => void;
}) {
  const [composer, setComposer] = useState("");
  const [composerError, setComposerError] = useState("");
  const [slashHelpOpen, setSlashHelpOpen] = useState(false);
  const messages = useMemo(
    () =>
      messagesForStream(snapshot.messages, activeStream, snapshot.chatThreads),
    [snapshot.messages, snapshot.chatThreads, activeStream],
  );
  const timeline = buildChatTimeline(messages);
  const avatarFor = useMemo(() => createRollAvatarSource(snapshot), [snapshot]);
  const catalogEntryIds = useMemo(
    () => new Set(snapshot.catalogEntries.map((entry) => entry.id)),
    [snapshot.catalogEntries],
  );
  const latestMessage = messages.at(-1);
  const thread = threadForStream(snapshot, activeStream);
  const threadId = thread?.id;
  const {
    hasMore: historyHasMore,
    pending: historyPending,
    error: historyError,
    loadOlder,
  } = useThreadHistory(messages);
  const latestMessageId = latestMessage?.id;
  const latestSequence = latestMessage?.sequence;
  const { listRef, isAtBottom, newItemCount, scrollToBottom, onScroll } =
    useFollowScroll(latestMessageId, activeStream);
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
      "PUBLIC",
      snapshot.me.characterId,
      "NORMAL",
    ).catch(() =>
      setComposerError("Не удалось выполнить бросок. Повторите попытку."),
    );
  };

  useEffect(() => {
    if (!threadId || latestSequence === undefined || !isAtBottom) return;
    const timer = window.setTimeout(() => {
      void onMarkChatRead(threadId, latestSequence);
    }, 350);
    return () => window.clearTimeout(timer);
  }, [threadId, latestSequence, isAtBottom, onMarkChatRead]);

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
  }, [focusedMessageId, onMessageFocused, activeStream, listRef]);

  // UIX-388: direct submit with the chosen visibility -- see
  // composer-keyboard-intent.ts for why this isn't a persistent mode toggle.
  const submitComposer = async (visibility: MessageVisibility) => {
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
  const submit = (event: FormEvent) => {
    event.preventDefault();
    void submitComposer("PUBLIC");
  };
  const onComposerKeyDown = (
    event: ReactKeyboardEvent<HTMLTextAreaElement>,
  ) => {
    const action = decideComposerKeydown({
      key: event.key,
      ctrlKey: event.ctrlKey,
      shiftKey: event.shiftKey,
      isComposing: event.nativeEvent.isComposing,
    });
    if (action === "SEND_PUBLIC") {
      event.preventDefault();
      void submitComposer("PUBLIC");
    } else if (action === "SEND_GM_ONLY") {
      event.preventDefault();
      void submitComposer("GM_ONLY");
    }
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
        onScroll={onScroll}
      >
        {/* UIX-450: кнопка вверху списка, а не автоподгрузка по прокрутке.
         * Автоподгрузка в ленте, куда постоянно приходит новое, дёргает
         * позицию прокрутки под рукой у читающего; здесь человек сам решает,
         * когда уйти в прошлое. */}
        {threadId && historyHasMore && (
          <button
            type="button"
            className="chat-load-more"
            disabled={historyPending}
            onClick={() => void loadOlder(threadId)}
          >
            {historyPending ? "Загружаю…" : "Показать более ранние"}
          </button>
        )}
        {historyError && (
          <p className="chat-empty" role="alert">
            {historyError}
          </p>
        )}
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
                {/* UIX-454: плашка с именем персонажа убрана. У чужого броска
                 * она вырождалась в слово «Персонаж» — занимала место и не
                 * сообщала ничего, потому что чужие персонажи игроку не
                 * приходили. Теперь личность видна портретом слева от броска,
                 * а имя — в подсказке к нему. */}
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
                avatar={
                  <RollAvatar
                    {...avatarFor(item.message.characterId)}
                    fallbackName={item.message.displayName}
                  />
                }
              />
            </article>
          ),
        )}
      </div>
      {newItemCount > 0 && (
        <Button
          className="new-messages"
          onClick={() => scrollToBottom("smooth")}
        >
          Новые сообщения · {newItemCount}
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
          <form className="chat-compose chat-compose--single" onSubmit={submit}>
            <div className="chat-composer-input">
              <FormTextArea
                aria-label={
                  activeStream === "STORY"
                    ? "Сообщение сюжета"
                    : "Сообщение или бросок"
                }
                aria-describedby="chat-composer-hint"
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
                onKeyDown={onComposerKeyDown}
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
                <Button
                  className="composer-icon composer-send-action"
                  type="submit"
                  view="flat"
                  aria-label={`Отправить. ${SEND_TOOLTIP}`}
                  title={SEND_TOOLTIP}
                >
                  <span aria-hidden="true">{"➤"}</span>
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
            <p
              className="composer-hint visually-hidden"
              id="chat-composer-hint"
            >
              {SEND_HINT}
            </p>
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

import { Button } from "./design-system/Button";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { api } from "./api";
import { betaPlayerByHandle, betaPlayers } from "@arken/contracts";
import { FormInput, FormTextArea } from "./ui/GravityFormControls";
import { LandingGuide } from "./LandingGuide";
import { capabilities, changelog, roadmapSections } from "./landing-data";
import "./landing-public.css";

type FeedbackStatus = "idle" | "sending" | "sent";
type RoadmapVote = { id: string; count: number; voted: boolean };
type RoadmapVoteResponse = { items: RoadmapVote[] };
const isDevelopment = (import.meta as ImportMeta & { env: { DEV: boolean } })
  .env.DEV;
const plannedRoadmap = roadmapSections.find(
  (section) => section.status === "planned",
);

export function AuthGate({ onAuthenticated }: { onAuthenticated: () => void }) {
  const [name, setName] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const playerLoginPending = useRef(false);
  const [feedbackStatus, setFeedbackStatus] = useState<FeedbackStatus>("idle");
  const [feedbackError, setFeedbackError] = useState("");
  const [allPlansVisible, setAllPlansVisible] = useState(false);
  const [votes, setVotes] = useState<Record<string, RoadmapVote>>({});
  const [votesLoading, setVotesLoading] = useState(true);
  const [votePending, setVotePending] = useState<string | null>(null);
  const [voteError, setVoteError] = useState("");
  const parts = window.location.pathname.split("/").filter(Boolean);
  const mode = parts[0];
  const token = parts[1] ?? "";
  const betaPlayer = mode === "play" ? betaPlayerByHandle(token) : undefined;
  const hasInvitation = mode === "gm" || mode === "join" || Boolean(betaPlayer);

  useEffect(() => {
    let active = true;
    api<RoadmapVoteResponse>("/api/public/roadmap-votes")
      .then(({ items }) => {
        if (active)
          setVotes(Object.fromEntries(items.map((item) => [item.id, item])));
      })
      .catch(() => {
        if (active)
          setVoteError(
            "Не удалось загрузить голоса. Попробуйте обновить страницу.",
          );
      })
      .finally(() => {
        if (active) setVotesLoading(false);
      });
    return () => {
      active = false;
    };
  }, []);

  const toggleRoadmapVote = async (id: string) => {
    if (votePending || votesLoading) return;
    setVotePending(id);
    setVoteError("");
    try {
      const item = await api<RoadmapVote>(
        `/api/public/roadmap-votes/${encodeURIComponent(id)}`,
        { method: "POST" },
      );
      setVotes((current) => ({ ...current, [id]: item }));
    } catch {
      setVoteError("Не удалось сохранить голос. Попробуйте ещё раз.");
    } finally {
      setVotePending(null);
    }
  };

  const loginAsPlayer = async (handle: string) => {
    // State updates are asynchronous: two clicks in the same event turn can
    // otherwise dispatch duplicate login requests before `busy` rerenders.
    if (playerLoginPending.current) return;
    playerLoginPending.current = true;
    setBusy(true);
    setError("");
    try {
      await api(`/api/auth/player/${encodeURIComponent(handle)}`, {
        method: "POST",
      });
      window.history.replaceState({}, "", "/");
      onAuthenticated();
    } catch (reason) {
      setError(
        reason instanceof Error ? reason.message : "Не удалось войти в игру",
      );
    } finally {
      playerLoginPending.current = false;
      setBusy(false);
    }
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      if (mode === "gm")
        await api("/api/auth/gm", {
          method: "POST",
          body: JSON.stringify({ token }),
        });
      else if (mode === "join")
        await api("/api/auth/invite", {
          method: "POST",
          body: JSON.stringify({ token, displayName: name }),
        });
      else if (mode === "play" && betaPlayer)
        await api(`/api/auth/player/${encodeURIComponent(betaPlayer.handle)}`, {
          method: "POST",
        });
      else throw new Error("Откройте персональную ссылку мастера или игрока");
      window.history.replaceState({}, "", "/");
      onAuthenticated();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Не удалось войти");
    } finally {
      setBusy(false);
    }
  };

  const submitFeedback = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const formElement = event.currentTarget;
    setFeedbackStatus("sending");
    setFeedbackError("");
    const form = new FormData(formElement);
    try {
      await api("/api/feedback/suggestions", {
        method: "POST",
        body: JSON.stringify({
          description: form.get("message"),
          contact: form.get("contact"),
          website: form.get("website"),
        }),
      });
      formElement.reset();
      setFeedbackStatus("sent");
    } catch (reason) {
      setFeedbackStatus("idle");
      setFeedbackError(
        reason instanceof Error
          ? reason.message
          : "Не удалось отправить предложение",
      );
    }
  };

  return (
    <main className="landing-shell">
      <header className="landing-header">
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <a
            className="wordmark"
            href="/"
            aria-label="Arken Space — на главную"
          >
            arken-space
          </a>
          <span className="landing-badge">Ранний доступ</span>
        </div>
        <nav className="landing-section-nav" aria-label="Разделы страницы">
          <a href="#capabilities-title">Возможности</a>
          <a href="#guide-title">Как играть</a>
          <a href="#roadmap-title">Планы</a>
          <a href="#changelog-title">Обновления</a>
          <a href="#feedback-title">Обратная связь</a>
        </nav>
        {isDevelopment && (
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <a
              href="http://localhost:6006"
              target="_blank"
              rel="noopener noreferrer"
              title="Открыть интерактивную витрину компонентов Storybook"
              style={{
                fontSize: "0.82rem",
                fontWeight: 600,
                color: "var(--palette-clay-400, #d57d55)",
                textDecoration: "none",
                padding: "6px 12px",
                border: "1px solid var(--palette-ink-600, #34322c)",
                borderRadius: "4px",
                background: "var(--palette-ink-800, #20201d)",
                minHeight: 44,
                display: "inline-flex",
                alignItems: "center",
              }}
            >
              Витрина Storybook ↗
            </a>
          </div>
        )}
      </header>

      <section className="landing-hero" aria-labelledby="landing-title">
        <div className="landing-intro">
          <p className="landing-kicker">
            Виртуальный стол для настольных ролевых игр
          </p>
          <h1 id="landing-title">
            Всё необходимое для игры — в едином пространстве
          </h1>
          <p>
            Arken Space объединяет тактильность физической настольной игры с
            плавным 60 FPS мультиплеером. Интерактивная карта, динамический
            туман войны, листы персонажей, броски кубиков и инициатива — всё
            работает в чистом интерфейсе без визуального шума.
          </p>
          <p className="landing-note">
            Arken спроектирован как живой кинематографичный театр: интерфейс не
            заслоняет карту, снимает рутину с мастера и адаптирует визуальный
            стиль под каждого игрока за столом.
          </p>
        </div>

        <form
          className="auth-panel"
          onSubmit={submit}
          aria-label="Вход в игру"
          aria-busy={busy}
        >
          <div>
            <p className="landing-kicker">Присоединиться</p>
            <h2>
              {mode === "gm"
                ? "Вход мастера"
                : mode === "join"
                  ? "Вход в кампанию"
                  : betaPlayer
                    ? `Войти как ${betaPlayer.name}`
                    : "Выберите игрока"}
            </h2>
          </div>
          <p>
            {mode === "gm"
              ? "После входа ссылка будет заменена безопасной сессией мастера в этом браузере."
              : mode === "join"
                ? "Укажите имя, которое увидят другие участники игры."
                : betaPlayer
                  ? `Публичный бета-аккаунт @${betaPlayer.handle}.`
                  : "Нажмите на своего игрока для быстрого входа в игровое лобби."}
          </p>

          {mode === "join" && (
            <label>
              Имя
              <FormInput
                value={name}
                readOnly={busy}
                onChange={(event) => setName(event.target.value)}
                required
                maxLength={40}
                autoFocus
                autoComplete="nickname"
              />
            </label>
          )}

          {error && (
            <div className="error-box" role="alert">
              {error}
            </div>
          )}

          {hasInvitation ? (
            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              {betaPlayer && (
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    padding: "10px 14px",
                    background: "var(--palette-ink-900, #181816)",
                    border: "1px solid var(--palette-clay-500, #c46f49)",
                    borderRadius: "6px",
                  }}
                >
                  <div>
                    <strong
                      style={{ color: "var(--palette-ink-100, #e8e4da)" }}
                    >
                      {betaPlayer.name}
                    </strong>
                    <div
                      style={{
                        fontSize: "0.8rem",
                        color: "var(--palette-clay-400, #d57d55)",
                        fontFamily: "monospace",
                      }}
                    >
                      @{betaPlayer.handle}
                    </div>
                  </div>
                  <span className="landing-badge">Готов к игре</span>
                </div>
              )}
              <Button
                type="submit"
                view="action"
                size="l"
                disabled={busy}
                loading={busy}
              >
                Войти в игру
              </Button>
              {betaPlayer && (
                <a
                  href="/"
                  style={{
                    textAlign: "center",
                    fontSize: "0.85rem",
                    color: "var(--palette-ink-300, #777267)",
                    textDecoration: "underline",
                  }}
                >
                  Выбрать другого игрока
                </a>
              )}
            </div>
          ) : (
            <nav
              className="beta-player-list"
              aria-label="Постоянные игроки"
              aria-busy={busy}
            >
              {betaPlayers.map((player) => (
                <a
                  key={player.handle}
                  href={`/play/${player.handle}`}
                  onClick={(e) => {
                    e.preventDefault();
                    if (busy) return;
                    void loginAsPlayer(player.handle);
                  }}
                  aria-disabled={busy || undefined}
                  tabIndex={busy ? -1 : undefined}
                  title={`Войти в игру как ${player.name} (@${player.handle})`}
                >
                  <strong>{player.name}</strong>
                  <span>@{player.handle}</span>
                </a>
              ))}
            </nav>
          )}
        </form>
      </section>

      <section className="landing-section" aria-labelledby="capabilities-title">
        <p className="landing-kicker">Уже работает</p>
        <h2 id="capabilities-title">Возможности сервиса</h2>
        <div className="capability-grid">
          {capabilities.map((item) => (
            <article className="capability-card" key={item.title}>
              <div className="capability-card__header">
                <span className="capability-card__badge">{item.badge}</span>
              </div>
              <h3>{item.title}</h3>
              <p>{item.description}</p>
              <ul className="capability-card__highlights">
                {item.highlights.map((point) => (
                  <li key={point}>{point}</li>
                ))}
              </ul>
            </article>
          ))}
        </div>
      </section>

      <LandingGuide />

      <section className="landing-section" aria-labelledby="roadmap-title">
        <p className="landing-kicker">Что дальше</p>
        <h2 id="roadmap-title">В разработке и в планах</h2>
        <div className="roadmap-grid">
          {roadmapSections.map((section) => (
            <div className="roadmap-column" key={section.title}>
              <div className="roadmap-column__header">
                <h3>{section.title}</h3>
                <span
                  className={
                    section.status === "in-progress"
                      ? "roadmap-column__badge roadmap-column__badge--active"
                      : "roadmap-column__badge roadmap-column__badge--planned"
                  }
                >
                  {section.badge}
                </span>
              </div>
              <div
                className="roadmap-item-list"
                id={
                  section.status === "planned"
                    ? "roadmap-planned-items"
                    : undefined
                }
              >
                {(section.status === "planned" && !allPlansVisible
                  ? section.items.slice(0, 3)
                  : section.items
                ).map((item) => (
                  <div className="roadmap-item" key={item.id ?? item.title}>
                    <div className="roadmap-item__header">
                      {item.code && (
                        <span className="roadmap-item__code">{item.code}</span>
                      )}
                      <h4>{item.title}</h4>
                    </div>
                    <p>{item.description}</p>
                    {section.status === "planned" && item.id && (
                      <button
                        type="button"
                        className={`roadmap-vote-button${votes[item.id]?.voted ? " is-voted" : ""}`}
                        aria-pressed={votes[item.id]?.voted ?? false}
                        disabled={
                          votesLoading ||
                          votePending !== null ||
                          !votes[item.id]
                        }
                        onClick={() => void toggleRoadmapVote(item.id!)}
                      >
                        {votes[item.id]?.voted ? "Голос отдан" : "Голосовать"}
                        <span
                          aria-label={`${votes[item.id]?.count ?? 0} голосов`}
                        >
                          {votes[item.id]?.count ?? "—"}
                        </span>
                      </button>
                    )}
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
        {voteError && (
          <p className="roadmap-vote-error" role="alert">
            {voteError}
          </p>
        )}
        <p className="roadmap-vote-note">
          Один голос на план в этом браузере. Голос можно отозвать; после
          удаления cookie ограничение сбросится.
        </p>
        {plannedRoadmap && plannedRoadmap.items.length > 3 && (
          <button
            type="button"
            className="roadmap-expand-button"
            aria-expanded={allPlansVisible}
            aria-controls="roadmap-planned-items"
            onClick={() => setAllPlansVisible((visible) => !visible)}
          >
            {allPlansVisible ? "Свернуть планы" : "Показать все планы"}
          </button>
        )}
      </section>

      <section className="landing-section" aria-labelledby="changelog-title">
        <p className="landing-kicker">История развития</p>
        <h2 id="changelog-title">Журнал обновлений сервиса</h2>
        <div className="changelog-timeline">
          {changelog.map((release) => (
            <article className="changelog-card" key={release.version}>
              <div className="changelog-card__header">
                <div className="changelog-card__version-group">
                  <h3 className="changelog-card__version">{release.version}</h3>
                  <span className="changelog-card__tag">{release.tag}</span>
                </div>
                <span className="changelog-card__date">{release.date}</span>
              </div>
              <p className="changelog-card__summary">{release.summary}</p>
              <ul className="changelog-card__list">
                {release.changes.map((change, idx) => (
                  <li key={idx}>{change}</li>
                ))}
              </ul>
            </article>
          ))}
        </div>
      </section>

      <section
        className="landing-section feedback-section"
        aria-labelledby="feedback-title"
      >
        <div className="feedback-copy">
          <p className="landing-kicker">Помогите сделать лучше</p>
          <h2 id="feedback-title">Есть идея или пожелание?</h2>
          <p>
            Оставьте предложение в любое время. Для сообщения об ошибке внутри
            игры удобнее использовать кнопку «Сообщить о проблеме» в меню — она
            автоматически приложит технический лог и контекст.
          </p>
        </div>
        {feedbackStatus === "sent" ? (
          <div className="feedback-success" role="status">
            <h3>Спасибо, предложение отправлено</h3>
            <p>Оно попадёт в общий журнал обратной связи оператора.</p>
            <Button view="outlined" onClick={() => setFeedbackStatus("idle")}>
              Отправить ещё
            </Button>
          </div>
        ) : (
          <form
            className="feedback-form"
            onSubmit={submitFeedback}
            aria-busy={feedbackStatus === "sending"}
          >
            <label>
              Предложение
              <FormTextArea
                name="message"
                readOnly={feedbackStatus === "sending"}
                required
                minLength={5}
                maxLength={4000}
                rows={5}
              />
            </label>
            <label>
              Контакт <span className="optional">необязательно</span>
              <FormInput
                name="contact"
                readOnly={feedbackStatus === "sending"}
                maxLength={160}
                placeholder="Telegram или почта"
              />
            </label>
            <label className="feedback-honeypot" aria-hidden="true">
              Сайт
              <FormInput name="website" tabIndex={-1} autoComplete="off" />
            </label>
            {feedbackError && (
              <div className="error-box" role="alert">
                {feedbackError}
              </div>
            )}
            <Button
              type="submit"
              view="action"
              size="l"
              disabled={feedbackStatus === "sending"}
              loading={feedbackStatus === "sending"}
            >
              Отправить предложение
            </Button>
          </form>
        )}
      </section>

      <footer className="landing-footer">
        <span>Arken Space</span>
        <div style={{ display: "flex", gap: 16 }}>
          {isDevelopment && (
            <a
              href="http://localhost:6006"
              target="_blank"
              rel="noopener noreferrer"
              style={{
                color: "var(--palette-clay-400, #d57d55)",
                textDecoration: "none",
                minHeight: 44,
                display: "inline-flex",
                alignItems: "center",
              }}
            >
              Витрина Storybook ↗
            </a>
          )}
          <span>Проект находится в раннем доступе</span>
        </div>
      </footer>
    </main>
  );
}

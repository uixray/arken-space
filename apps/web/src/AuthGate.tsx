import { Button } from "@gravity-ui/uikit";
import { useState, type FormEvent } from "react";
import { api } from "./api";
import { betaPlayerByHandle, betaPlayers } from "@arken/contracts";
import { FormInput, FormTextArea } from "./ui/GravityFormControls";

type FeedbackStatus = "idle" | "sending" | "sent";

const capabilities = [
  {
    title: "Общий игровой стол",
    text: "Карты, сцены, сетка, туман войны, три слоя видимости, токены, рисунки, пинги и линейка.",
  },
  {
    title: "Персонажи и броски",
    text: "Карточки персонажей, характеристики, навыки, способности, ресурсы, инвентарь, кошелёк и история бросков.",
  },
  {
    title: "Игра в реальном времени",
    text: "Общий чат, управление музыкой и синхронизация действий мастера и игроков во время сессии.",
  },
];

const roadmap = [
  "Провести первые игровые сессии и устранить найденные помехи",
  "Доработать интерфейс по обратной связи мастеров и игроков",
  "Расширить подготовку кампаний, правила и развитие персонажей",
];

export function AuthGate({ onAuthenticated }: { onAuthenticated: () => void }) {
  const [name, setName] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [handoffLink, setHandoffLink] = useState("");
  const [feedbackStatus, setFeedbackStatus] = useState<FeedbackStatus>("idle");
  const [feedbackError, setFeedbackError] = useState("");
  const parts = window.location.pathname.split("/").filter(Boolean);
  const mode = parts[0];
  const token = parts[1] ?? "";
  const handoffRequested =
    new URLSearchParams(window.location.search).get("switch-player") === "1";
  const betaPlayer = mode === "play" ? betaPlayerByHandle(token) : undefined;
  const hasInvitation = mode === "gm" || mode === "join" || Boolean(betaPlayer);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (handoffRequested && !hasInvitation) {
      openPersonalLink();
      return;
    }
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

  const openPersonalLink = () => {
    setError("");
    try {
      const destination = new URL(handoffLink.trim(), window.location.origin);
      const path = destination.pathname.split("/").filter(Boolean);
      const validPath =
        path.length === 2 &&
        (path[0] === "join" || path[0] === "play") &&
        (path[1]?.length ?? 0) > 0;
      if (
        destination.origin !== window.location.origin ||
        destination.search ||
        destination.hash ||
        !validPath
      )
        throw new Error(
          "Используйте личную ссылку Arken Space без параметров.",
        );
      window.location.assign(destination.pathname);
    } catch (reason) {
      setError(
        reason instanceof Error
          ? reason.message
          : "Не удалось открыть личную ссылку",
      );
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
        <a className="wordmark" href="/" aria-label="Arken Space — на главную">
          arken-space
        </a>
        <span className="landing-badge">MVP · ранний доступ</span>
      </header>

      <section className="landing-hero" aria-labelledby="landing-title">
        <div className="landing-intro">
          <p className="landing-kicker">Виртуальный стол для домашних RPG</p>
          <h1 id="landing-title">
            Всё необходимое для игры — в одном пространстве
          </h1>
          <p>
            Arken Space помогает мастеру вести кампанию, а игрокам — видеть
            карту, управлять персонажами и бросать кубики, не отвлекаясь на
            несколько сервисов.
          </p>
          <p className="landing-note">
            Сейчас проект готовится к первым игровым тестам. Некоторые
            возможности и детали интерфейса ещё будут меняться по результатам
            реальных сессий.
          </p>
        </div>

        <form className="auth-panel" onSubmit={submit} aria-label="Вход в игру">
          <div>
            <p className="landing-kicker">Присоединиться</p>
            <h2>
              {mode === "gm"
                ? "Вход мастера"
                : mode === "join"
                  ? "Вход в кампанию"
                  : betaPlayer
                    ? `Войти как ${betaPlayer.name}`
                    : handoffRequested
                      ? "Передайте компьютер следующему игроку"
                      : "Выберите игрока"}
            </h2>
          </div>
          <p>
            {mode === "gm"
              ? "После входа ссылка будет заменена безопасной сессией в этом браузере."
              : mode === "join"
                ? "Укажите имя, которое увидят другие участники игры."
                : betaPlayer
                  ? `Публичный бета-аккаунт @${betaPlayer.handle}.`
                  : handoffRequested
                    ? "Следующий игрок должен открыть свою личную ссылку. Она не сохраняется на этом компьютере."
                    : "На время закрытого бета-теста выберите свой аккаунт."}
          </p>
          {mode === "join" && (
            <label>
              Имя
              <FormInput
                value={name}
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
          {hasInvitation && (
            <Button
              type="submit"
              view="action"
              size="l"
              disabled={busy}
              loading={busy}
            >
              Войти
            </Button>
          )}
          {handoffRequested && !hasInvitation && (
            <div className="handoff-link-form">
              <label>
                Личная ссылка игрока
                <FormInput
                  value={handoffLink}
                  onChange={(event) => setHandoffLink(event.target.value)}
                  type="password"
                  autoComplete="off"
                  inputMode="url"
                  placeholder="https://arken-space…/join/…"
                  required
                />
              </label>
              <Button type="submit" view="action" size="l">
                Открыть ссылку
              </Button>
            </div>
          )}
          {!hasInvitation && !handoffRequested && (
            <nav className="beta-player-list" aria-label="Постоянные игроки">
              {betaPlayers.map((player) => (
                <a key={player.handle} href={`/play/${player.handle}`}>
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
              <h3>{item.title}</h3>
              <p>{item.text}</p>
            </article>
          ))}
        </div>
      </section>

      <section
        className="landing-section landing-roadmap"
        aria-labelledby="roadmap-title"
      >
        <div>
          <p className="landing-kicker">Что дальше</p>
          <h2 id="roadmap-title">Ближайшие планы</h2>
        </div>
        <ol>
          {roadmap.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ol>
      </section>

      <section
        className="landing-section feedback-section"
        aria-labelledby="feedback-title"
      >
        <div className="feedback-copy">
          <p className="landing-kicker">Помогите сделать лучше</p>
          <h2 id="feedback-title">Есть идея или пожелание?</h2>
          <p>
            Оставьте предложение в любое время. Для ошибки внутри игры удобнее
            использовать кнопку «Сообщить о проблеме» — она приложит технический
            контекст.
          </p>
        </div>
        {feedbackStatus === "sent" ? (
          <div className="feedback-success" role="status">
            <h3>Спасибо, предложение отправлено</h3>
            <p>Оно попадёт в общий список обратной связи.</p>
            <Button view="outlined" onClick={() => setFeedbackStatus("idle")}>
              Отправить ещё
            </Button>
          </div>
        ) : (
          <form className="feedback-form" onSubmit={submitFeedback}>
            <label>
              Предложение
              <FormTextArea
                name="message"
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
        <span>Проект находится в раннем доступе</span>
      </footer>
    </main>
  );
}

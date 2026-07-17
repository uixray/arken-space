import { Button } from "@gravity-ui/uikit";
import { useState, type FormEvent } from "react";
import { api } from "./api";
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
  const [feedbackStatus, setFeedbackStatus] = useState<FeedbackStatus>("idle");
  const [feedbackError, setFeedbackError] = useState("");
  const parts = window.location.pathname.split("/").filter(Boolean);
  const mode = parts[0];
  const token = parts[1] ?? "";
  const hasInvitation = mode === "gm" || mode === "join";

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
                  : "Нужна персональная ссылка"}
            </h2>
          </div>
          <p>
            {mode === "gm"
              ? "После входа ссылка будет заменена безопасной сессией в этом браузере."
              : mode === "join"
                ? "Укажите имя, которое увидят другие участники игры."
                : "Попросите мастера прислать сохранённое приглашение игрока или персональную ссылку мастера."}
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

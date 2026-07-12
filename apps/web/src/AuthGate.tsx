import { useState, type FormEvent } from "react";
import { api } from "./api";

export function AuthGate({ onAuthenticated }: { onAuthenticated: () => void }) {
  const [name, setName] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const parts = window.location.pathname.split("/").filter(Boolean);
  const mode = parts[0];
  const token = parts[1] ?? "";

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

  return (
    <main className="auth-shell">
      <form className="auth-panel" onSubmit={submit}>
        <div className="wordmark">arken-space</div>
        <h1>
          {mode === "gm"
            ? "Вход мастера"
            : mode === "join"
              ? "Вход в кампанию"
              : "Нужна ссылка"}
        </h1>
        <p>
          {mode === "gm"
            ? "Ссылка будет заменена безопасной сессией в этом браузере."
            : mode === "join"
              ? "Укажите имя, которое увидят участники."
              : "Попросите мастера прислать персональное приглашение."}
        </p>
        {mode === "join" && (
          <label>
            Имя
            <input
              value={name}
              onChange={(event) => setName(event.target.value)}
              required
              maxLength={40}
              autoFocus
            />
          </label>
        )}
        {error && <div className="error-box">{error}</div>}
        {(mode === "gm" || mode === "join") && (
          <button className="primary" disabled={busy}>
            {busy ? "Входим…" : "Войти"}
          </button>
        )}
      </form>
    </main>
  );
}

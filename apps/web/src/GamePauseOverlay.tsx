import { useLayoutEffect, useRef, useState } from "react";

export function GamePauseOverlay({
  paused,
  isGm,
  onToggle,
  artwork,
}: {
  paused: boolean;
  isGm: boolean;
  onToggle: () => Promise<void>;
  artwork?: string;
}) {
  const root = useRef<HTMLDivElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  useLayoutEffect(() => {
    if (
      paused &&
      root.current?.closest(".map-shell")?.contains(document.activeElement)
    ) {
      heading.current?.focus();
    }
  }, [paused]);
  const toggle = async () => {
    if (pending) return;
    setPending(true);
    setError("");
    try {
      await onToggle();
    } catch {
      setError("Не удалось изменить перерыв. Попробуйте ещё раз.");
    } finally {
      setPending(false);
    }
  };
  return (
    <div
      ref={root}
      className={paused ? "game-pause-overlay" : "game-pause-control"}
    >
      {paused && (
        <>
          {artwork && (
            <img src={artwork} alt="" className="game-pause-artwork" />
          )}
          <h2 ref={heading} tabIndex={-1}>
            Перерыв
          </h2>
          <p role="status">
            Мастер временно приостановил игру. Чат и броски доступны.
          </p>
        </>
      )}
      {isGm && (
        <button type="button" disabled={pending} onClick={() => void toggle()}>
          {paused ? "Продолжить игру" : "Начать перерыв"}
        </button>
      )}
      {error && <p role="alert">{error}</p>}
    </div>
  );
}

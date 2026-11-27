import type { ConnectionState } from "./use-game-socket-subscriptions";
import { useLayoutEffect, useRef } from "react";
import { Button } from "./design-system/Button";
import "./connection-notice.css";

/** Visible without opening the session menu, including the compact layout. */
export function ConnectionNotice({ connection, onRecover }: {
  connection: ConnectionState;
  onRecover: () => void;
}) {
  const notice = useRef<HTMLElement>(null);
  useLayoutEffect(() => {
    const root = document.documentElement;
    const key = "--connection-notice-height";
    const previous = root.style.getPropertyValue(key);
    const priority = root.style.getPropertyPriority(key);
    const update = () => root.style.setProperty(key, `${notice.current?.getBoundingClientRect().height ?? 0}px`);
    update();
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(update);
    if (notice.current) observer?.observe(notice.current);
    window.addEventListener("resize", update);
    return () => {
      observer?.disconnect(); window.removeEventListener("resize", update);
      if (previous) root.style.setProperty(key, previous, priority); else root.style.removeProperty(key);
    };
  }, [connection]);
  if (connection === "ONLINE") return null;
  const synchronizing = connection === "RESYNCING";
  return <aside ref={notice} className="connection-notice" aria-label="Связь с игровым сервером">
    <p role="status" aria-live="polite" aria-atomic="true">
      <strong>{synchronizing ? "Получаем актуальное состояние игры" : connection === "CONNECTING" ? "Подключаемся к игре" : connection === "RECONNECTING" ? "Восстанавливаем связь с сервером" : "Нет связи с сервером"}</strong>
      <span>{synchronizing ? "Дождитесь обновления перед новыми действиями." : "На экране последнее полученное состояние. Дождитесь подключения перед новыми действиями."}</span>
    </p>
    <Button type="button" onClick={onRecover}>{synchronizing ? "Повторить обновление" : "Подключиться снова"}</Button>
    <a href="/account">Мои кампании и вход</a>
  </aside>;
}

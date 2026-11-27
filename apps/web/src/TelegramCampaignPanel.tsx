import { useEffect, useRef, useState } from "react";
import { api, ApiError } from "./api";
import { Button } from "./design-system/Button";
import { FormInput } from "./ui/GravityFormControls";
import "./telegram-campaign.css";

type Receipt = { id: string; state: string; delivery: string; command: string; createdAt: string };
type Status = { enabled: boolean; username?: string; gm?: boolean;
  linked?: boolean; groupLinked?: boolean; receipts?: Receipt[] };
const stateLabels: Record<string, string> = { PENDING: "в очереди", RUNNING: "обрабатывается",
  DONE: "выполнена", UNKNOWN: "требует сверки", REJECTED: "отклонена" };
const deliveryLabels: Record<string, string> = { NONE: "ожидает обработки", PENDING: "в очереди",
  SENDING: "отправляется", SENT: "отправлен", UNKNOWN: "не подтверждён", FAILED: "отклонён Telegram", CANCELLED: "отменён" };

/** Session-scoped: mount with campaign+membership key, never shares credentials. */
export function TelegramCampaignPanel({ membershipId }: { membershipId: string }) {
  function botApi<T>(path: string, init?: RequestInit) {
    const headers = new Headers(init?.headers);
    headers.set("x-arken-membership-id", membershipId);
    return api<T>(path, { ...init, headers });
  }
  const [status, setStatus] = useState<Status | null>(null);
  const [telegramId, setTelegramId] = useState("");
  const [group, setGroup] = useState(false);
  const [chatId, setChatId] = useState("");
  const [threadId, setThreadId] = useState("0");
  const [code, setCode] = useState<{ command: string; expiresAt: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [stopped, setStopped] = useState(false);
  const [notSent, setNotSent] = useState(false);
  const scope = useRef(0);
  const pending = useRef(false);
  const opened = useRef(false);
  useEffect(() => () => { scope.current += 1; opened.current = false; }, []);
  const refresh = async () => {
    const current = scope.current;
    const result = await botApi<Status>("/api/telegram/campaign");
    if (current === scope.current) setStatus(result);
  };
  const run = async (action: () => Promise<void>) => {
    if (pending.current) return;
    const current = scope.current;
    pending.current = true;
    setBusy(true); setError("");
    try { await action(); }
    catch (reason) {
      if (current === scope.current) {
        if (reason instanceof ApiError && [401, 403, 409].includes(reason.status)) {
          setCode(null); setStatus(null); setTelegramId(""); setChatId(""); setGroup(false);
        }
        setError("Операция не завершена. Обновите состояние перед повтором.");
      }
    }
    finally {
      pending.current = false;
      if (current === scope.current) setBusy(false);
      else if (opened.current) void run(refresh);
    }
  };
  const recover = (receipt: Receipt, action: "RETRY_COMMAND" | "RETRY_SEND" | "CONFIRM_SENT") => {
    const current = scope.current;
    return run(async () => {
      await botApi("/api/telegram/campaign/recover", { method: "POST", body: JSON.stringify({
        id: receipt.id, action, previousWorkerStopped: stopped, confirmedNotSent: notSent,
        confirmedReceived: action === "CONFIRM_SENT",
      }) });
      if (current === scope.current) await refresh();
    });
  };
  return (
    <details className="telegram-campaign" onToggle={event => {
      opened.current = event.currentTarget.open;
      if (event.currentTarget.open) void run(refresh);
      else { scope.current += 1; setCode(null); setStatus(null); setError(""); setBusy(false);
        setStopped(false); setNotSent(false); }
    }}>
      <summary>Telegram-бот</summary>
      {error && <p role="alert">{error}</p>}
      {busy && <p role="status">Обработка…</p>}
      <Button type="button" disabled={busy} onClick={() => void run(refresh)}>Обновить состояние</Button>
      {status?.enabled === false && <p>Бота включает администратор после настройки интеграции.</p>}
      {status?.enabled && <>
        <p>Бот: <a href={`https://t.me/${status.username}`} target="_blank" rel="noopener noreferrer">{status.username}</a>.</p>
        <p>{status.linked ? "Ваш Telegram подключён." : "Подключите личный Telegram."}
          {status.groupLinked ? " Группа кампании подключена." : " Группа кампании пока не подключена."}</p>
        <p>В личном диалоге с ботом отправьте /whoami, чтобы узнать свой числовой ID.
          Код действует пять минут и подходит только указанному пользователю и чату.
          Выход из этого сеанса приложения отключает привязку.</p>
        <form onSubmit={event => { event.preventDefault(); const current = scope.current;
          void run(async () => {
            const result = await botApi<{ command: string; expiresAt: string }>("/api/telegram/campaign/code", {
              method: "POST", body: JSON.stringify({ telegramUserId: telegramId.trim(),
                ...(group ? { chatId: chatId.trim(), threadId: threadId.trim() || "0" } : {}),
              }),
            });
            if (current === scope.current) setCode(result);
          });
        }}>
          <label>Ваш Telegram ID<FormInput value={telegramId} onChange={e => { setTelegramId(e.target.value); setCode(null); }}
            required pattern="[1-9][0-9]*" maxLength={24} autoComplete="off" disabled={busy} /></label>
          {status.gm && <label><input type="checkbox" checked={group} disabled={busy}
            onChange={e => { setGroup(e.target.checked); setCode(null); }} />Подключить группу кампании</label>}
          {group && status.gm && <>
            <p>Добавьте бота в нужную группу. Команда /where покажет ID чата и темы.
              Отправляйте полученный код только в эту группу и тему.</p>
            <label>ID чата<FormInput value={chatId} onChange={e => { setChatId(e.target.value); setCode(null); }}
              required pattern="-[1-9][0-9]*" maxLength={24} disabled={busy} /></label>
            <label>ID темы (0 — без темы)<FormInput value={threadId} onChange={e => { setThreadId(e.target.value); setCode(null); }}
              pattern="0|[1-9][0-9]*" maxLength={20} disabled={busy} /></label>
          </>}
          <Button type="submit" disabled={busy}>Создать одноразовый код</Button>
        </form>
        {code && <section aria-label="Команда подключения">
          <p>Отправьте команду {group ? "в указанную группу" : "в личный диалог с ботом"}.
            Действует до {new Date(code.expiresAt).toLocaleTimeString("ru-RU")}.</p>
          <textarea aria-label="Одноразовая команда Telegram" readOnly value={code.command} rows={3} />
        </section>}
        <Button type="button" disabled={busy} onClick={() => void run(async () => {
          const current = scope.current;
          await botApi("/api/telegram/campaign/unlink", { method: "POST", body: "{}" });
          if (current === scope.current) setCode(null);
          if (current === scope.current) await refresh();
        })}>Отключить личную привязку и группу этого сеанса</Button>
        <p>/help — справка; /roll — публичный бросок; /characters и /change — в личном диалоге.
          Баги отправляйте командой /bug в согласованную группу багов.</p>
        {!!status.receipts?.length && <section aria-label="Доставка ответов бота">
          <h3>Последние команды этого сеанса</h3>
          <p>При неизвестном результате сначала сверьте ответ в Telegram.
            Повтор команды использует прежний ID действия; повтор отправки ответа требует отдельной сверки.</p>
          <label><input type="checkbox" checked={stopped} onChange={e => setStopped(e.target.checked)} />
            Прежний обработчик завершён или остановлен</label>
          <label><input type="checkbox" checked={notSent} onChange={e => setNotSent(e.target.checked)} />
            Я подтвердил, что ответ отсутствует в Telegram</label>
          <ul>{status.receipts.map(row => <li key={row.id}>
            <p>/{row.command} · {new Date(row.createdAt).toLocaleString("ru-RU")}</p>
            <p>Команда: {stateLabels[row.state] ?? "требует сверки"}. Ответ: {deliveryLabels[row.delivery] ?? "требует сверки"}.</p>
            {["UNKNOWN", "RUNNING"].includes(row.state) && <Button type="button" disabled={busy || !stopped}
              onClick={() => void recover(row, "RETRY_COMMAND")}>Восстановить обработку</Button>}
            {row.state === "DONE" && ["FAILED", "UNKNOWN", "SENDING"].includes(row.delivery) &&
              <Button type="button" disabled={busy || (row.delivery !== "FAILED" && (!stopped || !notSent))}
                onClick={() => void recover(row, "RETRY_SEND")}>Повторить доставку ответа</Button>}
            {row.state === "DONE" && ["UNKNOWN", "SENDING"].includes(row.delivery) &&
              <Button type="button" disabled={busy || !stopped}
                onClick={() => void recover(row, "CONFIRM_SENT")}>Подтверждаю: ответ получен в Telegram</Button>}
          </li>)}</ul>
        </section>}
      </>}
    </details>
  );
}

import { useEffect, useRef, useState } from "react";
import type {
  CharacterDto,
  PlayerRequestDto,
  ProgressionTarget,
} from "@arken/contracts";
import { api, ApiError, formatApiError } from "./api";
import { ArkenDialog } from "./ui/ArkenDialog";
import "./CharacterProgression.css";

type View = {
  balance: number;
  spentSp: number;
  grantedSp: number;
  targets: Array<ProgressionTarget & { label: string; value: number | null }>;
  records: PlayerRequestDto[];
};
type Command = {
  operation: "create" | "grant" | "action";
  body: Record<string, unknown>;
};
// Survive character switches while a response is ambiguous. Never share a
// pending command across campaign/member identities; no secrets in logs.
const pendingCommands = new Map<string, Command>();
const stateLabels = {
  PENDING: "Ожидает решения",
  APPLIED: "Применено",
  DECLINED: "Отклонено",
  CANCELLED: "Отменено игроком",
  REVERSED: "Отменено мастером, SP возвращены",
  GRANTED: "Начислено",
};
const actionLabels: Record<string, string> = {
  SUBMIT: "Заявка и d20",
  COUNTER: "Предложена другая сумма",
  CONSENT: "Сумма согласована игроком",
  APPLY: "Применение",
  DECLINE: "Отказ",
  CANCEL: "Отмена заявки",
  REVERSE: "Отмена и возврат",
  GRANT: "Начисление",
};
const errors: Record<string, string> = {
  INSUFFICIENT_SP: "Недостаточно SP. Заявка не применена.",
  SP_CONSENT_REQUIRED: "Игрок ещё не согласовал новую сумму.",
  REVISION_CONFLICT:
    "Заявка изменилась. Список обновлён — проверьте её заново.",
  CHARACTER_CONFLICT: "Персонаж изменился. Обновите данные.",
  REVERSE_LATEST_FIRST:
    "Сначала отмените более поздние улучшения этой характеристики или навыка.",
  TARGET_CHANGED_SINCE_APPLY:
    "После улучшения значение изменили. Автоматический откат заблокирован, чтобы не затереть изменения.",
  TARGET_NOT_FOUND: "Характеристика или навык больше не существует.",
  TEXT_EFFECT_ONLY:
    "Для этой способности доступно текстовое улучшение без числовой поправки.",
  INVALID_TRANSITION: "Это действие уже недоступно. Список обновлён.",
  ACTION_ID_CONFLICT:
    "Конфликт идентификатора команды. Данные не перезаписаны.",
};

function ProgressionRecord({
  row,
  isGm,
  membershipId,
  disabled,
  send,
}: {
  row: PlayerRequestDto;
  isGm: boolean;
  membershipId: string;
  disabled: boolean;
  send: (command: Command) => Promise<void>;
}) {
  const p = row.progression!;
  const [amount, setAmount] = useState(String(p.proposedSp ?? p.sp));
  const [note, setNote] = useState("");
  const [effect, setEffect] = useState("");
  const [delta, setDelta] = useState("");
  const act = (action: string, fields: Record<string, unknown> = {}) =>
    send({
      operation: "action",
      body: {
        requestId: row.id,
        revision: row.revision,
        action,
        ...fields,
      },
    });
  return (
    <article className="progression-record">
      <h4>
        {p.targetLabel} — {stateLabels[p.state]}
      </h4>
      <p>
        {p.kind === "GRANT"
          ? "Начислил: " + (row.resolvedByDisplayName ?? "мастер")
          : "Автор: " + row.authorDisplayName}
      </p>
      <p>
        {p.sp} SP{p.roll !== null ? " · d20: " + p.roll : ""}
      </p>
      <p>{row.body}</p>
      {p.effect && (
        <p>
          <strong>Улучшение: </strong>
          {p.effect}
        </p>
      )}
      {p.adjustment && (
        <p>
          Значение: с {p.adjustment.before} до {p.adjustment.after}
        </p>
      )}
      {p.proposedSp !== null && p.state === "PENDING" && (
        <p role="status">
          Мастер предлагает {p.proposedSp} SP. До согласия игрока применение
          заблокировано.
        </p>
      )}
      <fieldset disabled={disabled} className="progression-controls">
        {p.state === "PENDING" && isGm && (
          <>
            <form
              onSubmit={(event) => {
                event.preventDefault();
                void act("APPLY", {
                  effect,
                  ...(delta.trim() ? { delta: Number(delta) } : {}),
                });
              }}
            >
              <label>
                Описание улучшения
                <textarea
                  required
                  maxLength={2000}
                  value={effect}
                  onChange={(event) => setEffect(event.target.value)}
                />
              </label>
              {p.target && ["STAT", "SKILL"].includes(p.target.kind) && (
                <label>
                  Изменить значение на (необязательно)
                  <input
                    type="number"
                    step="any"
                    min={-100000}
                    max={100000}
                    value={delta}
                    onChange={(event) => setDelta(event.target.value)}
                  />
                </label>
              )}
              <button
                type="submit"
                disabled={p.proposedSp !== null || !effect.trim()}
              >
                Применить и списать {p.sp} SP
              </button>
            </form>
            <form
              onSubmit={(event) => {
                event.preventDefault();
                void act("COUNTER", { sp: Number(amount), note });
              }}
            >
              <label>
                Предложить другую сумму SP
                <input
                  type="number"
                  min={1}
                  max={1000000}
                  step={1}
                  required
                  value={amount}
                  onChange={(event) => setAmount(event.target.value)}
                />
              </label>
              <label>
                Причина / комментарий
                <textarea
                  required
                  maxLength={2000}
                  value={note}
                  onChange={(event) => setNote(event.target.value)}
                />
              </label>
              <button
                type="submit"
                disabled={!note.trim() || Number(amount) === p.sp}
              >
                Предложить игроку
              </button>
              <button
                type="button"
                disabled={!note.trim()}
                onClick={() => void act("DECLINE", { note })}
              >
                Отклонить без списания
              </button>
            </form>
          </>
        )}
        {p.state === "PENDING" &&
          !isGm &&
          row.authorMembershipId === membershipId && (
            <>
              {p.proposedSp !== null && (
                <button type="button" onClick={() => void act("CONSENT")}>
                  Согласен на {p.proposedSp} SP
                </button>
              )}
              <button
                type="button"
                onClick={() =>
                  void act("CANCEL", { note: "Игрок отменил заявку." })
                }
              >
                Отменить заявку без списания
              </button>
            </>
          )}
        {p.state === "APPLIED" && isGm && (
          <form
            onSubmit={(event) => {
              event.preventDefault();
              void act("REVERSE", { note });
            }}
          >
            <label>
              Причина отмены
              <textarea
                required
                maxLength={2000}
                value={note}
                onChange={(event) => setNote(event.target.value)}
              />
            </label>
            <button type="submit" disabled={!note.trim()}>
              Отменить улучшение и вернуть {p.sp} SP
            </button>
          </form>
        )}
      </fieldset>
      <details>
        <summary>История</summary>
        <ol>
          {p.history.map((item, index) => (
            <li key={index}>
              {new Date(item.at).toLocaleString()} ·{" "}
              {actionLabels[item.action] ?? item.action} · {item.sp} SP
              {item.note && <p>{item.note}</p>}
            </li>
          ))}
        </ol>
      </details>
    </article>
  );
}

export function CharacterProgression({
  character,
  isGm,
  membershipId,
  campaignId,
  requestVersion,
}: {
  character: CharacterDto;
  isGm: boolean;
  membershipId: string;
  campaignId: string;
  requestVersion: string;
}) {
  const scope = campaignId + ":" + membershipId + ":" + character.id;
  const [open, setOpen] = useState(false);
  const [view, setView] = useState<View | null>(null);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(false);
  const [pending, setPending] = useState<Command | null>(
    () => pendingCommands.get(scope) ?? null,
  );
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [targetKey, setTargetKey] = useState("");
  const [sp, setSp] = useState("1");
  const [comment, setComment] = useState("");
  const mounted = useRef(true);
  const inFlight = useRef(false);
  const readSequence = useRef(0);
  const url =
    "/api/characters/" + encodeURIComponent(character.id) + "/progression";
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      readSequence.current += 1;
    };
  }, []);
  const refresh = async () => {
    const sequence = ++readSequence.current;
    setLoading(true);
    try {
      const result = await api<View>(url);
      if (mounted.current && sequence === readSequence.current) setView(result);
    } catch (reason) {
      if (mounted.current && sequence === readSequence.current)
        setError(formatApiError(reason, "Не удалось загрузить прокачку."));
    } finally {
      if (mounted.current && sequence === readSequence.current)
        setLoading(false);
    }
  };
  useEffect(() => {
    if (open) void refresh();
  }, [open, character.revision, requestVersion]);
  const send = async (input: Command) => {
    if (inFlight.current) return;
    const command = pendingCommands.get(scope) ?? {
      ...input,
      body: { ...input.body, actionId: crypto.randomUUID() },
    };
    pendingCommands.set(scope, command);
    setPending(command);
    inFlight.current = true;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await api<PlayerRequestDto>(url + "/" + command.operation, {
        method: "POST",
        body: JSON.stringify(command.body),
      });
      pendingCommands.delete(scope);
      if (!mounted.current) return;
      setPending(null);
      setComment("");
      setNotice("Сохранено.");
      await refresh();
    } catch (reason) {
      const terminal =
        reason instanceof ApiError &&
        reason.status >= 400 &&
        reason.status < 500 &&
        ![408, 429].includes(reason.status);
      if (terminal) pendingCommands.delete(scope);
      if (!mounted.current) return;
      if (terminal) setPending(null);
      setError(
        reason instanceof ApiError
          ? (errors[reason.code] ??
              formatApiError(reason, "Не удалось выполнить команду."))
          : formatApiError(
              reason,
              "Ответ не получен. Повторите ту же команду.",
            ),
      );
      if (terminal) await refresh();
    } finally {
      inFlight.current = false;
      if (mounted.current) setBusy(false);
    }
  };
  const target = view?.targets.find(
    (item) => item.kind + ":" + item.key === targetKey,
  );
  return (
    <section className="character-progression">
      <button type="button" onClick={() => setOpen(true)}>
        Прокачка · {character.wallet.sp} SP
      </button>
      <ArkenDialog
        open={open}
        title={"Прокачка — " + character.name}
        footer={false}
        onClose={() => {
          if (!inFlight.current && !pendingCommands.has(scope)) setOpen(false);
        }}
      >
        <div className="progression-workspace">
          <p>
            Заявка и d20 видны только её автору и мастерам. SP списываются при
            утверждении.
          </p>
          {error && (
            <p role="alert" className="field-error">
              {error}
            </p>
          )}
          {notice && <p role="status">{notice}</p>}
          {loading && <p role="status">Обновляем…</p>}
          <button
            type="button"
            disabled={busy || loading}
            onClick={() => void refresh()}
          >
            Обновить
          </button>
          {pending && (
            <div role="status">
              <p>
                Команда ещё не подтверждена. Повтор не создаст второй бросок или
                списание.
              </p>
              <button
                type="button"
                disabled={busy}
                onClick={() => void send(pending)}
              >
                Повторить ту же команду
              </button>
            </div>
          )}
          {view && (
            <>
              <p>
                <strong>
                  Остаток: {view.balance} SP · Вложено: {view.spentSp} SP
                </strong>
              </p>
              <p>
                Начислено через журнал: {view.grantedSp} SP. Старый остаток не
                считается новым начислением.
              </p>
              <fieldset disabled={busy || Boolean(pending) || loading}>
                <legend>{isGm ? "Начисление SP" : "Новая заявка"}</legend>
                <form
                  onSubmit={(event) => {
                    event.preventDefault();
                    if (isGm)
                      void send({
                        operation: "grant",
                        body: { sp: Number(sp), note: comment },
                      });
                    else if (target)
                      void send({
                        operation: "create",
                        body: {
                          target: { kind: target.kind, key: target.key },
                          sp: Number(sp),
                          comment,
                        },
                      });
                  }}
                >
                  {!isGm && (
                    <label>
                      Что прокачиваем
                      <select
                        required
                        value={targetKey}
                        onChange={(event) => setTargetKey(event.target.value)}
                      >
                        <option value="">
                          Выберите характеристику или навык
                        </option>
                        {view.targets.map((item) => (
                          <option
                            key={item.kind + ":" + item.key}
                            value={item.kind + ":" + item.key}
                          >
                            {item.label}
                            {item.value !== null
                              ? " · " + item.value
                              : " · текстовое улучшение"}
                          </option>
                        ))}
                      </select>
                    </label>
                  )}
                  <label>
                    Количество SP
                    <input
                      type="number"
                      required
                      min={1}
                      max={1000000}
                      step={1}
                      value={sp}
                      onChange={(event) => setSp(event.target.value)}
                    />
                  </label>
                  <label>
                    {isGm ? "За что начисляем" : "Суть и обоснование прокачки"}
                    <textarea
                      required
                      maxLength={2000}
                      value={comment}
                      onChange={(event) => setComment(event.target.value)}
                    />
                  </label>
                  <button
                    type="submit"
                    disabled={!comment.trim() || (!isGm && !target)}
                  >
                    {isGm
                      ? "Начислить SP с записью в журнал"
                      : "Отправить заявку и бросить d20"}
                  </button>
                </form>
              </fieldset>
              <h3>Заявки и история улучшений</h3>
              {view.records.length === 0 && <p>Записей пока нет.</p>}
              {[...view.records].reverse().map((row) => (
                <ProgressionRecord
                  key={row.id + ":" + row.revision}
                  row={row}
                  isGm={isGm}
                  membershipId={membershipId}
                  disabled={busy || Boolean(pending) || loading}
                  send={send}
                />
              ))}
            </>
          )}
        </div>
      </ArkenDialog>
    </section>
  );
}

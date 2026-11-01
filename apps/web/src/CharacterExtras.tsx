import { useEffect, useRef, useState } from "react";
import type {
  CharacterDto,
  ChatMessageDto,
  GameSnapshot,
} from "@arken/contracts";
import { api, ApiError } from "./api";
import { ArkenDialog } from "./ui/ArkenDialog";
import { Button } from "./design-system/Button";
import "./CharacterExtras.css";

const errors: Record<string, string> = {
  NOTEBOOK_CONFLICT:
    "Записи изменились в другом окне. Ваш текст сохранён в этом окне. Скопируйте его перед загрузкой серверной версии.",
  CHARACTER_CONFLICT:
    "Ресурс изменился. Обновите данные и повторите корректировку.",
  NO_INSPIRATION: "Нет вдохновения. Его выдаёт мастер.",
  ROLL_NOT_ELIGIBLE:
    "Этот бросок уже нельзя перебросить. Допустим только ваш последний открытый d20 этого персонажа.",
  ROLL_ALREADY_REROLLED: "Этот бросок уже переброшен.",
};
const messageFor = (error: unknown) =>
  error instanceof ApiError
    ? (errors[error.code] ?? "Операция отклонена сервером. Обновите данные.")
    : "Ответ не получен. Повторите ту же команду.";
const terminal = (error: unknown) =>
  error instanceof ApiError &&
  error.status >= 400 &&
  error.status < 500 &&
  ![408, 429].includes(error.status);

export function PrivateNpcNotebook({ character }: { character: CharacterDto }) {
  const [open, setOpen] = useState(false),
    [loaded, setLoaded] = useState(false);
  const [text, setText] = useState(""),
    [revision, setRevision] = useState(0);
  const [savedText, setSavedText] = useState(""),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const pending = useRef<{
    actionId: string;
    revision: number;
    text: string;
  } | null>(null);
  const [retry, setRetry] = useState(false);
  const flight = useRef(false),
    alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  useEffect(() => {
    if (text === savedText && !retry) return;
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [text, savedText, retry]);
  const url = `/api/characters/${character.id}/private-notebook`;
  const load = async () => {
    if (flight.current) return;
    flight.current = true;
    setBusy(true);
    setError("");
    try {
      const value = await api<{ text: string; revision: number }>(url);
      if (!alive.current) return;
      setText(value.text);
      setSavedText(value.text);
      setRevision(value.revision);
      setLoaded(true);
    } catch {
      if (alive.current) setError("Не удалось загрузить личные записи.");
    } finally {
      flight.current = false;
      if (alive.current) setBusy(false);
    }
  };
  const save = async () => {
    if (flight.current) return;
    const command = pending.current ?? {
      actionId: crypto.randomUUID(),
      revision,
      text,
    };
    pending.current = command;
    flight.current = true;
    setBusy(true);
    setError("");
    try {
      const value = await api<{ text: string; revision: number }>(url, {
        method: "PUT",
        body: JSON.stringify(command),
      });
      pending.current = null;
      if (alive.current) {
        setRevision(value.revision);
        setSavedText(value.text);
        setRetry(false);
      }
    } catch (reason) {
      if (terminal(reason)) pending.current = null;
      if (alive.current) {
        setRetry(Boolean(pending.current));
        setError(messageFor(reason));
      }
    } finally {
      flight.current = false;
      if (alive.current) setBusy(false);
    }
  };
  return (
    <>
      <Button
        onClick={() => {
          setOpen(true);
          if (!loaded) void load();
        }}
      >
        Мои записи об NPC
      </Button>
      <ArkenDialog
        open={open}
        className="private-npc-notebook"
        title={`Мои записи об NPC · ${character.name}`}
        footer={false}
        onClose={() => setOpen(false)}
      >
        <p>
          Личный блокнот. Эти записи не видят мастер и другие управляющие
          персонажем. Общие заметки персонажа остаются отдельно.
        </p>
        <label className="field">
          Имена, занятия, места, слухи и догадки
          <textarea
            rows={14}
            maxLength={20000}
            value={text}
            disabled={!loaded || busy || retry}
            onChange={(event) => setText(event.target.value)}
          />
        </label>
        <p role="status">
          {loaded
            ? text === savedText && !retry
              ? "Сохранено"
              : "Есть несохранённые записи"
            : "Записи ещё не загружены"}
        </p>
        {error && <p role="alert">{error}</p>}
        <Button
          disabled={!loaded || busy || (!retry && text === savedText)}
          onClick={() => void save()}
        >
          {retry ? "Повторить сохранение" : "Сохранить"}
        </Button>
        <Button
          disabled={busy || retry}
          onClick={() => {
            if (
              !loaded ||
              text === savedText ||
              window.confirm(
                "Заменить текст в этом окне серверной версией? Несохранённый текст будет потерян.",
              )
            )
              void load();
          }}
        >
          Загрузить серверную версию
        </Button>
      </ArkenDialog>
    </>
  );
}

// Pending commands contain no notebook text. Keep the same actionId across
// feed/sheet remounts after an ambiguous network response.
const pendingInspiration = new Map<
  string,
  { operation: string; body: Record<string, unknown> }
>();
function useInspirationCommand(scope: string, characterId: string) {
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const [retry, setRetry] = useState(pendingInspiration.has(scope));
  const lock = useRef(false),
    alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  const send = async (operation: string, body: Record<string, unknown>) => {
    if (lock.current) return false;
    lock.current = true;
    setBusy(true);
    setError("");
    const command = pendingInspiration.get(scope) ?? {
      operation,
      body: { ...body, actionId: crypto.randomUUID() },
    };
    pendingInspiration.set(scope, command);
    try {
      await api(
        `/api/characters/${characterId}/inspiration/${command.operation}`,
        { method: "POST", body: JSON.stringify(command.body) },
      );
      pendingInspiration.delete(scope);
      if (alive.current) setRetry(false);
      return true;
    } catch (reason) {
      if (terminal(reason)) pendingInspiration.delete(scope);
      if (alive.current) {
        setRetry(pendingInspiration.has(scope));
        setError(messageFor(reason));
      }
      return false;
    } finally {
      lock.current = false;
      if (alive.current) setBusy(false);
    }
  };
  return { busy, error, retry, send };
}
export function InspirationResource({
  character,
  snapshot,
  compact = false,
}: {
  character: CharacterDto;
  snapshot: GameSnapshot;
  compact?: boolean;
}) {
  const state = character.resources.inspiration ?? { current: 0, maximum: 1 };
  const [open, setOpen] = useState(false),
    [current, setCurrent] = useState(String(state.current)),
    [maximum, setMaximum] = useState(String(state.maximum ?? 1)),
    [reason, setReason] = useState("");
  const revision = useRef(character.revision);
  const command = useInspirationCommand(
    `${snapshot.campaign.id}:${snapshot.me.id}:${character.id}:adjust`,
    character.id,
  );
  const editable = snapshot.me.role === "GM";
  return (
    <div
      className={
        compact
          ? "inspiration-resource inspiration-resource--compact"
          : "inspiration-resource"
      }
    >
      <span>
        Вдохновение:{" "}
        <strong>
          {state.current}/{state.maximum ?? 1}
        </strong>
      </span>{" "}
      {editable && (
        <Button
          onClick={() => {
            if (!command.retry) {
              setCurrent(String(state.current));
              setMaximum(String(state.maximum ?? 1));
              revision.current = character.revision;
              setReason("");
            }
            setOpen(true);
          }}
        >
          Изменить вдохновение
        </Button>
      )}
      <ArkenDialog
        open={open}
        title={`Вдохновение · ${character.name}`}
        footer={false}
        onClose={() => setOpen(false)}
      >
        <form
          onSubmit={(event) => {
            event.preventDefault();
            void command
              .send("adjust", {
                revision: revision.current,
                state: { current: Number(current), maximum: Number(maximum) },
                reason,
              })
              .then((ok) => {
                if (ok) setOpen(false);
              });
          }}
        >
          <fieldset disabled={command.busy || command.retry}>
            <label className="field">
              Текущее
              <input
                type="number"
                min={0}
                max={Number(maximum)}
                step={1}
                required
                value={current}
                onChange={(e) => setCurrent(e.target.value)}
              />
            </label>
            <label className="field">
              Максимум
              <input
                type="number"
                min={0}
                max={100000}
                step={1}
                required
                value={maximum}
                onChange={(e) => setMaximum(e.target.value)}
              />
            </label>
            <label className="field">
              Причина корректировки
              <input
                required
                maxLength={1000}
                value={reason}
                onChange={(e) => setReason(e.target.value)}
              />
            </label>
          </fieldset>
          {command.error && <p role="alert">{command.error}</p>}
          <Button type="submit" disabled={command.busy}>
            {command.retry
              ? "Повторить корректировку"
              : "Сохранить корректировку"}
          </Button>
        </form>
      </ArkenDialog>
    </div>
  );
}
function d20(message: ChatMessageDto) {
  const card = message.skillCard;
  const results =
    card?.execution === "EXECUTED"
      ? (card.rolls?.map((r) => r.result) ?? (card.result ? [card.result] : []))
      : [message.dice];
  return (
    results
      .slice()
      .reverse()
      .find((r) => r?.terms.some((t) => /d20(?:kh1|kl1)?$/.test(t.notation))) ??
    null
  );
}
export function InspirationRollAction({
  snapshot,
  message,
}: {
  snapshot: GameSnapshot;
  message: ChatMessageDto;
}) {
  const character = snapshot.characters.find(
    (c) => c.id === message.characterId,
  );
  const scope = `${snapshot.campaign.id}:${snapshot.me.id}:${message.characterId}:${message.id}`;
  const command = useInspirationCommand(scope, message.characterId ?? "");
  const [spent, setSpent] = useState(false);
  const result = d20(message);
  const link = message.dice?.inspiration;
  if (link)
    return (
      <p>
        Вдохновение · исходный результат «{link.sourceLabel}»:{" "}
        {link.sourceTotal} · новый итог {message.dice!.total} — окончательный.
        Исходный бросок: <code>{link.sourceMessageId}</code>
      </p>
    );
  if (
    !character ||
    message.kind !== "DICE" ||
    message.visibility !== "PUBLIC" ||
    !message.stream ||
    message.membershipId !== snapshot.me.id ||
    !result ||
    result.terms.length !== 1 ||
    !["1d20", "2d20kh1", "2d20kl1"].includes(result.terms[0]!.notation)
  )
    return null;
  if (
    snapshot.me.role !== "GM" &&
    character.ownerMembershipId !== snapshot.me.id &&
    !character.controllerMembershipIds.includes(snapshot.me.id)
  )
    return null;
  const later = snapshot.messages.some(
    (m) =>
      m.characterId === character.id &&
      m.visibility === "PUBLIC" &&
      m.stream &&
      m.kind === "DICE" &&
      m.sequence > message.sequence &&
      d20(m),
  );
  if (later && !command.retry) return null;
  const balance = character.resources.inspiration?.current ?? 0;
  return (
    <div>
      <Button
        disabled={command.busy || spent || (!command.retry && balance < 1)}
        onClick={() => {
          if (
            command.retry ||
            window.confirm(
              `Потратить 1 вдохновение? Исходный итог ${result.total}; новый результат будет окончательным.`,
            )
          )
            void command
              .send("reroll", { sourceMessageId: message.id })
              .then((ok) => {
                if (ok) setSpent(true);
              });
        }}
      >
        {spent
          ? "Вдохновение использовано"
          : command.retry
            ? "Повторить запрос переброса"
            : "Потратить вдохновение и перебросить"}
      </Button>
      {!spent && balance < 1 && <p>Нет вдохновения. Его выдаёт мастер.</p>}
      {command.error && <p role="alert">{command.error}</p>}
    </div>
  );
}

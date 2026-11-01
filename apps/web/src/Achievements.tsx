import { useEffect, useRef, useState } from "react";
import type {
  AchievementCommand,
  AchievementDto,
  AchievementFields,
  AchievementView,
  GameSnapshot,
} from "@arken/contracts";
import { api, ApiError } from "./api";
import { Button } from "./design-system/Button";
import { ArkenDialog } from "./ui/ArkenDialog";
import { AssetPicker } from "./ui/AssetPicker";
import { FormInput, FormTextArea } from "./ui/GravityFormControls";
import "./Achievements.css";

const emptyFields = (): AchievementFields => ({
  title: "",
  description: "",
  color: "#b8995c",
  iconAssetId: null,
  provenance: "",
});
const pendingCommands = new Map<string, AchievementCommand>();
const errorText: Record<string, string> = {
  REVISION_CONFLICT:
    "Данные изменились в другом окне. Список обновлён; заново откройте редактирование нужной карточки.",
  ALREADY_AWARDED:
    "Хотя бы у одного получателя уже есть это достижение. Повторная выдача не выполнена.",
  INVALID_ACHIEVEMENT_ICON: "Выберите разрешённое изображение этой кампании.",
  ACHIEVEMENT_ARCHIVED: "Достижение архивировано. Сначала восстановите его.",
  RELATED_RECORD_CHANGED:
    "Связанные данные изменились. Обновите список и повторите выбор.",
  INVALID_RECIPIENT: "Получатель больше недоступен в этой кампании.",
};
export function Achievements({ snapshot }: { snapshot: GameSnapshot }) {
  const scope = snapshot.campaign.id + ":" + snapshot.me.id,
    gm = snapshot.me.role === "GM";
  const [open, setOpen] = useState(false),
    [view, setView] = useState<AchievementView | null>(null),
    [error, setError] = useState("");
  const [busy, setBusy] = useState(false),
    [retry, setRetry] = useState(pendingCommands.has(scope));
  const [editing, setEditing] = useState<AchievementDto | null>(null),
    [showEditor, setShowEditor] = useState(false),
    [fields, setFields] = useState(emptyFields);
  const [recipients, setRecipients] = useState<string[]>([]),
    [publicAward, setPublicAward] = useState(false),
    [reason, setReason] = useState("");
  const [recipient, setRecipient] = useState(snapshot.me.id);
  const flight = useRef(false),
    alive = useRef(true),
    readId = useRef(0);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      readId.current++;
    };
  }, []);
  const refresh = async () => {
    const id = ++readId.current;
    try {
      const result = await api<AchievementView>("/api/achievements");
      if (alive.current && id === readId.current) setView(result);
    } catch {
      if (alive.current && id === readId.current)
        setError("Не удалось загрузить достижения.");
    }
  };
  useEffect(() => {
    if (open) void refresh();
  }, [open, snapshot]);
  const send = async (input: AchievementCommand) => {
    if (flight.current) return;
    flight.current = true;
    setBusy(true);
    setError("");
    readId.current++;
    const command = pendingCommands.get(scope) ?? input;
    pendingCommands.set(scope, command);
    try {
      const result = await api<AchievementView>("/api/achievements/commands", {
        method: "POST",
        body: JSON.stringify(command),
      });
      pendingCommands.delete(scope);
      if (alive.current) {
        readId.current++;
        setView(result);
        setRetry(false);
        setShowEditor(false);
        setRecipients([]);
        setPublicAward(false);
        setReason("");
      }
    } catch (e) {
      if (
        e instanceof ApiError &&
        e.status >= 400 &&
        e.status < 500 &&
        ![408, 429].includes(e.status)
      )
        pendingCommands.delete(scope);
      if (alive.current) {
        setRetry(pendingCommands.has(scope));
        setError(
          e instanceof ApiError
            ? (errorText[e.code] ?? "Команда отклонена сервером.")
            : "Ответ не получен. Повторите ту же команду.",
        );
        await refresh();
      }
    } finally {
      flight.current = false;
      if (alive.current) setBusy(false);
    }
  };
  const members = Array.from(
    new Map(
      (view?.awards ?? []).map((a) => [a.membershipId, a.displayName]),
    ).entries(),
  );
  if (!members.some(([id]) => id === snapshot.me.id))
    members.unshift([snapshot.me.id, snapshot.me.displayName]);
  const awards = (view?.awards ?? []).filter(
    (a) => a.membershipId === recipient,
  );
  const act = (
    command: Omit<
      Extract<AchievementCommand, { operation: "award-state" }>,
      "actionId"
    >,
  ) => void send({ ...command, actionId: crypto.randomUUID() });
  return (
    <>
      <Button onClick={() => setOpen(true)}>Достижения игроков</Button>
      <ArkenDialog
        open={open}
        title="Достижения игроков"
        footer={false}
        className="achievements"
        onClose={() => setOpen(false)}
      >
        <p>
          Награды относятся к участнику кампании, а не к отдельному персонажу.
          Личные видны только получателю и GM; публичные — участникам этой
          кампании.
        </p>
        {error && <p role="alert">{error}</p>}
        {retry && (
          <Button
            disabled={busy}
            onClick={() => {
              const command = pendingCommands.get(scope);
              if (command) void send(command);
            }}
          >
            Повторить последнюю команду
          </Button>
        )}
        <label className="field">
          Коллекция игрока
          <select
            value={recipient}
            onChange={(e) => setRecipient(e.target.value)}
          >
            {members.map(([id, name]) => (
              <option key={id} value={id}>
                {name}
              </option>
            ))}
          </select>
        </label>
        {!view ? (
          <p role="status">Загрузка…</p>
        ) : awards.length === 0 ? (
          <p>Нет доступных достижений.</p>
        ) : (
          <div className="achievement-grid">
            {awards.map((award) => {
              const d = view.definitions.find(
                (d) => d.id === award.achievementId,
              );
              if (!d) return null;
              return (
                <article
                  key={award.id}
                  className="achievement-card"
                  style={{ borderColor: d.color }}
                >
                  {d.iconAssetId && (
                    <img src={`/api/assets/${d.iconAssetId}/content`} alt="" />
                  )}
                  <h3>{d.title}</h3>
                  <p>{d.description}</p>
                  {d.provenance && (
                    <p className="muted">Происхождение: {d.provenance}</p>
                  )}
                  <p>
                    {award.revoked
                      ? "Отозвано"
                      : d.archived
                        ? "В архиве"
                        : award.public
                          ? "Публичное"
                          : "Личное"}
                  </p>
                  {gm && !award.revoked && (
                    <div>
                      <Button
                        disabled={busy || retry || !reason.trim()}
                        onClick={() =>
                          act({
                            operation: "award-state",
                            id: award.id,
                            revision: award.revision,
                            revoked: false,
                            public: !award.public,
                            reason,
                          })
                        }
                      >
                        {award.public
                          ? "Сделать личным"
                          : "Показать всей кампании"}
                      </Button>
                      <Button
                        disabled={busy || retry || !reason.trim()}
                        onClick={() => {
                          if (
                            window.confirm(
                              `Отозвать «${d.title}» у ${award.displayName}?`,
                            )
                          )
                            act({
                              operation: "award-state",
                              id: award.id,
                              revision: award.revision,
                              revoked: true,
                              public: award.public,
                              reason,
                            });
                        }}
                      >
                        Отозвать
                      </Button>
                    </div>
                  )}
                </article>
              );
            })}
          </div>
        )}
        {gm && (
          <section>
            <h3>Мастерская достижений</h3>
            <label className="field">
              Причина выдачи, отзыва или смены видимости (только GM)
              <FormInput
                value={reason}
                maxLength={1000}
                disabled={busy || retry}
                onChange={(e) => setReason(e.target.value)}
              />
            </label>
            <Button
              disabled={busy || retry}
              onClick={() => {
                if (
                  showEditor &&
                  !window.confirm("Заменить текущий несохранённый черновик?")
                )
                  return;
                setEditing(null);
                setFields(emptyFields());
                setShowEditor(true);
              }}
            >
              Создать достижение
            </Button>
            {showEditor && (
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  void send(
                    editing
                      ? {
                          operation: "edit",
                          id: editing.id,
                          revision: editing.revision,
                          fields,
                          actionId: crypto.randomUUID(),
                        }
                      : {
                          operation: "create",
                          fields,
                          actionId: crypto.randomUUID(),
                        },
                  );
                }}
              >
                <fieldset disabled={busy || retry}>
                  <legend>
                    {editing ? "Изменить достижение" : "Новое достижение"}
                  </legend>
                  <label className="field">
                    Название
                    <FormInput
                      required
                      maxLength={120}
                      value={fields.title}
                      onChange={(e) =>
                        setFields({ ...fields, title: e.target.value })
                      }
                    />
                  </label>
                  <label className="field">
                    Описание
                    <FormTextArea
                      maxLength={4000}
                      value={fields.description}
                      onChange={(e) =>
                        setFields({ ...fields, description: e.target.value })
                      }
                    />
                  </label>
                  <label className="field">
                    Цвет
                    <input
                      type="color"
                      value={fields.color}
                      onChange={(e) =>
                        setFields({ ...fields, color: e.target.value })
                      }
                    />
                  </label>
                  <label className="field">
                    Происхождение / автор изображения (видно получателям)
                    <FormInput
                      maxLength={1000}
                      value={fields.provenance}
                      onChange={(e) =>
                        setFields({ ...fields, provenance: e.target.value })
                      }
                    />
                  </label>
                  <p>
                    Выбирая иконку, вы разрешаете показывать её получателям
                    награды. Не выбирайте секретное изображение.
                  </p>
                  <AssetPicker
                    assets={snapshot.assets.filter(
                      (a) =>
                        [
                          "image/png",
                          "image/jpeg",
                          "image/webp",
                          "image/gif",
                        ].includes(a.mimeType) && a.kind !== "DICE_FRAME",
                    )}
                    value={fields.iconAssetId}
                    onChange={(iconAssetId) =>
                      setFields({ ...fields, iconAssetId })
                    }
                    aria-label="Иконка достижения"
                  />
                  <Button type="submit">Сохранить определение</Button>
                  <Button onClick={() => setShowEditor(false)}>
                    Отменить редактирование
                  </Button>
                </fieldset>
              </form>
            )}
            <fieldset disabled={busy || retry}>
              <legend>Получатели новой награды</legend>
              {snapshot.members
                .filter((m) => m.role === "PLAYER")
                .map((m) => (
                  <label key={m.id}>
                    <input
                      type="checkbox"
                      checked={recipients.includes(m.id)}
                      onChange={(e) =>
                        setRecipients(
                          e.target.checked
                            ? [...recipients, m.id]
                            : recipients.filter((id) => id !== m.id),
                        )
                      }
                    />
                    {m.displayName}
                  </label>
                ))}
              <label>
                <input
                  type="checkbox"
                  checked={publicAward}
                  onChange={(e) => setPublicAward(e.target.checked)}
                />
                Публично для всей кампании
              </label>
            </fieldset>
            <div className="achievement-grid">
              {view?.definitions.map((d) => (
                <article key={d.id} className="achievement-card">
                  <h4>
                    {d.title}
                    {d.archived ? " · архив" : ""}
                  </h4>
                  <Button
                    disabled={busy || retry}
                    onClick={() => {
                      if (
                        showEditor &&
                        !window.confirm(
                          "Заменить текущий несохранённый черновик?",
                        )
                      )
                        return;
                      setEditing(d);
                      setFields({
                        title: d.title,
                        description: d.description,
                        color: d.color,
                        iconAssetId: d.iconAssetId,
                        provenance: d.provenance,
                      });
                      setShowEditor(true);
                    }}
                  >
                    Редактировать
                  </Button>
                  <Button
                    disabled={busy || retry}
                    onClick={() => {
                      if (
                        window.confirm(
                          d.archived
                            ? "Восстановить достижение и видимость действующих наград?"
                            : "Архивировать достижение? Оно исчезнет из коллекций игроков до восстановления.",
                        )
                      )
                        void send({
                          operation: "archive",
                          id: d.id,
                          revision: d.revision,
                          archived: !d.archived,
                          actionId: crypto.randomUUID(),
                        });
                    }}
                  >
                    {d.archived ? "Восстановить" : "Архивировать"}
                  </Button>
                  <Button
                    disabled={
                      busy ||
                      retry ||
                      d.archived ||
                      !recipients.length ||
                      !reason.trim()
                    }
                    onClick={() =>
                      void send({
                        operation: "award",
                        id: d.id,
                        revision: d.revision,
                        membershipIds: recipients,
                        public: publicAward,
                        reason,
                        actionId: crypto.randomUUID(),
                      })
                    }
                  >
                    Выдать выбранным игрокам
                  </Button>
                </article>
              ))}
            </div>
            <details>
              <summary>История операций · только GM (последние 100)</summary>
              {view?.history.map((h) => (
                <details key={h.id}>
                  <summary>
                    {new Date(h.createdAt).toLocaleString()} · {h.actor} ·{" "}
                    {h.operation} · {h.reason}
                  </summary>
                  <pre>{JSON.stringify(h.details, null, 2)}</pre>
                </details>
              ))}
            </details>
          </section>
        )}
      </ArkenDialog>
    </>
  );
}

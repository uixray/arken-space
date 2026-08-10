import { useEffect, useMemo, useState, type FormEvent } from "react";
import type {
  GameSnapshot,
  PlayerRequestDto,
  PlayerRequestTransition,
} from "@arken/contracts";
import { ArkenDialog } from "./ui/ArkenDialog";
import {
  canCancelRequest,
  canEditRequest,
  createRequestPayload,
  requestCharacters,
  requestLabels,
  visiblePlayerRequests,
  type PlayerRequestFilters,
} from "./player-request-ui";
import "./PlayerRequestsWorkspace.css";

type Draft = {
  title: string;
  body: string;
  horizon: "NOW" | "BEFORE_BREAK" | "NEXT_SESSION";
  audience: "PUBLIC" | "GM_ONLY";
  characterId: string;
};
const emptyDraft = (): Draft => ({
  title: "",
  body: "",
  horizon: "NOW",
  audience: "PUBLIC",
  characterId: "",
});

export function PlayerRequestsWorkspace({
  open,
  snapshot,
  onClose,
  onCreate,
  onUpdate,
  onAction,
}: {
  open: boolean;
  snapshot: GameSnapshot;
  onClose: () => void;
  onCreate: (input: ReturnType<typeof createRequestPayload>) => Promise<void>;
  onUpdate: (
    request: PlayerRequestDto,
    input: { title: string; body: string },
  ) => Promise<void>;
  onAction: (
    request: PlayerRequestDto,
    action: PlayerRequestTransition,
    resolutionNote?: string,
  ) => Promise<void>;
}) {
  const [draft, setDraft] = useState<Draft>(emptyDraft);
  const [editing, setEditing] = useState<PlayerRequestDto | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [filters, setFilters] = useState<PlayerRequestFilters>({
    state: "OPEN",
    horizon: "ALL",
    audience: "ALL",
  });
  const isGm = snapshot.me.role === "GM";
  const requests = visiblePlayerRequests(
    snapshot.playerRequests ?? [],
    snapshot.me.id,
    snapshot.me.role,
    filters,
  );
  const characters = useMemo(
    () =>
      requestCharacters(
        snapshot.characters,
        snapshot.me.id,
        snapshot.me.characterId,
      ),
    [snapshot.characters, snapshot.me.id, snapshot.me.characterId],
  );

  useEffect(() => {
    setDraft(emptyDraft());
    setEditing(null);
    setBusy(null);
    setError("");
  }, [open, snapshot.me.id, snapshot.campaign.id]);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (busy) return;
    const payload = createRequestPayload(draft);
    if (!payload.title || !payload.body) {
      setError("Заполните название и описание.");
      return;
    }
    setBusy("form");
    setError("");
    try {
      if (editing)
        await onUpdate(editing, { title: payload.title, body: payload.body });
      else await onCreate(payload);
      setDraft(emptyDraft());
      setEditing(null);
    } catch {
      setError(
        "Не удалось сохранить заявку. Данные обновлены — проверьте состояние и повторите действие.",
      );
    } finally {
      setBusy(null);
    }
  };

  const act = async (
    request: PlayerRequestDto,
    action: PlayerRequestTransition,
  ) => {
    if (busy) return;
    let note: string | undefined;
    if (action === "RESOLVE" || action === "DECLINE")
      note = window.prompt("Комментарий (необязательно)")?.trim() || undefined;
    setBusy(request.id);
    setError("");
    try {
      await onAction(request, action, note);
    } catch {
      setError(
        "Не удалось изменить заявку. Данные обновлены — проверьте состояние и повторите действие.",
      );
    } finally {
      setBusy(null);
    }
  };

  return (
    <ArkenDialog
      open={open}
      footer={false}
      variant="workspace"
      className="player-requests-workspace"
      title={isGm ? "Открытые заявки" : "Мои заявки"}
      onClose={onClose}
    >
      <div className="player-requests">
        {!isGm && (
          <form className="player-requests__form" onSubmit={submit}>
            <h3>{editing ? "Редактировать заявку" : "Новая заявка"}</h3>
            <label>
              Название
              <input
                maxLength={120}
                value={draft.title}
                onChange={(e) => setDraft({ ...draft, title: e.target.value })}
              />
            </label>
            <label>
              Описание
              <textarea
                maxLength={4000}
                rows={5}
                value={draft.body}
                onChange={(e) => setDraft({ ...draft, body: e.target.value })}
              />
            </label>
            {!editing && (
              <div className="player-requests__grid">
                <label>
                  Когда
                  <select
                    value={draft.horizon}
                    onChange={(e) =>
                      setDraft({
                        ...draft,
                        horizon: e.target.value as Draft["horizon"],
                      })
                    }
                  >
                    {Object.entries(requestLabels.horizon).map(
                      ([value, label]) => (
                        <option key={value} value={value}>
                          {label}
                        </option>
                      ),
                    )}
                  </select>
                </label>
                <label>
                  Кто увидит
                  <select
                    value={draft.audience}
                    onChange={(e) =>
                      setDraft({
                        ...draft,
                        audience: e.target.value as Draft["audience"],
                      })
                    }
                  >
                    {Object.entries(requestLabels.audience).map(
                      ([value, label]) => (
                        <option key={value} value={value}>
                          {label}
                        </option>
                      ),
                    )}
                  </select>
                </label>
                <label>
                  Персонаж (необязательно)
                  <select
                    value={draft.characterId}
                    onChange={(e) =>
                      setDraft({ ...draft, characterId: e.target.value })
                    }
                  >
                    <option value="">Без персонажа</option>
                    {characters.map((character) => (
                      <option key={character.id} value={character.id}>
                        {character.name}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
            )}
            <div className="player-requests__actions">
              <button disabled={!!busy} type="submit">
                {busy === "form"
                  ? "Сохраняем…"
                  : editing
                    ? "Сохранить"
                    : "Отправить заявку"}
              </button>
              {editing && (
                <button
                  type="button"
                  disabled={!!busy}
                  onClick={() => {
                    setEditing(null);
                    setDraft(emptyDraft());
                  }}
                >
                  Отмена
                </button>
              )}
            </div>
          </form>
        )}
        <div className="player-requests__filters" aria-label="Фильтры заявок">
          <select
            aria-label="Состояние"
            value={filters.state}
            onChange={(e) =>
              setFilters({
                ...filters,
                state: e.target.value as PlayerRequestFilters["state"],
              })
            }
          >
            <option value="OPEN">Открытые</option>
            <option value="CLOSED">Закрытые</option>
            <option value="ALL">Все состояния</option>
          </select>
          <select
            aria-label="Срок"
            value={filters.horizon}
            onChange={(e) =>
              setFilters({
                ...filters,
                horizon: e.target.value as PlayerRequestFilters["horizon"],
              })
            }
          >
            <option value="ALL">Любой срок</option>
            {Object.entries(requestLabels.horizon).map(([v, l]) => (
              <option key={v} value={v}>
                {l}
              </option>
            ))}
          </select>
          <select
            aria-label="Аудитория"
            value={filters.audience}
            onChange={(e) =>
              setFilters({
                ...filters,
                audience: e.target.value as PlayerRequestFilters["audience"],
              })
            }
          >
            <option value="ALL">Любая аудитория</option>
            {Object.entries(requestLabels.audience).map(([v, l]) => (
              <option key={v} value={v}>
                {l}
              </option>
            ))}
          </select>
        </div>
        {error && (
          <p className="player-requests__error" role="alert">
            {error}
          </p>
        )}
        <div className="player-requests__list">
          {requests.length === 0 ? (
            <p>Заявок по выбранным фильтрам нет.</p>
          ) : (
            requests.map((request) => (
              <article key={request.id} className="player-request-card">
                <header>
                  <h3>{request.title}</h3>
                  <span>{requestLabels.status[request.status]}</span>
                </header>
                <p>{request.body}</p>
                <dl>
                  <div>
                    <dt>Срок</dt>
                    <dd>{requestLabels.horizon[request.horizon]}</dd>
                  </div>
                  <div>
                    <dt>Аудитория</dt>
                    <dd>{requestLabels.audience[request.audience]}</dd>
                  </div>
                  <div>
                    <dt>Автор</dt>
                    <dd>{request.authorDisplayName}</dd>
                  </div>
                  {request.characterName && (
                    <div>
                      <dt>Персонаж</dt>
                      <dd>{request.characterName}</dd>
                    </div>
                  )}
                </dl>
                {request.resolutionNote && (
                  <p className="player-request-card__resolution">
                    <strong>Комментарий:</strong> {request.resolutionNote}
                  </p>
                )}
                <div className="player-requests__actions">
                  {isGm && request.status === "SUBMITTED" && (
                    <button
                      disabled={!!busy}
                      onClick={() => void act(request, "ACKNOWLEDGE")}
                    >
                      Принять
                    </button>
                  )}
                  {isGm &&
                    (request.status === "SUBMITTED" ||
                      request.status === "ACKNOWLEDGED") && (
                      <>
                        <button
                          disabled={!!busy}
                          onClick={() => void act(request, "RESOLVE")}
                        >
                          Решить
                        </button>
                        <button
                          disabled={!!busy}
                          onClick={() => void act(request, "DECLINE")}
                        >
                          Отклонить
                        </button>
                      </>
                    )}
                  {!isGm && canEditRequest(request, snapshot.me.id) && (
                    <button
                      disabled={!!busy}
                      onClick={() => {
                        setEditing(request);
                        setDraft({
                          ...emptyDraft(),
                          title: request.title,
                          body: request.body,
                        });
                      }}
                    >
                      Редактировать
                    </button>
                  )}
                  {!isGm && canCancelRequest(request, snapshot.me.id) && (
                    <button
                      disabled={!!busy}
                      onClick={() => void act(request, "CANCEL")}
                    >
                      Отменить заявку
                    </button>
                  )}
                </div>
              </article>
            ))
          )}
        </div>
        {!isGm && (
          <p className="player-requests__note">
            Можно выбрать активного, принадлежащего вам или переданного вам в
            управление персонажа.
          </p>
        )}
      </div>
    </ArkenDialog>
  );
}

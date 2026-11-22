import { useState } from "react";
import { starterStatLayout } from "@arken/system";
import { api } from "./api";

type Value = string | number | boolean | null;
type Draft = {
  id: string;
  target: { campaignId: string; kind: string; id: string };
  expectedRevision: number;
  before: Record<string, Value>;
  after: Record<string, Value>;
  restores?: string;
  creates?: true;
  fieldLabels?: Record<string, string>;
  targetName?: string;
};
type Change = Draft & { committedRevision: number; confirmedAt: string };

const labels: Record<string, string> = {
  name: "Название",
  title: "Заголовок",
  description: "Описание",
  body: "Текст",
  steps: "Шаги воспроизведения",
  expected: "Ожидаемое поведение",
  actual: "Фактическое поведение",
};
const statLabels = Object.fromEntries(
  starterStatLayout.flatMap(({ rows }) =>
    rows.map(({ key, label }) => [key, label]),
  ),
);

function Changes({ draft }: { draft: Draft }) {
  return (
    <dl>
      {Object.entries(draft.after).map(([key, value]) => (
        <div
          key={key}
          style={{ display: "flex", flexWrap: "wrap", gap: "0.5rem" }}
        >
          <dt>
            {draft.fieldLabels?.[key] ??
              (draft.target.kind === "character-stat"
                ? statLabels[key]
                : labels[key]) ??
              key}
          </dt>
          <dd
            style={{
              margin: 0,
              whiteSpace: "pre-wrap",
              overflowWrap: "anywhere",
            }}
          >
            {!draft.creates && (
              <span>{String(draft.before[key] ?? "—")} → </span>
            )}
            <span>{String(value ?? "—")}</span>
          </dd>
        </div>
      ))}
    </dl>
  );
}

export function EditorPilot({
  campaignId,
  draftId,
}: {
  campaignId: string;
  draftId: string;
}) {
  const [draft, setDraft] = useState<Draft>();
  const [history, setHistory] = useState<Change[]>([]);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("");
  const write = (path: string, body?: string, confirm = false) =>
    api<Draft>(path, {
      method: "POST",
      body,
      headers: {
        "x-arken-campaign-id": campaignId,
        ...(confirm ? { "x-arken-editor-confirm": "explicit" } : {}),
      },
    });

  async function run(task: () => Promise<void>) {
    setBusy(true);
    setStatus("");
    try {
      await task();
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Ошибка запроса");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section aria-label="Редактор Bionic">
      <h2>Редактор Bionic · Бал Амбериона</h2>
      <button
        disabled={busy}
        onClick={() =>
          void run(async () => {
            setDraft(undefined);
            setDraft(
              await api<Draft>(
                `/api/editor/changes/${encodeURIComponent(draftId)}`,
              ),
            );
          })
        }
      >
        Предпросмотр
      </button>
      {draft && (
        <section aria-label="Предпросмотр правки">
          {draft.creates ? (
            <p>Новая запись</p>
          ) : (
            draft.targetName && <p>{draft.targetName}</p>
          )}
          <Changes draft={draft} />
          <button
            disabled={busy}
            onClick={() =>
              void run(async () => {
                await write(
                  `/api/editor/changes/${draft.id}/confirm`,
                  undefined,
                  true,
                );
                setDraft(undefined);
                setStatus(
                  draft.restores
                    ? "Версия восстановлена"
                    : draft.creates
                      ? draft.target.kind === "bug-report"
                        ? `Баг-репорт отправлен · ${draft.target.id}`
                        : "Запись создана"
                      : "Правка сохранена",
                );
                const query = new URLSearchParams({
                  kind: draft.target.kind,
                  id: draft.target.id,
                });
                setHistory(await api<Change[]>(`/api/editor/history?${query}`));
              })
            }
          >
            {draft.restores
              ? "Подтвердить восстановление"
              : draft.creates
                ? draft.target.kind === "bug-report"
                  ? "Отправить баг-репорт"
                  : "Подтвердить создание"
                : "Подтвердить правку"}
          </button>
        </section>
      )}
      {history.length > 0 && (
        <ul aria-label="История правок">
          {history.map((change) => (
            <li key={change.id}>
              Версия {change.committedRevision} ·{" "}
              {new Date(change.confirmedAt).toLocaleString()}
              <Changes draft={change} />
              {!change.creates && (
                <button
                  disabled={busy}
                  onClick={() =>
                    void run(async () => {
                      setDraft(undefined);
                      setDraft(
                        await write(
                          `/api/editor/changes/${change.id}/restore-preview`,
                        ),
                      );
                    })
                  }
                >
                  Предпросмотр отката
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
      <p role="status">{status}</p>
    </section>
  );
}

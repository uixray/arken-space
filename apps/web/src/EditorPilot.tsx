import { useState } from "react";
import { api } from "./api";

type Value = string | number | boolean | null;
type Draft = {
  id: string;
  target: { campaignId: string; kind: string; id: string };
  expectedRevision: number;
  before: Record<string, Value>;
  after: Record<string, Value>;
  restores?: string;
};
type Change = Draft & { committedRevision: number; confirmedAt: string };

function Changes({ draft }: { draft: Draft }) {
  return (
    <dl>
      {Object.entries(draft.after).map(([key, value]) => (
        <div key={key}>
          <dt>{key}</dt>
          <dd>
            {JSON.stringify(draft.before[key])} → {JSON.stringify(value)}
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
    <details open>
      <summary>Редактор Bionic · Бал Амбериона</summary>
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
          <p>
            {draft.target.kind} · {draft.target.id} · версия{" "}
            {draft.expectedRevision}
          </p>
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
                  draft.restores ? "Версия восстановлена" : "Правка сохранена",
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
            </li>
          ))}
        </ul>
      )}
      <p role="status">{status}</p>
    </details>
  );
}

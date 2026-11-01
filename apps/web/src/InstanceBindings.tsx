import { useEffect, useRef, useState } from "react";
import type { InstanceBindingView } from "@arken/contracts";
import { api, ApiError } from "./api";
import { Button } from "./design-system/Button";
import { FormSelect } from "./ui/GravityFormControls";

const messages: Record<string, string> = {
  CONTAINER_CYCLE:
    "Предмет нельзя поместить внутрь самого себя или своего содержимого.",
  REVISION_CONFLICT:
    "Связи изменились в другом окне. Выбор сохранён локально; загрузите актуальные данные перед повторной правкой.",
  RELATED_RECORD_CHANGED:
    "Токен или контейнер изменился. Обновите связи и выберите доступный объект.",
  TOKEN_NOT_FOUND: "Выбранный токен больше недоступен.",
  INSTANCE_NOT_FOUND: "Экземпляр больше недоступен.",
};
export function InstanceBindings({ instanceId }: { instanceId: string }) {
  const [view, setView] = useState<InstanceBindingView | null>(null),
    [token, setToken] = useState(""),
    [container, setContainer] = useState("");
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [retry, setRetry] = useState(false);
  const command = useRef<Record<string, unknown> | null>(null),
    flight = useRef(false),
    alive = useRef(true);
  const url = `/api/world-content-instances/${instanceId}/bindings`;
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  const refresh = async () => {
    if (flight.current) return;
    flight.current = true;
    setBusy(true);
    setError("");
    try {
      const value = await api<InstanceBindingView>(url);
      if (alive.current) {
        setView(value);
        setToken(value.tokenDefinitionId ?? "");
        setContainer(value.containerInstanceId ?? "");
      }
    } catch {
      if (alive.current) setError("Не удалось загрузить связи экземпляра.");
    } finally {
      flight.current = false;
      if (alive.current) setBusy(false);
    }
  };
  useEffect(() => {
    void refresh();
  }, []);
  const save = async () => {
    if (!view || flight.current) return;
    const body = command.current ?? {
      actionId: crypto.randomUUID(),
      revision: view.revision,
      tokenDefinitionId: token || null,
      containerInstanceId: container || null,
    };
    command.current = body;
    flight.current = true;
    setBusy(true);
    setError("");
    try {
      const saved = await api<
        Pick<
          InstanceBindingView,
          "revision" | "tokenDefinitionId" | "containerInstanceId"
        >
      >(url, { method: "PUT", body: JSON.stringify(body) });
      command.current = null;
      if (alive.current) {
        setRetry(false);
        setToken(saved.tokenDefinitionId ?? "");
        setContainer(saved.containerInstanceId ?? "");
        setView({
          ...view,
          ...saved,
        });
      }
    } catch (reason) {
      if (
        reason instanceof ApiError &&
        reason.status >= 400 &&
        reason.status < 500 &&
        ![408, 429].includes(reason.status)
      )
        command.current = null;
      if (alive.current) {
        setRetry(Boolean(command.current));
        setError(
          reason instanceof ApiError
            ? (messages[reason.code] ?? "Связь не сохранена. Обновите данные.")
            : "Ответ не получен. Повторите сохранение той же команды.",
        );
      }
    } finally {
      flight.current = false;
      if (alive.current) setBusy(false);
    }
  };
  const dirty = Boolean(
    view &&
    (token !== (view.tokenDefinitionId ?? "") ||
      container !== (view.containerInstanceId ?? "")),
  );
  return (
    <section className="subsection">
      <h4>Связи экземпляра · только GM</h4>
      <p className="muted">
        Сохраняются отдельно. Не меняют канон, владельца и права токена; не
        создают токен на карте.
      </p>
      {view && (
        <fieldset disabled={busy || retry}>
          {["PERSON", "MONSTER"].includes(view.type) && (
            <label className="field">
              Существующий токен
              <FormSelect
                value={token}
                onChange={(e) => setToken(e.target.value)}
              >
                <option value="">Без токена</option>
                {view.tokens.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name} · {t.id.slice(0, 8)}
                  </option>
                ))}
              </FormSelect>
            </label>
          )}
          {view.type === "ITEM" && (
            <label className="field">
              Контейнер — другой экземпляр предмета
              <FormSelect
                value={container}
                onChange={(e) => setContainer(e.target.value)}
              >
                <option value="">Без контейнера</option>
                {view.containers.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name} · {c.id.slice(0, 8)}
                  </option>
                ))}
              </FormSelect>
            </label>
          )}
        </fieldset>
      )}
      {error && <p role="alert">{error}</p>}
      <Button
        disabled={busy || !view || (!dirty && !retry)}
        onClick={() => void save()}
      >
        {retry ? "Повторить сохранение связей" : "Сохранить связи"}
      </Button>
      <Button
        disabled={busy || retry}
        onClick={() => {
          if (
            !dirty ||
            window.confirm(
              "Заменить несохранённый выбор связей серверной версией?",
            )
          )
            void refresh();
        }}
      >
        Обновить связи
      </Button>
    </section>
  );
}

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type {
  CharacterInventoryItemDto,
  CharacterInventoryPageDto,
} from "@arken/contracts";
import { api, ApiError, formatApiError } from "../api";

const emptyPage = (): CharacterInventoryPageDto => ({
  items: [],
  nextCursor: null,
});
const messages: Record<string, string> = {
  INVENTORY_DETACH_CONTAINER_FIRST:
    "Сначала уберите связь предмета с контейнером.",
  INVENTORY_CHARACTER_UNAVAILABLE: "Персонаж недоступен для выдачи предмета.",
  WORLD_CONTENT_INSTANCE_CONFLICT:
    "Предмет уже изменён. Обновите список и повторите действие.",
  ACTION_ID_REUSED:
    "Запрос уже использован с другими данными. Обновите список.",
  INVENTORY_POSITIVE_QUANTITY_REQUIRED:
    "Укажите положительное количество в редакторе экземпляра.",
};

/** Parent keys this component by campaign/member/character to isolate pending UI. */
export function CharacterInventory({
  characterId,
  gm,
  active,
}: {
  characterId: string;
  gm: boolean;
  active: boolean;
}) {
  const [owned, setOwned] = useState(emptyPage);
  const [available, setAvailable] = useState(emptyPage);
  const [selected, setSelected] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const section = useRef<HTMLElement | null>(null);
  const loadedCounts = useRef({ owned: 0, available: 0 });
  useLayoutEffect(() => {
    loadedCounts.current = {
      owned: owned.items.length,
      available: available.items.length,
    };
  }, [owned.items.length, available.items.length]);
  const pending = useRef(false);
  const mounted = useRef(false);
  const generation = useRef(0);
  const abort = useRef<AbortController | null>(null);

  const page = (candidates: boolean, cursor?: string | null) => {
    const query = new URLSearchParams();
    if (candidates) query.set("available", "true");
    if (cursor) query.set("cursor", cursor);
    return api<CharacterInventoryPageDto>(
      `/api/characters/${characterId}/inventory?${query}`,
      { signal: abort.current?.signal },
    );
  };
  const explain = (reason: unknown) =>
    reason instanceof ApiError && messages[reason.code]
      ? messages[reason.code]!
      : formatApiError(reason, "Не удалось загрузить инвентарь");
  const reloadPages = async (candidates: boolean, loaded: number) => {
    let result = await page(candidates);
    const items = [...result.items];
    // Revalidate exactly the previously loaded depth, not the entire inventory.
    const pages = Math.max(1, Math.ceil(loaded / 100));
    for (let index = 1; index < pages && result.nextCursor; index++) {
      result = await page(candidates, result.nextCursor);
      items.push(...result.items);
    }
    return { items, nextCursor: result.nextCursor };
  };
  const refresh = async () => {
    const epoch = generation.current;
    const [items, candidates] = await Promise.all([
      reloadPages(false, loadedCounts.current.owned),
      gm && active
        ? reloadPages(true, loadedCounts.current.available)
        : Promise.resolve(emptyPage()),
    ]);
    if (!mounted.current || epoch !== generation.current) return;
    setOwned(items);
    setAvailable(candidates);
    setSelected((current) =>
      candidates.items.some((item) => item.id === current) ? current : "",
    );
  };
  const run = async (action: () => Promise<void>) => {
    if (pending.current) return;
    const epoch = generation.current;
    pending.current = true;
    setBusy(true);
    setError("");
    try {
      await action();
    } catch (reason) {
      if (
        mounted.current &&
        epoch === generation.current &&
        !(reason instanceof DOMException && reason.name === "AbortError")
      ) {
        setOwned(emptyPage());
        setAvailable(emptyPage());
        setSelected("");
        setError(explain(reason));
      }
    } finally {
      if (epoch === generation.current) {
        pending.current = false;
        if (mounted.current) setBusy(false);
      }
    }
  };
  useEffect(() => {
    generation.current++;
    pending.current = false;
    mounted.current = true;
    abort.current = new AbortController();
    const visible = () =>
      document.visibilityState === "visible" &&
      Boolean(
        section.current &&
        !section.current.closest("[hidden], [inert], [aria-hidden='true']"),
      );
    const refreshVisible = () => {
      if (visible()) void run(refresh);
    };
    // Fixed cadence does not disclose hidden-edit timing through notifications.
    refreshVisible();
    const timer = window.setInterval(refreshVisible, 15_000);
    window.addEventListener("focus", refreshVisible);
    document.addEventListener("visibilitychange", refreshVisible);
    const observer = new MutationObserver(refreshVisible);
    for (
      let element: HTMLElement | null = section.current;
      element;
      element = element.parentElement
    )
      observer.observe(element, {
        attributes: true,
        attributeFilter: ["hidden", "inert", "aria-hidden"],
      });
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("focus", refreshVisible);
      document.removeEventListener("visibilitychange", refreshVisible);
      observer.disconnect();
      generation.current++;
      mounted.current = false;
      abort.current?.abort();
    };
    // Identity/role/lifecycle changes remount via the parent key.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const more = (candidates: boolean) =>
    run(async () => {
      const previous = candidates ? available : owned;
      if (!previous.nextCursor) return;
      const result = await page(candidates, previous.nextCursor);
      if (!mounted.current) return;
      const byId = new Map(
        [...previous.items, ...result.items].map((item) => [item.id, item]),
      );
      (candidates ? setAvailable : setOwned)({
        items: [...byId.values()],
        nextCursor: result.nextCursor,
      });
    });
  const assign = (item: CharacterInventoryItemDto, target: string | null) =>
    run(async () => {
      await api(`/api/world-content-instances/${item.id}`, {
        method: "PATCH",
        signal: abort.current?.signal,
        body: JSON.stringify({
          actionId: crypto.randomUUID(),
          revision: item.revision,
          inventoryCharacterId: target,
        }),
      });
      await refresh();
    });
  return (
    <section ref={section} aria-label="Предметы персонажа" aria-busy={busy}>
      <h4>Предметы персонажа</h4>
      <button type="button" disabled={busy} onClick={() => void run(refresh)}>
        Обновить предметы
      </button>
      {busy && <p role="status">Загружаем…</p>}
      {error && <p role="alert">{error}</p>}
      {!busy && !error && !owned.items.length && (
        <p className="muted">Нет доступных предметов.</p>
      )}
      <ul>
        {owned.items.map((item) => (
          <li key={item.id}>
            <span>
              {item.name} — {item.quantity ?? "?"}
              {item.condition ? ` · ${item.condition}` : ""}
            </span>{" "}
            {gm && (
              <button
                type="button"
                disabled={busy}
                onClick={() => void assign(item, null)}
                aria-label={`Снять с персонажа: ${item.name}`}
              >
                Снять
              </button>
            )}
          </li>
        ))}
      </ul>
      {owned.nextCursor && (
        <button type="button" disabled={busy} onClick={() => void more(false)}>
          Ещё предметы
        </button>
      )}
      {gm && active && (
        <div>
          <label>
            Выдать существующий экземпляр целиком
            <select
              value={selected}
              disabled={busy}
              onChange={(event) => setSelected(event.target.value)}
            >
              <option value="">Выберите предмет</option>
              {available.items.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name} × {item.quantity}
                </option>
              ))}
            </select>
          </label>
          <button
            type="button"
            disabled={busy || !selected}
            onClick={() => {
              const item = available.items.find(
                (entry) => entry.id === selected,
              );
              if (item) void assign(item, characterId);
            }}
          >
            Выдать
          </button>
          {available.nextCursor && (
            <button
              type="button"
              disabled={busy}
              onClick={() => void more(true)}
            >
              Ещё доступные экземпляры
            </button>
          )}
          <p className="muted">
            Количество и состояние меняются в редакторе экземпляра. Выдача не
            раскрывает скрытый канон: игрок увидит только разрешённый и
            обнаруженный предмет.
          </p>
        </div>
      )}
    </section>
  );
}

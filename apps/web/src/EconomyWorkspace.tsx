import { useEffect, useMemo, useRef, useState } from "react";
import type {
  EconomyHistoryDto,
  EconomyQuoteDto,
  EconomyReceiptDto,
  ShopCatalogDto,
} from "@arken/contracts";
import { ApiError, formatApiError } from "./api";
import { ArkenDialog } from "./ui/ArkenDialog";
import { EconomyManager } from "./EconomyManager";
import { copperLabel, economyApi, economyRequest } from "./economy-client";
import "./economy.css";

type PendingPurchase = { actionId: string; quoteId: string };
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function readPending(key: string): PendingPurchase | null {
  const raw = window.localStorage.getItem(key);
  if (!raw) return null;
  const value = JSON.parse(raw) as PendingPurchase;
  if (!uuid.test(value.actionId) || !uuid.test(value.quoteId))
    throw new Error(
      "Повреждена сохранённая квитанция запроса. Не создавайте новую покупку до проверки истории.",
    );
  return { actionId: value.actionId, quoteId: value.quoteId };
}

/** Parent keys by campaign/member: never carry a pending command across accounts. */
export function EconomyWorkspace({
  campaignId,
  membershipId,
  gm,
  characters,
  onClose,
}: {
  campaignId: string;
  membershipId: string;
  gm: boolean;
  characters: Array<{ id: string; name: string }>;
  onClose: () => void;
}) {
  const key = `arken.shop.pending.v1.${campaignId}.${membershipId}`;
  const context = useMemo(
    () => ({ campaignId, membershipId }),
    [campaignId, membershipId],
  );
  const [catalog, setCatalog] = useState<ShopCatalogDto | null>(null);
  const [characterId, setCharacterId] = useState(characters[0]?.id ?? "");
  const [offerId, setOfferId] = useState("");
  const [quantity, setQuantity] = useState("1");
  const [quote, setQuote] = useState<EconomyQuoteDto | null>(null);
  const [receipt, setReceipt] = useState<EconomyReceiptDto | null>(null);
  const [history, setHistory] = useState<EconomyHistoryDto>({
    items: [],
    nextCursor: null,
  });
  const [pending, setPending] = useState<PendingPurchase | null>(null);
  const [storageBlocked, setStorageBlocked] = useState(false);
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [manager, setManager] = useState(false);
  const mounted = useRef(false);
  const inFlight = useRef(false);
  const uncertain = useRef<PendingPurchase | null>(null);
  const generation = useRef(0);
  const [now, setNow] = useState(0);

  useEffect(() => {
    mounted.current = true;
    try {
      const saved = readPending(key);
      uncertain.current = saved;
      setPending(saved);
    } catch (e) {
      setStorageBlocked(true);
      setError(formatApiError(e));
    }
    setReady(true);
    const abort = new AbortController();
    void Promise.all([
      economyApi<ShopCatalogDto>(context, "/api/economy", {
        signal: abort.signal,
      }),
      economyApi<EconomyHistoryDto>(context, "/api/economy/history", {
        signal: abort.signal,
      }),
    ])
      .then(([c, h]) => {
        if (!abort.signal.aborted && mounted.current) {
          setCatalog(c);
          setHistory(h);
        }
      })
      .catch((e) => {
        if (!abort.signal.aborted && mounted.current)
          setError(formatApiError(e));
      });
    setNow(Date.now());
    const tick = window.setInterval(() => setNow(Date.now()), 1000);
    return () => {
      mounted.current = false;
      generation.current++;
      abort.abort();
      window.clearInterval(tick);
    };
  }, [context, key]);

  const run = async (action: () => Promise<void>) => {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    setError("");
    try {
      await action();
    } catch (e) {
      if (mounted.current)
        setError(formatApiError(e, "Магазин временно недоступен"));
    } finally {
      inFlight.current = false;
      if (mounted.current) setBusy(false);
    }
  };
  const refresh = async () => {
    const [c, h] = await Promise.all([
      economyApi<ShopCatalogDto>(context, "/api/economy"),
      economyApi<EconomyHistoryDto>(context, "/api/economy/history"),
    ]);
    if (mounted.current) {
      generation.current++;
      setQuote(null);
      setCatalog(c);
      setHistory(h);
    }
  };
  const invalidate = () => {
    generation.current++;
    setQuote(null);
    setReceipt(null);
  };
  const getQuote = () =>
    run(async () => {
      if (uncertain.current || storageBlocked) return;
      const count = Number(quantity);
      if (
        !characterId ||
        !offerId ||
        !Number.isInteger(count) ||
        count < 1 ||
        count > 1_000_000
      )
        throw new Error(
          "Выберите персонажа, товар и целое количество от 1 до 1000000.",
        );
      const epoch = generation.current;
      const value = await economyRequest<EconomyQuoteDto>(
        context,
        "/api/economy/quotes",
        { characterId, offerId, quantity: count },
      );
      if (mounted.current && epoch === generation.current) {
        setQuote(value);
        setReceipt(null);
      }
    });
  const clearPending = (actionId: string) => {
    // A failed remove leaves only a safe duplicate replay after reopening.
    try {
      if (readPending(key)?.actionId === actionId)
        window.localStorage.removeItem(key);
    } catch {
      /* receipt is authoritative */
    }
    uncertain.current = null;
    if (mounted.current) setPending(null);
  };
  const purchase = () =>
    run(async () => {
      if (!navigator.locks)
        throw new Error(
          "Для безопасной покупки нужен браузер с Web Locks и защищённое соединение (HTTPS или localhost).",
        );
      const completed = await navigator.locks.request(
        `arken-purchase:${key}`,
        { mode: "exclusive", ifAvailable: true },
        async (lease) => {
          if (!lease)
            throw new Error(
              "Покупка уже выполняется в другой вкладке. Дождитесь её ответа.",
            );
          if (!mounted.current) return;
          let command = uncertain.current;
          if (!command) {
            if (
              !quote ||
              Date.parse(quote.expiresAt) <= Date.now() ||
              !quote.affordable ||
              storageBlocked
            )
              return;
            // Detect another tab's unresolved purchase before allocating a new action.
            const other = readPending(key);
            if (other) {
              uncertain.current = other;
              setPending(other);
              setQuote(null);
              return;
            }
            command = { actionId: crypto.randomUUID(), quoteId: quote.id };
            window.localStorage.setItem(key, JSON.stringify(command));
            uncertain.current = command;
            setPending(command);
          }
          try {
            const saved = await economyRequest<EconomyReceiptDto>(
              context,
              "/api/economy/purchases",
              command,
            );
            clearPending(command.actionId);
            if (mounted.current) {
              setReceipt(saved);
              setQuote(null);
            }
          } catch (e) {
            // Only an explicit transactional rejection allows a new quote/action.
            if (e instanceof ApiError && e.details?.notApplied === true) {
              clearPending(command.actionId);
              if (mounted.current) setQuote(null);
            }
            throw e;
          }
          return true;
        },
      );
      // A receipt is known now; slow catalog/history reads must not keep the
      // cross-tab purchase lease held.
      if (completed && mounted.current) await refresh();
    });
  const locked = busy || !ready || Boolean(pending) || storageBlocked;
  const expired = quote !== null && Date.parse(quote.expiresAt) <= now;
  return (
    <ArkenDialog
      open
      title="Магазины"
      footer={false}
      variant="workspace"
      onClose={onClose}
    >
      <div className="economy-workspace">
        <div className="economy-actions">
          <button
            type="button"
            disabled={busy}
            onClick={() => void run(refresh)}
          >
            Обновить магазины и историю
          </button>
          {gm && (
            <button
              type="button"
              disabled={busy || Boolean(pending)}
              onClick={() => setManager((v) => !v)}
            >
              {manager ? "К покупкам" : "Настройки мастера"}
            </button>
          )}
        </div>
        {error && <p role="alert">{error}</p>}
        {pending && (
          <section aria-label="Неподтверждённая покупка">
            <p>
              Результат покупки ещё не подтверждён. Новая покупка заблокирована;
              повтор сохранит тот же код действия.
            </p>
            <code>{pending.actionId}</code>
            <button
              type="button"
              disabled={busy}
              onClick={() => void purchase()}
            >
              Проверить / повторить ту же покупку
            </button>
          </section>
        )}
        {receipt && (
          <p role="status">
            Куплено: {receipt.itemName}, количество: {receipt.quantity},{" "}
            {copperLabel(receipt.totalCopper)}. Предмет в инвентаре.
          </p>
        )}
        {manager && gm ? (
          <EconomyManager context={context} onSaved={() => void run(refresh)} />
        ) : (
          <>
            {catalog?.date && (
              <p>
                {catalog.date.day} {catalog.date.month}, {catalog.date.year} год
                · {catalog.date.season}
              </p>
            )}
            {catalog && !catalog.enabled && (
              <p>Мастер ещё не включил магазины этой кампании.</p>
            )}
            {catalog?.enabled && (
              <fieldset disabled={locked}>
                <legend>Покупка</legend>
                <label>
                  Персонаж
                  <select
                    value={characterId}
                    onChange={(e) => {
                      invalidate();
                      setCharacterId(e.target.value);
                    }}
                  >
                    <option value="">Выберите персонажа</option>
                    {characters.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  Магазин и товар
                  <select
                    value={offerId}
                    onChange={(e) => {
                      invalidate();
                      setOfferId(e.target.value);
                    }}
                  >
                    <option value="">Выберите товар</option>
                    {catalog.merchants.map((m) => (
                      <optgroup key={m.id} label={`${m.name} · ${m.region}`}>
                        {m.offers.map((o) => (
                          <option key={o.id} value={o.id}>
                            {o.name} · в наличии {o.quantity}
                            {o.condition ? ` · ${o.condition}` : ""}
                          </option>
                        ))}
                      </optgroup>
                    ))}
                  </select>
                </label>
                <label>
                  Количество
                  <input
                    type="number"
                    min="1"
                    max="1000000"
                    step="1"
                    value={quantity}
                    onChange={(e) => {
                      invalidate();
                      setQuantity(e.target.value);
                    }}
                  />
                </label>
                <button
                  type="button"
                  disabled={!characterId || !offerId}
                  onClick={() => void getQuote()}
                >
                  Получить цену
                </button>
              </fieldset>
            )}
            {quote && (
              <section aria-label="Подтверждение цены">
                <h3>
                  {quote.itemName}, количество: {quote.quantity}
                </h3>
                <p>
                  {quote.merchantName}:{" "}
                  <strong>{copperLabel(quote.totalCopper)}</strong>
                </p>
                <p>
                  Цена количества округлена один раз вверх до медной. Сдача: 1
                  золото = 10 серебра = 100 меди.
                </p>
                <p>
                  {expired
                    ? "Срок цены истёк — получите новую."
                    : `Цена до ${new Date(quote.expiresAt).toLocaleTimeString("ru-RU")}.`}
                </p>
                {!quote.affordable && (
                  <p>
                    Недостаточно монет. После изменения кошелька получите новую
                    цену.
                  </p>
                )}
                <button
                  type="button"
                  disabled={locked || expired || !quote.affordable}
                  onClick={() => void purchase()}
                >
                  Подтвердить покупку
                </button>
              </section>
            )}
          </>
        )}
        <details>
          <summary>История покупок {gm ? "кампании" : "моих действий"}</summary>
          {history.items.length === 0 && <p>Покупок пока нет.</p>}
          <ol>
            {history.items.map((row) => (
              <li key={row.id}>
                {row.receipt.itemName}, количество: {row.receipt.quantity} —{" "}
                {copperLabel(row.receipt.totalCopper)} ·{" "}
                {row.receipt.merchantName}
                <small>
                  {" "}
                  {new Date(row.receipt.purchasedAt).toLocaleString(
                    "ru-RU",
                  )} · {row.receipt.actionId}
                </small>
                {gm && row.inputs !== undefined && (
                  <details>
                    <summary>Входы и коэффициенты GM</summary>
                    <pre>{JSON.stringify(row.inputs, null, 2)}</pre>
                  </details>
                )}
              </li>
            ))}
          </ol>
          {history.nextCursor && (
            <button
              type="button"
              disabled={busy}
              onClick={() =>
                void run(async () => {
                  const next = await economyApi<EconomyHistoryDto>(
                    context,
                    `/api/economy/history?cursor=${history.nextCursor}`,
                  );
                  if (mounted.current)
                    setHistory((old) => ({
                      items: [...old.items, ...next.items],
                      nextCursor: next.nextCursor,
                    }));
                })
              }
            >
              Предыдущие покупки
            </button>
          )}
        </details>
      </div>
    </ArkenDialog>
  );
}

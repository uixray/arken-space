import { useEffect, useRef, useState } from "react";
import {
  economyConfigSchema,
  saveMerchantSchema,
  saveShopOfferSchema,
  type EconomyConfig,
  type EconomyManagerDto,
} from "@arken/contracts";
import { ApiError, formatApiError } from "./api";
import {
  economyApi,
  economyRequest,
  type EconomyContext,
} from "./economy-client";

type Merchant = Omit<EconomyManagerDto["merchants"][number], "revision"> & {
  revision: number | null;
};
type Offer = Omit<EconomyManagerDto["offers"][number], "revision"> & {
  revision: number | null;
};
const newMerchant = (): Merchant => ({
  id: crypto.randomUUID(),
  revision: null,
  name: "",
  regionId: "",
  visible: false,
  percent: 100,
});
const newOffer = (): Offer => ({
  id: crypto.randomUUID(),
  revision: null,
  merchantId: "",
  instanceId: "",
  visible: false,
  supplyPercent: 100,
  gmPercent: 100,
  overrideCopper: null,
  reason: "",
});
const emptyConfig = (): EconomyConfig => ({
  enabled: false,
  calendar: { anchorCampaignDay: 1, anchorYear: 1, months: [] },
  seasons: [],
  regions: [],
  charismaStatKey: "charisma",
  charismaBands: [],
});
function NumberField({
  label,
  value,
  onChange,
  min,
  max,
  step = "1",
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
  min?: number;
  max?: number;
  step?: string;
}) {
  return (
    <label>
      {label}
      <input
        type="number"
        value={Number.isFinite(value) ? value : ""}
        min={min}
        max={max}
        step={step}
        onChange={(e) => onChange(e.target.valueAsNumber)}
      />
    </label>
  );
}
export function EconomyManager({
  context,
  onSaved,
}: {
  context: EconomyContext;
  onSaved: () => void;
}) {
  const [data, setData] = useState<EconomyManagerDto | null>(null);
  const [config, setConfig] = useState(emptyConfig);
  // A draft must keep the revision it was based on. Refreshing a different
  // form must not silently authorize overwriting another GM's newer rules.
  const [configRevision, setConfigRevision] = useState<number | null>(null);
  const [merchant, setMerchant] = useState(newMerchant);
  const [offer, setOffer] = useState(newOffer);
  const [selectedPrice, setSelectedPrice] = useState<
    EconomyManagerDto["instances"][number] | null
  >(null);
  const [price, setPrice] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [uncertain, setUncertain] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const alive = useRef(false);
  const active = useRef(false);
  const request = useRef<{
    path: string;
    method: string;
    body: Record<string, unknown>;
  } | null>(null);
  useEffect(() => {
    alive.current = true;
    setLoading(true);
    const abort = new AbortController();
    void economyApi<EconomyManagerDto>(context, "/api/economy/manager", {
      signal: abort.signal,
    })
      .then((value) => {
        if (!abort.signal.aborted && alive.current) {
          setData(value);
          setConfig(value.config ?? emptyConfig());
          setConfigRevision(value.revision);
        }
      })
      .catch((e) => {
        if (!abort.signal.aborted && alive.current) setError(formatApiError(e));
      })
      .finally(() => {
        if (!abort.signal.aborted && alive.current) setLoading(false);
      });
    return () => {
      alive.current = false;
      abort.abort();
    };
  }, [context]);
  const reload = async (reset: boolean) => {
    const next = await economyApi<EconomyManagerDto>(
      context,
      "/api/economy/manager",
    );
    if (!alive.current) return next;
    setData(next);
    if (reset) {
      setConfig(next.config ?? emptyConfig());
      setConfigRevision(next.revision);
      setMerchant(newMerchant());
      setOffer(newOffer());
      setSelectedPrice(null);
      setPrice("");
    }
    return next;
  };
  const resetDrafts = async () => {
    if (active.current || request.current || loading) return;
    active.current = true;
    setBusy(true);
    setError("");
    try {
      await reload(true);
    } catch (e) {
      if (alive.current) setError(formatApiError(e));
    } finally {
      active.current = false;
      if (alive.current) setBusy(false);
    }
  };
  const execute = async () => {
    if (active.current || !request.current) return;
    active.current = true;
    setBusy(true);
    setError("");
    setNotice("");
    const command = request.current;
    try {
      await economyRequest(context, command.path, command.body, command.method);
      request.current = null;
      if (!alive.current) return;
      setUncertain(false);
      setNotice("Сохранено.");
      const next = await reload(false);
      if (!alive.current) return;
      if (command.path.endsWith("/config")) {
        setConfig(next.config ?? emptyConfig());
        setConfigRevision(next.revision);
      }
      if (command.path.endsWith("/merchants")) {
        const row = next.merchants.find((m) => m.id === command.body.id);
        if (row) setMerchant(row);
      }
      if (command.path.endsWith("/offers")) {
        const row = next.offers.find((o) => o.id === command.body.id);
        if (row) setOffer(row);
      }
      if (command.path.startsWith("/api/world-content/")) {
        const row = next.instances.find((i) => i.id === selectedPrice?.id);
        setSelectedPrice(row ?? null);
        setPrice(row?.basePriceCopper?.toString() ?? "");
      }
      onSaved();
    } catch (e) {
      if (
        e instanceof ApiError &&
        (e.details?.notApplied === true || e.code === "WORLD_CONTENT_CONFLICT")
      ) {
        request.current = null;
        if (alive.current) setUncertain(false);
      }
      if (alive.current) setError(formatApiError(e));
    } finally {
      active.current = false;
      if (alive.current) setBusy(false);
    }
  };
  const submit = (
    path: string,
    values: Record<string, unknown>,
    method = "PUT",
  ) => {
    if (request.current || active.current) return;
    request.current = {
      path,
      method,
      body: { ...values, actionId: crypto.randomUUID() },
    };
    setUncertain(true);
    void execute();
  };
  const guard = (operation: () => void) => {
    try {
      setError("");
      operation();
    } catch {
      setError(
        "Проверьте обязательные поля, границы и непересекающиеся диапазоны.",
      );
    }
  };
  const change = (fn: (draft: EconomyConfig) => void) =>
    setConfig((old) => {
      const next = structuredClone(old);
      fn(next);
      return next;
    });
  const availableStock = data
    ? data.instances.filter(
        (i) =>
          !data.offers.some((o) => o.instanceId === i.id && o.id !== offer.id),
      )
    : [];
  return (
    <section
      className="economy-manager"
      aria-label="Настройки магазинов мастера"
    >
      <p>
        Ручные изменения монет игроками остаются доступными. Здесь задаётся цена
        покупки, а не контроль происхождения денег.
      </p>
      <button
        type="button"
        disabled={loading || busy || uncertain}
        onClick={() => void resetDrafts()}
      >
        Загрузить сохранённые настройки и сбросить черновики
      </button>
      {notice && <p role="status">{notice}</p>}
      {error && <p role="alert">{error}</p>}
      {uncertain && !busy && (
        <p>
          Ответ не подтверждён.{" "}
          <button type="button" onClick={() => void execute()}>
            Повторить то же сохранение
          </button>
        </p>
      )}
      {data && (
        <fieldset disabled={busy || uncertain}>
          <legend>Правила кампании</legend>
          <details open={!data.config}>
            <summary>Календарь, сезоны, регионы и харизма</summary>
            <label>
              <input
                type="checkbox"
                checked={config.enabled}
                onChange={(e) =>
                  change((c) => {
                    c.enabled = e.target.checked;
                  })
                }
              />{" "}
              Включить магазины этой кампании
            </label>
            <p>
              Год повторяется без високосных исключений. Якорный день кампании —
              первый день первого месяца. Сброс игрового времени пересчитывает
              дату, но не возвращает товары и деньги.
            </p>
            <NumberField
              label="Якорный день кампании"
              value={config.calendar.anchorCampaignDay}
              min={1}
              max={2_000_000_000}
              onChange={(v) =>
                change((c) => {
                  c.calendar.anchorCampaignDay = v;
                })
              }
            />
            <NumberField
              label="Год в якорный день"
              value={config.calendar.anchorYear}
              min={-1_000_000}
              max={1_000_000}
              onChange={(v) =>
                change((c) => {
                  c.calendar.anchorYear = v;
                })
              }
            />
            <h4>Сезоны</h4>
            <p>
              Все коэффициенты в процентах: 100 — без изменения, 0 — явная
              бесплатная цена. Правила видит только мастер.
            </p>
            {config.seasons.map((s, i) => (
              <div className="economy-row" key={s.id}>
                <label>
                  Название сезона
                  <input
                    value={s.name}
                    maxLength={100}
                    onChange={(e) =>
                      change((c) => {
                        c.seasons[i]!.name = e.target.value;
                      })
                    }
                  />
                </label>
                <NumberField
                  label="Сезон, %"
                  value={s.percent}
                  min={0}
                  max={10000}
                  onChange={(v) =>
                    change((c) => {
                      c.seasons[i]!.percent = v;
                    })
                  }
                />
                <button
                  type="button"
                  onClick={() =>
                    change((c) => {
                      c.seasons.splice(i, 1);
                    })
                  }
                >
                  Удалить сезон
                </button>
              </div>
            ))}
            <button
              type="button"
              disabled={config.seasons.length >= 24}
              onClick={() =>
                change((c) => {
                  c.seasons.push({
                    id: crypto.randomUUID(),
                    name: "",
                    percent: 100,
                  });
                })
              }
            >
              Добавить сезон
            </button>
            <h4>Месяцы по порядку</h4>
            {config.calendar.months.map((m, i) => (
              <div className="economy-row" key={i}>
                <label>
                  Месяц {i + 1}
                  <input
                    value={m.name}
                    maxLength={100}
                    onChange={(e) =>
                      change((c) => {
                        c.calendar.months[i]!.name = e.target.value;
                      })
                    }
                  />
                </label>
                <NumberField
                  label="Дней"
                  value={m.days}
                  min={1}
                  max={366}
                  onChange={(v) =>
                    change((c) => {
                      c.calendar.months[i]!.days = v;
                    })
                  }
                />
                <label>
                  Сезон
                  <select
                    value={m.seasonId}
                    onChange={(e) =>
                      change((c) => {
                        c.calendar.months[i]!.seasonId = e.target.value;
                      })
                    }
                  >
                    <option value="">Выберите</option>
                    {config.seasons.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.name || "Без названия"}
                      </option>
                    ))}
                  </select>
                </label>
                <button
                  type="button"
                  onClick={() =>
                    change((c) => {
                      c.calendar.months.splice(i, 1);
                    })
                  }
                >
                  Удалить месяц
                </button>
              </div>
            ))}
            <button
              type="button"
              disabled={config.calendar.months.length >= 36}
              onClick={() =>
                change((c) => {
                  c.calendar.months.push({
                    name: "",
                    days: Number.NaN,
                    seasonId: "",
                  });
                })
              }
            >
              Добавить месяц
            </button>
            <h4>Регионы торговли</h4>
            {config.regions.map((r, i) => (
              <div className="economy-row" key={i}>
                <label>
                  Локация
                  <select
                    value={r.worldContentId}
                    onChange={(e) =>
                      change((c) => {
                        c.regions[i]!.worldContentId = e.target.value;
                      })
                    }
                  >
                    <option value="">Выберите регион</option>
                    {data.regions.map((v) => (
                      <option key={v.id} value={v.id}>
                        {v.name}
                      </option>
                    ))}
                  </select>
                </label>
                <NumberField
                  label="Регион, %"
                  value={r.percent}
                  min={0}
                  max={10000}
                  onChange={(v) =>
                    change((c) => {
                      c.regions[i]!.percent = v;
                    })
                  }
                />
                <button
                  type="button"
                  onClick={() =>
                    change((c) => {
                      c.regions.splice(i, 1);
                    })
                  }
                >
                  Удалить регион
                </button>
              </div>
            ))}
            <button
              type="button"
              disabled={config.regions.length >= 128}
              onClick={() =>
                change((c) => {
                  c.regions.push({ worldContentId: "", percent: 100 });
                })
              }
            >
              Добавить регион
            </button>
            <h4>Харизма</h4>
            <label>
              Ключ характеристики
              <input
                value={config.charismaStatKey}
                maxLength={40}
                onChange={(e) =>
                  change((c) => {
                    c.charismaStatKey = e.target.value;
                  })
                }
              />
            </label>
            <p>
              Значение берётся с сервера из персонажа. Обе границы включены; при
              отсутствии подходящего диапазона покупка блокируется.
            </p>
            {config.charismaBands.map((b, i) => (
              <div className="economy-row" key={i}>
                <NumberField
                  label="От"
                  value={b.min}
                  step="any"
                  onChange={(v) =>
                    change((c) => {
                      c.charismaBands[i]!.min = v;
                    })
                  }
                />
                <NumberField
                  label="До"
                  value={b.max}
                  step="any"
                  onChange={(v) =>
                    change((c) => {
                      c.charismaBands[i]!.max = v;
                    })
                  }
                />
                <NumberField
                  label="Харизма, %"
                  value={b.percent}
                  min={0}
                  max={10000}
                  onChange={(v) =>
                    change((c) => {
                      c.charismaBands[i]!.percent = v;
                    })
                  }
                />
                <button
                  type="button"
                  onClick={() =>
                    change((c) => {
                      c.charismaBands.splice(i, 1);
                    })
                  }
                >
                  Удалить диапазон
                </button>
              </div>
            ))}
            <button
              type="button"
              disabled={config.charismaBands.length >= 64}
              onClick={() =>
                change((c) => {
                  c.charismaBands.push({
                    min: Number.NaN,
                    max: Number.NaN,
                    percent: 100,
                  });
                })
              }
            >
              Добавить диапазон
            </button>
            <button
              type="button"
              onClick={() =>
                guard(() =>
                  submit("/api/economy/config", {
                    revision: configRevision,
                    config: economyConfigSchema.parse(config),
                  }),
                )
              }
            >
              Сохранить правила
            </button>
          </details>
          <details>
            <summary>Базовые цены предметов</summary>
            <p>
              Цена канонического ITEM в медных за штуку общая для кампаний.
              Пустое поле — цена не назначена, 0 — явно бесплатно. Изменение
              попадёт в историю сущности.
            </p>
            <label>
              Экземпляр предмета
              <select
                value={selectedPrice?.id ?? ""}
                onChange={(e) => {
                  const row = data.instances.find(
                    (i) => i.id === e.target.value,
                  );
                  setSelectedPrice(row ?? null);
                  setPrice(row?.basePriceCopper?.toString() ?? "");
                }}
              >
                <option value="">Выберите</option>
                {data.instances.map((i) => (
                  <option key={i.id} value={i.id}>
                    {i.name}
                  </option>
                ))}
                {selectedPrice &&
                  !data.instances.some((i) => i.id === selectedPrice.id) && (
                    <option value={selectedPrice.id}>
                      {selectedPrice.name} · прежний выбор, обновите настройки
                    </option>
                  )}
              </select>
            </label>
            <label>
              Медных за штуку
              <input
                type="number"
                min="0"
                max="1000000000000"
                step="1"
                value={price}
                onChange={(e) => setPrice(e.target.value)}
              />
            </label>
            <button
              type="button"
              disabled={!selectedPrice}
              onClick={() =>
                guard(() => {
                  const amount = price.trim() === "" ? null : Number(price);
                  if (
                    amount !== null &&
                    (!Number.isSafeInteger(amount) ||
                      amount < 0 ||
                      amount > 1e12)
                  )
                    throw new Error();
                  if (selectedPrice)
                    submit(
                      `/api/world-content/${selectedPrice.worldContentId}`,
                      {
                        revision: selectedPrice.worldRevision,
                        basePriceCopper: amount,
                      },
                      "PATCH",
                    );
                })
              }
            >
              Сохранить базовую цену
            </button>
          </details>
          <details>
            <summary>Магазины</summary>
            <ul>
              {data.merchants.map((m) => (
                <li key={m.id}>
                  {m.name} · {m.visible ? "видимый" : "скрытый"}{" "}
                  <button type="button" onClick={() => setMerchant(m)}>
                    Изменить
                  </button>
                </li>
              ))}
            </ul>
            <button type="button" onClick={() => setMerchant(newMerchant())}>
              Новый магазин
            </button>
            <label>
              Название
              <input
                value={merchant.name}
                maxLength={100}
                onChange={(e) =>
                  setMerchant({ ...merchant, name: e.target.value })
                }
              />
            </label>
            <label>
              Регион
              <select
                value={merchant.regionId}
                onChange={(e) =>
                  setMerchant({ ...merchant, regionId: e.target.value })
                }
              >
                <option value="">Выберите</option>
                {data.config?.regions.map((r) => (
                  <option key={r.worldContentId} value={r.worldContentId}>
                    {data.regions.find((v) => v.id === r.worldContentId)
                      ?.name ?? "Регион недоступен"}
                  </option>
                ))}
              </select>
            </label>
            <NumberField
              label="Торговец, %"
              value={merchant.percent}
              min={0}
              max={10000}
              onChange={(v) => setMerchant({ ...merchant, percent: v })}
            />
            <label>
              <input
                type="checkbox"
                checked={merchant.visible}
                onChange={(e) =>
                  setMerchant({ ...merchant, visible: e.target.checked })
                }
              />{" "}
              Показывать игрокам
            </label>
            <button
              type="button"
              disabled={!data.config}
              onClick={() =>
                guard(() => {
                  saveMerchantSchema.parse({
                    ...merchant,
                    actionId: crypto.randomUUID(),
                  });
                  submit("/api/economy/merchants", { ...merchant });
                })
              }
            >
              Сохранить магазин
            </button>
          </details>
          <details>
            <summary>Товары и остатки</summary>
            <p>
              Остаток хранится в существующем экземпляре. Он должен быть
              свободен от владельца, инвентаря, сцены и контейнеров. Для игрока
              также нужны обнаруженный экземпляр и доступный регион.
            </p>
            <ul>
              {data.offers.map((o) => (
                <li key={o.id}>
                  {data.instances.find((i) => i.id === o.instanceId)?.name ??
                    "Экземпляр недоступен"}{" "}
                  · {o.visible ? "видимый" : "скрытый"}{" "}
                  <button type="button" onClick={() => setOffer(o)}>
                    Изменить
                  </button>
                </li>
              ))}
            </ul>
            <button type="button" onClick={() => setOffer(newOffer())}>
              Новое предложение
            </button>
            <label>
              Магазин
              <select
                value={offer.merchantId}
                onChange={(e) =>
                  setOffer({ ...offer, merchantId: e.target.value })
                }
              >
                <option value="">Выберите</option>
                {data.merchants.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Экземпляр
              <select
                value={offer.instanceId}
                onChange={(e) =>
                  setOffer({ ...offer, instanceId: e.target.value })
                }
              >
                <option value="">Выберите</option>
                {availableStock.map((i) => (
                  <option key={i.id} value={i.id}>
                    {i.name} · {i.quantity} шт.
                  </option>
                ))}
                {offer.instanceId &&
                  !availableStock.some((i) => i.id === offer.instanceId) && (
                    <option value={offer.instanceId}>
                      Прежний экземпляр недоступен — можно скрыть предложение
                    </option>
                  )}
              </select>
            </label>
            <NumberField
              label="Запас / спрос, %"
              value={offer.supplyPercent}
              min={0}
              max={10000}
              onChange={(v) => setOffer({ ...offer, supplyPercent: v })}
            />
            <NumberField
              label="Поправка мастера, %"
              value={offer.gmPercent}
              min={0}
              max={10000}
              onChange={(v) => setOffer({ ...offer, gmPercent: v })}
            />
            <label>
              Вместо расчёта: фиксированная цена за штуку, медных
              <input
                type="number"
                min="0"
                max="1000000000000"
                step="1"
                value={
                  offer.overrideCopper === null ||
                  !Number.isFinite(offer.overrideCopper)
                    ? ""
                    : offer.overrideCopper
                }
                onChange={(e) =>
                  setOffer({
                    ...offer,
                    overrideCopper:
                      e.target.value === "" ? null : e.target.valueAsNumber,
                  })
                }
              />
            </label>
            <label>
              Причина ручной цены / поправки
              <input
                value={offer.reason}
                maxLength={500}
                onChange={(e) => setOffer({ ...offer, reason: e.target.value })}
              />
            </label>
            <label>
              <input
                type="checkbox"
                checked={offer.visible}
                onChange={(e) =>
                  setOffer({ ...offer, visible: e.target.checked })
                }
              />{" "}
              Показывать товар игрокам
            </label>
            <button
              type="button"
              disabled={!data.config}
              onClick={() =>
                guard(() => {
                  saveShopOfferSchema.parse({
                    ...offer,
                    actionId: crypto.randomUUID(),
                  });
                  submit("/api/economy/offers", { ...offer });
                })
              }
            >
              Сохранить предложение
            </button>
          </details>
        </fieldset>
      )}
    </section>
  );
}

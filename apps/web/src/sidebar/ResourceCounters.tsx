import { useEffect, useId, useRef, useState } from "react";
import { Button } from "@gravity-ui/uikit";
import type { CharacterDto } from "@arken/contracts";
import { FormInput } from "../ui/GravityFormControls";
import {
  clampResourceValue,
  RESOURCE_ADJUST_DELAY_MS,
  resourceRegenAmount,
} from "../resource-regen";
import type { ResourceCounterIntent } from "../resource-counter-intent";

type OptimisticValue = { value: number; generation: number };

type ResourceBatch = {
  /** Изменение, уже обрезанное фактическими границами ресурса. */
  delta: number;
  /** Версия показанного значения после последнего клика серии. */
  generation: number;
  /** Состояние до серии нужно, чтобы серия -1/+1 могла отменить сама себя. */
  baseOptimistic?: OptimisticValue;
  /** Отправляет уже принятое действие и безопасен для cleanup панели. */
  flush: () => void;
  timer: ReturnType<typeof setTimeout>;
};

/** Character id and layout key are independent namespaces; encode both. */
function scopedResourceKey(scopeKey: string, resourceKey: string): string {
  return JSON.stringify([scopeKey, resourceKey]);
}

/**
 * UIX-424, шаг 8 — выносливость и мана рядом с бросками.
 *
 * На шаге 4 из панели пропали кнопки «Выносливость» и «Знания»: бросать
 * выносливость больше нельзя, она стала расходуемым ресурсом. Но тратится она
 * каждый ход, на каждое физическое действие, — и открывать ради этого карточку
 * персонажа посреди боя значит делать самое частое действие самым долгим.
 *
 * Новое хранилище не заводится: счётчики правят те же `characters.resources`,
 * что и блок ресурсов в карточке. Здесь только другой доступ к ним.
 *
 * UIX-468 — восстановление, ручной ввод и накопление нажатий.
 *
 * Нажатия ±1 копятся и уходят одной правкой: тратят ресурс сериями, а каждое
 * отдельное нажатие поднимало бы ревизию персонажа и рассылало обновление всем
 * за столом. Число на экране при этом меняется сразу — иначе счётчик отстаёт от
 * руки. Плата за это — экран, показывающий то, чего в базе ещё нет, поэтому
 * отказ сервера обязан вернуть серверное значение, а не оставить показанное.
 */
export function ResourceCounters({
  scopeKey,
  rows,
  resources,
  stats,
  editable,
  onSpend,
}: {
  /** Stable character id. Drafts and timers from another character stay isolated. */
  scopeKey: string;
  /** Строки-ресурсы раскладки кампании: ключ и подпись мастера. */
  rows: readonly { key: string; label: string }[];
  resources: CharacterDto["resources"];
  /** Характеристики персонажа — из них берётся величина регена. */
  stats: Record<string, number>;
  editable: boolean;
  onSpend: (intent: ResourceCounterIntent) => void | Promise<unknown>;
}) {
  /**
   * Показанное значение до подтверждения сервером. Ключа здесь нет, пока по
   * ресурсу нечего показывать сверх серверного, — так пропадает вопрос, что
   * делать с чужим обновлением: его видно сразу.
   */
  const [drafts, setDrafts] = useState<Record<string, number>>({});
  const optimistic = useRef(new Map<string, OptimisticValue>());
  const batches = useRef(new Map<string, ResourceBatch>());
  const inputGenerations = useRef(new Map<string, number>());
  const inFlight = useRef(new Map<string, Set<number>>());
  const nextGeneration = useRef(0);
  const mounted = useRef(true);
  const inputIdPrefix = useId();

  // Смена `scopeKey` — не размонтирование: таймер A сохраняет callback из
  // рендера A, а составные ключи не дают его draft попасть на экран персонажа
  // B. При настоящем закрытии уже принятые клики всё равно отправляются ниже.
  useEffect(() => {
    mounted.current = true;
    const pendingBatches = batches.current;
    return () => {
      // Переключение feed размонтирует ActivityPanel. Видимый и уже принятый
      // клик нельзя превращать в неявную отмену только потому, что 600 мс ещё
      // не истекли: flush сохраняет intent в стабильной очереди App.
      for (const batch of [...pendingBatches.values()]) {
        clearTimeout(batch.timer);
        batch.flush();
      }
      pendingBatches.clear();
      mounted.current = false;
    };
  }, []);

  if (rows.length === 0) return null;

  const removeDraft = (stateKey: string, generation?: number) => {
    const currentOptimistic = optimistic.current.get(stateKey);
    if (
      generation !== undefined &&
      currentOptimistic?.generation !== generation
    ) {
      return;
    }
    optimistic.current.delete(stateKey);
    setDrafts((current) => {
      if (!(stateKey in current)) return current;
      const next = { ...current };
      delete next[stateKey];
      return next;
    });
  };

  /**
   * Отправляет одно намерение. Завершение старого запроса снимает только свой
   * optimistic draft: более свежий ввод или таймер остаётся нетронутым.
   */
  const send = (
    stateKey: string,
    intent: ResourceCounterIntent,
    generation: number,
  ) => {
    const requests = inFlight.current.get(stateKey) ?? new Set<number>();
    requests.add(generation);
    inFlight.current.set(stateKey, requests);

    let result: void | Promise<unknown>;
    try {
      result = onSpend(intent);
    } catch (reason) {
      result = Promise.reject(reason);
    }

    void Promise.resolve(result)
      // Сообщение об ошибке показывает владелец счётчиков: он же знает про
      // конфликт ревизий и про обрыв связи. Здесь нужен только откат показа.
      .catch(() => undefined)
      .finally(() => {
        requests.delete(generation);
        if (requests.size === 0) inFlight.current.delete(stateKey);
        if (!mounted.current) return;
        removeDraft(stateKey, generation);
      });
  };

  /** Показывает значение сразу и синхронно запоминает его версию. */
  const show = (stateKey: string, value: number, generation: number) => {
    optimistic.current.set(stateKey, { value, generation });
    setDrafts((current) => ({ ...current, [stateKey]: value }));
  };

  const cancelBatch = (stateKey: string) => {
    const batch = batches.current.get(stateKey);
    if (!batch) return;
    clearTimeout(batch.timer);
    batches.current.delete(stateKey);
  };

  const optimisticGenerationIsActive = (stateKey: string, generation: number) =>
    inFlight.current.get(stateKey)?.has(generation) === true ||
    inputGenerations.current.get(stateKey) === generation;

  const restoreBatchBaseOrClear = (
    stateKey: string,
    baseOptimistic?: OptimisticValue,
  ) => {
    if (
      baseOptimistic &&
      optimisticGenerationIsActive(stateKey, baseOptimistic.generation)
    ) {
      show(stateKey, baseOptimistic.value, baseOptimistic.generation);
      return;
    }
    removeDraft(stateKey);
  };

  /** Прибавляет к накопленному, а не к тому, что было на прошлой отрисовке. */
  const queue = (
    stateKey: string,
    resourceKey: string,
    delta: number,
    serverCurrent: number,
    maximum: number,
  ) => {
    const previousOptimistic = optimistic.current.get(stateKey);
    const base = previousOptimistic?.value ?? serverCurrent;
    const value = clampResourceValue(base + delta, maximum);
    const actualDelta = value - base;
    if (actualDelta === 0) return;

    const running = batches.current.get(stateKey);
    if (running) clearTimeout(running.timer);
    const combinedDelta = (running?.delta ?? 0) + actualDelta;

    // -1 и +1 в пределах одной паузы — отсутствие решения, а не запрос DELTA 0.
    if (combinedDelta === 0) {
      batches.current.delete(stateKey);
      inputGenerations.current.delete(stateKey);
      restoreBatchBaseOrClear(stateKey, running?.baseOptimistic);
      return;
    }

    const generation = ++nextGeneration.current;
    show(stateKey, value, generation);
    const flush = () => {
      if (batches.current.get(stateKey) !== batch) return;
      batches.current.delete(stateKey);
      send(
        stateKey,
        { key: resourceKey, kind: "DELTA", delta: batch.delta },
        batch.generation,
      );
    };
    const batch: ResourceBatch = {
      delta: combinedDelta,
      generation,
      baseOptimistic: running?.baseOptimistic ?? previousOptimistic,
      flush,
      timer: setTimeout(flush, RESOURCE_ADJUST_DELAY_MS),
    };
    batches.current.set(stateKey, batch);
  };

  /**
   * Реген — относительное восстановление, поэтому он применяется к свежей
   * базе очереди. Если до него ещё не ушла серия +/- — оба намерения уходят
   * одним DELTA, а не превращаются в устаревший абсолютный SET.
   */
  const commitDeltaNow = (
    stateKey: string,
    resourceKey: string,
    delta: number,
    value: number,
    generation: number,
  ) => {
    const running = batches.current.get(stateKey);
    if (running) {
      clearTimeout(running.timer);
      batches.current.delete(stateKey);
    }
    inputGenerations.current.delete(stateKey);
    const combinedDelta = (running?.delta ?? 0) + delta;
    if (combinedDelta === 0) {
      restoreBatchBaseOrClear(stateKey, running?.baseOptimistic);
      return;
    }
    show(stateKey, value, generation);
    send(
      stateKey,
      { key: resourceKey, kind: "DELTA", delta: combinedDelta },
      generation,
    );
  };

  /** Ручной ввод уходит SET: это выбранная цель, а не относительный шаг. */
  const commitSet = (
    stateKey: string,
    resourceKey: string,
    value: number,
    generation: number,
    serverCurrent: number,
  ) => {
    cancelBatch(stateKey);
    inputGenerations.current.delete(stateKey);
    show(stateKey, value, generation);

    // Нет изменения и нет более старого запроса, результат которого ещё может
    // сдвинуть серверное значение: сервер тревожить не нужно.
    if (value === serverCurrent && !inFlight.current.has(stateKey)) {
      removeDraft(stateKey, generation);
      return;
    }
    send(stateKey, { key: resourceKey, kind: "SET", value }, generation);
  };

  return (
    <details className="resource-counters" open>
      <summary className="resource-counters__summary">
        <span>Ресурсы</span>
        {/* Значения в свёрнутом виде: свернувший блок всё равно должен видеть,
            сколько у него осталось. */}
        <span className="resource-counters__summary-values">
          {rows
            .map((row) => {
              const resource = resources[row.key] ?? { current: 0, maximum: 0 };
              const stateKey = scopedResourceKey(scopeKey, row.key);
              const shown = drafts[stateKey] ?? resource.current;
              return `${row.label}: ${shown}`;
            })
            .join(" · ")}
        </span>
      </summary>
      <div className="resource-counters__list" aria-label="Очки ресурсов">
        {rows.map((row, rowIndex) => {
          const stateKey = scopedResourceKey(scopeKey, row.key);
          const inputId = `${inputIdPrefix}-resource-${rowIndex}`;
          const resource = resources[row.key] ?? { current: 0, maximum: 0 };
          const maximum = resource.maximum ?? resource.current;
          const shown = drafts[stateKey] ?? resource.current;
          const regen = resourceRegenAmount(row.key, stats);
          const change = (delta: number) =>
            // Ограничение с обеих сторон здесь, а не только на сервере: без него
            // счётчик уводит в минус на глазах, а отказ приходит позже.
            queue(stateKey, row.key, delta, resource.current, maximum);
          return (
            <div className="resource-counters__item" key={row.key}>
              <label className="resource-counters__label" htmlFor={inputId}>
                <span className="visually-hidden">Очки: </span>
                {row.label}
              </label>
              <Button
                view="flat"
                disabled={!editable || shown <= 0}
                aria-label={`Потратить одно очко: ${row.label}`}
                title="Потратить одно очко"
                onClick={() => change(-1)}
              >
                <span aria-hidden="true">−</span>
              </Button>
              {/* Ввод числом: поставить 3 из 17 щелчками по единице — это
                  четырнадцать нажатий ради одного решения. */}
              <FormInput
                id={inputId}
                type="number"
                className="resource-counters__input"
                aria-label={`Очки: ${row.label}`}
                disabled={!editable}
                min={0}
                max={maximum}
                value={String(shown)}
                onChange={(event) => {
                  cancelBatch(stateKey);
                  const value = clampResourceValue(
                    Number(event.target.value),
                    maximum,
                  );
                  const generation = ++nextGeneration.current;
                  inputGenerations.current.set(stateKey, generation);
                  show(stateKey, value, generation);
                }}
                onBlur={(event) => {
                  const generation = inputGenerations.current.get(stateKey);
                  if (generation === undefined) return;
                  commitSet(
                    stateKey,
                    row.key,
                    clampResourceValue(Number(event.target.value), maximum),
                    generation,
                    resource.current,
                  );
                }}
                onKeyDown={(event) => {
                  if (event.key !== "Enter") return;
                  event.preventDefault();
                  const generation = inputGenerations.current.get(stateKey);
                  if (generation === undefined) return;
                  commitSet(
                    stateKey,
                    row.key,
                    clampResourceValue(
                      Number(event.currentTarget.value),
                      maximum,
                    ),
                    generation,
                    resource.current,
                  );
                }}
              />
              <span className="resource-counters__maximum">
                <span aria-hidden="true">/ </span>
                {maximum}
              </span>
              <Button
                view="flat"
                disabled={!editable || shown >= maximum}
                aria-label={`Вернуть одно очко: ${row.label}`}
                title="Вернуть одно очко"
                onClick={() => change(1)}
              >
                <span aria-hidden="true">+</span>
              </Button>
              {/* Кнопка восстановления есть только там, где системе известна
                  величина регена. У прочих ресурсов её не из чего взять. */}
              {regen > 0 && (
                <Button
                  view="flat"
                  className="resource-counters__regen"
                  disabled={!editable || shown >= maximum}
                  aria-label={`Восстановить ${regen}: ${row.label}`}
                  title={`Восстановить на величину регена (${regen})`}
                  onClick={() => {
                    const value = clampResourceValue(shown + regen, maximum);
                    if (value === shown) return;
                    const generation = ++nextGeneration.current;
                    commitDeltaNow(
                      stateKey,
                      row.key,
                      value - shown,
                      value,
                      generation,
                    );
                  }}
                >
                  +{regen}
                </Button>
              )}
            </div>
          );
        })}
      </div>
    </details>
  );
}

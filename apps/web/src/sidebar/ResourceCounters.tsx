import { useEffect, useRef, useState } from "react";
import { Button } from "@gravity-ui/uikit";
import type { CharacterDto } from "@arken/contracts";
import { FormInput } from "../ui/GravityFormControls";
import {
  clampResourceValue,
  RESOURCE_ADJUST_DELAY_MS,
  resourceRegenAmount,
} from "../resource-regen";

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
  rows,
  resources,
  stats,
  editable,
  pending,
  onSpend,
}: {
  /** Строки-ресурсы раскладки кампании: ключ и подпись мастера. */
  rows: readonly { key: string; label: string }[];
  resources: CharacterDto["resources"];
  /** Характеристики персонажа — из них берётся величина регена. */
  stats: Record<string, number>;
  editable: boolean;
  pending: boolean;
  onSpend: (key: string, next: number) => void | Promise<unknown>;
}) {
  /**
   * Показанное значение до подтверждения сервером. Ключа здесь нет, пока по
   * ресурсу нечего показывать сверх серверного, — так пропадает вопрос, что
   * делать с чужим обновлением: его видно сразу.
   */
  const [drafts, setDrafts] = useState<Record<string, number>>({});
  const timers = useRef(new Map<string, ReturnType<typeof setTimeout>>());
  /**
   * Накопленная цель, зеркало `drafts` — но обновляемое синхронно.
   *
   * Состояние React до перерисовки не меняется, а серия нажатий укладывается в
   * один тик: три щелчка подряд считались бы все от одного и того же числа, и
   * «−1» трижды давало бы −1 вместо −3. Отсчёт ведётся отсюда, поэтому не
   * зависит от того, успел ли компонент перерисоваться между нажатиями.
   */
  const targets = useRef(new Map<string, number>());

  // Незавершённая пауза при закрытии панели не должна дёргать сервер и
  // выставлять состояние размонтированному компоненту.
  useEffect(() => {
    const pendingTimers = timers.current;
    return () => {
      for (const timer of pendingTimers.values()) clearTimeout(timer);
      pendingTimers.clear();
    };
  }, []);

  if (rows.length === 0) return null;

  const forget = (key: string) => {
    targets.current.delete(key);
    setDrafts((current) => {
      if (!(key in current)) return current;
      const next = { ...current };
      delete next[key];
      return next;
    });
  };

  /**
   * Отправляет накопленное. Показанное значение снимается в любом случае:
   * после успеха его заменяет пришедшее с сервера, после отказа — прежнее
   * серверное, то есть откат.
   */
  const commit = (key: string, value: number) => {
    timers.current.delete(key);
    void Promise.resolve(onSpend(key, value))
      // Сообщение об ошибке показывает владелец счётчиков: он же знает про
      // конфликт ревизий и про обрыв связи.
      .catch(() => undefined)
      .finally(() => forget(key));
  };

  /** Показывает значение сразу и синхронно запоминает его как новую точку отсчёта. */
  const show = (key: string, value: number) => {
    targets.current.set(key, value);
    setDrafts((current) => ({ ...current, [key]: value }));
  };

  /** Прибавляет к накопленному, а не к тому, что было на прошлой отрисовке. */
  const queue = (
    key: string,
    delta: number,
    serverCurrent: number,
    maximum: number,
  ) => {
    const base = targets.current.get(key) ?? serverCurrent;
    const value = clampResourceValue(base + delta, maximum);
    show(key, value);
    const running = timers.current.get(key);
    if (running) clearTimeout(running);
    timers.current.set(
      key,
      setTimeout(() => commit(key, value), RESOURCE_ADJUST_DELAY_MS),
    );
  };

  /** Ручной ввод и восстановление уходят сразу: это не серия, а одно решение. */
  const commitNow = (key: string, value: number) => {
    const running = timers.current.get(key);
    if (running) clearTimeout(running);
    show(key, value);
    commit(key, value);
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
              const shown = drafts[row.key] ?? resource.current;
              return `${row.label}: ${shown}`;
            })
            .join(" · ")}
        </span>
      </summary>
      <div className="resource-counters__list" aria-label="Очки ресурсов">
        {rows.map((row) => {
          const resource = resources[row.key] ?? { current: 0, maximum: 0 };
          const maximum = resource.maximum ?? resource.current;
          const shown = drafts[row.key] ?? resource.current;
          const regen = resourceRegenAmount(row.key, stats);
          const change = (delta: number) =>
            // Ограничение с обеих сторон здесь, а не только на сервере: без него
            // счётчик уводит в минус на глазах, а отказ приходит позже.
            queue(row.key, delta, resource.current, maximum);
          return (
            <div className="resource-counters__item" key={row.key}>
              <span className="resource-counters__label">{row.label}</span>
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
                type="number"
                className="resource-counters__input"
                aria-label={`Очки: ${row.label}`}
                disabled={!editable}
                min={0}
                max={maximum}
                value={String(shown)}
                onChange={(event) =>
                  setDrafts((current) => ({
                    ...current,
                    [row.key]: clampResourceValue(
                      Number(event.target.value),
                      maximum,
                    ),
                  }))
                }
                onBlur={(event) =>
                  commitNow(
                    row.key,
                    clampResourceValue(Number(event.target.value), maximum),
                  )
                }
                onKeyDown={(event) => {
                  if (event.key !== "Enter") return;
                  event.preventDefault();
                  commitNow(
                    row.key,
                    clampResourceValue(
                      Number(event.currentTarget.value),
                      maximum,
                    ),
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
                  disabled={!editable || pending || shown >= maximum}
                  aria-label={`Восстановить ${regen}: ${row.label}`}
                  title={`Восстановить на величину регена (${regen})`}
                  onClick={() =>
                    commitNow(
                      row.key,
                      clampResourceValue(shown + regen, maximum),
                    )
                  }
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

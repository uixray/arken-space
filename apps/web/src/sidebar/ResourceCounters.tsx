import { Button } from "@gravity-ui/uikit";
import type { CharacterDto } from "@arken/contracts";

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
 */
export function ResourceCounters({
  rows,
  resources,
  editable,
  pending,
  onSpend,
}: {
  /** Строки-ресурсы раскладки кампании: ключ и подпись мастера. */
  rows: readonly { key: string; label: string }[];
  resources: CharacterDto["resources"];
  editable: boolean;
  pending: boolean;
  onSpend: (key: string, next: number) => void;
}) {
  if (rows.length === 0) return null;
  return (
    <section className="resource-counters" aria-label="Очки ресурсов">
      {rows.map((row) => {
        const resource = resources[row.key] ?? { current: 0, maximum: 0 };
        const maximum = resource.maximum ?? resource.current;
        const change = (delta: number) =>
          // Ограничение с обеих сторон здесь, а не только на сервере: без него
          // счётчик уводит в минус на глазах, а отказ приходит позже.
          onSpend(
            row.key,
            Math.min(maximum, Math.max(0, resource.current + delta)),
          );
        return (
          <div className="resource-counters__item" key={row.key}>
            <span className="resource-counters__label">{row.label}</span>
            <Button
              view="flat"
              disabled={!editable || pending || resource.current <= 0}
              aria-label={`Потратить одно очко: ${row.label}`}
              title="Потратить одно очко"
              onClick={() => change(-1)}
            >
              <span aria-hidden="true">−</span>
            </Button>
            {/* Текущее и максимум вместе: тратящему важно не само число, а
             * сколько осталось до нуля. */}
            <output className="resource-counters__value">
              {resource.current}
              <span aria-hidden="true"> / </span>
              <span className="resource-counters__maximum">{maximum}</span>
            </output>
            <Button
              view="flat"
              disabled={!editable || pending || resource.current >= maximum}
              aria-label={`Вернуть одно очко: ${row.label}`}
              title="Вернуть одно очко"
              onClick={() => change(1)}
            >
              <span aria-hidden="true">+</span>
            </Button>
          </div>
        );
      })}
    </section>
  );
}

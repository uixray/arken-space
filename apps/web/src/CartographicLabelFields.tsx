import type { CartographicLabelConfig } from "@arken/contracts";
import { CartographicLabel } from "./design-system/CartographicLabel";
import "./cartographic-label-placement.css";

/** Used only inside existing GM editors; server remains the permission boundary. */
export function CartographicLabelFields({
  value,
  onChange,
  name,
  optionalTitle = false,
}: {
  value: CartographicLabelConfig | null | undefined;
  onChange: (value: CartographicLabelConfig | null) => void;
  name: string;
  /** Legacy scenes have no canvas title; location markers always have a name. */
  optionalTitle?: boolean;
}) {
  const current = value ?? {
    presentation: "plain" as const,
    offsetX: 0,
    offsetY: 0,
  };
  const hidden = optionalTitle && value == null;
  return (
    <fieldset className="cartographic-label-fields">
      <legend>Подпись на карте</legend>
      {optionalTitle && (
        <label>
          <input
            type="checkbox"
            checked={!hidden}
            onChange={(event) =>
              onChange(event.currentTarget.checked ? current : null)
            }
          />
          Показывать название сцены на карте
        </label>
      )}
      <label>
        Оформление
        <select
          disabled={hidden}
          value={current.presentation}
          onChange={(event) =>
            onChange({
              ...current,
              presentation:
                event.target.value === "ribbon" ? "ribbon" : "plain",
            })
          }
        >
          <option value="plain">Обычный текст</option>
          <option value="ribbon">Лента</option>
        </select>
      </label>
      {(["offsetX", "offsetY"] as const).map((axis) => (
        <label key={axis}>
          {axis === "offsetX"
            ? "Смещение подписи по горизонтали"
            : "Смещение подписи по вертикали"}
          : {current[axis]} px
          <input
            type="range"
            disabled={hidden}
            min={-2000}
            max={2000}
            step={1}
            value={current[axis]}
            onChange={(event) =>
              onChange({
                ...current,
                [axis]: event.currentTarget.valueAsNumber,
              })
            }
          />
        </label>
      ))}
      <p>
        {optionalTitle
          ? "Название в списке сцен сохраняется независимо от этой настройки."
          : "Перемещается подпись, не точка локации."}{" "}
        У края экрана положение ограничивается видимой областью.
      </p>
      <button type="button" onClick={() => onChange(null)}>
        Сбросить оформление и смещение
      </button>
      {!hidden && (
        <div aria-label="Пример оформления подписи">
          <CartographicLabel
            text={name || "Название"}
            presentation={current.presentation}
          />
        </div>
      )}
    </fieldset>
  );
}

import { useEffect, useId, useState } from "react";
import type { AssetDto } from "@arken/contracts";
import { formatApiError } from "./api";
import { Button } from "./design-system/Button";

/**
 * UIX-457: выбор рамки бросков. Радиогруппа из постеров — статичных кадров,
 * чтобы список из десятка рамок не крутил десяток анимаций. Один компонент
 * для личной рамки игрока и для рамки навыка у мастера.
 */
export function DiceFramePicker({
  legend,
  frames,
  value,
  disabled = false,
  noneLabel = "Без рамки",
  emptyMessage = "Мастер ещё не загрузил рамки: они появятся в медиатеке кампании.",
  onManageFrames,
  onChange,
}: {
  legend: string;
  frames: readonly AssetDto[];
  value: string | null;
  disabled?: boolean;
  noneLabel?: string;
  emptyMessage?: string;
  onManageFrames?: () => void;
  onChange: (assetId: string | null) => void;
}) {
  const name = useId();
  const options: Array<{ id: string | null; label: string; src?: string }> = [
    { id: null, label: noneLabel },
    ...frames.map((frame) => ({
      id: frame.id,
      label: frame.name,
      src: frame.posterUrl ?? frame.url,
    })),
  ];
  return (
    <fieldset className="dice-frame-picker" disabled={disabled}>
      <legend>{legend}</legend>
      {frames.length === 0 ? (
        <div className="dice-frame-picker__empty">
          <p className="muted">{emptyMessage}</p>
          {onManageFrames ? (
            <Button view="outlined" size="s" onClick={onManageFrames}>
              Открыть медиатеку
            </Button>
          ) : null}
        </div>
      ) : null}
      <div className="dice-frame-picker__options">
        {options.map((option) => (
          <label
            key={option.id ?? "none"}
            className="dice-frame-picker__option"
          >
            <input
              type="radio"
              name={name}
              checked={value === option.id}
              onChange={() => onChange(option.id)}
            />
            <span className="dice-frame-picker__preview" aria-hidden="true">
              {option.src ? <img src={option.src} alt="" /> : null}
            </span>
            <span className="dice-frame-picker__label">{option.label}</span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}

/** Личная рамка игрока: сохраняется сразу, ошибка остаётся рядом с выбором. */
export function PersonalDiceFrameSettings({
  frames,
  value,
  onSave,
  isGm = false,
  onOpenFrameLibrary,
}: {
  frames: readonly AssetDto[];
  value: string | null;
  onSave: (assetId: string | null) => Promise<void>;
  isGm?: boolean;
  onOpenFrameLibrary?: () => void;
}) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  // Выбор отмечается сразу и откатывается, только если сервер отказал.
  const [selected, setSelected] = useState(value);
  useEffect(() => setSelected(value), [value]);
  return (
    <section className="personal-dice-frame" aria-busy={pending}>
      <DiceFramePicker
        legend="Рамка ваших бросков"
        frames={frames}
        value={selected}
        disabled={pending}
        emptyMessage={
          isGm
            ? "В этой кампании пока нет рамок бросков. В медиатеке загрузите файл в разделе «Рамки бросков»."
            : "В кампании пока нет рамок бросков. Попросите мастера добавить их в медиатеку; пока можно выбрать «Без рамки»."
        }
        onManageFrames={isGm ? onOpenFrameLibrary : undefined}
        onChange={(next) => {
          if (pending || next === selected) return;
          setSelected(next);
          setPending(true);
          setError("");
          void onSave(next)
            .catch((reason: unknown) => {
              setSelected(value);
              setError(
                formatApiError(
                  reason,
                  "Не удалось подтвердить сохранение. Показан предыдущий выбор.",
                ),
              );
            })
            .finally(() => setPending(false));
        }}
      />
      <p className="muted">
        Сохраняется сразу, отдельно от темы. Рамка навыка, назначенная мастером,
        важнее личной; критический бросок всегда показывает свою.
      </p>
      {error ? (
        <div role="alert">{error}</div>
      ) : null}
    </section>
  );
}

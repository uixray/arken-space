import { Minus, Plus } from "lucide-react";
import "./NumberStepper.css";

export interface NumberStepperProps {
  label: string;
  value: number;
  min?: number;
  max?: number;
  step?: number;
  disabled?: boolean;
  note?: string;
  onUpdate: (value: number) => void;
}

export function NumberStepper({
  label,
  value,
  min,
  max,
  step = 1,
  disabled,
  note,
  onUpdate,
}: NumberStepperProps) {
  const handleDecrement = () => {
    const next = Number((value - step).toFixed(4));
    if (min === undefined || next >= min) {
      onUpdate(next);
    }
  };

  const handleIncrement = () => {
    const next = Number((value + step).toFixed(4));
    if (max === undefined || next <= max) {
      onUpdate(next);
    }
  };

  return (
    <div className="arken-number-stepper">
      {label && <span className="arken-number-stepper__label">{label}</span>}
      <div className="arken-number-stepper__controls">
        <button
          type="button"
          disabled={disabled || (min !== undefined && value <= min)}
          onClick={handleDecrement}
          className="arken-number-stepper__btn"
          aria-label="Уменьшить"
        >
          <Minus size={14} />
        </button>
        <input
          type="number"
          className="arken-number-stepper__input"
          value={value}
          min={min}
          max={max}
          step={step}
          disabled={disabled}
          aria-label={label}
          onChange={(e) => {
            const val = parseFloat(e.target.value);
            if (Number.isFinite(val)) onUpdate(val);
          }}
        />
        <button
          type="button"
          disabled={disabled || (max !== undefined && value >= max)}
          onClick={handleIncrement}
          className="arken-number-stepper__btn"
          aria-label="Увеличить"
        >
          <Plus size={14} />
        </button>
      </div>
      {note && <span className="arken-number-stepper__note">{note}</span>}
    </div>
  );
}

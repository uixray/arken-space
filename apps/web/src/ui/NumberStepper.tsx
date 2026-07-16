import { NumberInput } from "@gravity-ui/uikit";

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
  return (
    <NumberInput
      label={label}
      value={value}
      min={min}
      max={max}
      step={step}
      size="l"
      disabled={disabled}
      note={note}
      onUpdate={(nextValue) => {
        if (nextValue !== null && Number.isFinite(nextValue))
          onUpdate(nextValue);
      }}
    />
  );
}

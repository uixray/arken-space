import {
  forwardRef,
  useId,
  useState,
  type ChangeEvent,
  type CSSProperties,
  type FocusEventHandler,
  type InputHTMLAttributes,
  type ReactNode,
  type Ref,
} from "react";
import "./Switch.css";

export type SwitchSize = "s" | "m" | "l";

export interface SwitchProps {
  id?: string;
  name?: string;
  value?: string;
  checked?: boolean;
  defaultChecked?: boolean;
  disabled?: boolean;
  size?: SwitchSize;
  className?: string;
  style?: CSSProperties;
  title?: string;
  tabIndex?: number;
  children?: ReactNode;
  content?: ReactNode;
  controlRef?: Ref<HTMLInputElement>;
  controlProps?: InputHTMLAttributes<HTMLInputElement>;
  onChange?: (event: ChangeEvent<HTMLInputElement>) => void;
  onUpdate?: (checked: boolean) => void;
  onFocus?: FocusEventHandler<HTMLInputElement>;
  onBlur?: FocusEventHandler<HTMLInputElement>;
  "aria-label"?: string;
  "aria-labelledby"?: string;
  "aria-describedby"?: string;
  qa?: string;
}

function cx(...values: Array<string | false | null | undefined>) {
  return values.filter(Boolean).join(" ");
}

function mergeRefs<T>(...refs: Array<Ref<T> | undefined>) {
  return (instance: T | null) => {
    for (const ref of refs) {
      if (!ref) continue;
      if (typeof ref === "function") {
        ref(instance);
      } else if (typeof ref === "object" && "current" in ref) {
        (ref as React.MutableRefObject<T | null>).current = instance;
      }
    }
  };
}

export const Switch = forwardRef<HTMLInputElement, SwitchProps>(function Switch(
  {
    id: idProp,
    name,
    value,
    checked: controlledChecked,
    defaultChecked = false,
    disabled = false,
    size = "m",
    className,
    style,
    title,
    tabIndex,
    children,
    content,
    controlRef,
    controlProps,
    onChange,
    onUpdate,
    onFocus,
    onBlur,
    "aria-label": ariaLabel,
    "aria-labelledby": ariaLabelledBy,
    "aria-describedby": ariaDescribedBy,
    qa,
  },
  ref,
) {
  const autoId = useId();
  const id = idProp ?? autoId;

  const isControlled = controlledChecked !== undefined;
  const [uncontrolledChecked, setUncontrolledChecked] =
    useState(defaultChecked);
  const isChecked = isControlled ? controlledChecked : uncontrolledChecked;

  const combinedRef = mergeRefs(ref, controlRef);
  const labelText = children ?? content;

  const handleChange = (e: ChangeEvent<HTMLInputElement>) => {
    if (disabled) return;
    if (!isControlled) {
      setUncontrolledChecked(e.target.checked);
    }
    onChange?.(e);
    onUpdate?.(e.target.checked);
  };

  const rootClassName = cx(
    "arken-switch",
    "arken-switch",
    `arken-switch--${size}`,
    `arken-switch--size-${size}`,
    isChecked && "arken-switch--checked",
    disabled && "arken-switch--disabled",
    className,
  );

  return (
    <label
      className={rootClassName}
      style={style}
      title={title}
      data-qa={qa}
      htmlFor={id}
    >
      <input
        {...controlProps}
        ref={combinedRef}
        id={id}
        type="checkbox"
        role="switch"
        name={name}
        value={value}
        checked={isChecked}
        disabled={disabled}
        tabIndex={tabIndex}
        aria-label={ariaLabel}
        aria-labelledby={ariaLabelledBy}
        aria-describedby={ariaDescribedBy}
        className="arken-switch__input arken-switch__control"
        onChange={handleChange}
        onFocus={onFocus}
        onBlur={onBlur}
      />
      <span className="arken-switch__track" aria-hidden="true">
        <span className="arken-switch__thumb" aria-hidden="true" />
      </span>
      {labelText ? (
        <span className="arken-switch__text">{labelText}</span>
      ) : null}
    </label>
  );
});

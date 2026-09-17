import {
  Children,
  isValidElement,
  useLayoutEffect,
  useRef,
  useState,
  type ChangeEvent,
  type InputHTMLAttributes,
  type ReactElement,
  type ReactNode,
  type Ref,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
} from "react";
import { Checkbox, Select, TextArea, TextInput } from "@gravity-ui/uikit";

import {
  buildFormSelectUtilityOptions,
  FORM_SELECT_CREATE_VALUE,
} from "./formSelectOptions";
import { useOverlayPopupClassName } from "./overlay-owner";

export function FormInput({
  size: _size,
  value,
  children,
  defaultValue,
  type,
  checked,
  defaultChecked,
  onChange,
  controlRef,
  ...props
}: Omit<InputHTMLAttributes<HTMLInputElement>, "size"> & {
  size?: number;
  /**
   * UIX-532: ref на сам контрол. Нужен, чтобы донести до поля чужую правку, не
   * пересоздавая его (см. `remote-field-value.ts`); собственный ref у обёртки
   * указывал бы на разметку uikit, а не на поле.
   */
  controlRef?: Ref<HTMLInputElement>;
}) {
  if (type === "checkbox")
    return (
      /* UIX-532: подпись отдаётся самому флажку, а не обёртке вокруг него.
         Раньше вызывающий код заворачивал этот `Checkbox` в собственный
         `<label>`, а uikit рисует свой внутри — вложенные `<label>` не
         связываются, и поле оставалось без имени. Заодно возвращается клик по
         подписи: он снова переключает флажок. */
      <Checkbox
        className={props.className}
        style={props.style}
        title={props.title}
        id={props.id}
        value={value}
        controlRef={controlRef}
        controlProps={{ ...props, className: undefined, style: undefined }}
        checked={checked}
        defaultChecked={defaultChecked}
        disabled={props.disabled}
        name={props.name}
        onFocus={props.onFocus}
        onBlur={props.onBlur}
        onChange={onChange}
      >
        {children}
      </Checkbox>
    );
  if (type === "file")
    return (
      <input {...props} ref={controlRef} type="file" onChange={onChange} />
    );
  // TextInput supports textual controls only: color must keep its native
  // picker, value and real input ref/events rather than silently becoming text.
  if (type === "color")
    return (
      <input
        {...props}
        ref={controlRef}
        type="color"
        // Global text-input padding would otherwise collapse the native swatch.
        style={{ minHeight: 36, padding: 4, ...props.style }}
        value={value}
        defaultValue={defaultValue}
        onChange={onChange}
      />
    );
  const gravityType =
    (
      ["number", "search", "url", "email", "password", "tel", "text"] as const
    ).find((candidate) => candidate === type) ?? "text";
  return (
    <TextInput
      {...props}
      controlRef={controlRef}
      // Native constraints and ARIA descriptions are not top-level uikit props.
      controlProps={{ ...props, className: undefined, style: undefined }}
      // uikit overwrites controlProps['aria-invalid'] from validationState.
      validationState={
        props["aria-invalid"] && props["aria-invalid"] !== "false"
          ? "invalid"
          : undefined
      }
      onChange={onChange}
      type={gravityType}
      value={value === undefined ? undefined : String(value)}
      defaultValue={
        defaultValue === undefined ? undefined : String(defaultValue)
      }
    />
  );
}

export function FormTextArea({
  value,
  defaultValue,
  controlRef,
  onChange,
  ...props
}: TextareaHTMLAttributes<HTMLTextAreaElement> & {
  controlRef?: Ref<HTMLTextAreaElement>;
}) {
  return (
    <TextArea
      {...props}
      controlRef={controlRef}
      // TextArea's outer props describe its wrapper. Native constraints,
      // clipboard handlers and ARIA relationships belong to the real control.
      controlProps={{ ...props, className: undefined, style: undefined }}
      validationState={
        props["aria-invalid"] && props["aria-invalid"] !== "false"
          ? "invalid"
          : undefined
      }
      onChange={onChange}
      value={value === undefined ? undefined : String(value)}
      defaultValue={
        defaultValue === undefined ? undefined : String(defaultValue)
      }
    />
  );
}

type OptionProps = { value?: string | number; children?: ReactNode };
// Native option labels may be JSX arrays of text/number expressions. Gravity
// needs a plain text hint for the collapsed label and type-ahead search.
function optionText(children: ReactNode): string | undefined {
  const parts = Children.toArray(children);
  return parts.every(
    (part) => typeof part === "string" || typeof part === "number",
  )
    ? parts.join("")
    : undefined;
}

type FormSelectProps = SelectHTMLAttributes<HTMLSelectElement> & {
  emptyMessage?: ReactNode;
  createAction?: { label: ReactNode; onSelect: () => void };
};

export function FormSelect({
  children,
  value,
  defaultValue,
  onChange,
  disabled,
  name,
  "aria-label": ariaLabel,
  emptyMessage,
  createAction,
  id,
  title,
  className,
  "aria-labelledby": ariaLabelledBy,
  "aria-describedby": ariaDescribedBy,
  "aria-details": ariaDetails,
  "aria-invalid": ariaInvalid,
}: FormSelectProps) {
  const [uncontrolledValue, setUncontrolledValue] = useState(() =>
    String(defaultValue ?? ""),
  );
  // The fading popup can retain Gravity List active-index state after close.
  // Give each open/closed phase its own list to avoid replaying that state
  // into a keyboard reopen. Selection stays in the Select, not this subtree.
  const [open, setOpen] = useState(false);
  const controlRef = useRef<HTMLButtonElement>(null);
  const [popupWidth, setPopupWidth] = useState<number>();
  useLayoutEffect(() => {
    if (!open || !controlRef.current) return;
    const control = controlRef.current;
    let frame = 0;
    const measure = () => {
      const width = control.getBoundingClientRect().width;
      // Size our popup content independently of UIKit's cached floating width.
      // Respect Floating UI's 10px viewport padding on either side.
      setPopupWidth(
        width > 0
          ? Math.max(1, Math.min(width, window.innerWidth - 20))
          : undefined,
      );
    };
    const schedule = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(measure);
    };
    measure();
    const observer =
      typeof ResizeObserver === "undefined"
        ? undefined
        : new ResizeObserver(schedule);
    observer?.observe(control);
    window.addEventListener("resize", schedule);
    return () => {
      observer?.disconnect();
      window.removeEventListener("resize", schedule);
      cancelAnimationFrame(frame);
    };
  }, [open]);
  const popupClassName = useOverlayPopupClassName("arken-form-select-popup");
  const childOptions = Children.toArray(children)
    .filter(
      (child): child is ReactElement<OptionProps> =>
        isValidElement<OptionProps>(child) && child.type === "option",
    )
    .map((child) => ({
      value: String(child.props.value ?? ""),
      content: child.props.children,
      text: optionText(child.props.children),
      disabled: Boolean(
        (child.props as OptionProps & { disabled?: boolean }).disabled,
      ),
    }));
  const options = [
    ...childOptions,
    ...buildFormSelectUtilityOptions(emptyMessage, createAction?.label),
  ];
  const selected = value ?? uncontrolledValue;

  return (
    <Select
      name={name}
      id={id}
      title={title}
      className={className}
      aria-label={ariaLabel}
      aria-labelledby={ariaLabelledBy}
      aria-describedby={ariaDescribedBy}
      aria-details={ariaDetails}
      validationState={
        ariaInvalid && ariaInvalid !== "false" ? "invalid" : undefined
      }
      disabled={disabled}
      ref={controlRef}
      popupClassName={popupClassName}
      onOpenChange={setOpen}
      renderPopup={({ renderFilter, renderList }) => (
        <div
          key={open ? "open" : "closed"}
          className="arken-form-select-popup__content"
          style={{ minWidth: popupWidth }}
        >
          {renderFilter()}
          {renderList()}
        </div>
      )}
      options={options}
      value={[String(selected)]}
      onUpdate={(next) => {
        if (next[0] === FORM_SELECT_CREATE_VALUE) {
          createAction?.onSelect();
          return;
        }
        if (value === undefined) setUncontrolledValue(next[0] ?? "");
        onChange?.({
          target: { value: next[0] ?? "" },
          currentTarget: { value: next[0] ?? "" },
        } as ChangeEvent<HTMLSelectElement>);
      }}
    />
  );
}

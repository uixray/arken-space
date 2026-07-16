import {
  Children,
  isValidElement,
  type ChangeEvent,
  type InputHTMLAttributes,
  type ReactElement,
  type ReactNode,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
} from "react";
import { Checkbox, Select, TextArea, TextInput } from "@gravity-ui/uikit";

export function FormInput({
  size: _size,
  value,
  defaultValue,
  type,
  checked,
  defaultChecked,
  onChange,
  ...props
}: Omit<InputHTMLAttributes<HTMLInputElement>, "size"> & { size?: number }) {
  if (type === "checkbox")
    return (
      <Checkbox
        checked={checked}
        defaultChecked={defaultChecked}
        disabled={props.disabled}
        name={props.name}
        aria-label={props["aria-label"]}
        onUpdate={(next) =>
          onChange?.({
            target: { checked: next, value: next ? "on" : "" },
            currentTarget: { checked: next, value: next ? "on" : "" },
          } as ChangeEvent<HTMLInputElement>)
        }
      />
    );
  if (type === "file")
    return <input {...props} type="file" onChange={onChange} />;
  const gravityType =
    (
      ["number", "search", "url", "email", "password", "tel", "text"] as const
    ).find((candidate) => candidate === type) ?? "text";
  return (
    <TextInput
      {...props}
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
  ...props
}: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return (
    <TextArea
      {...props}
      value={value === undefined ? undefined : String(value)}
      defaultValue={
        defaultValue === undefined ? undefined : String(defaultValue)
      }
    />
  );
}

type OptionProps = { value?: string | number; children?: ReactNode };

export function FormSelect({
  children,
  value,
  defaultValue,
  onChange,
  disabled,
  name,
  "aria-label": ariaLabel,
}: SelectHTMLAttributes<HTMLSelectElement>) {
  const options = Children.toArray(children)
    .filter(
      (child): child is ReactElement<OptionProps> =>
        isValidElement<OptionProps>(child) && child.type === "option",
    )
    .map((child) => ({
      value: String(child.props.value ?? ""),
      content: child.props.children,
      disabled: Boolean(
        (child.props as OptionProps & { disabled?: boolean }).disabled,
      ),
    }));
  const selected = value ?? defaultValue ?? "";

  return (
    <Select
      name={name}
      aria-label={ariaLabel}
      disabled={disabled}
      options={options}
      value={[String(selected)]}
      onUpdate={(next) => {
        onChange?.({
          target: { value: next[0] ?? "" },
          currentTarget: { value: next[0] ?? "" },
        } as ChangeEvent<HTMLSelectElement>);
      }}
    />
  );
}

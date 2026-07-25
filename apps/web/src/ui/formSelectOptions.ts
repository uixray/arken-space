import type { ReactNode } from "react";

export const FORM_SELECT_CREATE_VALUE = "__arken_create__";

export function buildFormSelectUtilityOptions(
  emptyMessage?: ReactNode,
  createLabel?: ReactNode,
) {
  return [
    ...(emptyMessage
      ? [{ value: "__arken_empty__", content: emptyMessage, disabled: true }]
      : []),
    ...(createLabel
      ? [
          {
            value: FORM_SELECT_CREATE_VALUE,
            content: createLabel,
            disabled: false,
          },
        ]
      : []),
  ];
}

import {
  TOKEN_CONDITION_LABEL,
  tokenConditionSchema,
  type TokenDto,
} from "@arken/contracts";
import type { SceneRendererProps } from "./SceneRenderer";

export function TokenConditionMenu({
  token,
  role,
  onChange,
  onClose,
}: {
  token: TokenDto;
  role: SceneRendererProps["role"];
  onChange: SceneRendererProps["onTokenConditionsChange"];
  onClose: () => void;
}) {
  if (role !== "GM" || !onChange) return null;
  return (
    <div
      className="token-condition-menu"
      role="group"
      aria-label="Состояния токена"
    >
      {tokenConditionSchema.options.map((condition) => {
        const checked = token.conditions.includes(condition);
        return (
          <button
            key={condition}
            type="button"
            role="menuitemcheckbox"
            aria-checked={checked}
            onClick={() => {
              onClose();
              void onChange(
                token.id,
                token.revision,
                checked
                  ? token.conditions.filter((value) => value !== condition)
                  : [...token.conditions, condition],
              ).catch(() => {
                // The application mutation runner presents the server error.
                // No optimistic state was applied, so nothing needs rollback.
              });
            }}
          >
            {checked ? "✓ " : ""}
            {TOKEN_CONDITION_LABEL[condition]}
          </button>
        );
      })}
    </div>
  );
}

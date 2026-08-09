import { Button } from "@gravity-ui/uikit";
import { humanizeFormula } from "../formula-display";

/**
 * UIX-389: shared two-line presentation for a rollable characteristic/skill —
 * name on its own line, humanized formula on its own line below, still a
 * single clickable button. Used by the combat-characteristics card and the
 * legacy character.skills list so both read the same way.
 *
 * UIX-391: also reused by CatalogEntryPicker to preview/select catalog
 * entries before assigning them to a character.
 */
export function RollButton({
  name,
  formula,
  disabled,
  onClick,
}: {
  name: string;
  formula: string;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <Button className="roll-button" disabled={disabled} onClick={onClick}>
      <span className="roll-button__name">{name}</span>
      <code className="roll-button__formula">{humanizeFormula(formula)}</code>
    </Button>
  );
}

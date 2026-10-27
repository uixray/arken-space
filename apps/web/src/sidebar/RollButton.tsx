import { Button } from "../design-system/Button";
import { humanizeFormula } from "../formula-display";
import { useCampaignStatLabels } from "../campaign-stat-labels-context";
import type { MouseEvent } from "react";
import { AppIcon } from "../ui/AppIcon";
import { DiceTrayIcon } from "../ui/icons";

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
  statLabels,
  showDiceIcon = true,
}: {
  name: string;
  formula: string;
  disabled?: boolean;
  onClick: (event: MouseEvent<HTMLButtonElement>) => void;
  statLabels?: Readonly<Record<string, string>>;
  /** Catalog picker reuses this layout for assignment, not a roll action. */
  showDiceIcon?: boolean;
}) {
  const campaignStatLabels = useCampaignStatLabels();
  return (
    <Button className="roll-button" disabled={disabled} onClick={onClick}>
      <span className="roll-button__name">
        {showDiceIcon && <AppIcon icon={DiceTrayIcon} />}
        {name}
      </span>
      <code className="roll-button__formula">
        {humanizeFormula(formula, statLabels ?? campaignStatLabels)}
      </code>
    </Button>
  );
}

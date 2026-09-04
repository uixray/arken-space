import { Button } from "@gravity-ui/uikit";
import { humanizeFormula } from "../formula-display";
import { useCampaignStatLabels } from "../campaign-stat-labels-context";

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
}: {
  name: string;
  formula: string;
  disabled?: boolean;
  onClick: () => void;
  statLabels?: Readonly<Record<string, string>>;
}) {
  const campaignStatLabels = useCampaignStatLabels();
  return (
    <Button className="roll-button" disabled={disabled} onClick={onClick}>
      <span className="roll-button__name">{name}</span>
      <code className="roll-button__formula">
        {humanizeFormula(formula, statLabels ?? campaignStatLabels)}
      </code>
    </Button>
  );
}

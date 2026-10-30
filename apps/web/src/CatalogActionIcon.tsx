import { AppIcon } from "./ui/AppIcon";
import {
  BattleIcon,
  CustomActionIcon,
  DamageActionIcon,
  DefenseActionIcon,
  HealingActionIcon,
  MagicActionIcon,
  MovementActionIcon,
} from "./ui/icons";

/** Stable semantic icon choice for catalog actions, including custom ability names. */
export function CatalogActionIcon({
  kind,
  semanticText = "",
}: {
  kind: "HIT" | "DAMAGE" | "CUSTOM";
  semanticText?: string;
}) {
  const normalized = semanticText.toLocaleLowerCase("ru");
  const semanticIcons = [
    CustomActionIcon,
    MagicActionIcon,
    DefenseActionIcon,
    MovementActionIcon,
    HealingActionIcon,
  ];
  let icon =
    semanticIcons[
      Array.from(semanticText).reduce(
        (sum, char) => sum + char.charCodeAt(0),
        0,
      ) % semanticIcons.length
    ]!;
  if (/леч|исцел|здоров|восстанов/.test(normalized)) icon = HealingActionIcon;
  else if (/защит|щит|брон|блок/.test(normalized)) icon = DefenseActionIcon;
  else if (/движ|шаг|прыж|скорост|телепорт/.test(normalized))
    icon = MovementActionIcon;
  else if (/маг|заклин|чар|руна|огнен|ледян|молни/.test(normalized))
    icon = MagicActionIcon;
  else if (kind === "HIT") icon = BattleIcon;
  else if (kind === "DAMAGE") icon = DamageActionIcon;
  return <AppIcon icon={icon} />;
}

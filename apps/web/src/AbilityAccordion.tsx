import type { ReactNode } from "react";
import type { CharacterCatalogEntryDto } from "@arken/contracts";
import { abilityDisplayName, abilityCost } from "./ability-presentation";
export function AbilityAccordion({
  entry,
  children,
}: {
  entry: CharacterCatalogEntryDto;
  children: ReactNode;
}) {
  const name = abilityDisplayName(entry.name);
  return (
    <details className="ability-accordion">
      <summary title={name}>
        <span className="ability-accordion__name">{name}</span>
        <span className="ability-accordion__cost">{abilityCost(entry)}</span>
      </summary>
      <div className="ability-accordion__body">{children}</div>
    </details>
  );
}

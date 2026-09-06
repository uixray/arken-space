import type { CompactSurface } from "./ui/useCompactNavigation";

const surfaces = [
  { id: "map", label: "Карта", controls: "main-content" },
  { id: "journal", label: "Журнал", controls: "activity-sidebar" },
  { id: "character", label: "Персонаж", controls: "character-workspace" },
] as const;

/** Один переключатель представления, без копии игрового состояния. */
export function CompactNavigation({
  active,
  onSelect,
  characterVisited,
  characterAvailable = true,
}: {
  active: CompactSurface;
  onSelect: (surface: CompactSurface) => void;
  characterVisited: boolean;
  characterAvailable?: boolean;
}) {
  return (
    <nav className="compact-navigation" aria-label="Основные области">
      {surfaces
        .filter(({ id }) => id !== "character" || characterAvailable)
        .map(({ id, label, controls }) => (
          <button
            key={id}
            id={`compact-nav-${id}`}
            type="button"
            aria-controls={
              id === "character" && !characterVisited ? undefined : controls
            }
            aria-pressed={active === id}
            onClick={() => onSelect(id)}
          >
            {label}
          </button>
        ))}
    </nav>
  );
}

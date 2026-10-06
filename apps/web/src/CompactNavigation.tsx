import type { CompactSurface } from "./ui/useCompactNavigation";
import { AppIcon } from "./ui/AppIcon";
import {
  CharacterSurfaceIcon,
  JournalSurfaceIcon,
  MapSurfaceIcon,
  MenuSurfaceIcon,
} from "./ui/icons";

const surfaces = [
  { id: "map", label: "Карта", icon: MapSurfaceIcon, controls: "main-content" },
  {
    id: "journal",
    label: "Журнал",
    icon: JournalSurfaceIcon,
    controls: "activity-sidebar",
  },
  {
    id: "character",
    label: "Персонаж",
    icon: CharacterSurfaceIcon,
    controls: "character-workspace",
  },
  {
    id: "menu",
    label: "Меню",
    icon: MenuSurfaceIcon,
    controls: "compact-menu-view",
  },
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
        .map(({ id, label, icon, controls }) => (
          <button
            key={id}
            id={`compact-nav-${id}`}
            type="button"
            className={`compact-nav-btn${active === id ? " is-active" : ""}`}
            aria-controls={
              id === "character" && !characterVisited ? undefined : controls
            }
            aria-pressed={active === id}
            onClick={() => onSelect(id)}
          >
            <AppIcon icon={icon} className="compact-nav-icon" />
            <span className="compact-nav-label">{label}</span>
          </button>
        ))}
    </nav>
  );
}

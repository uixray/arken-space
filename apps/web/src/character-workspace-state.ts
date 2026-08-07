import type { CharacterDto } from "@arken/contracts";

export const MAX_OPEN_CHARACTER_SHEETS = 3;

export type CharacterWorkspaceState = {
  openIds: string[];
  activeId: string | null;
  collapsedIds: string[];
};

export type CharacterWorkspaceAction =
  | { type: "OPEN"; id: string }
  | { type: "OPEN_EXCLUSIVE"; id: string }
  | { type: "FOCUS"; id: string }
  | { type: "COLLAPSE"; id: string }
  | { type: "RESTORE"; id: string }
  | { type: "CLOSE"; id: string }
  | { type: "SYNC"; ids: string[] };

export function createCharacterWorkspaceState(
  ids: string[],
): CharacterWorkspaceState {
  const firstId = ids[0] ?? null;
  return {
    openIds: firstId ? [firstId] : [],
    activeId: firstId,
    collapsedIds: [],
  };
}

function focusAfter(
  openIds: string[],
  collapsedIds: string[],
  closingId: string,
): string | null {
  return (
    openIds.find((id) => id !== closingId && !collapsedIds.includes(id)) ??
    openIds.find((id) => id !== closingId) ??
    null
  );
}

export function characterWorkspaceReducer(
  state: CharacterWorkspaceState,
  action: CharacterWorkspaceAction,
): CharacterWorkspaceState {
  switch (action.type) {
    case "OPEN_EXCLUSIVE":
      return { openIds: [action.id], activeId: action.id, collapsedIds: [] };
    case "OPEN": {
      if (state.openIds.includes(action.id)) {
        return {
          ...state,
          activeId: action.id,
          collapsedIds: state.collapsedIds.filter((id) => id !== action.id),
        };
      }
      if (state.openIds.length >= MAX_OPEN_CHARACTER_SHEETS) return state;
      return {
        ...state,
        openIds: [...state.openIds, action.id],
        activeId: action.id,
      };
    }
    case "FOCUS":
      return state.openIds.includes(action.id)
        ? { ...state, activeId: action.id }
        : state;
    case "COLLAPSE": {
      if (!state.openIds.includes(action.id)) return state;
      const collapsedIds = state.collapsedIds.includes(action.id)
        ? state.collapsedIds
        : [...state.collapsedIds, action.id];
      return {
        ...state,
        collapsedIds,
        activeId:
          state.activeId === action.id
            ? focusAfter(state.openIds, collapsedIds, action.id)
            : state.activeId,
      };
    }
    case "RESTORE":
      return state.openIds.includes(action.id)
        ? {
            ...state,
            activeId: action.id,
            collapsedIds: state.collapsedIds.filter((id) => id !== action.id),
          }
        : state;
    case "CLOSE": {
      if (!state.openIds.includes(action.id)) return state;
      const openIds = state.openIds.filter((id) => id !== action.id);
      const collapsedIds = state.collapsedIds.filter((id) => id !== action.id);
      return {
        openIds,
        collapsedIds,
        activeId:
          state.activeId === action.id
            ? focusAfter(openIds, collapsedIds, action.id)
            : state.activeId,
      };
    }
    case "SYNC": {
      const ids = new Set(action.ids);
      const openIds = state.openIds.filter((id) => ids.has(id));
      const collapsedIds = state.collapsedIds.filter((id) =>
        openIds.includes(id),
      );
      const activeId =
        state.activeId && openIds.includes(state.activeId)
          ? state.activeId
          : (openIds.find((id) => !collapsedIds.includes(id)) ??
            openIds[0] ??
            null);
      return { openIds, collapsedIds, activeId };
    }
  }
}

/** Guards the rail against duplicate delivery during HTTP/realtime reconciliation. */
export function uniqueCharacterIds(ids: readonly string[]): string[] {
  return [...new Set(ids)];
}

/**
 * Structural fields a "create from template" preset carries over from an existing
 * character — stat blocks, skills, spells, inventory and resources. Deliberately
 * excludes identity (name, portrait, owner/controllers), narrative text
 * (notes/backstory) and wallet: those belong to the specific character, not its
 * structure, and a template should not silently clone a teammate's gold or bio.
 */
export type CharacterTemplateFields = Pick<
  CharacterDto,
  "stats" | "skills" | "spells" | "inventory" | "resources"
>;

/**
 * Derives an editable, independent preset from an existing character's structure
 * for GM-driven "create character based on X" flows. Every field is deep-cloned so
 * neither the source nor the new character can mutate the other after creation —
 * this is a one-time copy, never a live link.
 */
export function extractCharacterTemplateFields(
  source: CharacterDto,
): CharacterTemplateFields {
  return {
    stats: { ...source.stats },
    skills: source.skills.map((skill) => ({ ...skill })),
    spells: source.spells.map((spell) => ({ ...spell })),
    inventory: [...source.inventory],
    resources: Object.fromEntries(
      Object.entries(source.resources).map(([key, value]) => [
        key,
        { ...value },
      ]),
    ),
  };
}

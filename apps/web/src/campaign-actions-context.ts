import {
  createContext,
  useContext,
  useMemo,
  type PointerEvent as ReactPointerEvent,
} from "react";
import type { MessageVisibility } from "@arken/contracts";
import type { CharacterTemplateFields } from "./character-workspace-state";
import type { CharacterActions } from "./use-character-actions";
import type { InitiativeActions } from "./use-initiative-actions";
import type { RollMode } from "./RollModeControl";
import type { SceneActions } from "./use-scene-actions";
import type { WorldMapActions } from "./use-world-map-actions";
import type { TokenDefinitionActions } from "./use-token-definition-actions";
import type { ChatActions } from "./use-chat-actions";
import type { AccessActions } from "./use-access-actions";
import type { CatalogActions } from "./use-catalog-actions";
import type { StoryActions } from "./use-story-actions";
import type { PlayerRequestActions } from "./use-player-request-actions";
import type { AssetActions } from "./use-asset-actions";
import type { StatLayoutActions } from "./use-stat-layout-actions";
import type { ChatHistoryActions } from "./use-chat-history-actions";

/**
 * UIX-398 step B — campaign commands, delivered by context instead of by
 * threading dozens of props through every layer.
 *
 * **The invariant this rests on: nothing in here may be a changing value.**
 * Context has no selective subscription — every consumer re-renders whenever
 * the provider's value changes — so a context carrying state would be a
 * performance trap rather than a fix. `useCampaignActionsValue` preserves the
 * value when its flattened command functions are unchanged; App keeps live
 * callback closures stable with latest refs.
 *
 * Put `snapshot`, a selected id, or any other live value in here and that
 * guarantee is gone silently — the app will still work, just re-render
 * everything on every game event. `campaign-actions-context.test.tsx`
 * enforces it by walking the value and rejecting anything that is not a
 * function, so the mistake fails loudly instead.
 *
 * State that components genuinely need still travels as props. Narrowing that
 * is a separate question, deliberately deferred until it can be measured.
 */
export interface CampaignActions {
  scene: SceneActions;
  worldMap: WorldMapActions;
  token: TokenDefinitionActions;
  chat: ChatActions;
  access: AccessActions;
  catalog: CatalogActions;
  story: StoryActions;
  playerRequest: PlayerRequestActions;
  asset: AssetActions;
  statLayout: StatLayoutActions;
  chatHistory: ChatHistoryActions;
  character: CharacterActions & {
    onCreateCharacter: (
      name: string,
      template?: CharacterTemplateFields,
    ) => Promise<void>;
  };
  initiative: Omit<InitiativeActions, "onRecruitFromBattleZone"> & {
    onRecruitFromBattleZone: () => void;
  };
  dice: {
    onRoll: (
      formula: string,
      label?: string,
      visibility?: MessageVisibility,
      characterId?: string | null,
      rollMode?: RollMode,
    ) => Promise<void>;
  };
  campaign: {
    onCampaignClock: (
      command:
        | "ADVANCE_DAY"
        | "LONG_REST"
        | "START_BATTLE"
        | "END_BATTLE"
        | "RESET_CLOCK",
      revision: number,
    ) => Promise<void>;
  };
  player: {
    onPreviewPlayer: (membershipId: string) => Promise<void>;
  };
  sidebar: {
    onRequestedChatMessageHandled: () => void;
    onChatVisibilityChange: (visible: boolean) => void;
    onCollapsedChange: (collapsed: boolean) => void;
    onResizeHandleDown: (event: ReactPointerEvent<HTMLButtonElement>) => void;
    onResizeHandleMove: (event: ReactPointerEvent<HTMLButtonElement>) => void;
    onResizeHandleUp: (event: ReactPointerEvent<HTMLButtonElement>) => void;
    onWorkspaceChange: (
      workspace:
        | "characters"
        | "tokens"
        | "scenes"
        | "story"
        | "setup"
        | "media"
        | "world-maps"
        | "operator-feedback"
        | "player-requests"
        | "world-encyclopedia"
        | "spell-schools"
  | "world-codex"
        | null,
    ) => void;
  };
}

/** Applied directly in `App.tsx`; there is no wrapper component, so this
 * file exports no component and stays a plain module. */
export const CampaignActionsContext = createContext<CampaignActions | null>(
  null,
);

export const CAMPAIGN_ACTION_DOMAIN_KEYS = [
  "scene",
  "worldMap",
  "token",
  "chat",
  "access",
  "catalog",
  "story",
  "playerRequest",
  "asset",
  "statLayout",
  "chatHistory",
  "character",
  "initiative",
  "dice",
  "campaign",
  "player",
  "sidebar",
] as const satisfies readonly (keyof CampaignActions)[];

/** Keep the provider value stable when App rebuilds only action-group containers. */
export function useCampaignActionsValue(
  actions: CampaignActions,
): CampaignActions {
  const commandDependencies = CAMPAIGN_ACTION_DOMAIN_KEYS.flatMap((domain) =>
    Object.values(actions[domain]),
  );
  // Keep this list in the declared group order to make its size/order explicit.
  // The identity behavior is covered across parent state changes in the test.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  return useMemo(() => actions, commandDependencies);
}

export function useCampaignActions(): CampaignActions {
  const actions = useContext(CampaignActionsContext);
  // Throwing beats returning null: a missing provider is a wiring mistake,
  // and every call site would otherwise need a null check for a case that
  // cannot legitimately happen at runtime.
  if (!actions)
    throw new Error(
      "useCampaignActions requires the campaign actions provider",
    );
  return actions;
}

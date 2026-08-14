import { createContext, useContext } from "react";
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

/**
 * UIX-398 step B — campaign commands, delivered by context instead of by
 * threading dozens of props through every layer.
 *
 * **The invariant this rests on: nothing in here may be a changing value.**
 * Context has no selective subscription — every consumer re-renders whenever
 * the provider's value changes — so a context carrying state would be a
 * performance trap rather than a fix. It is safe here only because these are
 * all actions, built once in step A and stable for the component's lifetime,
 * so the value never changes and no consumer ever re-renders because of it.
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
}

/** Applied directly in `App.tsx`; there is no wrapper component, so this
 * file exports no component and stays a plain module. */
export const CampaignActionsContext = createContext<CampaignActions | null>(
  null,
);

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

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
  return useMemo(
    () => ({
      scene: {
        onViewScene: actions.scene.onViewScene,
        onSaveScene: actions.scene.onSaveScene,
        onCreateScene: actions.scene.onCreateScene,
        onActivateScene: actions.scene.onActivateScene,
        onAssignMap: actions.scene.onAssignMap,
        onRenameScene: actions.scene.onRenameScene,
      },
      worldMap: {
        onCreateWorldMap: actions.worldMap.onCreateWorldMap,
        onSetWorldMapDraftBackground:
          actions.worldMap.onSetWorldMapDraftBackground,
        onApproveWorldMapBackground:
          actions.worldMap.onApproveWorldMapBackground,
        onPublishWorldMap: actions.worldMap.onPublishWorldMap,
        onArchiveWorldMap: actions.worldMap.onArchiveWorldMap,
        onArchiveCharacter: actions.worldMap.onArchiveCharacter,
        onRestoreCharacter: actions.worldMap.onRestoreCharacter,
        onLoadArchivedCharacters: actions.worldMap.onLoadArchivedCharacters,
        onCreateWorldMapLocation: actions.worldMap.onCreateWorldMapLocation,
        onUpdateWorldMapLocation: actions.worldMap.onUpdateWorldMapLocation,
        onLinkWorldMapLocationScene:
          actions.worldMap.onLinkWorldMapLocationScene,
        onUnlinkWorldMapLocationScene:
          actions.worldMap.onUnlinkWorldMapLocationScene,
        onSetWorldMapPartyPosition: actions.worldMap.onSetWorldMapPartyPosition,
        onClearWorldMapPartyPosition:
          actions.worldMap.onClearWorldMapPartyPosition,
      },
      token: {
        onPlaceTokenDefinition: actions.token.onPlaceTokenDefinition,
        onDeleteTokenDefinition: actions.token.onDeleteTokenDefinition,
        onPatchTokenDefinition: actions.token.onPatchTokenDefinition,
        onCreateTokenDefinition: actions.token.onCreateTokenDefinition,
        onCreateAndPlaceTokenDefinition:
          actions.token.onCreateAndPlaceTokenDefinition,
        onReplaceTokenControllers: actions.token.onReplaceTokenControllers,
        onCreateToken: actions.token.onCreateToken,
      },
      chat: {
        onChat: actions.chat.onChat,
        onSticker: actions.chat.onSticker,
        onCreateDirectThread: actions.chat.onCreateDirectThread,
        onDirectChat: actions.chat.onDirectChat,
        onUploadChatAttachment: actions.chat.onUploadChatAttachment,
        onActiveChatThreadChange: actions.chat.onActiveChatThreadChange,
        onMarkChatRead: actions.chat.onMarkChatRead,
      },
      access: {
        onCreateInvite: actions.access.onCreateInvite,
        onListPlayerAccess: actions.access.onListPlayerAccess,
        onRotatePlayerAccess: actions.access.onRotatePlayerAccess,
        onRevokePlayerAccess: actions.access.onRevokePlayerAccess,
        onRenameMembership: actions.access.onRenameMembership,
      },
      catalog: {
        onCreateCatalogEntry: actions.catalog.onCreateCatalogEntry,
        onUpdateCatalogEntry: actions.catalog.onUpdateCatalogEntry,
        onDeleteCatalogEntry: actions.catalog.onDeleteCatalogEntry,
        onAssignCatalogEntry: actions.catalog.onAssignCatalogEntry,
        onUpdateCharacterEntry: actions.catalog.onUpdateCharacterEntry,
        onDeleteCharacterEntry: actions.catalog.onDeleteCharacterEntry,
        onRollEntry: actions.catalog.onRollEntry,
        onRechargeEntry: actions.catalog.onRechargeEntry,
      },
      story: {
        onLoadMoreStoryPosts: actions.story.onLoadMoreStoryPosts,
        onCreateStoryDraft: actions.story.onCreateStoryDraft,
        onUpdateStoryPost: actions.story.onUpdateStoryPost,
        onPublishStoryPost: actions.story.onPublishStoryPost,
        onArchiveStoryPost: actions.story.onArchiveStoryPost,
      },
      playerRequest: {
        onOpenPlayerRequestCreate:
          actions.playerRequest.onOpenPlayerRequestCreate,
        onCreatePlayerRequest: actions.playerRequest.onCreatePlayerRequest,
        onUpdatePlayerRequest: actions.playerRequest.onUpdatePlayerRequest,
        onPlayerRequestAction: actions.playerRequest.onPlayerRequestAction,
      },
      asset: {
        replaceAsset: actions.asset.replaceAsset,
        refreshAssets: actions.asset.refreshAssets,
        uploadAsset: actions.asset.uploadAsset,
        getAssetUsage: actions.asset.getAssetUsage,
        deleteAsset: actions.asset.deleteAsset,
        generateTokenImage: actions.asset.generateTokenImage,
      },
      statLayout: {
        onUpdateStatLayout: actions.statLayout.onUpdateStatLayout,
      },
      chatHistory: {
        onLoadThreadHistory: actions.chatHistory.onLoadThreadHistory,
      },
      character: {
        replaceCharacterControllers:
          actions.character.replaceCharacterControllers,
        patchCharacter: actions.character.patchCharacter,
        updateCharacterCounters: actions.character.updateCharacterCounters,
        onCreateCharacter: actions.character.onCreateCharacter,
      },
      initiative: {
        onUpdateInitiative: actions.initiative.onUpdateInitiative,
        onSetOwnInitiative: actions.initiative.onSetOwnInitiative,
        onRollInitiative: actions.initiative.onRollInitiative,
        onSetBattleZone: actions.initiative.onSetBattleZone,
        onRecruitFromBattleZone: actions.initiative.onRecruitFromBattleZone,
      },
      dice: {
        onRoll: actions.dice.onRoll,
      },
      campaign: {
        onCampaignClock: actions.campaign.onCampaignClock,
      },
      player: {
        onPreviewPlayer: actions.player.onPreviewPlayer,
      },
      sidebar: {
        onRequestedChatMessageHandled:
          actions.sidebar.onRequestedChatMessageHandled,
        onChatVisibilityChange: actions.sidebar.onChatVisibilityChange,
        onCollapsedChange: actions.sidebar.onCollapsedChange,
        onResizeHandleDown: actions.sidebar.onResizeHandleDown,
        onResizeHandleMove: actions.sidebar.onResizeHandleMove,
        onResizeHandleUp: actions.sidebar.onResizeHandleUp,
        onWorkspaceChange: actions.sidebar.onWorkspaceChange,
      },
    }),
    [
      actions.scene.onViewScene,
      actions.scene.onSaveScene,
      actions.scene.onCreateScene,
      actions.scene.onActivateScene,
      actions.scene.onAssignMap,
      actions.scene.onRenameScene,
      actions.worldMap.onCreateWorldMap,
      actions.worldMap.onSetWorldMapDraftBackground,
      actions.worldMap.onApproveWorldMapBackground,
      actions.worldMap.onPublishWorldMap,
      actions.worldMap.onArchiveWorldMap,
      actions.worldMap.onArchiveCharacter,
      actions.worldMap.onRestoreCharacter,
      actions.worldMap.onLoadArchivedCharacters,
      actions.worldMap.onCreateWorldMapLocation,
      actions.worldMap.onUpdateWorldMapLocation,
      actions.worldMap.onLinkWorldMapLocationScene,
      actions.worldMap.onUnlinkWorldMapLocationScene,
      actions.worldMap.onSetWorldMapPartyPosition,
      actions.worldMap.onClearWorldMapPartyPosition,
      actions.token.onPlaceTokenDefinition,
      actions.token.onDeleteTokenDefinition,
      actions.token.onPatchTokenDefinition,
      actions.token.onCreateTokenDefinition,
      actions.token.onCreateAndPlaceTokenDefinition,
      actions.token.onReplaceTokenControllers,
      actions.token.onCreateToken,
      actions.chat.onChat,
      actions.chat.onSticker,
      actions.chat.onCreateDirectThread,
      actions.chat.onDirectChat,
      actions.chat.onUploadChatAttachment,
      actions.chat.onActiveChatThreadChange,
      actions.chat.onMarkChatRead,
      actions.access.onCreateInvite,
      actions.access.onListPlayerAccess,
      actions.access.onRotatePlayerAccess,
      actions.access.onRevokePlayerAccess,
      actions.access.onRenameMembership,
      actions.catalog.onCreateCatalogEntry,
      actions.catalog.onUpdateCatalogEntry,
      actions.catalog.onDeleteCatalogEntry,
      actions.catalog.onAssignCatalogEntry,
      actions.catalog.onUpdateCharacterEntry,
      actions.catalog.onDeleteCharacterEntry,
      actions.catalog.onRollEntry,
      actions.catalog.onRechargeEntry,
      actions.story.onLoadMoreStoryPosts,
      actions.story.onCreateStoryDraft,
      actions.story.onUpdateStoryPost,
      actions.story.onPublishStoryPost,
      actions.story.onArchiveStoryPost,
      actions.playerRequest.onOpenPlayerRequestCreate,
      actions.playerRequest.onCreatePlayerRequest,
      actions.playerRequest.onUpdatePlayerRequest,
      actions.playerRequest.onPlayerRequestAction,
      actions.asset.replaceAsset,
      actions.asset.refreshAssets,
      actions.asset.uploadAsset,
      actions.asset.getAssetUsage,
      actions.asset.deleteAsset,
      actions.asset.generateTokenImage,
      actions.statLayout.onUpdateStatLayout,
      actions.chatHistory.onLoadThreadHistory,
      actions.character.replaceCharacterControllers,
      actions.character.patchCharacter,
      actions.character.updateCharacterCounters,
      actions.character.onCreateCharacter,
      actions.initiative.onUpdateInitiative,
      actions.initiative.onSetOwnInitiative,
      actions.initiative.onRollInitiative,
      actions.initiative.onSetBattleZone,
      actions.initiative.onRecruitFromBattleZone,
      actions.dice.onRoll,
      actions.campaign.onCampaignClock,
      actions.player.onPreviewPlayer,
      actions.sidebar.onRequestedChatMessageHandled,
      actions.sidebar.onChatVisibilityChange,
      actions.sidebar.onCollapsedChange,
      actions.sidebar.onResizeHandleDown,
      actions.sidebar.onResizeHandleMove,
      actions.sidebar.onResizeHandleUp,
      actions.sidebar.onWorkspaceChange,
    ],
  );
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

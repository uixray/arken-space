import type {
  AudioStateDto,
  GameSnapshot,
  MembershipDto,
} from "@arken/contracts";
import { starterStatLayout } from "@arken/system";

/**
 * Builds a minimal-but-typed `GameSnapshot` for component tests.
 *
 * AUTHORIZATION HONESTY (do not weaken this): `role` here is not a
 * test-only flag layered on top of the component -- it becomes
 * `snapshot.me.role`, the exact field every gated component in this app
 * reads to decide what a GM vs a PLAYER may see or do (see
 * `TokenPalette.tsx`'s `props.snapshot.me.role === "GM"` checks,
 * `MediaPanel.tsx`'s `allowed` asset-kind list, `EncounterConfirmDialog.tsx`,
 * `WorldMapsWorkspace.tsx`'s `isGm`, ...). Building the snapshot through
 * `gmSnapshot()`/`playerSnapshot()` and passing it straight to the
 * component under test means the test exercises the *same* comparison the
 * real app makes -- it can never "prove" GM-only behavior works for a
 * PLAYER (or leak GM data to one) by taking a shortcut the real
 * authorization path does not take.
 *
 * Concretely: never special-case a component's rendering based on which
 * fixture helper was called, and never add a prop/override that bypasses
 * `snapshot.me.role` while claiming to represent a role. If a component
 * needs role-derived data that isn't `me.role` itself (e.g. a filtered
 * member list), derive it the same way the component or its caller does in
 * production, not with hand-picked test-only values.
 */
export function buildGameSnapshot(
  role: "GM" | "PLAYER",
  overrides: Partial<GameSnapshot> = {},
): GameSnapshot {
  const me: MembershipDto = {
    id: "member-under-test",
    role,
    displayName: role === "GM" ? "Ведущий" : "Игрок",
    characterId: null,
  };

  const audio: AudioStateDto = {
    assetId: null,
    playing: false,
    positionSeconds: 0,
    loop: false,
    startedAt: null,
    revision: 0,
    updatedAt: new Date(0).toISOString(),
  };

  const base: GameSnapshot = {
    campaign: {
      id: "campaign-under-test",
      name: "Test Campaign",
      day: 1,
      paused: false,
      battleActive: false,
      initiative: [],
      battleZone: null,
      battleCounter: 0,
      // Реалистичное значение, а не пустой массив: фикстура, у которой нет ни
      // одной строки раскладки, не поймает ошибку в коде, который её читает.
      statLayout: starterStatLayout,
      revision: 1,
    },
    me,
    members: [me],
    characterIdentities: [],
    characters: [],
    catalogEntries: [],
    scenes: [],
    tokens: [],
    tokenDefinitions: [],
    fogReveals: [],
    drawings: [],
    playerRequests: [],
    encounters: [],
    messages: [],
    chatThreads: [],
    chatThreadStates: [],
    assets: [],
    audio,
    audioTracks: [],
    snapshotVersion: 1,
    schemaVersion: 1,
    buildVersion: "test",
    buildRevision: "test",
    serverTime: new Date(0).toISOString(),
  };

  return { ...base, ...overrides, me: overrides.me ?? me };
}

/** A snapshot for the GM viewing their own campaign. */
export const gmSnapshot = (overrides?: Partial<GameSnapshot>) =>
  buildGameSnapshot("GM", overrides);

/** A snapshot for a PLAYER member -- the same shape a GM sees, different role. */
export const playerSnapshot = (overrides?: Partial<GameSnapshot>) =>
  buildGameSnapshot("PLAYER", overrides);

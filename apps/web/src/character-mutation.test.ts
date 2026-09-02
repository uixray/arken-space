import { describe, expect, it } from "vitest";
import { starterStatLayout } from "@arken/system";
import type { CharacterDto, GameSnapshot } from "@arken/contracts";
import {
  applyCharacterMutationToSnapshot,
  mergeCharacterMutationResponse,
  reconcileGameSnapshot,
} from "./character-mutation";

const character = {
  id: "character-1",
  name: "Hero",
  ownerMembershipId: null,
  controllerMembershipIds: [],
  portraitAssetId: null,
  stats: {},
  skills: [],
  spells: [],
  notes: "",
  backstory: "",
  inventory: [],
  resources: {},
  wallet: { gold: 0, silver: 0, copper: 0, sp: 0 },
  entries: [
    {
      id: "entry-1",
      sourceCatalogEntryId: null,
      kind: "SKILL",
      name: "Skill",
      description: "",
      data: {},
      revision: 0,
    },
  ],
  revision: 1,
  lifecycle: "ACTIVE",
  archivedAt: null,
  archivedByMembershipId: null,
} satisfies CharacterDto;

describe("character mutation reconciliation", () => {
  it("repairs a legacy raw-row response and rejects a duplicate placeholder", () => {
    expect(
      mergeCharacterMutationResponse(character, {
        ...character,
        entries: undefined,
        wallet: { gold: 2 },
        revision: 2,
      }),
    ).toMatchObject({
      wallet: { gold: 2, silver: 0, copper: 0, sp: 0 },
      entries: character.entries,
      revision: 2,
    });
    expect(
      mergeCharacterMutationResponse(character, { duplicate: true }),
    ).toBeNull();
  });

  it("does not let stale original or conflict-retry PATCH responses overwrite realtime wallet state", () => {
    const current = snapshotWithCharacter({
      ...character,
      revision: 5,
      wallet: { ...character.wallet, gold: 20, sp: 7 },
    });
    const staleOriginal = {
      ...character,
      revision: 4,
      wallet: { ...character.wallet, gold: 1, sp: 0 },
    };
    const staleRetry = {
      ...character,
      revision: 5,
      wallet: { ...character.wallet, gold: 11, sp: 1 },
    };
    const newerRetry = {
      ...character,
      revision: 6,
      wallet: { ...character.wallet, gold: 21, sp: 8 },
    };

    expect(applyCharacterMutationToSnapshot(current, staleOriginal)).toBe(
      current,
    );
    expect(applyCharacterMutationToSnapshot(current, staleRetry)).toBe(current);
    expect(
      applyCharacterMutationToSnapshot(current, newerRetry)?.characters[0],
    ).toMatchObject({ revision: 6, wallet: { gold: 21, sp: 8 } });
  });

  it("does not let an out-of-order snapshot regress wallet revisions", () => {
    const snapshot = snapshotWithCharacter({
      ...character,
      revision: 4,
      wallet: { ...character.wallet, gold: 3 },
    });
    const stale = {
      ...snapshot,
      characterIdentities: [],
      characters: [character],
      snapshotVersion: 3,
    };
    const equalSequenceButStaleCharacter = {
      ...stale,
      snapshotVersion: 4,
    };

    expect(reconcileGameSnapshot(snapshot, stale)).toBe(snapshot);
    expect(
      reconcileGameSnapshot(snapshot, equalSequenceButStaleCharacter)
        .characters[0]?.wallet.gold,
    ).toBe(3);
  });
});

function snapshotWithCharacter(nextCharacter: CharacterDto): GameSnapshot {
  return {
    campaign: {
      id: "campaign-1",
      name: "Campaign",
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
    characterIdentities: [],
    me: {
      id: "membership-1",
      role: "PLAYER",
      displayName: "Player",
      characterId: character.id,
    },
    members: [],
    characters: [nextCharacter],
    catalogEntries: [],
    scenes: [],
    tokens: [],
    fogReveals: [],
    messages: [],
    chatThreads: [],
    chatThreadStates: [],
    assets: [],
    audio: {
      assetId: null,
      playing: false,
      positionSeconds: 0,
      loop: false,
      startedAt: null,
      revision: 0,
      updatedAt: new Date(0).toISOString(),
    },
    audioTracks: [],
    snapshotVersion: 4,
    schemaVersion: 2,
    buildVersion: "test",
    buildRevision: "test",
    serverTime: new Date(0).toISOString(),
  } satisfies GameSnapshot;
}

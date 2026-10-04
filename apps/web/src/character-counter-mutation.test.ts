import type { CharacterDto } from "@arken/contracts";
import { describe, expect, it } from "vitest";
import {
  buildCharacterCounterPatch,
  isCharacterCounterPatchNoop,
  shouldRetryCharacterCounterConflict,
} from "./character-counter-mutation.js";

const character = {
  wallet: { gold: 2, silver: 3, copper: 4, sp: 5 },
  resources: {
    physicalPower: {
      current: 4,
      maximum: 10,
      description: "Выносливость",
    },
    magicPower: { current: 2, maximum: 6, recoverable: true },
  },
} satisfies Pick<CharacterDto, "wallet" | "resources">;

describe("queued character counter mutations", () => {
  it("changes one resource on the latest base without losing other keys or metadata", () => {
    expect(
      buildCharacterCounterPatch(
        character,
        {},
        {
          resource: { key: "physicalPower", kind: "DELTA", delta: -2 },
        },
      ),
    ).toEqual({
      resources: {
        physicalPower: {
          current: 2,
          maximum: 10,
          description: "Выносливость",
        },
        magicPower: { current: 2, maximum: 6, recoverable: true },
      },
    });
  });

  it("rebases DELTA, applies SET, prevents negatives and retains temporary excess", () => {
    const rebased = {
      ...character,
      resources: {
        ...character.resources,
        physicalPower: {
          ...character.resources.physicalPower!,
          current: 9,
        },
      },
    };

    expect(
      buildCharacterCounterPatch(
        rebased,
        {},
        {
          resource: { key: "physicalPower", kind: "DELTA", delta: 5 },
        },
      ).resources?.physicalPower?.current,
    ).toBe(14);
    expect(
      buildCharacterCounterPatch(
        character,
        {},
        {
          resource: { key: "magicPower", kind: "SET", value: -12 },
        },
      ).resources?.magicPower?.current,
    ).toBe(0);
    expect(
      buildCharacterCounterPatch(
        character,
        {},
        {
          resource: { key: "magicPower", kind: "SET", value: 99 },
        },
      ).resources?.magicPower?.current,
    ).toBe(99);
  });

  it("rebases metadata-only resource-map edits without restoring stale currents", () => {
    const latest = {
      ...character,
      resources: {
        physicalPower: {
          ...character.resources.physicalPower!,
          current: 1,
        },
        magicPower: {
          ...character.resources.magicPower!,
          current: 5,
        },
      },
    };
    const desired = {
      ...character.resources,
      physicalPower: {
        ...character.resources.physicalPower!,
        description: "Новое описание",
      },
    };

    expect(
      buildCharacterCounterPatch(
        latest,
        { resources: desired },
        {
          resourceMapPatch: {
            base: character.resources,
            desired,
          },
        },
      ).resources,
    ).toEqual({
      physicalPower: {
        current: 1,
        maximum: 10,
        description: "Новое описание",
      },
      magicPower: { current: 5, maximum: 6, recoverable: true },
    });
  });

  it("applies deliberate current SET, deletion and addition onto the latest map", () => {
    const latest = {
      ...character,
      resources: {
        physicalPower: {
          ...character.resources.physicalPower!,
          current: 1,
        },
        magicPower: {
          ...character.resources.magicPower!,
          current: 5,
        },
        external: { current: 7, maximum: 9 },
      },
    };
    const desired = {
      physicalPower: {
        ...character.resources.physicalPower!,
        current: 3,
      },
      focus: { current: 2, maximum: 4, description: "Фокус" },
    };

    expect(
      buildCharacterCounterPatch(
        latest,
        { resources: desired },
        {
          resourceMapPatch: {
            base: character.resources,
            desired,
          },
        },
      ).resources,
    ).toEqual({
      physicalPower: {
        current: 3,
        maximum: 10,
        description: "Выносливость",
      },
      external: { current: 7, maximum: 9 },
      focus: { current: 2, maximum: 4, description: "Фокус" },
    });
  });

  it("preserves overfill when the sheet lowers maximum or edits current", () => {
    const latest = {
      ...character,
      resources: {
        ...character.resources,
        physicalPower: {
          ...character.resources.physicalPower!,
          current: 10,
        },
      },
    };
    const desired = {
      ...character.resources,
      physicalPower: {
        ...character.resources.physicalPower!,
        maximum: 9,
      },
      focus: { current: 8, maximum: 4 },
      fractional: { current: 2.5, maximum: 4 },
    };

    expect(
      buildCharacterCounterPatch(
        latest,
        { resources: desired },
        {
          resourceMapPatch: {
            base: character.resources,
            desired,
          },
        },
      ).resources,
    ).toMatchObject({
      physicalPower: { current: 10, maximum: 9 },
      focus: { current: 8, maximum: 4 },
      fractional: { current: 2.5, maximum: 4 },
    });
  });

  it("preserves overfill when the sheet adds a custom resource", () => {
    const desired = {
      ...character.resources,
      focus: { current: 7.5, maximum: 4 },
    };
    expect(
      buildCharacterCounterPatch(
        character,
        { resources: desired },
        { resourceMapPatch: { base: character.resources, desired } },
      ).resources?.focus,
    ).toEqual({ current: 7.5, maximum: 4 });
  });

  it("recognizes a rebased SET that canonical state already satisfies as a no-op", () => {
    const canonical = {
      ...character,
      resources: {
        magicPower: character.resources.magicPower!,
        physicalPower: {
          ...character.resources.physicalPower!,
          current: 3,
        },
      },
    };
    const patch = buildCharacterCounterPatch(
      canonical,
      {},
      {
        resource: { key: "physicalPower", kind: "SET", value: 3 },
      },
    );

    expect(isCharacterCounterPatchNoop(canonical, patch)).toBe(true);
    expect(
      isCharacterCounterPatchNoop(canonical, {
        resources: {
          ...canonical.resources,
          physicalPower: {
            ...canonical.resources.physicalPower!,
            description: "Другое описание",
          },
        },
      }),
    ).toBe(false);
    expect(isCharacterCounterPatchNoop(canonical, { rest: "SHORT" })).toBe(
      false,
    );
  });

  it("preserves temporary resource points above maximum in an intent patch", () => {
    const patch = buildCharacterCounterPatch(
      character,
      {},
      {
        resource: { key: "physicalPower", kind: "SET", value: 17 },
      },
    );
    expect(patch.resources?.physicalPower).toMatchObject({
      current: 17,
      maximum: character.resources.physicalPower?.maximum,
    });
  });

  it("retries only relative conflicts", () => {
    expect(
      shouldRetryCharacterCounterConflict({
        resource: { key: "physicalPower", kind: "DELTA", delta: -1 },
      }),
    ).toBe(true);
    expect(
      shouldRetryCharacterCounterConflict({
        resource: { key: "physicalPower", kind: "SET", value: 3 },
      }),
    ).toBe(false);
    expect(
      shouldRetryCharacterCounterConflict({
        walletDelta: { gold: 1 },
      }),
    ).toBe(true);
    expect(
      shouldRetryCharacterCounterConflict({
        walletDelta: { gold: 1 },
        resource: { key: "physicalPower", kind: "SET", value: 3 },
      }),
    ).toBe(false);
    expect(
      shouldRetryCharacterCounterConflict(
        { walletDelta: { gold: 1 } },
        { rest: "SHORT" },
      ),
    ).toBe(false);
    expect(
      shouldRetryCharacterCounterConflict({
        resourceMapPatch: {
          base: character.resources,
          desired: character.resources,
        },
      }),
    ).toBe(false);
    expect(shouldRetryCharacterCounterConflict()).toBe(false);
  });

  it("preserves wallet and rest behavior", () => {
    expect(
      buildCharacterCounterPatch(
        character,
        { rest: "SHORT" },
        { walletDelta: { silver: -10 } },
      ),
    ).toEqual({
      rest: "SHORT",
      wallet: { gold: 2, silver: 0, copper: 4, sp: 5 },
    });
    expect(
      buildCharacterCounterPatch(character, {
        wallet: { gold: 8, silver: 0, copper: 0, sp: 0 },
      }),
    ).toEqual({
      wallet: { gold: 8, silver: 0, copper: 0, sp: 0 },
    });
  });

  it("rebases one wallet batch across denominations", () => {
    expect(
      buildCharacterCounterPatch(
        character,
        { wallet: { gold: 99, silver: 99, copper: 99, sp: 99 } },
        { walletDelta: { gold: 3, silver: -2, sp: 1 } },
      ),
    ).toEqual({
      wallet: { gold: 5, silver: 1, copper: 4, sp: 6 },
    });
  });
});

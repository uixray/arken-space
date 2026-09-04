import { describe, expect, it } from "vitest";
import {
  applyWalletDelta,
  changeWalletValue,
  EMPTY_WALLET,
  mergeWalletDelta,
  normalizeWallet,
  normalizeWalletValue,
  WALLET_KEYS,
  WALLET_LABELS,
  walletDeltaIsEmpty,
} from "./wallet.js";

describe("wallet numeric input", () => {
  it("keeps a Russian label for every wallet field in display order", () => {
    expect(WALLET_KEYS).toEqual(Object.keys(EMPTY_WALLET));
    expect(WALLET_KEYS.map((key) => WALLET_LABELS[key])).toEqual([
      "Золото",
      "Серебро",
      "Медь",
      "Очки прокачки",
    ]);
  });

  it("normalizes intermediate and invalid number input without NaN", () => {
    expect(normalizeWalletValue("")).toBe(0);
    expect(normalizeWalletValue("-")).toBe(0);
    expect(normalizeWalletValue(Number.NaN)).toBe(0);
    expect(normalizeWalletValue(Number.POSITIVE_INFINITY)).toBe(0);
    expect(normalizeWalletValue("18.9")).toBe(18);
  });

  it("keeps rapid changes finite, non-negative and immutable", () => {
    let wallet = EMPTY_WALLET;
    for (let index = 0; index < 100; index += 1)
      wallet = changeWalletValue(wallet, index % 2 ? "gold" : "sp", 1);
    expect(wallet).toEqual({ gold: 50, silver: 0, copper: 0, sp: 50 });
    expect(changeWalletValue(wallet, "sp", -100).sp).toBe(0);
    expect(wallet.sp).toBe(50);
  });

  it("repairs incomplete data before a render or queued mutation", () => {
    expect(normalizeWallet({ gold: 4 })).toEqual({
      gold: 4,
      silver: 0,
      copper: 0,
      sp: 0,
    });
  });

  it("accumulates and replays a multi-denomination relative decision", () => {
    let delta = mergeWalletDelta({}, "gold", 3);
    delta = mergeWalletDelta(delta, "silver", -2);
    delta = mergeWalletDelta(delta, "gold", -1);

    expect(delta).toEqual({ gold: 2, silver: -2 });
    expect(
      applyWalletDelta({ gold: 10, silver: 1, copper: 4, sp: 0 }, delta),
    ).toEqual({ gold: 12, silver: 0, copper: 4, sp: 0 });
  });

  it("drops a click series that cancels itself", () => {
    const added = mergeWalletDelta({}, "sp", 1);
    const cancelled = mergeWalletDelta(added, "sp", -1);

    expect(walletDeltaIsEmpty(cancelled)).toBe(true);
  });
});

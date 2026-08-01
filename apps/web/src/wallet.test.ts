import { describe, expect, it } from "vitest";
import {
  changeWalletValue,
  EMPTY_WALLET,
  normalizeWallet,
  normalizeWalletValue,
} from "./wallet.js";

describe("wallet numeric input", () => {
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
});

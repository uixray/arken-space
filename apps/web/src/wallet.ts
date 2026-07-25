import type { CharacterDto } from "@arken/contracts";

export type Wallet = CharacterDto["wallet"];
export type WalletKey = keyof Wallet;

export const EMPTY_WALLET: Wallet = { gold: 0, silver: 0, copper: 0, sp: 0 };

export function normalizeWallet(
  wallet: Partial<Wallet> | null | undefined,
): Wallet {
  return {
    gold: normalizeWalletValue(wallet?.gold),
    silver: normalizeWalletValue(wallet?.silver),
    copper: normalizeWalletValue(wallet?.copper),
    sp: normalizeWalletValue(wallet?.sp),
  };
}

export function normalizeWalletValue(value: unknown): number {
  const parsed =
    typeof value === "number"
      ? value
      : typeof value === "string"
        ? Number.parseInt(value, 10)
        : 0;
  if (!Number.isFinite(parsed)) return 0;
  return Math.max(0, Math.min(Number.MAX_SAFE_INTEGER, Math.trunc(parsed)));
}

export function changeWalletValue(
  wallet: Wallet,
  key: WalletKey,
  delta: number,
): Wallet {
  const current = normalizeWallet(wallet);
  return { ...current, [key]: normalizeWalletValue(current[key] + delta) };
}

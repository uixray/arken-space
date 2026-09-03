import type { CharacterDto } from "@arken/contracts";
import { RESOURCE_ADJUST_DELAY_MS } from "./resource-regen";

export type Wallet = CharacterDto["wallet"];
export type WalletKey = keyof Wallet;
export type WalletDelta = Partial<Record<WalletKey, number>>;

export const EMPTY_WALLET: Wallet = { gold: 0, silver: 0, copper: 0, sp: 0 };

/** Wallet and quick resources use one interaction pause for rapid +/- series. */
export const WALLET_ADJUST_DELAY_MS = RESOURCE_ADJUST_DELAY_MS;

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

/** Adds one actual UI step and drops keys whose accumulated intent cancels out. */
export function mergeWalletDelta(
  current: WalletDelta,
  key: WalletKey,
  delta: number,
): WalletDelta {
  if (!Number.isFinite(delta) || delta === 0) return current;
  const next = { ...current };
  const combined = (next[key] ?? 0) + Math.trunc(delta);
  if (combined === 0) delete next[key];
  else next[key] = combined;
  return next;
}

/** Replays a relative wallet decision against the latest canonical queue head. */
export function applyWalletDelta(
  wallet: Partial<Wallet> | null | undefined,
  delta: WalletDelta,
): Wallet {
  let next = normalizeWallet(wallet);
  for (const key of Object.keys(delta) as WalletKey[]) {
    next = changeWalletValue(next, key, delta[key] ?? 0);
  }
  return next;
}

export function walletDeltaIsEmpty(delta: WalletDelta): boolean {
  return Object.keys(delta).length === 0;
}

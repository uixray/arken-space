import type { CharacterDto } from "@arken/contracts";
import { RESOURCE_ADJUST_DELAY_MS } from "./resource-regen";

export type Wallet = CharacterDto["wallet"];
export type WalletKey = keyof Wallet;
export type WalletDelta = Partial<Record<WalletKey, number>>;

export const EMPTY_WALLET: Wallet = { gold: 0, silver: 0, copper: 0, sp: 0 };

export const WALLET_LABELS = {
  gold: "Золото",
  silver: "Серебро",
  copper: "Медь",
  sp: "Очки прокачки",
} satisfies Record<WalletKey, string>;

export const WALLET_KEYS = Object.keys(WALLET_LABELS) as WalletKey[];

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

/** Spend one coin, breaking a higher denomination when this field is empty. */
export function spendWalletCoin(wallet: Wallet, key: WalletKey): Wallet {
  const current = normalizeWallet(wallet);
  if (current[key] > 0) return { ...current, [key]: current[key] - 1 };
  if (key === "silver" && current.gold > 0)
    return { ...current, gold: current.gold - 1, silver: 9 };
  if (key === "copper") {
    if (current.silver > 0)
      return { ...current, silver: current.silver - 1, copper: 9 };
    if (current.gold > 0)
      return { ...current, gold: current.gold - 1, silver: 9, copper: 9 };
  }
  return current;
}

export function canSpendWalletCoin(wallet: Wallet, key: WalletKey): boolean {
  const current = normalizeWallet(wallet);
  return (
    current[key] > 0 ||
    (key === "silver" && current.gold > 0) ||
    (key === "copper" && (current.silver > 0 || current.gold > 0))
  );
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

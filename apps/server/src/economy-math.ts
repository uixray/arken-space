import { ECONOMY_MAX_COPPER, type EconomyConfig, type EconomyDate } from "@arken/contracts";

export function economyDate(config: EconomyConfig, campaignDay: number): EconomyDate & { seasonId: string } {
  const yearDays = config.calendar.months.reduce((n, m) => n + m.days, 0);
  const elapsed = campaignDay - config.calendar.anchorCampaignDay;
  const yearOffset = Math.floor(elapsed / yearDays);
  let day = elapsed - yearOffset * yearDays;
  for (const month of config.calendar.months) {
    if (day < month.days) {
      const season = config.seasons.find((s) => s.id === month.seasonId)!;
      return { year: config.calendar.anchorYear + yearOffset, month: month.name,
        day: day + 1, season: season.name, seasonId: season.id };
    }
    day -= month.days;
  }
  throw new Error("ECONOMY_INVALID_CONFIG");
}
export type CoinWallet = { gold: number; silver: number; copper: number; sp: number };
export function walletCopper(wallet: CoinWallet): bigint {
  if (![wallet.gold, wallet.silver, wallet.copper].every((v) => Number.isSafeInteger(v) && v >= 0))
    throw new Error("ECONOMY_INVALID_WALLET");
  return BigInt(wallet.gold) * 100n + BigInt(wallet.silver) * 10n + BigInt(wallet.copper);
}
export function debitCoins(wallet: CoinWallet, price: number): CoinWallet {
  const rest = walletCopper(wallet) - BigInt(price);
  if (rest < 0n) throw new Error("ECONOMY_INSUFFICIENT_FUNDS");
  const gold = Number(rest / 100n);
  if (!Number.isSafeInteger(gold)) throw new Error("ECONOMY_INVALID_WALLET");
  return { gold, silver: Number((rest % 100n) / 10n), copper: Number(rest % 10n), sp: wallet.sp };
}
export function priceCopper(base: number, quantity: number, factors: number[], override: number | null): number {
  let numerator = BigInt(override ?? base) * BigInt(quantity);
  let denominator = 1n;
  if (override === null) for (const percent of factors) {
    numerator *= BigInt(percent);
    denominator *= 100n;
  }
  const total = (numerator + denominator - 1n) / denominator;
  if (total > BigInt(ECONOMY_MAX_COPPER)) throw new Error("ECONOMY_PRICE_LIMIT");
  return Number(total);
}

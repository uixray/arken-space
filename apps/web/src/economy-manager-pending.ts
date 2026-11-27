import { z } from "zod";
import {
  saveEconomyConfigSchema,
  saveMerchantSchema,
  saveShopOfferSchema,
} from "@arken/contracts";
import type { EconomyContext } from "./economy-client";

export type ManagerCommand = {
  path: string;
  method: string;
  body: Record<string, unknown>;
};
const envelope = z
  .object({
    path: z.string().max(100),
    method: z.enum(["PUT", "PATCH"]),
    body: z.record(z.string(), z.unknown()),
  })
  .strict();
const price = z
  .object({
    actionId: z.string().uuid(),
    revision: z.number().int().nonnegative(),
    basePriceCopper: z.number().int().min(0).max(1e12).nullable(),
  })
  .strict();
const worldPath =
  /^\/api\/world-content\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const managerPendingKey = (context: EconomyContext) =>
  `arken.economy.manager.pending.v1.${context.campaignId}.${context.membershipId}`;
function parse(raw: string): ManagerCommand {
  if (raw.length > 512_000)
    throw new Error(
      "Сохранённая команда настроек слишком велика; проверьте её с мастером.",
    );
  let input: unknown;
  try {
    input = JSON.parse(raw);
  } catch {
    input = null;
  }
  const parsed = envelope.safeParse(input);
  if (!parsed.success)
    throw new Error(
      "Сохранённая команда настроек повреждена. Она не будет отправлена или удалена автоматически.",
    );
  const command = parsed.data;
  const schema =
    command.method === "PUT" && command.path === "/api/economy/config"
      ? saveEconomyConfigSchema
      : command.method === "PUT" && command.path === "/api/economy/merchants"
        ? saveMerchantSchema
        : command.method === "PUT" && command.path === "/api/economy/offers"
          ? saveShopOfferSchema
          : command.method === "PATCH" && worldPath.test(command.path)
            ? price
            : null;
  if (!schema?.safeParse(command.body).success)
    throw new Error(
      "Сохранённая команда настроек не распознана. Проверьте её с мастером.",
    );
  return command; // Preserve the exact originally sent body; never apply new defaults.
}
export function readManagerCommand(context: EconomyContext) {
  const value = sessionStorage.getItem(managerPendingKey(context));
  return value === null ? null : parse(value);
}
export function writeManagerCommand(
  context: EconomyContext,
  command: ManagerCommand,
) {
  const serialized = JSON.stringify(command);
  parse(serialized);
  const prior = readManagerCommand(context);
  if (prior && JSON.stringify(prior) !== serialized)
    throw new Error("Сначала восстановите прежнее сохранение настроек.");
  sessionStorage.setItem(managerPendingKey(context), serialized);
  const saved = readManagerCommand(context);
  if (!saved || JSON.stringify(saved) !== serialized)
    throw new Error("Команда настроек не сохранилась; запрос не отправлен.");
}
export function clearManagerCommand(
  context: EconomyContext,
  command: ManagerCommand,
) {
  const saved = readManagerCommand(context);
  if (!saved || JSON.stringify(saved) !== JSON.stringify(command))
    throw new Error(
      "Сохранённая команда настроек изменилась; она оставлена для проверки.",
    );
  sessionStorage.removeItem(managerPendingKey(context));
  if (sessionStorage.getItem(managerPendingKey(context)) !== null)
    throw new Error("Не удалось очистить подтверждённую команду настроек.");
}

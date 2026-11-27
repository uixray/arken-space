import { z } from "zod";
import { accountCampaignCreateSchema } from "@arken/contracts";
const schema = z
  .object({
    accountId: z.string().uuid(),
    name: z.string().min(1).max(80),
    key: z.string().uuid(),
    uncertain: z.literal(true),
  })
  .strict();
export type PendingCampaignCreate = z.infer<typeof schema>;
const keyFor = (accountId: string) =>
  `arken.account.campaign-create.v1.${accountId}`;
export function readPendingCampaignCreate(
  accountId: string,
): PendingCampaignCreate | null {
  const raw = sessionStorage.getItem(keyFor(accountId));
  if (raw === null) return null;
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    value = null;
  }
  const parsed = schema.safeParse(value);
  if (
    !parsed.success ||
    parsed.data.accountId !== accountId ||
    !accountCampaignCreateSchema.safeParse({
      name: parsed.data.name,
      idempotencyKey: parsed.data.key,
    }).success
  )
    throw new Error(
      "Сохранённый запрос создания кампании повреждён. Проверьте список кампаний; запись не удалена.",
    );
  return parsed.data;
}
export function writePendingCampaignCreate(value: PendingCampaignCreate) {
  const parsed = schema.parse(value),
    old = readPendingCampaignCreate(parsed.accountId);
  if (old && JSON.stringify(old) !== JSON.stringify(parsed))
    throw new Error("Сначала проверьте прежнее создание кампании.");
  sessionStorage.setItem(keyFor(parsed.accountId), JSON.stringify(parsed));
  if (
    JSON.stringify(readPendingCampaignCreate(parsed.accountId)) !==
    JSON.stringify(parsed)
  )
    throw new Error("Не удалось сохранить запрос; кампания не создавалась.");
}
export function clearPendingCampaignCreate(value: PendingCampaignCreate) {
  if (
    JSON.stringify(readPendingCampaignCreate(value.accountId)) !==
    JSON.stringify(value)
  )
    throw new Error(
      "Сохранённый запрос создания изменился. Проверьте список кампаний.",
    );
  sessionStorage.removeItem(keyFor(value.accountId));
  if (sessionStorage.getItem(keyFor(value.accountId)) !== null)
    throw new Error(
      "Не удалось очистить подтверждённый запрос создания кампании.",
    );
}

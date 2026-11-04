import { z } from "zod";
import { abilityAreaApplySchema } from "@arken/contracts";

const schema = z
  .object({
    id: z.string().uuid(),
    campaignId: z.string().uuid(),
    membershipId: z.string().uuid(),
    characterId: z.string().uuid(),
    entryId: z.string().uuid(),
    entryRevision: z.number().int().nonnegative(),
    consumesItem: z.boolean().optional(),
    sceneId: z.string().uuid(),
    name: z.string().min(1).max(300),
    radiusMeters: z.number().positive().max(1_000_000),
    tokenId: z.string().uuid(),
    request: abilityAreaApplySchema,
    cancellationRequested: z.literal(true).optional(),
  })
  .strict()
  .refine(
    (v) =>
      v.id === v.request.actionId &&
      v.characterId === v.request.characterId &&
      v.entryId === v.request.entryId &&
      v.entryRevision === v.request.entryRevision &&
      v.sceneId === v.request.sceneId &&
      v.tokenId === v.request.casterTokenId,
    "Данные команды области не совпадают.",
  );
export type StoredAreaCommand = z.infer<typeof schema>;
export const areaPendingKey = (campaignId: string, membershipId: string) =>
  `arken.area.pending.v1.${campaignId}.${membershipId}`;
export function readAreaPending(
  campaignId: string,
  membershipId: string,
): StoredAreaCommand | null {
  const raw = localStorage.getItem(areaPendingKey(campaignId, membershipId));
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
    parsed.data.campaignId !== campaignId ||
    parsed.data.membershipId !== membershipId
  )
    throw new Error(
      "Сохранённая команда области повреждена. Не создавайте замену до сверки с мастером.",
    );
  return parsed.data;
}
/** Caller owns the cross-tab Web Lock. No failed write may send a request. */
export function writeAreaPending(value: StoredAreaCommand) {
  const command = schema.parse(value),
    key = areaPendingKey(command.campaignId, command.membershipId);
  const prior = readAreaPending(command.campaignId, command.membershipId);
  if (prior) {
    const { cancellationRequested: priorCancel, ...priorBody } = prior;
    const { cancellationRequested: nextCancel, ...nextBody } = command;
    // Only the monotonic cancellation intent may change; the original action
    // and its request remain identical. Never downgrade a saved cancellation.
    if (
      JSON.stringify(priorBody) !== JSON.stringify(nextBody) ||
      (priorCancel && !nextCancel)
    )
      throw new Error("Сначала восстановите предыдущее применение области.");
  }
  localStorage.setItem(key, JSON.stringify(command));
  if (
    JSON.stringify(
      readAreaPending(command.campaignId, command.membershipId),
    ) !== JSON.stringify(command)
  )
    throw new Error(
      "Не удалось сохранить команду области. Запрос не отправлен.",
    );
}
export function clearAreaPending(command: StoredAreaCommand) {
  command = schema.parse(command);
  const prior = readAreaPending(command.campaignId, command.membershipId);
  if (prior && JSON.stringify(prior) !== JSON.stringify(command))
    throw new Error(
      "Другая вкладка изменила команду. Сохранённые данные оставлены.",
    );
  localStorage.removeItem(
    areaPendingKey(command.campaignId, command.membershipId),
  );
  if (readAreaPending(command.campaignId, command.membershipId) !== null)
    throw new Error(
      "Не удалось удалить подтверждённую команду области. Повторите восстановление.",
    );
}

import type { ChatMessageDto } from "@arken/contracts";

export type RollToast = {
  message: ChatMessageDto;
  appearanceId: number;
};

export const ROLL_TOAST_LIFETIME_MS = 5000;

export function shouldShowRollToast(
  unseen: boolean,
  kind: ChatMessageDto["kind"],
  chatVisible: boolean,
) {
  return unseen && kind === "DICE" && !chatVisible;
}

export function scheduleRollToastRemoval(callback: () => void) {
  return globalThis.setTimeout(callback, ROLL_TOAST_LIFETIME_MS);
}

export function addRollToast(current: RollToast[], next: RollToast) {
  if (current.some((toast) => toast.message.id === next.message.id))
    return current;
  return [...current, next].slice(-3);
}

export function removeRollToast(
  current: RollToast[],
  messageId: string,
  appearanceId?: number,
) {
  return current.filter(
    (toast) =>
      toast.message.id !== messageId ||
      (appearanceId !== undefined && toast.appearanceId !== appearanceId),
  );
}

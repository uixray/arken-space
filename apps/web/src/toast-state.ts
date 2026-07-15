import type { ChatMessageDto } from "@arken/contracts";

export type RollToast = {
  message: ChatMessageDto;
  appearanceId: number;
};

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

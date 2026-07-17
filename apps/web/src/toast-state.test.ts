import { afterEach, describe, expect, it, vi } from "vitest";
import type { ChatMessageDto } from "@arken/contracts";
import {
  addRollToast,
  removeRollToast,
  scheduleRollToastRemoval,
  shouldShowRollToast,
  type RollToast,
} from "./toast-state";

const toast = (id: string, appearanceId: number): RollToast => ({
  message: { id } as ChatMessageDto,
  appearanceId,
});

describe("roll toast queue", () => {
  afterEach(() => vi.useRealTimers());

  it("suppresses roll notifications while their result is visible in chat", () => {
    expect(shouldShowRollToast(true, "DICE", true)).toBe(false);
    expect(shouldShowRollToast(true, "DICE", false)).toBe(true);
    expect(shouldShowRollToast(true, "TEXT", false)).toBe(false);
    expect(shouldShowRollToast(false, "DICE", false)).toBe(false);
  });

  it("expires an appearance after exactly five seconds", () => {
    vi.useFakeTimers();
    const expired = vi.fn();
    scheduleRollToastRemoval(expired);

    vi.advanceTimersByTime(4999);
    expect(expired).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(expired).toHaveBeenCalledOnce();
  });
  it("is bounded to the three newest appearances", () => {
    const result = ["1", "2", "3", "4"].reduce(
      (current, id, index) => addRollToast(current, toast(id, index)),
      [] as RollToast[],
    );
    expect(result.map((item) => item.message.id)).toEqual(["2", "3", "4"]);
  });

  it("suppresses duplicate or replayed message ids", () => {
    const current = [toast("roll", 1)];
    expect(addRollToast(current, toast("roll", 2))).toBe(current);
  });

  it("does not let an old timer dismiss a later appearance", () => {
    const later = [toast("roll", 2)];
    expect(removeRollToast(later, "roll", 1)).toEqual(later);
    expect(removeRollToast(later, "roll", 2)).toEqual([]);
  });

  it("allows an explicit close regardless of appearance", () => {
    expect(removeRollToast([toast("roll", 2)], "roll")).toEqual([]);
  });
});

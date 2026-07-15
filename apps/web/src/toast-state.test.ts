import { describe, expect, it } from "vitest";
import type { ChatMessageDto } from "@arken/contracts";
import { addRollToast, removeRollToast, type RollToast } from "./toast-state";

const toast = (id: string, appearanceId: number): RollToast => ({
  message: { id } as ChatMessageDto,
  appearanceId,
});

describe("roll toast queue", () => {
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

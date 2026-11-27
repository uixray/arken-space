// @vitest-environment jsdom
import { afterEach, expect, it } from "vitest";
import { areaPendingKey, readAreaPending } from "./ability-area-pending";
const campaign = "00000000-0000-4000-8000-000000000001";
const member = "00000000-0000-4000-8000-000000000002";
const key = areaPendingKey(campaign, member);
afterEach(() => localStorage.removeItem(key));
it.each(["", "{", "null", "[]"])(
  "preserves invalid saved area command and explains recovery: %s",
  (raw) => {
    localStorage.setItem(key, raw);
    expect(() => readAreaPending(campaign, member)).toThrow(
      "Сохранённая команда области повреждена. Не создавайте замену до сверки с мастером.",
    );
    expect(localStorage.getItem(key)).toBe(raw);
  },
);

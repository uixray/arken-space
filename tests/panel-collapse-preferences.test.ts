import { describe, expect, it } from "vitest";
import {
  readQuickRollsCollapsed,
  writeQuickRollsCollapsed,
} from "../apps/web/src/quick-rolls-preference.js";
import {
  readToolbarCollapsed,
  writeToolbarCollapsed,
} from "../apps/web/src/toolbar-preference.js";

/**
 * UIX-475 — свёрнутые панель инструментов и блок бросков.
 *
 * Настройка запоминается: сворачивают их не на минуту, а под свой стиль игры.
 * Проверяется и отказ хранилища — приватный режим и полный localStorage не
 * должны ронять карту.
 */
const memory = () => {
  const store = new Map<string, string>();
  return {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => void store.set(key, value),
    keys: () => [...store.keys()],
  };
};

const blocked = {
  getItem() {
    throw new Error("storage disabled");
  },
  setItem() {
    throw new Error("storage disabled");
  },
};

describe("свёрнутый блок бросков", () => {
  it("по умолчанию развёрнут", () => {
    expect(readQuickRollsCollapsed(memory(), "m1")).toBe(false);
  });

  it("помнит выбор", () => {
    const storage = memory();
    writeQuickRollsCollapsed(storage, "m1", true);
    expect(readQuickRollsCollapsed(storage, "m1")).toBe(true);
    writeQuickRollsCollapsed(storage, "m1", false);
    expect(readQuickRollsCollapsed(storage, "m1")).toBe(false);
  });

  it("держит выбор отдельно у каждого участника", () => {
    // Мастеру и игроку нужны разные вещи на экране.
    const storage = memory();
    writeQuickRollsCollapsed(storage, "гм", true);
    expect(readQuickRollsCollapsed(storage, "игрок")).toBe(false);
  });

  it("переживает заблокированное хранилище", () => {
    expect(readQuickRollsCollapsed(blocked, "m1")).toBe(false);
    expect(() => writeQuickRollsCollapsed(blocked, "m1", true)).not.toThrow();
  });
});

describe("свёрнутая панель инструментов", () => {
  it("по умолчанию развёрнута — подписи видны", () => {
    expect(readToolbarCollapsed(memory(), "m1")).toBe(false);
  });

  it("помнит выбор", () => {
    const storage = memory();
    writeToolbarCollapsed(storage, "m1", true);
    expect(readToolbarCollapsed(storage, "m1")).toBe(true);
  });

  it("не делит ключ с блоком бросков", () => {
    // Один ключ на две настройки означал бы, что свернув панель, человек
    // сворачивает и броски.
    const storage = memory();
    writeToolbarCollapsed(storage, "m1", true);
    expect(readQuickRollsCollapsed(storage, "m1")).toBe(false);
    expect(storage.keys()).toHaveLength(1);
  });

  it("переживает заблокированное хранилище", () => {
    expect(readToolbarCollapsed(blocked, "m1")).toBe(false);
    expect(() => writeToolbarCollapsed(blocked, "m1", true)).not.toThrow();
  });
});

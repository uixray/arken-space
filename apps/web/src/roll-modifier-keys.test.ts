import { describe, expect, it } from "vitest";
import { rollModeFromEvent, rollModeLabel } from "./roll-modifier-keys";
import { physicalRollMessage } from "./activity-roll-controls";

const keys = (held: Partial<Record<"ctrl" | "meta" | "alt", boolean>>) => ({
  ctrlKey: held.ctrl ?? false,
  metaKey: held.meta ?? false,
  altKey: held.alt ?? false,
});

describe("клавиши преимущества и помехи", () => {
  it("Ctrl даёт преимущество, Alt — помеху", () => {
    expect(rollModeFromEvent(keys({ ctrl: true }))).toBe("ADVANTAGE");
    expect(rollModeFromEvent(keys({ alt: true }))).toBe("DISADVANTAGE");
  });

  it("считает Cmd тем же, что Ctrl", () => {
    // На маке Ctrl+клик система показывает как контекстное меню; требовать
    // его — требовать невозможного.
    expect(rollModeFromEvent(keys({ meta: true }))).toBe("ADVANTAGE");
  });

  it("без клавиш берёт режим переключателя", () => {
    // Клавиша перекрывает переключатель, а не заменяет: выставивший «помеху»
    // не должен помнить про клавиши на каждом броске.
    expect(rollModeFromEvent(keys({}), "DISADVANTAGE")).toBe("DISADVANTAGE");
    expect(rollModeFromEvent(keys({}))).toBe("NORMAL");
  });

  it("перекрывает выставленный режим на один бросок", () => {
    expect(rollModeFromEvent(keys({ ctrl: true }), "DISADVANTAGE")).toBe(
      "ADVANTAGE",
    );
  });

  it("на двух клавишах разом не угадывает", () => {
    // Противоречие: молча выбрать одно из двух — значит сделать бросок,
    // которого не заказывали, и заметят это только по результату.
    expect(rollModeFromEvent(keys({ ctrl: true, alt: true }))).toBe("NORMAL");
    expect(rollModeFromEvent(keys({ ctrl: true, alt: true }), "ADVANTAGE")).toBe(
      "ADVANTAGE",
    );
  });
});

describe("физический бросок с преимуществом", () => {
  it("говорит бросить два куба и взять больший", () => {
    // Система результата не считает, но сказать, что делать руками, обязана —
    // иначе зажатый Ctrl над физическим броском тихо не делает ничего.
    const message = physicalRollMessage("Ловкость", 3, "ADVANTAGE");
    expect(message).toContain("два d20");
    expect(message).toContain("больший");
    expect(message).toContain("с преимуществом");
  });

  it("для помехи берёт меньший", () => {
    expect(physicalRollMessage("Ловкость", 3, "DISADVANTAGE")).toContain(
      "меньший",
    );
  });

  it("обычный бросок не поминает режим", () => {
    const message = physicalRollMessage("Ловкость", 3);
    expect(message).toContain("Бросьте d20");
    expect(message).not.toContain("два");
    expect(rollModeLabel("NORMAL")).toBeNull();
  });

  it("оставляет бонус читаемым разбором ленты", () => {
    // `physicalRollBonus` вытаскивает бонус регулярным выражением по «· бонус
    // +3.» — вставка режима в ту же строку не должна его сломать.
    expect(physicalRollMessage("Ловкость", 3, "ADVANTAGE")).toContain(
      "· бонус +3.",
    );
  });
});

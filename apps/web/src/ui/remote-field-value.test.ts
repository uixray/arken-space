// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { syncRemoteFieldValue } from "./remote-field-value";

/**
 * UIX-532/325. Проверяется одно решение: чужая правка доходит до поля, но не
 * трогает то поле, в котором стоит курсор.
 *
 * Раньше обе эти вещи делались пересозданием элемента, и вторая получалась
 * сама собой — вместе с потерей фокуса. Теперь они разведены, и потому каждую
 * надо закрепить отдельно.
 */
function field(value: string, tag: "input" | "textarea" = "input") {
  const node = document.createElement(tag);
  node.value = value;
  document.body.append(node);
  return node;
}

describe("значение поля, пришедшее извне", () => {
  it("кладётся в поле, которое никто не правит", () => {
    const node = field("старое");
    expect(syncRemoteFieldValue(node, "новое")).toBe("updated");
    expect(node.value).toBe("новое");
  });

  it("не трогает поле под курсором", () => {
    // Главное правило: человек печатает, и чужая правка не имеет права
    // затирать набранное. Именно поэтому нельзя пересоздавать элемент.
    const node = field("я печатаю");
    node.focus();
    expect(syncRemoteFieldValue(node, "чужое значение")).toBe(
      "skipped-focused",
    );
    expect(node.value).toBe("я печатаю");
  });

  it("молчит, когда значение и так совпадает", () => {
    // Присваивание сбрасывает позицию курсора даже тем же значением —
    // безобидная на вид запись стоила бы места ввода.
    const node = field("одно и то же");
    expect(syncRemoteFieldValue(node, "одно и то же")).toBe("skipped-equal");
  });

  it("работает и с многострочным полем", () => {
    const node = field("Верёвка", "textarea");
    expect(syncRemoteFieldValue(node, "Верёвка\nФакел")).toBe("updated");
    expect(node.value).toBe("Верёвка\nФакел");
  });

  it("не падает, когда поля ещё нет", () => {
    // Эффект может сработать до монтирования контрола; отсутствие поля —
    // не ошибка, а обычное состояние первого прохода.
    expect(syncRemoteFieldValue(null, "что-нибудь")).toBe("no-field");
  });
});

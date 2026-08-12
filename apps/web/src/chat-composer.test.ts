import { describe, expect, it } from "vitest";
import {
  extractPastedImageFile,
  getSlashCommandSuggestions,
  parseComposerInput,
} from "./chat-composer";
import { statLabelsFromLayout } from "./stat-keys";
import { starterStatLayout } from "@arken/system";

function fakeClipboardData(
  items: Array<{ kind: string; type: string; file?: File }>,
): Pick<DataTransfer, "items"> {
  return {
    items: items.map((item) => ({
      kind: item.kind,
      type: item.type,
      getAsFile: () => item.file ?? null,
    })) as unknown as DataTransferItemList,
  };
}

/**
 * UIX-424: подписи характеристик приходят из раскладки кампании, а не лежат в
 * композере копией. Тесты берут их из настоящей стартовой раскладки — тогда
 * они проверяют то, что увидит игрок, а не выдуманный набор.
 */
const labels = statLabelsFromLayout(starterStatLayout);

describe("parseComposerInput", () => {
  it("keeps ordinary text separate from explicit roll syntax", () => {
    expect(parseComposerInput("  Привет, группа!  ")).toEqual({
      kind: "TEXT",
      body: "Привет, группа!",
    });
    expect(parseComposerInput("/roll 1d20 + agility")).toEqual({
      kind: "ROLL",
      formula: "1d20 + agility",
    });
    expect(parseComposerInput("d20")).toEqual({
      kind: "ROLL",
      formula: "d20",
    });
    expect(parseComposerInput(" 2D6 + 3 ")).toEqual({
      kind: "ROLL",
      formula: "2d6+3",
    });
    expect(parseComposerInput("Бросаю d20")).toEqual({
      kind: "TEXT",
      body: "Бросаю d20",
    });
  });

  it("turns an available characteristic slash command into a d20 check", () => {
    const stats = { agility: 3, strength: 1 };
    expect(parseComposerInput("/agility", stats, labels)).toEqual({
      kind: "ROLL",
      formula: "1d20 + agility",
      label: "Проверка: Ловкость",
    });
    expect(parseComposerInput("/knowledge", stats, labels)).toEqual({
      kind: "TEXT",
      body: "/knowledge",
    });
  });

  it("turns the dedicated d20 command into an ordinary roll", () => {
    expect(parseComposerInput("/d20")).toEqual({
      kind: "ROLL",
      formula: "1d20",
      label: "d20",
    });
  });

  it("does not treat incomplete or arbitrary slash text as dice", () => {
    expect(parseComposerInput("/roll").kind).toBe("INVALID");
    expect(parseComposerInput("/roll-call")).toEqual({
      kind: "TEXT",
      body: "/roll-call",
    });
  });
});

describe("getSlashCommandSuggestions", () => {
  it("offers supported commands while a slash command is being typed", () => {
    expect(getSlashCommandSuggestions("/")).toEqual([
      expect.objectContaining({
        command: "/d20",
        insertion: "/d20",
      }),
      expect.objectContaining({
        command: "/roll",
        example: "/roll 1d20 + agility",
        insertion: "/roll 1d20 + agility",
      }),
    ]);
    expect(getSlashCommandSuggestions("/d")).toEqual([
      expect.objectContaining({ command: "/d20" }),
    ]);
    expect(getSlashCommandSuggestions("/ro")).toHaveLength(1);
    expect(getSlashCommandSuggestions("/ag", { agility: 4 }, labels)).toEqual([
      expect.objectContaining({
        command: "/agility",
        description: "Ловкость: бросок 1d20 + 4",
        insertion: "/agility",
      }),
    ]);
  });

  /**
   * UIX-424: раньше здесь проверялось, что «Сила магии» предлагается ровно
   * один раз. Мастер убрал её из характеристик: `magicPower` теперь ключ
   * ресурса «Мана», а модификатором бросков магии стал навык «Магия».
   *
   * Значит правило поменялось на противоположное — ресурс предлагать нельзя.
   * Он пул с текущим и максимумом, и бросок «1d20 + мана» взял бы не то число.
   */
  it("не предлагает ресурс как характеристику", () => {
    const suggestions = getSlashCommandSuggestions(
      "/",
      { magicPower: 5 },
      labels,
    );
    expect(
      suggestions.filter((item) => item.command === "/magicPower"),
    ).toHaveLength(0);
    // И разбор такой команды не превращается в бросок.
    expect(
      parseComposerInput("/magicPower", { magicPower: 5 }, labels),
    ).toEqual({
      kind: "TEXT",
      body: "/magicPower",
    });
  });

  it("hides suggestions for messages and completed command arguments", () => {
    expect(getSlashCommandSuggestions("hello")).toEqual([]);
    expect(getSlashCommandSuggestions("/roll 1d20")).toEqual([]);
    expect(getSlashCommandSuggestions("/unknown")).toEqual([]);
  });
});

describe("extractPastedImageFile", () => {
  it("picks the image file out of a clipboard paste, triggering the upload path", () => {
    const file = new File(["fake-bytes"], "screenshot.png", {
      type: "image/png",
    });
    const clipboardData = fakeClipboardData([
      { kind: "file", type: "image/png", file },
    ]);
    expect(extractPastedImageFile(clipboardData)).toBe(file);
  });

  it("ignores plain text paste so normal textarea paste is unaffected", () => {
    const clipboardData = fakeClipboardData([
      { kind: "string", type: "text/plain" },
    ]);
    expect(extractPastedImageFile(clipboardData)).toBeNull();
  });

  it("ignores non-image file pastes and missing clipboard data", () => {
    const file = new File(["fake-bytes"], "notes.txt", {
      type: "text/plain",
    });
    expect(
      extractPastedImageFile(
        fakeClipboardData([{ kind: "file", type: "text/plain", file }]),
      ),
    ).toBeNull();
    expect(extractPastedImageFile(null)).toBeNull();
    expect(extractPastedImageFile(undefined)).toBeNull();
  });
});

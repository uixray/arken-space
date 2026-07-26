export type ComposerIntent =
  | { kind: "TEXT"; body: string }
  | { kind: "ROLL"; formula: string; label?: string }
  | { kind: "INVALID"; message: string };

export type SlashCommandSuggestion = {
  command: string;
  description: string;
  example: string;
  insertion: string;
};

const slashCommands: SlashCommandSuggestion[] = [
  {
    command: "/d20",
    description:
      "Обычный бросок d20",
    example: "/d20",
    insertion: "/d20",
  },
  {
    command: "/roll",
    description:
      "Выполнить публичный бросок по формуле",
    example: "/roll 1d20 + agility",
    insertion: "/roll ",
  },
];

const characteristicLabels: Record<string, string> = {
  strength: "Сила",
  agility: "Ловкость",
  endurance:
    "Выносливость",
  vitality: "Живучесть",
  knowledge: "Знания",
  intelligence: "Интеллект",
  willpower: "Воля",
  charisma: "Харизма",
};

function supportedCharacteristics(stats: Record<string, number> = {}) {
  return Object.entries(stats ?? {}).filter(
    ([key, value]) =>
      Object.hasOwn(characteristicLabels, key) && Number.isFinite(value),
  );
}

const bareDiceExpression =
  /^[+-]?(?:\d{0,3}d\d{1,4}(?:kh1|kl1)?|\d+)(?:[+-](?:\d{0,3}d\d{1,4}(?:kh1|kl1)?|\d+))*$/;

function parseBareDiceFormula(body: string): string | null {
  const compact = body.replace(/\s+/g, "").toLocaleLowerCase("en-US");
  return bareDiceExpression.test(compact) && compact.includes("d")
    ? compact
    : null;
}

export function getSlashCommandSuggestions(
  value: string,
  stats: Record<string, number> = {},
): SlashCommandSuggestion[] {
  if (!value.startsWith("/") || value.includes("\n")) return [];
  const query = value.slice(1).trimStart().toLocaleLowerCase("ru");
  if (query.includes(" ")) return [];
  const characteristicCommands = supportedCharacteristics(stats).map(
    ([key, value]) => ({
      command: `/${key}`,
      description: `${characteristicLabels[key]}: бросок 1d20 + ${value}`,
      example: `/${key}`,
      insertion: `/${key}`,
    }),
  );
  return [...slashCommands, ...characteristicCommands].filter((item) =>
    item.command.slice(1).toLocaleLowerCase("ru").startsWith(query),
  );
}

/**
 * Keeps chat text and explicit dice syntax on one safe input path. Formula
 * evaluation is intentionally delegated to the server's dice parser.
 */
export function parseComposerInput(
  value: string,
  stats: Record<string, number> = {},
): ComposerIntent {
  const body = value.trim();
  if (!body)
    return {
      kind: "INVALID",
      message:
        "Введите сообщение или бросок.",
    };
  const bareFormula = parseBareDiceFormula(body);
  if (bareFormula) return { kind: "ROLL", formula: bareFormula };
  if (/^\/d20$/i.test(body))
    return { kind: "ROLL", formula: "1d20", label: "d20" };
  const characteristic = /^\/([a-z_][a-z0-9_]*)$/i
    .exec(body)?.[1]
    ?.toLocaleLowerCase("en-US");
  if (
    characteristic &&
    supportedCharacteristics(stats).some(([key]) => key === characteristic)
  ) {
    return {
      kind: "ROLL",
      formula: `1d20 + ${characteristic}`,
      label: `Проверка: ${characteristicLabels[characteristic]}`,
    };
  }
  if (!/^\/roll(?:\s|$)/i.test(body)) return { kind: "TEXT", body };
  const match = /^\/roll(?:\s+(.+))?$/i.exec(body);
  if (!match?.[1]?.trim())
    return {
      kind: "INVALID",
      message:
        "Укажите формулу после /roll, например /roll 1d20 + agility.",
    };
  return { kind: "ROLL", formula: match[1].trim() };
}

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
    command: "/roll",
    description:
      "\u0412\u044b\u043f\u043e\u043b\u043d\u0438\u0442\u044c \u043f\u0443\u0431\u043b\u0438\u0447\u043d\u044b\u0439 \u0431\u0440\u043e\u0441\u043e\u043a \u043f\u043e \u0444\u043e\u0440\u043c\u0443\u043b\u0435",
    example: "/roll 1d20 + agility",
    insertion: "/roll ",
  },
];

const characteristicLabels: Record<string, string> = {
  strength: "\u0421\u0438\u043b\u0430",
  agility: "\u041b\u043e\u0432\u043a\u043e\u0441\u0442\u044c",
  endurance:
    "\u0412\u044b\u043d\u043e\u0441\u043b\u0438\u0432\u043e\u0441\u0442\u044c",
  vitality: "\u0416\u0438\u0432\u0443\u0447\u0435\u0441\u0442\u044c",
  knowledge: "\u0417\u043d\u0430\u043d\u0438\u044f",
  intelligence: "\u0418\u043d\u0442\u0435\u043b\u043b\u0435\u043a\u0442",
  willpower: "\u0412\u043e\u043b\u044f",
  charisma: "\u0425\u0430\u0440\u0438\u0437\u043c\u0430",
};

function supportedCharacteristics(stats: Record<string, number> = {}) {
  return Object.entries(stats).filter(
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
      description: `${characteristicLabels[key]}: \u0431\u0440\u043e\u0441\u043e\u043a 1d20 + ${value}`,
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
        "\u0412\u0432\u0435\u0434\u0438\u0442\u0435 \u0441\u043e\u043e\u0431\u0449\u0435\u043d\u0438\u0435 \u0438\u043b\u0438 \u0431\u0440\u043e\u0441\u043e\u043a.",
    };
  const bareFormula = parseBareDiceFormula(body);
  if (bareFormula) return { kind: "ROLL", formula: bareFormula };
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
      label: `\u041f\u0440\u043e\u0432\u0435\u0440\u043a\u0430: ${characteristicLabels[characteristic]}`,
    };
  }
  if (!/^\/roll(?:\s|$)/i.test(body)) return { kind: "TEXT", body };
  const match = /^\/roll(?:\s+(.+))?$/i.exec(body);
  if (!match?.[1]?.trim())
    return {
      kind: "INVALID",
      message:
        "\u0423\u043a\u0430\u0436\u0438\u0442\u0435 \u0444\u043e\u0440\u043c\u0443\u043b\u0443 \u043f\u043e\u0441\u043b\u0435 /roll, \u043d\u0430\u043f\u0440\u0438\u043c\u0435\u0440 /roll 1d20 + agility.",
    };
  return { kind: "ROLL", formula: match[1].trim() };
}

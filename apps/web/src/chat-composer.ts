export type ComposerIntent =
  | { kind: "TEXT"; body: string }
  | { kind: "ROLL"; formula: string }
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
    description: "Выполнить публичный бросок по формуле",
    example: "/roll 1d20 + agility",
    insertion: "/roll ",
  },
];

export function getSlashCommandSuggestions(
  value: string,
): SlashCommandSuggestion[] {
  if (!value.startsWith("/") || value.includes("\n")) return [];
  const query = value.slice(1).trimStart().toLocaleLowerCase("ru");
  if (query.includes(" ")) return [];
  return slashCommands.filter((item) =>
    item.command.slice(1).toLocaleLowerCase("ru").startsWith(query),
  );
}

/**
 * Keeps chat text and explicit dice syntax on one safe input path. Formula
 * evaluation is intentionally delegated to the server's dice parser.
 */
export function parseComposerInput(value: string): ComposerIntent {
  const body = value.trim();
  if (!body)
    return { kind: "INVALID", message: "Введите сообщение или бросок." };
  if (!/^\/roll(?:\s|$)/i.test(body)) return { kind: "TEXT", body };
  const match = /^\/roll(?:\s+(.+))?$/i.exec(body);
  if (!match?.[1]?.trim())
    return {
      kind: "INVALID",
      message: "Укажите формулу после /roll, например /roll 1d20 + agility.",
    };
  return { kind: "ROLL", formula: match[1].trim() };
}

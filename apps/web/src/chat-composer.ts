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
    description: "Обычный бросок d20",
    example: "/d20",
    insertion: "/d20",
  },
  {
    command: "/roll",
    description: "Выполнить публичный бросок по формуле",
    example: "/roll 1d20 + agility",
    insertion: "/roll 1d20 + agility",
  },
];

/**
 * UIX-424: подписи приходят из раскладки кампании, а не лежат здесь копией.
 * Прежний список успел разойтись с остальными тремя, и «Воля» в нём называлась
 * не так, как «Сила воли» везде ещё.
 */
function supportedCharacteristics(
  stats: Record<string, number> = {},
  labels: Record<string, string>,
) {
  return Object.entries(stats ?? {}).filter(
    ([key, value]) => Object.hasOwn(labels, key) && Number.isFinite(value),
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
  labels: Record<string, string> = {},
): SlashCommandSuggestion[] {
  if (!value.startsWith("/") || value.includes("\n")) return [];
  const query = value.slice(1).trimStart().toLocaleLowerCase("ru");
  if (query.includes(" ")) return [];
  const characteristicCommands = supportedCharacteristics(stats, labels).map(
    ([key, value]) => ({
      command: `/${key}`,
      description: `${labels[key]}: бросок 1d20 + ${value}`,
      example: `/${key}`,
      insertion: `/${key}`,
    }),
  );
  return [...slashCommands, ...characteristicCommands].filter((item) =>
    item.command.slice(1).toLocaleLowerCase("ru").startsWith(query),
  );
}

/**
 * Picks the pasted image out of a clipboard payload, if there is one.
 * Plain-text paste (no image items) must fall through untouched so the
 * browser's default paste-into-textarea behavior keeps working.
 */
export function extractPastedImageFile(
  clipboardData: Pick<DataTransfer, "items"> | null | undefined,
): File | null {
  if (!clipboardData) return null;
  for (const item of Array.from(clipboardData.items)) {
    if (item.kind === "file" && item.type.startsWith("image/")) {
      return item.getAsFile();
    }
  }
  return null;
}

/**
 * Keeps chat text and explicit dice syntax on one safe input path. Formula
 * evaluation is intentionally delegated to the server's dice parser.
 */
export function parseComposerInput(
  value: string,
  stats: Record<string, number> = {},
  labels: Record<string, string> = {},
): ComposerIntent {
  const body = value.trim();
  if (!body)
    return {
      kind: "INVALID",
      message: "Введите сообщение или бросок.",
    };
  const bareFormula = parseBareDiceFormula(body);
  if (bareFormula) return { kind: "ROLL", formula: bareFormula };
  if (/^\/d20$/i.test(body))
    return { kind: "ROLL", formula: "1d20", label: "d20" };
  const characteristic = /^\/([a-z_][a-z0-9_]*)$/i
    .exec(body)?.[1]
    ?.toLocaleLowerCase("en-US");
  const characteristicKey = characteristic
    ? supportedCharacteristics(stats, labels).find(
        ([key]) => key.toLocaleLowerCase("en-US") === characteristic,
      )?.[0]
    : undefined;
  if (characteristicKey) {
    return {
      kind: "ROLL",
      formula: `1d20 + ${characteristicKey}`,
      label: `Проверка: ${labels[characteristicKey]}`,
    };
  }
  if (!/^\/roll(?:\s|$)/i.test(body)) return { kind: "TEXT", body };
  const match = /^\/roll(?:\s+(.+))?$/i.exec(body);
  if (!match?.[1]?.trim())
    return {
      kind: "INVALID",
      message: "Укажите формулу после /roll, например /roll 1d20 + agility.",
    };
  return { kind: "ROLL", formula: match[1].trim() };
}

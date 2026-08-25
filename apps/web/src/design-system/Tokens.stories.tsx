import type { Meta, StoryObj } from "@storybook/react-vite";

/*
 * Инвентарь токенов, читаемый из живого CSS.
 *
 * Значения не продублированы здесь константами: они берутся через
 * `getComputedStyle` у настоящего `:root`. Список имён — единственное, что
 * задано вручную, и если токен переименуют, ячейка станет пустой и это будет
 * видно. Копия значений в TS означала бы, что стенд рано или поздно начнёт
 * показывать не то, что в продукте.
 */

const COLOR_TOKENS = [
  "--color-canvas",
  "--color-surface",
  "--color-surface-raised",
  "--color-surface-hover",
  "--color-border",
  "--color-border-hover",
  "--color-text",
  "--color-text-muted",
  "--color-text-faint",
  "--color-accent",
  "--color-accent-hover",
  "--color-danger",
  "--color-success",
  "--color-card-stats",
  "--color-card-combat",
  "--color-card-skills",
  "--color-card-abilities",
] as const;

const TYPE_TOKENS = [
  "--font-size-caption",
  "--font-size-label",
  "--font-size-body-sm",
  "--font-size-body",
  "--font-size-heading-sm",
  "--font-size-heading-md",
  "--font-size-heading-lg",
] as const;

const SPACE_TOKENS = [
  "--space-xs",
  "--space-sm",
  "--space-md",
  "--space-lg",
  "--space-xl",
  "--space-2xl",
] as const;

const RADIUS_TOKENS = ["--radius-sm", "--radius-md"] as const;

function read(token: string) {
  if (typeof document === "undefined") return "";
  return getComputedStyle(document.documentElement)
    .getPropertyValue(token)
    .trim();
}

function Row({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "minmax(180px, auto) 90px 1fr",
        alignItems: "center",
        gap: "var(--space-md)",
        padding: "var(--space-sm) 0",
        borderBottom: "1px solid var(--color-border)",
      }}
    >
      {children}
    </div>
  );
}

function Name({ token }: { token: string }) {
  return (
    <code
      style={{ fontFamily: "var(--font-mono)", color: "var(--color-text)" }}
    >
      {token}
    </code>
  );
}

function Value({ token }: { token: string }) {
  const value = read(token);
  return (
    <span
      style={{
        fontFamily: "var(--font-mono)",
        color: value ? "var(--color-text-muted)" : "var(--color-danger)",
      }}
    >
      {value || "— не найден"}
    </span>
  );
}

const meta: Meta = {
  title: "Дизайн-система/Токены",
  parameters: { layout: "padded" },
};
export default meta;

export const Цвет: StoryObj = {
  render: () => (
    <div>
      {COLOR_TOKENS.map((token) => (
        <Row key={token}>
          <Name token={token} />
          <Value token={token} />
          <span
            aria-hidden="true"
            style={{
              height: 28,
              borderRadius: "var(--radius-sm)",
              border: "1px solid var(--color-border)",
              background: `var(${token})`,
            }}
          />
        </Row>
      ))}
    </div>
  ),
};

export const Типографика: StoryObj = {
  render: () => (
    <div>
      {TYPE_TOKENS.map((token) => (
        <Row key={token}>
          <Name token={token} />
          <Value token={token} />
          <span
            style={{ fontSize: `var(${token})`, color: "var(--color-text)" }}
          >
            Мастер бросает 2d6 за проверку
          </span>
        </Row>
      ))}
    </div>
  ),
};

export const Отступы: StoryObj = {
  render: () => (
    <div>
      {SPACE_TOKENS.map((token) => (
        <Row key={token}>
          <Name token={token} />
          <Value token={token} />
          <span
            aria-hidden="true"
            style={{
              display: "block",
              height: 16,
              width: `var(${token})`,
              background: "var(--color-accent)",
              borderRadius: 2,
            }}
          />
        </Row>
      ))}
    </div>
  ),
};

export const Скругления: StoryObj = {
  render: () => (
    <div>
      {RADIUS_TOKENS.map((token) => (
        <Row key={token}>
          <Name token={token} />
          <Value token={token} />
          <span
            aria-hidden="true"
            style={{
              display: "block",
              height: 40,
              width: 80,
              background: "var(--color-surface-raised)",
              border: "1px solid var(--color-border)",
              borderRadius: `var(${token})`,
            }}
          />
        </Row>
      ))}
    </div>
  ),
};

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const readSource = (relative: string) =>
  readFileSync(fileURLToPath(new URL(relative, import.meta.url)), "utf8");

describe("Архитектурные инварианты (docs/CODING_GUIDELINES.md)", () => {
  it("App.tsx не разрастается обратно в монолит (лимит размера)", () => {
    const source = readSource("./App.tsx");
    const lineCount = source.split("\n").length;
    // App.tsx был 2865 строк. После фазы 1 (AppHeader, AppModals, TokenTray, ScenePicker)
    // и фазы 2 (useGameSocketSubscriptions) размер опустился ниже 2250 строк.
    // Не допускаем повторного разрастания.
    expect(
      lineCount,
      "Размер App.tsx превышает установленный лимит! Не инлайните диалоги, компоненты и сокеты в App.tsx, следуйте docs/CODING_GUIDELINES.md",
    ).toBeLessThanOrEqual(2250);
  });

  it("App.tsx не содержит прямого инлайнинга модальных окон (ArkenDialog, TextPromptDialog)", () => {
    const source = readSource("./App.tsx");
    expect(
      source.includes("<ArkenDialog"),
      "Не инлайните <ArkenDialog> в App.tsx! Выносите в AppModals.tsx или в доменные компоненты.",
    ).toBe(false);
    expect(
      source.includes("<TextPromptDialog"),
      "Не инлайните <TextPromptDialog> в App.tsx! Выносите в AppModals.tsx или в доменные компоненты.",
    ).toBe(false);
  });

  it("App.tsx не содержит прямого инлайнинга details токенов (<details className=\"token-tray\">)", () => {
    const source = readSource("./App.tsx");
    expect(
      source.includes('className="token-tray"'),
      "Лоток токенов должен жить в TokenTray.tsx, а не в App.tsx.",
    ).toBe(false);
  });

  it("App.tsx не содержит прямого инлайнинга шапки (<header className=\"topbar\">)", () => {
    const source = readSource("./App.tsx");
    expect(
      source.includes('className="topbar"'),
      "Шапка приложения должна жить в AppHeader.tsx, а не в App.tsx.",
    ).toBe(false);
  });

  it("App.tsx не содержит инлайновых сокет-подписок (Правило 5, useGameSocketSubscriptions)", () => {
    const source = readSource("./App.tsx");
    expect(
      source.includes('next.on("game:snapshot"') ||
        source.includes('socket.on("game:snapshot"') ||
        source.includes('next.on("connect"') ||
        source.includes('next.on("disconnect"'),
      "Подписки на сокеты реального времени должны быть изолированы в useGameSocketSubscriptions.ts, а не жить внутри App.tsx.",
    ).toBe(false);
  });
});

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import ts from "typescript";

const readSource = (relative: string) =>
  readFileSync(fileURLToPath(new URL(relative, import.meta.url)), "utf8");

describe("Архитектурные инварианты (docs/CODING_GUIDELINES.md)", () => {
  it("UIX-398 keeps the Sidebar boundary at 21 named props without inline callbacks or hidden spreads", () => {
    const source = ts.createSourceFile(
      "App.tsx",
      readSource("./App.tsx"),
      ts.ScriptTarget.Latest,
      true,
      ts.ScriptKind.TSX,
    );
    const sidebars: (ts.JsxOpeningElement | ts.JsxSelfClosingElement)[] = [];
    const visit = (node: ts.Node) => {
      if (
        (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) &&
        node.tagName.getText(source) === "Sidebar"
      )
        sidebars.push(node);
      ts.forEachChild(node, visit);
    };
    visit(source);
    expect(sidebars).toHaveLength(1);
    const attributes = sidebars[0]!.attributes.properties;
    expect(attributes.filter(ts.isJsxSpreadAttribute)).toEqual([]);
    const named = attributes
      .filter(ts.isJsxAttribute)
      .filter((attribute) => attribute.name.getText(source) !== "key");
    expect(named).toHaveLength(21);
    const inlineCallbacks = named.filter((attribute) => {
      const value = attribute.initializer;
      if (!value || !ts.isJsxExpression(value) || !value.expression)
        return false;
      let expression = value.expression;
      while (ts.isParenthesizedExpression(expression))
        expression = expression.expression;
      return (
        ts.isArrowFunction(expression) || ts.isFunctionExpression(expression)
      );
    });
    expect(
      inlineCallbacks.map((attribute) => attribute.name.getText(source)),
    ).toEqual([]);
  });

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

  it('App.tsx не содержит прямого инлайнинга details токенов (<details className="token-tray">)', () => {
    const source = readSource("./App.tsx");
    expect(
      source.includes('className="token-tray"'),
      "Лоток токенов должен жить в TokenTray.tsx, а не в App.tsx.",
    ).toBe(false);
  });

  it('App.tsx не содержит прямого инлайнинга шапки (<header className="topbar">)', () => {
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

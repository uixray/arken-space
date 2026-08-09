import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

// UIX-389: CharacterWorkspace.tsx pulls in the full Gravity UI kit (which
// ships CSS imports vitest's node environment can't transform). Follow the
// AppErrorBoundary.test.ts precedent of mocking the kit down to a plain
// <button>, since RollButton only needs Button's basic prop contract.
vi.mock("@gravity-ui/uikit", () => ({
  Button: ({
    className,
    disabled,
    onClick,
    children,
  }: {
    className?: string;
    disabled?: boolean;
    onClick?: () => void;
    children?: ReactNode;
  }) => (
    <button className={className} disabled={disabled} onClick={onClick}>
      {children}
    </button>
  ),
}));

const { RollButton } = await import("./CharacterWorkspace");

describe("RollButton (UIX-389 shared two-line roll presentation)", () => {
  it("shows the name and a humanized formula, never the raw stat key", () => {
    const html = renderToStaticMarkup(
      <RollButton name="Реакция" formula="1d20 + reaction" onClick={() => {}} />,
    );
    expect(html).toContain("Реакция");
    expect(html).toContain("d20"); // dice notation stays untouched
    expect(html).not.toContain("reaction");
  });

  it("humanizes every stat token in a multi-stat legacy skill formula", () => {
    const html = renderToStaticMarkup(
      <RollButton
        name="Удар ближним оружием"
        formula="1d20 + strength + agility"
        onClick={() => {}}
      />,
    );
    expect(html).toContain("Сила");
    expect(html).toContain("Ловкость");
    expect(html).not.toContain("strength");
    expect(html).not.toContain("agility");
  });

  it("does not raise for an unrecognized token and leaves it visible as-is", () => {
    const html = renderToStaticMarkup(
      <RollButton name="Особый бросок" formula="1d20 + luck" onClick={() => {}} />,
    );
    expect(html).toContain("luck");
  });
});

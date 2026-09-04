// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import type { TokenDto } from "@arken/contracts";
import { renderComponent, screen, userEvent } from "../test-support/render";
import { TokenConditionMenu } from "./TokenConditionMenu";

describe("TokenConditionMenu", () => {
  const token = {
    id: "token-1",
    revision: 7,
    conditions: ["POISONED"],
  } as TokenDto;

  it("adds and removes conditions without clearing others, using authoritative revision", async () => {
    const onChange = vi.fn().mockResolvedValue(undefined);
    const onClose = vi.fn();
    const user = userEvent.setup();
    const view = renderComponent(
      <TokenConditionMenu
        token={token}
        role="GM"
        onChange={onChange}
        onClose={onClose}
      />,
    );
    expect(
      screen.getByRole("menuitemcheckbox", { name: /Отравлен/ }),
    ).toHaveAttribute("aria-checked", "true");
    await user.click(
      screen.getByRole("menuitemcheckbox", { name: "Обездвижен" }),
    );
    expect(onChange).toHaveBeenLastCalledWith("token-1", 7, [
      "POISONED",
      "RESTRAINED",
    ]);
    expect(onClose).toHaveBeenCalledTimes(1);
    // Until a new snapshot arrives, the control does not invent saved state.
    expect(
      screen.getByRole("menuitemcheckbox", { name: "Обездвижен" }),
    ).toHaveAttribute("aria-checked", "false");
    view.rerender(
      <TokenConditionMenu
        token={{
          ...token,
          revision: 8,
          conditions: ["POISONED", "RESTRAINED"],
        }}
        role="GM"
        onChange={onChange}
        onClose={onClose}
      />,
    );
    await user.click(
      screen.getByRole("menuitemcheckbox", { name: /Отравлен/ }),
    );
    expect(onChange).toHaveBeenLastCalledWith("token-1", 8, ["RESTRAINED"]);
  });

  it("does not expose editing to a player", () => {
    renderComponent(
      <TokenConditionMenu
        token={token}
        role="PLAYER"
        onChange={vi.fn()}
        onClose={vi.fn()}
      />,
    );
    expect(
      screen.queryByRole("group", { name: "Состояния токена" }),
    ).not.toBeInTheDocument();
  });
});

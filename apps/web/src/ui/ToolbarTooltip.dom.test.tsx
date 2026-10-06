// @vitest-environment jsdom
import { expect, it } from "vitest";
import userEvent from "@testing-library/user-event";
import {
  fireEvent,
  renderComponent,
  screen,
  waitFor,
} from "../test-support/render";
import { ToolbarButton, ToolbarSummary } from "./ToolbarTooltip";
it("uses one bounded multiline tooltip for hover and keyboard focus while preserving trigger semantics", async () => {
  const user = userEvent.setup();
  const description =
    "Открыть туман многоугольником: клик добавляет вершину, Enter завершает, Escape отменяет";
  const { container } = renderComponent(
    <>
      <ToolbarButton aria-label="Туман" title={description}>
        Открыть
      </ToolbarButton>
      <details>
        <ToolbarSummary title="Настройки размера карты" aria-label="Размер">
          Размер
        </ToolbarSummary>
        <p>Настройки</p>
      </details>
    </>,
  );
  const button = screen.getByRole("button", { name: "Туман" });
  expect(button).not.toHaveAttribute("title");
  await user.hover(button);
  const tooltip = await screen.findByRole("tooltip");
  expect(tooltip).toHaveTextContent(description);
  expect(tooltip.style.whiteSpace).toBe("normal");
  expect(tooltip.style.overflowWrap).toBe("anywhere");
  expect(tooltip.style.maxWidth).toContain("280px");
  await user.unhover(button);
  await waitFor(() =>
    expect(screen.queryByRole("tooltip")).not.toBeInTheDocument(),
  );
  await user.tab();
  expect(button).toHaveFocus();
  expect(await screen.findByRole("tooltip")).toHaveTextContent(description);
  expect(button).toHaveAccessibleDescription(description);
  fireEvent.keyDown(button, { key: "Escape" });
  await waitFor(() =>
    expect(screen.queryByRole("tooltip")).not.toBeInTheDocument(),
  );
  const summary = container.querySelector("summary")!;
  expect(summary).not.toHaveAttribute("title");
  expect(summary.parentElement?.tagName).toBe("DETAILS");
  expect(container.querySelector("button button")).toBeNull();
});

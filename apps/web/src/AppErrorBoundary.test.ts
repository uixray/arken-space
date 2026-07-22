import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

const { reportRenderFailure } = vi.hoisted(() => ({
  reportRenderFailure: vi.fn(),
}));
vi.mock("./app-error-report", () => ({ reportRenderFailure }));
vi.mock("@gravity-ui/uikit", () => ({ Button: () => null }));

import { AppErrorBoundary } from "./AppErrorBoundary";

describe("AppErrorBoundary telemetry", () => {
  it("shows and reports the same bounded correlation code", () => {
    const error = new TypeError("private message");
    const state = AppErrorBoundary.getDerivedStateFromError(error);
    const boundary = new AppErrorBoundary({ children: null });
    boundary.state = state;
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => {});

    boundary.componentDidCatch(error);
    const html = renderToStaticMarkup(boundary.render());
    const visibleCode = /UI-[0-9A-F]{8}/.exec(html)?.[0];

    expect(visibleCode).toBe(state.code);
    expect(reportRenderFailure).toHaveBeenCalledWith(visibleCode, "TypeError");
    expect(consoleError).toHaveBeenCalledWith("app.render_failed", {
      code: visibleCode,
    });
    expect(JSON.stringify(consoleError.mock.calls)).not.toContain(
      "private message",
    );
    consoleError.mockRestore();
  });
});

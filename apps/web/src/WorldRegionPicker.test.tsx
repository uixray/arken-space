// @vitest-environment jsdom
import { useState } from "react";
import { afterEach, expect, it, vi } from "vitest";
import {
  renderComponent,
  screen,
  userEvent,
  waitFor,
} from "./test-support/render";

const apiMock = vi.hoisted(() => vi.fn());
vi.mock("./api", async (original) => ({
  ...(await original<typeof import("./api")>()),
  api: apiMock,
}));
const { WorldRegionPicker } = await import("./WorldRegionPicker");

afterEach(() => {
  apiMock.mockReset();
});

it("exposes an accessible region selector and preserves the chosen region when search changes", async () => {
  apiMock.mockImplementation((url: string) =>
    Promise.resolve({
      items:
        url.includes("id=region-1") || !url.includes("q=other")
          ? [{ id: "region-1", name: "Север" }]
          : [],
      hasMore: false,
    }),
  );
  function Fixture() {
    const [value, setValue] = useState("");
    return <WorldRegionPicker value={value} onChange={setValue} />;
  }
  const user = userEvent.setup();
  renderComponent(<Fixture />);
  const select = screen.getByRole("combobox", { name: "Регион" });
  await waitFor(() => expect(apiMock).toHaveBeenCalled());
  await user.click(select);
  await user.click(await screen.findByRole("option", { name: "Север" }));
  await user.type(
    screen.getByRole("textbox", { name: "Поиск региона" }),
    "other",
  );
  await waitFor(() =>
    expect(
      apiMock.mock.calls.some(([url]) => String(url).includes("q=other")),
    ).toBe(true),
  );
  expect(
    screen.getByRole("combobox", { name: "Регион" }).textContent,
  ).toContain("Север");
});

it("shows a recoverable error for malformed region entries instead of crashing", async () => {
  apiMock.mockResolvedValueOnce({ items: [null], hasMore: false });
  apiMock.mockResolvedValue({
    items: [{ id: "region-1", name: "Север" }],
    hasMore: false,
  });
  const user = userEvent.setup();
  renderComponent(<WorldRegionPicker value="" onChange={() => {}} />);
  expect(await screen.findByRole("status")).toHaveTextContent(
    "неверный ответ сервера",
  );
  await user.click(screen.getByRole("button", { name: "Обновить регионы" }));
  await waitFor(() => expect(screen.queryByRole("status")).toBeNull());
  await user.click(screen.getByRole("combobox", { name: "Регион" }));
  expect(await screen.findByRole("option", { name: "Север" })).toBeTruthy();
});

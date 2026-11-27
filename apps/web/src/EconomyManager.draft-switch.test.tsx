// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { createRef } from "react";
import type { EconomyManagerHandle } from "./EconomyManager";
import {
  renderComponent,
  screen,
  userEvent,
  waitFor,
} from "./test-support/render";
const mocks = vi.hoisted(() => ({ read: vi.fn(), write: vi.fn() }));
vi.mock("./economy-client", () => ({
  economyApi: mocks.read,
  economyRequest: mocks.write,
}));
const { EconomyManager } = await import("./EconomyManager");
afterEach(() => sessionStorage.clear());
it("retains an unfinished merchant when starting a new one is cancelled", async () => {
  mocks.read.mockResolvedValue({
    revision: null,
    config: null,
    merchants: [],
    offers: [],
    instances: [],
    regions: [],
  });
  const confirm = vi
    .spyOn(window, "confirm")
    .mockReturnValueOnce(false)
    .mockReturnValueOnce(true);
  renderComponent(
    <EconomyManager
      context={{ campaignId: "c", membershipId: "m" }}
      onSaved={() => {}}
    />,
  );
  const user = userEvent.setup();
  await screen.findByText("Магазины", { selector: "summary" });
  await user.click(screen.getByText("Магазины", { selector: "summary" }));
  const name = screen.getByLabelText("Название", { exact: true });
  await user.type(name, "Черновик");
  await user.click(screen.getByRole("button", { name: "Новый магазин" }));
  expect(name).toHaveValue("Черновик");
  await user.click(screen.getByRole("button", { name: "Новый магазин" }));
  expect(name).toHaveValue("");
  expect(confirm).toHaveBeenCalledTimes(2);
  confirm.mockRestore();
});
it("asks before leaving with edited settings and lets the user keep them", async () => {
  mocks.read.mockResolvedValue({
    revision: null,
    config: null,
    merchants: [],
    offers: [],
    instances: [],
    regions: [],
  });
  const confirm = vi
    .spyOn(window, "confirm")
    .mockReturnValueOnce(false)
    .mockReturnValueOnce(true);
  const ref = createRef<EconomyManagerHandle>();
  renderComponent(
    <EconomyManager
      ref={ref}
      context={{ campaignId: "c", membershipId: "m" }}
      onSaved={() => {}}
    />,
  );
  const user = userEvent.setup();
  await screen.findByText("Магазины", { selector: "summary" });
  await user.click(screen.getByText("Магазины", { selector: "summary" }));
  await user.type(
    screen.getByLabelText("Название", { exact: true }),
    "Черновик",
  );
  expect(ref.current?.allowExit()).toBe(false);
  expect(screen.getByLabelText("Название", { exact: true })).toHaveValue(
    "Черновик",
  );
  expect(ref.current?.allowExit()).toBe(true);
  confirm.mockRestore();
});
it("retains a price request when success does not contain the matching receipt", async () => {
  const id = "00000000-0000-4000-8000-000000000001";
  mocks.read
    .mockReset()
    .mockResolvedValue({
      revision: null,
      config: null,
      merchants: [],
      offers: [],
      regions: [],
      instances: [
        {
          id: "instance",
          name: "Предмет",
          worldContentId: id,
          worldRevision: 2,
          basePriceCopper: 1,
        },
      ],
    });
  mocks.write
    .mockReset()
    .mockResolvedValueOnce(null)
    .mockResolvedValueOnce({ id, revision: 3 });
  const view = renderComponent(
    <EconomyManager
      context={{ campaignId: "c", membershipId: "m" }}
      onSaved={() => {}}
    />,
  );
  const user = userEvent.setup();
  await user.click(
    await screen.findByText("Базовые цены предметов", { selector: "summary" }),
  );
  await user.selectOptions(
    screen.getByLabelText("Экземпляр предмета"),
    "instance",
  );
  const price = screen.getByLabelText("Медных за штуку");
  await user.clear(price);
  await user.type(price, "5");
  await user.click(
    screen.getByRole("button", { name: "Сохранить базовую цену" }),
  );
  await screen.findByText(/Ответ не подтверждает сохранение/);
  view.unmount();
  renderComponent(
    <EconomyManager
      context={{ campaignId: "c", membershipId: "m" }}
      onSaved={() => {}}
    />,
  );
  await user.click(
    await screen.findByRole("button", { name: "Повторить то же сохранение" }),
  );
  await waitFor(() => expect(mocks.write).toHaveBeenCalledTimes(2));
  expect(mocks.write.mock.calls[1]![2].actionId).toBe(
    mocks.write.mock.calls[0]![2].actionId,
  );
  await screen.findByText("Сохранено.");
  expect(
    sessionStorage.getItem("arken.economy.manager.pending.v1.c.m"),
  ).toBeNull();
});
it("blocks mutations without deleting a corrupt saved command", async () => {
  const key = "arken.economy.manager.pending.v1.c.m";
  sessionStorage.setItem(key, "{");
  mocks.read.mockResolvedValue({
    revision: null,
    config: null,
    merchants: [],
    offers: [],
    instances: [],
    regions: [],
  });
  renderComponent(
    <EconomyManager
      context={{ campaignId: "c", membershipId: "m" }}
      onSaved={() => {}}
    />,
  );
  expect(
    await screen.findByText(/команда настроек повреждена/i),
  ).toBeInTheDocument();
  expect(
    await screen.findByRole("group", { name: "Правила кампании" }),
  ).toBeDisabled();
  expect(sessionStorage.getItem(key)).toBe("{");
});

// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { renderComponent, screen, userEvent } from "./test-support/render";
vi.mock("./use-creation-session", () => ({
  useCreationPage: () => ({
    data: { items: [], nextAfter: null },
    loading: false,
    error: "",
    hasPrevious: false,
    next: vi.fn(),
    first: vi.fn(),
  }),
}));
const { CreationStudio } = await import("./CreationStudio");
afterEach(() => vi.restoreAllMocks());
it("preserves an unsaved draft when switching constructor is cancelled", async () => {
  const confirm = vi
    .spyOn(window, "confirm")
    .mockReturnValueOnce(false)
    .mockReturnValueOnce(true);
  const session = {
    context: { campaignId: "c", membershipId: "m" },
    busy: false,
    locked: false,
  };
  renderComponent(
    <CreationStudio
      session={session as never}
      packs={[]}
      gm={false}
      characterId=""
      active
    />,
  );
  const user = userEvent.setup();
  await user.type(
    screen.getByLabelText("Название", { exact: true }),
    "Незаконченный чертёж",
  );
  await user.click(screen.getByRole("button", { name: "Новый артефакт" }));
  expect(confirm).toHaveBeenCalledTimes(1);
  expect(screen.getByLabelText("Название", { exact: true })).toHaveValue(
    "Незаконченный чертёж",
  );
  await user.click(screen.getByRole("button", { name: "Новый артефакт" }));
  expect(confirm).toHaveBeenCalledTimes(2);
  expect(
    screen.getByRole("heading", { name: "Конструктор артефакта" }),
  ).toBeInTheDocument();
  expect(screen.getByLabelText("Название", { exact: true })).toHaveValue("");
});

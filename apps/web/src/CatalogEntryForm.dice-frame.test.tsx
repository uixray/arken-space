// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { AssetDto, CatalogEntryDto } from "@arken/contracts";
import { renderComponent, screen, userEvent } from "./test-support/render";
import { CatalogEntryForm } from "./CatalogEntryForm";

/** UIX-457: рамку навыку задаёт мастер в форме общего каталога. */
const frame = {
  id: "11111111-2222-4333-8444-555555555555",
  kind: "DICE_FRAME",
  name: "Огонь",
  url: "/api/assets/frame/content?v=a",
  posterUrl: "/api/assets/frame/content?variant=poster&v=b",
} as unknown as AssetDto;

beforeEach(() =>
  vi.stubGlobal("matchMedia", (media: string) => ({
    matches: false,
    media,
    onchange: null,
    addEventListener() {},
    removeEventListener() {},
    addListener() {},
    removeListener() {},
    dispatchEvent: () => true,
  })),
);
afterEach(() => vi.unstubAllGlobals());

const render = (props: {
  diceFrames?: AssetDto[];
  existing?: CatalogEntryDto;
}) => {
  const onSubmit = vi.fn();
  renderComponent(
    <CatalogEntryForm
      statLabels={{}}
      resourceLabels={{ physical: "Выносливость", magic: "Мана" }}
      onSubmit={onSubmit}
      onCancel={vi.fn()}
      {...props}
    />,
  );
  return onSubmit;
};

it("submits the chosen skill frame and can return to the player's own", async () => {
  const user = userEvent.setup();
  const onSubmit = render({
    diceFrames: [frame],
    existing: {
      id: "entry",
      kind: "SKILL",
      name: "Огненный удар",
      description: "",
      data: {},
      revision: 3,
      diceFrameAssetId: null,
    },
  });
  const group = screen.getByRole("group", { name: "Рамка бросков навыка" });
  expect(screen.getByRole("radio", { name: "Рамка игрока" })).toBeChecked();
  await user.click(screen.getByRole("radio", { name: "Огонь" }));
  await user.click(screen.getByRole("button", { name: /^Сохранить$/ }));
  expect(onSubmit.mock.calls[0]![0]).toMatchObject({
    diceFrameAssetId: frame.id,
  });
  await user.click(screen.getByRole("radio", { name: "Рамка игрока" }));
  await user.click(screen.getByRole("button", { name: /^Сохранить$/ }));
  expect(onSubmit.mock.calls[1]![0]).toMatchObject({ diceFrameAssetId: null });
  expect(group).toBeInTheDocument();
});

it("leaves character-entry forms without a frame field or payload key", async () => {
  const user = userEvent.setup();
  const onSubmit = render({});
  expect(
    screen.queryByRole("group", { name: "Рамка бросков навыка" }),
  ).not.toBeInTheDocument();
  await user.type(
    screen.getByLabelText("Название *", { exact: true }),
    "Личная",
  );
  await user.click(screen.getByRole("button", { name: /^Сохранить$/ }));
  expect(onSubmit.mock.calls[0]![0]).not.toHaveProperty("diceFrameAssetId");
});

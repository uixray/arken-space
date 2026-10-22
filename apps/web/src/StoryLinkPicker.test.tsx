// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import type { StoryLinkTargetDto, StoryPostAdminDto } from "@arken/contracts";
import {
  renderComponent,
  screen,
  userEvent,
  within,
} from "./test-support/render";
import { StoryChannel, StoryPost } from "./StoryChannel";
import { StoryLinkChips } from "./StoryLinkPicker";

/** UIX-245: связи записи летописи с сущностями мира, местами и сценами. */
const target = (
  overrides: Partial<StoryLinkTargetDto> = {},
): StoryLinkTargetDto => ({
  kind: "WORLD_ENTITY",
  entityId: crypto.randomUUID(),
  label: "Ледяная переправа",
  playerVisible: true,
  ...overrides,
});

const post = (
  overrides: Partial<StoryPostAdminDto> = {},
): StoryPostAdminDto => ({
  id: crypto.randomUUID(),
  threadId: "00000000-0000-4000-8000-000000000002",
  authorMembershipId: "00000000-0000-4000-8000-000000000003",
  title: "Переправа",
  body: "Отряд перешёл реку.",
  lifecycle: "DRAFT",
  revision: 0,
  entityLinks: [],
  linkTargets: [],
  media: [],
  publishedAt: null,
  correctedAt: null,
  archivedAt: null,
  gmNotes: "",
  worldDay: 3,
  era: null,
  createdAt: "2026-10-22T10:00:00.000Z",
  updatedAt: "2026-10-22T10:00:00.000Z",
  ...overrides,
});

describe("StoryLinkChips", () => {
  it("labels each link by kind and marks hidden targets only for the GM", () => {
    const targets = [
      target(),
      target({ kind: "SCENE", label: "Засада", playerVisible: false }),
      target({ kind: "LOCATION", label: null, playerVisible: false }),
    ];
    const { unmount } = renderComponent(
      <StoryLinkChips targets={targets} isGm />,
    );
    const list = screen.getByRole("list", { name: "Связи записи" });
    const items = within(list).getAllByRole("listitem");
    expect(items.map((item) => item.textContent)).toEqual([
      "Сущность мираЛедяная переправа",
      "СценаЗасадаскрыто от игроков",
      "МестоУдалённая цельскрыто от игроков",
    ]);
    unmount();
    renderComponent(<StoryLinkChips targets={[targets[0]!]} isGm={false} />);
    expect(screen.queryByText("скрыто от игроков")).toBeNull();
  });

  it("renders nothing for a post without links or a legacy payload", () => {
    const legacy = post();
    delete (legacy as Partial<StoryPostAdminDto>).linkTargets;
    renderComponent(<StoryPost post={legacy} isGm={false} />);
    expect(screen.queryByRole("list", { name: "Связи записи" })).toBeNull();
  });
});

describe("StoryLinkPicker in the composer", () => {
  it("searches on Enter without submitting and sends the chosen links", async () => {
    const user = userEvent.setup();
    const found = [
      target(),
      target({ kind: "SCENE", label: "Засада", playerVisible: false }),
    ];
    const onSearch = vi.fn().mockResolvedValue(found);
    const onCreateDraft = vi.fn().mockResolvedValue(undefined);
    renderComponent(
      <StoryChannel
        posts={[]}
        isGm
        onCreateDraft={onCreateDraft}
        onSearchLinkTargets={onSearch}
      />,
    );
    await user.type(screen.getByLabelText("Новая публикация"), "Запись");
    await user.type(
      screen.getByLabelText("Найти цель для связи"),
      "пере{Enter}",
    );
    expect(onSearch).toHaveBeenCalledWith("пере");
    expect(onCreateDraft).not.toHaveBeenCalled();

    const results = await screen.findByRole("list", { name: "Найденные цели" });
    await user.click(
      within(results).getByRole("button", {
        name: "Связать: Сущность мира · Ледяная переправа",
      }),
    );
    await user.click(
      within(results).getByRole("button", { name: "Связать: Сцена · Засада" }),
    );
    expect(
      within(results).getByRole("button", {
        name: "Связать: Сцена · Засада",
      }),
    ).toBeDisabled();
    await user.click(
      screen.getByRole("button", { name: "Убрать связь «Засада»" }),
    );
    await user.click(
      screen.getByRole("button", { name: "Сохранить черновик" }),
    );
    expect(onCreateDraft.mock.calls[0]![0].entityLinks).toEqual([
      { kind: "WORLD_ENTITY", entityId: found[0]!.entityId },
    ]);
    expect(screen.queryByRole("list", { name: "Выбранные связи" })).toBeNull();
  });

  it("hides the picker from players", () => {
    renderComponent(
      <StoryChannel
        posts={[post({ lifecycle: "PUBLISHED" })]}
        isGm={false}
        onSearchLinkTargets={vi.fn()}
      />,
    );
    expect(screen.queryByLabelText("Найти цель для связи")).toBeNull();
  });
});

describe("StoryLinkPicker in a correction", () => {
  it("keeps existing links, including a deleted target, unless removed", async () => {
    const user = userEvent.setup();
    const kept = target();
    const deleted = target({
      kind: "SCENE",
      label: null,
      playerVisible: false,
    });
    const onUpdate = vi.fn().mockResolvedValue(undefined);
    renderComponent(
      <StoryPost
        post={post({
          entityLinks: [kept, deleted].map(({ kind, entityId }) => ({
            kind,
            entityId,
          })),
          linkTargets: [kept, deleted],
        })}
        isGm
        onUpdate={onUpdate}
        onSearchLinkTargets={vi.fn().mockResolvedValue([])}
      />,
    );
    await user.click(screen.getByRole("button", { name: "Исправить" }));
    const selected = screen.getByRole("list", { name: "Выбранные связи" });
    expect(within(selected).getAllByRole("listitem")).toHaveLength(2);
    await user.click(
      screen.getByRole("button", { name: "Убрать связь «Удалённая цель»" }),
    );
    await user.click(screen.getByRole("button", { name: "Сохранить" }));
    expect(onUpdate.mock.calls[0]![1].entityLinks).toEqual([
      { kind: kept.kind, entityId: kept.entityId },
    ]);
  });
});

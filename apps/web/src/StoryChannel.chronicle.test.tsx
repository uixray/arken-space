// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import type { StoryPostAdminDto } from "@arken/contracts";
import { renderComponent, screen, userEvent } from "./test-support/render";
import { StoryChannel } from "./StoryChannel";
import {
  parseStoryWorldDay,
  storyWorldTimeLabel,
} from "./story-channel-helpers";

/** UIX-245: летопись по дню кампании и эпохе, черновик из события игры. */
const post = (
  overrides: Partial<StoryPostAdminDto> = {},
): StoryPostAdminDto => ({
  id: crypto.randomUUID(),
  threadId: "00000000-0000-4000-8000-000000000002",
  authorMembershipId: "00000000-0000-4000-8000-000000000003",
  title: "Ночь у переправы",
  body: "Отряд перешёл реку.",
  lifecycle: "DRAFT",
  revision: 0,
  entityLinks: [],
  media: [],
  publishedAt: null,
  correctedAt: null,
  archivedAt: null,
  gmNotes: "",
  worldDay: 12,
  era: "Эпоха пепла",
  createdAt: "2026-10-21T10:00:00.000Z",
  updatedAt: "2026-10-21T10:00:00.000Z",
  ...overrides,
});

describe("chronicle helpers", () => {
  it("parses the campaign day field strictly", () => {
    expect(parseStoryWorldDay("")).toBeNull();
    expect(parseStoryWorldDay("  ")).toBeNull();
    expect(parseStoryWorldDay("12")).toBe(12);
    expect(parseStoryWorldDay("0")).toBeUndefined();
    expect(parseStoryWorldDay("1.5")).toBeUndefined();
    expect(parseStoryWorldDay("-3")).toBeUndefined();
    expect(parseStoryWorldDay("1000001")).toBeUndefined();
  });

  it("labels world time and omits what is missing", () => {
    expect(storyWorldTimeLabel(post())).toBe("День 12 · Эпоха пепла");
    expect(storyWorldTimeLabel(post({ era: null }))).toBe("День 12");
    expect(storyWorldTimeLabel(post({ worldDay: null }))).toBe("Эпоха пепла");
    expect(storyWorldTimeLabel(post({ worldDay: null, era: null }))).toBe("");
  });
});

describe("StoryChannel chronicle controls", () => {
  it("shows world time on entries and filters by era with pressed buttons", async () => {
    const user = userEvent.setup();
    const onSelectEra = vi.fn().mockResolvedValue(undefined);
    renderComponent(
      <StoryChannel
        posts={[post()]}
        isGm={false}
        eras={["Эпоха пепла", "Эпоха льда"]}
        eraFilter={null}
        onSelectEra={onSelectEra}
      />,
    );
    expect(screen.getByText("День 12 · Эпоха пепла")).toBeInTheDocument();
    const group = screen.getByRole("group", { name: "Эпохи летописи" });
    expect(group).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Все эпохи" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    await user.click(screen.getByRole("button", { name: "Эпоха льда" }));
    expect(onSelectEra).toHaveBeenCalledWith("Эпоха льда");
  });

  it("sends day and era from the composer and leaves an empty day to the server", async () => {
    const user = userEvent.setup();
    const onCreateDraft = vi.fn().mockResolvedValue(undefined);
    renderComponent(
      <StoryChannel posts={[]} isGm onCreateDraft={onCreateDraft} />,
    );
    await user.type(screen.getByLabelText("Новая публикация"), "Запись");
    await user.click(
      screen.getByRole("button", { name: "Сохранить черновик" }),
    );
    expect(onCreateDraft.mock.calls[0]![0]).not.toHaveProperty("worldDay");
    expect(onCreateDraft.mock.calls[0]![0]).toMatchObject({ era: null });

    await user.type(screen.getByLabelText("Новая публикация"), "Ещё");
    await user.type(screen.getByLabelText("День кампании"), "3");
    await user.type(screen.getByLabelText("Эпоха"), "Эпоха льда");
    await user.click(
      screen.getByRole("button", { name: "Сохранить черновик" }),
    );
    expect(onCreateDraft.mock.calls[1]![0]).toMatchObject({
      worldDay: 3,
      era: "Эпоха льда",
    });
  });

  it("rejects an invalid day before submitting", async () => {
    const user = userEvent.setup();
    const onCreateDraft = vi.fn().mockResolvedValue(undefined);
    renderComponent(
      <StoryChannel posts={[]} isGm onCreateDraft={onCreateDraft} />,
    );
    await user.type(screen.getByLabelText("Новая публикация"), "Запись");
    const day = screen.getByLabelText<HTMLInputElement>("День кампании");
    await user.type(day, "0");
    await user.click(
      screen.getByRole("button", { name: "Сохранить черновик" }),
    );
    // Нативная проверка `min=1` останавливает отправку раньше обработчика.
    expect(day.validity.valid).toBe(false);
    expect(onCreateDraft).not.toHaveBeenCalled();
  });

  it("lets the GM start a draft from a recent game event", async () => {
    const user = userEvent.setup();
    const onLoadEventSources = vi.fn().mockResolvedValue([
      {
        sequence: 41,
        type: "dice.created",
        label: "Бросок кубиков",
        createdAt: "2026-10-21T10:00:00.000Z",
      },
    ]);
    const onCreateFromEvent = vi.fn().mockResolvedValue(undefined);
    renderComponent(
      <StoryChannel
        posts={[]}
        isGm
        onCreateDraft={vi.fn()}
        onLoadEventSources={onLoadEventSources}
        onCreateFromEvent={onCreateFromEvent}
      />,
    );
    await user.click(
      screen.getByRole("button", { name: "Черновик из события игры" }),
    );
    await user.click(
      await screen.findByRole("button", { name: /^Бросок кубиков · / }),
    );
    expect(onCreateFromEvent).toHaveBeenCalledWith(41);
  });

  it("hides event seeding from players", () => {
    renderComponent(
      <StoryChannel
        posts={[]}
        isGm={false}
        onLoadEventSources={vi.fn()}
        onCreateFromEvent={vi.fn()}
      />,
    );
    expect(
      screen.queryByRole("button", { name: "Черновик из события игры" }),
    ).toBeNull();
  });
});

describe("legacy story payloads", () => {
  it("treats a response without world time as undated", () => {
    const legacy = post();
    delete (legacy as Partial<StoryPostAdminDto>).worldDay;
    delete (legacy as Partial<StoryPostAdminDto>).era;
    expect(storyWorldTimeLabel(legacy)).toBe("");
    renderComponent(<StoryChannel posts={[legacy]} isGm={false} />);
    expect(screen.queryByText(/undefined/)).toBeNull();
  });
});

// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  fireEvent,
  renderComponent,
  screen,
  waitFor,
} from "./test-support/render";

const mocks = vi.hoisted(() => ({ list: vi.fn(), remove: vi.fn() }));
vi.mock("./story-attachment-api", () => ({
  listStoryAttachments: mocks.list,
  deleteStoryAttachment: mocks.remove,
}));
const { StoryAttachmentLibrary } = await import("./StoryAttachmentLibrary");

const record = {
  contentId: "123e4567-e89b-42d3-a456-426614174000",
  fileName: "scene.webp",
  mimeType: "image/webp",
  sizeBytes: 2048,
  status: "CLAIMED" as const,
  storyRevisionCount: 2,
  storyReferences: [
    {
      postId: "123e4567-e89b-42d3-a456-426614174001",
      revision: 1,
      title: "First scene",
      lifecycle: "PUBLISHED" as const,
      visibility: "PUBLIC" as const,
      isCurrent: false,
    },
    {
      postId: "123e4567-e89b-42d3-a456-426614174001",
      revision: 2,
      title: "Second scene",
      lifecycle: "CORRECTED" as const,
      visibility: "PUBLIC" as const,
      isCurrent: true,
    },
  ],
  directChatReferenceCount: 1,
  cleanupPending: false,
};

beforeEach(() => {
  mocks.list.mockReset();
  mocks.remove.mockReset();
  mocks.list.mockResolvedValue({ attachments: [record] });
  mocks.remove.mockResolvedValue({
    deleted: true,
    contentId: record.contentId,
  });
});
afterEach(() => vi.restoreAllMocks());

describe("StoryAttachmentLibrary", () => {
  it("does not fetch or render for non-GMs", () => {
    const view = renderComponent(
      <StoryAttachmentLibrary campaignId="one" isGm={false} />,
    );
    expect(view.container).toBeEmptyDOMElement();
    expect(mocks.list).not.toHaveBeenCalled();
  });

  it("shows historical/current revision locations and aggregate-only direct usage, blocking deletion", async () => {
    renderComponent(<StoryAttachmentLibrary campaignId="one" isGm />);
    expect(
      await screen.findByText(/First scene · версия 1/),
    ).toBeInTheDocument();
    expect(screen.getByText(/Second scene · версия 2/)).toBeInTheDocument();
    expect(screen.getByText(/личные сообщения: 1 ссылка/)).toBeInTheDocument();
    expect(
      screen.queryByText(/participant|thread|private text/i),
    ).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Используется" })).toBeDisabled();
  });

  it("refreshes after cleanup and offers retry when the backend leaves a tombstone", async () => {
    const tombstone = {
      ...record,
      status: "EXPIRED" as const,
      storyRevisionCount: 0,
      storyReferences: [],
      directChatReferenceCount: 0,
      cleanupPending: true,
    };
    mocks.list
      .mockResolvedValueOnce({ attachments: [tombstone] })
      .mockResolvedValueOnce({ attachments: [tombstone] })
      .mockResolvedValue({ attachments: [] });
    mocks.remove.mockResolvedValueOnce({
      deleted: false,
      cleanupPending: true,
      contentId: record.contentId,
    });
    mocks.remove.mockResolvedValueOnce({
      deleted: true,
      contentId: record.contentId,
    });
    renderComponent(<StoryAttachmentLibrary campaignId="one" isGm />);
    fireEvent.click(
      await screen.findByRole("button", { name: "Повторить очистку" }),
    );
    expect(await screen.findByText(/пока не очищен/)).toBeInTheDocument();
    await waitFor(() => expect(mocks.list).toHaveBeenCalledTimes(2));
    fireEvent.click(screen.getByRole("button", { name: "Повторить очистку" }));
    await waitFor(() => expect(mocks.list).toHaveBeenCalledTimes(3));
    expect(
      await screen.findByText("Нет вложений, доступных для управления."),
    ).toBeInTheDocument();
  });
});

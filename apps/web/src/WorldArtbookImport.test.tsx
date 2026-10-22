// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderComponent, screen, userEvent } from "./test-support/render";

const client = vi.hoisted(() => ({
  fetchWorldContentList: vi.fn(),
  createWorldContent: vi.fn(),
  updateWorldContent: vi.fn(),
  addWorldContentMedia: vi.fn(),
}));
const http = vi.hoisted(() => ({ api: vi.fn() }));
vi.mock("./world-content-client", () => client);
vi.mock("./api", () => ({
  api: http.api,
  formatApiError: (_: unknown, fallback: string) => fallback,
}));

import { WorldArtbookImport, artbookRelativePath } from "./WorldArtbookImport";

/** UIX-263: artbook import creates DRAFT canon with provenance, never overwrites. */
beforeEach(() => {
  for (const fn of Object.values(client)) fn.mockReset();
  http.api.mockReset();
});

describe("WorldArtbookImport", () => {
  it("creates missing records with provenance and skips existing slugs", async () => {
    const user = userEvent.setup();
    client.fetchWorldContentList.mockResolvedValue([{ slug: "artbook-yaro" }]);
    client.createWorldContent.mockResolvedValue({});
    const onChanged = vi.fn();
    renderComponent(<WorldArtbookImport onChanged={onChanged} />);
    await user.click(
      screen.getByRole("button", { name: "1. Импортировать тексты" }),
    );
    expect(await screen.findByRole("status")).toHaveTextContent(
      "Готово 78 из 78; пропущено: 1; ошибок: 0.",
    );
    expect(client.createWorldContent).toHaveBeenCalledTimes(77);
    expect(client.createWorldContent.mock.calls[0]![0]).toMatchObject({
      provenance: {
        rightsReviewStatus: "APPROVED",
        editorialApprovalStatus: "PENDING",
        sourceUrl: expect.stringContaining("arc.framer.photos"),
      },
    });
    expect(
      client.createWorldContent.mock.calls.some(
        ([input]) => input.slug === "artbook-yaro",
      ),
    ).toBe(false);
    expect(onChanged).toHaveBeenCalled();
  });

  it("strips the picked folder name from relative paths", () => {
    const file = new File(["x"], "Яро.png");
    Object.defineProperty(file, "webkitRelativePath", {
      value: "Артбук/Пантеон/Яро.png",
    });
    expect(artbookRelativePath(file)).toBe("Пантеон/Яро.png");
  });
});

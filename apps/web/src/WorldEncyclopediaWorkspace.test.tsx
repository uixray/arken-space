// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  fireEvent,
  renderComponent,
  screen,
  waitFor,
} from "./test-support/render";

const apiMock = vi.hoisted(() => vi.fn());
vi.mock("./api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./api")>()),
  api: apiMock,
}));
const { WorldEncyclopediaWorkspace } =
  await import("./WorldEncyclopediaWorkspace");

const subjectId = "24500000-0000-4000-8000-000000000001";
const relatedId = "24500000-0000-4000-8000-000000000002";
const article = (id: string, name: string) => ({
  id,
  slug: name.toLowerCase().replaceAll(" ", "-"),
  type: "PERSON",
  subtype: null,
  name,
  aliases: [],
  summary: `${name} summary`,
  publicText: `${name} text`,
  tags: [],
  coverAssetId: null,
});
const subject = article(subjectId, "Known Subject");
const related = article(relatedId, "Visible Friend");

beforeEach(() => {
  apiMock.mockReset();
  apiMock.mockImplementation((path: string) => {
    if (path === "/api/world-content" || path.startsWith("/api/world-content?"))
      return Promise.resolve(
        path.includes(`relatedTo=${subjectId}`)
          ? [related]
          : [subject, related],
      );
    if (path === `/api/world-content/${subjectId}/relations`)
      return Promise.resolve([
        {
          id: "edge",
          relationType: "ALLY",
          note: null,
          direction: "OUTGOING",
          entity: {
            id: relatedId,
            slug: related.slug,
            type: "PERSON",
            name: related.name,
          },
        },
      ]);
    if (path.endsWith("/relations") || path.endsWith("/media"))
      return Promise.resolve([]);
    if (path === `/api/world-content/${subjectId}`)
      return Promise.resolve(subject);
    if (path === `/api/world-content/${relatedId}`)
      return Promise.resolve(related);
    return Promise.resolve([]);
  });
});
afterEach(() => vi.restoreAllMocks());

describe("WorldEncyclopediaWorkspace known-relation filter", () => {
  it("filters from a visible article, follows an existing result, and resets without losing search text", async () => {
    renderComponent(<WorldEncyclopediaWorkspace open onClose={vi.fn()} />);
    fireEvent.click(
      await screen.findByRole("button", { name: /Known Subject/ }),
    );
    fireEvent.click(
      await screen.findByRole("button", { name: "Показать связанные статьи" }),
    );
    await screen.findByText("Known Subject", { selector: "strong" });
    expect(apiMock).toHaveBeenCalledWith(
      `/api/world-content?relatedTo=${subjectId}`,
    );

    await waitFor(() =>
      expect(
        document.querySelector(".world-encyclopedia-workspace__row"),
      ).toBeTruthy(),
    );
    fireEvent.click(
      document.querySelector(".world-encyclopedia-workspace__row")!,
    );
    expect(
      await screen.findByRole("heading", { name: "Visible Friend" }),
    ).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Поиск"), {
      target: { value: "Visible" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Сбросить связь" }));
    await waitFor(() =>
      expect(apiMock).toHaveBeenCalledWith("/api/world-content?q=Visible"),
    );
    expect(screen.getByLabelText("Поиск")).toHaveValue("Visible");
    expect(
      screen.queryByText("Known Subject", { selector: "strong" }),
    ).not.toBeInTheDocument();
  });

  it("does not let an obsolete list response replace the newest query", async () => {
    let releaseObsolete!: (items: unknown[]) => void;
    apiMock.mockImplementation((path: string) => {
      if (path === "/api/world-content")
        return Promise.resolve([subject, related]);
      if (path === "/api/world-content?q=older")
        return new Promise((resolve) => {
          releaseObsolete = resolve;
        });
      if (path === "/api/world-content?q=newer")
        return Promise.resolve([related]);
      if (path.endsWith("/relations") || path.endsWith("/media"))
        return Promise.resolve([]);
      if (path.includes("/api/world-content/")) return Promise.resolve(subject);
      return Promise.resolve([]);
    });
    renderComponent(<WorldEncyclopediaWorkspace open onClose={vi.fn()} />);
    await screen.findByRole("button", { name: /Known Subject/ });
    const search = screen.getByLabelText("Поиск");
    fireEvent.change(search, { target: { value: "older" } });
    fireEvent.keyDown(search, { key: "Enter" });
    await waitFor(() =>
      expect(apiMock).toHaveBeenCalledWith("/api/world-content?q=older"),
    );
    fireEvent.change(search, { target: { value: "newer" } });
    fireEvent.keyDown(search, { key: "Enter" });
    await waitFor(() =>
      expect(
        document.querySelector(".world-encyclopedia-workspace__row"),
      ).toBeTruthy(),
    );
    releaseObsolete([subject]);
    await waitFor(() =>
      expect(
        screen.queryByRole("button", { name: /Known Subject/ }),
      ).not.toBeInTheDocument(),
    );
  });
});

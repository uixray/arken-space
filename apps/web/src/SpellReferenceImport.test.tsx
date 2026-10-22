// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderComponent, screen, userEvent } from "./test-support/render";

const client = vi.hoisted(() => ({
  previewSpellReferenceImport: vi.fn(),
  createSpellPackDraft: vi.fn(),
}));
vi.mock("./spell-schools-client", () => client);

import {
  ARKEN_REFERENCE_PACK_TITLE,
  SpellReferenceImport,
} from "./SpellReferenceImport";

/** UIX-458 AC4: the 13 reference schools load in one GM action, once. */
const graph = {
  packId: "00000000-0000-4000-8000-000000000001",
  versionId: "00000000-0000-4000-8000-000000000002",
  title: ARKEN_REFERENCE_PACK_TITLE,
  schools: new Array(13).fill({}),
  nodes: new Array(145).fill({}),
  edges: new Array(114).fill({}),
  importWarnings: new Array(31).fill({}),
};

beforeEach(() => {
  client.previewSpellReferenceImport.mockReset();
  client.createSpellPackDraft.mockReset();
});

describe("SpellReferenceImport", () => {
  it("previews the bundled reference and saves exactly the previewed graph", async () => {
    const user = userEvent.setup();
    client.previewSpellReferenceImport.mockResolvedValue({
      graph,
      validation: { valid: true, errors: [], warnings: [] },
    });
    client.createSpellPackDraft.mockResolvedValue({
      packId: graph.packId,
      versionId: graph.versionId,
    });
    const onImported = vi.fn().mockResolvedValue(undefined);
    renderComponent(
      <SpellReferenceImport
        packs={[]}
        disabled={false}
        onImported={onImported}
      />,
    );
    await user.click(
      screen.getByRole("button", { name: "Посмотреть справочник" }),
    );
    expect(
      await screen.findByText("Школ: 13, узлов: 145, связей: 114."),
    ).toBeInTheDocument();
    expect(screen.getByText(/Требуют уточнения: 31/)).toBeInTheDocument();
    const command = client.previewSpellReferenceImport.mock.calls[0]![0];
    expect(command.version).toBe(1);
    expect(command.source.школы).toHaveLength(13);

    await user.click(
      screen.getByRole("button", { name: "Загрузить справочник" }),
    );
    expect(client.createSpellPackDraft).toHaveBeenCalledWith(
      graph,
      expect.any(String),
    );
    expect(onImported).toHaveBeenCalledWith(graph.packId, graph.versionId);
  });

  it("is hidden once the reference pack exists", () => {
    renderComponent(
      <SpellReferenceImport
        packs={[
          {
            id: graph.packId,
            latestVersionId: graph.versionId,
            latestVersion: 1,
            lifecycle: "REFERENCE",
            title: ARKEN_REFERENCE_PACK_TITLE,
            createdAt: "2026-10-22T10:00:00.000Z",
          },
        ]}
        disabled={false}
        onImported={vi.fn()}
      />,
    );
    expect(
      screen.queryByRole("button", { name: "Посмотреть справочник" }),
    ).toBeNull();
  });

  it("refuses to save a graph that failed validation", async () => {
    const user = userEvent.setup();
    client.previewSpellReferenceImport.mockResolvedValue({
      graph,
      validation: { valid: false, errors: [{}], warnings: [] },
    });
    renderComponent(
      <SpellReferenceImport packs={[]} disabled={false} onImported={vi.fn()} />,
    );
    await user.click(
      screen.getByRole("button", { name: "Посмотреть справочник" }),
    );
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "не прошёл проверку",
    );
    expect(
      screen.getByRole("button", { name: "Загрузить справочник" }),
    ).toBeDisabled();
  });
});

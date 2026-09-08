// @vitest-environment jsdom
import type { ComponentProps } from "react";
import type {
  WorldMapLocationKind,
  WorldMapsSnapshotDto,
} from "@arken/contracts";
import { describe, expect, it, vi } from "vitest";
import {
  renderComponent,
  screen,
  userEvent,
  waitFor,
  within,
} from "./test-support/render";
import { buildGameSnapshot } from "./test-support/game-snapshot-fixtures";
import type { ArkenDialogProps } from "./ui/ArkenDialog";

// Retain actual workspace/form content; modal positioning/focus is a separate gate.
vi.mock("./ui/ArkenDialog", () => ({
  ArkenDialog: ({
    open,
    title,
    children,
    footer = true,
    applyLabel = "Сохранить",
    cancelLabel = "Отмена",
    onApply,
    onClose,
    loading,
    error,
  }: ArkenDialogProps) =>
    open ? (
      <section role="dialog" aria-label={title}>
        {children}
        {error && <p role="alert">{error}</p>}
        {footer && (
          <>
            <button type="button" onClick={onClose}>
              {cancelLabel}
            </button>
            <button type="button" disabled={loading} onClick={onApply}>
              {applyLabel}
            </button>
          </>
        )}
      </section>
    ) : null,
}));
const { WorldMapsWorkspace } = await import("./WorldMapsWorkspace");

const kinds: Array<[WorldMapLocationKind, string]> = [
  ["SETTLEMENT", "Поселение"],
  ["LANDMARK", "Ориентир"],
  ["REGION", "Регион"],
  ["OTHER", "Другое"],
];
function maps(lifecycle: "DRAFT" | "PUBLISHED"): WorldMapsSnapshotDto {
  return {
    maps: [
      {
        id: "map",
        name: "Sword Coast",
        scope: "WORLD",
        visibility: "CAMPAIGN",
        lifecycle,
        backgroundAssetId: lifecycle === "PUBLISHED" ? "map-background" : null,
        revision: 2,
      },
    ],
    locations: kinds.map(([kind], index) => ({
      id: `place-${index}`,
      mapId: "map",
      name: `Neverwinter ${index}`,
      kind,
      summary: "",
      visibility: "PUBLIC",
      x: index / 10,
      y: 0.3,
      revision: 1,
      sceneIds: [],
    })),
    partyPosition: null,
  };
}
function setup(role: "GM" | "PLAYER", lifecycle: "DRAFT" | "PUBLISHED") {
  const onCreateLocation = vi.fn().mockResolvedValue(undefined);
  const props: ComponentProps<typeof WorldMapsWorkspace> = {
    open: true,
    snapshot: buildGameSnapshot(role, {
      worldMaps: maps(lifecycle),
      assets:
        lifecycle === "PUBLISHED"
          ? [
              {
                id: "map-background",
                kind: "MAP",
                name: "Sword Coast.webp",
                mimeType: "image/webp",
                sizeBytes: 100,
                width: 1024,
                height: 768,
                durationSeconds: null,
                url: "/map.webp",
                createdAt: "2026-09-08T00:00:00.000Z",
              },
            ]
          : [],
    }),
    onClose: vi.fn(),
    onOpenScene: vi.fn(),
    onCreateMap: vi.fn().mockResolvedValue(undefined),
    onSetDraftBackground: vi.fn().mockResolvedValue(undefined),
    onApproveBackground: vi.fn().mockResolvedValue(undefined),
    onPublishMap: vi.fn().mockResolvedValue(undefined),
    onArchiveMap: vi.fn().mockResolvedValue(undefined),
    onCreateLocation,
    onUpdateLocation: vi.fn().mockResolvedValue(undefined),
    onLinkLocationScene: vi.fn().mockResolvedValue(undefined),
    onUnlinkLocationScene: vi.fn().mockResolvedValue(undefined),
    onSetPartyPosition: vi.fn().mockResolvedValue(undefined),
    onClearPartyPosition: vi.fn().mockResolvedValue(undefined),
  };
  renderComponent(<WorldMapsWorkspace {...props} />);
  return { onCreateLocation };
}

describe("world map localized display copy", () => {
  it.each(["GM", "PLAYER"] as const)(
    "shows all four kinds in the real %s list and selected card without translating names",
    async (role) => {
      setup(role, "PUBLISHED");
      const list = screen.getByRole("list", { name: "Список локаций" });
      for (const [index, [, label]] of kinds.entries()) {
        const row = within(list).getAllByRole("listitem")[index]!;
        expect(within(row).getByText(`Neverwinter ${index}`)).toBeVisible();
        expect(row).toHaveTextContent(label);
        await userEvent.click(row);
        const card = screen.getByRole("article", {
          name: `Neverwinter ${index}`,
        });
        expect(card).toHaveTextContent(label);
        expect(
          within(card).getByRole("heading", { name: `Neverwinter ${index}` }),
        ).toBeVisible();
      }
      if (role === "PLAYER")
        expect(
          screen.queryByRole("button", { name: "Добавить локацию" }),
        ).not.toBeInTheDocument();
    },
  );

  it("uses Russian draft help and sends the original kind after selecting its translated option", async () => {
    const { onCreateLocation } = setup("GM", "DRAFT");
    expect(
      screen.getByText("Сначала загрузите карту в разделе «Файлы»."),
    ).toBeVisible();
    expect(
      screen.getByText(
        "Выберите файл карты и подтвердите фон перед публикацией.",
      ),
    ).toBeVisible();
    await userEvent.click(
      screen.getByRole("button", { name: "Добавить локацию" }),
    );
    const dialog = screen.getByRole("dialog", { name: "Новая локация" });
    for (const [kind, label] of kinds)
      expect(within(dialog).getByRole("option", { name: label })).toHaveValue(
        kind,
      );
    await userEvent.type(
      within(dialog).getByLabelText("Название"),
      "Waterdeep",
    );
    await userEvent.selectOptions(
      within(dialog).getByLabelText("Тип"),
      "LANDMARK",
    );
    await userEvent.click(
      within(dialog).getByRole("button", { name: "Сохранить" }),
    );
    await waitFor(() =>
      expect(onCreateLocation).toHaveBeenCalledExactlyOnceWith({
        mapId: "map",
        name: "Waterdeep",
        kind: "LANDMARK",
        summary: "",
        gmNotes: "",
        visibility: "GM_ONLY",
        x: 0.5,
        y: 0.5,
      }),
    );
  });
});

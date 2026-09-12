// @vitest-environment jsdom
import type {
  InputHTMLAttributes,
  SelectHTMLAttributes,
  TextareaHTMLAttributes,
} from "react";
import type { ButtonButtonProps } from "@gravity-ui/uikit";
import {
  worldContentPlayerDtoSchema,
  type WorldContentDto,
} from "@arken/contracts";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  renderComponent,
  screen,
  userEvent,
  waitFor,
  within,
} from "./test-support/render";
import type { ArkenDialogProps } from "./ui/ArkenDialog";

const { apiMock } = vi.hoisted(() => ({ apiMock: vi.fn() }));
vi.mock("./api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./api")>()),
  api: apiMock,
}));
// Only toolkit chrome and unrelated asset selection are replaced. The actual
// editor, reader, client query/payload builders and copy are exercised below.
vi.mock("@gravity-ui/uikit", () => ({
  Button: ({ children, onClick, disabled, loading }: ButtonButtonProps) => (
    <button type="button" onClick={onClick} disabled={disabled || loading}>
      {children}
    </button>
  ),
}));
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
vi.mock("./ui/GravityFormControls", () => ({
  FormInput: ({
    value,
    onChange,
    onKeyDown,
    disabled,
    placeholder,
  }: InputHTMLAttributes<HTMLInputElement>) => (
    <input
      value={value}
      onChange={onChange}
      onKeyDown={onKeyDown}
      disabled={disabled}
      placeholder={placeholder}
    />
  ),
  FormSelect: ({
    value,
    onChange,
    disabled,
    children,
  }: SelectHTMLAttributes<HTMLSelectElement>) => (
    <select value={value} onChange={onChange} disabled={disabled}>
      {children}
    </select>
  ),
  FormTextArea: ({
    value,
    onChange,
    disabled,
    rows,
  }: TextareaHTMLAttributes<HTMLTextAreaElement>) => (
    <textarea
      value={value}
      onChange={onChange}
      disabled={disabled}
      rows={rows}
    />
  ),
}));
vi.mock("./ui/AssetPicker", () => ({ AssetPicker: () => <div /> }));
const { WorldContentWorkspace } = await import("./WorldContentWorkspace");
const { WorldEncyclopediaWorkspace } =
  await import("./WorldEncyclopediaWorkspace");

const entity: WorldContentDto = {
  id: "22222222-2222-4222-8222-222222222222",
  slug: "waterdeep",
  type: "LOCATION",
  subtype: null,
  name: "Waterdeep",
  aliases: ["City of Splendors"],
  summary: "A city on the Sword Coast.",
  publicText: "The Yawning Portal",
  gmOnlyText: "Private GM note",
  tags: ["SwordCoast"],
  lifecycle: "DRAFT",
  coverAssetId: null,
  provenance: {
    sourceUrl: null,
    sourceExternalId: null,
    retrievedAt: null,
    rawContentHash: null,
    attribution: null,
    rightsReviewStatus: null,
    editorialApprovalStatus: null,
  },
  revision: 7,
  createdAt: "2026-09-08T00:00:00.000Z",
  updatedAt: "2026-09-08T00:00:00.000Z",
};
beforeEach(() => {
  apiMock.mockReset();
  apiMock.mockImplementation(async (path: string, init?: RequestInit) => {
    if (init?.method === "POST") return entity;
    if (path === `/api/world-content/${entity.id}`) return entity;
    return [];
  });
});

describe("world editor and reader Russian copy", () => {
  it("renders localized identifier/validation/draft/version copy while keeping Latin names and the API slug", async () => {
    renderComponent(
      <WorldContentWorkspace open assets={[]} onClose={vi.fn()} />,
    );
    expect(await screen.findByText("Ничего не найдено.")).toBeVisible();
    expect(screen.getByPlaceholderText("фракция, порт")).toBeVisible();
    await userEvent.click(
      screen.getByRole("button", { name: "Создать сущность" }),
    );
    const form = screen.getByRole("dialog", {
      name: "Новая сущность энциклопедии",
    });
    expect(within(form).getByText("Создаётся как черновик.")).toBeVisible();
    await userEvent.type(within(form).getByLabelText("Название"), "Waterdeep");
    const slug = within(form).getByLabelText("Идентификатор");
    expect(slug).toHaveValue("waterdeep");
    await userEvent.clear(slug);
    await userEvent.type(slug, "Bad_ID");
    await userEvent.click(
      within(form).getByRole("button", { name: "Создать" }),
    );
    expect(await within(form).findByRole("alert")).toHaveTextContent(
      "Идентификатор должен содержать строчные латинские буквы, цифры и дефисы между словами.",
    );
    expect(
      apiMock.mock.calls.filter(
        ([, init]) => (init as RequestInit | undefined)?.method === "POST",
      ),
    ).toHaveLength(0);
    await userEvent.clear(slug);
    await userEvent.type(slug, "waterdeep");
    await userEvent.click(
      within(form).getByRole("button", { name: "Создать" }),
    );
    expect(await screen.findByText("Версия 7")).toBeVisible();
    expect(screen.getByRole("heading", { name: "Waterdeep" })).toBeVisible();
    const creation = apiMock.mock.calls.find(
      ([, init]) => (init as RequestInit | undefined)?.method === "POST",
    )!;
    expect(creation[0]).toBe("/api/world-content");
    expect(JSON.parse(String((creation[1] as RequestInit).body))).toMatchObject(
      { name: "Waterdeep", slug: "waterdeep", type: "LOCATION" },
    );
    expect(screen.getByDisplayValue("City of Splendors")).toBeVisible();
  });

  it("renders the reader's Russian tag hint without translating supplied names, tags or public text", async () => {
    const playerEntity = worldContentPlayerDtoSchema.parse(entity);
    apiMock.mockImplementation(async (path: string) => {
      if (path.endsWith("/relations") || path.endsWith("/media")) return [];
      return path === `/api/world-content/${entity.id}`
        ? playerEntity
        : [playerEntity];
    });
    renderComponent(<WorldEncyclopediaWorkspace open onClose={vi.fn()} />);
    expect(screen.getByPlaceholderText("фракция, порт")).toBeVisible();
    await userEvent.click(
      await screen.findByRole("button", { name: /Waterdeep/ }),
    );
    await waitFor(() =>
      expect(screen.getByRole("heading", { name: "Waterdeep" })).toBeVisible(),
    );
    const article = screen.getByRole("article");
    expect(within(article).getByText("The Yawning Portal")).toBeVisible();
    expect(within(article).getByText("SwordCoast")).toBeVisible();
    expect(screen.queryByText("Private GM note")).not.toBeInTheDocument();
    expect(apiMock).toHaveBeenCalledWith(`/api/world-content/${entity.id}`);
  });
});

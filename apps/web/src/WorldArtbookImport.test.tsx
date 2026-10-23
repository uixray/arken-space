// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import type {
  AssetDto,
  WorldContentDto,
  WorldContentMediaDto,
} from "@arken/contracts";
import {
  renderComponent,
  screen,
  userEvent,
  within,
} from "./test-support/render";
import { artbookImageFixtureBytes } from "./artbook-image-test-fixtures";

const client = vi.hoisted(() => ({
  fetchWorldContentList: vi.fn(),
  createWorldContentWithActionId: vi.fn(),
  fetchWorldContentDetail: vi.fn(),
  fetchWorldContentMedia: vi.fn(),
  updateWorldContent: vi.fn(),
  addWorldContentMedia: vi.fn(),
}));
const http = vi.hoisted(() => ({ api: vi.fn() }));
const artbookLoader = vi.hoisted(() => ({
  load: vi.fn(),
  original: null as null | (() => Promise<unknown>),
}));
vi.mock("./world-content-client", () => client);
vi.mock("./api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./api")>();
  return { ...actual, api: http.api };
});
vi.mock("./world-artbook", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./world-artbook")>();
  artbookLoader.original = actual.loadArtbook;
  return { ...actual, loadArtbook: artbookLoader.load };
});

import { WorldArtbookImport } from "./WorldArtbookImport";
import {
  artbookActionId,
  artbookFileSha256,
  artbookProvenance,
  artbookRelativePath,
  loadArtbook,
} from "./world-artbook";

const campaignId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
let rows: WorldContentDto[];
let mediaRows: WorldContentMediaDto[];
let uploadedByAction: Map<string, AssetDto>;
let uploadActionIds: string[];
let lookupActionIds: string[];
let multipartUploads: Array<{
  actionId: string;
  name: string;
  type: string;
  bytes: number[];
}>;
let nextAsset = 1;
let loseNextUploadResponse = false;

function artbookImageFile(path: string, variant = 0, type = "image/png") {
  const file = new File(
    [artbookImageFixtureBytes.png(variant)],
    path.split("/").pop()!,
    { type },
  );
  Object.defineProperty(file, "webkitRelativePath", {
    value: `Артбук/${path}`,
    configurable: true,
  });
  return file;
}

function dto(
  input: Pick<
    WorldContentDto,
    "slug" | "type" | "name" | "summary" | "provenance"
  >,
  id = crypto.randomUUID(),
): WorldContentDto {
  return {
    id,
    slug: input.slug,
    type: input.type,
    subtype: null,
    name: input.name,
    aliases: [],
    summary: input.summary,
    publicText: "",
    gmOnlyText: "",
    tags: [],
    lifecycle: "DRAFT",
    coverAssetId: null,
    provenance: input.provenance ?? null,
    revision: 0,
    createdAt: new Date(0).toISOString(),
    updatedAt: new Date(0).toISOString(),
  };
}

beforeEach(() => {
  artbookLoader.load.mockReset();
  artbookLoader.load.mockImplementation(() => {
    const original = artbookLoader.original;
    if (!original) throw new Error("Artbook loader was not initialized.");
    return original();
  });
  for (const fn of Object.values(client)) fn.mockReset();
  http.api.mockReset();
  rows = [];
  mediaRows = [];
  uploadedByAction = new Map();
  uploadActionIds = [];
  lookupActionIds = [];
  multipartUploads = [];
  nextAsset = 1;
  loseNextUploadResponse = false;
  client.fetchWorldContentList.mockImplementation(async () => rows);
  client.fetchWorldContentDetail.mockImplementation(async (id: string) =>
    rows.find((row) => row.id === id),
  );
  client.fetchWorldContentMedia.mockImplementation(async () => mediaRows);
  client.createWorldContentWithActionId.mockImplementation(async (input) => {
    const entity = dto(input);
    rows.push(entity);
    return entity;
  });
  client.updateWorldContent.mockImplementation(async (id: string, input) => {
    const entity = rows.find((row) => row.id === id)!;
    Object.assign(entity, input, { revision: entity.revision + 1 });
    return entity;
  });
  client.addWorldContentMedia.mockImplementation(async (id: string, input) => {
    const result = {
      id: crypto.randomUUID(),
      worldContentId: id,
      assetId: input.assetId,
      caption: input.caption ?? null,
      ordering: mediaRows.length,
      createdAt: new Date(0).toISOString(),
    } as WorldContentMediaDto;
    mediaRows.push(result);
    return result;
  });
  http.api.mockImplementation(
    async (
      url: string,
      options?: {
        headers?: { "x-action-id"?: string };
        body?: BodyInit;
      },
    ) => {
      if (url.startsWith("/api/assets/upload-actions/")) {
        const actionId = decodeURIComponent(url.split("/").pop()!);
        lookupActionIds.push(actionId);
        const existing = uploadedByAction.get(actionId);
        if (existing) return existing;
        throw Object.assign(new Error("not found"), { status: 404 });
      }
      const actionId = options!.headers!["x-action-id"]!;
      uploadActionIds.push(actionId);
      if (options?.body instanceof FormData) {
        const uploadedFile = options.body.get("file");
        if (uploadedFile instanceof File) {
          multipartUploads.push({
            actionId,
            name: uploadedFile.name,
            type: uploadedFile.type,
            bytes: [...new Uint8Array(await uploadedFile.arrayBuffer())],
          });
        }
      }
      let asset = uploadedByAction.get(actionId);
      if (!asset) {
        asset = {
          id: `bbbbbbbb-bbbb-4bbb-8bbb-${String(nextAsset++).padStart(12, "0")}`,
          kind: "IMAGE",
          name: "Artbook image",
          mimeType: "image/png",
          sizeBytes: multipartUploads.at(-1)?.bytes.length ?? 68,
          width: 1,
          height: 1,
          durationSeconds: null,
          url: "/api/assets/test-image",
          createdAt: new Date(0).toISOString(),
        };
        uploadedByAction.set(actionId, asset);
      }
      if (loseNextUploadResponse) {
        loseNextUploadResponse = false;
        throw new Error("upload response lost after commit");
      }
      return asset;
    },
  );
});

describe("WorldArtbookImport", () => {
  it("snapshots selected files before lazy loading and permits reselecting the same folder", async () => {
    const user = userEvent.setup({ applyAccept: false });
    let resolveLazyLoad!: (
      value: Awaited<ReturnType<typeof loadArtbook>>,
    ) => void;
    const lazySource = new Promise<Awaited<ReturnType<typeof loadArtbook>>>(
      (resolve) => {
        resolveLazyLoad = resolve;
      },
    );
    artbookLoader.load.mockImplementationOnce(() => lazySource);
    renderComponent(
      <WorldArtbookImport campaignId={campaignId} onChanged={vi.fn()} />,
    );
    const input = screen.getByLabelText(
      "3. Предложить сопоставления файлов (папка «Артбук»)",
    ) as HTMLInputElement;
    const selectedFiles = [
      "Локации/Амбер с моря.png",
      "Локации/Дворец императора в Амбере.png",
    ].map((path, index) => {
      return artbookImageFile(path, index + 1, "");
    });

    await user.upload(input, selectedFiles);
    expect(input.value).toBe("");
    expect(artbookLoader.load).toHaveBeenCalledTimes(1);
    resolveLazyLoad(await loadArtbook());
    artbookLoader.load.mockClear();
    expect(await screen.findByText(/Предложено 2 из 86/)).toBeInTheDocument();
    expect(screen.getAllByText(/binary SHA-256/)).toHaveLength(2);
    expect(uploadActionIds).toEqual([]);
    expect(client.addWorldContentMedia).not.toHaveBeenCalled();

    await user.upload(input, selectedFiles);
    expect(input.value).toBe("");
    expect(await screen.findByText(/Предложено 2 из 86/)).toBeInTheDocument();
    expect(artbookLoader.load).not.toHaveBeenCalled();
    expect(uploadActionIds).toEqual([]);
    expect(client.addWorldContentMedia).not.toHaveBeenCalled();
  });

  it("normalizes blank MIME only in multipart while preserving original bytes, hash and action IDs across replay", async () => {
    const user = userEvent.setup({ applyAccept: false });
    const source = await loadArtbook();
    const record = source.записи.find((item) => item.slug === "artbook-amber")!;
    rows.push(
      dto({
        slug: record.slug,
        type: record.type,
        name: record.name,
        summary: record.summary,
        provenance: artbookProvenance(source, record),
      }),
    );
    renderComponent(
      <WorldArtbookImport campaignId={campaignId} onChanged={vi.fn()} />,
    );
    const input = screen.getByLabelText(
      "3. Предложить сопоставления файлов (папка «Артбук»)",
    );
    const paths = [record.cover!, ...record.gallery];
    const originalFiles = paths.map((path, index) =>
      artbookImageFile(path, index + 31, ""),
    );

    await user.upload(input, originalFiles);
    expect(await screen.findByText(/Предложено 2 из/)).toBeInTheDocument();
    expect(screen.getAllByText(/binary SHA-256/)).toHaveLength(2);
    expect(uploadActionIds).toEqual([]);
    expect(lookupActionIds).toEqual([]);
    expect(multipartUploads).toEqual([]);
    expect(client.createWorldContentWithActionId).not.toHaveBeenCalled();
    expect(client.updateWorldContent).not.toHaveBeenCalled();
    expect(client.addWorldContentMedia).not.toHaveBeenCalled();

    const expectedActionIds = await Promise.all(
      originalFiles.map(async (file, index) =>
        artbookActionId({
          campaignId,
          sourceUrl: record.sourceUrl,
          sourceId: record.slug,
          relativePath: paths[index]!,
          binarySha256: await artbookFileSha256(file),
          operation: "upload",
        }),
      ),
    );
    await user.click(
      screen.getByLabelText(/Я проверил каждое показанное сопоставление/),
    );
    await user.click(
      screen.getByRole("button", {
        name: "4. Подтвердить сопоставления и загрузку",
      }),
    );
    await screen.findByRole("heading", {
      name: "Отчёт (без публикации и автоудаления)",
    });
    expect(uploadActionIds).toEqual(expectedActionIds);
    expect(lookupActionIds.slice(0, paths.length)).toEqual(expectedActionIds);
    expect(multipartUploads).toHaveLength(originalFiles.length);
    for (const [index, original] of originalFiles.entries()) {
      expect(multipartUploads[index]).toMatchObject({
        actionId: expectedActionIds[index],
        name: original.name,
        type: "image/png",
        bytes: [...new Uint8Array(await original.arrayBuffer())],
      });
    }
    expect(client.updateWorldContent).toHaveBeenCalledTimes(1);
    expect(client.addWorldContentMedia).toHaveBeenCalledTimes(1);
    const uploadsBeforeReplay = [...uploadActionIds];
    const multipartBeforeReplay = [...multipartUploads];

    await user.upload(input, originalFiles);
    expect(await screen.findByText(/Предложено 2 из/)).toBeInTheDocument();
    await user.click(
      screen.getByLabelText(/Я проверил каждое показанное сопоставление/),
    );
    await user.click(
      screen.getByRole("button", {
        name: "4. Подтвердить сопоставления и загрузку",
      }),
    );
    await screen.findByRole("heading", {
      name: "Отчёт (без публикации и автоудаления)",
    });
    expect(uploadActionIds).toEqual(uploadsBeforeReplay);
    expect(multipartUploads).toEqual(multipartBeforeReplay);
    expect(lookupActionIds.slice(paths.length)).toEqual(expectedActionIds);
    expect(client.updateWorldContent).toHaveBeenCalledTimes(1);
    expect(client.addWorldContentMedia).toHaveBeenCalledTimes(1);
    expect(mediaRows).toHaveLength(1);
  });

  it("previews without writes, confirms DRAFT-only creation, then recognizes the same records on rerun", async () => {
    const user = userEvent.setup();
    const onChanged = vi.fn();
    renderComponent(
      <WorldArtbookImport campaignId={campaignId} onChanged={onChanged} />,
    );
    await user.click(
      screen.getByRole("button", {
        name: "1. Предварительный просмотр текста",
      }),
    );
    expect(
      await screen.findByText(/Создать: 78; уже совпадает: 0/),
    ).toBeInTheDocument();
    expect(client.createWorldContentWithActionId).not.toHaveBeenCalled();
    await user.click(
      screen.getByLabelText(
        /Я проверил preview и подтверждаю создание только отсутствующих записей/,
      ),
    );
    await user.click(
      screen.getByRole("button", { name: "2. Подтвердить создание DRAFT" }),
    );
    await screen.findByRole("heading", {
      name: "Отчёт (без публикации и автоудаления)",
    });
    expect(client.createWorldContentWithActionId).toHaveBeenCalledTimes(78);
    expect(
      rows.every(
        (row) =>
          row.lifecycle === "DRAFT" &&
          row.provenance?.editorialApprovalStatus === "PENDING",
      ),
    ).toBe(true);
    expect(client.createWorldContentWithActionId.mock.calls[0]?.[1]).toMatch(
      /^[0-9a-f-]{36}$/,
    );
    await user.click(
      screen.getByRole("button", {
        name: "1. Предварительный просмотр текста",
      }),
    );
    expect(
      await screen.findByText(/Создать: 0; уже совпадает: 78/),
    ).toBeInTheDocument();
    expect(client.createWorldContentWithActionId).toHaveBeenCalledTimes(78);
    expect(onChanged).toHaveBeenCalled();
  });

  it("cancels all writes if source/canon classification changed after preview", async () => {
    const user = userEvent.setup();
    renderComponent(
      <WorldArtbookImport campaignId={campaignId} onChanged={vi.fn()} />,
    );
    await user.click(
      screen.getByRole("button", {
        name: "1. Предварительный просмотр текста",
      }),
    );
    expect(await screen.findByText(/Создать: 78/)).toBeInTheDocument();
    const source = await loadArtbook();
    const first = source.записи[0]!;
    rows.push(
      dto({
        slug: first.slug,
        type: first.type,
        name: first.name,
        summary: first.summary,
        provenance: artbookProvenance(source, first),
      }),
    );
    await user.click(screen.getByLabelText(/Я проверил preview/));
    await user.click(
      screen.getByRole("button", { name: "2. Подтвердить создание DRAFT" }),
    );
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Канон изменился после preview",
    );
    expect(client.createWorldContentWithActionId).not.toHaveBeenCalled();
  });

  it("reconciles an ambiguous text-create response from persisted exact DRAFT provenance", async () => {
    const user = userEvent.setup();
    const source = await loadArtbook();
    for (const record of source.записи.filter(
      (item) => item.slug !== "artbook-amber",
    ))
      rows.push(
        dto({
          slug: record.slug,
          type: record.type,
          name: record.name,
          summary: record.summary,
          provenance: artbookProvenance(source, record),
        }),
      );
    client.createWorldContentWithActionId.mockImplementationOnce(
      async (input, _actionId) => {
        rows.push(dto(input));
        throw new Error("create response lost after commit");
      },
    );
    renderComponent(
      <WorldArtbookImport campaignId={campaignId} onChanged={vi.fn()} />,
    );
    await user.click(
      screen.getByRole("button", {
        name: "1. Предварительный просмотр текста",
      }),
    );
    expect(
      await screen.findByText(/Создать: 1; уже совпадает: 77/),
    ).toBeInTheDocument();
    await user.click(screen.getByLabelText(/Я проверил preview/));
    await user.click(
      screen.getByRole("button", { name: "2. Подтвердить создание DRAFT" }),
    );
    expect(
      await screen.findByText(/artbook-amber: matched, этап create\/reconcile/),
    ).toBeInTheDocument();
    expect(rows).toHaveLength(78);
    expect(client.createWorldContentWithActionId).toHaveBeenCalledTimes(1);
  });

  it("reconciles the real duplicate-action DTO only from one exact canonical source target", async () => {
    const user = userEvent.setup();
    const source = await loadArtbook();
    for (const record of source.записи.filter(
      (item) => item.slug !== "artbook-amber",
    ))
      rows.push(
        dto({
          slug: record.slug,
          type: record.type,
          name: record.name,
          summary: record.summary,
          provenance: artbookProvenance(source, record),
        }),
      );
    client.createWorldContentWithActionId.mockImplementationOnce(
      async (input) => {
        rows.push(dto(input));
        return { duplicate: true } as unknown as WorldContentDto;
      },
    );
    renderComponent(
      <WorldArtbookImport campaignId={campaignId} onChanged={vi.fn()} />,
    );
    await user.click(
      screen.getByRole("button", {
        name: "1. Предварительный просмотр текста",
      }),
    );
    expect(
      await screen.findByText(/Создать: 1; уже совпадает: 77/),
    ).toBeInTheDocument();
    await user.click(screen.getByLabelText(/Я проверил preview/));
    await user.click(
      screen.getByRole("button", { name: "2. Подтвердить создание DRAFT" }),
    );
    expect(
      await screen.findByText(/artbook-amber: matched, этап create\/reconcile/),
    ).toBeInTheDocument();
    expect(rows).toHaveLength(78);
    expect(client.createWorldContentWithActionId).toHaveBeenCalledTimes(1);
  });

  it("recovers lost cover/gallery responses by stable identity and reconciles each media item independently", async () => {
    const user = userEvent.setup();
    const source = await loadArtbook();
    const record = source.записи.find((item) => item.slug === "artbook-amber")!;
    const existing = dto({
      slug: record.slug,
      type: record.type,
      name: record.name,
      summary: record.summary,
      provenance: artbookProvenance(source, record),
    });
    rows.push(existing);
    let loseCoverResponse = true;
    let loseGalleryResponse = true;
    loseNextUploadResponse = true;
    client.updateWorldContent.mockImplementation(async (id: string, input) => {
      Object.assign(existing, input, { revision: existing.revision + 1 });
      if (loseCoverResponse) {
        loseCoverResponse = false;
        throw new Error("response lost after commit");
      }
      return existing;
    });
    client.addWorldContentMedia.mockImplementation(
      async (id: string, input) => {
        const result = {
          id: crypto.randomUUID(),
          worldContentId: id,
          assetId: input.assetId,
          caption: null,
          ordering: mediaRows.length,
          createdAt: new Date(0).toISOString(),
        } as WorldContentMediaDto;
        mediaRows.push(result);
        if (loseGalleryResponse) {
          loseGalleryResponse = false;
          throw new Error("response lost after commit");
        }
        return result;
      },
    );
    renderComponent(
      <WorldArtbookImport campaignId={campaignId} onChanged={vi.fn()} />,
    );
    const input = screen.getByLabelText(
      "3. Предложить сопоставления файлов (папка «Артбук»)",
    );
    const cover = artbookImageFile("Локации/Амбер с моря.png");
    Object.defineProperty(cover, "webkitRelativePath", {
      value: `Артбук/${record.cover}`,
    });
    const gallery = artbookImageFile("Дворец императора в Амбере.png", 1);
    Object.defineProperty(gallery, "webkitRelativePath", {
      value: `Артбук/${record.gallery[0]}`,
    });
    await user.upload(input, [cover, gallery]);
    expect(await screen.findByText(/Предложено 2 из/)).toBeInTheDocument();
    await user.click(
      screen.getByLabelText(/Я проверил каждое показанное сопоставление/),
    );
    await user.click(
      screen.getByRole("button", {
        name: "4. Подтвердить сопоставления и загрузку",
      }),
    );
    expect(
      await screen.findByText(/Отчёт \(без публикации и автоудаления\)/),
    ).toBeInTheDocument();
    expect(existing.coverAssetId).not.toBeNull();
    expect(mediaRows).toHaveLength(1);
    expect(uploadActionIds).toHaveLength(3);
    expect(uploadActionIds[0]).toBe(uploadActionIds[1]);
    expect(client.updateWorldContent).toHaveBeenCalledTimes(1);
    expect(client.addWorldContentMedia).toHaveBeenCalledTimes(1);
    expect(client.addWorldContentMedia.mock.calls[0]?.[1]).toMatchObject({
      importPrecondition: {
        expectedRevision: 1,
        slug: record.slug,
        type: record.type,
        name: record.name,
        summary: record.summary,
        provenance: artbookProvenance(source, record),
      },
    });
    const firstUploadIds = [...uploadActionIds];
    const firstLookupIds = [...lookupActionIds];

    await user.upload(input, [cover, gallery]);
    expect(await screen.findByText(/Предложено 2 из/)).toBeInTheDocument();
    await user.click(
      screen.getByLabelText(/Я проверил каждое показанное сопоставление/),
    );
    await user.click(
      screen.getByRole("button", {
        name: "4. Подтвердить сопоставления и загрузку",
      }),
    );
    expect(uploadActionIds).toEqual(firstUploadIds);
    expect(lookupActionIds.slice(2)).toEqual(firstLookupIds.slice(0, 2));
    expect(client.updateWorldContent).toHaveBeenCalledTimes(1);
    expect(client.addWorldContentMedia).toHaveBeenCalledTimes(1);
    expect(mediaRows).toHaveLength(1);

    const changedCover = artbookImageFile("Амбер с моря.png", 99);
    Object.defineProperty(changedCover, "webkitRelativePath", {
      value: `Артбук/${record.cover}`,
    });
    const stableCoverId = existing.coverAssetId;
    await user.upload(input, [changedCover, gallery]);
    await user.click(
      screen.getByLabelText(/Я проверил каждое показанное сопоставление/),
    );
    await user.click(
      screen.getByRole("button", {
        name: "4. Подтвердить сопоставления и загрузку",
      }),
    );
    expect(existing.coverAssetId).toBe(stableCoverId);
    expect(uploadActionIds).toHaveLength(3);
    expect(
      await screen.findAllByText(/конфликт, загрузки не выполнялись/),
    ).toHaveLength(record.gallery.length + 1);
  });

  it("recovers a pre-commit cover failure without deleting or duplicating the retained upload", async () => {
    const user = userEvent.setup();
    const source = await loadArtbook();
    const record = source.записи.find((item) => item.slug === "artbook-amber")!;
    rows.push(
      dto({
        slug: record.slug,
        type: record.type,
        name: record.name,
        summary: record.summary,
        provenance: artbookProvenance(source, record),
      }),
    );
    client.updateWorldContent.mockRejectedValueOnce(
      new Error("pre-commit cover rejection"),
    );
    renderComponent(
      <WorldArtbookImport campaignId={campaignId} onChanged={vi.fn()} />,
    );
    const input = screen.getByLabelText(
      "3. Предложить сопоставления файлов (папка «Артбук»)",
    );
    const files = [record.cover!, ...record.gallery].map((path, index) => {
      const file = artbookImageFile(path.split("/").pop()!, index + 8);
      Object.defineProperty(file, "webkitRelativePath", {
        value: `Артбук/${path}`,
      });
      return file;
    });
    await user.upload(input, files);
    await user.click(
      screen.getByLabelText(/Я проверил каждое показанное сопоставление/),
    );
    await user.click(
      screen.getByRole("button", {
        name: "4. Подтвердить сопоставления и загрузку",
      }),
    );
    expect(await screen.findAllByText(/error, этап cover-attach/)).toHaveLength(
      1,
    );
    const assetId = [...uploadedByAction.values()][0]?.id;
    expect(assetId).toBeTruthy();
    expect(
      screen.getByText(new RegExp(`assetId ${assetId}`)),
    ).toBeInTheDocument();
    expect(rows[0]?.coverAssetId).toBeNull();
    const firstActions = [...uploadActionIds];
    await user.upload(input, files);
    await user.click(
      screen.getByLabelText(/Я проверил каждое показанное сопоставление/),
    );
    await user.click(
      screen.getByRole("button", {
        name: "4. Подтвердить сопоставления и загрузку",
      }),
    );
    await expect.poll(() => rows[0]?.coverAssetId).toBe(assetId);
    expect(uploadActionIds).toEqual(firstActions);
    expect(uploadedByAction.size).toBe(files.length);
  });

  it("does not attach cover media if the canonical slug changes after read-only preflight", async () => {
    const user = userEvent.setup();
    const source = await loadArtbook();
    const record = source.записи.find((item) => item.slug === "artbook-amber")!;
    const entity = dto({
      slug: record.slug,
      type: record.type,
      name: record.name,
      summary: record.summary,
      provenance: artbookProvenance(source, record),
    });
    rows.push(entity);
    let detailReads = 0;
    client.fetchWorldContentDetail.mockImplementation(async () => {
      detailReads++;
      if (detailReads === 2) {
        entity.slug = `${entity.slug}-renamed`;
        entity.revision++;
      }
      return entity;
    });
    renderComponent(
      <WorldArtbookImport campaignId={campaignId} onChanged={vi.fn()} />,
    );
    const input = screen.getByLabelText(
      "3. Предложить сопоставления файлов (папка «Артбук»)",
    );
    const files = [record.cover!, ...record.gallery].map((path, index) => {
      const file = artbookImageFile(path.split("/").pop()!, index + 91);
      Object.defineProperty(file, "webkitRelativePath", {
        value: `Артбук/${path}`,
      });
      return file;
    });
    await user.upload(input, files);
    await user.click(
      screen.getByLabelText(/Я проверил каждое показанное сопоставление/),
    );
    await user.click(
      screen.getByRole("button", {
        name: "4. Подтвердить сопоставления и загрузку",
      }),
    );
    expect(
      await screen.findByText(/artbook-amber.*error, этап attach/),
    ).toBeInTheDocument();
    expect(entity.slug).toBe(`${record.slug}-renamed`);
    expect(entity.coverAssetId).toBeNull();
    expect(client.updateWorldContent).not.toHaveBeenCalled();
    expect(client.addWorldContentMedia).not.toHaveBeenCalled();
    expect(uploadedByAction.size).toBe(1);
  });

  it.each([{ failureIndex: 0 }, { failureIndex: 2 }])(
    "does not bypass a real stale-source 409 at gallery item $failureIndex across remount",
    async ({ failureIndex }) => {
      const user = userEvent.setup();
      const source = await loadArtbook();
      const record = source.записи.find(
        (item) => item.slug === "artbook-raikavion",
      )!;
      const entity = dto({
        slug: record.slug,
        type: record.type,
        name: record.name,
        summary: record.summary,
        provenance: artbookProvenance(source, record),
      });
      rows.push(entity);
      const failedPath = record.gallery[failureIndex]!;
      let addCount = 0;
      client.addWorldContentMedia.mockImplementation(
        async (id: string, input) => {
          addCount++;
          if (addCount === failureIndex + 1) {
            entity.name = `${entity.name} changed after review`;
            entity.revision++;
          }
          const condition = input.importPrecondition;
          if (
            condition &&
            (condition.expectedRevision !== entity.revision ||
              condition.slug !== entity.slug ||
              condition.name !== entity.name ||
              condition.summary !== entity.summary ||
              condition.provenance.sourceExternalId !==
                entity.provenance?.sourceExternalId)
          )
            throw Object.assign(new Error("IMPORT_PRECONDITION_FAILED"), {
              status: 409,
            });
          const result = {
            id: crypto.randomUUID(),
            worldContentId: id,
            assetId: input.assetId,
            caption: input.caption ?? null,
            ordering: mediaRows.length,
            createdAt: new Date(0).toISOString(),
          } as WorldContentMediaDto;
          mediaRows.push(result);
          return result;
        },
      );
      const render = () =>
        renderComponent(
          <WorldArtbookImport campaignId={campaignId} onChanged={vi.fn()} />,
        );
      const firstMount = render();
      const files = [record.cover!, ...record.gallery].map((path, index) => {
        const file = artbookImageFile(path.split("/").pop()!, index);
        Object.defineProperty(file, "webkitRelativePath", {
          value: `Артбук/${path}`,
        });
        return file;
      });
      const chooseAndConfirm = async () => {
        const input = screen.getByLabelText(
          "3. Предложить сопоставления файлов (папка «Артбук»)",
        );
        await user.upload(input, files);
        await user.click(
          screen.getByLabelText(/Я проверил каждое показанное сопоставление/),
        );
        await user.click(
          screen.getByRole("button", {
            name: "4. Подтвердить сопоставления и загрузку",
          }),
        );
      };
      await chooseAndConfirm();
      expect(
        await screen.findByText(new RegExp(`${failedPath}: error`)),
      ).toBeInTheDocument();
      expect(mediaRows).toHaveLength(failureIndex);
      const firstActions = [...uploadActionIds];
      const firstAttachCalls = client.addWorldContentMedia.mock.calls.length;
      const firstCoverCalls = client.updateWorldContent.mock.calls.length;
      const expectedRetainedUploads = failureIndex === 0 ? 2 : 4;
      expect(uploadedByAction.size).toBe(expectedRetainedUploads);
      firstMount.unmount();
      render();
      await chooseAndConfirm();
      expect(
        await screen.findAllByText(
          new RegExp(`${record.slug}.*conflict, этап read-only-preflight`),
        ),
      ).toHaveLength(record.gallery.length + 1);
      expect(mediaRows).toHaveLength(failureIndex);
      expect(uploadActionIds).toEqual(firstActions);
      expect(uploadedByAction.size).toBe(expectedRetainedUploads);
      expect(client.addWorldContentMedia).toHaveBeenCalledTimes(
        firstAttachCalls,
      );
      expect(client.updateWorldContent).toHaveBeenCalledTimes(firstCoverCalls);
      expect(new Set(mediaRows.map((item) => item.assetId)).size).toBe(
        failureIndex,
      );
    },
  );

  it.each([{ failureIndex: 0 }, { failureIndex: 2 }])(
    "recovers transient pre-commit gallery failure $failureIndex while later siblings persist and after remount",
    async ({ failureIndex }) => {
      const user = userEvent.setup();
      const source = await loadArtbook();
      const record = source.записи.find(
        (item) => item.slug === "artbook-raikavion",
      )!;
      const entity = dto({
        slug: record.slug,
        type: record.type,
        name: record.name,
        summary: record.summary,
        provenance: artbookProvenance(source, record),
      });
      rows.push(entity);
      const failedPath = record.gallery[failureIndex]!;
      let addCount = 0;
      let failOnce = true;
      client.addWorldContentMedia.mockImplementation(async (id, input) => {
        addCount++;
        const condition = input.importPrecondition;
        if (
          !condition ||
          condition.expectedRevision !== entity.revision ||
          condition.slug !== entity.slug ||
          condition.name !== entity.name ||
          condition.summary !== entity.summary ||
          condition.provenance.sourceExternalId !==
            entity.provenance?.sourceExternalId
        )
          throw Object.assign(new Error("IMPORT_PRECONDITION_FAILED"), {
            status: 409,
          });
        if (addCount === failureIndex + 1 && failOnce) {
          failOnce = false;
          throw Object.assign(new Error("pre-commit gallery rejection"), {
            status: 409,
          });
        }
        const saved = {
          id: crypto.randomUUID(),
          worldContentId: id,
          assetId: input.assetId,
          caption: input.caption ?? null,
          ordering: mediaRows.length,
          createdAt: new Date(0).toISOString(),
        } as WorldContentMediaDto;
        mediaRows.push(saved);
        return saved;
      });
      const render = () =>
        renderComponent(
          <WorldArtbookImport campaignId={campaignId} onChanged={vi.fn()} />,
        );
      const firstMount = render();
      const files = [record.cover!, ...record.gallery].map((path, index) => {
        const file = artbookImageFile(path.split("/").pop()!, index + 120);
        Object.defineProperty(file, "webkitRelativePath", {
          value: `Артбук/${path}`,
        });
        return file;
      });
      const chooseAndConfirm = async () => {
        await user.upload(
          screen.getByLabelText(
            "3. Предложить сопоставления файлов (папка «Артбук»)",
          ),
          files,
        );
        await user.click(
          screen.getByLabelText(/Я проверил каждое показанное сопоставление/),
        );
        await user.click(
          screen.getByRole("button", {
            name: "4. Подтвердить сопоставления и загрузку",
          }),
        );
      };
      await chooseAndConfirm();
      expect(
        await screen.findByText(new RegExp(`${failedPath}: error`)),
      ).toBeInTheDocument();
      expect(failOnce).toBe(false);
      expect(mediaRows).toHaveLength(record.gallery.length - 1);
      const uploadedIds = [...uploadActionIds];
      expect(uploadedByAction.size).toBe(record.gallery.length + 1);
      const firstAttachCalls = client.addWorldContentMedia.mock.calls.length;
      const firstCoverCalls = client.updateWorldContent.mock.calls.length;
      const firstLookupCount = lookupActionIds.length;
      firstMount.unmount();
      render();
      await chooseAndConfirm();
      expect(
        await screen.findByText(
          new RegExp(`${failedPath}: created, этап gallery-attach`),
        ),
      ).toBeInTheDocument();
      expect(
        await screen.findAllByText(
          new RegExp(
            `${record.slug} / .*: (?:matched|created), этап (?:reconcile|gallery-attach)`,
          ),
        ),
      ).toHaveLength(record.gallery.length + 1);
      expect(mediaRows).toHaveLength(record.gallery.length);
      expect(client.addWorldContentMedia).toHaveBeenCalledTimes(
        firstAttachCalls + 1,
      );
      expect(client.updateWorldContent).toHaveBeenCalledTimes(firstCoverCalls);
      expect(uploadActionIds).toEqual(uploadedIds);
      expect(lookupActionIds).toHaveLength(firstLookupCount * 2);
      expect(lookupActionIds.slice(firstLookupCount)).toEqual(
        lookupActionIds.slice(0, firstLookupCount),
      );
      expect(uploadedByAction.size).toBe(record.gallery.length + 1);
      expect(new Set(mediaRows.map((item) => item.assetId)).size).toBe(
        record.gallery.length,
      );
    },
  );

  it("does not upload files when a manual cover or gallery is found by read-only preflight", async () => {
    const user = userEvent.setup();
    const source = await loadArtbook();
    const record = source.записи.find((item) => item.slug === "artbook-amber")!;
    const entity = dto({
      slug: record.slug,
      type: record.type,
      name: record.name,
      summary: record.summary,
      provenance: artbookProvenance(source, record),
    });
    const manualCover = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";
    entity.coverAssetId = manualCover;
    rows.push(entity);
    const manualGalleryAsset = "ffffffff-ffff-4fff-8fff-ffffffffffff";
    mediaRows.push({
      id: crypto.randomUUID(),
      worldContentId: entity.id,
      assetId: manualGalleryAsset,
      caption: null,
      ordering: 0,
      createdAt: new Date(0).toISOString(),
    } as WorldContentMediaDto);
    renderComponent(
      <WorldArtbookImport campaignId={campaignId} onChanged={vi.fn()} />,
    );
    const input = screen.getByLabelText(
      "3. Предложить сопоставления файлов (папка «Артбук»)",
    );
    const files = [record.cover!, ...record.gallery].map((path, index) => {
      const file = artbookImageFile(path.split("/").pop()!, index + 20);
      Object.defineProperty(file, "webkitRelativePath", {
        value: `Артбук/${path}`,
      });
      return file;
    });
    await user.upload(input, files);
    await user.click(
      screen.getByLabelText(/Я проверил каждое показанное сопоставление/),
    );
    await user.click(
      screen.getByRole("button", {
        name: "4. Подтвердить сопоставления и загрузку",
      }),
    );
    expect(
      await screen.findAllByText(
        /не соответствует доказанному action identity/,
      ),
    ).toHaveLength(record.gallery.length + 1);
    expect(uploadActionIds).toEqual([]);
    expect(entity.coverAssetId).toBe(manualCover);
    expect(mediaRows).toHaveLength(1);
  });

  it("blocks a manual gallery without uploading otherwise valid mappings", async () => {
    const user = userEvent.setup();
    const source = await loadArtbook();
    const record = source.записи.find((item) => item.slug === "artbook-amber")!;
    const entity = dto({
      slug: record.slug,
      type: record.type,
      name: record.name,
      summary: record.summary,
      provenance: artbookProvenance(source, record),
    });
    rows.push(entity);
    mediaRows.push({
      id: crypto.randomUUID(),
      worldContentId: entity.id,
      assetId: "ffffffff-ffff-4fff-8fff-ffffffffffff",
      caption: null,
      ordering: 0,
      createdAt: new Date(0).toISOString(),
    } as WorldContentMediaDto);
    renderComponent(
      <WorldArtbookImport campaignId={campaignId} onChanged={vi.fn()} />,
    );
    const input = screen.getByLabelText(
      "3. Предложить сопоставления файлов (папка «Артбук»)",
    );
    const files = [record.cover!, ...record.gallery].map((path, index) => {
      const file = artbookImageFile(path.split("/").pop()!, index + 30);
      Object.defineProperty(file, "webkitRelativePath", {
        value: `Артбук/${path}`,
      });
      return file;
    });
    await user.upload(input, files);
    await user.click(
      screen.getByLabelText(/Я проверил каждое показанное сопоставление/),
    );
    await user.click(
      screen.getByRole("button", {
        name: "4. Подтвердить сопоставления и загрузку",
      }),
    );
    expect(
      await screen.findAllByText(
        /галерея содержит asset вне полного доказанного набора/i,
      ),
    ).toHaveLength(record.gallery.length + 1);
    expect(uploadActionIds).toEqual([]);
    expect(mediaRows).toHaveLength(1);
  });

  it("blocks ambiguous duplicate selected paths and never falls back to basename upload", async () => {
    const user = userEvent.setup();
    const source = await loadArtbook();
    const record = source.записи.find((item) => item.slug === "artbook-amber")!;
    rows.push(
      dto({
        slug: record.slug,
        type: record.type,
        name: record.name,
        summary: record.summary,
        provenance: artbookProvenance(source, record),
      }),
    );
    renderComponent(
      <WorldArtbookImport campaignId={campaignId} onChanged={vi.fn()} />,
    );
    const input = screen.getByLabelText(
      "3. Предложить сопоставления файлов (папка «Артбук»)",
    );
    const duplicateFiles = [1, 2].map((index) => {
      const file = artbookImageFile("cover.png", index);
      Object.defineProperty(file, "webkitRelativePath", {
        value: `Артбук/${record.cover}`,
      });
      return file;
    });
    await user.upload(input, duplicateFiles);
    await user.click(
      screen.getByLabelText(/Я проверил каждое показанное сопоставление/),
    );
    await user.click(
      screen.getByRole("button", {
        name: "4. Подтвердить сопоставления и загрузку",
      }),
    );
    expect(
      await screen.findAllByText(/полный однозначный набор файлов/i),
    ).toHaveLength(record.gallery.length + 1);
    expect(uploadActionIds).toEqual([]);
  });

  it("blocks an empty image file before any upload", async () => {
    const user = userEvent.setup();
    const source = await loadArtbook();
    const record = source.записи.find((item) => item.slug === "artbook-amber")!;
    rows.push(
      dto({
        slug: record.slug,
        type: record.type,
        name: record.name,
        summary: record.summary,
        provenance: artbookProvenance(source, record),
      }),
    );
    renderComponent(
      <WorldArtbookImport campaignId={campaignId} onChanged={vi.fn()} />,
    );
    const input = screen.getByLabelText(
      "3. Предложить сопоставления файлов (папка «Артбук»)",
    );
    const files = [record.cover!, ...record.gallery].map((path, index) => {
      const file = new File(
        index === 0 ? [] : [artbookImageFixtureBytes.png(index)],
        path.split("/").pop()!,
        { type: "image/png" },
      );
      Object.defineProperty(file, "webkitRelativePath", {
        value: `Артбук/${path}`,
      });
      return file;
    });
    await user.upload(input, files);
    await user.click(
      screen.getByLabelText(/Я проверил каждое показанное сопоставление/),
    );
    await user.click(
      screen.getByRole("button", {
        name: "4. Подтвердить сопоставления и загрузку",
      }),
    );
    const report = await screen.findByLabelText("Отчёт импорта");
    const reportRows = within(report).getAllByRole("listitem");
    const sourceProposalCount = source.записи.reduce(
      (count, candidate) =>
        count + (candidate.cover === null ? 0 : 1) + candidate.gallery.length,
      0,
    );
    const imageOnlyPaths = source.картинкиБезТекста;
    expect(sourceProposalCount).toBe(86);
    expect(imageOnlyPaths).toHaveLength(7);
    expect(reportRows).toHaveLength(
      sourceProposalCount + imageOnlyPaths.length,
    );

    const amberRows = reportRows.filter((row) =>
      row.textContent?.startsWith(`${record.slug} / `),
    );
    expect(amberRows).toHaveLength(2);
    expect(amberRows).toHaveLength(
      (record.cover === null ? 0 : 1) + record.gallery.length,
    );
    for (const row of amberRows) {
      expect(row).toHaveTextContent("conflict, этап read-only-preflight");
      expect(row).toHaveTextContent(
        "Файл пустой. Полный набор записи заблокирован; загрузок не было.",
      );
    }

    const imageOnlyRows = reportRows.filter((row) =>
      row.textContent?.startsWith("(image-only) / "),
    );
    expect(imageOnlyRows).toHaveLength(imageOnlyPaths.length);
    for (const path of imageOnlyPaths) {
      const row = imageOnlyRows.find((candidate) =>
        candidate.textContent?.startsWith(`(image-only) / ${path}: `),
      );
      if (!row) throw new Error(`Missing image-only inventory row: ${path}`);
      expect(row).toHaveTextContent(
        `(image-only) / ${path}: blocked, этап inventory`,
      );
      expect(row).toHaveTextContent(
        "Картинка без текстовой записи; не создаём новую сущность.",
      );
    }
    const proposalRows = reportRows.filter(
      (row) => !row.textContent?.startsWith("(image-only) / "),
    );
    expect(proposalRows).toHaveLength(sourceProposalCount);
    const otherRows = proposalRows.filter(
      (row) => !row.textContent?.startsWith(`${record.slug} / `),
    );
    expect(otherRows).toHaveLength(84);
    expect(otherRows).toHaveLength(sourceProposalCount - amberRows.length);
    for (const row of otherRows) {
      expect(row).toHaveTextContent("conflict, этап read-only-preflight");
      expect(row).toHaveTextContent(
        "Source identity/slug is ambiguous or does not match one reviewed DRAFT; no media writes were made.",
      );
    }
    expect(uploadActionIds).toEqual([]);
    expect(client.addWorldContentMedia).not.toHaveBeenCalled();
    expect(client.updateWorldContent).not.toHaveBeenCalled();
    expect(client.createWorldContentWithActionId).not.toHaveBeenCalled();
    expect(rows[0]?.coverAssetId).toBeNull();
    expect(mediaRows).toEqual([]);
  });

  it("strips the selected folder name but never guesses from a basename", () => {
    const file = new File(["x"], "Яро.png");
    Object.defineProperty(file, "webkitRelativePath", {
      value: "Артбук/Пантеон/Яро.png",
    });
    expect(artbookRelativePath(file)).toBe("Пантеон/Яро.png");
  });
});

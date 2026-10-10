// @vitest-environment jsdom
import { createHash, webcrypto } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  renderComponent,
  screen,
  userEvent,
  waitFor,
} from "./test-support/render";
import {
  gmSnapshot,
  playerSnapshot,
} from "./test-support/game-snapshot-fixtures";
import { ApiError } from "./api";
import {
  createStickerPack,
  getStickerPack,
  listStickerPacks,
  publishStickerPack,
  uploadSticker,
} from "./sticker-pack-api";

vi.mock("./sticker-pack-api", () => ({
  createStickerPack: vi.fn(),
  getStickerPack: vi.fn(),
  listStickerPacks: vi.fn(),
  publishStickerPack: vi.fn(),
  uploadSticker: vi.fn(),
}));

const { StickerPackManager } = await import("./StickerPackManager");

const packDraft = {
  id: "00000000-0000-4000-8000-000000000497",
  name: "Ночной дозор",
  lifecycle: "DRAFT" as const,
  revision: 0,
};

beforeEach(() => {
  vi.mocked(listStickerPacks).mockResolvedValue([]);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.resetAllMocks();
});

async function fillValidPackForm(user: ReturnType<typeof userEvent.setup>) {
  await user.type(screen.getByLabelText("Название пака"), "Ночной дозор");
  await user.selectOptions(screen.getByLabelText("Тип набора"), "NPC");
  await user.type(screen.getByLabelText("Имя NPC"), "Смотритель");
}

describe("StickerPackManager", () => {
  it("is not rendered for a player", () => {
    renderComponent(<StickerPackManager snapshot={playerSnapshot()} />);

    expect(screen.queryByRole("region", { name: "Пак кампании" })).toBeNull();
    expect(createStickerPack).not.toHaveBeenCalled();
  });

  it("resumes a server draft and marks its stickers uploaded without replay", async () => {
    vi.mocked(listStickerPacks).mockResolvedValue([
      {
        ...packDraft,
        subject: "NPC",
        subjectCharacterId: null,
        subjectMembershipId: null,
        subjectLabel: "Смотритель",
        audience: "GM_ONLY",
        sendPolicy: "GM_ONLY",
        createdAt: "2026-10-08T00:00:00.000Z",
        updatedAt: "2026-10-08T00:00:00.000Z",
        playerConsentStatus: null,
        stickerCount: 1,
      },
    ]);
    vi.mocked(getStickerPack).mockResolvedValue({
      ...packDraft,
      subject: "NPC",
      subjectCharacterId: null,
      subjectMembershipId: null,
      subjectLabel: "Смотритель",
      audience: "GM_ONLY",
      sendPolicy: "GM_ONLY",
      createdAt: "2026-10-08T00:00:00.000Z",
      updatedAt: "2026-10-08T00:00:00.000Z",
      playerConsentStatus: null,
      stickerCount: 1,
      stickers: [
        {
          id: "00000000-0000-4000-8000-000000000498",
          packId: packDraft.id,
          mediaId: "00000000-0000-4000-8000-000000000499",
          name: "PRIVATE individual sticker name",
          altText: "Смотритель приветствует",
          provenanceType: "ORIGINAL",
          sourceReference: null,
          authorCredit: null,
          licenseNote: null,
          sha256: "a".repeat(64),
          mimeType: "image/webp",
          sizeBytes: 42,
          width: 16,
          height: 16,
        },
      ],
    });
    const user = userEvent.setup();
    renderComponent(<StickerPackManager snapshot={gmSnapshot()} />);
    await user.click(
      await screen.findByRole("button", {
        name: /Открыть «Ночной дозор»/,
      }),
    );
    expect(getStickerPack).toHaveBeenCalledWith(packDraft.id);
    expect(
      await screen.findByText("Загружен; повторно отправлен не будет."),
    ).toBeInTheDocument();
    expect(screen.queryByText("PRIVATE individual sticker name")).toBeNull();
    expect(screen.getByLabelText("Alt-текст")).toHaveValue(
      "Смотритель приветствует",
    );
    expect(screen.getByText("Изображение 1")).toBeInTheDocument();
    expect(screen.getByText(/нужно выбрать повторно/)).toBeInTheDocument();
    expect(uploadSticker).not.toHaveBeenCalled();
  });

  it("shows deprecated packs as read-only and offers a new-pack path", async () => {
    const deprecated = {
      ...packDraft,
      lifecycle: "DEPRECATED" as const,
      revision: 2,
      subject: "NPC" as const,
      subjectCharacterId: null,
      subjectMembershipId: null,
      subjectLabel: "Смотритель",
      audience: "GM_ONLY" as const,
      sendPolicy: "GM_ONLY" as const,
      createdAt: "2026-10-08T00:00:00.000Z",
      updatedAt: "2026-10-08T00:00:00.000Z",
      playerConsentStatus: null,
      stickerCount: 0,
    };
    vi.mocked(listStickerPacks).mockResolvedValue([deprecated]);
    vi.mocked(getStickerPack).mockResolvedValue({
      ...deprecated,
      stickers: [],
    });
    vi.mocked(createStickerPack).mockResolvedValue({
      id: "00000000-0000-4000-8000-000000000520",
      name: "Свежий пак",
      lifecycle: "DRAFT",
      revision: 0,
    });
    const user = userEvent.setup();
    renderComponent(<StickerPackManager snapshot={gmSnapshot()} />);
    await user.click(
      await screen.findByRole("button", { name: /Открыть «Ночной дозор»/ }),
    );
    expect(
      await screen.findByText(/устарел и доступен только для просмотра/),
    ).toBeInTheDocument();
    expect(
      screen.getByLabelText(/Устаревший пак Ночной дозор/),
    ).toBeInTheDocument();
    await user.click(
      screen.getByRole("button", { name: "Создать ещё один пак" }),
    );
    await fillValidPackForm(user);
    await user.clear(screen.getByLabelText("Название пака"));
    await user.type(screen.getByLabelText("Название пака"), "Свежий пак");
    await user.click(screen.getByRole("button", { name: "Создать черновик" }));
    expect(
      await screen.findByLabelText(/Черновик Свежий пак/),
    ).toBeInTheDocument();
    expect(createStickerPack).toHaveBeenCalledTimes(1);
  });

  it("isolates list responses when campaign or membership changes", async () => {
    let resolveOld!: (
      value: Awaited<ReturnType<typeof listStickerPacks>>,
    ) => void;
    const oldResponse = new Promise<
      Awaited<ReturnType<typeof listStickerPacks>>
    >((resolve) => {
      resolveOld = resolve;
    });
    const newerPack = {
      ...packDraft,
      id: "00000000-0000-4000-8000-000000000510",
      name: "Новый аккаунт",
      subject: "NPC" as const,
      subjectCharacterId: null,
      subjectMembershipId: null,
      subjectLabel: "Смотритель",
      audience: "GM_ONLY" as const,
      sendPolicy: "GM_ONLY" as const,
      createdAt: "2026-10-08T00:00:00.000Z",
      updatedAt: "2026-10-08T00:00:00.000Z",
      playerConsentStatus: null,
      stickerCount: 0,
    };
    vi.mocked(listStickerPacks)
      .mockReturnValueOnce(oldResponse)
      .mockResolvedValueOnce([newerPack]);
    const oldSnapshot = gmSnapshot();
    const newSnapshot = gmSnapshot();
    newSnapshot.campaign.id = "00000000-0000-4000-8000-000000000511";
    newSnapshot.me.id = "00000000-0000-4000-8000-000000000512";
    const view = renderComponent(<StickerPackManager snapshot={oldSnapshot} />);
    view.rerender(<StickerPackManager snapshot={newSnapshot} />);
    expect(
      await screen.findByRole("button", { name: /Новый аккаунт/ }),
    ).toBeInTheDocument();
    resolveOld([
      {
        ...newerPack,
        id: packDraft.id,
        name: "Старый аккаунт",
      },
    ]);
    await waitFor(() =>
      expect(screen.queryByText(/Старый аккаунт/)).toBeNull(),
    );
    expect(screen.getByText(/Новый аккаунт/)).toBeInTheDocument();
  });

  it("does not replay create after an ambiguous HTTP 500", async () => {
    vi.mocked(createStickerPack).mockRejectedValue(
      new ApiError(500, "INTERNAL_ERROR", "response lost after commit"),
    );
    const user = userEvent.setup();
    renderComponent(<StickerPackManager snapshot={gmSnapshot()} />);
    await fillValidPackForm(user);
    const create = screen.getByRole("button", { name: "Создать черновик" });
    await user.click(create);
    await waitFor(() =>
      expect(screen.getByText(/черновик мог сохраниться/)).toBeInTheDocument(),
    );
    expect(create).toBeDisabled();
    expect(createStickerPack).toHaveBeenCalledTimes(1);
  });

  it("recovers an ambiguous create only by manually selecting a server pack", async () => {
    const candidate = {
      ...packDraft,
      subject: "NPC" as const,
      subjectCharacterId: null,
      subjectMembershipId: null,
      subjectLabel: "Смотритель",
      audience: "GM_ONLY" as const,
      sendPolicy: "GM_ONLY" as const,
      createdAt: "2026-10-08T00:00:00.000Z",
      updatedAt: "2026-10-08T00:00:00.000Z",
      playerConsentStatus: null,
      stickerCount: 0,
    };
    vi.mocked(listStickerPacks)
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([candidate]);
    vi.mocked(createStickerPack).mockRejectedValue(
      new ApiError(500, "INTERNAL_ERROR", "response lost after commit"),
    );
    vi.mocked(getStickerPack).mockResolvedValue({
      ...candidate,
      stickers: [],
    });
    const user = userEvent.setup();
    renderComponent(<StickerPackManager snapshot={gmSnapshot()} />);
    await fillValidPackForm(user);
    await user.click(screen.getByRole("button", { name: "Создать черновик" }));
    await user.click(
      await screen.findByRole("button", { name: /Открыть «Ночной дозор»/ }),
    );
    await waitFor(() =>
      expect(getStickerPack).toHaveBeenCalledWith(packDraft.id),
    );
    expect(createStickerPack).toHaveBeenCalledTimes(1);
    expect(screen.getByText(/восстановлен/)).toBeInTheDocument();
  });

  it("blocks replay of an upload with an ambiguous HTTP 500 and keeps prior successes", async () => {
    vi.stubGlobal("crypto", webcrypto);
    vi.mocked(createStickerPack).mockResolvedValue(packDraft);
    vi.mocked(uploadSticker)
      .mockResolvedValueOnce({
        id: "00000000-0000-4000-8000-000000000498",
        packId: packDraft.id,
        mediaId: "00000000-0000-4000-8000-000000000499",
        name: "Успех",
        altText: "Стикер успешен",
        provenanceType: "ORIGINAL",
      })
      .mockRejectedValueOnce(
        new ApiError(500, "INTERNAL_ERROR", "response lost after commit"),
      );
    const rawHashes = ["one", "two"].map((bytes) =>
      createHash("sha256").update(bytes).digest("hex"),
    );
    vi.mocked(getStickerPack).mockResolvedValue({
      ...packDraft,
      subject: "NPC",
      subjectCharacterId: null,
      subjectMembershipId: null,
      subjectLabel: "Смотритель",
      audience: "GM_ONLY",
      sendPolicy: "GM_ONLY",
      createdAt: "2026-10-08T00:00:00.000Z",
      updatedAt: "2026-10-08T00:00:00.000Z",
      playerConsentStatus: null,
      stickerCount: 2,
      stickers: [
        {
          id: "00000000-0000-4000-8000-000000000498",
          packId: packDraft.id,
          mediaId: "00000000-0000-4000-8000-000000000499",
          name: "Успех",
          altText: "Стикер успешен",
          provenanceType: "ORIGINAL",
          sourceReference: null,
          authorCredit: null,
          licenseNote: null,
          sha256: rawHashes[0]!,
          mimeType: "image/webp",
          sizeBytes: 42,
          width: 16,
          height: 16,
        },
        {
          id: "00000000-0000-4000-8000-000000000500",
          packId: packDraft.id,
          mediaId: "00000000-0000-4000-8000-000000000501",
          name: "Неизвестно",
          altText: "Результат неизвестен",
          provenanceType: "ORIGINAL",
          sourceReference: null,
          authorCredit: null,
          licenseNote: null,
          sha256: rawHashes[1]!,
          mimeType: "image/webp",
          sizeBytes: 42,
          width: 16,
          height: 16,
        },
      ],
    });
    const user = userEvent.setup();
    renderComponent(<StickerPackManager snapshot={gmSnapshot()} />);
    await fillValidPackForm(user);
    await user.click(screen.getByRole("button", { name: "Создать черновик" }));
    await screen.findByText(/Создан черновик/);
    await user.upload(screen.getByLabelText("Добавить изображения"), [
      new File(["one"], "Успех.png", { type: "image/png" }),
      new File(["two"], "Неизвестно.png", { type: "image/png" }),
    ]);
    const alts = screen.getAllByLabelText("Alt-текст");
    await user.type(alts[0]!, "Стикер успешен");
    await user.type(alts[1]!, "Результат неизвестен");
    const originals = screen.getAllByLabelText("Происхождение");
    await user.selectOptions(originals[0]!, "ORIGINAL");
    await user.selectOptions(originals[1]!, "ORIGINAL");
    await user.click(
      screen.getByRole("button", { name: "Загрузить ожидающие стикеры" }),
    );
    await waitFor(() => expect(uploadSticker).toHaveBeenCalledTimes(2));
    expect(
      screen.getByText(/Ответ потерян: сервер мог принять файл/),
    ).toBeInTheDocument();
    expect(
      screen.getByText("Загружен; повторно отправлен не будет."),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Повторить неуспешные загрузки" }),
    ).toBeNull();
    await user.click(
      screen.getByRole("button", { name: "Сверить состояние с сервером" }),
    );
    await waitFor(() =>
      expect(getStickerPack).toHaveBeenCalledWith(packDraft.id),
    );
    await user.upload(screen.getByLabelText("Добавить изображения"), [
      new File(["one"], "Успех.png", { type: "image/png" }),
      new File(["two"], "Неизвестно.png", { type: "image/png" }),
    ]);
    expect(
      await screen.findByText(/совпал по SHA-256 с уже загруженным/),
    ).toBeInTheDocument();
    expect(uploadSticker).toHaveBeenCalledTimes(2);
  });

  it("does not repeat publication after an ambiguous HTTP 500", async () => {
    vi.mocked(createStickerPack).mockResolvedValue(packDraft);
    vi.mocked(uploadSticker).mockResolvedValue({
      id: "00000000-0000-4000-8000-000000000498",
      packId: packDraft.id,
      mediaId: "00000000-0000-4000-8000-000000000499",
      name: "Успех",
      altText: "Стикер успешен",
      provenanceType: "ORIGINAL",
    });
    vi.mocked(publishStickerPack).mockRejectedValue(
      new ApiError(500, "INTERNAL_ERROR", "response lost after commit"),
    );
    vi.mocked(getStickerPack).mockResolvedValue({
      ...packDraft,
      lifecycle: "ACTIVE",
      revision: 1,
      subject: "NPC",
      subjectCharacterId: null,
      subjectMembershipId: null,
      subjectLabel: "Смотритель",
      audience: "GM_ONLY",
      sendPolicy: "GM_ONLY",
      createdAt: "2026-10-08T00:00:00.000Z",
      updatedAt: "2026-10-08T00:00:00.000Z",
      playerConsentStatus: null,
      stickerCount: 1,
      stickers: [
        {
          id: "00000000-0000-4000-8000-000000000498",
          packId: packDraft.id,
          mediaId: "00000000-0000-4000-8000-000000000499",
          name: "Успех",
          altText: "Стикер успешен",
          provenanceType: "ORIGINAL",
          sourceReference: null,
          authorCredit: null,
          licenseNote: null,
          sha256: "a".repeat(64),
          mimeType: "image/webp",
          sizeBytes: 42,
          width: 16,
          height: 16,
        },
      ],
    });
    vi.spyOn(window, "confirm").mockReturnValue(true);
    const user = userEvent.setup();
    renderComponent(<StickerPackManager snapshot={gmSnapshot()} />);
    await fillValidPackForm(user);
    await user.click(screen.getByRole("button", { name: "Создать черновик" }));
    await screen.findByText(/Создан черновик/);
    await user.upload(screen.getByLabelText("Добавить изображения"), [
      new File(["one"], "Успех.png", { type: "image/png" }),
    ]);
    await user.type(screen.getByLabelText("Alt-текст"), "Стикер успешен");
    await user.selectOptions(
      screen.getByLabelText("Происхождение"),
      "ORIGINAL",
    );
    await user.click(
      screen.getByRole("button", { name: "Загрузить ожидающие стикеры" }),
    );
    const publish = await screen.findByRole("button", {
      name: "Опубликовать пак…",
    });
    await user.click(publish);
    await waitFor(() =>
      expect(screen.getByText(/Пак мог перейти в ACTIVE/)).toBeInTheDocument(),
    );
    expect(publish).toBeDisabled();
    expect(publishStickerPack).toHaveBeenCalledTimes(1);
    await user.click(
      screen.getByRole("button", { name: "Сверить состояние с сервером" }),
    );
    expect(
      await screen.findByText(/уже опубликован.*Текущее состояние загружено/),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Опубликовать пак…" }),
    ).toBeNull();
    expect(publishStickerPack).toHaveBeenCalledTimes(1);
  });

  it("creates a GM-only draft, uploads reviewed metadata, then publishes only after an explicit confirmation", async () => {
    vi.mocked(createStickerPack).mockResolvedValue(packDraft);
    const firstUpload = {
      id: "00000000-0000-4000-8000-000000000498",
      packId: packDraft.id,
      mediaId: "00000000-0000-4000-8000-000000000499",
      name: "Кубик",
      altText: "Герой бросает кубик",
      provenanceType: "IMPORTED" as const,
    };
    vi.mocked(uploadSticker)
      .mockResolvedValueOnce(firstUpload)
      .mockRejectedValueOnce(
        new ApiError(400, "IMAGE_TOO_LARGE", "file too large"),
      )
      .mockResolvedValueOnce({
        ...firstUpload,
        id: "00000000-0000-4000-8000-000000000500",
        mediaId: "00000000-0000-4000-8000-000000000501",
        name: "Факел",
        altText: "Горящий факел",
      });
    vi.mocked(publishStickerPack).mockResolvedValue({
      ...packDraft,
      lifecycle: "ACTIVE",
      revision: 1,
    });
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(true);
    const user = userEvent.setup();
    renderComponent(<StickerPackManager snapshot={gmSnapshot()} />);

    await fillValidPackForm(user);
    expect(screen.getByLabelText("Кто может видеть")).toHaveValue("GM_ONLY");
    expect(screen.getByLabelText("Кто может отправлять")).toHaveValue(
      "GM_ONLY",
    );
    await user.click(screen.getByRole("button", { name: "Создать черновик" }));

    await waitFor(() =>
      expect(createStickerPack).toHaveBeenCalledWith({
        name: "Ночной дозор",
        subject: "NPC",
        subjectCharacterId: null,
        subjectMembershipId: null,
        subjectLabel: "Смотритель",
        audience: "GM_ONLY",
        sendPolicy: "GM_ONLY",
      }),
    );
    const input = screen.getByLabelText("Добавить изображения");
    await user.upload(input, [
      new File(["webp"], "Кубик.webp", { type: "image/webp" }),
      new File(["png"], "Факел.png", { type: "image/png" }),
    ]);
    expect(screen.queryByLabelText("Название стикера")).toBeNull();
    expect(screen.queryByText("Название проверено человеком")).toBeNull();

    const altFields = screen.getAllByLabelText("Alt-текст");
    await user.type(altFields[0]!, "Герой бросает кубик");
    await user.type(altFields[1]!, "Горящий факел");
    const sourceFields = screen.getAllByLabelText(
      "Источник (обязательно для импортированного)",
    );
    await user.type(sourceFields[0]!, "D:\\User\\Desktop\\стикеры");
    await user.type(sourceFields[1]!, "D:\\User\\Desktop\\стикеры");
    const credits = screen.getAllByLabelText("Авторство / указание автора");
    await user.type(credits[0]!, "Автор — владелец");
    await user.type(credits[1]!, "Автор — владелец");
    const licenses = screen.getAllByLabelText("Лицензия / разрешение");
    await user.type(licenses[0]!, "Права подтверждены владельцем");
    await user.type(licenses[1]!, "Права подтверждены владельцем");
    await user.click(
      screen.getByRole("button", { name: "Загрузить ожидающие стикеры" }),
    );

    await waitFor(() =>
      expect(uploadSticker).toHaveBeenNthCalledWith(
        1,
        packDraft.id,
        expect.any(File),
        {
          name: "Стикер 1",
          altText: "Герой бросает кубик",
          provenanceType: "IMPORTED",
          sourceReference: "D:\\User\\Desktop\\стикеры",
          authorCredit: "Автор — владелец",
          licenseNote: "Права подтверждены владельцем",
        },
      ),
    );
    await waitFor(() => expect(uploadSticker).toHaveBeenCalledTimes(2));
    expect(
      screen.getByText(/Исходный файл превышает лимит размера/),
    ).toBeInTheDocument();
    await user.click(
      screen.getByRole("button", { name: "Повторить неуспешные загрузки" }),
    );
    await waitFor(() => expect(uploadSticker).toHaveBeenCalledTimes(3));
    expect(uploadSticker).toHaveBeenNthCalledWith(
      3,
      packDraft.id,
      expect.any(File),
      expect.objectContaining({ name: "Стикер 2", altText: "Горящий факел" }),
    );
    const publishButton = screen.getByRole("button", {
      name: "Опубликовать пак…",
    });
    await waitFor(() => expect(publishButton).toBeEnabled());
    expect(publishStickerPack).not.toHaveBeenCalled();

    await user.click(publishButton);
    expect(confirm).toHaveBeenCalledOnce();
    await waitFor(() =>
      expect(publishStickerPack).toHaveBeenCalledWith(packDraft.id),
    );
    expect(
      screen.getByText("Пак «Ночной дозор» опубликован."),
    ).toBeInTheDocument();
  });
});

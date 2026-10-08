// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
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
  publishStickerPack,
  uploadSticker,
} from "./sticker-pack-api";

vi.mock("./sticker-pack-api", () => ({
  createStickerPack: vi.fn(),
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

afterEach(() => vi.resetAllMocks());

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

  it("blocks replay of an upload with an ambiguous HTTP 500 and keeps prior successes", async () => {
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
    const reviewed = screen.getAllByRole("checkbox", {
      name: "Название проверено человеком",
    });
    await user.click(reviewed[0]!);
    await user.click(reviewed[1]!);
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
      screen.getByRole("checkbox", { name: "Название проверено человеком" }),
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
    const nameChecks = screen.getAllByRole("checkbox", {
      name: "Название проверено человеком",
    });
    await user.click(nameChecks[0]!);
    await user.click(nameChecks[1]!);
    await user.click(
      screen.getByRole("button", { name: "Загрузить ожидающие стикеры" }),
    );

    await waitFor(() =>
      expect(uploadSticker).toHaveBeenNthCalledWith(
        1,
        packDraft.id,
        expect.any(File),
        {
          name: "Кубик",
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
      expect.objectContaining({ name: "Факел", altText: "Горящий факел" }),
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

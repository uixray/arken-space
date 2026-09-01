// @vitest-environment jsdom
import type { ComponentProps } from "react";
import type {
  ButtonButtonProps,
  DialogBodyProps,
  DialogFooterProps,
  DialogHeaderProps,
  DialogProps,
} from "@gravity-ui/uikit";
import type { CharacterMediaDto } from "@arken/contracts";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  act,
  renderComponent,
  screen,
  userEvent,
  waitFor,
  within,
} from "../test-support/render";
import { ApiError } from "../api";
import type { ImageUploadFieldProps } from "../ui/ImageUploadField";
import type { FormSelect, FormTextArea } from "../ui/GravityFormControls";

const apiMock = vi.hoisted(() => vi.fn());

vi.mock("../api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../api")>();
  return { ...actual, api: apiMock };
});

vi.mock("@gravity-ui/uikit", () => {
  const Dialog = Object.assign(
    ({ open, children, ...props }: DialogProps) =>
      open ? (
        <div role="dialog" aria-label={props["aria-label"]}>
          {children}
        </div>
      ) : null,
    {
      Header: ({ caption }: DialogHeaderProps) => <h2>{caption}</h2>,
      Body: ({ children }: DialogBodyProps) => <div>{children}</div>,
      Footer: ({
        textButtonApply,
        textButtonCancel,
        onClickButtonApply,
        onClickButtonCancel,
        loading,
        errorText,
        showError,
      }: DialogFooterProps) => (
        <div>
          {showError ? <p role="alert">{errorText}</p> : null}
          <button
            type="button"
            disabled={loading}
            onClick={(event) => onClickButtonCancel?.(event)}
          >
            {textButtonCancel}
          </button>
          <button
            type="button"
            disabled={loading}
            onClick={(event) => onClickButtonApply?.(event)}
          >
            {textButtonApply}
          </button>
        </div>
      ),
    },
  );

  return {
    Dialog,
    Button: ({
      disabled,
      loading,
      onClick,
      children,
      ...props
    }: ButtonButtonProps) => (
      <button
        type="button"
        disabled={disabled}
        aria-busy={loading}
        aria-label={props["aria-label"]}
        title={props.title}
        onClick={onClick}
      >
        {children}
      </button>
    ),
  };
});

type FormSelectProps = ComponentProps<typeof FormSelect>;
type FormTextAreaProps = ComponentProps<typeof FormTextArea>;

vi.mock("../ui/GravityFormControls", () => ({
  FormSelect: ({ children, ...props }: FormSelectProps) => (
    <select {...props}>{children}</select>
  ),
  FormTextArea: (props: FormTextAreaProps) => <textarea {...props} />,
}));

vi.mock("../ui/ImageUploadField", () => ({
  ImageUploadField: ({ label, disabled }: ImageUploadFieldProps) => (
    <input type="file" aria-label={label} disabled={disabled} />
  ),
}));

const { CharacterMediaGallery } = await import("./CharacterMediaGallery");

const actionId = "00000000-0000-4000-8000-000000000404";
const media: CharacterMediaDto = {
  id: "00000000-0000-4000-8000-000000000001",
  campaignId: "00000000-0000-4000-8000-000000000002",
  characterId: "00000000-0000-4000-8000-000000000003",
  assetId: "00000000-0000-4000-8000-000000000004",
  category: "CHARACTER_ART",
  caption: "Портрет у костра",
  ordering: 0,
  visibility: "OWNER_GM",
  relatedEntityId: null,
  uploadedByMembershipId: "00000000-0000-4000-8000-000000000005",
  detachedAt: null,
  revision: 7,
  createdAt: "2026-09-01T00:00:00.000Z",
  updatedAt: "2026-09-01T00:00:00.000Z",
};

const secondMedia: CharacterMediaDto = {
  ...media,
  id: "00000000-0000-4000-8000-000000000011",
  assetId: "00000000-0000-4000-8000-000000000014",
  caption: "Второй портрет",
  ordering: 1,
};

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function galleryElement(characterId: string, isGm: boolean) {
  return (
    <CharacterMediaGallery
      characterId={characterId}
      characterName="Аркен"
      editable
      isGm={isGm}
      onUpload={vi.fn()}
    />
  );
}

function renderGallery(isGm: boolean) {
  return renderComponent(galleryElement(media.characterId, isGm));
}

function expectMutation(
  callIndex: number,
  path: string,
  method: "POST" | "DELETE",
) {
  const [actualPath, init] = apiMock.mock.calls[callIndex] as [
    string,
    RequestInit,
  ];
  expect(actualPath).toBe(path);
  expect(init.method).toBe(method);
  expect(JSON.parse(String(init.body))).toEqual({
    actionId,
    revision: media.revision,
  });
}

beforeEach(() => {
  apiMock.mockReset();
  apiMock.mockResolvedValue([media]);
  vi.spyOn(globalThis.crypto, "randomUUID").mockReturnValue(actionId);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("подтверждение удаления изображения из галереи персонажа", () => {
  it("не отсоединяет до подтверждения, объясняет судьбу файла и отменяется без запроса", async () => {
    renderGallery(false);
    const openButton = await screen.findByRole("button", {
      name: "Убрать из галереи",
    });
    expect(apiMock).toHaveBeenCalledTimes(1);

    await userEvent.click(openButton);
    expect(globalThis.crypto.randomUUID).toHaveBeenCalledTimes(1);

    const dialog = screen.getByRole("dialog", {
      name: "Убрать изображение из галереи?",
    });
    expect(dialog).toHaveTextContent(
      "Изображение исчезнет из галереи персонажа, но исходный файл останется в медиатеке.",
    );
    expect(apiMock).toHaveBeenCalledTimes(1);

    await userEvent.click(
      within(dialog).getByRole("button", { name: "Отмена" }),
    );
    expect(
      screen.queryByRole("dialog", {
        name: "Убрать изображение из галереи?",
      }),
    ).not.toBeInTheDocument();
    expect(apiMock).toHaveBeenCalledTimes(1);

    await userEvent.click(openButton);
    expect(globalThis.crypto.randomUUID).toHaveBeenCalledTimes(2);
    await userEvent.click(
      within(
        screen.getByRole("dialog", {
          name: "Убрать изображение из галереи?",
        }),
      ).getByRole("button", { name: "Убрать" }),
    );

    await waitFor(() => expect(apiMock).toHaveBeenCalledTimes(2));
    expect(globalThis.crypto.randomUUID).toHaveBeenCalledTimes(2);
    expectMutation(1, `/api/character-media/${media.id}/detach`, "POST");
  });

  it("подтверждает GM-удаление отдельно и сохраняет исходный файл", async () => {
    renderGallery(true);
    const openButton = await screen.findByRole("button", {
      name: "Удалить навсегда",
    });

    await userEvent.click(openButton);

    const dialog = screen.getByRole("dialog", {
      name: "Удалить запись галереи навсегда?",
    });
    expect(dialog).toHaveTextContent(
      "Запись будет безвозвратно удалена из галереи персонажа, но файл останется в медиатеке.",
    );
    expect(apiMock).toHaveBeenCalledTimes(1);

    await userEvent.click(
      within(dialog).getByRole("button", { name: "Отмена" }),
    );
    expect(apiMock).toHaveBeenCalledTimes(1);

    await userEvent.click(openButton);
    await userEvent.click(
      within(
        screen.getByRole("dialog", {
          name: "Удалить запись галереи навсегда?",
        }),
      ).getByRole("button", { name: "Удалить навсегда" }),
    );

    await waitFor(() => expect(apiMock).toHaveBeenCalledTimes(2));
    expectMutation(1, `/api/character-media/${media.id}`, "DELETE");
  });

  it("не возвращает старую галерею при обратном порядке ответов после смены персонажа", async () => {
    const firstLoad = deferred<CharacterMediaDto[]>();
    const secondLoad = deferred<CharacterMediaDto[]>();
    const nextCharacterId = "00000000-0000-4000-8000-000000000099";
    const nextMedia: CharacterMediaDto = {
      ...media,
      id: "00000000-0000-4000-8000-000000000091",
      characterId: nextCharacterId,
      assetId: "00000000-0000-4000-8000-000000000094",
      caption: "Галерея нового персонажа",
    };
    apiMock.mockReset();
    apiMock
      .mockReturnValueOnce(firstLoad.promise)
      .mockReturnValueOnce(secondLoad.promise);

    const view = renderGallery(false);
    await waitFor(() => expect(apiMock).toHaveBeenCalledTimes(1));
    view.rerender(galleryElement(nextCharacterId, false));
    await waitFor(() => expect(apiMock).toHaveBeenCalledTimes(2));

    await act(async () => {
      secondLoad.resolve([nextMedia]);
      await secondLoad.promise;
    });
    expect(await screen.findByText("Галерея нового персонажа")).toBeVisible();

    await act(async () => {
      firstLoad.resolve([media]);
      await firstLoad.promise;
    });
    expect(screen.getByText("Галерея нового персонажа")).toBeVisible();
    expect(screen.queryByText("Портрет у костра")).not.toBeInTheDocument();
  });

  it("сбрасывает подтверждение при переключении на другого персонажа", async () => {
    const view = renderGallery(false);
    await userEvent.click(
      await screen.findByRole("button", { name: "Убрать из галереи" }),
    );
    expect(
      screen.getByRole("dialog", {
        name: "Убрать изображение из галереи?",
      }),
    ).toBeInTheDocument();

    view.rerender(
      galleryElement("00000000-0000-4000-8000-000000000099", false),
    );

    await waitFor(() => expect(apiMock).toHaveBeenCalledTimes(2));
    expect(
      screen.queryByRole("dialog", {
        name: "Убрать изображение из галереи?",
      }),
    ).not.toBeInTheDocument();
    expect(screen.queryByText("Портрет у костра")).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Убрать из галереи" }),
    ).not.toBeInTheDocument();
    expect(
      apiMock.mock.calls.map(
        ([, init]) => (init as RequestInit | undefined)?.method ?? "GET",
      ),
    ).toEqual(["GET", "GET"]);
  });

  it("после 409 обновляет галерею и закрывает диалог со старой ревизией", async () => {
    apiMock.mockReset();
    apiMock
      .mockResolvedValueOnce([media])
      .mockRejectedValueOnce(
        new ApiError(409, "CHARACTER_MEDIA_CONFLICT", "Запись уже изменена"),
      )
      .mockResolvedValueOnce([{ ...media, revision: 8 }]);
    renderGallery(false);

    await userEvent.click(
      await screen.findByRole("button", { name: "Убрать из галереи" }),
    );
    expect(globalThis.crypto.randomUUID).toHaveBeenCalledTimes(1);
    await userEvent.click(
      within(
        screen.getByRole("dialog", {
          name: "Убрать изображение из галереи?",
        }),
      ).getByRole("button", { name: "Убрать" }),
    );

    await waitFor(() => expect(apiMock).toHaveBeenCalledTimes(3));
    expectMutation(1, `/api/character-media/${media.id}/detach`, "POST");
    expect(apiMock.mock.calls[2]?.[0]).toBe(
      `/api/characters/${media.characterId}/media`,
    );
    expect(
      screen.queryByRole("dialog", {
        name: "Убрать изображение из галереи?",
      }),
    ).not.toBeInTheDocument();
    expect(screen.getByRole("alert")).toHaveTextContent(
      "Запись уже изменена. Галерея обновлена — повторите действие.",
    );
    expect(globalThis.crypto.randomUUID).toHaveBeenCalledTimes(1);
  });

  it("не позволяет закрыть подтверждение или начать второе удаление до ответа", async () => {
    const mutation = deferred<unknown>();
    apiMock.mockReset();
    apiMock
      .mockResolvedValueOnce([media, secondMedia])
      .mockReturnValueOnce(mutation.promise);
    renderGallery(false);
    const openButtons = await screen.findAllByRole("button", {
      name: "Убрать из галереи",
    });

    await userEvent.click(openButtons[0]!);
    const dialog = screen.getByRole("dialog", {
      name: "Убрать изображение из галереи?",
    });
    await userEvent.click(
      within(dialog).getByRole("button", { name: "Убрать" }),
    );
    await waitFor(() => expect(apiMock).toHaveBeenCalledTimes(2));

    const cancel = within(dialog).getByRole("button", { name: "Отмена" });
    expect(cancel).toBeDisabled();
    await waitFor(() => expect(openButtons[1]).toBeDisabled());
    await userEvent.click(cancel);
    await userEvent.click(openButtons[1]!);
    expect(dialog).toBeInTheDocument();
    expect(apiMock).toHaveBeenCalledTimes(2);
    expect(globalThis.crypto.randomUUID).toHaveBeenCalledTimes(1);

    await act(async () => {
      mutation.resolve(undefined);
      await mutation.promise;
    });
    await waitFor(() => expect(dialog).not.toBeInTheDocument());
    expect(screen.queryByText("Портрет у костра")).not.toBeInTheDocument();
    expect(screen.getByText("Второй портрет")).toBeVisible();
  });

  it("отвязывает нового персонажа от зависшего удаления предыдущего", async () => {
    const oldMutation = deferred<unknown>();
    const nextCharacterId = "00000000-0000-4000-8000-000000000099";
    const nextMedia: CharacterMediaDto = {
      ...media,
      id: "00000000-0000-4000-8000-000000000091",
      characterId: nextCharacterId,
      assetId: "00000000-0000-4000-8000-000000000094",
      caption: "Активная галерея нового персонажа",
    };
    apiMock.mockReset();
    apiMock
      .mockResolvedValueOnce([media])
      .mockReturnValueOnce(oldMutation.promise)
      .mockResolvedValueOnce([nextMedia]);
    const view = renderGallery(false);

    await userEvent.click(
      await screen.findByRole("button", { name: "Убрать из галереи" }),
    );
    await userEvent.click(
      within(
        screen.getByRole("dialog", {
          name: "Убрать изображение из галереи?",
        }),
      ).getByRole("button", { name: "Убрать" }),
    );
    await waitFor(() => expect(apiMock).toHaveBeenCalledTimes(2));

    view.rerender(galleryElement(nextCharacterId, false));
    expect(
      await screen.findByText("Активная галерея нового персонажа"),
    ).toBeVisible();
    const nextRemoval = screen.getByRole("button", {
      name: "Убрать из галереи",
    });
    expect(nextRemoval).toBeEnabled();

    await act(async () => {
      oldMutation.resolve(undefined);
      await oldMutation.promise;
    });
    expect(screen.getByText("Активная галерея нового персонажа")).toBeVisible();
    expect(nextRemoval).toBeEnabled();
    expect(apiMock).toHaveBeenCalledTimes(3);
  });

  it("не показывает старые строки, если загрузка нового персонажа отклонена", async () => {
    const nextLoad = deferred<CharacterMediaDto[]>();
    const nextCharacterId = "00000000-0000-4000-8000-000000000099";
    apiMock.mockReset();
    apiMock
      .mockResolvedValueOnce([media])
      .mockReturnValueOnce(nextLoad.promise);
    const view = renderGallery(false);
    expect(await screen.findByText("Портрет у костра")).toBeVisible();

    view.rerender(galleryElement(nextCharacterId, false));
    await waitFor(() => expect(apiMock).toHaveBeenCalledTimes(2));
    await act(async () => {
      nextLoad.reject(new Error("Новая галерея недоступна"));
      await nextLoad.promise.catch(() => undefined);
    });

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Новая галерея недоступна",
    );
    expect(screen.queryByText("Портрет у костра")).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Убрать из галереи" }),
    ).not.toBeInTheDocument();
  });

  it("после 409 и отказа refresh не оставляет stale dialog или действие", async () => {
    apiMock.mockReset();
    apiMock
      .mockResolvedValueOnce([media])
      .mockRejectedValueOnce(
        new ApiError(409, "CHARACTER_MEDIA_CONFLICT", "Запись уже изменена"),
      )
      .mockRejectedValueOnce(new Error("Обновить галерею не удалось"));
    renderGallery(false);

    await userEvent.click(
      await screen.findByRole("button", { name: "Убрать из галереи" }),
    );
    await userEvent.click(
      within(
        screen.getByRole("dialog", {
          name: "Убрать изображение из галереи?",
        }),
      ).getByRole("button", { name: "Убрать" }),
    );

    await waitFor(() => expect(apiMock).toHaveBeenCalledTimes(3));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Обновить галерею не удалось",
    );
    expect(
      screen.queryByRole("dialog", {
        name: "Убрать изображение из галереи?",
      }),
    ).not.toBeInTheDocument();
    expect(screen.queryByText("Портрет у костра")).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Убрать из галереи" }),
    ).not.toBeInTheDocument();
  });
});

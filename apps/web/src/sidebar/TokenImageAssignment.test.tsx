// @vitest-environment jsdom
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import { renderComponent, screen, userEvent } from "../test-support/render";
import type { ImageUploadFieldProps } from "../ui/ImageUploadField";
import type { GameSnapshot } from "@arken/contracts";

/**
 * UIX-491, вторая половина жалобы: «я не смог загрузить и назначить картинку
 * на токен, но при этом она назначилась».
 *
 * Форма сообщала только об ошибке, а при успехе молча очищала поле файла. Для
 * человека это неотличимо от «ничего не произошло»: та же форма, что и до
 * нажатия. Проверяется поэтому именно то, чего не хватало, — что после
 * успешного назначения на экране появляется сказанное словами подтверждение, а
 * не только исчезнувший файл.
 *
 * Блок показывается игроку: у мастера на его месте кнопка «Настроить».
 *
 * Моки — по тем же причинам, что и в `MediaPanel.test.tsx`: `Button` из
 * `@gravity-ui/uikit` тянет CSS, который здешний transform не берёт, а
 * `ImageUploadField` — отдельная забота с file input и object URL, к этой
 * проверке отношения не имеющая. Оба типизированы своими же контрактами.
 */
vi.mock("@gravity-ui/uikit", () => ({
  Button: ({
    disabled,
    loading,
    onClick,
    children,
  }: {
    disabled?: boolean;
    loading?: boolean;
    onClick?: () => void;
    children?: ReactNode;
  }) => (
    <button disabled={disabled} aria-busy={loading} onClick={onClick}>
      {children}
    </button>
  ),
}));

vi.mock("../ui/ImageUploadField", () => ({
  ImageUploadField: ({ label, disabled, onUpdate }: ImageUploadFieldProps) => (
    <div>
      <span>{label}</span>
      <button
        type="button"
        disabled={disabled}
        onClick={() => onUpdate(new File(["x"], "token.png"))}
      >
        {`Выбрать файл: ${label}`}
      </button>
    </div>
  ),
}));

const { TokenImageAssignment } = await import("./TokenPalette");

const definition = {
  id: "11111111-1111-4111-8111-111111111111",
  name: "Страж",
  revision: 3,
} as NonNullable<GameSnapshot["tokenDefinitions"]>[number];

function setup(
  upload: () => Promise<{ id: string }>,
  patch = vi.fn().mockResolvedValue(undefined),
) {
  renderComponent(
    <TokenImageAssignment
      definition={definition}
      onUpload={
        upload as unknown as Parameters<
          typeof TokenImageAssignment
        >[0]["onUpload"]
      }
      onPatch={
        patch as unknown as Parameters<
          typeof TokenImageAssignment
        >[0]["onPatch"]
      }
    />,
  );
  return { patch };
}

async function chooseFileAndAssign() {
  await userEvent.click(screen.getByRole("button", { name: /Выбрать файл/ }));
  await userEvent.click(
    screen.getByRole("button", { name: "Загрузить и назначить" }),
  );
}

describe("UIX-491 — назначение изображения токену сообщает об успехе", () => {
  it("называет успех словами, а не только очищает поле файла", async () => {
    const { patch } = setup(() => Promise.resolve({ id: "asset-1" }));

    await chooseFileAndAssign();

    const notice = await screen.findByRole("status");
    expect(notice).toHaveTextContent("Изображение назначено токену «Страж».");
    expect(patch).toHaveBeenCalledWith(definition.id, definition.revision, {
      defaultAssetId: "asset-1",
    });
  });

  it("после неудачи показывает ошибку и не показывает подтверждение", async () => {
    setup(() => Promise.reject(new Error("Файл слишком велик")));

    await chooseFileAndAssign();

    const failure = await screen.findByRole("alert");
    expect(failure).toHaveTextContent("Файл слишком велик");
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("снимает подтверждение, когда выбран следующий файл", async () => {
    setup(() => Promise.resolve({ id: "asset-1" }));

    await chooseFileAndAssign();
    await screen.findByRole("status");

    await userEvent.click(screen.getByRole("button", { name: /Выбрать файл/ }));

    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });
});

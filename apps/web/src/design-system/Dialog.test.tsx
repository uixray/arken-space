// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Dialog } from "./Dialog";

afterEach(cleanup);

describe("Dialog", () => {
  it("renders modal dialog with title, body, and footer when open", () => {
    const onClose = vi.fn();
    const onApply = vi.fn();
    render(
      <Dialog open={true} onClose={onClose}>
        <Dialog.Header caption="Создать сцену" />
        <Dialog.Body>
          <p>Параметры новой сцены</p>
        </Dialog.Body>
        <Dialog.Footer
          textButtonApply="Создать"
          textButtonCancel="Отмена"
          onClickButtonApply={onApply}
          onClickButtonCancel={onClose}
        />
      </Dialog>,
    );

    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(screen.getByText("Создать сцену")).toBeInTheDocument();
    expect(screen.getByText("Параметры новой сцены")).toBeInTheDocument();
    expect(screen.getByText("Создать")).toBeInTheDocument();
    expect(screen.getByText("Отмена")).toBeInTheDocument();
  });

  it("does not render contents when open={false}", () => {
    render(
      <Dialog open={false} onClose={vi.fn()}>
        <Dialog.Header caption="Скрытое окно" />
        <Dialog.Body>Секретный контент</Dialog.Body>
      </Dialog>,
    );

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(screen.queryByText("Скрытое окно")).not.toBeInTheDocument();
  });

  it("calls onClose when clicking the close button", () => {
    const onClose = vi.fn();
    render(
      <Dialog open={true} onClose={onClose}>
        <Dialog.Header caption="Окно настроек" />
        <Dialog.Body>Контент</Dialog.Body>
      </Dialog>,
    );

    const closeBtn = screen.getByRole("button", {
      name: "Закрыть диалоговое окно",
    });
    fireEvent.click(closeBtn);
    expect(onClose).toHaveBeenCalled();
  });

  it("handles footer actions and displays error alert", () => {
    const onApply = vi.fn();
    const onClose = vi.fn();
    render(
      <Dialog open={true} onClose={onClose}>
        <Dialog.Header caption="Подтверждение" />
        <Dialog.Body>Текст</Dialog.Body>
        <Dialog.Footer
          textButtonApply="Применить"
          onClickButtonApply={onApply}
          onClickButtonCancel={onClose}
          showError={true}
          errorText="Не удалось сохранить изменения"
        />
      </Dialog>,
    );

    expect(screen.getByRole("alert")).toHaveTextContent(
      "Не удалось сохранить изменения",
    );

    const applyBtn = screen.getByText("Применить");
    fireEvent.click(applyBtn);
    expect(onApply).toHaveBeenCalled();

    const cancelBtn = screen.getByText("Отмена");
    fireEvent.click(cancelBtn);
    expect(onClose).toHaveBeenCalled();
  });

  it("supports all-in-one usage with title prop", () => {
    const onClose = vi.fn();
    render(
      <Dialog open={true} title="Быстрый диалог" onClose={onClose}>
        Простой текст
      </Dialog>,
    );

    expect(screen.getByText("Быстрый диалог")).toBeInTheDocument();
    expect(screen.getByText("Простой текст")).toBeInTheDocument();
  });
});
